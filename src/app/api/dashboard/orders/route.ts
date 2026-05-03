import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/supabase/fetchAll'
import { cached } from '@/lib/cache'

export const maxDuration = 60

const MONTH_KEYS = [
  'month_jan','month_feb','month_mar','month_apr','month_may','month_jun',
  'month_jul','month_aug','month_sep','month_oct','month_nov','month_dec',
] as const
type MonthKey = typeof MONTH_KEYS[number]
const MONTH_RU = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек']

const DEFAULT_LEAD_TIME = 45  // медианный фоллбэк, когда lead_time_days неизвестен

function stddev(arr: number[]): number {
  if (arr.length === 0) return 0
  const mean = arr.reduce((s, v) => s + v, 0) / arr.length
  const variance = arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length
  return Math.sqrt(variance)
}

function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso)
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

export async function GET(req: Request) {
  const supabase = createServiceClient()
  const url = new URL(req.url)
  const horizon = parseInt(url.searchParams.get('horizon') ?? '60', 10)
  const period = parseInt(url.searchParams.get('period') ?? '31', 10)  // 7|14|31
  const fromParam = url.searchParams.get('from')
  const toParam = url.searchParams.get('to')
  const categoryFilter = url.searchParams.get('category') ?? ''
  const managerFilter  = url.searchParams.get('manager') ?? ''
  const noveltyFilter  = url.searchParams.get('novelty') ?? ''

  // ── 1-2. Параллельно: uploads + dim_sku + max dates ─────────────────────
  type DimRow = {
    sku_ms: string; sku_wb: number | null; name: string | null; brand: string | null
    subject_wb: string | null; category_wb: string | null
  } & Record<MonthKey, number | null>

  const [
    latestByType,
    dimRows,
    { data: maxSnapRow },
    { data: maxMetricRow },
  ] = await Promise.all([
    cached('orders_latest_uploads', 60_000, async () => {
      const { data } = await supabase.from('uploads').select('id, file_type')
        .eq('status', 'ok').order('uploaded_at', { ascending: false }).limit(20)
      const result: Record<string, string> = {}
      if (data) for (const u of data) {
        if (!result[u.file_type]) result[u.file_type] = u.id
      }
      return result
    }),
    cached<DimRow[]>('orders_dim_sku', 10 * 60_000, () =>
      fetchAll<DimRow>(
        (sb) => sb.from('dim_sku').select('sku_ms, sku_wb, name, brand, subject_wb, category_wb, ' + MONTH_KEYS.join(', ')),
        supabase,
      )
    ),
    supabase.from('fact_sku_period').select('period_end')
      .order('period_end', { ascending: false }).limit(1),
    supabase.from('fact_sku_daily').select('metric_date')
      .order('metric_date', { ascending: false }).limit(1),
  ])
  const chinaId = latestByType['china']
  const abcId   = latestByType['abc']
  const maxSnapDate: string | null = maxSnapRow?.[0]?.period_end ?? null
  const maxDate:     string | null = maxMetricRow?.[0]?.metric_date ?? null

  // ── Период из глобального DateRangePicker ───────────────────────────────
  // Если from/to не передан — берём последние 7 дней (как fallback)
  let fromDaily: string | null = fromParam
  let toDaily:   string | null = toParam
  if ((!fromDaily || !toDaily) && maxDate) {
    toDaily = maxDate
    fromDaily = addDaysISO(maxDate, -6)
  }
  // Предыдущий равный период для дельты выручки
  let prevFrom: string | null = null
  let prevTo:   string | null = null
  if (fromDaily && toDaily) {
    const ms = new Date(toDaily).getTime() - new Date(fromDaily).getTime()
    const days = Math.round(ms / 86400000) + 1
    prevTo   = addDaysISO(fromDaily, -1)
    prevFrom = addDaysISO(prevTo, -(days - 1))
  }

  // ── 3-4. Параллельно: snapshot + daily sales + china + abc + period rev ─
  type PeriodRow = {
    sku_ms: string; sku_wb: number | null; period_end: string
    product_name: string | null; brand: string | null; subject_wb: string | null; category: string | null
    fbo_wb: number | null; fbs_pushkino: number | null; fbs_smolensk: number | null
    kits_qty: number | null; stock_days: number | null; price: number | null
    period_marginality_wgt: number | null; plan_supply_date: string | null; plan_supply_qty: number | null
    days_until_arrival: number | null; manager: string | null; novelty_status: string | null
  }
  type DailyAgg  = { sku_ms: string; metric_date: string; sales_qty: number | null; revenue: number | null }
  type AbcRow    = { sku_ms: string; final_class_1: string | null; profitability: number | null; chmd_clean: number | null; tz: number | null }
  type ChinaDbRow = { sku_ms: string; in_transit: number | null; in_production: number | null; nearest_date: string | null; cost_plan: number | null; lead_time_days: number | null; order_qty: number | null }

  const from31 = maxDate ? addDaysISO(maxDate, -30) : null

  // Единый расширенный диапазон для всех временных нужд: velocity (31д), curr period, prev period.
  // Запрашиваем один раз — фильтруем в памяти.
  const isoMin = (a: string | null, b: string | null) => a && b ? (a < b ? a : b) : (a ?? b ?? null)
  const isoMax = (a: string | null, b: string | null) => a && b ? (a > b ? a : b) : (a ?? b ?? null)
  const dailyFrom = isoMin(from31, prevFrom)
  const dailyTo   = isoMax(maxDate, toDaily)

  const [periodRows, allDaily, chinaDbRows, abcRows] = await Promise.all([
    maxSnapDate
      ? fetchAll<PeriodRow>(
          (sb) => sb.from('fact_sku_period')
            .select('sku_ms, sku_wb, period_end, product_name, brand, subject_wb, category, fbo_wb, fbs_pushkino, fbs_smolensk, kits_qty, stock_days, price, period_marginality_wgt, plan_supply_date, plan_supply_qty, days_until_arrival, manager, novelty_status')
            .eq('period_end', maxSnapDate)
            .order('sku_ms'),
          supabase,
        )
      : Promise.resolve([] as PeriodRow[]),
    dailyFrom && dailyTo
      ? fetchAll<DailyAgg>(
          (sb) => sb.from('fact_sku_daily')
            .select('sku_ms, metric_date, sales_qty, revenue')
            .gte('metric_date', dailyFrom!).lte('metric_date', dailyTo!)
            .order('sku_ms').order('metric_date'),
          supabase,
        )
      : Promise.resolve([] as DailyAgg[]),
    chinaId
      ? supabase.from('fact_china_supply')
          .select('sku_ms, in_transit, in_production, nearest_date, cost_plan, lead_time_days, order_qty')
          .eq('upload_id', chinaId)
      : Promise.resolve({ data: null as ChinaDbRow[] | null, error: null }),
    abcId
      ? fetchAll<AbcRow>(
          (sb) => sb.from('fact_abc')
            .select('sku_ms, final_class_1, profitability, chmd_clean, tz')
            .eq('upload_id', abcId),
          supabase,
        )
      : Promise.resolve([] as AbcRow[]),
  ])

  // sales31 = последние 31 день для velocity / OOS
  const sales31: DailyAgg[] = from31 && maxDate
    ? allDaily.filter(r => r.metric_date >= from31 && r.metric_date <= maxDate)
    : []

  // Per-SKU revenue map (current и previous период) — фильтруем в памяти из allDaily
  const periodRevenueMap: Record<string, number> = {}
  const prevPeriodRevenueMap: Record<string, number> = {}
  for (const r of allDaily) {
    if (fromDaily && toDaily && r.metric_date >= fromDaily && r.metric_date <= toDaily) {
      periodRevenueMap[r.sku_ms] = (periodRevenueMap[r.sku_ms] ?? 0) + (r.revenue ?? 0)
    }
    if (prevFrom && prevTo && r.metric_date >= prevFrom && r.metric_date <= prevTo) {
      prevPeriodRevenueMap[r.sku_ms] = (prevPeriodRevenueMap[r.sku_ms] ?? 0) + (r.revenue ?? 0)
    }
  }

  // ── Build maps ──────────────────────────────────────────────────────────
  type SnapRow = {
    sku_ms: string; sku_wb: number | null; snap_date: string | null
    name: string | null; brand: string | null; subject_wb: string | null; category: string | null
    fbo_wb: number | null; fbs_pushkino: number | null; fbs_smolensk: number | null
    kits_stock: number | null; stock_days: number | null; price: number | null
    margin_pct: number | null; supply_date: string | null; supply_qty: number | null
    days_to_arrival: number | null; manager: string | null; novelty_status: string | null
  }
  const snapMap: Record<string, SnapRow> = {}
  for (const r of periodRows) {
    if (!snapMap[r.sku_ms]) snapMap[r.sku_ms] = {
      sku_ms: r.sku_ms, sku_wb: r.sku_wb, snap_date: r.period_end,
      name: r.product_name, brand: r.brand, subject_wb: r.subject_wb, category: r.category,
      fbo_wb: r.fbo_wb, fbs_pushkino: r.fbs_pushkino, fbs_smolensk: r.fbs_smolensk,
      kits_stock: r.kits_qty, stock_days: r.stock_days, price: r.price,
      margin_pct: r.period_marginality_wgt, supply_date: r.plan_supply_date,
      supply_qty: r.plan_supply_qty, days_to_arrival: r.days_until_arrival,
      manager: r.manager, novelty_status: r.novelty_status,
    }
  }

  const dailyByMs: Record<string, Array<{ date: string; qty: number }>> = {}
  for (const r of sales31) {
    if (!r.sku_ms) continue
    if (!dailyByMs[r.sku_ms]) dailyByMs[r.sku_ms] = []
    dailyByMs[r.sku_ms].push({ date: r.metric_date, qty: r.sales_qty ?? 0 })
  }
  for (const arr of Object.values(dailyByMs)) arr.sort((a, b) => a.date.localeCompare(b.date))

  type ChinaRec = { in_transit: number; in_production: number; nearest_date: string | null; cost_plan: number | null; lead_time_days: number | null; order_qty: number | null }
  const chinaMap: Record<string, ChinaRec> = {}
  if (chinaDbRows.data) {
    for (const r of chinaDbRows.data) {
      chinaMap[r.sku_ms] = {
        in_transit: r.in_transit ?? 0, in_production: r.in_production ?? 0,
        nearest_date: r.nearest_date, cost_plan: r.cost_plan, lead_time_days: r.lead_time_days,
        order_qty: r.order_qty,
      }
    }
  }

  type AbcRec = { abc_class: string | null; profitability: number | null; chmd_clean: number | null; tz: number | null }
  const abcMap: Record<string, AbcRec> = {}
  for (const r of abcRows) {
    if (!abcMap[r.sku_ms]) {
      abcMap[r.sku_ms] = { abc_class: r.final_class_1, profitability: r.profitability, chmd_clean: r.chmd_clean, tz: r.tz }
    }
  }

  // ── dim_sku map (только для коэффициентов сезонности month_*) ────────
  const dimByMs: Record<string, DimRow> = {}
  for (const r of dimRows) dimByMs[r.sku_ms] = r

  // ── Универсум SKU: только те, что в последнем fact_sku_period снапшоте.
  // Применяем глобальные фильтры (category/manager/novelty) — все из snapMap.
  const universe: string[] = []
  for (const skuMs of Object.keys(snapMap)) {
    const snap = snapMap[skuMs]
    const cat = snap.category ?? snap.subject_wb ?? ''
    if (categoryFilter && cat !== categoryFilter) continue
    if (managerFilter  && (snap.manager ?? '') !== managerFilter) continue
    const ns = snap.novelty_status ?? ''
    if (noveltyFilter === 'Новинки'    && ns !== 'Новинки') continue
    if (noveltyFilter === 'Не новинки' && ns === 'Новинки') continue
    universe.push(skuMs)
  }

  // ── 7. YoY fallback: для тех, у кого base_31d < 5 и target_coef > 1.3*avg
  // Запрос делаем ниже после первого прохода — собираем кандидатов
  const yoyCandidates: string[] = []
  // (заполнится в первом проходе ниже)

  // ── 8. Текущий месяц + горизонт-месяцы ─────────────────────────────────
  const today = maxDate ? new Date(maxDate) : new Date()
  const nowMonth = today.getMonth()  // 0-based

  // Месяцы горизонта: [today + lt, today + lt + horizon]
  // lt = china.lead_time_days ?? DEFAULT_LEAD_TIME (per-SKU)
  function horizonMonths(lt: number, horizonDays: number): number[] {
    const start = new Date(today); start.setDate(start.getDate() + lt)
    const end = new Date(today);   end.setDate(end.getDate() + lt + horizonDays)
    const months: number[] = []
    const cur = new Date(start.getFullYear(), start.getMonth(), 1)
    while (cur <= end) {
      months.push(cur.getMonth())
      cur.setMonth(cur.getMonth() + 1)
    }
    return months.length > 0 ? months : [(nowMonth + 1) % 12]
  }

  // ── 9. Первый проход: считаем base_31d, cur_coef, target_coef ──────────
  type Pass1 = {
    sku: DimRow
    daily: Array<{ date: string; qty: number }>
    sales_qty_7d: number; sales_qty_14d: number; sales_qty_31d: number
    base_31d: number
    avg_year: number; cur_coef: number; target_coef: number
    horizon_months: number[]; lt: number
  }
  const pass1: Record<string, Pass1> = {}

  for (const skuMs of universe) {
    // dim может отсутствовать (тогда fallback значения)
    const sku: DimRow = dimByMs[skuMs] ?? {
      sku_ms: skuMs, sku_wb: snapMap[skuMs]?.sku_wb ?? null,
      name: null, brand: null, subject_wb: null, category_wb: null,
      ...Object.fromEntries(MONTH_KEYS.map(k => [k, null])) as Record<MonthKey, number | null>,
    }
    const daily = dailyByMs[skuMs] ?? []
    const last7  = daily.slice(-7)
    const last14 = daily.slice(-14)
    const last31 = daily.slice(-31)
    const sales_qty_7d  = last7.reduce((s, d) => s + d.qty, 0)
    const sales_qty_14d = last14.reduce((s, d) => s + d.qty, 0)
    const sales_qty_31d = last31.reduce((s, d) => s + d.qty, 0)
    const base_31d = sales_qty_31d / 31

    const coeffs = MONTH_KEYS.map(k => sku[k]).filter((v): v is number => v != null && v > 0)
    const avg_year = coeffs.length > 0 ? coeffs.reduce((a, b) => a + b, 0) / coeffs.length : 1
    const curRaw = sku[MONTH_KEYS[nowMonth]]
    const cur_coef = (curRaw != null && curRaw > 0) ? curRaw : avg_year

    const lt = chinaMap[skuMs]?.lead_time_days ?? DEFAULT_LEAD_TIME
    const hm = horizonMonths(lt, horizon)
    const targetCoeffs = hm.map(m => sku[MONTH_KEYS[m]]).filter((v): v is number => v != null && v > 0)
    const target_coef_raw = targetCoeffs.length > 0
      ? targetCoeffs.reduce((a, b) => a + b, 0) / targetCoeffs.length
      : avg_year
    const target_coef = target_coef_raw / (avg_year || 1)  // относительный

    pass1[skuMs] = {
      sku, daily,
      sales_qty_7d, sales_qty_14d, sales_qty_31d,
      base_31d, avg_year, cur_coef, target_coef,
      horizon_months: hm, lt,
    }

    // Кандидаты на YoY-fallback
    if (base_31d < 5 && target_coef > 1.3 && skuMs) {
      yoyCandidates.push(skuMs)
    }
  }

  // ── 10. YoY fallback запрос ─────────────────────────────────────────────
  const yoyMap: Record<string, number> = {}
  if (maxDate && yoyCandidates.length > 0) {
    const yoyFrom = addDaysISO(maxDate, -380)
    const yoyTo   = addDaysISO(maxDate, -350)
    // Берём батчами по 200 SKU чтобы не упереться в URL-лимит
    for (let i = 0; i < yoyCandidates.length; i += 200) {
      const batch = yoyCandidates.slice(i, i + 200)
      const { data: yoyRows } = await supabase
        .from('fact_sku_daily')
        .select('sku_ms, sales_qty')
        .gte('metric_date', yoyFrom)
        .lte('metric_date', yoyTo)
        .in('sku_ms', batch)
      if (yoyRows) {
        for (const r of yoyRows) {
          if (!r.sku_ms) continue
          yoyMap[r.sku_ms] = (yoyMap[r.sku_ms] ?? 0) + (r.sales_qty ?? 0)
        }
      }
    }
  }

  // ── 11. Финальная сборка строк ─────────────────────────────────────────
  type OrderRow = ReturnType<typeof buildRow>
  function buildRow(skuMs: string, p1: Pass1) {
    const { sku, daily, sales_qty_7d, sales_qty_14d, sales_qty_31d,
            base_31d, avg_year, cur_coef, target_coef, horizon_months: hm, lt } = p1

    // ШАГ 2: base_norm + YoY fallback
    let base_norm = base_31d / (cur_coef || 1)
    let used_yoy_fallback = false
    let yoy_base_norm: number | null = null
    if (base_31d < 5 && target_coef > 1.3 && yoyMap[skuMs] != null) {
      const yoy_qty = yoyMap[skuMs]
      const yoy_base = yoy_qty / 31
      yoy_base_norm = yoy_base / (cur_coef || 1)
      if (yoy_base > base_31d) {
        base_norm = yoy_base_norm
        used_yoy_fallback = true
      }
    }

    // ШАГ 3: потребность
    const demand_qty = base_norm * target_coef * horizon

    // ШАГ 4: страховой запас
    const sigma_31d = stddev(daily.slice(-31).map(d => d.qty))
    let cv = base_31d > 0.1 ? sigma_31d / base_31d : 1.0
    if (sigma_31d === 0) cv = Math.max(cv, 0.3)
    const non_zero_days = daily.slice(-31).filter(d => d.qty > 0).length
    const low_data = non_zero_days < 10
    if (low_data) cv = Math.max(cv, 1.0)
    const safety_days = Math.sqrt(lt) * cv
    const safety_qty = base_norm * target_coef * safety_days

    // ШАГ 5: что уже есть
    const snap = snapMap[skuMs]
    const fbo = snap?.fbo_wb ?? 0
    const fbsPush = snap?.fbs_pushkino ?? 0
    const fbsSmol = snap?.fbs_smolensk ?? 0
    const kits = snap?.kits_stock ?? 0
    const total_stock = fbo + fbsPush + fbsSmol + kits
    const china = chinaMap[skuMs]
    const in_transit = china?.in_transit ?? 0
    const in_production = china?.in_production ?? 0
    const on_hand_total = total_stock + in_transit + in_production

    // ШАГ 6: к заказу
    const calc_order = Math.max(0, Math.round(demand_qty + safety_qty - on_hand_total))

    // Производные
    const dpd = base_31d
    const days_stock = dpd > 0 ? Math.round(total_stock / dpd) : (total_stock > 0 ? 999 : 0)
    const oos_days_31 = daily.slice(-31).filter(d => d.qty === 0).length

    // Выручка за выбранный период + дельта vs предыдущий равный период
    const period_revenue = periodRevenueMap[skuMs] ?? 0
    const prev_period_revenue = prevPeriodRevenueMap[skuMs] ?? 0
    const delta_revenue_pct = prev_period_revenue > 0
      ? (period_revenue - prev_period_revenue) / prev_period_revenue
      : null

    // Заказ менеджера из «Потребность Китай» (СВОД) — отдельно от расчёта
    const svod_order_qty = china?.order_qty ?? 0

    // Прогноз 30д = base_norm × seasonal_coef_next_30d
    const next30Months: number[] = []
    {
      const start = new Date(today)
      const end = new Date(today); end.setDate(end.getDate() + 30)
      const cur = new Date(start.getFullYear(), start.getMonth(), 1)
      while (cur <= end) { next30Months.push(cur.getMonth()); cur.setMonth(cur.getMonth() + 1) }
    }
    const next30Coeffs = next30Months.map(m => sku[MONTH_KEYS[m]]).filter((v): v is number => v != null && v > 0)
    const next30TargetRel = next30Coeffs.length > 0
      ? (next30Coeffs.reduce((a, b) => a + b, 0) / next30Coeffs.length) / (avg_year || 1)
      : 1
    const forecast_30d = Math.round(base_norm * next30TargetRel * 30)

    // GMROI
    const abc = abcMap[skuMs]
    const gmroi = (abc?.chmd_clean != null && abc?.tz != null && abc.tz > 0)
      ? Math.round((abc.chmd_clean / abc.tz) * 100) / 100
      : null

    // Статус
    let status: 'ok' | 'warning' | 'critical' | 'oos'
    if (total_stock === 0) status = 'oos'
    else if (days_stock < lt * 0.5) status = 'critical'
    else if (days_stock < lt) status = 'warning'
    else status = 'ok'

    const is_new = daily.length < 14

    return {
      sku_ms: skuMs,
      sku_wb: snap?.sku_wb ?? sku.sku_wb ?? 0,
      name: snap?.name ?? sku.name ?? '',
      brand: snap?.brand ?? sku.brand ?? '',
      subject_wb: snap?.subject_wb ?? sku.subject_wb ?? '',
      category: snap?.category ?? '',
      manager: snap?.manager ?? null,

      status: status === 'oos' ? 'critical' : status,

      // ШАГ 1
      sales_qty_7d:  Math.round(sales_qty_7d  * 10) / 10,
      sales_qty_14d: Math.round(sales_qty_14d * 10) / 10,
      sales_qty_31d: Math.round(sales_qty_31d * 10) / 10,
      base_31d:      Math.round(base_31d * 100) / 100,

      // ШАГ 2
      cur_coef:      Math.round(cur_coef * 100) / 100,
      avg_year_coef: Math.round(avg_year * 100) / 100,
      base_norm:     Math.round(base_norm * 100) / 100,
      used_yoy_fallback,
      yoy_base_norm: yoy_base_norm != null ? Math.round(yoy_base_norm * 100) / 100 : null,

      // ШАГ 3
      horizon_months: hm.map(m => ({
        month: MONTH_RU[m],
        coef: sku[MONTH_KEYS[m]] != null ? Math.round((sku[MONTH_KEYS[m]] as number) * 100) / 100 : null,
      })),
      target_coef:  Math.round(target_coef * 1000) / 1000,
      demand_qty:   Math.round(demand_qty),

      // ШАГ 4
      sigma_31d:    Math.round(sigma_31d * 100) / 100,
      cv:           Math.round(cv * 1000) / 1000,
      safety_days:  Math.round(safety_days * 10) / 10,
      safety_qty:   Math.round(safety_qty),

      // ШАГ 5
      on_hand_total,
      total_stock,
      fbo_wb: fbo, fbs_pushkino: fbsPush, fbs_smolensk: fbsSmol, kits_stock: kits,
      in_transit, in_production,

      // ШАГ 6
      calc_order,
      manager_order: svod_order_qty,                       // SVOD «Кол-во к заказу»
      delta_order: calc_order - svod_order_qty,            // Δ = расчёт − SVOD
      svod_order_qty,                                      // алиас для ясности UI

      // Выручка за выбранный период (для таблицы)
      period_revenue: Math.round(period_revenue),
      prev_period_revenue: Math.round(prev_period_revenue),
      delta_revenue_pct,

      // Контекст
      horizon_days: horizon,
      lead_time_days: lt,
      is_new,
      low_data,
      forecast_30d,

      // Производные (для UI)
      dpd: Math.round(dpd * 10) / 10,
      stock_days: days_stock,
      oos_days_31,

      // ABC
      abc_class:     abc?.abc_class ?? null,
      profitability: abc?.profitability ?? null,
      gmroi,

      // Финансы
      cost_plan:    china?.cost_plan ?? null,
      price:        snap?.price ?? null,
      margin_pct:   snap?.margin_pct ?? null,
      nearest_arrival: china?.nearest_date ?? null,
      supply_date:  snap?.supply_date ?? null,
      supply_qty:   snap?.supply_qty ?? null,
    }
  }

  const rows: OrderRow[] = []
  for (const skuMs of Object.keys(pass1)) {
    rows.push(buildRow(skuMs, pass1[skuMs]))
  }

  // Сортировка: сначала проблемные
  const statusOrder = { critical: 0, warning: 1, ok: 2 } as const
  rows.sort((a, b) => statusOrder[a.status] - statusOrder[b.status])

  // ── 12. Summary ─────────────────────────────────────────────────────────
  const criticalRows = rows.filter(r => r.status === 'critical')
  const warningRows  = rows.filter(r => r.status === 'warning')
  const toOrderRows  = rows.filter(r => r.calc_order > 0 || r.svod_order_qty > 0)
  const oosWithDemand = rows.filter(r => r.total_stock === 0 && r.sales_qty_31d > 0).length

  const total_stock_qty = rows.reduce((s, r) => s + r.total_stock, 0)
  const total_stock_rub = rows.reduce((s, r) => s + r.total_stock * (r.price ?? 0), 0)

  // Расчётный заказ
  const order_sum_rub_calc   = rows.reduce((s, r) => s + r.calc_order * (r.cost_plan ?? 0), 0)
  const order_qty_calc       = rows.reduce((s, r) => s + r.calc_order, 0)

  // Заказ из СВОД (Потребность Китай)
  const order_sum_rub_svod   = rows.reduce((s, r) => s + r.svod_order_qty * (r.cost_plan ?? 0), 0)
  const order_qty_svod       = rows.reduce((s, r) => s + r.svod_order_qty, 0)

  const velocity_avg = rows.length > 0 ? rows.reduce((s, r) => s + r.dpd, 0) / rows.length : 0
  const turnover_days_avg = velocity_avg > 0
    ? Math.round(total_stock_qty / (velocity_avg * rows.length))
    : 0
  const forecast_30d_total = rows.reduce((s, r) => s + r.forecast_30d, 0)
  const forecast_30d_rub_total = rows.reduce((s, r) => s + r.forecast_30d * (r.price ?? 0), 0)
  const period_revenue_total = rows.reduce((s, r) => s + r.period_revenue, 0)
  const prev_period_revenue_total = rows.reduce((s, r) => s + r.prev_period_revenue, 0)

  const summary = {
    critical_count: criticalRows.length,
    warning_count:  warningRows.length,
    oos_with_demand: oosWithDemand,
    to_order_count: toOrderRows.length,                       // SKU-счётчик (не qty)
    // Расчётный заказ (наша модель)
    order_sum_rub_calc: Math.round(order_sum_rub_calc),
    order_qty_calc,
    // Заказ из СВОД (менеджер)
    order_sum_rub_svod: Math.round(order_sum_rub_svod),
    order_qty_svod,
    // Совместимость со старым UI
    order_sum_rub: Math.round(order_sum_rub_calc),
    total_stock_qty,
    total_stock_rub: Math.round(total_stock_rub),
    velocity_avg: Math.round(velocity_avg * 10) / 10,
    turnover_days_avg,
    forecast_30d_total,
    forecast_30d_rub_total: Math.round(forecast_30d_rub_total),
    period_revenue_total: Math.round(period_revenue_total),
    prev_period_revenue_total: Math.round(prev_period_revenue_total),
  }

  // ── 13. Heatmap: топ-15 ниш (subject_wb) по выручке × 12 коэффициентов ─
  type NicheAgg = { revenue: number; coeffs: number[][]; sample_sku: string }
  const niches: Record<string, NicheAgg> = {}
  for (const r of rows) {
    const key = r.subject_wb || r.brand || '(прочее)'
    if (!niches[key]) niches[key] = { revenue: 0, coeffs: [], sample_sku: r.sku_ms }
    niches[key].revenue += r.period_revenue
    const sku = dimByMs[r.sku_ms]
    if (sku) {
      const monthVals = MONTH_KEYS.map(k => sku[k])
      if (monthVals.some(v => v != null && v > 0)) {
        niches[key].coeffs.push(monthVals.map(v => v ?? 0))
      }
    }
  }
  const heatmap_rows = Object.entries(niches)
    .sort((a, b) => b[1].revenue - a[1].revenue)
    .slice(0, 15)
    .map(([name, { coeffs, sample_sku }]) => {
      const avgCoeffs: Array<number | null> = []
      for (let i = 0; i < 12; i++) {
        const vals = coeffs.map(c => c[i]).filter(v => v > 0)
        avgCoeffs.push(vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null)
      }
      return {
        sku_ms: sample_sku,
        name: name.length > 40 ? name.slice(0, 39) + '…' : name,
        subject_wb: name,
        coeffs: avgCoeffs,
      }
    })

  return NextResponse.json({
    summary,
    rows,
    heatmap_rows,
    latest_date: maxDate,
    latest_snap: maxSnapDate,
    period,
    horizon,
    period_from: fromDaily,
    period_to:   toDaily,
  })
}
