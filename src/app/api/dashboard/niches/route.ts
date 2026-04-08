import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/supabase/fetchAll'

export const maxDuration = 30

export async function GET(req: NextRequest) {
  const supabase = createServiceClient()
  const { searchParams } = new URL(req.url)
  const search = (searchParams.get('search') ?? '').trim()
  const seasonal = searchParams.get('seasonal') ?? 'all'

  // Get latest abc upload
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

  // dim_sku with seasonality columns — все строки
  const dimRows = await fetchAll<{ sku_ms: string; sku_wb: number | null; name: string | null; subject_wb: string | null; category_wb: string | null; month_jan: number | null; month_feb: number | null; month_mar: number | null; month_apr: number | null; month_may: number | null; month_jun: number | null; month_jul: number | null; month_aug: number | null; month_sep: number | null; month_oct: number | null; month_nov: number | null; month_dec: number | null }>(
    (sb) => sb.from('dim_sku').select('sku_ms, sku_wb, name, subject_wb, category_wb, month_jan, month_feb, month_mar, month_apr, month_may, month_jun, month_jul, month_aug, month_sep, month_oct, month_nov, month_dec'),
    supabase,
  )

  // abc data
  const abcByMs: Record<string, { abc_class: string | null; revenue: number | null; chmd: number | null; profitability: number | null }> = {}
  if (abcId) {
    const { data: abcRows } = await supabase
      .from('fact_abc')
      .select('sku_ms, abc_class, revenue, chmd, profitability')
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
    sku_count: number
    abc_classes: string[]
    months: number[]
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
          sku_count: 0,
          abc_classes: [],
          months: [
            row.month_jan ?? 0, row.month_feb ?? 0, row.month_mar ?? 0,
            row.month_apr ?? 0, row.month_may ?? 0, row.month_jun ?? 0,
            row.month_jul ?? 0, row.month_aug ?? 0, row.month_sep ?? 0,
            row.month_oct ?? 0, row.month_nov ?? 0, row.month_dec ?? 0,
          ],
        }
      }
      const abc = abcByMs[row.sku_ms]
      if (abc) {
        nicheMap[niche].revenue += abc.revenue ?? 0
        nicheMap[niche].chmd += abc.chmd ?? 0
        if (abc.abc_class) nicheMap[niche].abc_classes.push(abc.abc_class)
      }
    nicheMap[niche].sku_count++
  }

  let rows = Object.values(nicheMap).map(n => {
    const months = n.months
    const maxMonth = Math.max(...months)
    const avgMonth = months.reduce((s, v) => s + v, 0) / 12
    const seasonal_months = months.map((v, i) => v > avgMonth * 1.2 ? i + 1 : 0).filter(v => v > 0)
    const season_start = seasonal_months[0] ?? 0
    const season_peak = seasonal_months.reduce((best, m) => months[m - 1] > months[best - 1] ? m : best, seasonal_months[0] ?? 0)
    const isSeasonal = maxMonth > avgMonth * 1.5 && seasonal_months.length >= 2

    const abcCounts: Record<string, number> = {}
    for (const c of n.abc_classes) abcCounts[c] = (abcCounts[c] ?? 0) + 1
    const topAbc = ['A', 'B', 'C'].find(c => abcCounts[c] > 0) ?? '—'

    const attractiveness = Math.min(10,
      (n.revenue > 1_000_000 ? 3 : n.revenue > 100_000 ? 2 : 1) +
      (topAbc === 'A' ? 3 : topAbc === 'B' ? 2 : 1) +
      (isSeasonal ? 1 : 2) +
      Math.min(2, n.sku_count / 10)
    )

    return {
      niche: n.niche,
      category: n.category,
      rating: Math.round(attractiveness * 10),
      attractiveness,
      revenue: n.revenue,
      seasonal: isSeasonal,
      season_months: seasonal_months,
      season_start,
      season_peak,
      availability: Math.min(10, n.sku_count / 5),
      abc_class: topAbc,
    }
  })

  // Filter
  if (search) {
    const q = search.toLowerCase()
    rows = rows.filter(r => r.niche.toLowerCase().includes(q) || r.category.toLowerCase().includes(q))
  }
  if (seasonal === 'seasonal') rows = rows.filter(r => r.seasonal)
  if (seasonal === 'no') rows = rows.filter(r => !r.seasonal)

  rows.sort((a, b) => b.revenue - a.revenue)

  const summary = {
    avg_attractiveness: rows.length > 0 ? rows.reduce((s, r) => s + r.attractiveness, 0) / rows.length : 0,
    avg_market_share: rows.length > 0 ? 1 / rows.length : 0,
    seasonal_count: rows.filter(r => r.seasonal).length,
    avg_abc: rows.length > 0 ? (rows.filter(r => r.abc_class === 'A').length > rows.length / 3 ? 'A' : rows.filter(r => r.abc_class === 'B').length > rows.length / 3 ? 'B' : 'C') : '—',
  }

  return NextResponse.json({ summary, rows })
}
