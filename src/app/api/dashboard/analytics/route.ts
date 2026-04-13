import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/supabase/fetchAll'

export const maxDuration = 60

function shiftRange(from: string, to: string) {
  const f = new Date(from), t = new Date(to)
  const days = Math.round((t.getTime() - f.getTime()) / 86400000) + 1
  const prevTo = new Date(f); prevTo.setDate(prevTo.getDate() - 1)
  const prevFrom = new Date(prevTo); prevFrom.setDate(prevFrom.getDate() - (days - 1))
  return {
    prevFrom: prevFrom.toISOString().split('T')[0],
    prevTo:   prevTo.toISOString().split('T')[0],
  }
}

export interface SkuNode {
  sku_ms: string
  sku_wb: number | null
  name: string
  revenue: number
  prev_revenue: number
  delta_pct: number | null
  chmd: number
  margin_pct: number
  drr: number
  stock_rub: number
  stock_qty: number
  stock_days: number | null
  forecast_30d_qty: number | null
  price: number
}

export interface SubjectNode {
  subject: string
  revenue: number
  prev_revenue: number
  delta_pct: number | null
  chmd: number
  margin_pct: number
  drr: number
  skus: SkuNode[]
}

export interface CategoryNode {
  category: string
  revenue: number
  prev_revenue: number
  delta_pct: number | null
  chmd: number
  margin_pct: number
  drr: number
  subjects: SubjectNode[]
}

export interface AnalyticsResponse {
  kpi: {
    revenue: number
    prev_revenue: number
    chmd: number
    prev_chmd: number
    margin_pct: number
    prev_margin_pct: number
    drr: number
    prev_drr: number
    cpo: number | null
    prev_cpo: number | null
    forecast_30d_revenue: number
    sku_count: number
    period_days: number
  }
  hierarchy: CategoryNode[]
  daily_chart: Array<{ date: string; revenue: number; chmd: number; ad_spend: number; drr: number; margin_pct: number }>
  daily_chart_prev: Array<{ day_index: number; date: string; revenue: number }>
  meta: { categories: string[]; managers: string[] }
}

function rollup(items: Array<{ revenue: number; prev_revenue: number; chmd: number; ad_spend: number; margin_pct_weighted: number }>) {
  const revenue = items.reduce((s, i) => s + i.revenue, 0)
  const prev_revenue = items.reduce((s, i) => s + i.prev_revenue, 0)
  const chmd = items.reduce((s, i) => s + i.chmd, 0)
  const ad_spend = items.reduce((s, i) => s + i.ad_spend, 0)
  // margin_pct_weighted = Σ(margin_pct × revenue) for each SKU — sum them up here
  const margin_pct_num = items.reduce((s, i) => s + i.margin_pct_weighted, 0)
  const delta_pct = prev_revenue > 0 ? (revenue - prev_revenue) / prev_revenue : null
  const margin_pct = revenue > 0 ? margin_pct_num / revenue : 0
  const drr = revenue > 0 ? ad_spend / revenue : 0
  return { revenue, prev_revenue, delta_pct, chmd, margin_pct, drr }
}

