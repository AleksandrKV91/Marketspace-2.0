import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/supabase/fetchAll'

export const maxDuration = 45

// ── Types ─────────────────────────────────────────────────────────────────────

interface DimSkuRow {
  sku_ms: string
  sku_wb: number | null
  name: string | null
  subject_wb: string | null
  category_wb: string | null
  month_jan: number | null; month_feb: number | null; month_mar: number | null
  month_apr: number | null; month_may: number | null; month_jun: number | null
  month_jul: number | null; month_aug: number | null; month_sep: number | null
  month_oct: number | null; month_nov: number | null; month_dec: number | null
}

interface AbcRow {
  sku_ms: string
  abc_class: string | null
  abc_class2: string | null
  revenue: number | null
  chmd: number | null
  chmd_clean: number | null
  profitability: number | null
  revenue_margin: number | null
  ad_spend: number | null
  storage: number | null
  transport: number | null
}

interface SkuEntry {
  sku_ms: string
  name: string
  revenue: number
  chmd: number
  chmd_clean: number | null
  profitability: number | null
  revenue_margin: number | null
  ad_spend: number | null
  storage: number | null
  transport: number | null
  abc_class: string
  abc_class2: string | null
  season_months: number[]  // 12 coefficients
  season_start: number
  season_peak: number
  seasonal: boolean
  attractiveness: number
  availability: number
  gmroy: number | null
}

interface NicheEntry {
  niche: string
  category: string
  revenue: number
  chmd: number
  chmd_clean: number
  profitability_sum: number
  profitability_n: number
  revenue_margin_sum: number
  revenue_margin_n: number
  ad_spend: number
  storage: number
  transport: number
  abc_classes: string[]
  months: number[]
  skus: SkuEntry[]
}

// ── Seasonality helpers ───────────────────────────────────────────────────────

function buildSeasonInfo(months: number[]): {
  season_months: number[]
  season_start: number
  season_peak: number
  seasonal: boolean
} {
  const avg = months.reduce((s, v) => s + v, 0) / 12
  const maxVal = Math.max(...months)
  const seasonal_months = months.map((v, i) => v > avg * 1.2 ? i + 1 : 0).filter(v => v > 0)
  const season_start = seasonal_months[0] ?? 0
  const season_peak = seasonal_months.length > 0
    ? seasonal_months.reduce((best, m) => months[m - 1] > months[best - 1] ? m : best, seasonal_months[0])
    : 0
  const seasonal = maxVal > avg * 1.5 && seasonal_months.length >= 2
  return { season_months: seasonal_months, season_start, season_peak, seasonal }
}

function computeAttractiveness(revenue: number, topAbc: string, isSeasonal: boolean, skuCount: number): number {
  return Math.min(10,
    (revenue > 1_000_000 ? 3 : revenue > 100_000 ? 2 : 1) +
    (topAbc === 'A' ? 3 : topAbc === 'B' ? 2 : 1) +
    (isSeasonal ? 1 : 2) +
    Math.min(2, skuCount / 10)
  )
}

