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
 * Прогноз продаж — ПОНЕДЕЛЬНО, в РУБЛЯХ:
 *   • 4 прошлые недели (фактическая выручка)
 *   • 4 будущие недели (прогноз)
 *   • Остаток в рублях (накопительно убывает по мере прогноза)
 *
 * Логика:
 *   • week_start = maxDate - (28-1) дней, и далее шаг 7 дней.
 *   • Прошлое: fact_rub = Σ revenue по неделе.
 *   • Будущее: forecast_rub = Σ velocity_30d × seasonal × price (по SKU).
 *   • Остаток: stock_rub_start = Σ stock_qty × price; убывает по forecast (в рублях).
 */
export async function GET() {
  const supabase = createServiceClient()

  const { data: maxRow } = await supabase
    .from('fact_sku_daily').select('metric_date')
    .order('metric_date', { ascending: false }).limit(1)
  const maxDate: string | null = maxRow?.[0]?.metric_date ?? null
  if (!maxDate) return NextResponse.json({ rows: [] })

  const { data: maxSnapRow } = await supabase
    .from('fact_sku_period').select('period_end')
    .order('period_end', { ascending: false }).limit(1)
  const maxSnapDate: string | null = maxSnapRow?.[0]?.period_end ?? null

  // Берём 30 дней назад для расчёта velocity + 28 дней для факта (4 недели)
  const factFrom = addDaysISO(maxDate, -29)

  type Daily = { sku_ms: string; metric_date: string; sales_qty: number | null; revenue: number | null }
  type Snap  = { sku_ms: string; fbo_wb: number | null; fbs_pushkino: number | null; fbs_smolensk: number | null; kits_qty: number | null; price: number | null }
  type Dim   = { sku_ms: string } & Record<MonthKey, number | null>

  const [allDaily, snapRows, dimRows] = await Promise.all([
    fetchAll<Daily>(
      (sb) => sb.from('fact_sku_daily')
        .select('sku_ms, metric_date, sales_qty, revenue')
        .gte('metric_date', factFrom).lte('metric_date', maxDate)
        .order('metric_date'),
      supabase,
    ),
    maxSnapDate
      ? fetchAll<Snap>(
          (sb) => sb.from('fact_sku_period')
            .select('sku_ms, fbo_wb, fbs_pushkino, fbs_smolensk, kits_qty, price')
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

  // velocity_30d (шт/день) и avg_price по SKU
  const sumQtyByMs: Record<string, number> = {}
  for (const r of allDaily) sumQtyByMs[r.sku_ms] = (sumQtyByMs[r.sku_ms] ?? 0) + (r.sales_qty ?? 0)
  const velocityByMs: Record<string, number> = {}
  for (const [ms, sum] of Object.entries(sumQtyByMs)) velocityByMs[ms] = sum / 30

  // Цена и остатки по SKU
  const priceByMs: Record<string, number> = {}
  const stockByMs: Record<string, number> = {}
  let totalStockRub = 0
  for (const r of snapRows) {
    const stockQty = (r.fbo_wb ?? 0) + (r.fbs_pushkino ?? 0) + (r.fbs_smolensk ?? 0) + (r.kits_qty ?? 0)
    stockByMs[r.sku_ms] = stockQty
    priceByMs[r.sku_ms] = r.price ?? 0
    totalStockRub += stockQty * (r.price ?? 0)
  }

  // Сезонные коэффициенты
  const dimByMs: Record<string, Dim> = {}
  for (const d of dimRows) dimByMs[d.sku_ms] = d
  const avgYearByMs: Record<string, number> = {}
  for (const ms of Object.keys(velocityByMs)) {
    const dim = dimByMs[ms]
    if (!dim) { avgYearByMs[ms] = 1; continue }
    const vals = MONTH_KEYS.map(k => dim[k]).filter((v): v is number => v != null && v > 0)
    avgYearByMs[ms] = vals.length > 0 ? (vals.reduce((a, b) => a + b, 0) / vals.length) : 1
  }

  // ── Понедельная агрегация ──────────────────────────────────────────────
  // Текущая неделя: maxDate-6..maxDate. Прошлые: -13..-7, -20..-14, -27..-21.
  // Будущие: maxDate+1..+7, +8..+14, +15..+21, +22..+28.

  type WeekPoint = {
    week_label: string
    week_start: string
    week_end:   string
    type: 'past' | 'future'
    fact_rub: number | null
    forecast_rub: number | null
    stock_rub: number | null
  }

  const weeks: WeekPoint[] = []

  // Факт по дням: revenue (₽)
  const revByDate: Record<string, number> = {}
  for (const r of allDaily) {
    revByDate[r.metric_date] = (revByDate[r.metric_date] ?? 0) + (r.revenue ?? 0)
  }

  // 4 прошлые недели (включая текущую как самую правую)
  for (let w = 3; w >= 0; w--) {
    const weekEnd   = addDaysISO(maxDate, -7 * w)
    const weekStart = addDaysISO(weekEnd, -6)
    let factRub = 0
    for (let d = 0; d < 7; d++) {
      const date = addDaysISO(weekStart, d)
      factRub += revByDate[date] ?? 0
    }
    const lbl = formatWeekLabel(weekStart, weekEnd)
    weeks.push({
      week_label: lbl,
      week_start: weekStart,
      week_end:   weekEnd,
      type: 'past',
      fact_rub:     Math.round(factRub),
      forecast_rub: null,
      stock_rub:    w === 0 ? Math.round(totalStockRub) : null,
    })
  }

  // 4 будущие недели — прогноз
  let runningStockRub = totalStockRub
  for (let w = 1; w <= 4; w++) {
    const weekStart = addDaysISO(maxDate, 7 * (w - 1) + 1)
    const weekEnd   = addDaysISO(maxDate, 7 * w)
    // forecast_rub = Σ_SKU velocity × seasonal × price × 7
    let forecastRub = 0
    // Используем средний месяц этой недели для сезонного коэффициента
    const midDate = addDaysISO(weekStart, 3)
    const midMonth = new Date(midDate).getMonth()
    for (const [ms, vel] of Object.entries(velocityByMs)) {
      const dim = dimByMs[ms]
      const coef = dim?.[MONTH_KEYS[midMonth]] ?? null
      const avg = avgYearByMs[ms] ?? 1
      const adj = (coef != null && coef > 0 && avg > 0) ? (coef / avg) : 1
      const price = priceByMs[ms] ?? 0
      forecastRub += vel * adj * price * 7
    }
    runningStockRub = Math.max(0, runningStockRub - forecastRub)
    const lbl = formatWeekLabel(weekStart, weekEnd)
    weeks.push({
      week_label: lbl,
      week_start: weekStart,
      week_end:   weekEnd,
      type: 'future',
      fact_rub:     null,
      forecast_rub: Math.round(forecastRub),
      stock_rub:    Math.round(runningStockRub),
    })
  }

  return NextResponse.json({
    rows: weeks,
    latest_date: maxDate,
    total_stock_rub: Math.round(totalStockRub),
  })
}

function formatWeekLabel(start: string, end: string): string {
  // Формат «10–16 окт»
  const MONTHS = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек']
  const s = new Date(start), e = new Date(end)
  const sd = s.getDate(), ed = e.getDate()
  const sm = MONTHS[s.getMonth()], em = MONTHS[e.getMonth()]
  if (sm === em) return `${sd}–${ed} ${em}`
  return `${sd} ${sm} – ${ed} ${em}`
}
