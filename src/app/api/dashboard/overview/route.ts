import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/supabase/fetchAll'
import { computeScore } from '@/lib/scoring'

export const maxDuration = 60

// Логистическое плечо по умолчанию (дней) по стране производства
const LEAD_TIME_BY_COUNTRY: Record<string, number> = {
  // Азия (100 дней)
  'китай': 100, 'china': 100,
  'пакистан': 100, 'pakistan': 100,
  'тайланд': 100, 'таиланд': 100, 'thailand': 100,
  // Европа (75 дней)
  'италия': 75, 'italy': 75,
  'польша': 75, 'poland': 75,
  'франция': 75, 'france': 75,
  'испания': 75, 'spain': 75,
  'швейцария': 75, 'switzerland': 75,
  'турция': 75, 'turkey': 75,
  'германия': 75, 'germany': 75,
  'корея': 75, 'korea': 75,
  'венгрия': 75, 'hungary': 75,
  'сербия': 75, 'serbia': 75,
  'литва': 75, 'lithuania': 75,
  'великобритания': 75, 'uk': 75, 'england': 75,
  // Ближнее зарубежье (10 дней)
  'россия': 10, 'russia': 10,
  'беларусь': 10, 'belarus': 10,
}
const DEFAULT_LEAD_TIME = 45

function getLeadTime(country: string | null | undefined, chinaLeadTime: number | null | undefined): number {
  if (chinaLeadTime && chinaLeadTime > 0) return chinaLeadTime
  if (!country) return DEFAULT_LEAD_TIME
  const key = country.toLowerCase().trim()
  return LEAD_TIME_BY_COUNTRY[key] ?? DEFAULT_LEAD_TIME
}

