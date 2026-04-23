import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/supabase/fetchAll'
import { cached } from '@/lib/cache'

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

export type { SkuNode, SubjectNode, CategoryNode, AnalyticsResponse } from '@/types/analytics'
import type { SkuNode, SubjectNode, CategoryNode, AnalyticsResponse } from '@/types/analytics'

function rollup(items: Array<{ revenue: number; prev_revenue: number; chmd: number; ad_spend: number; margin_pct_weighted: number }>) {
  const revenue = items.reduce((s, i) => s + i.revenue, 0)
  const prev_revenue = items.reduce((s, i) => s + i.prev_revenue, 0)
  const chmd = items.reduce((s, i) => s + i.chmd, 0)
  const ad_spend = items.reduce((s, i) => s + i.ad_spend, 0)
  const margin_pct_num = items.reduce((s, i) => s + i.margin_pct_weighted, 0)
  const delta_pct = prev_revenue > 0 ? (revenue - prev_revenue) / prev_revenue : null
  const margin_pct = revenue > 0 ? margin_pct_num / revenue : 0
  const drr = revenue > 0 ? ad_spend / revenue : 0
  return { revenue, prev_revenue, delta_pct, chmd, margin_pct, drr }
}

export async function GET(req: Request) {
  try {
  const supabase = createServiceClient()
  const url = new URL(req.url)
  const fromParam  = url.searchParams.get('from')
  const toParam    = url.searchParams.get('to')
  const catFilter  = url.searchParams.get('category') ?? ''
  const mgrFilter  = url.searchParams.get('manager') ?? ''
  const novFilter  = url.searchParams.get('novelty') ?? ''

  // ── 1. dim_sku (TTL 10min) ───────────────────────────────────────────────────
  type DimRow = { sku_ms: string; sku_wb: number | null; name: string | null; category_wb: string | null; subject_wb: string | null }
  const dimRows = await cached<DimRow[]>('dim_sku_all', 10 * 60_000, async () =>
    fetchAll<DimRow>(
      (sb) => sb.from('dim_sku').select('sku_ms, sku_wb, name, category_wb, subject_wb'),
      supabase,
    )
  )
  const dimByMs: Record<string, DimRow> = {}
  for (const r of dimRows) dimByMs[r.sku_ms] = r

  // ── 2. fact_sku_daily — снапшотные поля (последняя snap_date) ────────────────
  type SnapRow = {
    sku_ms: string; margin_pct: number | null; price: number | null
    manager: string | null; novelty_status: string | null; stock_days: number | null
    fbo_wb: number | null; fbs_pushkino: number | null; fbs_smolensk: number | null
  }
  const snapByMs: Record<string, SnapRow> = {}
  {
    const { data: maxSnapRow } = await supabase.from('fact_sku_daily')
      .select('snap_date').not('snap_date', 'is', null)
      .order('snap_date', { ascending: false }).limit(1)
    const maxSnapDate = maxSnapRow?.[0]?.snap_date
    if (maxSnapDate) {
      const rows = await fetchAll<SnapRow>(
        (sb) => sb.from('fact_sku_daily')
          .select('sku_ms, margin_pct, price, manager, novelty_status, stock_days, fbo_wb, fbs_pushkino, fbs_smolensk')
          .eq('snap_date', maxSnapDate),
        supabase,
      )
      for (const r of rows) { if (!snapByMs[r.sku_ms]) snapByMs[r.sku_ms] = r }
    }
  }

  // ── 3. Date range ─────────────────────────────────────────────────────────────
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

  const { prevFrom, prevTo } = fromDate && toDate
    ? shiftRange(fromDate, toDate)
    : { prevFrom: null as string | null, prevTo: null as string | null }

  // ── 4. fact_sku_daily — текущий и предыдущий периоды ─────────────────────────
  // Читаем напрямую через fetchAll (пагинированно, без лимита PostgREST).
  // Это единственный источник истины — fact_daily_agg не трогаем совсем.
  type DailyRow = { sku_ms: string; metric_date: string; revenue: number | null; ad_spend: number | null }

  const [currDailyRows, prevDailyRows] = await Promise.all([
    fromDate && toDate
      ? fetchAll<DailyRow>(
          (sb) => sb.from('fact_sku_daily')
            .select('sku_ms, metric_date, revenue, ad_spend')
            .gte('metric_date', fromDate!).lte('metric_date', toDate!),
          supabase,
        )
      : Promise.resolve([]),
    prevFrom && prevTo
      ? fetchAll<DailyRow>(
          (sb) => sb.from('fact_sku_daily')
            .select('sku_ms, metric_date, revenue, ad_spend')
            .gte('metric_date', prevFrom!).lte('metric_date', prevTo!),
          supabase,
        )
      : Promise.resolve([]),
  ])

  // ── 5. Агрегация текущего периода ────────────────────────────────────────────
  // Все три агрегата (KPI, daily chart, SKU-иерархия) вычисляются из одного прохода.
  let totalRevenue = 0
  let totalAdSpend = 0
  let totalMarginSum = 0   // Σ (revenue × margin_pct) — для margin_pct и chmd

  const dateAgg: Record<string, { revenue: number; ad_spend: number; marginSum: number }> = {}
  const skuAgg: Record<string, { revenue: number; ad_spend: number }> = {}

  for (const r of currDailyRows) {
    if (!dimByMs[r.sku_ms]) continue  // only count SKUs that exist in dim_sku
    const rev   = r.revenue   ?? 0
    const spend = r.ad_spend  ?? 0
    const mPct  = snapByMs[r.sku_ms]?.margin_pct ?? 0

    totalRevenue   += rev
    totalAdSpend   += spend
    totalMarginSum += rev * mPct

    if (!dateAgg[r.metric_date]) dateAgg[r.metric_date] = { revenue: 0, ad_spend: 0, marginSum: 0 }
    dateAgg[r.metric_date].revenue   += rev
    dateAgg[r.metric_date].ad_spend  += spend
    dateAgg[r.metric_date].marginSum += rev * mPct

    if (!skuAgg[r.sku_ms]) skuAgg[r.sku_ms] = { revenue: 0, ad_spend: 0 }
    skuAgg[r.sku_ms].revenue  += rev
    skuAgg[r.sku_ms].ad_spend += spend
  }

  const marginPct        = totalRevenue > 0 ? totalMarginSum / totalRevenue : 0
  const totalChmd        = totalMarginSum - totalAdSpend
  const drr              = totalRevenue > 0 ? totalAdSpend / totalRevenue : 0
  const forecast30dRevenue = periodDays > 0 ? (totalRevenue / periodDays) * 30 : 0

  // ── 6. Агрегация предыдущего периода ─────────────────────────────────────────
  let prevRevenue = 0
  let prevAdSpend = 0
  let prevMarginSum = 0
  const prevSkuRev: Record<string, number> = {}
  const prevDateAgg: Record<string, number> = {}

  for (const r of prevDailyRows) {
    const rev   = r.revenue  ?? 0
    const spend = r.ad_spend ?? 0
    const mPct  = snapByMs[r.sku_ms]?.margin_pct ?? 0

    prevRevenue   += rev
    prevAdSpend   += spend
    prevMarginSum += rev * mPct
    prevSkuRev[r.sku_ms] = (prevSkuRev[r.sku_ms] ?? 0) + rev
    prevDateAgg[r.metric_date] = (prevDateAgg[r.metric_date] ?? 0) + rev
  }

  const prevChmd      = prevMarginSum - prevAdSpend
  const prevMarginPct = prevRevenue > 0 ? prevMarginSum / prevRevenue : 0
  const prevDrr       = prevRevenue > 0 ? prevAdSpend / prevRevenue : 0
  const prevCpo: number | null = null

  // ── 7. CPO ────────────────────────────────────────────────────────────────────
  let estimatedUnits = 0
  for (const [ms, agg] of Object.entries(skuAgg)) {
    const price = snapByMs[ms]?.price
    if (price != null && price > 0) estimatedUnits += agg.revenue / price
  }
  const cpoCalc: number | null = estimatedUnits > 0 && totalAdSpend > 0
    ? Math.round(totalAdSpend / estimatedUnits)
    : null

  // ── 8. Фильтр SKU ─────────────────────────────────────────────────────────────
  const allSkuMs = new Set<string>([...Object.keys(skuAgg), ...Object.keys(snapByMs)])

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

  // ── 9. Build hierarchy ────────────────────────────────────────────────────────
  const catMap: Record<string, Record<string, SkuNode[]>> = {}
  const metaCats = new Set<string>()
  const metaMgrs = new Set<string>()

  for (const ms of allSkuMs) {
    const s    = skuAgg[ms] ?? { revenue: 0, ad_spend: 0 }
    const snap = snapByMs[ms]
    const dim  = dimByMs[ms]
    const cat  = dim?.category_wb ?? 'Без категории'
    const subj = dim?.subject_wb  ?? 'Без предмета'
    metaCats.add(cat)
    if (snap?.manager) metaMgrs.add(snap.manager)

    const price        = snap?.price ?? 0
    const marginPctSku = snap?.margin_pct ?? 0
    const totalStock   = (snap?.fbo_wb ?? 0) + (snap?.fbs_pushkino ?? 0) + (snap?.fbs_smolensk ?? 0)
    const chmd         = s.revenue * marginPctSku - s.ad_spend
    const drrSku       = s.revenue > 0 ? s.ad_spend / s.revenue : 0
    const prevRev      = prevSkuRev[ms] ?? 0
    const deltaPct     = prevRev > 0 ? (s.revenue - prevRev) / prevRev : null
    const forecastQty  = price > 0 && periodDays > 0
      ? Math.round((s.revenue / periodDays) * 30 / price) : null

    const node: SkuNode = {
      sku_ms:           ms,
      sku_wb:           dim?.sku_wb ?? null,
      name:             dim?.name ?? ms,
      revenue:          s.revenue,
      prev_revenue:     prevRev,
      delta_pct:        deltaPct,
      chmd,
      margin_pct:       marginPctSku,
      drr:              drrSku,
      stock_rub:        totalStock * price,
      stock_qty:        totalStock,
      stock_days:       snap?.stock_days ?? null,
      forecast_30d_qty: forecastQty,
      price,
    }

    if (!catMap[cat]) catMap[cat] = {}
    if (!catMap[cat][subj]) catMap[cat][subj] = []
    catMap[cat][subj].push(node)
  }

  const hierarchy: CategoryNode[] = Object.entries(catMap).map(([category, subjMap]) => {
    const subjects: SubjectNode[] = Object.entries(subjMap).map(([subject, skus]) => {
      const r = rollup(skus.map(s => ({
        revenue: s.revenue, prev_revenue: s.prev_revenue, chmd: s.chmd,
        ad_spend: s.drr * s.revenue, margin_pct_weighted: s.margin_pct * s.revenue,
      })))
      return { subject, skus, ...r }
    }).sort((a, b) => b.revenue - a.revenue)
    const r = rollup(subjects.map(s => ({
      revenue: s.revenue, prev_revenue: s.prev_revenue, chmd: s.chmd,
      ad_spend: s.drr * s.revenue, margin_pct_weighted: s.margin_pct * s.revenue,
    })))
    return { category, subjects, ...r }
  }).sort((a, b) => b.revenue - a.revenue)

  // ── 10. KPI ───────────────────────────────────────────────────────────────────
  const kpi = {
    revenue:              totalRevenue,
    prev_revenue:         prevRevenue,
    chmd:                 totalChmd,
    prev_chmd:            prevChmd,
    margin_pct:           marginPct,
    prev_margin_pct:      prevMarginPct,
    drr,
    prev_drr:             prevDrr,
    cpo:                  cpoCalc,
    prev_cpo:             prevCpo,
    forecast_30d_revenue: forecast30dRevenue,
    sku_count:            allSkuMs.size,
    period_days:          periodDays,
  }

  // ── 11. Daily charts ──────────────────────────────────────────────────────────
  const daily_chart = Object.entries(dateAgg)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, d]) => ({
      date,
      revenue:    d.revenue,
      chmd:       d.marginSum - d.ad_spend,
      ad_spend:   d.ad_spend,
      drr:        d.revenue > 0 ? d.ad_spend / d.revenue : 0,
      margin_pct: d.revenue > 0 ? d.marginSum / d.revenue : 0,
    }))

  const daily_chart_prev = Object.entries(prevDateAgg)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, revenue], i) => ({ day_index: i, date, revenue }))

  // ── 12. daily_by_sku (для клиентской фильтрации графиков по категории/SKU) ───
  const daily_by_sku = currDailyRows
    .filter(r => allSkuMs.has(r.sku_ms))
    .map(r => ({ sku_ms: r.sku_ms, date: r.metric_date, revenue: r.revenue ?? 0, ad_spend: r.ad_spend ?? 0 }))

  if (process.env.NODE_ENV !== 'production') {
    console.log(`[analytics] period: ${fromDate} – ${toDate}`)
    console.log(`[analytics] revenue: ${Math.round(totalRevenue).toLocaleString()} ₽`)
    console.log(`[analytics] SKUs with activity: ${Object.keys(skuAgg).length}`)
    console.log(`[analytics] daily_rows fetched: ${currDailyRows.length}`)
  }

  return NextResponse.json({
    kpi,
    hierarchy,
    daily_chart,
    daily_chart_prev,
    daily_by_sku,
    meta: {
      categories: [...metaCats].sort(),
      managers:   [...metaMgrs].sort(),
      max_date:   toDate ?? null,
    },
  } satisfies AnalyticsResponse)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[analytics] ERROR:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
