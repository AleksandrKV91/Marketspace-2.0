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
 * Прогноз продаж — ПОНЕДЕЛЬНО, в РУБЛЯХ, окно 8 недель:
 *   • 4 прошлые недели + 4 будущие = 8 точек
 *   • Все три линии непрерывны на всём диапазоне:
 *       - fact_rub    — фактическая выручка (по revenue из fact_sku_daily); только прошлое
 *       - forecast_rub — Σ velocity × сезонность месяца этой недели × price × 7 (все 8 недель)
 *       - stock_rub   — остаток на складах в ₽ с учётом продаж и плановых приходов
 *
 * Логика остатка (8 недель сквозь now):
 *   stock_W0_end = totalStockRub  (текущий снапшот)
 *   Будущее (forward):  stock[t+1] = max(0, stock[t] − forecast[t+1] + arrivals_planned[t+1])
 *   Прошлое (backward): stock[t-1] = stock[t] + fact[t]                  (исторических приходов не знаем — 0)
 *
 * arrivals_planned[t] — берётся из fact_sku_period.plan_supply_date/plan_supply_qty:
 *   если plan_supply_date попадает в неделю t, считаем plan_supply_qty × price.
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

  // Берём 30 дней для расчёта velocity (= 4 прошлые недели данных)
  const factFrom = addDaysISO(maxDate, -29)

  type Daily = { sku_ms: string; metric_date: string; sales_qty: number | null; revenue: number | null }
  type Snap  = {
    sku_ms: string
    fbo_wb: number | null; fbs_pushkino: number | null; fbs_smolensk: number | null; kits_qty: number | null
    price: number | null
    plan_supply_date: string | null; plan_supply_qty: number | null
  }
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
            .select('sku_ms, fbo_wb, fbs_pushkino, fbs_smolensk, kits_qty, price, plan_supply_date, plan_supply_qty')
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

  // velocity_30d (шт/день) по SKU — для непрерывного прогноза на 8 недель
  const sumQtyByMs: Record<string, number> = {}
  for (const r of allDaily) sumQtyByMs[r.sku_ms] = (sumQtyByMs[r.sku_ms] ?? 0) + (r.sales_qty ?? 0)
  const velocityByMs: Record<string, number> = {}
  for (const [ms, sum] of Object.entries(sumQtyByMs)) velocityByMs[ms] = sum / 30

  // Цена + остатки + плановые приходы по SKU
  const priceByMs: Record<string, number> = {}
  const stockByMs: Record<string, number> = {}
  let totalStockRub = 0
  type PlannedArrival = { sku_ms: string; date: string; qty: number; rub: number }
  const plannedArrivals: PlannedArrival[] = []
  for (const r of snapRows) {
    const stockQty = (r.fbo_wb ?? 0) + (r.fbs_pushkino ?? 0) + (r.fbs_smolensk ?? 0) + (r.kits_qty ?? 0)
    stockByMs[r.sku_ms] = stockQty
    const price = r.price ?? 0
    priceByMs[r.sku_ms] = price
    totalStockRub += stockQty * price
    if (r.plan_supply_date && r.plan_supply_qty && r.plan_supply_qty > 0) {
      plannedArrivals.push({
        sku_ms: r.sku_ms,
        date: r.plan_supply_date,
        qty: r.plan_supply_qty,
        rub: r.plan_supply_qty * price,
      })
    }
  }

  // Сезонные коэффициенты SKU
  const dimByMs: Record<string, Dim> = {}
  for (const d of dimRows) dimByMs[d.sku_ms] = d
  const avgYearByMs: Record<string, number> = {}
  for (const ms of Object.keys(velocityByMs)) {
    const dim = dimByMs[ms]
    if (!dim) { avgYearByMs[ms] = 1; continue }
    const vals = MONTH_KEYS.map(k => dim[k]).filter((v): v is number => v != null && v > 0)
    avgYearByMs[ms] = vals.length > 0 ? (vals.reduce((a, b) => a + b, 0) / vals.length) : 1
  }

  // Σ выручки по дням (₽)
  const revByDate: Record<string, number> = {}
  for (const r of allDaily) {
    revByDate[r.metric_date] = (revByDate[r.metric_date] ?? 0) + (r.revenue ?? 0)
  }

  // ── Готовим 8 недель: 4 прошлые (включая текущую как W0) + 4 будущие ──
  type WeekPoint = {
    week_label: string
    week_start: string
    week_end:   string
    type: 'past' | 'future'
    fact_rub: number | null
    forecast_rub: number | null
    stock_rub: number | null
    arrivals_rub: number | null
  }
  const weeks: WeekPoint[] = []

  // Прогноз продаж для одной недели (₽) — общий хелпер.
  // midDate берётся как середина недели для выбора сезонного коэффициента.
  function weeklyForecastRub(weekStart: string): number {
    const midDate = addDaysISO(weekStart, 3)
    const midMonth = new Date(midDate).getMonth()
    let total = 0
    for (const [ms, vel] of Object.entries(velocityByMs)) {
      const dim = dimByMs[ms]
      const coef = dim?.[MONTH_KEYS[midMonth]] ?? null
      const avg = avgYearByMs[ms] ?? 1
      const adj = (coef != null && coef > 0 && avg > 0) ? (coef / avg) : 1
      const price = priceByMs[ms] ?? 0
      total += vel * adj * price * 7
    }
    return total
  }

  // Плановые приходы внутри недели (₽)
  function weeklyArrivalsRub(weekStart: string, weekEnd: string): number {
    let sum = 0
    for (const a of plannedArrivals) {
      if (a.date >= weekStart && a.date <= weekEnd) sum += a.rub
    }
    return sum
  }

  // Шаг 1: собираем 4 прошлые недели (от W-3 до W0 — текущая, заканчивается на maxDate)
  for (let w = 3; w >= 0; w--) {
    const weekEnd   = addDaysISO(maxDate, -7 * w)
    const weekStart = addDaysISO(weekEnd, -6)
    let factRub = 0
    for (let d = 0; d < 7; d++) {
      const date = addDaysISO(weekStart, d)
      factRub += revByDate[date] ?? 0
    }
    weeks.push({
      week_label: formatWeekLabel(weekStart, weekEnd),
      week_start: weekStart,
      week_end:   weekEnd,
      type: 'past',
      fact_rub:     Math.round(factRub),
      forecast_rub: Math.round(weeklyForecastRub(weekStart)),
      stock_rub:    null,        // заполним позже backward-walk'ом
      arrivals_rub: Math.round(weeklyArrivalsRub(weekStart, weekEnd)),
    })
  }

  // Шаг 2: 4 будущие недели (W+1..W+4)
  for (let w = 1; w <= 4; w++) {
    const weekStart = addDaysISO(maxDate, 7 * (w - 1) + 1)
    const weekEnd   = addDaysISO(maxDate, 7 * w)
    weeks.push({
      week_label: formatWeekLabel(weekStart, weekEnd),
      week_start: weekStart,
      week_end:   weekEnd,
      type: 'future',
      fact_rub:     null,
      forecast_rub: Math.round(weeklyForecastRub(weekStart)),
      stock_rub:    null,
      arrivals_rub: Math.round(weeklyArrivalsRub(weekStart, weekEnd)),
    })
  }

  // Шаг 3: остаток — сквозной walk через все 8 недель.
  // W0 (последняя прошлая) — известный текущий остаток.
  // Прошлое (W-1, W-2, W-3): backward — stock_prev = stock_cur + fact_cur − arrivals_cur
  //   (исторических приходов точно не знаем, но если в этой неделе план совпал — учитываем)
  // Будущее: forward — stock_next = max(0, stock_cur − forecast_next + arrivals_next)
  const w0Idx = 3                         // индекс текущей недели в массиве (0..3 = past, 3 = W0)
  weeks[w0Idx].stock_rub = Math.round(totalStockRub)
  let s = totalStockRub
  for (let i = w0Idx - 1; i >= 0; i--) {
    s = s + (weeks[i + 1].fact_rub ?? 0) - (weeks[i + 1].arrivals_rub ?? 0)
    weeks[i].stock_rub = Math.round(Math.max(0, s))
  }
  s = totalStockRub
  for (let i = w0Idx + 1; i < weeks.length; i++) {
    s = Math.max(0, s - (weeks[i].forecast_rub ?? 0) + (weeks[i].arrivals_rub ?? 0))
    weeks[i].stock_rub = Math.round(s)
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
