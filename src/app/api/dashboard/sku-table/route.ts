import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/supabase/fetchAll'
import { computeScore } from '@/lib/scoring'

export const maxDuration = 60

export async function GET(req: NextRequest) {
  try {
    return await handler(req)
  } catch (e) {
    console.error('[sku-table]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    )
  }
}

async function handler(req: NextRequest) {
  const supabase = createServiceClient()
  const { searchParams } = new URL(req.url)
  const search = (searchParams.get('search') ?? '').trim()
  const fromParam = searchParams.get('from')
  const toParam = searchParams.get('to')
  const categoryFilter = searchParams.get('category') ?? ''
  const noveltyFilter  = searchParams.get('gnovelty') ?? ''

  // Если даты не переданы — берём последние 7 дней из fact_sku_daily
  let effectiveFrom = fromParam
  let effectiveTo = toParam
  if (!effectiveFrom || !effectiveTo) {
    const { data: maxRow } = await supabase
      .from('fact_sku_daily').select('metric_date').order('metric_date', { ascending: false }).limit(1)
    const maxDate = maxRow?.[0]?.metric_date
    if (maxDate) {
      effectiveTo = maxDate
      const d = new Date(maxDate)
      d.setDate(d.getDate() - 6)
      effectiveFrom = d.toISOString().split('T')[0]
    }
  }

  // E.6: вычислить предыдущий период той же длины
  let prevFrom: string | null = null
  let prevTo: string | null = null
  if (effectiveFrom && effectiveTo) {
    const days = Math.round(
      (new Date(effectiveTo).getTime() - new Date(effectiveFrom).getTime()) / 86400000
    ) + 1
    if (days === 1) {
      // Однодневный диапазон: сравниваем со вчера
      const pTo = new Date(effectiveFrom)
      pTo.setDate(pTo.getDate() - 1)
      prevTo   = pTo.toISOString().split('T')[0]
      prevFrom = prevTo
    } else {
      // Многодневный: предыдущий период той же длины
      const pTo = new Date(effectiveFrom)
      pTo.setDate(pTo.getDate() - 1)
      const pFrom = new Date(pTo)
      pFrom.setDate(pFrom.getDate() - (days - 1))
      prevTo   = pTo.toISOString().split('T')[0]
      prevFrom = pFrom.toISOString().split('T')[0]
    }
  }

  // fact_sku_daily — primary source, universe of SKUs
  type DailyRow = {
    sku_ms: string; metric_date: string; revenue: number | null; ad_spend: number | null
    drr_total: number | null; ctr: number | null; cr_cart: number | null
    cr_order: number | null; cpm: number | null; cpc: number | null; ad_order_share: number | null
  }
  const dailyRows = effectiveFrom && effectiveTo
    ? await fetchAll<DailyRow>(
        (sb) => sb.from('fact_sku_daily')
          .select('sku_ms, metric_date, revenue, ad_spend, drr_total, ctr, cr_cart, cr_order, cpm, cpc, ad_order_share')
          .gte('metric_date', effectiveFrom!).lte('metric_date', effectiveTo!),
        supabase,
      )
    : []

  if (!dailyRows.length) return NextResponse.json({ rows: [], total: 0, selected_count: 0, selected_revenue: 0 })

  // Unique SKUs from fact_sku_daily
  const skuMsSet = new Set(dailyRows.map(r => r.sku_ms))
  const skuMsList = Array.from(skuMsSet)

  // dim_sku — optional enrichment (name, brand, category); ignore errors
  type DimRow = { sku_ms: string; sku_wb: number | null; name: string | null; brand: string | null; subject_wb: string | null; category_wb: string | null }
  const dimByMs: Record<string, DimRow> = {}
  const { data: dimData } = await supabase.from('dim_sku')
    .select('sku_ms, sku_wb, name, brand, subject_wb, category_wb')
    .in('sku_ms', skuMsList)
  if (dimData) for (const r of dimData) dimByMs[r.sku_ms] = r

  // daily_agg_sku — reliable sku_wb mapping (latest date)
  const skuWbByMs: Record<string, number> = {}
  const { data: maxAggDateRow } = await supabase.from('daily_agg_sku')
    .select('metric_date').order('metric_date', { ascending: false }).limit(1)
  const maxAggDate = maxAggDateRow?.[0]?.metric_date
  if (maxAggDate) {
    const { data: aggData } = await supabase.from('daily_agg_sku')
      .select('sku_ms, sku_wb')
      .eq('metric_date', maxAggDate)
      .in('sku_ms', skuMsList)
    if (aggData) for (const r of aggData) {
      if (r.sku_wb && !skuWbByMs[r.sku_ms]) skuWbByMs[r.sku_ms] = r.sku_wb
    }
  }

  // Prev period from fact_sku_daily
  const prevDailyRows = prevFrom && prevTo
    ? await fetchAll<Pick<DailyRow, 'sku_ms' | 'revenue'>>(
        (sb) => sb.from('fact_sku_daily')
          .select('sku_ms, revenue')
          .gte('metric_date', prevFrom!).lte('metric_date', prevTo!),
        supabase,
      )
    : []

  // Агрегация предыдущего периода по SKU (только revenue для delta)
  const prevRevByMs: Record<string, number> = {}
  for (const r of prevDailyRows) {
    prevRevByMs[r.sku_ms] = (prevRevByMs[r.sku_ms] ?? 0) + (r.revenue ?? 0)
  }

  // Агрегация daily по SKU
  type DailyAgg = { revenue: number; ad_spend: number; drr: number[]; ctr: number[]; cr_cart: number[]; cr_order: number[]; cpm: number[]; days: number }
  const dailyByMs: Record<string, DailyAgg> = {}
  for (const r of dailyRows) {
    if (!dailyByMs[r.sku_ms]) dailyByMs[r.sku_ms] = { revenue: 0, ad_spend: 0, drr: [], ctr: [], cr_cart: [], cr_order: [], cpm: [], days: 0 }
    const d = dailyByMs[r.sku_ms]
    d.revenue += r.revenue ?? 0
    d.ad_spend += r.ad_spend ?? 0
    if (r.drr_total != null) d.drr.push(r.drr_total)
    if (r.ctr != null) d.ctr.push(r.ctr)
    if (r.cr_cart != null) d.cr_cart.push(r.cr_cart)
    if (r.cr_order != null) d.cr_order.push(r.cr_order)
    if (r.cpm != null) d.cpm.push(r.cpm)
    d.days++
  }

  // Снапшот из fact_sku_snapshot (последняя snap_date)
  const { data: maxSnapRow } = await supabase.from('fact_sku_snapshot')
    .select('snap_date').not('snap_date', 'is', null)
    .order('snap_date', { ascending: false }).limit(1)
  const maxSnapDate = maxSnapRow?.[0]?.snap_date

  type SnapRow = {
    sku_ms: string
    fbo_wb: number | null
    fbs_pushkino: number | null
  }
  const snapByMs: Record<string, SnapRow> = {}
  if (maxSnapDate) {
    const snapRows = await fetchAll<SnapRow>(
      (sb) => sb.from('fact_sku_snapshot')
        .select('sku_ms, fbo_wb, fbs_pushkino')
        .eq('snap_date', maxSnapDate),
      supabase,
    )
    for (const r of snapRows) { if (!snapByMs[r.sku_ms]) snapByMs[r.sku_ms] = r }
  }

  const avg = (arr: number[]) => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null

  // Собираем строки — итерируем по skuMsList (из fact_sku_daily)
  const rows = skuMsList.map(skuMs => {
    const dim = dimByMs[skuMs]
    const skuSnap = snapByMs[skuMs]
    const daily = dailyByMs[skuMs]

    const fbo = skuSnap?.fbo_wb ?? 0
    const fbsPush = skuSnap?.fbs_pushkino ?? 0
    const totalStock = fbo + fbsPush

    const revenue = daily?.revenue ?? 0
    const adSpend = daily?.ad_spend ?? 0
    const drr = revenue > 0 ? adSpend / revenue : (avg(daily?.drr ?? []))
    const ctr = avg(daily?.ctr ?? [])
    const cr_basket = avg(daily?.cr_cart ?? [])
    const cr_order = avg(daily?.cr_order ?? [])
    const cpo = daily && daily.days > 0 && adSpend > 0 ? adSpend / daily.days : null

    // Прогноз 30д в рублях = (выручка за период / кол-во дней) × 30
    const forecast30d = daily && daily.days > 0
      ? Math.round((revenue / daily.days) * 30)
      : null
    const marginPct = 0
    const chmd = 0
    const stockDays = 0

    const oos_status: 'critical' | 'warning' | 'ok' =
      totalStock === 0 ? 'critical' : totalStock < 30 ? 'warning' : 'ok'
    const margin_status: 'high' | 'medium' | 'low' =
      marginPct > 0.20 ? 'high' : marginPct > 0.10 ? 'medium' : 'low'

    const score = computeScore({
      margin_pct: marginPct,
      drr: drr ?? 0,
      revenue_growth: 0,
      cr_order: cr_order ?? 0,
      stock_days: stockDays,
      is_oos: totalStock === 0,
      drr_over_margin: drr != null && drr > marginPct,
      is_novelty_low: false,
    })

    return {
      sku: String(skuWbByMs[skuMs] ?? dim?.sku_wb ?? skuMs),
      sku_ms: skuMs,
      name: dim?.name ?? '',
      manager: '',
      category: dim?.category_wb ?? dim?.subject_wb ?? '',
      revenue,
      margin_pct: marginPct,
      chmd,
      drr: drr ?? null,
      ctr,
      cr_basket,
      cr_order,
      stock_qty: totalStock,
      fbo_wb: fbo,
      fbs_pushkino: fbsPush,
      fbs_smolensk: 0,
      kits_stock: 0,
      stock_days: stockDays,
      price: null,
      cpo,
      forecast_30d: forecast30d,
      delta_revenue_pct: (() => {
        const prev = prevRevByMs[skuMs]
        if (prev == null || prev === 0) return null
        return (revenue - prev) / prev
      })(),
      score,
      abc_class: null,
      oos_status,
      margin_status,
      novelty: false,
    }
  })

  // Apply search filter in JS
  const searchLower = search.toLowerCase()
  const searchFiltered = search
    ? rows.filter(r =>
        r.sku_ms.toLowerCase().includes(searchLower) ||
        r.name.toLowerCase().includes(searchLower)
      )
    : rows

  // Apply global filters (category, novelty)
  const filteredRows = searchFiltered.filter(r => {
    if (categoryFilter && r.category !== categoryFilter) return false
    if (noveltyFilter === 'Новинки'    && !r.novelty)   return false
    if (noveltyFilter === 'Не новинки' && r.novelty)   return false
    return true
  })

  const totalRevenue = filteredRows.reduce((s, r) => s + r.revenue, 0)

  return NextResponse.json({
    rows: filteredRows,
    total: filteredRows.length,
    selected_count: filteredRows.length,
    selected_revenue: totalRevenue,
  })
}
