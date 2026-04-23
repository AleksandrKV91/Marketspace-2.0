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
  // margin_pct_weighted = Σ(margin_pct × revenue) for each SKU — sum them up here
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

  // ── 1. Latest uploads (TTL 60s) ──────────────────────────────────────────────
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

  const skuRepId = latestByType['sku_report']

  // ── 2. dim_sku (TTL 10min) ───────────────────────────────────────────────────
  type DimRow = { sku_ms: string; sku_wb: number | null; name: string | null; category_wb: string | null; subject_wb: string | null }
  const dimRows = await cached<DimRow[]>('dim_sku_all', 10 * 60_000, async () =>
    fetchAll<DimRow>(
      (sb) => sb.from('dim_sku').select('sku_ms, sku_wb, name, category_wb, subject_wb'),
      supabase,
    )
  )
  const dimByMs: Record<string, DimRow> = {}
  for (const r of dimRows) dimByMs[r.sku_ms] = r

  // ── 3. fact_sku_daily — снапшотные поля (берём по последней snap_date) ───────
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
          .eq('snap_date', maxSnapDate).not('fbo_wb', 'is', null),
        supabase,
      )
      for (const r of rows) { if (!snapByMs[r.sku_ms]) snapByMs[r.sku_ms] = r }
    }
  }

  // ── 4. Date range ────────────────────────────────────────────────────────────
  let fromDate = fromParam
  let toDate = toParam
  if (!fromDate || !toDate) {
    const { data: maxRow } = await supabase.from('fact_daily_agg')
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

  // ── 5. fact_daily_agg — KPI и графики ───────────────────────────────────────
  // Новая структура: одна строка на дату, без разбивки по категориям.
  // Фильтрация по категории будет применена позже через иерархию SKU.
  type AggRow = {
    metric_date: string
    revenue_sum: number; ad_spend_sum: number; chmd_sum: number; margin_sum: number
    drr_total: number | null; marginality: number | null; chmd_pct: number | null
    ctr_avg: number | null; cr_order_avg: number | null; sku_count: number
  }

  const safeNum = (n: unknown): number => (typeof n === 'number' && isFinite(n)) ? n : 0

  async function fetchAgg(from: string, to: string): Promise<AggRow[]> {
    const { data } = await supabase.from('fact_daily_agg')
      .select('metric_date,revenue_sum,ad_spend_sum,chmd_sum,margin_sum,drr_total,marginality,chmd_pct,ctr_avg,cr_order_avg,sku_count')
      .gte('metric_date', from).lte('metric_date', to)
      .limit(10000)
    return (data ?? []) as AggRow[]
  }

  const [aggCurr, aggPrev] = fromDate && toDate
    ? await Promise.all([
        fetchAgg(fromDate, toDate),
        prevFrom && prevTo ? fetchAgg(prevFrom, prevTo) : Promise.resolve([]),
      ])
    : [[], []]

  // Суммируем KPI за период из агрегата
  let totalRevenue = 0, totalAdSpend = 0, totalChmd = 0, totalMargin = 0
  const dateAgg: Record<string, { revenue: number; ad_spend: number; chmd: number }> = {}

  for (const r of aggCurr) {
    const rev   = safeNum(r.revenue_sum)
    const spend = safeNum(r.ad_spend_sum)
    const chmd  = safeNum(r.chmd_sum)
    const margin = safeNum(r.margin_sum)
    totalRevenue  += rev
    totalAdSpend  += spend
    totalChmd     += chmd
    totalMargin   += margin

    if (!dateAgg[r.metric_date]) dateAgg[r.metric_date] = { revenue: 0, ad_spend: 0, chmd: 0 }
    dateAgg[r.metric_date].revenue  += rev
    dateAgg[r.metric_date].ad_spend += spend
    dateAgg[r.metric_date].chmd     += chmd
  }

  const marginPct  = totalRevenue > 0 ? totalMargin / totalRevenue : 0
  const drr        = totalRevenue > 0 ? totalAdSpend / totalRevenue : 0
  const cpo: number | null = null  // рассчитывается через daily_agg_sku если нужно
  const forecast30dRevenue = periodDays > 0 ? (totalRevenue / periodDays) * 30 : 0

  // Предыдущий период
  let prevRevenue = 0, prevAdSpend = 0, prevMargin = 0
  for (const r of aggPrev) {
    prevRevenue += safeNum(r.revenue_sum)
    prevAdSpend += safeNum(r.ad_spend_sum)
    prevMargin  += safeNum(r.margin_sum)
  }
  const prevChmd      = prevMargin - prevAdSpend
  const prevMarginPct = prevRevenue > 0 ? prevMargin / prevRevenue : 0
  const prevDrr       = prevRevenue > 0 ? prevAdSpend / prevRevenue : 0
  const prevCpo: number | null = null

  // ── 6. Агрегация по SKU из fact_daily_agg (быстро, без fetchAll на 180k строк) ─
  // Получаем revenue/ad_spend по каждому SKU за текущий и предыдущий период
  type SkuDailyAgg = { sku_ms: string; revenue: number; ad_spend: number }

  async function fetchSkuAgg(from: string, to: string): Promise<SkuDailyAgg[]> {
    // Используем RPC для агрегации на стороне БД — возвращает одну строку на SKU
    const { data, error } = await supabase.rpc('get_sku_period_agg', { p_from: from, p_to: to })
    if (error || !data) {
      // Fallback: полная выборка через fetchAll (без limit)
      const fallback = await fetchAll<{ sku_ms: string; revenue: number | null; ad_spend: number | null }>(
        (sb) => sb.from('fact_sku_daily')
          .select('sku_ms, revenue, ad_spend')
          .gte('metric_date', from).lte('metric_date', to),
        supabase,
      )
      const agg: Record<string, SkuDailyAgg> = {}
      for (const r of fallback) {
        if (!agg[r.sku_ms]) agg[r.sku_ms] = { sku_ms: r.sku_ms, revenue: 0, ad_spend: 0 }
        agg[r.sku_ms].revenue  += r.revenue ?? 0
        agg[r.sku_ms].ad_spend += r.ad_spend ?? 0
      }
      return Object.values(agg)
    }
    return data as SkuDailyAgg[]
  }

  // daily_by_sku нужен для графиков — берём только текущий период с limit
  type DailyRow = { sku_ms: string; metric_date: string; revenue: number | null; ad_spend: number | null }
  const [skuAggCurr, skuAggPrev, dailyRows] = fromDate && toDate
    ? await Promise.all([
        fetchSkuAgg(fromDate, toDate),
        prevFrom && prevTo ? fetchSkuAgg(prevFrom, prevTo) : Promise.resolve([]),
        fetchAll<DailyRow>(
          (sb) => sb.from('fact_sku_daily')
            .select('sku_ms, metric_date, revenue, ad_spend')
            .gte('metric_date', fromDate!).lte('metric_date', toDate!),
          supabase,
        ),
      ])
    : [[], [], []]

  // Индексируем SKU-агрегаты из RPC/fallback
  type SkuAgg = { revenue: number; ad_spend: number }
  const skuAgg: Record<string, SkuAgg> = {}
  for (const r of skuAggCurr) {
    skuAgg[r.sku_ms] = { revenue: r.revenue, ad_spend: r.ad_spend }
  }

  const prevSkuRev: Record<string, number> = {}
  for (const r of skuAggPrev) {
    prevSkuRev[r.sku_ms] = r.revenue
  }

  // ── 7. Build hierarchy ───────────────────────────────────────────────────────
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

    const price      = snap?.price ?? 0
    const marginPctSku = snap?.margin_pct ?? 0
    const totalStock = (snap?.fbo_wb ?? 0) + (snap?.fbs_pushkino ?? 0) + (snap?.fbs_smolensk ?? 0)
    const chmd       = s.revenue * marginPctSku - s.ad_spend
    const drrSku     = s.revenue > 0 ? s.ad_spend / s.revenue : 0
    const prevRev    = prevSkuRev[ms] ?? 0
    const deltaPct   = prevRev > 0 ? (s.revenue - prevRev) / prevRev : null
    const forecastQty = price > 0 && periodDays > 0
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

  // ── 8. KPI — берём из fact_daily_agg (точные), SKU-count из иерархии ─────────
  const kpi = {
    revenue:              totalRevenue,
    prev_revenue:         prevRevenue,
    chmd:                 totalChmd,
    prev_chmd:            prevChmd,
    margin_pct:           marginPct,
    prev_margin_pct:      prevMarginPct,
    drr,
    prev_drr:             prevDrr,
    cpo,
    prev_cpo:             prevCpo,
    forecast_30d_revenue: forecast30dRevenue,
    sku_count:            allSkuMs.size,
    period_days:          periodDays,
  }

  // ── 9. Daily charts из fact_daily_agg ────────────────────────────────────────
  // margin_pct = (chmd + ad_spend) / revenue = margin_sum / revenue
  const daily_chart = Object.entries(dateAgg)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, d]) => ({
      date,
      revenue:    d.revenue,
      chmd:       d.chmd,
      ad_spend:   d.ad_spend,
      drr:        d.revenue > 0 ? d.ad_spend / d.revenue : 0,
      margin_pct: d.revenue > 0 ? (d.chmd + d.ad_spend) / d.revenue : 0,
    }))

  // ── 10. Previous period daily (comparison chart) — из fact_daily_agg ─────────
  const prevDateAgg: Record<string, number> = {}
  for (const r of aggPrev) {
    prevDateAgg[r.metric_date] = (prevDateAgg[r.metric_date] ?? 0) + safeNum(r.revenue_sum)
  }
  const daily_chart_prev = Object.entries(prevDateAgg)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, revenue], i) => ({ day_index: i, date, revenue }))

  // ── 11. daily_by_sku — для клиентской фильтрации графиков ────────────────────
  const daily_by_sku = dailyRows
    .filter(r => allSkuMs.has(r.sku_ms))
    .map(r => ({ sku_ms: r.sku_ms, date: r.metric_date, revenue: r.revenue ?? 0, ad_spend: r.ad_spend ?? 0 }))

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
