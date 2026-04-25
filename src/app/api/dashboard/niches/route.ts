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

// ── Helpers ───────────────────────────────────────────────────────────────────

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

/** Returns base ABC letter (A/B/C) from full class like "AA", "AB", "убыток|A" */
function baseAbcClass(cls: string | null): string {
  if (!cls) return '—'
  const s = cls.trim()
  // "убыток|A" → убыток group
  if (s.toLowerCase().startsWith('убыток')) return 'убыток'
  // "AA", "AB", "A" → first char
  const first = s.charAt(0).toUpperCase()
  if ('ABC'.includes(first)) return first
  return '—'
}

/** ABC status: normal / убыток / н/д */
function abcStatus(cls: string | null): 'normal' | 'loss' | 'nd' {
  if (!cls) return 'nd'
  const s = cls.toLowerCase()
  if (s.startsWith('убыток')) return 'loss'
  if (s.includes('н/д') || s.includes('nd')) return 'nd'
  return 'normal'
}

function topAbcLetter(classes: string[]): string {
  const counts: Record<string, number> = {}
  for (const c of classes) {
    const b = baseAbcClass(c)
    if ('ABC'.includes(b)) counts[b] = (counts[b] ?? 0) + 1
  }
  return ['A', 'B', 'C'].find(c => counts[c] > 0) ?? '—'
}

/** Safe profitability from direct field OR calculated from chmd/revenue */
function safeProfitability(profitability: number | null, chmd_clean: number | null, chmd: number | null, revenue: number | null): number | null {
  if (profitability != null) return profitability
  const numerator = chmd_clean ?? chmd
  if (numerator != null && revenue != null && revenue > 0) return (numerator / revenue) * 100
  return null
}

