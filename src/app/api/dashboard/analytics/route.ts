import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/supabase/fetchAll'
import { rpcFetchAll } from '@/lib/supabase/rpcFetchAll'
import { cached, cacheGet, cacheSet } from '@/lib/cache'

export const maxDuration = 300

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

// Server-side кэш ответа analytics. Ключ = from|to|category|manager|novelty.
// Для длинных периодов (30+ дней) первый запрос строит ответ медленно — последующие моментально.
const ANALYTICS_RESPONSE_TTL_MS = 5 * 60_000

interface CachedAnalyticsResponse {
  body: unknown
  built_at: number
}

export async function GET(req: Request) {
  const t0 = Date.now()
  try {
  const supabase = createServiceClient()
  const url = new URL(req.url)
  const fromParam  = url.searchParams.get('from')
  const toParam    = url.searchParams.get('to')
  const catFilter  = url.searchParams.get('category') ?? ''
  const mgrFilter  = url.searchParams.get('manager') ?? ''
  const novFilter  = url.searchParams.get('novelty') ?? ''

  // ── Server-cache: проверка ДО любых тяжёлых запросов ─────────────────────
  const cacheKey = `analytics_response:${fromParam ?? '-'}:${toParam ?? '-'}:${catFilter}:${mgrFilter}:${novFilter}`
  const hit = cacheGet<CachedAnalyticsResponse>(cacheKey, ANALYTICS_RESPONSE_TTL_MS)
  if (hit) {
    const age = Math.floor((Date.now() - hit.built_at) / 1000)
    return new NextResponse(JSON.stringify(hit.body), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'x-cache': 'HIT',
        'x-cache-age-sec': String(age),
        'cache-control': `public, s-maxage=${Math.max(1, 300 - age)}, stale-while-revalidate=60`,
      },
    })
  }

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

  // ── 2. fact_sku_period — снапшотные поля (последний period_end) ──────────
  type SnapRow = {
    sku_ms: string; margin_pct: number | null; price: number | null
    manager: string | null; novelty_status: string | null; stock_days: number | null
    fbo_wb: number | null; fbs_pushkino: number | null; fbs_smolensk: number | null
  }
  const snapByMs: Record<string, SnapRow> = {}
  {
    const { data: maxSnapRow } = await supabase.from('fact_sku_period')
      .select('period_end').order('period_end', { ascending: false }).limit(1)
    const maxSnapDate = maxSnapRow?.[0]?.period_end
    if (maxSnapDate) {
      type PRow = {
        sku_ms: string; period_marginality_wgt: number | null; price: number | null
        manager: string | null; novelty_status: string | null; stock_days: number | null
        fbo_wb: number | null; fbs_pushkino: number | null; fbs_smolensk: number | null
      }
      const rows = await fetchAll<PRow>(
        (sb) => sb.from('fact_sku_period')
          .select('sku_ms, period_marginality_wgt, price, manager, novelty_status, stock_days, fbo_wb, fbs_pushkino, fbs_smolensk')
          .eq('period_end', maxSnapDate),
        supabase,
      )
      for (const r of rows) {
        if (!snapByMs[r.sku_ms]) snapByMs[r.sku_ms] = {
          sku_ms: r.sku_ms,
          margin_pct: r.period_marginality_wgt,
          price: r.price,
          manager: r.manager,
          novelty_status: r.novelty_status,
          stock_days: r.stock_days,
          fbo_wb: r.fbo_wb,
          fbs_pushkino: r.fbs_pushkino,
          fbs_smolensk: r.fbs_smolensk,
        }
      }
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

  // ── 4. Серверная агрегация через RPC analytics_period_agg / analytics_daily_agg ─
  // Раньше fetchAll тянул 300К+ строк fact_sku_daily в Node — timeout на 14+ днях.
  // Теперь Postgres агрегирует по SKU/дням, возвращая ~N_skus + N_days строк.
  // Migration: supabase/020_analytics_aggregate_rpcs.sql
  type SkuAggRpc = {
    sku_ms: string
    curr_revenue: number; curr_ad_spend: number; curr_chmd_rub: number
    curr_margin_rub: number; prev_revenue: number
  }
  type DailyAggRpc = {
    metric_date: string; is_current: boolean
    revenue: number; ad_spend: number; chmd_rub: number; margin_sum: number
  }

  // last_snap_period нужен для margin_sum в analytics_daily_agg (Σ revenue × margin_pct).
  // snapByMs уже построен из этого period_end — переиспользуем дату.
  const lastSnapDate = (await supabase.from('fact_sku_period')
    .select('period_end').order('period_end', { ascending: false }).limit(1)
  ).data?.[0]?.period_end ?? '1970-01-01'

  const haveDates = !!(fromDate && toDate && prevFrom && prevTo)
  // ВАЖНО: Supabase managed PostgREST режет любой одноразовый .range на 1000 строк
  // (серверный max-rows). Используем постраничный фетчер чтобы получить ВСЕ SKU,
  // иначе на 3-10К SKU теряли 60-80% выручки.
  const [periodAggRes, dailyAggRes] = haveDates
    ? await Promise.all([
        rpcFetchAll<SkuAggRpc>(() => supabase.rpc('analytics_period_agg', {
          p_from: fromDate, p_to: toDate, p_prev_from: prevFrom, p_prev_to: prevTo,
        })),
        rpcFetchAll<DailyAggRpc>(() => supabase.rpc('analytics_daily_agg', {
          p_from: fromDate, p_to: toDate, p_prev_from: prevFrom, p_prev_to: prevTo,
          p_snap_period: lastSnapDate,
        })),
      ])
    : [{ data: [] as SkuAggRpc[], error: null }, { data: [] as DailyAggRpc[], error: null }]

  // Если миграция ещё не применена — даём явный 503 с подсказкой
  if (periodAggRes.error || dailyAggRes.error) {
    const msg = (periodAggRes.error ?? dailyAggRes.error)?.message ?? 'unknown'
    if (/function|analytics_period_agg|analytics_daily_agg/i.test(msg)) {
      return NextResponse.json({
        error: 'Миграция 020_analytics_aggregate_rpcs не применена. Запустите supabase/020_analytics_aggregate_rpcs.sql в Supabase Studio → SQL editor.',
        details: msg,
      }, { status: 503 })
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  const periodAggRows: SkuAggRpc[] = periodAggRes.data ?? []
  const dailyAggRows:  DailyAggRpc[] = dailyAggRes.data ?? []

  // ── 5. Агрегация текущего периода ────────────────────────────────────────────
  let totalRevenue   = 0
  let totalAdSpend   = 0
  let totalMarginSum = 0
  let totalChmdSum   = 0

  // skuAgg: per-SKU суммы из RPC, плюс chmd-fallback rev×margin_pct когда chmd_rub=0
  // (для категорий где парсер sku-report не заполнил chmd_rub).
  const skuAgg: Record<string, { revenue: number; ad_spend: number; chmd: number; marginRub: number }> = {}
  const prevSkuRev: Record<string, number> = {}

  for (const r of periodAggRows) {
    const rev   = Number(r.curr_revenue ?? 0)
    const spend = Number(r.curr_ad_spend ?? 0)
    const mPct  = snapByMs[r.sku_ms]?.margin_pct ?? 0
    const chmdFromRpc = Number(r.curr_chmd_rub ?? 0)
    const chmd = chmdFromRpc !== 0 ? chmdFromRpc : (rev * mPct)

    totalRevenue   += rev
    totalAdSpend   += spend
    totalMarginSum += rev * mPct
    totalChmdSum   += chmd

    skuAgg[r.sku_ms] = {
      revenue:   rev,
      ad_spend:  spend,
      chmd,
      marginRub: Number(r.curr_margin_rub ?? 0),
    }
    if (r.prev_revenue && Number(r.prev_revenue) > 0) {
      prevSkuRev[r.sku_ms] = Number(r.prev_revenue)
    }
  }

  // dateAgg: per-date суммы из analytics_daily_agg (только текущий период)
  const dateAgg: Record<string, { revenue: number; ad_spend: number; marginSum: number; chmd: number }> = {}
  const prevDateAgg: Record<string, number> = {}
  for (const r of dailyAggRows) {
    const rev      = Number(r.revenue ?? 0)
    const spend    = Number(r.ad_spend ?? 0)
    const chmdRow  = Number(r.chmd_rub ?? 0)
    const margRow  = Number(r.margin_sum ?? 0)
    if (r.is_current) {
      dateAgg[r.metric_date] = {
        revenue:   rev,
        ad_spend:  spend,
        marginSum: margRow,
        chmd:      chmdRow !== 0 ? chmdRow : margRow,  // fallback для категорий без chmd_rub
      }
    } else {
      prevDateAgg[r.metric_date] = rev
    }
  }

  const marginPct          = totalRevenue > 0 ? totalMarginSum / totalRevenue : 0
  const totalChmd          = totalChmdSum
  const drr                = totalRevenue > 0 ? totalAdSpend / totalRevenue : 0
  const forecast30dRevenue = periodDays > 0 ? (totalRevenue / periodDays) * 30 : 0

  // ── 6. Агрегация предыдущего периода (из того же RPC) ────────────────────────
  let prevRevenue   = 0
  let prevAdSpend   = 0   // RPC не возвращает прошлый ad_spend per-SKU — итог из dailyAgg
  let prevMarginSum = 0
  let prevChmdSum   = 0
  for (const r of periodAggRows) {
    const prev   = Number(r.prev_revenue ?? 0)
    if (prev <= 0) continue
    const mPct   = snapByMs[r.sku_ms]?.margin_pct ?? 0
    prevRevenue   += prev
    prevMarginSum += prev * mPct
    prevChmdSum   += prev * mPct  // chmd fallback для прошлого периода (rev × margin_pct)
  }
  for (const r of dailyAggRows) {
    if (!r.is_current) prevAdSpend += Number(r.ad_spend ?? 0)
  }

  const prevChmd      = prevChmdSum
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
    const chmd         = s.chmd
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
      chmd:       d.chmd,
      ad_spend:   d.ad_spend,
      drr:        d.revenue > 0 ? d.ad_spend / d.revenue : 0,
      margin_pct: d.revenue > 0 ? d.marginSum / d.revenue : 0,
    }))

  const daily_chart_prev = Object.entries(prevDateAgg)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, revenue], i) => ({ day_index: i, date, revenue }))

  // ── 12. daily_by_sku — топ-50 SKU × max 14 дней (защита от timeout на длинных периодах).
  // ОБЪЁМ: 50 SKU × 14д = до 700 строк; URL .in() ~50 × ~40 chars = ~2KB < лимит PostgREST.
  // На периодах > 14 дней использовался только для:
  //   1) Excel-экспорта (sheet2) — не критично, можно опустить
  //   2) Пересчёт daily_chart при SKU-фильтре — фильтрация всё равно работает по hierarchy
  // Поэтому ограничиваем выборку только последними 14 днями (внутри выбранного периода).
  // Если запрос фейлит — возвращаем пустой массив, не валим весь response.
  const topSkuMs = Object.entries(skuAgg)
    .sort((a, b) => (b[1].revenue ?? 0) - (a[1].revenue ?? 0))
    .slice(0, 50)
    .map(([ms]) => ms)

  type DailyBySkuRow = { sku_ms: string; metric_date: string; revenue: number | null; ad_spend: number | null }
  let daily_by_sku: Array<{ sku_ms: string; date: string; revenue: number; ad_spend: number }> = []
  if (topSkuMs.length > 0 && fromDate && toDate) {
    // Берём только последние 14 дней из выбранного периода — для длинных периодов
    // (>14д) даём только хвост, иначе 200 SKU × 30+ дней = 6000+ строк и timeout.
    const sliceFrom = (() => {
      const t = new Date(toDate)
      const s = new Date(t); s.setDate(s.getDate() - 13)
      const sIso = s.toISOString().split('T')[0]
      return sIso < fromDate ? fromDate : sIso
    })()
    try {
      const { data: dailySliceRows, error: sliceErr } = await supabase
        .from('fact_sku_daily')
        .select('sku_ms, metric_date, revenue, ad_spend')
        .in('sku_ms', topSkuMs)
        .gte('metric_date', sliceFrom).lte('metric_date', toDate)
        .range(0, 9_999)
      if (sliceErr) {
        console.warn('[analytics] daily_by_sku slice error (non-fatal):', sliceErr.message)
      } else {
        daily_by_sku = ((dailySliceRows ?? []) as DailyBySkuRow[]).map(r => ({
          sku_ms: r.sku_ms,
          date:   r.metric_date,
          revenue:  r.revenue  ?? 0,
          ad_spend: r.ad_spend ?? 0,
        }))
      }
    } catch (e: unknown) {
      console.warn('[analytics] daily_by_sku threw (non-fatal):', e instanceof Error ? e.message : String(e))
    }
  }

  if (process.env.NODE_ENV !== 'production') {
    console.log(`[analytics] period: ${fromDate} – ${toDate}`)
    console.log(`[analytics] revenue: ${Math.round(totalRevenue).toLocaleString()} ₽`)
    console.log(`[analytics] SKUs with activity: ${Object.keys(skuAgg).length}`)
    console.log(`[analytics] period_agg rows: ${periodAggRows.length}, daily_agg rows: ${dailyAggRows.length}, daily_by_sku rows: ${daily_by_sku.length}`)
  }

  const _diag = {
    duration_ms: Date.now() - t0,
    period_days: periodDays,
    from: fromDate, to: toDate,
    prev_from: prevFrom, prev_to: prevTo,
    period_agg_rows: periodAggRows.length,
    daily_agg_rows: dailyAggRows.length,
    daily_by_sku_rows: daily_by_sku.length,
    top_skus_used: topSkuMs.length,
    sku_total: allSkuMs.size,
  }

  const body = {
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
    _diag,
  } as AnalyticsResponse & { _diag: typeof _diag }

  cacheSet<CachedAnalyticsResponse>(cacheKey, { body, built_at: Date.now() })

  return new NextResponse(JSON.stringify(body), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'x-cache': 'MISS',
      'cache-control': 'public, s-maxage=300, stale-while-revalidate=60',
    },
  })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[analytics] ERROR after', Date.now() - t0, 'ms:', msg)
    return NextResponse.json({ error: msg, _diag: { duration_ms: Date.now() - t0 } }, { status: 500 })
  }
}
