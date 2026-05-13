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
const MONTH_RU = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек']

function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso)
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

function daysInMonth(year: number, month0: number): number {
  return new Date(year, month0 + 1, 0).getDate()
}

function ym(year: number, month0: number): string {
  return `${year}-${String(month0 + 1).padStart(2, '0')}`
}

/**
 * Прогноз продаж — ПОМЕСЯЧНО, в РУБЛЯХ, окно 8 месяцев:
 *   • 4 прошлых месяца (включая текущий M0) + 4 будущих = 8 точек
 *   • Три линии непрерывны:
 *       - fact_rub    — фактическая выручка по месяцу (Σ revenue из fact_sku_daily); только прошлое
 *       - forecast_rub — Σ velocity × сезонный коэф этого месяца × price × дней_в_месяце (все 8)
 *       - stock_rub   — остаток на складах в ₽; учитывает продажи и плановые приходы
 *
 * Stock-walk:
 *   stock_M0_end = totalStockRub  (текущий снапшот)
 *   Будущее: stock[m+1] = max(0, stock[m] − forecast[m+1] + arrivals[m+1])
 *   Прошлое: stock[m-1] = stock[m] + fact[m] − arrivals[m]
 *
 * Migration: supabase/021_forecast_monthly_revenue.sql
 */
export async function GET() {
  try {
    return await handle()
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[forecast-chart]', msg)
    return NextResponse.json({ error: msg, rows: [] }, { status: 500 })
  }
}

