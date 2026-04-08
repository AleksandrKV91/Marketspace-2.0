import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/supabase/fetchAll'

export const maxDuration = 60

export async function GET(req: Request) {
  const supabase = createServiceClient()
  const url = new URL(req.url)
  const fromParam = url.searchParams.get('from')
  const toParam = url.searchParams.get('to')

  // Latest upload IDs
  const { data: lastUploads } = await supabase
    .from('uploads')
    .select('id, file_type')
    .eq('status', 'ok')
    .order('uploaded_at', { ascending: false })
    .limit(20)

  const latestByType: Record<string, string> = {}
  if (lastUploads) {
    for (const u of lastUploads) {
      if (!latestByType[u.file_type]) latestByType[u.file_type] = u.id
    }
  }

  const stockId = latestByType['stock']
  const abcId = latestByType['abc']
  const skuReportId = latestByType['sku_report']

  // dim_sku for category/manager mapping — все строки
  const dimRows = await fetchAll<{ sku_ms: string; sku_wb: number | null; name: string | null; category_wb: string | null; subject_wb: string | null }>(
    (sb) => sb.from('dim_sku').select('sku_ms, sku_wb, name, category_wb, subject_wb'),
    supabase,
  )

  const dimByMs: Record<string, { sku_wb: number | null; name: string | null; category_wb: string | null; subject_wb: string | null }> = {}
  const dimByWb: Record<number, { sku_ms: string }> = {}
  for (const r of dimRows) {
    dimByMs[r.sku_ms] = r
    if (r.sku_wb) dimByWb[r.sku_wb] = { sku_ms: r.sku_ms }
  }

  // Stock snapshot (Таблица остатков)
  const stockAgg = { total_fbo: 0, total_fbs: 0, total_stock: 0, sku_count: 0 }
  const stockByWb: Record<number, { fbo_wb: number; fbs_pushkino: number; fbs_smolensk: number; total_stock: number; price: number | null; margin_pct: number | null }> = {}
  if (stockId) {
    const { data: stockRows } = await supabase
      .from('fact_stock_snapshot')
      .select('sku_wb, fbo_wb, fbs_pushkino, fbs_smolensk, total_stock, price, margin_pct')
      .eq('upload_id', stockId)
    if (stockRows) {
      for (const r of stockRows) {
        stockByWb[r.sku_wb] = r
        stockAgg.total_fbo += r.fbo_wb ?? 0
        stockAgg.total_fbs += (r.fbs_pushkino ?? 0) + (r.fbs_smolensk ?? 0)
        stockAgg.total_stock += r.total_stock ?? 0
        if ((r.total_stock ?? 0) > 0) stockAgg.sku_count++
      }
    }
  }

  // ABC — only for abc_class counts
  const abcCounts = { A: 0, B: 0, C: 0 }
  const abcClassByMs: Record<string, string | null> = {}
  if (abcId) {
    const { data: abcRows } = await supabase
      .from('fact_abc')
      .select('sku_ms, abc_class')
      .eq('upload_id', abcId)
    if (abcRows) {
      for (const r of abcRows) {
        abcClassByMs[r.sku_ms] = r.abc_class
        const cls = (r.abc_class ?? '').toUpperCase().charAt(0)
        if (cls === 'A') abcCounts.A++
        else if (cls === 'B') abcCounts.B++
        else if (cls === 'C') abcCounts.C++
      }
    }
  }

  // fact_sku_snapshot — margin_rub (col X), chmd_5d (col Z), manager
  const snapByMs: Record<string, { margin_rub: number | null; chmd_5d: number | null; manager: string | null; price: number | null; ad_spend: number | null }> = {}
  if (skuReportId) {
    const { data: snapRows } = await supabase
      .from('fact_sku_snapshot')
      .select('sku_ms, margin_rub, chmd_5d, manager, price, ad_spend')
      .eq('upload_id', skuReportId)
    if (snapRows) {
      for (const r of snapRows) snapByMs[r.sku_ms] = r
    }
  }

  // fact_sku_daily — revenue, ad_spend, drr by period (primary source)
  let dailyQ = supabase
    .from('fact_sku_daily')
    .select('sku_ms, metric_date, revenue, ad_spend')

  if (fromParam && toParam) {
    dailyQ = dailyQ.gte('metric_date', fromParam).lte('metric_date', toParam)
  } else {
    // last 30 days based on latest date available
    const { data: maxDateRow } = await supabase
      .from('fact_sku_daily')
      .select('metric_date')
      .order('metric_date', { ascending: false })
      .limit(1)
    const maxDate = maxDateRow?.[0]?.metric_date ?? null
    if (maxDate) {
      const from30 = new Date(maxDate)
      from30.setDate(from30.getDate() - 29)
      dailyQ = dailyQ.gte('metric_date', from30.toISOString().split('T')[0]).lte('metric_date', maxDate)
    }
  }

  const dailyRows = await fetchAll<{ sku_ms: string; metric_date: string; revenue: number | null; ad_spend: number | null }>(
    () => dailyQ, supabase,
  )

  // Aggregate by sku_ms and by date
  const skuAgg: Record<string, { revenue: number; ad_spend: number }> = {}
  const dateAgg: Record<string, { revenue: number; ad_spend: number }> = {}

  for (const r of dailyRows) {
    if (!skuAgg[r.sku_ms]) skuAgg[r.sku_ms] = { revenue: 0, ad_spend: 0 }
    skuAgg[r.sku_ms].revenue += r.revenue ?? 0
    skuAgg[r.sku_ms].ad_spend += r.ad_spend ?? 0

    if (!dateAgg[r.metric_date]) dateAgg[r.metric_date] = { revenue: 0, ad_spend: 0 }
    dateAgg[r.metric_date].revenue += r.revenue ?? 0
    dateAgg[r.metric_date].ad_spend += r.ad_spend ?? 0
  }

  const latestDate = Object.keys(dateAgg).sort().at(-1) ?? null

  // Trend from fact_sku_daily by date (revenue ₽)
  const trend = Object.entries(dateAgg)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, d]) => ({ date, sales_qty: d.revenue, revenue: d.revenue }))

  // Totals
  let totalRevenue = 0
  let totalAdSpend = 0
  for (const agg of Object.values(skuAgg)) {
    totalRevenue += agg.revenue
    totalAdSpend += agg.ad_spend
  }

  // ЧМД: sum chmd_5d from fact_sku_snapshot (best available proxy)
  let totalChmd = 0
  for (const snap of Object.values(snapByMs)) {
    totalChmd += snap.chmd_5d ?? 0
  }

  // Avg margin: weighted by revenue from fact_sku_snapshot (margin_rub / price)
  let weightedMarginNum = 0
  let weightedMarginDen = 0
  for (const [skuMs, snap] of Object.entries(snapByMs)) {
    const rev = skuAgg[skuMs]?.revenue ?? 0
    if (snap.margin_rub != null && snap.price && snap.price > 0 && rev > 0) {
      const pct = snap.margin_rub / snap.price
      weightedMarginNum += pct * rev
      weightedMarginDen += rev
    }
  }
  const avgMargin = weightedMarginDen > 0 ? weightedMarginNum / weightedMarginDen : 0

  // OOS count
  const oosCount = Object.values(stockByWb).filter(s => (s.total_stock ?? 0) === 0).length

  // Category breakdown from fact_sku_daily
  const catMap: Record<string, { revenue: number; chmd: number; sku_count: Set<string> }> = {}
  for (const [skuMs, agg] of Object.entries(skuAgg)) {
    const dim = dimByMs[skuMs]
    const cat = dim?.category_wb ?? dim?.subject_wb ?? 'Без категории'
    if (!catMap[cat]) catMap[cat] = { revenue: 0, chmd: 0, sku_count: new Set() }
    catMap[cat].revenue += agg.revenue
    catMap[cat].sku_count.add(skuMs)
    const snap = snapByMs[skuMs]
    if (snap?.chmd_5d) catMap[cat].chmd += snap.chmd_5d
  }
  const categories = Object.entries(catMap)
    .map(([cat, v]) => ({ category: cat, revenue: v.revenue, chmd: v.chmd, sku_count: v.sku_count.size }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 8)

  // Manager breakdown from fact_sku_snapshot + daily
  const managerMap: Record<string, { revenue: number; chmd: number; sku_count: Set<string> }> = {}
  for (const [skuMs, agg] of Object.entries(skuAgg)) {
    const snap = snapByMs[skuMs]
    const manager = snap?.manager ?? 'Не указан'
    if (!managerMap[manager]) managerMap[manager] = { revenue: 0, chmd: 0, sku_count: new Set() }
    managerMap[manager].revenue += agg.revenue
    managerMap[manager].sku_count.add(skuMs)
    if (snap?.chmd_5d) managerMap[manager].chmd += snap.chmd_5d
  }
  const managers = Object.entries(managerMap)
    .map(([manager, v]) => ({
      manager,
      revenue: v.revenue,
      chmd: v.chmd,
      sku_count: v.sku_count.size,
      margin_pct: v.revenue > 0 ? v.chmd / v.revenue : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue)

  // Top-15 SKU by revenue
  const top15 = Object.entries(skuAgg)
    .map(([skuMs, agg]) => {
      const dim = dimByMs[skuMs]
      const snap = snapByMs[skuMs]
      const stock = dim?.sku_wb ? stockByWb[dim.sku_wb] : null
      const price = snap?.price ?? stock?.price ?? null
      const marginRub = snap?.margin_rub ?? null
      const marginPct = marginRub != null && price && price > 0 ? marginRub / price : (stock?.margin_pct ?? 0)
      return {
        sku_ms: skuMs,
        sku_wb: dim?.sku_wb ?? null,
        name: dim?.name ?? skuMs,
        revenue: agg.revenue,
        margin_pct: marginPct,
        stock_days: 0,
        abc_class: abcClassByMs[skuMs] ?? '—',
      }
    })
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 15)

  return NextResponse.json({
    kpi: {
      revenue: totalRevenue,
      chmd: totalChmd,
      avg_margin_pct: avgMargin,
      drr: totalRevenue > 0 ? totalAdSpend / totalRevenue : null,
      oos_count: oosCount,
      sku_count: dimRows?.length ?? 0,
    },
    stock: stockAgg,
    abc: abcCounts,
    top15,
    trend,
    categories,
    managers,
    latest_date: latestDate,
  })
}