export async function GET(req: Request) {
  const supabase = createServiceClient()
  const url = new URL(req.url)
  const fromParam  = url.searchParams.get('from')
  const toParam    = url.searchParams.get('to')
  const catFilter  = url.searchParams.get('category') ?? ''
  const mgrFilter  = url.searchParams.get('manager') ?? ''
  const novFilter  = url.searchParams.get('novelty') ?? ''

  // ── 1. Latest uploads ────────────────────────────────────────────────────────
  const { data: lastUploads } = await supabase
    .from('uploads').select('id, file_type')
    .eq('status', 'ok').order('uploaded_at', { ascending: false }).limit(20)

  const latestByType: Record<string, string> = {}
  if (lastUploads) for (const u of lastUploads) {
    if (!latestByType[u.file_type]) latestByType[u.file_type] = u.id
  }

  const skuRepId = latestByType['sku_report']

  // ── 2. dim_sku ───────────────────────────────────────────────────────────────
  const dimRows = await fetchAll<{
    sku_ms: string; sku_wb: number | null; name: string | null
    category_wb: string | null; subject_wb: string | null
  }>(
    (sb) => sb.from('dim_sku').select('sku_ms, sku_wb, name, category_wb, subject_wb'),
    supabase,
  )
  const dimByMs: Record<string, typeof dimRows[0]> = {}
  for (const r of dimRows) dimByMs[r.sku_ms] = r

  // ── 3. fact_sku_snapshot ─────────────────────────────────────────────────────
  type SnapRow = {
    sku_ms: string; margin_pct: number | null; price: number | null
    manager: string | null; novelty_status: string | null; stock_days: number | null
    fbo_wb: number | null; fbs_pushkino: number | null; fbs_smolensk: number | null
  }
  const snapByMs: Record<string, SnapRow> = {}
  if (skuRepId) {
    const rows = await fetchAll<SnapRow>(
      (sb) => sb.from('fact_sku_snapshot')
        .select('sku_ms, margin_pct, price, manager, novelty_status, stock_days, fbo_wb, fbs_pushkino, fbs_smolensk')
        .eq('upload_id', skuRepId),
      supabase,
    )
    for (const r of rows) snapByMs[r.sku_ms] = r
  }

  // ── 4. Date range ────────────────────────────────────────────────────────────
  let fromDate = fromParam
  let toDate = toParam
  if (!fromDate || !toDate) {
    const { data: maxRow } = await supabase.from('fact_sku_daily')
      .select('metric_date').order('metric_date', { ascending: false }).limit(1)
    const maxDate = maxRow?.[0]?.metric_date ?? null
    if (maxDate) {
      const d = new Date(maxDate); d.setDate(d.getDate() - 29)
      fromDate = d.toISOString().split('T')[0]
      toDate = maxDate
    }
  }

  const periodDays = fromDate && toDate
    ? Math.max(1, Math.round((new Date(toDate).getTime() - new Date(fromDate).getTime()) / 86400000) + 1)
    : 30

  // ── 5. fact_sku_daily (current period) ───────────────────────────────────────
  type DailyRow = { sku_ms: string; metric_date: string; revenue: number | null; ad_spend: number | null; cr_order: number | null }
  const dailyRows = fromDate && toDate
    ? await fetchAll<DailyRow>(
        (sb) => sb.from('fact_sku_daily')
          .select('sku_ms, metric_date, revenue, ad_spend, cr_order')
          .gte('metric_date', fromDate!).lte('metric_date', toDate!),
        supabase,
      )
    : []

  // ── 6. fact_sku_daily (prev period) ─────────────────────────────────────────
  const { prevFrom, prevTo } = fromDate && toDate
    ? shiftRange(fromDate, toDate)
    : { prevFrom: null as string | null, prevTo: null as string | null }

  const prevDailyRows = prevFrom && prevTo
    ? await fetchAll<{ sku_ms: string; metric_date: string; revenue: number | null }>(
        (sb) => sb.from('fact_sku_daily')
          .select('sku_ms, metric_date, revenue')
          .gte('metric_date', prevFrom).lte('metric_date', prevTo),
        supabase,
      )
    : []

  // ── 7. Aggregate by SKU ──────────────────────────────────────────────────────
  type SkuAgg = { revenue: number; ad_spend: number; cr_order: number[] }
  const skuAgg: Record<string, SkuAgg> = {}
  const dateAgg: Record<string, { revenue: number; ad_spend: number }> = {}

  for (const r of dailyRows) {
    if (!skuAgg[r.sku_ms]) skuAgg[r.sku_ms] = { revenue: 0, ad_spend: 0, cr_order: [] }
    skuAgg[r.sku_ms].revenue   += r.revenue ?? 0
    skuAgg[r.sku_ms].ad_spend  += r.ad_spend ?? 0
    if (r.cr_order != null) skuAgg[r.sku_ms].cr_order.push(r.cr_order)

    if (!dateAgg[r.metric_date]) dateAgg[r.metric_date] = { revenue: 0, ad_spend: 0 }
    dateAgg[r.metric_date].revenue  += r.revenue ?? 0
    dateAgg[r.metric_date].ad_spend += r.ad_spend ?? 0
  }

  const prevSkuRev: Record<string, number> = {}
  for (const r of prevDailyRows) {
    prevSkuRev[r.sku_ms] = (prevSkuRev[r.sku_ms] ?? 0) + (r.revenue ?? 0)
  }

  // ── 8. Build all-SKU set (ads + snapshot) ────────────────────────────────────
  const allSkuMs = new Set<string>([...Object.keys(skuAgg), ...Object.keys(snapByMs)])

  // Apply global filters
  if (catFilter || mgrFilter || novFilter) {
    for (const ms of [...allSkuMs]) {
      const dim  = dimByMs[ms]
      const snap = snapByMs[ms]
      if (catFilter && (dim?.category_wb ?? '') !== catFilter) { allSkuMs.delete(ms); continue }
      if (mgrFilter && (snap?.manager ?? '') !== mgrFilter)    { allSkuMs.delete(ms); continue }
      if (novFilter === 'Новинки'    && snap?.novelty_status !== 'Новинки')    { allSkuMs.delete(ms); continue }
      if (novFilter === 'Не новинки' && snap?.novelty_status === 'Новинки')    { allSkuMs.delete(ms); continue }
    }
  }

  // ── 9. Build hierarchy ───────────────────────────────────────────────────────
  // category → subject → [skus]
  const catMap: Record<string, Record<string, SkuNode[]>> = {}
  const metaCats = new Set<string>()
  const metaMgrs = new Set<string>()

  for (const ms of allSkuMs) {
    const s    = skuAgg[ms] ?? { revenue: 0, ad_spend: 0, cr_order: [] }
    const snap = snapByMs[ms]
    const dim  = dimByMs[ms]

    const cat  = dim?.category_wb ?? 'Без категории'
    const subj = dim?.subject_wb  ?? 'Без предмета'
    metaCats.add(cat)
    if (snap?.manager) metaMgrs.add(snap.manager)

    const price      = snap?.price ?? 0
    const marginPct  = snap?.margin_pct ?? 0
    const totalStock = (snap?.fbo_wb ?? 0) + (snap?.fbs_pushkino ?? 0) + (snap?.fbs_smolensk ?? 0)
    const stockRub   = totalStock * price
    const chmd       = s.revenue * marginPct - s.ad_spend
    const drr        = s.revenue > 0 ? s.ad_spend / s.revenue : 0
    const prevRev    = prevSkuRev[ms] ?? 0
    const deltaPct   = prevRev > 0 ? (s.revenue - prevRev) / prevRev : null
    const forecastRevenue = periodDays > 0 ? (s.revenue / periodDays) * 30 : 0
    const forecastQty    = price > 0 ? Math.round(forecastRevenue / price) : null

    const node: SkuNode = {
      sku_ms:          ms,
      sku_wb:          dim?.sku_wb ?? null,
      name:            dim?.name ?? ms,
      revenue:         s.revenue,
      prev_revenue:    prevRev,
      delta_pct:       deltaPct,
      chmd,
      margin_pct:      marginPct,
      drr,
      stock_rub:       stockRub,
      stock_qty:       totalStock,
      stock_days:      dim?.stock_days ?? null,
      forecast_30d_qty: forecastQty,
      price,
    }

    if (!catMap[cat]) catMap[cat] = {}
    if (!catMap[cat][subj]) catMap[cat][subj] = []
    catMap[cat][subj].push(node)
  }

  // Build hierarchy nodes
  const hierarchy: CategoryNode[] = Object.entries(catMap).map(([category, subjMap]) => {
    const subjects: SubjectNode[] = Object.entries(subjMap).map(([subject, skus]) => {
      const r = rollup(skus.map(s => ({
        revenue: s.revenue, prev_revenue: s.prev_revenue, chmd: s.chmd,
        ad_spend: s.drr * s.revenue,
        margin_pct_weighted: s.margin_pct * s.revenue,
      })))
      return { subject, skus, ...r }
    }).sort((a, b) => b.revenue - a.revenue)

    const r = rollup(subjects.map(s => ({
      revenue: s.revenue, prev_revenue: s.prev_revenue, chmd: s.chmd,
      ad_spend: s.drr * s.revenue,
      margin_pct_weighted: s.margin_pct * s.revenue,
    })))
    return { category, subjects, ...r }
  }).sort((a, b) => b.revenue - a.revenue)

  // ── 10. KPI totals ───────────────────────────────────────────────────────────
  const totalRevenue  = hierarchy.reduce((s, c) => s + c.revenue, 0)
  const prevRevenue   = hierarchy.reduce((s, c) => s + c.prev_revenue, 0)
  const totalChmd     = hierarchy.reduce((s, c) => s + c.chmd, 0)
  const totalAdSpend  = hierarchy.reduce((s, c) => s + c.drr * c.revenue, 0)
  // Weighted average margin: Σ(margin_pct × revenue) / Σrevenue (same formula as overview)
  const marginPctNum  = hierarchy.reduce((s, c) => s + c.margin_pct * c.revenue, 0)
  const marginPct     = totalRevenue > 0 ? marginPctNum / totalRevenue : 0
  const drr           = totalRevenue > 0 ? totalAdSpend / totalRevenue : 0
  const avgPrice      = [...allSkuMs].reduce((s, ms) => s + (snapByMs[ms]?.price ?? 0), 0) / Math.max(allSkuMs.size, 1)
  const cpo           = avgPrice > 0 && totalAdSpend > 0
    ? totalAdSpend / (totalRevenue / avgPrice)
    : null
  const forecast30dRevenue = periodDays > 0 ? (totalRevenue / periodDays) * 30 : 0

  // Previous period aggregates for deltas (weighted margin same as current)
  let prevChmd = 0, prevAdSpend = 0, prevMarginNum = 0
  for (const ms of allSkuMs) {
    const prevRev = prevSkuRev[ms] ?? 0
    const snap = snapByMs[ms]
    const marginPctSku = snap?.margin_pct ?? 0
    const agg = skuAgg[ms]
    const drr_sku = (agg?.revenue ?? 0) > 0 ? (agg?.ad_spend ?? 0) / agg!.revenue : 0
    prevChmd += prevRev * marginPctSku - (drr_sku * prevRev)
    prevAdSpend += drr_sku * prevRev
    prevMarginNum += marginPctSku * prevRev
  }
  const prevMarginPct = prevRevenue > 0 ? prevMarginNum / prevRevenue : 0
  const prevDrr = prevRevenue > 0 ? prevAdSpend / prevRevenue : 0
  const prevCpo = avgPrice > 0 && prevAdSpend > 0
    ? prevAdSpend / (prevRevenue / avgPrice)
    : null

  const kpi = {
    revenue: totalRevenue,
    prev_revenue: prevRevenue,
    chmd: totalChmd,
    prev_chmd: prevChmd,
    margin_pct: marginPct,
    prev_margin_pct: prevMarginPct,
    drr,
    prev_drr: prevDrr,
    cpo,
    prev_cpo: prevCpo,
    forecast_30d_revenue: forecast30dRevenue,
    sku_count: allSkuMs.size,
    period_days: periodDays,
  }

  // ── 11. Daily charts ─────────────────────────────────────────────────────────
  const daily_chart = Object.entries(dateAgg)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, d]) => {
      const drrDay = d.revenue > 0 ? d.ad_spend / d.revenue : 0
      // Per-day margin approx: weighted snapshot margin minus daily DRR
      // (reflects that ad costs reduce margin daily, while COGS stays constant)
      const marginPctDay = marginPct - drrDay + drr  // = marginPct + (drr - drrDay) effectively isolating COGS
      // Simpler: marginPct_snapshot_weighted - drr_day gives real margin after ad costs per day
      const marginPctDaySimple = marginPct > 0 ? Math.max(0, marginPct - drrDay + drr) : marginPct
      const chmdDay = d.revenue * marginPct  // approx using period avg COGS
      return {
        date,
        revenue:    d.revenue,
        chmd:       chmdDay - d.ad_spend,
        ad_spend:   d.ad_spend,
        drr:        drrDay,
        margin_pct: marginPctDaySimple,
      }
    })

  // ── 12. Previous period daily (for comparison chart) ─────────────────────────
  const prevDateAgg: Record<string, number> = {}
  for (const r of prevDailyRows) {
    prevDateAgg[r.metric_date] = (prevDateAgg[r.metric_date] ?? 0) + (r.revenue ?? 0)
  }
  const daily_chart_prev = Object.entries(prevDateAgg)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, revenue], i) => ({ day_index: i, date, revenue }))

  return NextResponse.json({
    kpi,
    hierarchy,
    daily_chart,
    daily_chart_prev,
    meta: {
      categories: [...metaCats].sort(),
      managers:   [...metaMgrs].sort(),
    },
  } satisfies AnalyticsResponse)
}
