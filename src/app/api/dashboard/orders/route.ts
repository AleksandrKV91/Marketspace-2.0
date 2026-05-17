import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/supabase/fetchAll'
import { rpcFetchAll } from '@/lib/supabase/rpcFetchAll'
import { cached, cacheGet, cacheSet } from '@/lib/cache'

export const maxDuration = 300

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

// Server-side кэш всего ответа. Ключ = параметры запроса (horizon|period|velocity_base).
// Это устраняет повторную работу для одних и тех же параметров — для тяжёлых горизонтов
// (>120 дней) первый запрос строит ответ ~5-15с, дальнейшие из кэша моментально.
// TTL 5 минут — успевает покрыть навигацию пользователя по таблице, но не устаревает
// дольше чем 1 апдейт sku-report (обычно раз в день).
const ORDERS_RESPONSE_TTL_MS = 5 * 60_000

interface CachedOrdersResponse {
  body: unknown
  built_at: number
}

export async function GET(req: Request) {
  const supabase = createServiceClient()
  const url = new URL(req.url)
  const horizon = Math.max(1, Math.min(365, parseInt(url.searchParams.get('horizon') ?? '60', 10) || 60))
  const period = parseInt(url.searchParams.get('period') ?? '31', 10)  // 7|14|31
  const velocityBase = parseInt(url.searchParams.get('velocity_base') ?? '90', 10) // 31|90
  // Month-фильтр убран по запросу пользователя — таблица всегда показывает выручку
  // за скользящие последние 31 день, дельта vs предыдущие 31 день.
  // Глобальные фильтры (category/manager/novelty) на этой вкладке НЕ применяются.

  // ── Server-cache: проверка ДО любых тяжёлых запросов ─────────────────────
  const cacheKey = `orders_response:h${horizon}:p${period}:v${velocityBase}`
  const hit = cacheGet<CachedOrdersResponse>(cacheKey, ORDERS_RESPONSE_TTL_MS)
  if (hit) {
    const age = Math.floor((Date.now() - hit.built_at) / 1000)
    return new NextResponse(JSON.stringify(hit.body), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'x-cache': 'HIT',
        'x-cache-age-sec': String(age),
        // Vercel/CDN тоже кэширует на 5 минут (s-maxage), stale-while-revalidate на минуту
        'cache-control': `public, s-maxage=${Math.max(1, 300 - age)}, stale-while-revalidate=60`,
      },
    })
  }

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

  // ── Период для расчёта заказа: ВСЕГДА последние 30 дней ────────────────
  // Расчёт заказа всегда актуальный на сегодня — не зависит от month-фильтра.
  let fromDaily: string | null = null
  let toDaily:   string | null = null
  if (maxDate) {
    toDaily = maxDate
    fromDaily = addDaysISO(maxDate, -29)
  }

  // Период для «Выручки» в таблице = последние 31 день (= fromDaily/toDaily).
  const revenueFrom: string | null = fromDaily
  const revenueTo:   string | null = toDaily

  // Предыдущий равный 31-дневный период для дельты выручки.
  let prevFrom: string | null = null
  let prevTo:   string | null = null
  if (revenueFrom && revenueTo) {
    prevTo   = addDaysISO(revenueFrom, -1)
    prevFrom = addDaysISO(prevTo, -29)
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
  type DailyAggRpc = {
    sku_ms: string
    sales_qty_7d: number; sales_qty_14d: number; sales_qty_31d: number; sales_qty_90d: number
    sigma_31d: number
    oos_days_31: number; non_zero_days_31: number; data_days_total: number
    period_revenue: number; prev_period_revenue: number
  }
  type AbcRow    = { sku_ms: string; sku_wb: number | null; final_class_1: string | null; final_class_2: string | null; profitability: number | null; chmd_clean: number | null; tz: number | null }
  type ChinaDbRow = { sku_ms: string; in_transit: number | null; in_production: number | null; nearest_date: string | null; cost_plan: number | null; lead_time_days: number | null; order_qty: number | null }

  // ── Вычисляем границы окон для RPC ─────────────────────────────────────
  // RPC orders_daily_agg сам считает 7д/14д/31д/90д от p_max_date,
  // плюс period_revenue и prev_period_revenue для соответствующих диапазонов.
  // p_max_date — для velocity/sigma/oos (всегда актуально, последние 30д)
  // p_period_* / p_prev_* — скользящие 31д и предыдущие 31д (без month-фильтра)
  const rpcMaxDate     = maxDate ?? '1970-01-01'
  const rpcPeriodFrom  = revenueFrom ?? '1970-01-01'
  const rpcPeriodTo    = revenueTo   ?? '1970-01-01'
  const rpcPrevFrom    = prevFrom    ?? '1970-01-01'
  const rpcPrevTo      = prevTo      ?? '1970-01-01'

  const [periodRows, dailyAggResult, chinaDbRows, abcRows] = await Promise.all([
    maxSnapDate
      ? fetchAll<PeriodRow>(
          (sb) => sb.from('fact_sku_period')
            .select('sku_ms, sku_wb, period_end, product_name, brand, subject_wb, category, fbo_wb, fbs_pushkino, fbs_smolensk, kits_qty, stock_days, price, period_marginality_wgt, plan_supply_date, plan_supply_qty, days_until_arrival, manager, novelty_status')
            .eq('period_end', maxSnapDate)
            .order('sku_ms'),
          supabase,
        )
      : Promise.resolve([] as PeriodRow[]),
    maxDate
      ? rpcFetchAll<DailyAggRpc>(() => supabase.rpc('orders_daily_agg', {
          p_max_date:    rpcMaxDate,
          p_period_from: rpcPeriodFrom,
          p_period_to:   rpcPeriodTo,
          p_prev_from:   rpcPrevFrom,
          p_prev_to:     rpcPrevTo,
        }))
      : Promise.resolve({ data: [] as DailyAggRpc[], error: null }),
    chinaId
      ? supabase.from('fact_china_supply')
          .select('sku_ms, in_transit, in_production, nearest_date, cost_plan, lead_time_days, order_qty')
          .eq('upload_id', chinaId)
      : Promise.resolve({ data: null as ChinaDbRow[] | null, error: null }),
    abcId
      ? fetchAll<AbcRow>(
          (sb) => sb.from('fact_abc')
            .select('sku_ms, sku_wb, final_class_1, final_class_2, profitability, chmd_clean, tz')
            .eq('upload_id', abcId),
          supabase,
        )
      : Promise.resolve([] as AbcRow[]),
  ])

  // Если функция orders_daily_agg ещё не применена в Supabase — подсказываем что делать
  if (dailyAggResult?.error) {
    const msg = dailyAggResult.error.message ?? String(dailyAggResult.error)
    if (msg.toLowerCase().includes('orders_daily_agg') || msg.toLowerCase().includes('function')) {
      return NextResponse.json({
        error: 'Миграция 016_orders_daily_agg не применена. Запустите supabase/016_orders_daily_agg.sql в Supabase Studio → SQL editor.',
        details: msg,
      }, { status: 503 })
    }
    return NextResponse.json({ error: `daily_agg: ${msg}` }, { status: 500 })
  }
  const dailyAggRows: DailyAggRpc[] = dailyAggResult?.data ?? []
  const dailyAggMap: Record<string, DailyAggRpc> = {}
  // normMs объявляется ниже — здесь используем inline trim, чтобы не сломать порядок объявлений
  const norm = (s: string | null | undefined) => (s == null ? '' : String(s).trim())
  for (const r of dailyAggRows) {
    const key = norm(r.sku_ms)
    if (key) dailyAggMap[key] = r
  }

  const periodRevenueMap: Record<string, number> = {}
  const prevPeriodRevenueMap: Record<string, number> = {}
  for (const r of dailyAggRows) {
    const key = norm(r.sku_ms)
    if (!key) continue
    periodRevenueMap[key]     = Number(r.period_revenue ?? 0)
    prevPeriodRevenueMap[key] = Number(r.prev_period_revenue ?? 0)
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
    const key = norm(r.sku_ms)
    if (!key) continue
    if (!snapMap[key]) snapMap[key] = {
      sku_ms: key, sku_wb: r.sku_wb, snap_date: r.period_end,
      name: r.product_name, brand: r.brand, subject_wb: r.subject_wb, category: r.category,
      fbo_wb: r.fbo_wb, fbs_pushkino: r.fbs_pushkino, fbs_smolensk: r.fbs_smolensk,
      kits_stock: r.kits_qty, stock_days: r.stock_days, price: r.price,
      margin_pct: r.period_marginality_wgt, supply_date: r.plan_supply_date,
      supply_qty: r.plan_supply_qty, days_to_arrival: r.days_until_arrival,
      manager: r.manager, novelty_status: r.novelty_status,
    }
  }

  // Нормализация sku_ms: trim + строка. Защищает от случайных пробелов/переносов
  // в файлах Excel — частая причина «не матчится» между fact_abc / fact_china_supply
  // и fact_sku_period.
  function normMs(s: string | number | null | undefined): string {
    if (s == null) return ''
    return String(s).trim()
  }

  type ChinaRec = { in_transit: number; in_production: number; nearest_date: string | null; cost_plan: number | null; lead_time_days: number | null; order_qty: number | null }
  const chinaMap: Record<string, ChinaRec> = {}
  if (chinaDbRows.data) {
    for (const r of chinaDbRows.data) {
      const key = normMs(r.sku_ms)
      if (!key) continue
      chinaMap[key] = {
        in_transit: r.in_transit ?? 0, in_production: r.in_production ?? 0,
        nearest_date: r.nearest_date, cost_plan: r.cost_plan, lead_time_days: r.lead_time_days,
        order_qty: r.order_qty,
      }
    }
  }

  type AbcRec = { abc_class: string | null; abc_class_2: string | null; profitability: number | null; chmd_clean: number | null; tz: number | null }
  const abcMap: Record<string, AbcRec> = {}
  // Прямой индекс по sku_wb из fact_abc (заполняется парсером ABC v7+).
  // Это основной fallback, когда sku_ms в fact_abc не совпадает с fact_sku_period.sku_ms
  // (мусорные/legacy значения в fact_abc.sku_ms — частая причина потери ABC у ~10% SKU).
  const abcByWbDirect: Record<number, AbcRec> = {}
  for (const r of abcRows) {
    const rec: AbcRec = {
      abc_class:   r.final_class_1,
      abc_class_2: r.final_class_2,
      profitability: r.profitability,
      chmd_clean:  r.chmd_clean,
      tz:          r.tz,
    }
    const key = normMs(r.sku_ms)
    if (key && !abcMap[key]) abcMap[key] = rec
    if (r.sku_wb != null && !abcByWbDirect[r.sku_wb]) abcByWbDirect[r.sku_wb] = rec
  }

  // ── dim_sku map (только для коэффициентов сезонности month_*) ────────
  const dimByMs: Record<string, DimRow> = {}
  // Backup-индекс через WB-артикул (Свод): sku_wb → sku_ms.
  // Используется когда прямой матчинг по sku_ms не нашёл — например, fact_abc
  // загружена с одним форматом sku_ms, а fact_sku_period с другим.
  const msByWb: Record<number, string> = {}
  for (const r of dimRows) {
    const key = normMs(r.sku_ms)
    dimByMs[key] = r
    if (r.sku_wb != null) msByWb[r.sku_wb] = key
  }
  // Также построим обратный индекс abc/china по sku_wb (через dim_sku):
  const abcByWb: Record<number, AbcRec> = {}
  for (const skuMs of Object.keys(abcMap)) {
    const dim = dimByMs[skuMs]
    if (dim?.sku_wb != null) abcByWb[dim.sku_wb] = abcMap[skuMs]
  }
  const chinaByWb: Record<number, ChinaRec> = {}
  for (const skuMs of Object.keys(chinaMap)) {
    const dim = dimByMs[skuMs]
    if (dim?.sku_wb != null) chinaByWb[dim.sku_wb] = chinaMap[skuMs]
  }

  // ── Универсум SKU: snap ∪ daily (та же логика что в analytics и sku-table).
  // Раньше брали только Object.keys(snapMap) — это ~2993 SKU из последнего weekly-снапа.
  // SKU с продажами в fact_sku_daily, но без записи в последнем fact_sku_period,
  // выпадали — и их выручка не попадала в таблицу/итоги.
  // Теперь добавляем все SKU из dailyAggMap (= те у кого есть активность в последние 90 дней).
  const universeSet = new Set<string>([
    ...Object.keys(snapMap),
    ...Object.keys(dailyAggMap),
  ])
  const universe: string[] = [...universeSet]

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
    agg: DailyAggRpc | null
    sales_qty_7d: number; sales_qty_14d: number; sales_qty_31d: number; sales_qty_90d: number
    base_31d: number; base_90d: number
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
    const agg = dailyAggMap[skuMs] ?? null
    const sales_qty_7d  = Number(agg?.sales_qty_7d  ?? 0)
    const sales_qty_14d = Number(agg?.sales_qty_14d ?? 0)
    const sales_qty_31d = Number(agg?.sales_qty_31d ?? 0)
    const sales_qty_90d = Number(agg?.sales_qty_90d ?? 0)
    const base_31d = sales_qty_31d / 31
    const base_90d = sales_qty_90d / 90

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
      sku, agg,
      sales_qty_7d, sales_qty_14d, sales_qty_31d, sales_qty_90d,
      base_31d, base_90d, avg_year, cur_coef, target_coef,
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
    const { sku, agg, sales_qty_7d, sales_qty_14d, sales_qty_31d, sales_qty_90d,
            base_31d, base_90d, avg_year, cur_coef, target_coef, horizon_months: hm, lt } = p1

    // ШАГ 2: base_norm — берём 31д или 90д в зависимости от velocityBase
    const base_active = velocityBase === 90 ? base_90d : base_31d
    let base_norm = base_active / (cur_coef || 1)
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

    // ШАГ 4: страховой запас (sigma уже посчитан в Postgres)
    const sigma_31d = Number(agg?.sigma_31d ?? 0)
    let cv = base_31d > 0.1 ? sigma_31d / base_31d : 1.0
    if (sigma_31d === 0) cv = Math.max(cv, 0.3)
    const non_zero_days = Number(agg?.non_zero_days_31 ?? 0)
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
    // FALLBACK: если china не нашёлся по sku_ms — пробуем через sku_wb (Свод)
    const china = chinaMap[skuMs] ?? (snap?.sku_wb != null ? chinaByWb[snap.sku_wb] : null)
    const in_transit = china?.in_transit ?? 0
    const in_production = china?.in_production ?? 0
    const on_hand_total = total_stock + in_transit + in_production

    // ШАГ 6: к заказу
    const calc_order = Math.max(0, Math.round(demand_qty + safety_qty - on_hand_total))

    // Производные
    const dpd = base_31d
    const days_stock = dpd > 0 ? Math.round(total_stock / dpd) : (total_stock > 0 ? 999 : 0)
    const oos_days_31 = Number(agg?.oos_days_31 ?? 0)

    // Выручка за выбранный период + дельта vs предыдущий равный период
    const period_revenue = periodRevenueMap[skuMs] ?? 0
    const prev_period_revenue = prevPeriodRevenueMap[skuMs] ?? 0
    const delta_revenue_pct = prev_period_revenue > 0
      ? (period_revenue - prev_period_revenue) / prev_period_revenue
      : null

    // Заказ менеджера из «Потребность Китай» (СВОД) — отдельно от расчёта
    const svod_order_qty = china?.order_qty ?? 0

    // Прогноз 31д = base_norm × seasonal_coef_next_31d × 31.
    // 31 дн — чтобы соответствовать колонке «Прод. 31д» (одинаковые окна = честное сравнение).
    const next31Months: number[] = []
    {
      const start = new Date(today)
      const end = new Date(today); end.setDate(end.getDate() + 31)
      const cur = new Date(start.getFullYear(), start.getMonth(), 1)
      while (cur <= end) { next31Months.push(cur.getMonth()); cur.setMonth(cur.getMonth() + 1) }
    }
    const next31Coeffs = next31Months.map(m => sku[MONTH_KEYS[m]]).filter((v): v is number => v != null && v > 0)
    const next31TargetRel = next31Coeffs.length > 0
      ? (next31Coeffs.reduce((a, b) => a + b, 0) / next31Coeffs.length) / (avg_year || 1)
      : 1
    const forecast_30d = Math.round(base_norm * next31TargetRel * 31)

    // ABC: 1) direct по sku_ms → 2) прямой fallback по sku_wb из fact_abc →
    // 3) старый fallback через dim_sku (sku_ms ABC → dim_sku → sku_wb → snap.sku_wb)
    const abc = abcMap[skuMs]
      ?? (snap?.sku_wb != null ? abcByWbDirect[snap.sku_wb] : null)
      ?? (snap?.sku_wb != null ? abcByWb[snap.sku_wb] : null)
    const gmroi = (abc?.chmd_clean != null && abc?.tz != null && abc.tz > 0)
      ? Math.round((abc.chmd_clean / abc.tz) * 100) / 100
      : null

    // Статус
    let status: 'ok' | 'warning' | 'critical' | 'oos'
    if (total_stock === 0) status = 'oos'
    else if (days_stock < lt * 0.5) status = 'critical'
    else if (days_stock < lt) status = 'warning'
    else status = 'ok'

    const is_new = Number(agg?.data_days_total ?? 0) < 14

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
      sales_qty_90d: Math.round(sales_qty_90d * 10) / 10,
      base_31d:      Math.round(base_31d * 100) / 100,
      base_90d:      Math.round(base_90d * 100) / 100,

      // ШАГ 2
      cur_coef:      Math.round(cur_coef * 100) / 100,
      avg_year_coef: Math.round(avg_year * 100) / 100,
      base_norm:     Math.round(base_norm * 100) / 100,
      base_active:   Math.round(base_active * 100) / 100,   // используемая velocity (31д или 90д)
      velocity_base_used: velocityBase,                      // 31 или 90 — для лейбла в UI
      used_yoy_fallback,
      yoy_base_norm: yoy_base_norm != null ? Math.round(yoy_base_norm * 100) / 100 : null,
      // Полный годовой профиль сезонности (12 значений или null) — для миниграфика в карточке
      month_coeffs: MONTH_KEYS.map(k => {
        const v = sku[k]
        return v != null ? Math.round(v * 100) / 100 : null
      }),
      // Прогноз продаж шт на 6 ближайших месяцев (m..m+5) с учётом сезонности и days_in_month
      forecast_by_month: Array.from({ length: 6 }, (_, i) => {
        const dt = new Date(today.getFullYear(), today.getMonth() + i, 1)
        const m = dt.getMonth()
        const y = dt.getFullYear()
        const days = new Date(y, m + 1, 0).getDate()
        const coef = sku[MONTH_KEYS[m]] ?? null
        const adj = (coef != null && coef > 0 && avg_year > 0) ? (coef / avg_year) : 1
        return {
          month: m,
          year:  y,
          qty:   Math.round(base_norm * adj * days),
        }
      }),

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
      abc_class_2:   abc?.abc_class_2 ?? null,
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

  // ── Корректные KPI ────────────────────────────────────────────────────
  // velocity_avg: средняя по SKU С ПРОДАЖАМИ (исключаем нулевые dpd —
  // они занижали среднее в разы и вводили в заблуждение)
  const activeRows = rows.filter(r => r.dpd > 0)
  const velocity_avg = activeRows.length > 0
    ? activeRows.reduce((s, r) => s + r.dpd, 0) / activeRows.length
    : 0
  // turnover_days_avg: суммарный остаток / суммарная скорость продаж (в днях)
  const total_velocity = rows.reduce((s, r) => s + r.dpd, 0)
  const turnover_days_avg = total_velocity > 0
    ? Math.round(total_stock_qty / total_velocity)
    : 0
  const forecast_30d_total = rows.reduce((s, r) => s + r.forecast_30d, 0)
  // Прогноз 30д в рублях = Σ(forecast_30d × price) по всем SKU
  const forecast_30d_rub_total = rows.reduce((s, r) => s + r.forecast_30d * (r.price ?? 0), 0)
  // ВАЖНО: period_revenue суммируем по ВСЕМ SKU из RPC orders_daily_agg, а не только по universe
  // (= last fact_sku_period). Раньше rows[].period_revenue терял выручку SKU, которых нет в
  // последнем weekly-снапе, и итог был занижен (например 288М вместо 1Б).
  const period_revenue_total      = Object.values(periodRevenueMap).reduce((s, v) => s + v, 0)
  const prev_period_revenue_total = Object.values(prevPeriodRevenueMap).reduce((s, v) => s + v, 0)

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
  // Все ниши, без отсечения. SeasonalityHeatmap имеет вертикальный скролл.
  const heatmap_rows = Object.entries(niches)
    .sort((a, b) => b[1].revenue - a[1].revenue)
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

  // Диагностика — видна в DevTools → Network → этот response.
  // Помогает понять "почему выручка такая": сколько SKU вернул RPC, сколько в universe,
  // какое окно даты, сумма по RPC до фильтрации rows.
  const skusWithRevenue = Object.values(periodRevenueMap).filter(v => v > 0).length
  const _diag = {
    max_date_in_daily: maxDate,
    period_from:       fromDaily,
    period_to:         toDaily,
    prev_from:         prevFrom,
    prev_to:           prevTo,
    rpc_orders_daily_agg_rows: dailyAggRows.length,         // должно быть = SKU c активностью в окнах
    snap_skus:        Object.keys(snapMap).length,
    universe_total:   universe.length,
    period_revenue_from_rpc:      Math.round(period_revenue_total),     // Σ из periodRevenueMap (все SKU из RPC)
    prev_revenue_from_rpc:        Math.round(prev_period_revenue_total),
    skus_with_revenue_in_window:  skusWithRevenue,
  }

  const body = {
    summary,
    rows,
    heatmap_rows,
    latest_date: maxDate,
    latest_snap: maxSnapDate,
    period,
    horizon,
    period_from: fromDaily,
    period_to:   toDaily,
    _diag,
  }

  // Сохраняем построенный ответ в server-cache — следующий тот же запрос отдаст моментально.
  cacheSet<CachedOrdersResponse>(cacheKey, { body, built_at: Date.now() })

  return new NextResponse(JSON.stringify(body), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'x-cache': 'MISS',
      // Vercel Edge CDN кэширует на 5 мин + 1 мин SWR. При том же URL клиенту приходит
      // ответ с CDN, минуя нашу функцию вообще.
      'cache-control': 'public, s-maxage=300, stale-while-revalidate=60',
    },
  })
}
