import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/supabase/fetchAll'
import { cached } from '@/lib/cache'

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
  try {
  const supabase = createServiceClient()
  const { searchParams } = new URL(req.url)
  const search = searchParams.get('search') ?? ''
  const fromParam = searchParams.get('from')
  const toParam = searchParams.get('to')
  const categoryFilter = searchParams.get('category') ?? ''
  const managerFilter  = searchParams.get('manager') ?? ''
  const noveltyFilter  = searchParams.get('novelty') ?? ''

  // Latest upload IDs (TTL 60s)
  const latestByType = await cached('latest_uploads', 60_000, async () => {
    const { data: lastUploads } = await supabase
      .from('uploads').select('id, file_type')
      .eq('status', 'ok').order('uploaded_at', { ascending: false }).limit(20)
    const result: Record<string, string> = {}
    if (lastUploads) for (const u of lastUploads) {
      if (!result[u.file_type]) result[u.file_type] = u.id
    }
    return result
  })
  const skuReportId = latestByType['sku_report']

  // Параллельно: snapshot + dim_sku (cached)
  type SnapRow = { sku_ms: string; sku_wb: number | null; manager: string | null; price: number | null; novelty_status: string | null }
  type DimNameRow = { sku_ms: string; name: string | null; brand: string | null; subject_wb: string | null; category_wb: string | null }

  async function fetchSnapshot(): Promise<SnapRow[]> {
    // Берём снапшот из fact_sku_period по последнему period_end
    const { data: maxSnapRow } = await supabase.from('fact_sku_period')
      .select('period_end')
      .order('period_end', { ascending: false }).limit(1)
    const maxSnapDate = maxSnapRow?.[0]?.period_end
    if (!maxSnapDate) return []
    const rows: SnapRow[] = []
    let snapOffset = 0
    const snapPageSize = 1000
    while (true) {
      const { data, error } = await supabase
        .from('fact_sku_period')
        .select('sku_ms, sku_wb, manager, price, novelty_status')
        .eq('period_end', maxSnapDate)
        .range(snapOffset, snapOffset + snapPageSize - 1)
      if (error || !data || data.length === 0) break
      rows.push(...data)
      if (data.length < snapPageSize) break
      snapOffset += snapPageSize
    }
    return rows
  }

  const [allSnapRows, allDimRows] = await Promise.all([
    fetchSnapshot(),
    cached<DimNameRow[]>('dim_sku_names', 10 * 60_000, async () =>
      fetchAll<DimNameRow>(
        (sb) => sb.from('dim_sku').select('sku_ms, name, brand, subject_wb, category_wb'),
        supabase,
      )
    ),
  ])

  const managerMap: Record<string, string> = {}
  const noveltyMap: Record<string, string> = {}
  const snapPriceMap: Record<string, number> = {}
  const snapSkuWbMap: Record<string, number> = {}
  for (const r of allSnapRows) {
    managerMap[r.sku_ms] = r.manager ?? ''
    noveltyMap[r.sku_ms] = r.novelty_status ?? ''
    if (r.price != null) snapPriceMap[r.sku_ms] = r.price
    if (r.sku_wb != null) snapSkuWbMap[r.sku_ms] = r.sku_wb
  }

  const nameMap: Record<string, DimNameRow> = {}
  for (const r of allDimRows) nameMap[r.sku_ms] = r

  // fact_price_changes — история цен
  // Берём записи с запасом: от (from - 14 дней) чтобы иметь "предыдущую" цену перед периодом
  type PriceRow = { sku_wb: number | null; sku_ms: string | null; price_date: string; price: number | null }
  const priceFrom = fromParam ? shiftDate(fromParam, -14) : null
  const priceRows: PriceRow[] = []
  {
    let offset = 0
    const pageSize = 1000
    while (true) {
      let q = supabase
        .from('fact_price_changes')
        .select('sku_wb, sku_ms, price_date, price')
        .order('price_date', { ascending: true })
        .range(offset, offset + pageSize - 1)
      if (priceFrom) q = q.gte('price_date', priceFrom)
      if (toParam) q = q.lte('price_date', toParam)
      const { data, error } = await q
      if (error || !data || data.length === 0) break
      priceRows.push(...data)
      if (data.length < pageSize) break
      offset += pageSize
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

  // Build allowed sku_ms set when global filters are active
  let allowedSkuMs: Set<string> | null = null
  if (categoryFilter || managerFilter || noveltyFilter) {
    allowedSkuMs = new Set<string>()
    const allSkuMs = new Set([...Object.keys(managerMap), ...Object.keys(nameMap)])
    for (const ms of allSkuMs) {
      const meetsManager  = !managerFilter  || (managerMap[ms] ?? '') === managerFilter
      const meetsCategory = !categoryFilter || (nameMap[ms]?.category_wb ?? '') === categoryFilter
      const ns = noveltyMap[ms] ?? ''
      const meetsNovelty  = !noveltyFilter  ||
        (noveltyFilter === 'Новинки' && ns === 'Новинки') ||
        (noveltyFilter === 'Не новинки' && ns !== 'Новинки')
      if (meetsManager && meetsCategory && meetsNovelty) allowedSkuMs.add(ms)
    }
  }

  // Строки только за текущий период (для агрегации KPI и графиков)
  const currDailyRows = fromDaily && toDaily
    ? dailyRows.filter(r =>
        r.metric_date >= fromDaily! && r.metric_date <= toDaily! &&
        (!allowedSkuMs || allowedSkuMs.has(r.sku_ms))
      )
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

  // Средневзвешенная цена по дням — для каждого дня берём последнюю известную цену
  // каждого SKU на эту дату, взвешиваем по выручке
  // Сначала строим "последнюю цену SKU на дату" из priceRows
  const skuWbPriceHistory: Record<number, Array<{ date: string; price: number }>> = {}
  for (const r of priceRows) {
    if (!r.sku_wb || r.price == null) continue
    if (!skuWbPriceHistory[r.sku_wb]) skuWbPriceHistory[r.sku_wb] = []
    skuWbPriceHistory[r.sku_wb].push({ date: r.price_date, price: r.price })
  }
  for (const arr of Object.values(skuWbPriceHistory)) arr.sort((a, b) => a.date.localeCompare(b.date))

  function getPriceOnDate(skuWb: number, date: string): number | null {
    const hist = skuWbPriceHistory[skuWb]
    if (!hist || hist.length === 0) return null
    // последняя запись <= date
    let last: number | null = null
    for (const h of hist) {
      if (h.date <= date) last = h.price
      else break
    }
    return last
  }

  // daily chart — CTR/CR по дням + ad_revenue/organic split + средневзв. цена
  const daily = Object.entries(dateMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, d]) => {
      const adShare = d.adShareN > 0 ? d.adShareSum / d.adShareN : 0
      // Средневзвешенная цена: Σ(price_i × revenue_i) / Σrevenue_i
      let priceWeightedSum = 0
      let priceWeightTotal = 0
      for (const r of currDailyRows) {
        if (r.metric_date !== date) continue
        const skuWb = snapSkuWbMap[r.sku_ms]
        if (!skuWb) continue
        const price = getPriceOnDate(skuWb, date)
        if (price != null && r.revenue) {
          priceWeightedSum += price * r.revenue
          priceWeightTotal += r.revenue
        }
      }
      const avg_price = priceWeightTotal > 0 ? Math.round(priceWeightedSum / priceWeightTotal) : null
      return {
        date,
        ctr: d.ctrN > 0 ? d.ctrSum / d.ctrN : 0,
        cr_basket: d.crCartN > 0 ? d.crCartSum / d.crCartN : 0,
        cr_order: d.crOrderN > 0 ? d.crOrderSum / d.crOrderN : 0,
        ad_revenue: Math.round(d.revenue * adShare),
        organic_revenue: Math.round(d.revenue * (1 - adShare)),
        avg_price,
      }
    })

  // Построить историю цен по sku_wb: Map<sku_wb → sorted entries asc>
  const bySkuWb: Record<number, Array<{ date: string; price: number | null; sku_ms: string | null }>> = {}
  for (const r of priceRows) {
    if (!r.sku_wb) continue
    if (!bySkuWb[r.sku_wb]) bySkuWb[r.sku_wb] = []
    bySkuWb[r.sku_wb].push({ date: r.price_date, price: r.price, sku_ms: r.sku_ms })
  }
  // Отсортировать каждую историю по дате возрастания
  for (const entries of Object.values(bySkuWb)) {
    entries.sort((a, b) => a.date.localeCompare(b.date))
  }

  const WINDOW = 7 // дней до/после изменения цены

  // Для каждого sku_wb найти изменения цен, которые попали в выбранный период
  // "Изменение" = entry[i].price !== entry[i-1].price
  // Для строк без изменений — берём последнюю цену до/на конец периода
  const periodFrom = fromParam ?? ''
  const periodTo = toParam ?? ''

  type ChangeRow = {
    sku: string; name: string; manager: string
    date: string; price_before: number; price_after: number; delta_pct: number
    has_change: boolean  // true = реальное изменение цены в периоде
    delta_ctr?: number; delta_cr_basket?: number; delta_cr_order?: number
    cpo?: number; delta_cpm?: number; delta_cpc?: number
    ad_spend_before?: number; ad_spend_after?: number; delta_ad_spend?: number
  }
  const changes: ChangeRow[] = []

  // Карта sku_wb → sku_ms из priceRows (берём первое вхождение)
  const skuWbToSkuMs: Record<number, string> = {}
  for (const r of priceRows) {
    if (r.sku_wb && r.sku_ms && !skuWbToSkuMs[r.sku_wb]) skuWbToSkuMs[r.sku_wb] = r.sku_ms
  }

  // Обработать SKU у которых есть история цен
  const processedSkuMs = new Set<string>()

  for (const [skuWbStr, entries] of Object.entries(bySkuWb)) {
    const skuWb = Number(skuWbStr)
    const skuMs = skuWbToSkuMs[skuWb] ?? null
    if (skuMs) processedSkuMs.add(skuMs)
    const dim = skuMs ? nameMap[skuMs] : null
    const manager = skuMs ? (managerMap[skuMs] ?? '') : ''

    // Найти изменения цен внутри периода
    let foundChangeInPeriod = false
    for (let i = 1; i < entries.length; i++) {
      const cur = entries[i]
      const prev = entries[i - 1]
      // Изменение: цена реально изменилась и дата попадает в период
      if (cur.price !== prev.price && cur.date >= periodFrom && cur.date <= periodTo) {
        foundChangeInPeriod = true
        const delta = prev.price && cur.price ? (cur.price - prev.price) / prev.price : 0

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

        let ad_spend_before: number | undefined
        let ad_spend_after: number | undefined
        let delta_ad_spend: number | undefined
        if (skuMs) {
          const beforeFrom = shiftDate(cur.date, -WINDOW)
          const beforeTo = shiftDate(cur.date, -1)
          const afterFrom = cur.date
          const afterTo = shiftDate(cur.date, WINDOW)
          const spBefore = avgWindow(skuMs, beforeFrom, beforeTo, 'ad_spend')
          const spAfter = avgWindow(skuMs, afterFrom, afterTo, 'ad_spend')
          if (spBefore != null) ad_spend_before = Math.round(spBefore * WINDOW)
          if (spAfter != null) ad_spend_after = Math.round(spAfter * WINDOW)
          if (ad_spend_before != null && ad_spend_after != null) delta_ad_spend = ad_spend_after - ad_spend_before
        }

        // price_before: prefer previous history entry; fallback to snapshot price
        const priceBefore = prev.price ?? (skuMs ? (snapPriceMap[skuMs] ?? 0) : 0)
        const priceAfter = cur.price ?? 0
        const deltaFixed = priceBefore > 0 && priceAfter > 0 ? (priceAfter - priceBefore) / priceBefore : delta

        changes.push({
          sku: String(skuWb),
          name: dim?.name ?? skuMs ?? '',
          manager,
          date: cur.date,
          price_before: priceBefore,
          price_after: priceAfter,
          delta_pct: deltaFixed,
          has_change: true,
          delta_ctr,
          delta_cr_basket,
          delta_cr_order,
          cpo: change_cpo,
          delta_cpm,
          delta_cpc,
          ad_spend_before,
          ad_spend_after,
          delta_ad_spend,
        })
      }
    }

    // Если в периоде не было изменений — добавить строку с текущей ценой (без дельты)
    if (!foundChangeInPeriod) {
      const lastEntry = entries.filter(e => e.date <= periodTo).slice(-1)[0]
        ?? entries[entries.length - 1]
      if (lastEntry) {
        const currentPrice = lastEntry.price ?? (skuMs ? snapPriceMap[skuMs] ?? 0 : 0)
        changes.push({
          sku: String(skuWb),
          name: dim?.name ?? skuMs ?? '',
          manager,
          date: lastEntry.date,
          price_before: currentPrice,
          price_after: currentPrice,
          delta_pct: 0,
          has_change: false,
        })
      }
    }
  }

  // Добавить SKU из снапшота, которых вообще нет в fact_price_changes
  for (const snap of allSnapRows) {
    if (processedSkuMs.has(snap.sku_ms)) continue
    const dim = nameMap[snap.sku_ms]
    const skuWb = snap.sku_wb ?? snapSkuWbMap[snap.sku_ms]
    changes.push({
      sku: skuWb ? String(skuWb) : snap.sku_ms,
      name: dim?.name ?? snap.sku_ms,
      manager: managerMap[snap.sku_ms] ?? '',
      date: '',
      price_before: snap.price ?? 0,
      price_after: snap.price ?? 0,
      delta_pct: 0,
      has_change: false,
    })
  }

  // Сортировка: сначала строки с изменением (по дате desc), потом без изменений
  changes.sort((a, b) => {
    if (a.has_change && !b.has_change) return -1
    if (!a.has_change && b.has_change) return 1
    return b.date.localeCompare(a.date)
  })

  // Manager table — агрегация по менеджерам из currDailyRows
  // managerMap уже полностью заполнен из полного снапшота выше

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
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[prices] ERROR:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
