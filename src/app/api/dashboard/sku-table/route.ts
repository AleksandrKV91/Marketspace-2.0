import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/supabase/fetchAll'
import { rpcFetchAll } from '@/lib/supabase/rpcFetchAll'
import { computeScore } from '@/lib/scoring'
import { isNovelty, matchesNoveltyFilter } from '@/lib/novelty'

export const maxDuration = 300

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
  const dimData = await fetchAll<DimRow>(
    (sb) => sb.from('dim_sku').select('sku_ms, sku_wb, name, brand, subject_wb, category_wb'),
    supabase,
  )
  for (const r of dimData) dimByMs[r.sku_ms] = r

  // ── 2. fact_sku_period — snapshot (latest period_end) ────────────────────
  const { data: maxSnapRow } = await supabase.from('fact_sku_period')
    .select('period_end').order('period_end', { ascending: false }).limit(1)
  const maxSnapDate = maxSnapRow?.[0]?.period_end

  type SnapRow = {
    sku_ms: string; sku_wb: number | null
    fbo_wb: number | null; fbs_pushkino: number | null; fbs_smolensk: number | null
    kits_stock: number | null; stock_days: number | null; price: number | null
    margin_pct: number | null; manager: string | null; novelty_status: string | null
  }
  const snapByMs: Record<string, SnapRow> = {}
  if (maxSnapDate) {
    type PRow = {
      sku_ms: string; sku_wb: number | null
      fbo_wb: number | null; fbs_pushkino: number | null; fbs_smolensk: number | null
      kits_qty: number | null; stock_days: number | null; price: number | null
      period_marginality_wgt: number | null; manager: string | null; novelty_status: string | null
    }
    const periodRows = await fetchAll<PRow>(
      (sb) => sb.from('fact_sku_period')
        .select('sku_ms, sku_wb, fbo_wb, fbs_pushkino, fbs_smolensk, kits_qty, stock_days, price, period_marginality_wgt, manager, novelty_status')
        .eq('period_end', maxSnapDate),
      supabase,
    )
    for (const r of periodRows) {
      if (!snapByMs[r.sku_ms]) snapByMs[r.sku_ms] = {
        sku_ms: r.sku_ms, sku_wb: r.sku_wb,
        fbo_wb: r.fbo_wb, fbs_pushkino: r.fbs_pushkino, fbs_smolensk: r.fbs_smolensk,
        kits_stock: r.kits_qty, stock_days: r.stock_days, price: r.price,
        margin_pct: r.period_marginality_wgt, manager: r.manager, novelty_status: r.novelty_status,
      }
    }
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

  // ── 5. Серверная агрегация per-SKU через RPC ─────────────────────────────
  // Раньше fetchAll<fact_sku_daily> тянул сотни тысяч строк — на 30+ днях таймаут.
  // Migration: supabase/022_overview_sku_rpcs.sql
  type SkuPeriodAggRpc = {
    sku_ms: string
    curr_revenue: number; curr_ad_spend: number
    curr_chmd_rub: number; curr_margin_rub: number
    curr_ctr_avg: number | null; curr_cr_cart_avg: number | null
    curr_cr_order_avg: number | null
    curr_cpm_avg: number | null; curr_cpc_avg: number | null
    curr_days: number
    prev_revenue: number; prev_ad_spend: number
    prev_chmd_rub: number; prev_margin_rub: number
  }
  const haveDates = !!(effectiveFrom && effectiveTo && prevFrom && prevTo)
  const aggRes = haveDates
    ? await rpcFetchAll<SkuPeriodAggRpc>(() => supabase.rpc('sku_period_full_agg', {
        p_from: effectiveFrom, p_to: effectiveTo, p_prev_from: prevFrom, p_prev_to: prevTo,
      }))
    : { data: [] as SkuPeriodAggRpc[], error: null }

  if (aggRes.error) {
    const msg = aggRes.error.message ?? 'unknown'
    if (/function|sku_period_full_agg/i.test(msg)) {
      return NextResponse.json({
        error: 'Миграция 022_overview_sku_rpcs не применена. Запустите supabase/022_overview_sku_rpcs.sql в Supabase Studio → SQL editor.',
        details: msg,
      }, { status: 503 })
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  type DailyAgg = {
    revenue: number; ad_spend: number; chmd: number
    drr: number | null; ctr: number | null
    cr_cart: number | null; cr_order: number | null; cpm: number | null
    days: number
  }
  const dailyByMs: Record<string, DailyAgg> = {}
  const prevRevByMs: Record<string, number> = {}
  for (const r of aggRes.data) {
    const revenue = Number(r.curr_revenue ?? 0)
    const adSpend = Number(r.curr_ad_spend ?? 0)
    dailyByMs[r.sku_ms] = {
      revenue, ad_spend: adSpend,
      chmd: Number(r.curr_chmd_rub ?? 0),
      drr: revenue > 0 ? adSpend / revenue : null,
      ctr:      r.curr_ctr_avg      != null ? Number(r.curr_ctr_avg)      : null,
      cr_cart:  r.curr_cr_cart_avg  != null ? Number(r.curr_cr_cart_avg)  : null,
      cr_order: r.curr_cr_order_avg != null ? Number(r.curr_cr_order_avg) : null,
      cpm:      r.curr_cpm_avg      != null ? Number(r.curr_cpm_avg)      : null,
      days: Number(r.curr_days ?? 0),
    }
    const prev = Number(r.prev_revenue ?? 0)
    if (prev > 0) prevRevByMs[r.sku_ms] = prev
  }

  // Universe: all SKUs with snap data; supplement with those that only have daily data
  const allSkuMs = new Set<string>([
    ...Object.keys(snapByMs),
    ...Object.keys(dailyByMs),
  ])

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
    const drr      = revenue > 0 ? adSpend / revenue : null
    const ctr      = daily?.ctr      ?? null
    const cr_basket = daily?.cr_cart ?? null
    const cr_order = daily?.cr_order ?? null
    const cpo      = daily && daily.days > 0 && adSpend > 0 ? adSpend / daily.days : null
    const forecast30d = daily && daily.days > 0
      ? Math.round((revenue / daily.days) * 30)
      : null

    const marginPct  = snap?.margin_pct ?? 0
    const chmd       = daily?.chmd ?? 0
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
      novelty: isNovelty(snap?.novelty_status),
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
    if (noveltyFilter && !matchesNoveltyFilter(r.novelty ? 'Новинка' : null, noveltyFilter)) return false
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
