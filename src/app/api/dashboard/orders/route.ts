import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/supabase/fetchAll'

export const maxDuration = 30

export async function GET(req: Request) {
  const supabase = createServiceClient()
  const url = new URL(req.url)
  const horizon = parseInt(url.searchParams.get('horizon') ?? '60', 10)

  // Последние uploads по типам
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

  const chinaId = latestByType['china']
  const abcId = latestByType['abc']

  // dim_sku — все SKU с сезонностью
  type DimRow = {
    sku_ms: string; sku_wb: number | null; name: string | null; brand: string | null
    subject_wb: string | null
    month_jan: number | null; month_feb: number | null; month_mar: number | null
    month_apr: number | null; month_may: number | null; month_jun: number | null
    month_jul: number | null; month_aug: number | null; month_sep: number | null
    month_oct: number | null; month_nov: number | null; month_dec: number | null
  }
  const dimRows = await fetchAll<DimRow>(
    (sb) => sb.from('dim_sku').select('sku_ms, sku_wb, name, brand, subject_wb, month_jan, month_feb, month_mar, month_apr, month_may, month_jun, month_jul, month_aug, month_sep, month_oct, month_nov, month_dec'),
    supabase,
  )
  const dimMap: Record<string, DimRow> = {}
  for (const r of dimRows) dimMap[r.sku_ms] = r

  // fact_sku_daily — последний снапшот (самая свежая snap_date для каждого SKU)
  // и продажи за последние 31 день (revenue как показатель активности)
  const { data: maxSnapRow } = await supabase
    .from('fact_sku_daily')
    .select('snap_date')
    .not('snap_date', 'is', null)
    .order('snap_date', { ascending: false })
    .limit(1)
  const maxSnapDate = maxSnapRow?.[0]?.snap_date

  // Снапшот: берём строки с самой свежей snap_date (одна строка на SKU достаточна)
  type SnapRow = {
    sku_ms: string; sku_wb: number | null; snap_date: string | null
    fbo_wb: number | null; fbs_pushkino: number | null; fbs_smolensk: number | null
    kits_stock: number | null; stock_days: number | null; price: number | null
    margin_pct: number | null; supply_date: string | null; supply_qty: number | null
    days_to_arrival: number | null; manager: string | null
  }
  const snapMap: Record<string, SnapRow> = {}
  if (maxSnapDate) {
    const snapRows = await fetchAll<SnapRow>(
      (sb) => sb.from('fact_sku_daily')
        .select('sku_ms, sku_wb, snap_date, fbo_wb, fbs_pushkino, fbs_smolensk, kits_stock, stock_days, price, margin_pct, supply_date, supply_qty, days_to_arrival, manager')
        .eq('snap_date', maxSnapDate)
        .not('fbo_wb', 'is', null),
      supabase,
    )
    // Один снапшот на SKU (берём первый)
    for (const r of snapRows) {
      if (!snapMap[r.sku_ms]) snapMap[r.sku_ms] = r
    }
  }

  // fact_sku_daily — продажи за последние 31 день
  // Используем revenue как прокси продаж (есть для всех SKU из отчёта)
  const { data: maxMetricRow } = await supabase
    .from('fact_sku_daily')
    .select('metric_date')
    .order('metric_date', { ascending: false })
    .limit(1)
  const maxDate = maxMetricRow?.[0]?.metric_date

  const salesMap31: Record<string, { revenue: number; ad_spend: number; days: number }> = {}
  const salesMap7: Record<string, number> = {}
  const salesMap14: Record<string, number> = {}

  if (maxDate) {
    const date31 = new Date(maxDate)
    date31.setDate(date31.getDate() - 30)
    const from31 = date31.toISOString().split('T')[0]

    const { data: salesRows } = await supabase
      .from('fact_sku_daily')
      .select('sku_ms, metric_date, revenue, ad_spend')
      .gte('metric_date', from31)
      .lte('metric_date', maxDate)

    if (salesRows) {
      for (const r of salesRows) {
        const ms = r.sku_ms
        if (!salesMap31[ms]) salesMap31[ms] = { revenue: 0, ad_spend: 0, days: 0 }
        salesMap31[ms].revenue += r.revenue ?? 0
        salesMap31[ms].ad_spend += r.ad_spend ?? 0
        if ((r.revenue ?? 0) > 0) salesMap31[ms].days++

        const daysDiff = Math.ceil((new Date(maxDate).getTime() - new Date(r.metric_date).getTime()) / 86400000)
        if (daysDiff <= 7) salesMap7[ms] = (salesMap7[ms] ?? 0) + (r.revenue ?? 0)
        if (daysDiff <= 14) salesMap14[ms] = (salesMap14[ms] ?? 0) + (r.revenue ?? 0)
      }
    }
  }

  // fact_china_supply
  const chinaMap: Record<string, { in_transit: number; in_production: number; nearest_date: string | null; cost_plan: number | null; lead_time_days: number | null }> = {}
  if (chinaId) {
    const { data: chinaRows } = await supabase
      .from('fact_china_supply')
      .select('sku_ms, in_transit, in_production, nearest_date, cost_plan, lead_time_days')
      .eq('upload_id', chinaId)
    if (chinaRows) {
      for (const r of chinaRows) chinaMap[r.sku_ms] = r
    }
  }

  // fact_abc
  const abcMap: Record<string, { abc_class: string | null; profitability: number | null; chmd_clean: number | null; tz: number | null }> = {}
  if (abcId) {
    const { data: abcRows } = await supabase
      .from('fact_abc')
      .select('sku_ms, abc_class, profitability, chmd_clean, tz')
      .eq('upload_id', abcId)
    if (abcRows) {
      for (const r of abcRows) abcMap[r.sku_ms] = r
    }
  }

  // Текущий месяц для сезонной коррекции
  const nowMonth = new Date().getMonth() // 0-based
  const monthKeys = ['month_jan','month_feb','month_mar','month_apr','month_may','month_jun',
                     'month_jul','month_aug','month_sep','month_oct','month_nov','month_dec'] as const

  // Сборка строк
  const rows = dimRows.map(sku => {
    const snap = snapMap[sku.sku_ms]
    const sales31 = salesMap31[sku.sku_ms]
    const china = chinaMap[sku.sku_ms]
    const abc = abcMap[sku.sku_ms]

    const fbo = snap?.fbo_wb ?? 0
    const fbsPush = snap?.fbs_pushkino ?? 0
    const fbsSmol = snap?.fbs_smolensk ?? 0
    const kits = snap?.kits_stock ?? 0
    const totalStock = fbo + fbsPush + fbsSmol + kits

    const inTransit = china?.in_transit ?? 0
    const inProduction = china?.in_production ?? 0
    const alreadyHave = totalStock + inTransit + inProduction

    // Скорость продаж (выручка/день → конвертируем в шт через цену)
    const price = snap?.price ?? 1
    const revenue31 = sales31?.revenue ?? 0
    const daysActive = Math.max(sales31?.days ?? 1, 1)
    const revenuePerDay = revenue31 / 31
    const dpd = price > 0 ? revenuePerDay / price : 0

    // Сезонная коррекция
    const monthCoeffs = monthKeys.map(k => sku[k] ?? null).filter((v): v is number => v !== null && v > 0)
    const avgYearCoeff = monthCoeffs.length > 0 ? monthCoeffs.reduce((a, b) => a + b, 0) / monthCoeffs.length : 1
    const curCoeff = (sku[monthKeys[nowMonth]] ?? avgYearCoeff) || avgYearCoeff

    // Коэфф для горизонта (следующие ceil(horizon/30) месяцев)
    const horizonMonths = Math.ceil(horizon / 30)
    let targetCoeffSum = 0
    let targetCoeffCount = 0
    for (let i = 0; i < horizonMonths; i++) {
      const mIdx = (nowMonth + 1 + i) % 12
      const c = sku[monthKeys[mIdx]] ?? avgYearCoeff
      if (c > 0) { targetCoeffSum += c; targetCoeffCount++ }
    }
    const targetCoeff = targetCoeffCount > 0 ? targetCoeffSum / targetCoeffCount : avgYearCoeff

    // Нормированная база продаж (без влияния сезонности текущего месяца)
    const baseNorm = dpd * 30 / (curCoeff || 1)
    // Потребность с сезонной коррекцией
    const demandSeasonal = baseNorm * (targetCoeff / (avgYearCoeff || 1)) * horizon

    // Расчёт заказа
    const calcOrder = Math.max(0, Math.round(demandSeasonal - alreadyHave))

    // Дней запаса
    const daysStock = dpd > 0 ? totalStock / dpd : (totalStock > 0 ? 999 : 0)
    const logPleche = china?.lead_time_days ?? horizon

    // GMROI
    const gmroi = (abc?.chmd_clean != null && abc?.tz != null && abc.tz > 0)
      ? Math.round((abc.chmd_clean / abc.tz) * 100) / 100
      : null

    // Статус
    let status: 'ok' | 'warning' | 'critical' | 'oos'
    if (totalStock === 0) status = 'oos'
    else if (daysStock < logPleche * 0.5) status = 'critical'
    else if (daysStock < logPleche) status = 'warning'
    else status = 'ok'

    return {
      sku_ms: sku.sku_ms,
      sku_wb: snap?.sku_wb ?? sku.sku_wb ?? 0,
      name: sku.name,
      brand: sku.brand,
      subject_wb: sku.subject_wb,
      total_stock: totalStock,
      fbo_wb: fbo,
      fbs_pushkino: fbsPush,
      fbs_smolensk: fbsSmol,
      kits_stock: kits,
      in_transit: inTransit,
      in_production: inProduction,
      already_have: alreadyHave,
      revenue_7d: salesMap7[sku.sku_ms] ?? 0,
      revenue_14d: salesMap14[sku.sku_ms] ?? 0,
      revenue_31d: revenue31,
      dpd: Math.round(dpd * 10) / 10,
      days_stock: Math.round(daysStock),
      log_pleche: logPleche,
      calc_order: calcOrder,
      cost_plan: china?.cost_plan ?? null,
      abc_class: abc?.abc_class ?? null,
      profitability: abc?.profitability ?? null,
      gmroi,
      nearest_arrival: china?.nearest_date ?? null,
      supply_date: snap?.supply_date ?? null,
      supply_qty: snap?.supply_qty ?? null,
      days_to_arrival: snap?.days_to_arrival ?? null,
      price: snap?.price ?? null,
      margin_pct: snap?.margin_pct ?? null,
      manager: snap?.manager ?? null,
      status,
    }
  })

  const statusOrder = { oos: 0, critical: 1, warning: 2, ok: 3 }
  rows.sort((a, b) => statusOrder[a.status] - statusOrder[b.status])

  const criticalRows = rows.filter(r => r.status === 'critical' || r.status === 'oos')
  const warningRows = rows.filter(r => r.status === 'warning')
  const toOrderRows = rows.filter(r => r.calc_order > 0)
  const avgDaysToOos = rows.reduce((s, r) => s + r.days_stock, 0) / Math.max(rows.length, 1)

  const summary = {
    critical_count: criticalRows.length,
    warning_count: warningRows.length,
    oos_with_demand: rows.filter(r => r.status === 'oos' && r.revenue_31d > 0).length,
    to_order_count: toOrderRows.reduce((s, r) => s + r.calc_order, 0),
    to_order_sum_rub: toOrderRows.reduce((s, r) => s + r.calc_order * (r.cost_plan ?? 0), 0),
    avg_days_to_oos: Math.round(avgDaysToOos),
    total_stock_rub: rows.reduce((s, r) => s + r.total_stock * (r.price ?? 0), 0),
  }

  const mappedRows = rows.map(r => ({
    sku_ms: r.sku_ms,
    sku_wb: String(r.sku_wb),
    name: r.name ?? '',
    brand: r.brand ?? '',
    subject_wb: r.subject_wb ?? '',
    status: r.status === 'oos' ? 'critical' : r.status,
    abc: r.abc_class ?? '—',
    revenue_31d: r.revenue_31d,
    revenue_7d: r.revenue_7d,
    revenue_14d: r.revenue_14d,
    dpd: r.dpd,
    stock_qty: r.total_stock,
    fbo_wb: r.fbo_wb,
    fbs_pushkino: r.fbs_pushkino,
    fbs_smolensk: r.fbs_smolensk,
    kits_stock: r.kits_stock,
    in_transit: r.in_transit,
    in_production: r.in_production,
    already_have: r.already_have,
    stock_days: r.days_stock,
    lead_time: r.log_pleche,
    calc_order: r.calc_order,
    cost_plan: r.cost_plan,
    manager_order: 0,
    margin_pct: r.margin_pct,
    gmroi: r.gmroi,
    nearest_arrival: r.nearest_arrival,
    supply_date: r.supply_date,
    supply_qty: r.supply_qty,
    days_to_arrival: r.days_to_arrival,
    price: r.price,
    manager: r.manager,
  }))

  return NextResponse.json({ summary, rows: mappedRows, latest_date: maxDate, latest_snap: maxSnapDate })
}
