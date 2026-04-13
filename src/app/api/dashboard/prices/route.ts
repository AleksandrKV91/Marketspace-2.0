import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/supabase/fetchAll'

export const maxDuration = 60

function shiftDate(iso: string, days: number): string {
  const d = new Date(iso)
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

function daysBetween(from: string, to: string): number {
  return Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000) + 1
}

export async function GET(req: NextRequest) {
  const supabase = createServiceClient()
  const { searchParams } = new URL(req.url)
  const search = searchParams.get('search') ?? ''
  const fromParam = searchParams.get('from')
  const toParam = searchParams.get('to')

  // Latest upload IDs
  const { data: lastUploads } = await supabase
    .from('uploads')
    .select('id, file_type')
    .eq('status', 'ok')
    .order('uploaded_at', { ascending: false })
    .limit(20)
  const latestByType: Record<string, string> = {}
  if (lastUploads) for (const u of lastUploads) {
    if (!latestByType[u.file_type]) latestByType[u.file_type] = u.id
  }
  const skuReportId = latestByType['sku_report']

  // Price changes — все строки за период
  type PriceRow = { sku_wb: number | null; sku_ms: string | null; price_date: string; price: number | null }
  const priceRows = await fetchAll<PriceRow>(
    (sb) => {
      let q = sb.from('fact_price_changes')
        .select('sku_wb, sku_ms, price_date, price')
        .order('price_date', { ascending: false })
      if (fromParam) q = q.gte('price_date', fromParam)
      if (toParam) q = q.lte('price_date', toParam)
      if (search) q = q.or(`sku_ms.ilike.%${search}%`)
      return q
    },
    supabase,
  )

  // dim_sku for names — батчами по 500
  const skuMsList = [...new Set(priceRows.map(r => r.sku_ms).filter((v): v is string => !!v))]
  const nameMap: Record<string, { name: string | null; brand: string | null; subject_wb: string | null }> = {}
  if (skuMsList.length) {
    for (let i = 0; i < skuMsList.length; i += 500) {
      const { data: dimRows } = await supabase
        .from('dim_sku').select('sku_ms, name, brand, subject_wb')
        .in('sku_ms', skuMsList.slice(i, i + 500))
      if (dimRows) for (const r of dimRows) nameMap[r.sku_ms] = r
    }
  }

  // fact_sku_snapshot — manager per sku_ms — батчами по 500
  const managerMap: Record<string, string> = {}
  if (skuReportId && skuMsList.length) {
    for (let i = 0; i < skuMsList.length; i += 500) {
      const { data: snapRows } = await supabase
        .from('fact_sku_snapshot').select('sku_ms, manager')
        .eq('upload_id', skuReportId)
        .in('sku_ms', skuMsList.slice(i, i + 500))
      if (snapRows) for (const r of snapRows) managerMap[r.sku_ms] = r.manager ?? ''
    }
  }

  // Определить диапазоны дат
  let fromDaily = fromParam
  let toDaily = toParam
  if (!fromDaily || !toDaily) {
    const { data: maxDateRow } = await supabase
      .from('fact_sku_daily').select('metric_date').order('metric_date', { ascending: false }).limit(1)
    const maxDate = maxDateRow?.[0]?.metric_date ?? null
    if (maxDate) {
      const from7 = new Date(maxDate)
      from7.setDate(from7.getDate() - 6)
      fromDaily = from7.toISOString().split('T')[0]
      toDaily = maxDate
    }
  }

  // Предыдущий период
  let prevFrom: string | null = null
  let prevTo: string | null = null
  if (fromDaily && toDaily) {
    const periodDays = daysBetween(fromDaily, toDaily)
    prevTo = shiftDate(fromDaily, -1)
    prevFrom = shiftDate(prevTo, -(periodDays - 1))
  }

  // Расширенный диапазон для расчёта дельт цен (±14 дней от текущего периода)
  const extFrom = fromDaily ? shiftDate(fromDaily, -14) : null
  const extTo = toDaily ? shiftDate(toDaily, 14) : null

  type DailyRow = {
    sku_ms: string; metric_date: string
    revenue: number | null; ad_spend: number | null
    ctr: number | null; cr_cart: number | null; cr_order: number | null
    cpm: number | null; cpc: number | null; ad_order_share: number | null
  }

  // Основной запрос — расширенный диапазон
  const dailyRows = extFrom && extTo
    ? await fetchAll<DailyRow>(
        (sb) => sb.from('fact_sku_daily')
          .select('sku_ms, metric_date, revenue, ad_spend, ctr, cr_cart, cr_order, cpm, cpc, ad_order_share')
          .gte('metric_date', extFrom!).lte('metric_date', extTo!),
        supabase,
      )
    : []

  // Предыдущий период — отдельный запрос
  const prevDailyRows = prevFrom && prevTo
    ? await fetchAll<DailyRow>(
        (sb) => sb.from('fact_sku_daily')
          .select('sku_ms, metric_date, revenue, ad_spend, ctr, cr_cart, cr_order, cpm, cpc, ad_order_share')
          .gte('metric_date', prevFrom!).lte('metric_date', prevTo!),
        supabase,
      )
    : []

  // Строки только за текущий период (для агрегации KPI и графиков)
  const currDailyRows = fromDaily && toDaily
    ? dailyRows.filter(r => r.metric_date >= fromDaily! && r.metric_date <= toDaily!)
    : []

  // Индекс daily по (sku_ms, metric_date) для быстрого поиска при расчёте дельт цен
  type DayKey = string // `${sku_ms}|${metric_date}`
  const dailyIndex: Record<DayKey, DailyRow> = {}
  for (const r of dailyRows) {
    dailyIndex[`${r.sku_ms}|${r.metric_date}`] = r
  }

  function avgWindow(sku_ms: string, fromDate: string, toDate: string, field: keyof DailyRow): number | null {
    const vals: number[] = []
    // iterate days
    const start = new Date(fromDate)
    const end = new Date(toDate)
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const key = `${sku_ms}|${d.toISOString().split('T')[0]}`
      const row = dailyIndex[key]
      const v = row ? (row[field] as number | null) : null
      if (v != null) vals.push(v)
    }
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null
  }

  function avgRows(rows: DailyRow[], field: keyof DailyRow): number {
    const vals = rows.map(r => r[field] as number | null).filter((v): v is number => v != null)
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0
  }

  // Агрегация KPI текущего периода
  let totalRevenue = 0
  let totalAdSpend = 0
  const ctrArr: number[] = []
  const crCartArr: number[] = []
  const crOrderArr: number[] = []
  const cpmArr: number[] = []
  const cpcArr: number[] = []
  const adOrderArr: number[] = []

  type DayAgg = {
    ctrSum: number; ctrN: number
    crCartSum: number; crCartN: number
    crOrderSum: number; crOrderN: number
    adShareSum: number; adShareN: number
    revenue: number
  }
  const dateMap: Record<string, DayAgg> = {}

  for (const r of currDailyRows) {
    totalRevenue += r.revenue ?? 0
    totalAdSpend += r.ad_spend ?? 0
    if (r.ctr != null) ctrArr.push(r.ctr)
    if (r.cr_cart != null) crCartArr.push(r.cr_cart)
    if (r.cr_order != null) crOrderArr.push(r.cr_order)
    if (r.cpm != null) cpmArr.push(r.cpm)
    if (r.cpc != null) cpcArr.push(r.cpc)
    if (r.ad_order_share != null) adOrderArr.push(r.ad_order_share)

    const d = r.metric_date
    if (!dateMap[d]) dateMap[d] = { ctrSum: 0, ctrN: 0, crCartSum: 0, crCartN: 0, crOrderSum: 0, crOrderN: 0, adShareSum: 0, adShareN: 0, revenue: 0 }
    const day = dateMap[d]
    day.revenue += r.revenue ?? 0
    if (r.ctr != null) { day.ctrSum += r.ctr; day.ctrN++ }
    if (r.cr_cart != null) { day.crCartSum += r.cr_cart; day.crCartN++ }
    if (r.cr_order != null) { day.crOrderSum += r.cr_order; day.crOrderN++ }
    if (r.ad_order_share != null) { day.adShareSum += r.ad_order_share; day.adShareN++ }
  }

  const avg = (arr: number[]) => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0

  const drr = totalRevenue > 0 ? totalAdSpend / totalRevenue : 0
  // CPO ≈ avg_cpc / avg_cr_order (цена клика / вероятность заказа)
  const avgCpc = avg(cpcArr)
  const avgCrOrder = avg(crOrderArr)
  const cpo = avgCrOrder > 0 ? avgCpc / avgCrOrder : 0

  const funnel = {
    ctr: avg(ctrArr),
    cr_basket: avg(crCartArr),
    cr_order: avgCrOrder,
    cpc: avgCpc,
    cpm: avg(cpmArr),
    ad_order_share: avg(adOrderArr),
    drr,
    cpo,
  }

  // Агрегация предыдущего периода
  const prevCpcArr: number[] = []
  const prevCrOrderArr: number[] = []
  let prevTotalRevenue = 0
  let prevTotalAdSpend = 0
  for (const r of prevDailyRows) {
    prevTotalRevenue += r.revenue ?? 0
    prevTotalAdSpend += r.ad_spend ?? 0
    if (r.cpc != null) prevCpcArr.push(r.cpc)
    if (r.cr_order != null) prevCrOrderArr.push(r.cr_order)
  }
  const prevAvgCpc = avg(prevCpcArr)
  const prevAvgCrOrder = avg(prevCrOrderArr)
  const prevDrr = prevTotalRevenue > 0 ? prevTotalAdSpend / prevTotalRevenue : 0
  const prevCpo = prevAvgCrOrder > 0 ? prevAvgCpc / prevAvgCrOrder : 0

  const prev_funnel = {
    ctr: avgRows(prevDailyRows, 'ctr'),
    cr_basket: avgRows(prevDailyRows, 'cr_cart'),
    cr_order: prevAvgCrOrder,
    cpc: prevAvgCpc,
    cpm: avgRows(prevDailyRows, 'cpm'),
    ad_order_share: avgRows(prevDailyRows, 'ad_order_share'),
    drr: prevDrr,
    cpo: prevCpo,
  }

  // daily chart — CTR/CR по дням + ad_revenue/organic split
  const daily = Object.entries(dateMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, d]) => {
      const adShare = d.adShareN > 0 ? d.adShareSum / d.adShareN : 0
      return {
        date,
        ctr: d.ctrN > 0 ? d.ctrSum / d.ctrN : 0,
        cr_basket: d.crCartN > 0 ? d.crCartSum / d.crCartN : 0,
        cr_order: d.crOrderN > 0 ? d.crOrderSum / d.crOrderN : 0,
        ad_revenue: Math.round(d.revenue * adShare),
        organic_revenue: Math.round(d.revenue * (1 - adShare)),
      }
    })

  // Price changes with manager + delta metrics
  const bySkuWb: Record<number, Array<{ date: string; price: number | null; sku_ms: string | null }>> = {}
  for (const r of priceRows) {
    if (!r.sku_wb) continue
    if (!bySkuWb[r.sku_wb]) bySkuWb[r.sku_wb] = []
    bySkuWb[r.sku_wb].push({ date: r.price_date, price: r.price, sku_ms: r.sku_ms })
  }

  const WINDOW = 7 // дней до/после изменения цены

  const changes: Array<{
    sku: string; name: string; manager: string
    date: string; price_before: number; price_after: number; delta_pct: number
    delta_ctr?: number; delta_cr_basket?: number; delta_cr_order?: number
    cpo?: number; delta_cpm?: number; delta_cpc?: number
  }> = []

  for (const [skuWbStr, entries] of Object.entries(bySkuWb)) {
    const skuWb = Number(skuWbStr)
    const sorted = [...entries].sort((a, b) => b.date.localeCompare(a.date))
    const skuMs = sorted[0]?.sku_ms ?? null
    const dim = skuMs ? nameMap[skuMs] : null

    for (let i = 0; i < sorted.length; i++) {
      const cur = sorted[i]
      const prev = sorted[i + 1] ?? null
      const delta = prev?.price && cur.price
        ? (cur.price - prev.price) / prev.price
        : 0
      if (prev || i === 0) {
        // Δ метрик: окно до и после changeDate
        let delta_ctr: number | undefined
        let delta_cr_basket: number | undefined
        let delta_cr_order: number | undefined
        let delta_cpm: number | undefined
        let delta_cpc: number | undefined
        let change_cpo: number | undefined

        if (skuMs) {
          const beforeFrom = shiftDate(cur.date, -WINDOW)
          const beforeTo = shiftDate(cur.date, -1)
          const afterFrom = cur.date
          const afterTo = shiftDate(cur.date, WINDOW)

          const ctrBefore = avgWindow(skuMs, beforeFrom, beforeTo, 'ctr')
          const ctrAfter = avgWindow(skuMs, afterFrom, afterTo, 'ctr')
          if (ctrBefore != null && ctrAfter != null) delta_ctr = ctrAfter - ctrBefore

          const crCartBefore = avgWindow(skuMs, beforeFrom, beforeTo, 'cr_cart')
          const crCartAfter = avgWindow(skuMs, afterFrom, afterTo, 'cr_cart')
          if (crCartBefore != null && crCartAfter != null) delta_cr_basket = crCartAfter - crCartBefore

          const crOrderBefore = avgWindow(skuMs, beforeFrom, beforeTo, 'cr_order')
          const crOrderAfter = avgWindow(skuMs, afterFrom, afterTo, 'cr_order')
          if (crOrderBefore != null && crOrderAfter != null) delta_cr_order = crOrderAfter - crOrderBefore

          const cpmBefore = avgWindow(skuMs, beforeFrom, beforeTo, 'cpm')
          const cpmAfter = avgWindow(skuMs, afterFrom, afterTo, 'cpm')
          if (cpmBefore != null && cpmAfter != null) delta_cpm = cpmAfter - cpmBefore

          const cpcBefore = avgWindow(skuMs, beforeFrom, beforeTo, 'cpc')
          const cpcAfter = avgWindow(skuMs, afterFrom, afterTo, 'cpc')
          if (cpcBefore != null && cpcAfter != null) delta_cpc = cpcAfter - cpcBefore

          if (cpcAfter != null && crOrderAfter != null && crOrderAfter > 0) {
            change_cpo = cpcAfter / crOrderAfter
          }
        }

        changes.push({
          sku: String(skuWb),
          name: dim?.name ?? skuMs ?? '',
          manager: (skuMs ? managerMap[skuMs] : '') ?? '',
          date: cur.date,
          price_before: prev?.price ?? cur.price ?? 0,
          price_after: cur.price ?? 0,
          delta_pct: delta,
          delta_ctr,
          delta_cr_basket,
          delta_cr_order,
          cpo: change_cpo,
          delta_cpm,
          delta_cpc,
        })
      }
    }
  }

  changes.sort((a, b) => b.date.localeCompare(a.date))

  // Manager table — агрегация по менеджерам из currDailyRows
  // Сначала нужен managerMap расширенный на все sku_ms из dailyRows
  const allSkuMs = [...new Set(currDailyRows.map(r => r.sku_ms).filter(Boolean))]
  const missingSkus = allSkuMs.filter(s => !managerMap[s])
  if (skuReportId && missingSkus.length) {
    for (let i = 0; i < missingSkus.length; i += 500) {
      const { data: snapRows } = await supabase
        .from('fact_sku_snapshot').select('sku_ms, manager')
        .eq('upload_id', skuReportId)
        .in('sku_ms', missingSkus.slice(i, i + 500))
      if (snapRows) for (const r of snapRows) managerMap[r.sku_ms] = r.manager ?? ''
    }
  }

  type MgrAgg = {
    ctrSum: number; ctrN: number
    crOrderSum: number; crOrderN: number
    adShareSum: number; adShareN: number
    revenue: number
    skus: Set<string>
  }
  const mgrAgg: Record<string, MgrAgg> = {}

  for (const r of currDailyRows) {
    const mgr = managerMap[r.sku_ms] || 'Без менеджера'
    if (!mgrAgg[mgr]) mgrAgg[mgr] = { ctrSum: 0, ctrN: 0, crOrderSum: 0, crOrderN: 0, adShareSum: 0, adShareN: 0, revenue: 0, skus: new Set() }
    const m = mgrAgg[mgr]
    m.revenue += r.revenue ?? 0
    m.skus.add(r.sku_ms)
    if (r.ctr != null) { m.ctrSum += r.ctr; m.ctrN++ }
    if (r.cr_order != null) { m.crOrderSum += r.cr_order; m.crOrderN++ }
    if (r.ad_order_share != null) { m.adShareSum += r.ad_order_share; m.adShareN++ }
  }

  const manager_table = Object.entries(mgrAgg)
    .map(([manager, m]) => ({
      manager,
      ctr: m.ctrN ? m.ctrSum / m.ctrN : 0,
      cr_order: m.crOrderN ? m.crOrderSum / m.crOrderN : 0,
      ad_order_share: m.adShareN ? m.adShareSum / m.adShareN : 0,
      revenue: m.revenue,
      sku_count: m.skus.size,
    }))
    .sort((a, b) => b.revenue - a.revenue)

  return NextResponse.json({ funnel, prev_funnel, daily, price_changes: changes, manager_table })
}