async function handle() {
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

  // ── Окно для расчёта velocity_30d — последние 30 дней ────────────────────
  const velocityFrom = addDaysISO(maxDate, -29)

  // ── Окно для месячной агрегации фактической выручки — 4 прошлых месяца ──
  const maxD     = new Date(maxDate)
  const nowYear  = maxD.getFullYear()
  const nowMonth = maxD.getMonth()                  // 0..11, M0
  // Начало 3-х месячного бэка: первый день месяца (nowMonth - 3)
  const factFromDate = new Date(nowYear, nowMonth - 3, 1)
  const factFromISO  = factFromDate.toISOString().split('T')[0]
  // Конец будущего окна (для подсчёта приходов): месяц nowMonth + 4, последний день
  const futureToDate = new Date(nowYear, nowMonth + 5, 0)
  const futureToISO  = futureToDate.toISOString().split('T')[0]

  type Daily = { sku_ms: string; metric_date: string; sales_qty: number | null }
  type Snap  = {
    sku_ms: string
    fbo_wb: number | null; fbs_pushkino: number | null; fbs_smolensk: number | null; kits_qty: number | null
    price: number | null
    plan_supply_date: string | null; plan_supply_qty: number | null
  }
  type Dim   = { sku_ms: string } & Record<MonthKey, number | null>
  type MonthlyRev = { ym: string; revenue: number; sales_qty: number }

  // RPC оборачиваем в async-функцию чтобы поймать ошибку отсутствующей функции
  // (без catch Promise.all отверг бы весь запрос). Если ошибка про функцию — даём 503-подсказку.
  const monthlyRevPromise: Promise<{ data: MonthlyRev[] | null; error: { message?: string } | null }> = (async () => {
    try {
      const res = await supabase.rpc('forecast_monthly_revenue', { p_from: factFromISO, p_to: maxDate })
      return { data: res.data as MonthlyRev[] | null, error: res.error }
    } catch (e: unknown) {
      return { data: null, error: { message: e instanceof Error ? e.message : String(e) } }
    }
  })()

  const [velocityDaily, snapRows, dimRows, monthlyRevRes] = await Promise.all([
    fetchAll<Daily>(
      (sb) => sb.from('fact_sku_daily')
        .select('sku_ms, metric_date, sales_qty')
        .gte('metric_date', velocityFrom).lte('metric_date', maxDate),
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
    monthlyRevPromise,
  ])

  if (monthlyRevRes.error) {
    const msg = monthlyRevRes.error.message ?? 'unknown'
    if (/function|forecast_monthly_revenue/i.test(msg)) {
      return NextResponse.json({
        error: 'Миграция 021_forecast_monthly_revenue не применена. Выполните supabase/021_forecast_monthly_revenue.sql.',
        details: msg,
        rows: [],
      }, { status: 503 })
    }
    return NextResponse.json({ error: msg, rows: [] }, { status: 500 })
  }
  const monthlyFactRows: MonthlyRev[] = (monthlyRevRes.data ?? [])
  const factByYm: Record<string, number> = {}
  for (const r of monthlyFactRows) factByYm[r.ym] = Number(r.revenue ?? 0)

  // velocity_30d (шт/день) по SKU
  const sumQtyByMs: Record<string, number> = {}
  for (const r of velocityDaily) sumQtyByMs[r.sku_ms] = (sumQtyByMs[r.sku_ms] ?? 0) + (r.sales_qty ?? 0)
  const velocityByMs: Record<string, number> = {}
  for (const [ms, sum] of Object.entries(sumQtyByMs)) velocityByMs[ms] = sum / 30

  // Цена + остатки + плановые приходы по SKU
  const priceByMs: Record<string, number> = {}
  let totalStockRub = 0
  type PlannedArrival = { date: string; rub: number }
  const plannedArrivals: PlannedArrival[] = []
  for (const r of snapRows) {
    const stockQty = (r.fbo_wb ?? 0) + (r.fbs_pushkino ?? 0) + (r.fbs_smolensk ?? 0) + (r.kits_qty ?? 0)
    const price = r.price ?? 0
    priceByMs[r.sku_ms] = price
    totalStockRub += stockQty * price
    if (r.plan_supply_date && r.plan_supply_qty && r.plan_supply_qty > 0) {
      plannedArrivals.push({ date: r.plan_supply_date, rub: r.plan_supply_qty * price })
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

  // Прогноз продаж для одного месяца (₽):
  //   Σ velocity × (seasonal_coef[month] / avg_year) × price × days_in_month
  function monthForecastRub(year: number, month0: number): number {
    const dim_idx = month0
    const days = daysInMonth(year, month0)
    let total = 0
    for (const [ms, vel] of Object.entries(velocityByMs)) {
      const dim = dimByMs[ms]
      const coef = dim?.[MONTH_KEYS[dim_idx]] ?? null
      const avg = avgYearByMs[ms] ?? 1
      const adj = (coef != null && coef > 0 && avg > 0) ? (coef / avg) : 1
      const price = priceByMs[ms] ?? 0
      total += vel * adj * price * days
    }
    return total
  }

  // Плановые приходы внутри месяца (₽)
  function monthArrivalsRub(year: number, month0: number): number {
    const start = ym(year, month0)                                  // YYYY-MM
    const end   = new Date(year, month0 + 1, 0).toISOString().split('T')[0]
    const startISO = `${start}-01`
    let sum = 0
    for (const a of plannedArrivals) {
      if (a.date >= startISO && a.date <= end) sum += a.rub
    }
    return sum
  }

  // ── 8 месяцев: индексы [-3, -2, -1, 0, +1, +2, +3, +4] от M0 ──
  type MonthPoint = {
    label: string
    year:  number
    month: number      // 0..11
    type: 'past' | 'future'
    fact_rub: number | null
    forecast_rub: number | null
    stock_rub: number | null
    arrivals_rub: number | null
  }
  const months: MonthPoint[] = []
  for (let i = -3; i <= 4; i++) {
    const dt = new Date(nowYear, nowMonth + i, 1)
    const y = dt.getFullYear()
    const m = dt.getMonth()
    const isPast = i <= 0
    const ymKey = ym(y, m)
    // Текущий месяц (i=0) — данные неполные, fact_rub считаем как Σ дней до maxDate (RPC уже учитывает это)
    const factRub = isPast ? (factByYm[ymKey] ?? 0) : null
    months.push({
      label:        `${MONTH_RU[m]} ${String(y).slice(2)}`,
      year:  y,
      month: m,
      type:  isPast ? 'past' : 'future',
      fact_rub:     factRub != null ? Math.round(factRub) : null,
      forecast_rub: Math.round(monthForecastRub(y, m)),
      stock_rub:    null,
      arrivals_rub: Math.round(monthArrivalsRub(y, m)),
    })
  }

  // Stock walk: M0 (i=3 в массиве) — известный текущий остаток.
  const m0Idx = 3
  months[m0Idx].stock_rub = Math.round(totalStockRub)
  // Backward (M-1, M-2, M-3)
  let s = totalStockRub
  for (let i = m0Idx - 1; i >= 0; i--) {
    s = s + (months[i + 1].fact_rub ?? 0) - (months[i + 1].arrivals_rub ?? 0)
    months[i].stock_rub = Math.round(Math.max(0, s))
  }
  // Forward (M+1..M+4)
  s = totalStockRub
  for (let i = m0Idx + 1; i < months.length; i++) {
    s = Math.max(0, s - (months[i].forecast_rub ?? 0) + (months[i].arrivals_rub ?? 0))
    months[i].stock_rub = Math.round(s)
  }

  return NextResponse.json({
    rows: months,
    latest_date: maxDate,
    total_stock_rub: Math.round(totalStockRub),
  })
}