function topAbcClass(classes: string[]): string {
  const counts: Record<string, number> = {}
  for (const c of classes) {
    const base = c.charAt(0).toUpperCase()
    if ('ABC'.includes(base)) counts[base] = (counts[base] ?? 0) + 1
  }
  return ['A', 'B', 'C'].find(c => counts[c] > 0) ?? '—'
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const supabase = createServiceClient()
  const { searchParams } = new URL(req.url)
  const seasonalFilter = searchParams.get('seasonal') ?? 'all'
  const abcFilter = searchParams.get('abc') ?? 'all'
  const searchQ = (searchParams.get('search') ?? '').toLowerCase().trim()
  const minRevenue = searchParams.get('min_revenue') ?? 'all'
  const startMonthFilter = parseInt(searchParams.get('start_month') ?? '0') || 0
  const peakMonthFilter = parseInt(searchParams.get('peak_month') ?? '0') || 0

  // ── 1. Latest ABC upload ──────────────────────────────────────────────────
  const { data: lastUploads } = await supabase
    .from('uploads')
    .select('id, file_type')
    .eq('status', 'ok')
    .order('uploaded_at', { ascending: false })
    .limit(20)

  const latestByType: Record<string, string> = {}
  if (lastUploads) {
    for (const u of lastUploads) {
      if (!latestByType[u.file_type]) latestByType[u.file_type] = u.id
    }
  }
  const abcId = latestByType['abc']

  // ── 2. Fetch dim_sku ──────────────────────────────────────────────────────
  const dimRows = await fetchAll<DimSkuRow>(
    (sb) => sb.from('dim_sku').select(
      'sku_ms, sku_wb, name, subject_wb, category_wb, ' +
      'month_jan, month_feb, month_mar, month_apr, month_may, month_jun, ' +
      'month_jul, month_aug, month_sep, month_oct, month_nov, month_dec'
    ),
    supabase,
  )

  // ── 3. Fetch fact_abc ─────────────────────────────────────────────────────
  const abcByMs: Record<string, AbcRow> = {}
  if (abcId) {
    const { data: abcRows } = await supabase
      .from('fact_abc')
      .select('sku_ms, abc_class, abc_class2, revenue, chmd, chmd_clean, profitability, revenue_margin, ad_spend, storage, transport')
      .eq('upload_id', abcId)
    if (abcRows) {
      for (const r of abcRows as AbcRow[]) abcByMs[r.sku_ms] = r
    }
  }

  // ── 4. Aggregate into niches ──────────────────────────────────────────────
  const nicheMap: Record<string, NicheEntry> = {}

  for (const row of dimRows) {
    const niche = row.subject_wb ?? row.category_wb ?? 'Не указано'
    const category = row.category_wb ?? 'Не указано'

    const months: number[] = [
      row.month_jan ?? 0, row.month_feb ?? 0, row.month_mar ?? 0,
      row.month_apr ?? 0, row.month_may ?? 0, row.month_jun ?? 0,
      row.month_jul ?? 0, row.month_aug ?? 0, row.month_sep ?? 0,
      row.month_oct ?? 0, row.month_nov ?? 0, row.month_dec ?? 0,
    ]

    if (!nicheMap[niche]) {
      nicheMap[niche] = {
        niche, category, revenue: 0, chmd: 0, chmd_clean: 0,
        profitability_sum: 0, profitability_n: 0,
        revenue_margin_sum: 0, revenue_margin_n: 0,
        ad_spend: 0, storage: 0, transport: 0,
        abc_classes: [], months, skus: [],
      }
    }

    const abc = abcByMs[row.sku_ms]
    const rev = abc?.revenue ?? 0
    const chmd = abc?.chmd ?? 0
    const chmd_clean = abc?.chmd_clean ?? null
    const profitability = abc?.profitability ?? null
    const revenue_margin = abc?.revenue_margin ?? null

    nicheMap[niche].revenue += rev
    nicheMap[niche].chmd += chmd
    if (chmd_clean != null) nicheMap[niche].chmd_clean += chmd_clean
    if (profitability != null) { nicheMap[niche].profitability_sum += profitability; nicheMap[niche].profitability_n++ }
    if (revenue_margin != null) { nicheMap[niche].revenue_margin_sum += revenue_margin; nicheMap[niche].revenue_margin_n++ }
    nicheMap[niche].ad_spend += abc?.ad_spend ?? 0
    nicheMap[niche].storage += abc?.storage ?? 0
    nicheMap[niche].transport += abc?.transport ?? 0

    const abcClass = abc?.abc_class ?? '—'
    if (abc?.abc_class) nicheMap[niche].abc_classes.push(abc.abc_class)

    // SKU-level seasonality
    const { season_start, season_peak, seasonal } = buildSeasonInfo(months)
    const skuAttr = Math.min(10, (rev > 50_000 ? 2 : 1) + (abcClass === 'A' ? 3 : abcClass === 'B' ? 2 : 1) + (seasonal ? 1 : 2))

    nicheMap[niche].skus.push({
      sku_ms: row.sku_ms,
      name: row.name ?? row.sku_ms,
      revenue: rev,
      chmd,
      chmd_clean,
      profitability,
      revenue_margin,
      ad_spend: abc?.ad_spend ?? null,
      storage: abc?.storage ?? null,
      transport: abc?.transport ?? null,
      abc_class: abcClass,
      abc_class2: abc?.abc_class2 ?? null,
      season_months: months,
      season_start,
      season_peak,
      seasonal,
      attractiveness: skuAttr,
      availability: Math.min(10, rev / 100_000),
      gmroy: rev > 0 ? (chmd / rev) * 100 : null,
    })
  }

  // ── 5. Build niche rows ───────────────────────────────────────────────────
  interface NicheRow {
    niche: string
    category: string
    rating: number
    attractiveness: number
    revenue: number
    chmd: number
    chmd_clean: number
    avg_profitability: number | null
    avg_revenue_margin: number | null
    ad_spend: number
    storage: number
    transport: number
    seasonal: boolean
    season_months_coeffs: number[]
    season_months: number[]
    season_start: number
    season_peak: number
    availability: number
    abc_class: string
    abc_distribution: Record<string, number>
    gmroy: number | null
    sku_count: number
    skus: SkuEntry[]
  }

  let nicheRows: NicheRow[] = Object.values(nicheMap).map(n => {
    const { season_months, season_start, season_peak, seasonal } = buildSeasonInfo(n.months)
    const tAbc = topAbcClass(n.abc_classes)
    const attractiveness = computeAttractiveness(n.revenue, tAbc, seasonal, n.skus.length)

    const abcDist: Record<string, number> = {}
    for (const c of n.abc_classes) {
      const base = c.charAt(0).toUpperCase()
      abcDist[base] = (abcDist[base] ?? 0) + 1
    }

    return {
      niche: n.niche,
      category: n.category,
      rating: Math.round(attractiveness * 10),
      attractiveness,
      revenue: n.revenue,
      chmd: n.chmd,
      chmd_clean: n.chmd_clean,
      avg_profitability: n.profitability_n > 0 ? n.profitability_sum / n.profitability_n : null,
      avg_revenue_margin: n.revenue_margin_n > 0 ? n.revenue_margin_sum / n.revenue_margin_n : null,
      ad_spend: n.ad_spend,
      storage: n.storage,
      transport: n.transport,
      seasonal,
      season_months_coeffs: n.months,
      season_months,
      season_start,
      season_peak,
      availability: Math.min(10, n.skus.length / 5),
      abc_class: tAbc,
      abc_distribution: abcDist,
      gmroy: n.revenue > 0 ? (n.chmd / n.revenue) * 100 : null,
      sku_count: n.skus.length,
      skus: n.skus.sort((a, b) => b.revenue - a.revenue),
    }
  })

  // ── 6. Client-side filtering ──────────────────────────────────────────────
  if (searchQ) nicheRows = nicheRows.filter(r =>
    r.niche.toLowerCase().includes(searchQ) || r.category.toLowerCase().includes(searchQ)
  )
  if (seasonalFilter === 'seasonal') nicheRows = nicheRows.filter(r => r.seasonal)
  if (seasonalFilter === 'no') nicheRows = nicheRows.filter(r => !r.seasonal)
  if (abcFilter !== 'all') nicheRows = nicheRows.filter(r => r.abc_class === abcFilter)
  if (minRevenue === '100k') nicheRows = nicheRows.filter(r => r.revenue >= 100_000)
  if (minRevenue === '500k') nicheRows = nicheRows.filter(r => r.revenue >= 500_000)
  if (minRevenue === '1m') nicheRows = nicheRows.filter(r => r.revenue >= 1_000_000)
  if (startMonthFilter > 0) nicheRows = nicheRows.filter(r => r.season_start === startMonthFilter)
  if (peakMonthFilter > 0) nicheRows = nicheRows.filter(r => r.season_peak === peakMonthFilter)

  nicheRows.sort((a, b) => b.revenue - a.revenue)

  // ── 7. Build hierarchy: category → niches ────────────────────────────────
  const categoryMap: Record<string, {
    category: string
    revenue: number
    chmd: number
    sku_count: number
    abc_classes: string[]
    niches: NicheRow[]
  }> = {}

  for (const nr of nicheRows) {
    if (!categoryMap[nr.category]) {
      categoryMap[nr.category] = { category: nr.category, revenue: 0, chmd: 0, sku_count: 0, abc_classes: [], niches: [] }
    }
    categoryMap[nr.category].revenue += nr.revenue
    categoryMap[nr.category].chmd += nr.chmd
    categoryMap[nr.category].sku_count += nr.sku_count
    categoryMap[nr.category].abc_classes.push(nr.abc_class)
    categoryMap[nr.category].niches.push(nr)
  }

  const hierarchy = Object.values(categoryMap)
    .sort((a, b) => b.revenue - a.revenue)
    .map(cat => ({
      ...cat,
      abc_class: topAbcClass(cat.abc_classes as string[]),
      attractiveness: cat.niches.reduce((s, n) => s + n.attractiveness, 0) / Math.max(1, cat.niches.length),
      gmroy: cat.revenue > 0 ? (cat.chmd / cat.revenue) * 100 : null,
      niches: cat.niches,
    }))

  // ── 8. Summary / KPIs ─────────────────────────────────────────────────────
  const allNiches = nicheRows
  const totalNiches = allNiches.length
  const seasonalNiches = allNiches.filter(r => r.seasonal).length

  const avgAttractiveness = totalNiches > 0
    ? allNiches.reduce((s, r) => s + r.attractiveness, 0) / totalNiches : 0

  const niches_with_prof = allNiches.filter(r => r.avg_profitability != null)
  const avgChmdMargin = niches_with_prof.length > 0
    ? niches_with_prof.reduce((s, r) => s + r.avg_profitability!, 0) / niches_with_prof.length : null

  const niches_with_rev_margin = allNiches.filter(r => r.avg_revenue_margin != null)
  const avgRevenueMargin = niches_with_rev_margin.length > 0
    ? niches_with_rev_margin.reduce((s, r) => s + r.avg_revenue_margin!, 0) / niches_with_rev_margin.length : null

  const allAbcClasses = allNiches.flatMap(r => r.abc_distribution ? Object.entries(r.abc_distribution).flatMap(([k, n]) => Array(n).fill(k)) : [])
  const abcDist: Record<string, number> = {}
  for (const c of allAbcClasses) {
    const base = c.charAt(0).toUpperCase()
    if ('ABC'.includes(base)) abcDist[base] = (abcDist[base] ?? 0) + 1
  }

  const summary = {
    avg_attractiveness: avgAttractiveness,
    seasonal_count: seasonalNiches,
    non_seasonal_count: totalNiches - seasonalNiches,
    abc_distribution: abcDist,
    avg_chmd_margin: avgChmdMargin,
    avg_revenue_margin: avgRevenueMargin,
    total_niches: totalNiches,
    total_skus: allNiches.reduce((s, r) => s + r.sku_count, 0),
  }

  // ── 9. Chart data ─────────────────────────────────────────────────────────

  // Scatter: top-30 niches by revenue
  const scatter = [...nicheRows]
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 30)
    .map(r => ({
      niche: r.niche,
      attractiveness: r.attractiveness,
      revenue: r.revenue,
      market_share: r.sku_count,
      abc_class: r.abc_class,
    }))

  // Heatmap: top-20 niches by revenue
  const heatmap = [...nicheRows]
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 20)
    .map(r => ({
      niche: r.niche.length > 22 ? r.niche.slice(0, 20) + '…' : r.niche,
      months: r.season_months_coeffs,
    }))

  // ABC structure for stacked bar
  const abcGroups: Record<string, { count: number; revenue: number; sku_count: number }> = {}
  for (const r of nicheRows) {
    const key = r.abc_class === '—' ? 'Н/Д' : r.abc_class
    if (!abcGroups[key]) abcGroups[key] = { count: 0, revenue: 0, sku_count: 0 }
    abcGroups[key].count++
    abcGroups[key].revenue += r.revenue
    abcGroups[key].sku_count += r.sku_count
  }
  const abc_chart = Object.entries(abcGroups).map(([group, v]) => ({ group, ...v }))
    .sort((a, b) => ['A', 'B', 'C', 'Н/Д'].indexOf(a.group) - ['A', 'B', 'C', 'Н/Д'].indexOf(b.group))

  // Rating chart (top 15)
  const rating_chart = [...nicheRows]
    .sort((a, b) => b.rating - a.rating)
    .slice(0, 15)
    .map(r => ({
      name: r.niche.length > 20 ? r.niche.slice(0, 18) + '…' : r.niche,
      rating: r.rating,
      attractiveness: r.attractiveness,
      abc: r.abc_class,
    }))

  return NextResponse.json({
    summary,
    hierarchy,
    scatter,
    heatmap,
    abc_chart,
    rating_chart,
  })
}
