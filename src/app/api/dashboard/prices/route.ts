import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/supabase/fetchAll'

export const maxDuration = 60

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

  // fact_sku_daily — funnel metrics aggregated over period (CTR/CR/CPM/CPC/ad_order_share)
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

  type DailyRow = { sku_ms: string; metric_date: string; revenue: number | null; ad_spend: number | null; ctr: number | null; cr_cart: number | null; cr_order: number | null; cpm: number | null; cpc: number | null; ad_order_share: number | null }
  const dailyRows = fromDaily && toDaily
    ? await fetchAll<DailyRow>(
        (sb) => sb.from('fact_sku_daily')
          .select('sku_ms, metric_date, revenue, ad_spend, ctr, cr_cart, cr_order, cpm, cpc, ad_order_share')
          .gte('metric_date', fromDaily!).lte('metric_date', toDaily!),
        supabase,
      )
    : []

  // Aggregate funnel metrics + per-date data
  const ctrArr: number[] = []
  const crCartArr: number[] = []
  const crOrderArr: number[] = []
  const cpmArr: number[] = []
  const cpcArr: number[] = []
  const adOrderArr: number[] = []
  let totalRevenue = 0
  let totalAdSpend = 0

  type DayAgg = {
    ctrSum: number; ctrN: number
    crCartSum: number; crCartN: number
    crOrderSum: number; crOrderN: number
    adShareSum: number; adShareN: number
    revenue: number
  }
  const dateMap: Record<string, DayAgg> = {}

  for (const r of dailyRows) {
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

  const funnel = {
    ctr: avg(ctrArr),
    cr_basket: avg(crCartArr),
    cr_order: avg(crOrderArr),
    cpc: avg(cpcArr),
    cpm: avg(cpmArr),
    ad_order_share: avg(adOrderArr),
    drr: totalRevenue > 0 ? totalAdSpend / totalRevenue : 0,
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

  // Price changes with manager
  const bySkuWb: Record<number, Array<{ date: string; price: number | null; sku_ms: string | null }>> = {}
  for (const r of priceRows) {
    if (!r.sku_wb) continue
    if (!bySkuWb[r.sku_wb]) bySkuWb[r.sku_wb] = []
    bySkuWb[r.sku_wb].push({ date: r.price_date, price: r.price, sku_ms: r.sku_ms })
  }

  const changes: Array<{
    sku: string; name: string; manager: string
    date: string; price_before: number; price_after: number; delta_pct: number
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
        changes.push({
          sku: String(skuWb),
          name: dim?.name ?? skuMs ?? '',
          manager: (skuMs ? managerMap[skuMs] : '') ?? '',
          date: cur.date,
          price_before: prev?.price ?? cur.price ?? 0,
          price_after: cur.price ?? 0,
          delta_pct: delta,
        })
      }
    }
  }

  changes.sort((a, b) => b.date.localeCompare(a.date))
  const price_changes = changes

  return NextResponse.json({ funnel, daily, price_changes })
}
