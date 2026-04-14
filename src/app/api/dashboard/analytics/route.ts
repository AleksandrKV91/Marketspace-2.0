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
  daily_by_sku: Array<{ sku_ms: string; date: string; revenue: number; ad_spend: number }>
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

  // ── 5. fact_daily_agg — KPI и графики (быстро, малый объём) ─────────────────
  type AggRow = {
    metric_date: string; category_wb: string; subject_wb: string
    revenue: number; ad_spend: number; chmd: number
    margin_pct_wgt: number; price_wgt: number; drr: number
    ctr_avg: number | null; cr_order_avg: number | null
    cpo: number | null; sku_count: number
  }

  async function fetchAgg(from: string, to: string, catF: string, subjFilter?: string): Promise<AggRow[]> {
    let q = supabase.from('fact_daily_agg')
      .select('metric_date,category_wb,subject_wb,revenue,ad_spend,chmd,margin_pct_wgt,price_wgt,drr,ctr_avg,cr_order_avg,cpo,sku_count')
      .gte('metric_date', from).lte('metric_date', to)
    if (catF) q = q.eq('category_wb', catF)
    if (subjFilter) q = q.eq('subject_wb', subjFilter)
    const { data } = await q.limit(100000)
    return (data ?? []) as AggRow[]
  }

  // Параллельно: текущий и предыдущий периоды из агрега
  const [aggCurr, aggPrev] = fromDate && toDate
    ? await Promise.all([
        fetchAgg(fromDate, toDate, catFilter),
        prevFrom && prevTo ? fetchAgg(prevFrom, prevTo, catFilter) : Promise.resolve([]),
      ])
    : [[], []]

  // Агрегируем суммы текущего периода (по всем датам и категориям/предметам)
  let totalRevenue = 0, totalAdSpend = 0, totalChmd = 0
  let marginRevNum = 0, priceRevNum = 0
  const dateAgg: Record<string, { revenue: number; ad_spend: number; chmd: number }> = {}
  const aggSkuCount = new Set<string>()  // приблизительно — реальный счётчик из агрега

  for (const r of aggCurr) {
    totalRevenue  += r.revenue
    totalAdSpend  += r.ad_spend
    totalChmd     += r.chmd
    marginRevNum  += r.margin_pct_wgt * r.revenue
    priceRevNum   += r.price_wgt * r.revenue

    if (!dateAgg[r.metric_date]) dateAgg[r.metric_date] = { revenue: 0, ad_spend: 0, chmd: 0 }
    dateAgg[r.metric_date].revenue  += r.revenue
    dateAgg[r.metric_date].ad_spend += r.ad_spend
    dateAgg[r.metric_date].chmd     += r.chmd
  }

  const marginPct  = totalRevenue > 0 ? marginRevNum / totalRevenue : 0
  const drr        = totalRevenue > 0 ? totalAdSpend / totalRevenue : 0
  const priceWgt   = totalRevenue > 0 ? priceRevNum / totalRevenue : 0
  const cpo        = priceWgt > 0 && totalAdSpend > 0
    ? totalAdSpend / (totalRevenue / priceWgt) : null
  const forecast30dRevenue = periodDays > 0 ? (totalRevenue / periodDays) * 30 : 0

  // Предыдущий период
  let prevRevenue = 0, prevAdSpend = 0, prevMarginRevNum = 0
  for (const r of aggPrev) {
    prevRevenue      += r.revenue
    prevAdSpend      += r.ad_spend
    prevMarginRevNum += r.margin_pct_wgt * r.revenue
  }
  const prevChmd       = prevMarginRevNum - prevAdSpend  // грубо: Σ(margin_pct_wgt × rev) − ad
  const prevMarginPct  = prevRevenue > 0 ? prevMarginRevNum / prevRevenue : 0
  const prevDrr        = prevRevenue > 0 ? prevAdSpend / prevRevenue : 0
  const prevCpo        = priceWgt > 0 && prevAdSpend > 0
    ? prevAdSpend / (prevRevenue / priceWgt) : null

  // ── 6. fact_sku_daily — детализация по SKU (иерархия таблицы) ───────────────
  type DailyRow = { sku_ms: string; metric_date: string; revenue: number | null; ad_spend: number | null }
  const [dailyRows, prevDailyRows] = fromDate && toDate
    ? await Promise.all([
        fetchAll<DailyRow>(
          (sb) => {
            let q = sb.from('fact_sku_daily')
              .select('sku_ms, metric_date, revenue, ad_spend')
              .gte('metric_date', fromDate!).lte('metric_date', toDate!)
            // Фильтрация по категории/менеджеру через JOIN невозможна напрямую —
            // фильтруем в JS по dimByMs/snapByMs (snapshot уже загружен)
            return q
          },
          supabase,
        ),
        prevFrom && prevTo
          ? fetchAll<DailyRow>(
              (sb) => sb.from('fact_sku_daily')
                .select('sku_ms, metric_date, revenue, ad_spend')
                .gte('metric_date', prevFrom).lte('metric_date', prevTo),
              supabase,
            )
          : Promise.resolve([]),
      ])
    : [[], []]

  // Агрегация по SKU
  type SkuAgg = { revenue: number; ad_spend: number }
  const skuAgg: Record<string, SkuAgg> = {}
  for (const r of dailyRows) {
    if (!skuAgg[r.sku_ms]) skuAgg[r.sku_ms] = { revenue: 0, ad_spend: 0 }
    skuAgg[r.sku_ms].revenue  += r.revenue ?? 0
    skuAgg[r.sku_ms].ad_spend += r.ad_spend ?? 0
  }

  const prevSkuRev: Record<string, number> = {}
  for (const r of prevDailyRows) {
    prevSkuRev[r.sku_ms] = (prevSkuRev[r.sku_ms] ?? 0) + (r.revenue ?? 0)
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
    prevDateAgg[r.metric_date] = (prevDateAgg[r.metric_date] ?? 0) + r.revenue
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
    },
  } satisfies AnalyticsResponse)
}
