import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export const maxDuration = 30

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

  // Price changes
  let query = supabase
    .from('fact_price_changes')
    .select('sku_wb, sku_ms, price_date, price')
    .order('price_date', { ascending: false })
    .limit(2000)
  if (fromParam) query = query.gte('price_date', fromParam)
  if (toParam) query = query.lte('price_date', toParam)
  if (search) query = query.or(`sku_ms.ilike.%${search}%`)

  const { data: priceRows, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // dim_sku for names and managers
  const skuMsList = [...new Set((priceRows ?? []).map(r => r.sku_ms).filter(Boolean))]
  const nameMap: Record<string, { name: string | null; brand: string | null; subject_wb: string | null }> = {}
  if (skuMsList.length) {
    const { data: dimRows } = await supabase
      .from('dim_sku')
      .select('sku_ms, name, brand, subject_wb')
      .in('sku_ms', skuMsList.slice(0, 1000))
    if (dimRows) for (const r of dimRows) nameMap[r.sku_ms] = r
  }

  // fact_sku_snapshot — manager per sku_ms
  const managerMap: Record<string, string> = {}
  if (skuReportId && skuMsList.length) {
    const { data: snapRows } = await supabase
      .from('fact_sku_snapshot')
      .select('sku_ms, manager')
      .eq('upload_id', skuReportId)
      .in('sku_ms', skuMsList.slice(0, 1000))
    if (snapRows) for (const r of snapRows) managerMap[r.sku_ms] = r.manager ?? ''
  }

  // fact_sku_daily — funnel metrics aggregated over period (CTR/CR/CPM/CPC/ad_order_share)
  let dailyQ = supabase
    .from('fact_sku_daily')
    .select('sku_ms, metric_date, revenue, ad_spend, ctr, cr_cart, cr_order, cpm, cpc, ad_order_share')
  if (fromParam && toParam) {
    dailyQ = dailyQ.gte('metric_date', fromParam).lte('metric_date', toParam)
  } else if (skuMsList.length) {
    // last available dates
    const { data: maxDateRow } = await supabase
      .from('fact_sku_daily')
      .select('metric_date')
      .order('metric_date', { ascending: false })
      .limit(1)
    const maxDate = maxDateRow?.[0]?.metric_date ?? null
    if (maxDate) {
      const from7 = new Date(maxDate)
      from7.setDate(from7.getDate() - 6)
      dailyQ = dailyQ.gte('metric_date', from7.toISOString().split('T')[0]).lte('metric_date', maxDate)
    }
  }

  const { data: dailyRows } = await dailyQ

  // Aggregate funnel metrics
  const ctrArr: number[] = []
  const crCartArr: number[] = []
  const crOrderArr: number[] = []
  const cpmArr: number[] = []
  const cpcArr: number[] = []
  const adOrderArr: number[] = []
  let totalRevenue = 0
  let totalAdSpend = 0
  const dateRevenueMap: Record<string, number> = {}

  if (dailyRows) {
    for (const r of dailyRows) {
      totalRevenue += r.revenue ?? 0
      totalAdSpend += r.ad_spend ?? 0
      if (r.ctr != null) ctrArr.push(r.ctr)
      if (r.cr_cart != null) crCartArr.push(r.cr_cart)
      if (r.cr_order != null) crOrderArr.push(r.cr_order)
      if (r.cpm != null) cpmArr.push(r.cpm)
      if (r.cpc != null) cpcArr.push(r.cpc)
      if (r.ad_order_share != null) adOrderArr.push(r.ad_order_share)
      if (!dateRevenueMap[r.metric_date]) dateRevenueMap[r.metric_date] = 0
      dateRevenueMap[r.metric_date] += r.revenue ?? 0
    }
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

  // daily chart — revenue + drr by date
  const daily = Object.entries(dateRevenueMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, revenue]) => ({ date, revenue, drr: 0 }))

  // Price changes with manager
  const bySkuWb: Record<number, Array<{ date: string; price: number | null; sku_ms: string | null }>> = {}
  for (const r of priceRows ?? []) {
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
  const price_changes = changes.slice(0, 1000)

  return NextResponse.json({ funnel, daily, price_changes })
}
