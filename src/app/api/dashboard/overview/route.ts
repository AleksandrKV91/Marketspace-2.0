import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/supabase/fetchAll'
import { computeScore } from '@/lib/scoring'
import { cacheGet, cacheSet } from '@/lib/cache'

export const maxDuration = 60

// ── Lead-time по стране ──────────────────────────────────────────────────────

const LEAD_TIME_BY_COUNTRY: Record<string, number> = {
  'китай': 100, 'china': 100,
  'пакистан': 100, 'pakistan': 100,
  'тайланд': 100, 'таиланд': 100, 'thailand': 100,
  'италия': 75, 'italy': 75,
  'польша': 75, 'poland': 75,
  'франция': 75, 'france': 75,
  'испания': 75, 'spain': 75,
  'швейцария': 75, 'switzerland': 75,
  'турция': 75, 'turkey': 75,
  'германия': 75, 'germany': 75,
  'корея': 75, 'korea': 75,
  'венгрия': 75, 'hungary': 75,
  'сербия': 75, 'serbia': 75,
  'литва': 75, 'lithuania': 75,
  'великобритания': 75, 'uk': 75, 'england': 75,
  'россия': 10, 'russia': 10,
  'беларусь': 10, 'belarus': 10,
}
const DEFAULT_LEAD_TIME = 45

function getLeadTime(country: string | null | undefined, chinaLeadTime: number | null | undefined): number {
  if (chinaLeadTime && chinaLeadTime > 0) return chinaLeadTime
  if (!country) return DEFAULT_LEAD_TIME
  const key = country.toLowerCase().trim()
  return LEAD_TIME_BY_COUNTRY[key] ?? DEFAULT_LEAD_TIME
}

// ── Вспомогательные ──────────────────────────────────────────────────────────

