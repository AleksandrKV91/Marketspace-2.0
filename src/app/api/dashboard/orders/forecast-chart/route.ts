import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/supabase/fetchAll'
import { cached } from '@/lib/cache'

export const maxDuration = 30

const MONTH_KEYS = [
  'month_jan','month_feb','month_mar','month_apr','month_may','month_jun',
  'month_jul','month_aug','month_sep','month_oct','month_nov','month_dec',
] as const
type MonthKey = typeof MONTH_KEYS[number]

function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso)
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

/**
 * Прогноз продаж: 30 дней назад + 30 дней вперёд.
 * - fact (синяя): Σ fact_sku_daily.sales_qty GROUP BY metric_date — реальные продажи (шт.)
 * - forecast (зелёная): на каждый будущий день — Σ_по_SKU(velocity_31d × seasonal_coef(month) / avg_year_coef)
 * - stock (красная): кумулятивный остаток в шт. = current_total_stock - Σ_до_дня(forecast)
 *   Линия обрывается, когда уходит в 0.
 *
 * Важно: возвращаются ТОЛЬКО шт. — линии идут по разным полям, поэтому никогда не совпадают.
 */
export async function GET() {
  const supabase = createServiceClient()

  // 1. Последняя дата в fact_sku_daily
  const { data: maxRow } = await supabase
    .from('fact_sku_daily').select('metric_date')
    .order('metric_date', { ascending: false }).limit(1)
  const maxDate: string | null = maxRow?.[0]?.metric_date ?? null
  if (!maxDate) return NextResponse.json({ rows: [] })

  // 2. Последний снапшот fact_sku_period — для текущего остатка
  const { data: maxSnapRow } = await supabase
    .from('fact_sku_period').select('period_end')
    .order('period_end', { ascending: false }).limit(1)
  const maxSnapDate: string | null = maxSnapRow?.[0]?.period_end ?? null

  // 3. Последние 31 день в fact_sku_daily — для velocity и фактического тренда
  const factFrom = addDaysISO(maxDate, -29)  // 30 точек включая maxDate

  type Daily = { sku_ms: string; metric_date: string; sales_qty: number | null }
  type Snap  = { sku_ms: string; fbo_wb: number | null; fbs_pushkino: number | null; fbs_smolensk: number | null; kits_qty: number | null }
  type Dim   = { sku_ms: string } & Record<MonthKey, number | null>

  const [allDaily, snapRows, dimRows] = await Promise.all([
    fetchAll<Daily>(
      (sb) => sb.from('fact_sku_daily')
        .select('sku_ms, metric_date, sales_qty')
        .gte('metric_date', factFrom).lte('metric_date', maxDate)
        .order('metric_date'),
      supabase,
    ),
    maxSnapDate
      ? fetchAll<Snap>(
          (sb) => sb.from('fact_sku_period')
            .select('sku_ms, fbo_wb, fbs_pushkino, fbs_smolensk, kits_qty')
            .eq('period_end', maxSnapDate),
          supabase,
        )
      : Promise.resolve([] as Snap[]),
    cached<Dim[]>('forecast_chart_dim_sku', 10 * 60_000, () =>
      fetchAll<Dim>(
        (sb) => sb.from('dim_sku').select('sku_ms, ' + MONTH_KEYS.join(', ')),
        supabase,
      )
    ),
  ])

  // 4. Факт по дням (шт.)
  const factByDate: Record<string, number> = {}
  for (const r of allDaily) {
    factByDate[r.metric_date] = (factByDate[r.metric_date] ?? 0) + (r.sales_qty ?? 0)
  }

  // 5. velocity_31d по SKU — суммарные продажи за 31 день / 31
  const sumByMs: Record<string, number> = {}
  for (const r of allDaily) sumByMs[r.sku_ms] = (sumByMs[r.sku_ms] ?? 0) + (r.sales_qty ?? 0)
  const velocityByMs: Record<string, number> = {}
  for (const [ms, sum] of Object.entries(sumByMs)) velocityByMs[ms] = sum / 30

  // 6. Текущий остаток по SKU + общий
  const stockByMs: Record<string, number> = {}
  let totalStock = 0
  for (const r of snapRows) {
    const s = (r.fbo_wb ?? 0) + (r.fbs_pushkino ?? 0) + (r.fbs_smolensk ?? 0) + (r.kits_qty ?? 0)
    stockByMs[r.sku_ms] = s
    totalStock += s
  }

  // 7. dim_sku — сезонные коэффициенты + avg_year по SKU (для де-сезонализации velocity)
  const dimByMs: Record<string, Dim> = {}
  for (const d of dimRows) dimByMs[d.sku_ms] = d
  const avgYearByMs: Record<string, number> = {}
  for (const ms of Object.keys(velocityByMs)) {
    const dim = dimByMs[ms]
    if (!dim) { avgYearByMs[ms] = 1; continue }
    const vals = MONTH_KEYS.map(k => dim[k]).filter((v): v is number => v != null && v > 0)
    avgYearByMs[ms] = vals.length > 0 ? (vals.reduce((a, b) => a + b, 0) / vals.length) : 1
  }

  // 8. Прогноз на 30 дней вперёд: для каждого дня — Σ_SKU(velocity × seasonal_coef / avg_year)
  const forecastByDate: Record<string, number> = {}
  for (let i = 1; i <= 30; i++) {
    const date = addDaysISO(maxDate, i)
    const month = new Date(date).getMonth()  // 0..11
    let sum = 0
    for (const [ms, v] of Object.entries(velocityByMs)) {
      const dim = dimByMs[ms]
      const coef = dim?.[MONTH_KEYS[month]] ?? null
      const avg = avgYearByMs[ms] ?? 1
      const adj = (coef != null && coef > 0 && avg > 0) ? (coef / avg) : 1
      sum += v * adj
    }
    forecastByDate[date] = sum
  }

  // 9. Stock — стартует с totalStock на maxDate, убывает по forecast
  const stockByDate: Record<string, number> = {}
  let runningStock = totalStock
  stockByDate[maxDate] = runningStock
  for (let i = 1; i <= 30; i++) {
    const date = addDaysISO(maxDate, i)
    runningStock = runningStock - (forecastByDate[date] ?? 0)
    if (runningStock < 0) runningStock = 0
    stockByDate[date] = runningStock
  }

  // 10. Собираем массив точек: 30 дней назад + 30 вперёд
  type ChartPoint = { date: string; fact: number | null; forecast: number | null; stock: number | null }
  const points: ChartPoint[] = []
  // прошлое
  for (let i = -29; i <= 0; i++) {
    const date = addDaysISO(maxDate, i)
    points.push({
      date,
      fact: Math.round(factByDate[date] ?? 0),
      forecast: null,
      stock: i === 0 ? Math.round(stockByDate[date] ?? totalStock) : null,
    })
  }
  // будущее
  for (let i = 1; i <= 30; i++) {
    const date = addDaysISO(maxDate, i)
    points.push({
      date,
      fact: null,
      forecast: Math.round(forecastByDate[date] ?? 0),
      stock: Math.round(stockByDate[date] ?? 0),
    })
  }

  return NextResponse.json({
    rows: points,
    latest_date: maxDate,
    total_stock: Math.round(totalStock),
  })
}
