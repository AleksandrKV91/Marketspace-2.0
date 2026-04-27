import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/supabase/fetchAll'

export const maxDuration = 30

export async function GET(req: NextRequest) {
  const supabase = createServiceClient()
  const { searchParams } = new URL(req.url)
  const search = (searchParams.get('search') ?? '').trim()
  const seasonal = searchParams.get('seasonal') ?? 'all'
  const periodParam = searchParams.get('period') ?? ''

  // A) Load all successful ABC uploads with their periods
  const { data: abcUploads } = await supabase
    .from('uploads')
    .select('id, period_start')
    .eq('file_type', 'abc')
    .eq('status', 'ok')
    .not('period_start', 'is', null)
    .order('period_start', { ascending: false })

  // Build ordered list of distinct periods and a map to the latest upload per period
  const periods: string[] = []
  const latestByPeriod: Record<string, string> = {}
  for (const u of abcUploads ?? []) {
    const p = u.period_start as string
    if (!p) continue
    if (!latestByPeriod[p]) {
      latestByPeriod[p] = u.id
      periods.push(p)
    }
  }

  const selectedPeriod = periodParam || periods[0] || null
  const abcId = selectedPeriod ? (latestByPeriod[selectedPeriod] ?? null) : null

  // dim_sku — все поля включая свод-данные и сезонность
  const dimRows = await fetchAll<{
    sku_ms: string
    sku_wb: number | null
    name: string | null
    subject_wb: string | null
    category_wb: string | null
    niche_appeal: number | null
    buyout_pct: number | null
    market_share: number | null
    month_jan: number | null
    month_feb: number | null
    month_mar: number | null
    month_apr: number | null
    month_may: number | null
    month_jun: number | null
    month_jul: number | null
    month_aug: number | null
    month_sep: number | null
    month_oct: number | null
    month_nov: number | null
    month_dec: number | null
  }>(
    (sb) => sb.from('dim_sku').select(
      'sku_ms, sku_wb, name, subject_wb, category_wb, niche_appeal, buyout_pct, market_share, month_jan, month_feb, month_mar, month_apr, month_may, month_jun, month_jul, month_aug, month_sep, month_oct, month_nov, month_dec'
    ),
    supabase,
  )

  // B) abc data — use new class fields final_class_1 and final_class_2
  interface AbcRecord {
    final_class_1: string | null
    final_class_2: string | null
    revenue: number | null
    chmd: number | null
    chmd_clean: number | null
    tz: number | null
    ad_spend: number | null
    transport: number | null
    storage: number | null
  }
  const abcByMs: Record<string, AbcRecord> = {}

  if (abcId) {
    const { data: abcRows } = await supabase
      .from('fact_abc')
      .select('sku_ms, final_class_1, final_class_2, revenue, chmd, chmd_clean, tz, ad_spend, transport, storage')
      .eq('upload_id', abcId)
    if (abcRows) {
      for (const r of abcRows) abcByMs[r.sku_ms] = r
    }
  }

  // Aggregate by niche (subject_wb or category_wb)
  const nicheMap: Record<string, {
    niche: string
    category: string
    revenue: number
    chmd: number
    chmd_clean: number
    // C) track sums separately for weighted KPIs
    chmd_clean_sum: number
    revenue_sum_for_prof: number
    chmd_sum_for_margin: number
    revenue_sum_for_margin: number
    tz: number
    sku_count: number
    // F) collect all final_class_1/2 values for dominant calculation
    class1_values: string[]
    class2_values: string[]
    monthsSum: number[]
    monthsCount: number
    appealSum: number
    appealCount: number
    buyoutSum: number
    buyoutCount: number
    marketShareSum: number
    skus: Array<{
      sku_ms: string
      sku_wb: number | null
      name: string
      final_class_1: string | null
      final_class_2: string | null
      abc_class: string | null
      revenue: number
      profitability: number | null
      revenue_margin: number | null
      gmroi: number | null
    }>
  }> = {}

  for (const row of dimRows) {
    const niche = row.subject_wb ?? row.category_wb ?? 'Не указано'
    const category = row.category_wb ?? 'Не указано'
    if (!nicheMap[niche]) {
      nicheMap[niche] = {
        niche,
        category,
        revenue: 0,
        chmd: 0,
        chmd_clean: 0,
        chmd_clean_sum: 0,
        revenue_sum_for_prof: 0,
        chmd_sum_for_margin: 0,
        revenue_sum_for_margin: 0,
        tz: 0,
        sku_count: 0,
        class1_values: [],
        class2_values: [],
        monthsSum: Array(12).fill(0),
        monthsCount: 0,
        appealSum: 0,
        appealCount: 0,
        buyoutSum: 0,
        buyoutCount: 0,
        marketShareSum: 0,
        skus: [],
      }
    }
    const n = nicheMap[niche]

    // Aggregate monthly coefficients
    const months = [
      row.month_jan ?? 0, row.month_feb ?? 0, row.month_mar ?? 0,
      row.month_apr ?? 0, row.month_may ?? 0, row.month_jun ?? 0,
      row.month_jul ?? 0, row.month_aug ?? 0, row.month_sep ?? 0,
      row.month_oct ?? 0, row.month_nov ?? 0, row.month_dec ?? 0,
    ]
    if (months.some(v => v > 0)) {
      for (let i = 0; i < 12; i++) n.monthsSum[i] += months[i]
      n.monthsCount++
    }

    // Catalog fields
    if (row.niche_appeal != null) { n.appealSum += row.niche_appeal; n.appealCount++ }
    if (row.buyout_pct != null) { n.buyoutSum += row.buyout_pct; n.buyoutCount++ }
    if (row.market_share != null) n.marketShareSum += row.market_share

    // ABC data
    const abc = abcByMs[row.sku_ms]
    if (abc) {
      // F) revenue and chmd aggregation
      n.revenue += abc.revenue ?? 0
      n.chmd += abc.chmd ?? 0
      if (abc.chmd_clean != null) n.chmd_clean += abc.chmd_clean
      if (abc.tz != null) n.tz += abc.tz

      // C) Weighted KPI tracking — track sums separately
      const rev = abc.revenue ?? 0
      if (abc.chmd_clean != null) {
        n.chmd_clean_sum += abc.chmd_clean
        n.revenue_sum_for_prof += rev
      }
      if (abc.chmd != null) {
        n.chmd_sum_for_margin += abc.chmd
        n.revenue_sum_for_margin += rev
      }

      // F) Collect class values for dominant calculation
      if (abc.final_class_1 != null) n.class1_values.push(abc.final_class_1)
      if (abc.final_class_2 != null) n.class2_values.push(abc.final_class_2)

      // GMROI per SKU
      const skuGmroi = (abc.chmd_clean != null && abc.tz != null && abc.tz > 0)
        ? (abc.chmd_clean / abc.tz)
        : null

      // Derive abc_class from first non-'убыток' char of final_class_1 for backward compat
      const cls1 = abc.final_class_1 ?? ''
      const abcClassDerived = cls1.toLowerCase().startsWith('убыток')
        ? '—'
        : (cls1.charAt(0) || null)

      // Per-SKU profitability/margin (weighted at SKU level: single row so just derive ratio)
      const skuProf = (abc.chmd_clean != null && rev > 0) ? (abc.chmd_clean / rev * 100) : null
      const skuMargin = (abc.chmd != null && rev > 0) ? (abc.chmd / rev * 100) : null

      n.skus.push({
        sku_ms: row.sku_ms,
        sku_wb: row.sku_wb,
        name: row.name ?? row.sku_ms,
        final_class_1: abc.final_class_1,
        final_class_2: abc.final_class_2,
        abc_class: abcClassDerived,
        revenue: rev,
        profitability: skuProf,
        revenue_margin: skuMargin,
        gmroi: skuGmroi,
      })
    }
    n.sku_count++
  }

  // Helper: find most frequent value in array
  function dominant(values: string[]): string {
    if (values.length === 0) return '—'
    const counts: Record<string, number> = {}
    for (const v of values) counts[v] = (counts[v] ?? 0) + 1
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—'
  }

  let rows = Object.values(nicheMap).map(n => {
    // Average monthly coefficients
    const months = n.monthsCount > 0
      ? n.monthsSum.map(v => v / n.monthsCount)
      : Array(12).fill(0)

    const maxMonth = Math.max(...months)
    const avgMonth = months.reduce((s, v) => s + v, 0) / 12
    const seasonal_months = months.map((v, i) => v > avgMonth * 1.2 ? i + 1 : 0).filter(v => v > 0)
    const season_start = seasonal_months[0] ?? 0
    const season_peak = seasonal_months.length > 0
      ? seasonal_months.reduce((best, m) => months[m - 1] > months[best - 1] ? m : best, seasonal_months[0])
      : 0
    const isSeasonal = maxMonth > avgMonth * 1.5 && seasonal_months.length >= 2

    // F) Dominant class fields
    const final_class_1 = dominant(n.class1_values)
    const final_class_2 = dominant(n.class2_values)

    // Backward compat: derive abc_class from final_class_1
    const abc_class = final_class_1.toLowerCase().startsWith('убыток')
      ? '—'
      : (final_class_1.charAt(0) || '—')

    // GMROI per niche
    const gmroi = n.tz > 0 ? n.chmd_clean / n.tz : null

    // Attractiveness — from catalog niche_appeal if available, else calculate
    const attractiveness = n.appealCount > 0
      ? Math.round((n.appealSum / n.appealCount) * 10) / 10
      : Math.min(10,
          (n.revenue > 1_000_000 ? 3 : n.revenue > 100_000 ? 2 : 1) +
          (abc_class === 'A' ? 3 : abc_class === 'B' ? 2 : 1) +
          (isSeasonal ? 1 : 2) +
          Math.min(2, n.sku_count / 10)
        )

    const avg_buyout_pct = n.buyoutCount > 0 ? n.buyoutSum / n.buyoutCount : null

    // C) Weighted KPI calculation
    const profitability = n.revenue_sum_for_prof > 0
      ? (n.chmd_clean_sum / n.revenue_sum_for_prof) * 100
      : null
    const revenue_margin = n.revenue_sum_for_margin > 0
      ? (n.chmd_sum_for_margin / n.revenue_sum_for_margin) * 100
      : null

    return {
      niche: n.niche,
      category: n.category,
      attractiveness,
      revenue: n.revenue,
      seasonal: isSeasonal,
      season_months: seasonal_months,
      season_start,
      season_peak,
      availability: Math.min(10, n.sku_count / 5),
      final_class_1,
      final_class_2,
      abc_class,
      gmroi,
      sku_count: n.skus.length,
      buyout_pct: avg_buyout_pct,
      profitability,
      revenue_margin,
      months,
      skus: n.skus.sort((a, b) => b.revenue - a.revenue),
    }
  })

  // E) Filter — search and seasonal only; abc filter handled client-side
  if (search) {
    const q = search.toLowerCase()
    rows = rows.filter(r => r.niche.toLowerCase().includes(q) || r.category.toLowerCase().includes(q))
  }
  if (seasonal === 'seasonal') rows = rows.filter(r => r.seasonal)
  if (seasonal === 'no') rows = rows.filter(r => !r.seasonal)

  rows.sort((a, b) => b.revenue - a.revenue)

  const seasonal_count = rows.filter(r => r.seasonal).length

  // D) Summary with weighted KPIs
  // Compute global weighted profitability/margin across all (filtered) niches
  // by summing up the numerator/denominator from the original nicheMap entries
  const filteredNicheNames = new Set(rows.map(r => r.niche))
  let globalChmdCleanSum = 0
  let globalRevForProf = 0
  let globalChmdSum = 0
  let globalRevForMargin = 0
  for (const [nicheName, n] of Object.entries(nicheMap)) {
    if (!filteredNicheNames.has(nicheName)) continue
    globalChmdCleanSum += n.chmd_clean_sum
    globalRevForProf += n.revenue_sum_for_prof
    globalChmdSum += n.chmd_sum_for_margin
    globalRevForMargin += n.revenue_sum_for_margin
  }

  const summary = {
    avg_attractiveness: rows.length > 0 ? rows.reduce((s, r) => s + r.attractiveness, 0) / rows.length : 0,
    avg_buyout_pct: (() => {
      const with_bp = rows.filter(r => r.buyout_pct != null)
      return with_bp.length > 0 ? with_bp.reduce((s, r) => s + (r.buyout_pct ?? 0), 0) / with_bp.length : null
    })(),
    seasonal_count,
    non_seasonal_count: rows.length - seasonal_count,
    total_niches: rows.length,
    weighted_profitability: globalRevForProf > 0 ? (globalChmdCleanSum / globalRevForProf) * 100 : null,
    weighted_revenue_margin: globalRevForMargin > 0 ? (globalChmdSum / globalRevForMargin) * 100 : null,
  }

  // D) Return structure with periods
  return NextResponse.json({
    periods,
    current_period: selectedPeriod,
    summary,
    rows,
  })
}