function median(arr: number[]): number {
  if (!arr.length) return 0
  const sorted = [...arr].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function shiftRange(from: string, to: string): { prevFrom: string; prevTo: string } {
  const f = new Date(from)
  const t = new Date(to)
  const days = Math.round((t.getTime() - f.getTime()) / 86400000) + 1
  const prevTo = new Date(f); prevTo.setDate(prevTo.getDate() - 1)
  const prevFrom = new Date(prevTo); prevFrom.setDate(prevFrom.getDate() - (days - 1))
  return {
    prevFrom: prevFrom.toISOString().split('T')[0],
    prevTo:   prevTo.toISOString().split('T')[0],
  }
}

// ── GET ──────────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const supabase = createServiceClient()
  const url = new URL(req.url)
  const fromParam  = url.searchParams.get('from')
  const toParam    = url.searchParams.get('to')
  const catFilter  = url.searchParams.get('category') ?? ''
  const mgrFilter  = url.searchParams.get('manager') ?? ''
  const novFilter  = url.searchParams.get('novelty') ?? ''   // 'Новинки' | 'Не новинки' | ''

  // Быстрая проверка кэша — TTL 5 мин. Инвалидируется после загрузки нового отчёта.
  const cacheKey = `overview|${fromParam ?? 'auto'}|${toParam ?? 'auto'}|${catFilter}|${mgrFilter}|${novFilter}`
  const cacheHit = cacheGet<unknown>(cacheKey, 5 * 60_000)
  if (cacheHit !== null) return NextResponse.json(cacheHit)

  // ── 1. Последние upload IDs ───────────────────────────────────────────────
  const { data: lastUploads } = await supabase
    .from('uploads').select('id, file_type')
    .eq('status', 'ok').order('uploaded_at', { ascending: false }).limit(20)

  const latestByType: Record<string, string> = {}
  if (lastUploads) for (const u of lastUploads) {
    if (!latestByType[u.file_type]) latestByType[u.file_type] = u.id
  }

  const abcId    = latestByType['abc']
  const skuRepId = latestByType['sku_report']
  const chinaId  = latestByType['china']

  // ── 2. dim_sku ────────────────────────────────────────────────────────────
  const dimRows = await fetchAll<{
    sku_ms: string; sku_wb: number | null; name: string | null
    category_wb: string | null; subject_wb: string | null; country: string | null
  }>(
    (sb) => sb.from('dim_sku').select('sku_ms, sku_wb, name, category_wb, subject_wb, country'),
    supabase,
  )
  const dimByMs: Record<string, typeof dimRows[0]> = {}
  const dimByWb: Record<number, string> = {}
  for (const r of dimRows) {
    dimByMs[r.sku_ms] = r
    if (r.sku_wb) dimByWb[r.sku_wb] = r.sku_ms
  }

  // ── 3. fact_sku_daily — снапшотные поля (последняя snap_date) ────────────
  type SnapRow = {
    sku_ms: string; margin_pct: number | null
    chmd_5d: number | null; manager: string | null; price: number | null
    stock_days: number | null; novelty_status: string | null
    fbo_wb: number | null; fbs_pushkino: number | null; fbs_smolensk: number | null
    snap_date: string | null
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
          .select('sku_ms, margin_pct, chmd_5d, manager, price, stock_days, novelty_status, fbo_wb, fbs_pushkino, fbs_smolensk, snap_date')
          .eq('snap_date', maxSnapDate),
        supabase,
      )
      for (const r of rows) { if (!snapByMs[r.sku_ms]) snapByMs[r.sku_ms] = r }
    }
  }

  // ── 5. fact_china_supply ─────────────────────────────────────────────────
  const chinaByMs: Record<string, { lead_time_days: number | null; in_transit: number | null }> = {}
  if (chinaId) {
    const { data } = await supabase.from('fact_china_supply')
      .select('sku_ms, lead_time_days, in_transit').eq('upload_id', chinaId)
    if (data) for (const r of data) chinaByMs[r.sku_ms] = r
  }

  // ── 6. ABC ────────────────────────────────────────────────────────────────
  const abcCounts = { A: 0, B: 0, C: 0 }
  const abcByMs: Record<string, string | null> = {}
  if (abcId) {
    const { data } = await supabase.from('fact_abc')
      .select('sku_ms, abc_class').eq('upload_id', abcId)
    if (data) for (const r of data) {
      abcByMs[r.sku_ms] = r.abc_class
      const cls = (r.abc_class ?? '').toUpperCase().charAt(0)
      if (cls === 'A') abcCounts.A++
      else if (cls === 'B') abcCounts.B++
      else if (cls === 'C') abcCounts.C++
    }
  }

  // ── 7. Определяем диапазон дат ───────────────────────────────────────────
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

  // ── 8. fact_sku_daily — текущий период ──────────────────────────────────
  // margin_pct нужен для per-day ЧМД в трендовом графике
  type DailyRow = { sku_ms: string; metric_date: string; revenue: number | null; ad_spend: number | null; ctr: number | null; cr_order: number | null; margin_pct: number | null }
  const dailyRows = fromDate && toDate
    ? await fetchAll<DailyRow>(
        (sb) => sb.from('fact_sku_daily')
          .select('sku_ms, metric_date, revenue, ad_spend, ctr, cr_order, margin_pct')
          .gte('metric_date', fromDate!).lte('metric_date', toDate!),
        supabase,
      )
    : []

  // ── 9. fact_sku_daily — предыдущий период ───────────────────────────────
  const { prevFrom, prevTo } = fromDate && toDate
    ? shiftRange(fromDate, toDate)
    : { prevFrom: null as null | string, prevTo: null as null | string }

  const prevDailyRows = prevFrom && prevTo
    ? await fetchAll<DailyRow>(
        (sb) => sb.from('fact_sku_daily')
          .select('sku_ms, metric_date, revenue, ad_spend, ctr, cr_order, margin_pct')
          .gte('metric_date', prevFrom).lte('metric_date', prevTo),
        supabase,
      )
    : []

  // ── 11. Агрегация по SKU — текущий период ────────────────────────────────
  type SkuAgg = { revenue: number; ad_spend: number; ctr: number[]; cr_order: number[]; days: Set<string> }
  const skuAgg: Record<string, SkuAgg> = {}
  const dateAgg: Record<string, { revenue: number; ad_spend: number; chmd: number }> = {}

  for (const r of dailyRows) {
    if (!skuAgg[r.sku_ms]) skuAgg[r.sku_ms] = { revenue: 0, ad_spend: 0, ctr: [], cr_order: [], days: new Set() }
    const s = skuAgg[r.sku_ms]
    s.revenue += r.revenue ?? 0
    s.ad_spend += r.ad_spend ?? 0
    if (r.ctr != null) s.ctr.push(r.ctr)
    if (r.cr_order != null) s.cr_order.push(r.cr_order)
    s.days.add(r.metric_date)

    if (!dateAgg[r.metric_date]) dateAgg[r.metric_date] = { revenue: 0, ad_spend: 0, chmd: 0 }
    const rev = r.revenue ?? 0
    const spend = r.ad_spend ?? 0
    const mp = r.margin_pct ?? 0
    dateAgg[r.metric_date].revenue += rev
    dateAgg[r.metric_date].ad_spend += spend
    // ЧМД per-SKU per-day = revenue * margin_pct − ad_spend
    dateAgg[r.metric_date].chmd += rev * mp - spend
  }

  // ── 12. Агрегация по SKU — предыдущий период ─────────────────────────────
  const prevSkuAgg: Record<string, { revenue: number; ad_spend: number }> = {}
  for (const r of prevDailyRows) {
    if (!prevSkuAgg[r.sku_ms]) prevSkuAgg[r.sku_ms] = { revenue: 0, ad_spend: 0 }
    prevSkuAgg[r.sku_ms].revenue += r.revenue ?? 0
    prevSkuAgg[r.sku_ms].ad_spend += r.ad_spend ?? 0
  }

  const periodDays = fromDate && toDate
    ? Math.max(1, Math.round((new Date(toDate).getTime() - new Date(fromDate).getTime()) / 86400000) + 1)
    : 30

  // ── 14. Медианные CTR и CR ────────────────────────────────────────────────
  const allCtrs = dailyRows.filter(r => r.ctr != null).map(r => r.ctr!)
  const allCrs  = dailyRows.filter(r => r.cr_order != null).map(r => r.cr_order!)
  const medianCtr = median(allCtrs)
  const medianCr  = median(allCrs)

  // ── 15. Набор SKU после фильтрации ───────────────────────────────────────
  // Набор SKU: из fact_sku_daily (все SKU) + снапшот
  const filteredSkuMs = new Set<string>([...Object.keys(skuAgg), ...Object.keys(snapByMs)])
  if (catFilter || mgrFilter || novFilter) {
    for (const ms of [...filteredSkuMs]) {
      const dim  = dimByMs[ms]
      const snap = snapByMs[ms]
      if (catFilter && (dim?.category_wb ?? '') !== catFilter) { filteredSkuMs.delete(ms); continue }
      if (mgrFilter && (snap?.manager ?? '') !== mgrFilter) { filteredSkuMs.delete(ms); continue }
      if (novFilter === 'Новинки' && snap?.novelty_status !== 'Новинки') { filteredSkuMs.delete(ms); continue }
      if (novFilter === 'Не новинки' && snap?.novelty_status === 'Новинки') { filteredSkuMs.delete(ms); continue }
    }
  }

  // ── 16. KPI — текущий период ─────────────────────────────────────────────
  // ЧМД считается per-SKU: chmd_sku = revenue_sku × margin_pct_sku − ad_spend_sku
  // Итого: ∑chmd_sku
  let totalRevenue  = 0
  let totalAdSpend  = 0
  let totalChmd     = 0
  let totalCostOfGoods = 0
  let lostRevenue   = 0
  const lostDetailMap: Record<string, { sku_ms: string; name: string; sku_wb: number | null; lost_oos: number; lost_ads: number }> = {}

  // Для Δ предыдущего периода
  let prevRevenue  = 0
  let prevAdSpend  = 0
  let prevChmd     = 0

  // Alerts
  let stopAdsCount      = 0
  let soonOosCount      = 0
  let drrOverMarginCount = 0
  let highCtrLowCrCount  = 0
  let highCpoCount       = 0   // ДРР > 35%  (высокий CPO)
  let canScaleCount      = 0   // ДРР < 50% от маржи, CTR ≥ медианы, CR ≥ медианы
  let noveltyRiskCount   = 0   // Новинка + выручка < 10 000 за период

  // Для margin_distribution
  const marginBuckets = {
    neg:      0,  // < 0%
    low:      0,  // 0–10%
    mid:      0,  // 10–20%
    ok:       0,  // 20–30%
    good:     0,  // ≥ 30%
  }

  // Фокус дня — детали по каждому типу алерта
  const focusStopAds:  Array<{ sku_ms: string; name: string; ad_spend: number; sku_wb: number | null }> = []
  const focusSoonOos:  Array<{ sku_ms: string; name: string; stock_days: number; lead_time: number; revenue_per_day: number; sku_wb: number | null }> = []
  const focusDrrMargin: Array<{ sku_ms: string; name: string; drr: number; margin_pct: number; revenue: number; sku_wb: number | null }> = []
  const focusNovelty:  Array<{ sku_ms: string; name: string; revenue: number; sku_wb: number | null }> = []
  const focusCanScale: Array<{ sku_ms: string; name: string; revenue: number; drr: number; sku_wb: number | null }> = []

  for (const ms of filteredSkuMs) {
    const s    = skuAgg[ms] ?? { revenue: 0, ad_spend: 0, ctr: [], cr_order: [], days: new Set<string>() }
    const snap = snapByMs[ms]
    const dim  = dimByMs[ms]
    const skuWb = dim?.sku_wb ?? null
    const china = chinaByMs[ms]

    const price      = snap?.price ?? 0
    const marginPct  = snap?.margin_pct ?? 0
    const totalStock = (snap?.fbo_wb ?? 0) + (snap?.fbs_pushkino ?? 0) + (snap?.fbs_smolensk ?? 0)
    const leadTime   = getLeadTime(dim?.country, china?.lead_time_days)
    const stockDays  = snap?.stock_days ?? (totalStock > 0 ? null : 0)

    const drr    = s.revenue > 0 ? s.ad_spend / s.revenue : 0
    const avgCtr = s.ctr.length ? s.ctr.reduce((a, b) => a + b, 0) / s.ctr.length : 0
    const avgCr  = s.cr_order.length ? s.cr_order.reduce((a, b) => a + b, 0) / s.cr_order.length : 0

    // KPI totals
    totalRevenue += s.revenue
    totalAdSpend += s.ad_spend
    // ЧМД per-SKU = revenue × margin_pct − ad_spend
    const chmdSku = s.revenue * marginPct - s.ad_spend
    totalChmd += chmdSku
    // Себестоимость = revenue × (1 − margin_pct)
    totalCostOfGoods += s.revenue * (1 - marginPct)

    // Предыдущий период
    const prev = prevSkuAgg[ms]
    if (prev) {
      prevRevenue += prev.revenue
      prevAdSpend += prev.ad_spend
      prevChmd += prev.revenue * marginPct - prev.ad_spend
    }

    // Упущенная выручка OOS
    let skuLostOos = 0
    let skuLostAds = 0
    if (totalStock === 0 && s.ad_spend > 0) {
      skuLostAds = s.ad_spend
      lostRevenue += skuLostAds
    }
    if (skuLostAds > 0) {
      lostDetailMap[ms] = { sku_ms: ms, name: dim?.name ?? ms, sku_wb: skuWb, lost_oos: 0, lost_ads: skuLostAds }
    }

    // ── Alerts ──────────────────────────────────────────────────────────────

    // STOP: OOS + активная реклама
    if (totalStock === 0 && s.ad_spend > 0) {
      stopAdsCount++
      if (focusStopAds.length < 5) focusStopAds.push({ sku_ms: ms, name: dim?.name ?? ms, ad_spend: s.ad_spend, sku_wb: skuWb })
    }

    // Скоро OOS: запас < lead_time
    if (totalStock > 0 && stockDays != null && stockDays < leadTime) {
      soonOosCount++
      if (focusSoonOos.length < 5) focusSoonOos.push({
        sku_ms: ms, name: dim?.name ?? ms,
        stock_days: stockDays, lead_time: leadTime,
        revenue_per_day: periodDays > 0 ? s.revenue / periodDays : 0,
        sku_wb: skuWb,
      })
    }

    // ДРР > Маржа
    if (marginPct > 0 && drr > marginPct) {
      drrOverMarginCount++
      if (focusDrrMargin.length < 5) focusDrrMargin.push({
        sku_ms: ms, name: dim?.name ?? ms,
        drr, margin_pct: marginPct, revenue: s.revenue, sku_wb: skuWb,
      })
    }

    // Высокий CTR + низкий CR (потенциал карточки)
    if (medianCtr > 0 && medianCr > 0 && avgCtr > medianCtr && avgCr < medianCr) {
      highCtrLowCrCount++
    }

    // Высокий CPO: ДРР > 35%
    if (drr > 0.35 && s.revenue > 0) {
      highCpoCount++
    }

    // Можно масштабировать: ДРР < 50% маржи, CTR ≥ медиана, CR ≥ медиана
    if (
      marginPct > 0 && drr > 0 && drr < marginPct * 0.5 &&
      medianCtr > 0 && avgCtr >= medianCtr &&
      medianCr > 0  && avgCr  >= medianCr  &&
      s.revenue > 0
    ) {
      canScaleCount++
      if (focusCanScale.length < 5) focusCanScale.push({
        sku_ms: ms, name: dim?.name ?? ms, revenue: s.revenue, drr, sku_wb: skuWb,
      })
    }

    // Новинка в зоне риска: новинка + выручка < 10 000 за период
    if (snap?.novelty_status === 'Новинки' && s.revenue < 10000) {
      noveltyRiskCount++
      if (focusNovelty.length < 5) focusNovelty.push({
        sku_ms: ms, name: dim?.name ?? ms, revenue: s.revenue, sku_wb: skuWb,
      })
    }

  }

  // ── 17. Margin distribution по ВСЕМ SKU из snapshot ─────────────────────
  marginBuckets.neg = 0; marginBuckets.low = 0; marginBuckets.mid = 0
  marginBuckets.ok = 0; marginBuckets.good = 0
  for (const [ms, snap] of Object.entries(snapByMs)) {
    if (catFilter && (dimByMs[ms]?.category_wb ?? '') !== catFilter) continue
    if (mgrFilter && (snap.manager ?? '') !== mgrFilter) continue
    if (novFilter === 'Новинки' && snap.novelty_status !== 'Новинки') continue
    if (novFilter === 'Не новинки' && snap.novelty_status === 'Новинки') continue
    const mp = snap.margin_pct
    if (mp == null) continue
    if (mp < 0) marginBuckets.neg++
    else if (mp < 0.10) marginBuckets.low++
    else if (mp < 0.20) marginBuckets.mid++
    else if (mp < 0.30) marginBuckets.ok++
    else marginBuckets.good++
  }

  // ── 18. Средневзвешенная маржа (для unitEcon графика) ────────────────────
  let wMarginNum = 0, wMarginDen = 0
  for (const ms of filteredSkuMs) {
    const s    = skuAgg[ms] ?? { revenue: 0, ad_spend: 0, ctr: [], cr_order: [], days: new Set<string>() }
    const snap = snapByMs[ms]
    const mp   = snap?.margin_pct ?? null
    if (mp != null && s.revenue > 0) {
      wMarginNum += mp * s.revenue
      wMarginDen += s.revenue
    }
  }
  const avgMarginPct = wMarginDen > 0 ? wMarginNum / wMarginDen : 0

  // Предыдущая средневзвешенная маржа (по тем же snapshot + prev revenue)
  let prevWMarginNum = 0, prevWMarginDen = 0
  for (const ms of filteredSkuMs) {
    const prev = prevSkuAgg[ms]
    const snap = snapByMs[ms]
    const mp   = snap?.margin_pct ?? null
    if (mp != null && prev && prev.revenue > 0) {
      prevWMarginNum += mp * prev.revenue
      prevWMarginDen += prev.revenue
    }
  }
  const prevAvgMarginPct = prevWMarginDen > 0 ? prevWMarginNum / prevWMarginDen : 0

  // ── 18. KPI Δ ─────────────────────────────────────────────────────────────
  function pct(curr: number, prev: number): number | null {
    if (prev === 0) return null
    return (curr - prev) / Math.abs(prev)
  }

  const prevTotalAdSpend = prevAdSpend
  const kpiDelta = {
    revenue:       pct(totalRevenue, prevRevenue),
    chmd:          pct(totalChmd, prevChmd),
    avg_margin_pct: prevAvgMarginPct > 0 ? pct(avgMarginPct, prevAvgMarginPct) : null as number | null,
    drr: totalRevenue > 0 && prevRevenue > 0
      ? pct(totalRevenue > 0 ? totalAdSpend / totalRevenue : 0, prevRevenue > 0 ? prevTotalAdSpend / prevRevenue : 0)
      : null,
    ad_spend:      pct(totalAdSpend, prevAdSpend),
    cost_of_goods: null as number | null,
    lost_revenue:  null as number | null,
  }

  // ── 19. График по дням ────────────────────────────────────────────────────
  // ЧМД per-day уже аккумулирован в dateAgg[date].chmd (per-SKU per-day расчёт)
  const trend = Object.entries(dateAgg)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, d]) => ({
      date,
      revenue:  d.revenue,
      chmd:     d.chmd,
      ad_spend: d.ad_spend,
    }))

  // ── 20. Unit-экономика по дням ────────────────────────────────────────────
  const unitEconByDay = trend.map(d => ({
    date: d.date,
    margin_pct: +(avgMarginPct * 100).toFixed(2),
    drr_pct:  d.revenue > 0 ? +((d.ad_spend / d.revenue) * 100).toFixed(2) : 0,
    chmd_pct: d.revenue > 0 ? +((d.chmd  / d.revenue) * 100).toFixed(2) : 0,
  }))

  // ── 21. Top-15 SKU по Score ───────────────────────────────────────────────
  const top15 = [...filteredSkuMs]
    .map(ms => {
      const s    = skuAgg[ms] ?? { revenue: 0, ad_spend: 0, ctr: [], cr_order: [], days: new Set<string>() }
      const snap = snapByMs[ms]
      const dim  = dimByMs[ms]
      const skuWb = dim?.sku_wb ?? null
      const china = chinaByMs[ms]

      const marginPct  = snap?.margin_pct ?? 0
      const totalStock = (snap?.fbo_wb ?? 0) + (snap?.fbs_pushkino ?? 0) + (snap?.fbs_smolensk ?? 0)
      const leadTime   = getLeadTime(dim?.country, china?.lead_time_days)
      const stockDays  = snap?.stock_days ?? (totalStock > 0 ? null : 0)

      const drr   = s.revenue > 0 ? s.ad_spend / s.revenue : 0
      const avgCr = s.cr_order.length ? s.cr_order.reduce((a, b) => a + b, 0) / s.cr_order.length : 0
      const prev  = prevSkuAgg[ms]
      const revenueGrowth = prev && prev.revenue > 0 ? (s.revenue - prev.revenue) / prev.revenue : 0

      const score = computeScore({
        margin_pct: marginPct,
        drr,
        revenue_growth: revenueGrowth,
        cr_order: avgCr,
        median_cr: medianCr,
        stock_days: stockDays,
        lead_time_days: leadTime,
        is_oos: totalStock === 0,
        drr_over_margin: marginPct > 0 && drr > marginPct,
        is_novelty_low: snap?.novelty_status === 'Новинки' && s.revenue < 10000,
      })

      // ЧМД per-SKU
      const chmd = s.revenue * marginPct - s.ad_spend
      const costOfGoods = s.revenue * (1 - marginPct)

      return {
        sku_ms: ms,
        sku_wb: skuWb,
        name: dim?.name ?? ms,
        revenue: s.revenue,
        chmd,
        ad_spend: s.ad_spend,
        cost_of_goods: costOfGoods,
        total_stock: totalStock,
        drr,
        margin_pct: marginPct,
        stock_days: stockDays,
        lead_time: leadTime,
        abc_class: abcByMs[ms] ?? '—',
        novelty_status: snap?.novelty_status ?? null,
        score,
        is_oos: totalStock === 0,
      }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 15)

  // ── 22. Meta — для фильтров в хедере ─────────────────────────────────────
  const categoriesSet = new Set<string>()
  const managersSet   = new Set<string>()
  for (const r of dimRows) {
    if (r.category_wb) categoriesSet.add(r.category_wb)
  }
  for (const r of Object.values(snapByMs)) {
    if (r.manager) managersSet.add(r.manager)
  }

  // ── lost_detail: топ-10 SKU по упущенной выручке ─────────────────────────
  const lostDetail = Object.values(lostDetailMap)
    .map(d => ({ ...d, total: d.lost_oos + d.lost_ads }))
    .sort((a, b) => b.total - a.total)
    // no slice — show all SKUs with losses

  // ── Ответ ─────────────────────────────────────────────────────────────────
  const responseData = {
    kpi: {
      revenue:       totalRevenue,
      chmd:          totalChmd,
      avg_margin_pct: avgMarginPct,
      drr: totalRevenue > 0 ? totalAdSpend / totalRevenue : null,
      ad_spend:      totalAdSpend,
      cost_of_goods: totalCostOfGoods,
      lost_revenue:  lostRevenue,
      oos_count: [...filteredSkuMs].filter(ms => {
        const snap = snapByMs[ms]
        return ((snap?.fbo_wb ?? 0) + (snap?.fbs_pushkino ?? 0) + (snap?.fbs_smolensk ?? 0)) === 0
      }).length,
      sku_count: filteredSkuMs.size,
    },
    kpi_delta: kpiDelta,
    alerts: {
      stop_ads:        stopAdsCount,
      soon_oos:        soonOosCount,
      drr_over_margin: drrOverMarginCount,
      high_ctr_low_cr: highCtrLowCrCount,
      high_cpo:        highCpoCount,
      can_scale:       canScaleCount,
      novelty_risk:    noveltyRiskCount,
      lost_revenue:    lostRevenue,
    },
    focus: {
      stop_ads:    focusStopAds,
      soon_oos:    focusSoonOos,
      drr_margin:  focusDrrMargin,
      novelty:     focusNovelty,
      can_scale:   focusCanScale,
    },
    margin_distribution: marginBuckets,
    abc: abcCounts,
    trend,
    unit_econ: unitEconByDay,
    top15,
    latest_date: Object.keys(dateAgg).sort().at(-1) ?? null,
    period: { from: fromDate, to: toDate, prev_from: prevFrom, prev_to: prevTo },
    meta: {
      categories: [...categoriesSet].sort(),
      managers:   [...managersSet].sort(),
    },
    lost_detail: lostDetail,
    debug: {
      daily_rows_count: dailyRows.length,
      sku_with_revenue: Object.values(skuAgg).filter(s => s.revenue > 0).length,
      sku_no_revenue:   Object.values(skuAgg).filter(s => s.revenue === 0).length,
    },
  }
  cacheSet(cacheKey, responseData)
  return NextResponse.json(responseData)
}