/** Revenue margin fallback: revenue_margin from DB, or chmd/revenue */
function safeRevenueMargin(revenue_margin: number | null, chmd: number | null, revenue: number | null): number | null {
  if (revenue_margin != null) return revenue_margin
  if (chmd != null && revenue != null && revenue > 0) return (chmd / revenue) * 100
  return null
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const supabase = createServiceClient()
  const { searchParams } = new URL(req.url)
  const seasonalFilter = searchParams.get('seasonal') ?? 'all'
  const abcFilter = searchParams.get('abc') ?? 'all'        // A / B / C / all
  const abcStatusFilter = searchParams.get('abc_status') ?? 'all'  // normal / loss / nd / all
  const searchQ = (searchParams.get('search') ?? '').toLowerCase().trim()
  const minRevenue = searchParams.get('min_revenue') ?? 'all'
  const startMonthFilter = parseInt(searchParams.get('start_month') ?? '0') || 0
  const peakMonthFilter = parseInt(searchParams.get('peak_month') ?? '0') || 0

  // ── 1. Latest ABC upload ──────────────────────────────────────────────────
  const { data: lastUploads } = await supabase
    .from('uploads')
    .select('id, file_type, uploaded_at, period_start')
    .eq('status', 'ok')
    .order('uploaded_at', { ascending: false })
    .limit(20)

  const latestByType: Record<string, { id: string; uploaded_at: string; period_start: string | null }> = {}
  if (lastUploads) {
    for (const u of lastUploads) {
      if (!latestByType[u.file_type]) {
        latestByType[u.file_type] = { id: u.id, uploaded_at: u.uploaded_at, period_start: u.period_start }
      }
    }
  }

  const abcUpload = latestByType['abc']
  const abcId = abcUpload?.id ?? null
  const abcPeriod = abcUpload?.period_start ?? null

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

  // ── 4. Aggregate into niches (Niche level, no Category level) ─────────────
  interface NicheAccum {
    niche: string
    category: string
    revenue: number
    chmd: number
    prof_sum: number; prof_n: number
    rev_margin_sum: number; rev_margin_n: number
    ad_spend: number; storage: number; transport: number
    abc_classes: string[]   // full combo classes like "AA", "AB", "убыток|A"
    months: number[]
    has_abc: boolean
    skus: Array<{
      sku_ms: string; name: string; revenue: number; chmd: number
      abc_class: string; abc_class2: string | null
      profitability: number | null; revenue_margin: number | null
      gmroy: number | null; season_months: number[]
      season_start: number; season_peak: number; seasonal: boolean
      attractiveness: number; availability: number
    }>
  }

  const nicheMap: Record<string, NicheAccum> = {}

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
        niche, category, revenue: 0, chmd: 0,
        prof_sum: 0, prof_n: 0, rev_margin_sum: 0, rev_margin_n: 0,
        ad_spend: 0, storage: 0, transport: 0,
        abc_classes: [], months, has_abc: false, skus: [],
      }
    }

    const abc = abcByMs[row.sku_ms]
    const rev = abc?.revenue ?? 0
    const chmd = abc?.chmd ?? 0
    const chmd_clean = abc?.chmd_clean ?? null
    const rawProf = abc?.profitability ?? null
    const rawRevMargin = abc?.revenue_margin ?? null

    // Calculate fallback profitability from available data
    const prof = safeProfitability(rawProf, chmd_clean, chmd, abc?.revenue ?? null)
    const revMargin = safeRevenueMargin(rawRevMargin, chmd, abc?.revenue ?? null)

    if (abc) {
      nicheMap[niche].has_abc = true
      nicheMap[niche].revenue += rev
      nicheMap[niche].chmd += chmd
      nicheMap[niche].ad_spend += abc.ad_spend ?? 0
      nicheMap[niche].storage += abc.storage ?? 0
      nicheMap[niche].transport += abc.transport ?? 0
      if (prof != null) { nicheMap[niche].prof_sum += prof; nicheMap[niche].prof_n++ }
      if (revMargin != null) { nicheMap[niche].rev_margin_sum += revMargin; nicheMap[niche].rev_margin_n++ }
      if (abc.abc_class) nicheMap[niche].abc_classes.push(abc.abc_class)
    }

    // SKU-level seasonality
    const { season_start, season_peak, seasonal } = buildSeasonInfo(months)
    const abcClass = abc?.abc_class ?? '—'
    const baseLetter = baseAbcClass(abcClass)
    const skuRev = rev
    const skuAttr = Math.min(10, (skuRev > 50_000 ? 2 : 1) + (baseLetter === 'A' ? 3 : baseLetter === 'B' ? 2 : 1) + (seasonal ? 1 : 2))

    nicheMap[niche].skus.push({
      sku_ms: row.sku_ms,
      name: row.name ?? row.sku_ms,
      revenue: rev,
      chmd,
      abc_class: abcClass,
      abc_class2: abc?.abc_class2 ?? null,
      profitability: prof,
      revenue_margin: revMargin,
      gmroy: rev > 0 ? (chmd / rev) * 100 : null,
      season_months: months,
      season_start,
      season_peak,
      seasonal,
      attractiveness: skuAttr,
      availability: Math.min(10, rev / 100_000),
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
    avg_profitability: number | null
    avg_revenue_margin: number | null
    ad_spend: number; storage: number; transport: number
    seasonal: boolean
    season_months_coeffs: number[]
    season_months: number[]
    season_start: number
    season_peak: number
    availability: number
    abc_class: string        // top base letter (A/B/C/—)
    abc_combo: string        // top full combo class (AA/AB/убыток|A/etc)
    abc_status: string       // normal / loss / nd
    abc_distribution: Record<string, number>   // by base letter
    abc_combo_distribution: Record<string, number>  // by full combo
    gmroy: number | null
    sku_count: number
    has_abc: boolean
    skus: NicheAccum['skus']
  }

  let nicheRows: NicheRow[] = Object.values(nicheMap).map(n => {
    const { season_months, season_start, season_peak, seasonal } = buildSeasonInfo(n.months)
    const tAbc = topAbcLetter(n.abc_classes)

    // Attractiveness: 0–100 scale (integers)
    const attractiveness = Math.min(100,
      (n.revenue > 1_000_000 ? 30 : n.revenue > 100_000 ? 20 : 10) +
      (tAbc === 'A' ? 30 : tAbc === 'B' ? 20 : 10) +
      (seasonal ? 10 : 20) +
      Math.min(20, n.skus.length * 2)
    )

    const abcDist: Record<string, number> = {}
    const abcComboDist: Record<string, number> = {}
    let topCombo = '—'
    let maxComboCount = 0

    for (const c of n.abc_classes) {
      const b = baseAbcClass(c)
      if (b !== '—' && b !== 'убыток') abcDist[b] = (abcDist[b] ?? 0) + 1
      abcComboDist[c] = (abcComboDist[c] ?? 0) + 1
      if ((abcComboDist[c] ?? 0) > maxComboCount) { maxComboCount = abcComboDist[c]; topCombo = c }
    }

    // Determine overall ABC status for the niche
    const statuses = n.abc_classes.map(abcStatus)
    const status = statuses.includes('loss') ? 'loss' : statuses.includes('nd') ? 'nd' : 'normal'

    return {
      niche: n.niche,
      category: n.category,
      rating: Math.round(attractiveness),
      attractiveness,
      revenue: n.revenue,
      chmd: n.chmd,
      avg_profitability: n.prof_n > 0 ? n.prof_sum / n.prof_n : (n.revenue > 0 ? (n.chmd / n.revenue) * 100 : null),
      avg_revenue_margin: n.rev_margin_n > 0 ? n.rev_margin_sum / n.rev_margin_n : (n.revenue > 0 ? (n.chmd / n.revenue) * 100 : null),
      ad_spend: n.ad_spend, storage: n.storage, transport: n.transport,
      seasonal, season_months_coeffs: n.months, season_months, season_start, season_peak,
      availability: Math.min(10, n.skus.length / 5),
      abc_class: tAbc,
      abc_combo: topCombo,
      abc_status: status,
      abc_distribution: abcDist,
      abc_combo_distribution: abcComboDist,
      gmroy: n.revenue > 0 ? (n.chmd / n.revenue) * 100 : null,
      sku_count: n.skus.length,
      has_abc: n.has_abc,
      skus: n.skus.sort((a, b) => b.revenue - a.revenue),
    }
  })

  // ── 6. Apply filters ──────────────────────────────────────────────────────
  if (searchQ) nicheRows = nicheRows.filter(r =>
    r.niche.toLowerCase().includes(searchQ) || r.category.toLowerCase().includes(searchQ)
  )
  if (seasonalFilter === 'seasonal') nicheRows = nicheRows.filter(r => r.seasonal)
  if (seasonalFilter === 'no') nicheRows = nicheRows.filter(r => !r.seasonal)
  if (abcFilter !== 'all') nicheRows = nicheRows.filter(r => r.abc_class === abcFilter)
  if (abcStatusFilter === 'loss') nicheRows = nicheRows.filter(r => r.abc_status === 'loss')
  if (abcStatusFilter === 'nd') nicheRows = nicheRows.filter(r => r.abc_status === 'nd')
  if (abcStatusFilter === 'normal') nicheRows = nicheRows.filter(r => r.abc_status === 'normal')
  if (minRevenue === '100k') nicheRows = nicheRows.filter(r => r.revenue >= 100_000)
  if (minRevenue === '500k') nicheRows = nicheRows.filter(r => r.revenue >= 500_000)
  if (minRevenue === '1m') nicheRows = nicheRows.filter(r => r.revenue >= 1_000_000)
  if (startMonthFilter > 0) nicheRows = nicheRows.filter(r => r.season_start === startMonthFilter)
  if (peakMonthFilter > 0) nicheRows = nicheRows.filter(r => r.season_peak === peakMonthFilter)

  nicheRows.sort((a, b) => b.revenue - a.revenue)

  // ── 7. Summary KPIs ───────────────────────────────────────────────────────
  const totalNiches = nicheRows.length
  const seasonalCount = nicheRows.filter(r => r.seasonal).length
  const avgAttr = totalNiches > 0 ? nicheRows.reduce((s, r) => s + r.attractiveness, 0) / totalNiches : 0

  const withProf = nicheRows.filter(r => r.avg_profitability != null)
  const avgChmdMargin = withProf.length > 0
    ? withProf.reduce((s, r) => s + r.avg_profitability!, 0) / withProf.length : null

  const withRevMargin = nicheRows.filter(r => r.avg_revenue_margin != null)
  const avgRevMargin = withRevMargin.length > 0
    ? withRevMargin.reduce((s, r) => s + r.avg_revenue_margin!, 0) / withRevMargin.length : null

  // ABC distribution summary
  const abcDistSummary: Record<string, number> = {}
  const abcComboDistSummary: Record<string, number> = {}
  for (const r of nicheRows) {
    for (const [k, v] of Object.entries(r.abc_distribution)) abcDistSummary[k] = (abcDistSummary[k] ?? 0) + v
    for (const [k, v] of Object.entries(r.abc_combo_distribution)) abcComboDistSummary[k] = (abcComboDistSummary[k] ?? 0) + v
  }

  const summary = {
    avg_attractiveness: Math.round(avgAttr),
    seasonal_count: seasonalCount,
    non_seasonal_count: totalNiches - seasonalCount,
    abc_distribution: abcDistSummary,
    abc_combo_distribution: abcComboDistSummary,
    avg_chmd_margin: avgChmdMargin,
    avg_revenue_margin: avgRevMargin,
    total_niches: totalNiches,
    total_skus: nicheRows.reduce((s, r) => s + r.sku_count, 0),
    has_abc_data: Object.keys(abcByMs).length > 0,
    abc_period: abcPeriod,
    dim_sku_count: dimRows.length,
  }

  // ── 8. Chart data ─────────────────────────────────────────────────────────

  // Rating chart — top 15
  const rating_chart = [...nicheRows]
    .sort((a, b) => b.rating - a.rating)
    .slice(0, 15)
    .map(r => ({
      name: r.niche.length > 20 ? r.niche.slice(0, 18) + '…' : r.niche,
      rating: r.rating,
      abc: r.abc_class,
    }))

  // Scatter — top 30 by revenue
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

  // Heatmap — top 20 by revenue
  const heatmap = [...nicheRows]
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 20)
    .map(r => ({
      niche: r.niche.length > 22 ? r.niche.slice(0, 20) + '…' : r.niche,
      months: r.season_months_coeffs,
    }))

  // ABC structure — SKU counts by combo group
  const abcChartMap: Record<string, { count: number; revenue: number; sku_count: number }> = {}
  for (const r of nicheRows) {
    for (const [combo, cnt] of Object.entries(r.abc_combo_distribution)) {
      const base = baseAbcClass(combo)
      // Group: A-классы, B-классы, C-классы, убыток, н/д
      let group = '—'
      if (base === 'убыток') group = 'Убыток'
      else if (abcStatus(combo) === 'nd') group = 'Н/Д'
      else if (base === 'A') group = 'A'
      else if (base === 'B') group = 'B'
      else if (base === 'C') group = 'C'
      if (!abcChartMap[group]) abcChartMap[group] = { count: 0, revenue: 0, sku_count: 0 }
      abcChartMap[group].count += cnt
      abcChartMap[group].revenue += r.revenue * (cnt / Math.max(1, r.sku_count))
      abcChartMap[group].sku_count += cnt
    }
  }
  const GROUP_ORDER = ['A', 'B', 'C', 'Убыток', 'Н/Д']
  const abc_chart = GROUP_ORDER
    .filter(g => abcChartMap[g])
    .map(g => ({ group: g, ...abcChartMap[g] }))

  return NextResponse.json({
    summary,
    rows: nicheRows,     // flat list of niches (FE builds hierarchy if needed)
    scatter,
    heatmap,
    abc_chart,
    rating_chart,
  })
}