export async function GET(req: Request) {
  const supabase = createServiceClient()
  const url = new URL(req.url)
  const fromParam = url.searchParams.get('from')
  const toParam = url.searchParams.get('to')

  // ── 1. Latest upload IDs ──────────────────────────────────────────────────
  const { data: lastUploads } = await supabase
    .from('uploads').select('id, file_type')
    .eq('status', 'ok').order('uploaded_at', { ascending: false }).limit(20)

  const latestByType: Record<string, string> = {}
  if (lastUploads) for (const u of lastUploads) {
    if (!latestByType[u.file_type]) latestByType[u.file_type] = u.id
  }

  const stockId    = latestByType['stock']
  const abcId      = latestByType['abc']
  const skuRepId   = latestByType['sku_report']
  const chinaId    = latestByType['china']

  // ── 2. dim_sku — справочник (страна для lead_time, категория) ─────────────
  const dimRows = await fetchAll<{
    sku_ms: string; sku_wb: number | null; name: string | null
    category_wb: string | null; subject_wb: string | null; country: string | null
  }>(
    (sb) => sb.from('dim_sku').select('sku_ms, sku_wb, name, category_wb, subject_wb, country'),
    supabase,
  )
  const dimByMs: Record<string, typeof dimRows[0]> = {}
  const dimByWb: Record<number, string> = {}
  for (const r of dimRows) {
    dimByMs[r.sku_ms] = r
    if (r.sku_wb) dimByWb[r.sku_wb] = r.sku_ms
  }

  // ── 3. fact_sku_snapshot — маржа, ЧМД, менеджер (из последней загрузки) ──
  type SnapRow = {
    sku_ms: string; margin_rub: number | null; chmd_5d: number | null
    manager: string | null; price: number | null; stock_days: number | null
    novelty_status: string | null; fbo_wb: number | null
    fbs_pushkino: number | null; fbs_smolensk: number | null; snap_date: string | null
  }
  const snapByMs: Record<string, SnapRow> = {}
  if (skuRepId) {
    const rows = await fetchAll<SnapRow>(
      (sb) => sb.from('fact_sku_snapshot')
        .select('sku_ms, margin_rub, chmd_5d, manager, price, stock_days, novelty_status, fbo_wb, fbs_pushkino, fbs_smolensk, snap_date')
        .eq('upload_id', skuRepId),
      supabase,
    )
    for (const r of rows) snapByMs[r.sku_ms] = r
  }

  // ── 4. fact_stock_snapshot — остатки (из Таблицы остатков) ───────────────
  type StockRow = { sku_wb: number; fbo_wb: number | null; fbs_pushkino: number | null; fbs_smolensk: number | null; total_stock: number | null; price: number | null; margin_pct: number | null }
  const stockByWb: Record<number, StockRow> = {}
  if (stockId) {
    const { data } = await supabase.from('fact_stock_snapshot')
      .select('sku_wb, fbo_wb, fbs_pushkino, fbs_smolensk, total_stock, price, margin_pct')
      .eq('upload_id', stockId)
    if (data) for (const r of data) stockByWb[r.sku_wb] = r
  }

  // ── 5. fact_china_supply — логистическое плечо ────────────────────────────
  const chinaByMs: Record<string, { lead_time_days: number | null; in_transit: number | null }> = {}
  if (chinaId) {
    const { data } = await supabase.from('fact_china_supply')
      .select('sku_ms, lead_time_days, in_transit').eq('upload_id', chinaId)
    if (data) for (const r of data) chinaByMs[r.sku_ms] = r
  }

  // ── 6. ABC ────────────────────────────────────────────────────────────────
  const abcCounts = { A: 0, B: 0, C: 0 }
  const abcByMs: Record<string, string | null> = {}
  if (abcId) {
    const { data } = await supabase.from('fact_abc')
      .select('sku_ms, abc_class').eq('upload_id', abcId)
    if (data) for (const r of data) {
      abcByMs[r.sku_ms] = r.abc_class
      const cls = (r.abc_class ?? '').toUpperCase().charAt(0)
      if (cls === 'A') abcCounts.A++
      else if (cls === 'B') abcCounts.B++
      else if (cls === 'C') abcCounts.C++
    }
  }

  // ── 7. fact_sku_daily — основной источник за период ──────────────────────
  let fromDate = fromParam
  let toDate = toParam
  if (!fromDate || !toDate) {
    const { data: maxRow } = await supabase.from('fact_sku_daily')
      .select('metric_date').order('metric_date', { ascending: false }).limit(1)
    const maxDate = maxRow?.[0]?.metric_date ?? null
    if (maxDate) {
      const d = new Date(maxDate); d.setDate(d.getDate() - 29)
      fromDate = d.toISOString().split('T')[0]
      toDate = maxDate
    }
  }

  type DailyRow = { sku_ms: string; metric_date: string; revenue: number | null; ad_spend: number | null; ctr: number | null; cr_order: number | null }
  const dailyRows = fromDate && toDate
    ? await fetchAll<DailyRow>(
        (sb) => sb.from('fact_sku_daily')
          .select('sku_ms, metric_date, revenue, ad_spend, ctr, cr_order')
          .gte('metric_date', fromDate!).lte('metric_date', toDate!),
        supabase,
      )
    : []

  // ── 8. fact_stock_daily — продажи шт (для расчёта DPD и потерь OOS) ──────
  type StockDailyRow = { sku_wb: number; sale_date: string; sales_qty: number | null }
  const stockDailyRows = fromDate && toDate
    ? await fetchAll<StockDailyRow>(
        (sb) => sb.from('fact_stock_daily')
          .select('sku_wb, sale_date, sales_qty')
          .gte('sale_date', fromDate!).lte('sale_date', toDate!),
        supabase,
      )
    : []

  // ── 9. Агрегация daily по SKU и по дате ───────────────────────────────────
  const skuAgg: Record<string, { revenue: number; ad_spend: number; ctr: number[]; cr_order: number[]; days: Set<string> }> = {}
  const dateAgg: Record<string, { revenue: number; ad_spend: number }> = {}

  for (const r of dailyRows) {
    if (!skuAgg[r.sku_ms]) skuAgg[r.sku_ms] = { revenue: 0, ad_spend: 0, ctr: [], cr_order: [], days: new Set() }
    const s = skuAgg[r.sku_ms]
    s.revenue += r.revenue ?? 0
    s.ad_spend += r.ad_spend ?? 0
    if (r.ctr != null) s.ctr.push(r.ctr)
    if (r.cr_order != null) s.cr_order.push(r.cr_order)
    s.days.add(r.metric_date)

    if (!dateAgg[r.metric_date]) dateAgg[r.metric_date] = { revenue: 0, ad_spend: 0 }
    dateAgg[r.metric_date].revenue += r.revenue ?? 0
    dateAgg[r.metric_date].ad_spend += r.ad_spend ?? 0
  }

  // ── 10. Продажи шт по SKU WB (для DPD и потерь OOS) ──────────────────────
  const stockDailyByWb: Record<number, { total_qty: number; days_with_sales: number }> = {}
  for (const r of stockDailyRows) {
    if (!stockDailyByWb[r.sku_wb]) stockDailyByWb[r.sku_wb] = { total_qty: 0, days_with_sales: 0 }
    stockDailyByWb[r.sku_wb].total_qty += r.sales_qty ?? 0
    if ((r.sales_qty ?? 0) > 0) stockDailyByWb[r.sku_wb].days_with_sales++
  }

  const periodDays = fromDate && toDate
    ? Math.max(1, Math.round((new Date(toDate).getTime() - new Date(fromDate).getTime()) / 86400000) + 1)
    : 30

  // ── 11. Итоговые KPI ──────────────────────────────────────────────────────
  let totalRevenue = 0
  let totalAdSpend = 0
  for (const s of Object.values(skuAgg)) {
    totalRevenue += s.revenue
    totalAdSpend += s.ad_spend
  }

  // Средневзвешенная маржа: ∑(margin_pct × revenue_i) / ∑revenue_i
  // margin_pct = margin_rub / price из snapshot
  let wMarginNum = 0
  let wMarginDen = 0
  for (const [ms, s] of Object.entries(skuAgg)) {
    const snap = snapByMs[ms]
    const skuWb = dimByMs[ms]?.sku_wb
    const stockSnap = skuWb ? stockByWb[skuWb] : null
    const price = snap?.price ?? stockSnap?.price ?? null
    const marginRub = snap?.margin_rub ?? null
    const marginPct = marginRub != null && price && price > 0
      ? marginRub / price
      : (stockSnap?.margin_pct ?? null)
    if (marginPct != null && s.revenue > 0) {
      wMarginNum += marginPct * s.revenue
      wMarginDen += s.revenue
    }
  }
  const avgMarginPct = wMarginDen > 0 ? wMarginNum / wMarginDen : 0

  // Себестоимость = Выручка × (1 − Маржа)
  const totalCostOfGoods = totalRevenue * (1 - avgMarginPct)

  // ЧМД = (Выручка − Реклама) − Себестоимость
  const totalChmd = (totalRevenue - totalAdSpend) - totalCostOfGoods

  // ── 12. Алерты ────────────────────────────────────────────────────────────
  let stopAdsCount = 0      // OOS + активная реклама (сейчас)
  let soonOosCount = 0      // Days_stock < lead_time
  let drrOverMarginCount = 0 // ДРР > Маржа
  let highCtrLowCrCount = 0  // CTR высокий + CR низкий → проблема карточки
  let lostRevenue = 0       // Упущенная выручка (OOS × DPD × Price)

  // Медианные значения CTR и CR для расчёта «потенциал роста»
  const allCtrs = dailyRows.filter(r => r.ctr != null).map(r => r.ctr!)
  const allCrs  = dailyRows.filter(r => r.cr_order != null).map(r => r.cr_order!)
  const medianCtr = allCtrs.length ? [...allCtrs].sort((a,b)=>a-b)[Math.floor(allCtrs.length/2)] : 0
  const medianCr  = allCrs.length  ? [...allCrs].sort((a,b)=>a-b)[Math.floor(allCrs.length/2)]  : 0

  for (const [ms, s] of Object.entries(skuAgg)) {
    const snap    = snapByMs[ms]
    const dim     = dimByMs[ms]
    const skuWb   = dim?.sku_wb ?? null
    const stockSnap = skuWb ? stockByWb[skuWb] : null
    const china   = chinaByMs[ms]

    const price       = snap?.price ?? stockSnap?.price ?? 0
    const marginRub   = snap?.margin_rub ?? null
    const marginPct   = marginRub != null && price > 0
      ? marginRub / price
      : (stockSnap?.margin_pct ?? 0)

    const totalStock  = stockSnap?.total_stock ?? 0
    const leadTime    = getLeadTime(dim?.country, china?.lead_time_days)

    // DPD (продаж шт/день) из fact_stock_daily
    const sd = skuWb ? stockDailyByWb[skuWb] : null
    const dpd = sd && sd.days_with_sales > 0 ? sd.total_qty / periodDays : 0

    // Запас дней: из snapshot или расчётный через DPD
    const stockDays = snap?.stock_days
      ?? (dpd > 0 && totalStock > 0 ? Math.round(totalStock / dpd) : (totalStock > 0 ? 999 : 0))

    const drr = s.revenue > 0 ? s.ad_spend / s.revenue : 0
    const avgCtr = s.ctr.length ? s.ctr.reduce((a,b)=>a+b,0)/s.ctr.length : 0
    const avgCr  = s.cr_order.length ? s.cr_order.reduce((a,b)=>a+b,0)/s.cr_order.length : 0

    // STOP реклама: OOS + активная реклама
    if (totalStock === 0 && s.ad_spend > 0) {
      stopAdsCount++
      lostRevenue += s.ad_spend  // минимальная оценка потерь = слитый бюджет
    }

    // Скоро OOS: запас < логплечо
    if (totalStock > 0 && stockDays < leadTime) soonOosCount++

    // Упущенная выручка OOS (нет стока, но есть спрос)
    if (totalStock === 0 && dpd > 0 && price > 0) {
      // Считаем дни OOS в периоде: дни периода - дни с продажами
      const daysOos = Math.max(0, periodDays - (sd?.days_with_sales ?? 0))
      lostRevenue += dpd * daysOos * price
    }

    // ДРР > Маржа
    if (marginPct > 0 && drr > marginPct) drrOverMarginCount++

    // Высокий CTR + низкий CR (потенциал карточки)
    if (medianCtr > 0 && medianCr > 0 && avgCtr > medianCtr && avgCr < medianCr) highCtrLowCrCount++
  }

  // ── 13. График по дням: Выручка, ЧМД (расчётный), Расходы ────────────────
  const trend = Object.entries(dateAgg)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, d]) => {
      // ЧМД за день = (revenue - ad_spend) - revenue*(1-avgMarginPct)
      const chmdDay = (d.revenue - d.ad_spend) - d.revenue * (1 - avgMarginPct)
      return {
        date,
        revenue: d.revenue,
        chmd: chmdDay,
        ad_spend: d.ad_spend,
      }
    })

  // ── 14. Top-15 SKU по SKU Score ───────────────────────────────────────────
  const top15 = Object.entries(skuAgg)
    .map(([ms, s]) => {
      const snap    = snapByMs[ms]
      const dim     = dimByMs[ms]
      const skuWb   = dim?.sku_wb ?? null
      const stockSnap = skuWb ? stockByWb[skuWb] : null
      const china   = chinaByMs[ms]

      const price     = snap?.price ?? stockSnap?.price ?? 0
      const marginRub = snap?.margin_rub ?? null
      const marginPct = marginRub != null && price > 0
        ? marginRub / price : (stockSnap?.margin_pct ?? 0)

      const totalStock = stockSnap?.total_stock ?? 0
      const leadTime   = getLeadTime(dim?.country, china?.lead_time_days)
      const stockDays  = snap?.stock_days ?? (totalStock > 0 ? 999 : 0)

      const drr        = s.revenue > 0 ? s.ad_spend / s.revenue : 0
      const avgCr      = s.cr_order.length ? s.cr_order.reduce((a,b)=>a+b,0)/s.cr_order.length : 0

      const score = computeScore({
        margin_pct: marginPct,
        drr,
        revenue_growth: 0,
        cr_order: avgCr,
        stock_days: stockDays,
        is_oos: totalStock === 0,
        drr_over_margin: marginPct > 0 && drr > marginPct,
        is_novelty_low: snap?.novelty_status === 'Новинки' && s.revenue < 10000,
      })

      const chmd = (s.revenue - s.ad_spend) - s.revenue * (1 - marginPct)

      return {
        sku_ms: ms,
        sku_wb: skuWb,
        name: dim?.name ?? ms,
        revenue: s.revenue,
        chmd,
        drr,
        margin_pct: marginPct,
        stock_days: stockDays,
        lead_time: leadTime,
        abc_class: abcByMs[ms] ?? '—',
        score,
        is_oos: totalStock === 0,
      }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 15)

  // ── 15. Unit-экономика по дням (Маржа% и ДРР%) — для второго графика ──────
  const unitEconByDay = trend.map(d => ({
    date: d.date,
    margin_pct: avgMarginPct * 100,  // одно значение на весь период (из snapshot)
    drr_pct: d.revenue > 0 ? (d.ad_spend / d.revenue) * 100 : 0,
  }))

  return NextResponse.json({
    kpi: {
      revenue: totalRevenue,
      chmd: totalChmd,
      avg_margin_pct: avgMarginPct,
      drr: totalRevenue > 0 ? totalAdSpend / totalRevenue : null,
      ad_spend: totalAdSpend,
      cost_of_goods: totalCostOfGoods,
      lost_revenue: lostRevenue,
      oos_count: Object.values(stockByWb).filter(s => (s.total_stock ?? 0) === 0).length,
      sku_count: dimRows.length,
    },
    alerts: {
      stop_ads: stopAdsCount,
      soon_oos: soonOosCount,
      drr_over_margin: drrOverMarginCount,
      high_ctr_low_cr: highCtrLowCrCount,
      lost_revenue: lostRevenue,
    },
    abc: abcCounts,
    trend,
    unit_econ: unitEconByDay,
    top15,
    latest_date: Object.keys(dateAgg).sort().at(-1) ?? null,
    period: { from: fromDate, to: toDate },
  })
}
