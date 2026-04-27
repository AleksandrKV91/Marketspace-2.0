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

  // ── 1. dim_sku — enrichment (name, brand, category) ──────────────────────
  type DimRow = {
    sku_ms: string; sku_wb: number | null; name: string | null
    brand: string | null; subject_wb: string | null; category_wb: string | null
  }
  const dimByMs: Record<string, DimRow> = {}
  const { data: dimData } = await supabase.from('dim_sku')
    .select('sku_ms, sku_wb, name, brand, subject_wb, category_wb')
  if (dimData) for (const r of dimData) dimByMs[r.sku_ms] = r

  // ── 2. fact_sku_daily — snap data (latest snap_date) ─────────────────────
  // Same approach as orders/analytics routes — sku_wb comes from here
  const { data: maxSnapRow } = await supabase.from('fact_sku_daily')
    .select('snap_date').not('snap_date', 'is', null)
    .order('snap_date', { ascending: false }).limit(1)
  const maxSnapDate = maxSnapRow?.[0]?.snap_date

  type SnapRow = {
    sku_ms: string; sku_wb: number | null
    fbo_wb: number | null; fbs_pushkino: number | null; fbs_smolensk: number | null
    kits_stock: number | null; stock_days: number | null; price: number | null
    margin_pct: number | null; manager: string | null; novelty_status: string | null
  }
  const snapByMs: Record<string, SnapRow> = {}
  if (maxSnapDate) {
    const snapRows = await fetchAll<SnapRow>(
      (sb) => sb.from('fact_sku_daily')
        .select('sku_ms, sku_wb, fbo_wb, fbs_pushkino, fbs_smolensk, kits_stock, stock_days, price, margin_pct, manager, novelty_status')
        .eq('snap_date', maxSnapDate),
      supabase,
    )
    for (const r of snapRows) { if (!snapByMs[r.sku_ms]) snapByMs[r.sku_ms] = r }
  }

  // ── 3. Date range ─────────────────────────────────────────────────────────
  let effectiveFrom = fromParam
  let effectiveTo = toParam
  if (!effectiveFrom || !effectiveTo) {
    const { data: maxRow } = await supabase.from('fact_sku_daily')
      .select('metric_date').order('metric_date', { ascending: false }).limit(1)
    const maxDate = maxRow?.[0]?.metric_date
    if (maxDate) {
      effectiveTo = maxDate
      const d = new Date(maxDate)
      d.setDate(d.getDate() - 6)
      effectiveFrom = d.toISOString().split('T')[0]
    }
  }

  // ── 4. Previous period ────────────────────────────────────────────────────
  let prevFrom: string | null = null
  let prevTo: string | null = null
  if (effectiveFrom && effectiveTo) {
    const days = Math.round(
      (new Date(effectiveTo).getTime() - new Date(effectiveFrom).getTime()) / 86400000
    ) + 1
    const pTo = new Date(effectiveFrom)
    pTo.setDate(pTo.getDate() - 1)
    const pFrom = new Date(pTo)
    pFrom.setDate(pFrom.getDate() - (days - 1))
    prevTo   = pTo.toISOString().split('T')[0]
    prevFrom = pFrom.toISOString().split('T')[0]
  }

  // ── 5. fact_sku_daily — daily metrics ────────────────────────────────────
  type DailyRow = {
    sku_ms: string; metric_date: string; revenue: number | null; ad_spend: number | null
    drr_total: number | null; ctr: number | null; cr_cart: number | null
    cr_order: number | null; cpm: number | null
  }
  const [dailyRows, prevDailyRows] = await Promise.all([
    effectiveFrom && effectiveTo
      ? fetchAll<DailyRow>(
          (sb) => sb.from('fact_sku_daily')
            .select('sku_ms, metric_date, revenue, ad_spend, drr_total, ctr, cr_cart, cr_order, cpm')
            .gte('metric_date', effectiveFrom!).lte('metric_date', effectiveTo!),
          supabase,
        )
      : Promise.resolve([]),
    prevFrom && prevTo
      ? fetchAll<Pick<DailyRow, 'sku_ms' | 'revenue'>>(
          (sb) => sb.from('fact_sku_daily')
            .select('sku_ms, revenue')
            .gte('metric_date', prevFrom!).lte('metric_date', prevTo!),
          supabase,
        )
      : Promise.resolve([]),
  ])

  // ── 6. Aggregate daily ────────────────────────────────────────────────────
  type DailyAgg = {
    revenue: number; ad_spend: number
    drr: number[]; ctr: number[]; cr_cart: number[]; cr_order: number[]; cpm: number[]
    days: number
  }
  const dailyByMs: Record<string, DailyAgg> = {}
  for (const r of dailyRows) {
    if (!dailyByMs[r.sku_ms]) dailyByMs[r.sku_ms] = { revenue: 0, ad_spend: 0, drr: [], ctr: [], cr_cart: [], cr_order: [], cpm: [], days: 0 }
    const d = dailyByMs[r.sku_ms]
    d.revenue  += r.revenue  ?? 0
    d.ad_spend += r.ad_spend ?? 0
    if (r.drr_total != null) d.drr.push(r.drr_total)
    if (r.ctr      != null) d.ctr.push(r.ctr)
    if (r.cr_cart  != null) d.cr_cart.push(r.cr_cart)
    if (r.cr_order != null) d.cr_order.push(r.cr_order)
    if (r.cpm      != null) d.cpm.push(r.cpm)
    d.days++
  }

  const prevRevByMs: Record<string, number> = {}
  for (const r of prevDailyRows) {
    prevRevByMs[r.sku_ms] = (prevRevByMs[r.sku_ms] ?? 0) + (r.revenue ?? 0)
  }

  // Universe: all SKUs with snap data; supplement with those that only have daily data
  const allSkuMs = new Set<string>([
    ...Object.keys(snapByMs),
    ...Object.keys(dailyByMs),
  ])

  const avg = (arr: number[]) => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null

  // ── 7. Build rows ─────────────────────────────────────────────────────────
  const rows = Array.from(allSkuMs).map(skuMs => {
    const snap  = snapByMs[skuMs]
    const dim   = dimByMs[skuMs]
    const daily = dailyByMs[skuMs]

    // sku_wb: prefer snap (most reliable), then dim_sku
    const skuWb = snap?.sku_wb ?? dim?.sku_wb ?? null

    const fbo      = snap?.fbo_wb       ?? 0
    const fbsPush  = snap?.fbs_pushkino ?? 0
    const fbsSmol  = snap?.fbs_smolensk ?? 0
    const kits     = snap?.kits_stock   ?? 0
    const totalStock = fbo + fbsPush + fbsSmol + kits

    const revenue  = daily?.revenue  ?? 0
    const adSpend  = daily?.ad_spend ?? 0
    const drr      = revenue > 0 ? adSpend / revenue : avg(daily?.drr ?? [])
    const ctr      = avg(daily?.ctr      ?? [])
    const cr_basket = avg(daily?.cr_cart ?? [])
    const cr_order = avg(daily?.cr_order ?? [])
    const cpo      = daily && daily.days > 0 && adSpend > 0 ? adSpend / daily.days : null
    const forecast30d = daily && daily.days > 0
      ? Math.round((revenue / daily.days) * 30)
      : null

    const marginPct  = snap?.margin_pct ?? 0
    const chmd       = revenue * marginPct - adSpend
    const stockDays  = snap?.stock_days ?? 0

    const oos_status: 'critical' | 'warning' | 'ok' =
      totalStock === 0 ? 'critical' : totalStock < 30 ? 'warning' : 'ok'
    const margin_status: 'high' | 'medium' | 'low' =
      marginPct > 0.20 ? 'high' : marginPct > 0.10 ? 'medium' : 'low'

    const score = computeScore({
      margin_pct:    marginPct,
      drr:           drr ?? 0,
      revenue_growth: 0,
      cr_order:      cr_order ?? 0,
      stock_days:    stockDays,
      is_oos:        totalStock === 0,
      drr_over_margin: drr != null && drr > marginPct,
      is_novelty_low: false,
    })

    return {
      sku:         String(skuWb ?? skuMs),
      sku_ms:      skuMs,
      name:        dim?.name ?? '',
      manager:     snap?.manager ?? '',
      category:    dim?.category_wb ?? dim?.subject_wb ?? '',
      revenue,
      margin_pct:  marginPct,
      chmd,
      drr:         drr ?? null,
      ctr,
      cr_basket,
      cr_order,
      stock_qty:   totalStock,
      fbo_wb:      fbo,
      fbs_pushkino: fbsPush,
      fbs_smolensk: fbsSmol,
      kits_stock:  kits,
      stock_days:  stockDays,
      price:       snap?.price ?? null,
      cpo,
      forecast_30d: forecast30d,
      delta_revenue_pct: (() => {
        const prev = prevRevByMs[skuMs]
        if (prev == null || prev === 0) return null
        return (revenue - prev) / prev
      })(),
      score,
      abc_class:     null,
      oos_status,
      margin_status,
      novelty: snap?.novelty_status === 'Новинки' || snap?.novelty_status === 'new',
    }
  })

  // ── 8. Filter ─────────────────────────────────────────────────────────────
  const searchLower = search.toLowerCase()
  const searchFiltered = search
    ? rows.filter(r =>
        r.sku_ms.toLowerCase().includes(searchLower) ||
        r.name.toLowerCase().includes(searchLower) ||
        String(r.sku).includes(search)
      )
    : rows

  const filteredRows = searchFiltered.filter(r => {
    if (categoryFilter && r.category !== categoryFilter) return false
    if (noveltyFilter === 'Новинки'    && !r.novelty) return false
    if (noveltyFilter === 'Не новинки' && r.novelty)  return false
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
