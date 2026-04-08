import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/supabase/fetchAll'

export const maxDuration = 60

export async function GET(req: Request) {
  const supabase = createServiceClient()
  const url = new URL(req.url)
  const fromParam = url.searchParams.get('from')
  const toParam = url.searchParams.get('to')

  // Последний upload_id для sku_report и abc
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

  const skuReportId = latestByType['sku_report']
  const abcId = latestByType['abc']

  // dim_sku — категории, все строки
  const dimRows = await fetchAll<{ sku_ms: string; subject_wb: string | null; category_wb: string | null }>(
    (sb) => sb.from('dim_sku').select('sku_ms, subject_wb, category_wb'),
    supabase,
  )

  const dimMap: Record<string, { subject_wb: string | null; category_wb: string | null }> = {}
  for (const r of dimRows) dimMap[r.sku_ms] = r

  // fact_sku_snapshot — margin_rub (для расчёта маржи %)
  // margin_rub = операционная маржа на единицу × stock → используем как прокси маржинальности
  const snapMarginMap: Record<string, number> = {}
  if (skuReportId) {
    const { data: snapRows } = await supabase
      .from('fact_sku_snapshot')
      .select('sku_ms, margin_rub')
      .eq('upload_id', skuReportId)
    if (snapRows) {
      for (const r of snapRows) {
        if (r.margin_rub != null) snapMarginMap[r.sku_ms] = r.margin_rub
      }
    }
  }

  // fact_abc — chmd и revenue за период (дополнение к sku_daily)
  const abcMap: Record<string, { chmd: number; revenue: number; abc_class: string | null }> = {}
  if (abcId) {
    const { data: abcRows } = await supabase
      .from('fact_abc')
      .select('sku_ms, chmd, revenue, abc_class')
      .eq('upload_id', abcId)
    if (abcRows) {
      for (const r of abcRows) abcMap[r.sku_ms] = { chmd: r.chmd ?? 0, revenue: r.revenue ?? 0, abc_class: r.abc_class }
    }
  }

  // fact_sku_daily — основной источник метрик
  // Определяем диапазон дат
  let dateList: string[] = []
  if (fromParam && toParam) {
    // используем диапазон из params
  } else {
    // последние 5 уникальных дат
    const { data: dates5 } = await supabase
      .from('fact_sku_daily')
      .select('metric_date')
      .order('metric_date', { ascending: false })
      .limit(5)
    dateList = [...new Set((dates5 ?? []).map(d => d.metric_date))]
  }

  let dailyQ = supabase
    .from('fact_sku_daily')
    .select('sku_ms, metric_date, revenue, ad_spend, drr_total, ctr, cr_order, cpm, cpc')

  if (fromParam && toParam) {
    dailyQ = dailyQ.gte('metric_date', fromParam).lte('metric_date', toParam)
  } else if (dateList.length > 0) {
    dailyQ = dailyQ.in('metric_date', dateList)
  }

  const dailyRows = await fetchAll<{ sku_ms: string; metric_date: string; revenue: number | null; ad_spend: number | null; drr_total: number | null; ctr: number | null; cr_order: number | null; cpm: number | null; cpc: number | null }>(
    () => dailyQ, supabase,
  )

  // Агрегация по SKU
  const skuAgg: Record<string, { revenue: number; ad_spend: number; days: Set<string> }> = {}
  // Агрегация по дате (для daily графика)
  const dateAgg: Record<string, { revenue: number; ad_spend: number }> = {}

  for (const r of dailyRows) {
      // По SKU
      if (!skuAgg[r.sku_ms]) skuAgg[r.sku_ms] = { revenue: 0, ad_spend: 0, days: new Set() }
      skuAgg[r.sku_ms].revenue += r.revenue ?? 0
      skuAgg[r.sku_ms].ad_spend += r.ad_spend ?? 0
      skuAgg[r.sku_ms].days.add(r.metric_date)

      // По дате
      if (!dateAgg[r.metric_date]) dateAgg[r.metric_date] = { revenue: 0, ad_spend: 0 }
      dateAgg[r.metric_date].revenue += r.revenue ?? 0
      dateAgg[r.metric_date].ad_spend += r.ad_spend ?? 0
  }

  const latestDate = Object.keys(dateAgg).sort().at(-1) ?? null

  // daily график — по датам, chmd берём пропорционально из abc если есть
  // Считаем общую долю chmd/revenue из abc как прокси
  const totalAbcRevenue = Object.values(abcMap).reduce((s, r) => s + r.revenue, 0)
  const totalAbcChmd = Object.values(abcMap).reduce((s, r) => s + r.chmd, 0)
  const abcMarginRate = totalAbcRevenue > 0 ? totalAbcChmd / totalAbcRevenue : 0

  const daily = Object.entries(dateAgg)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, d]) => ({
      date,
      revenue: d.revenue,
      chmd: d.revenue * abcMarginRate,
      expenses: d.ad_spend,
      margin_pct: abcMarginRate,
      drr: d.revenue > 0 ? d.ad_spend / d.revenue : 0,
    }))

  // Строим сводку по категориям
  const categoryData: Record<string, {
    category: string
    revenue: number
    ad_spend: number
    chmd: number
    sku_count: number
    skus_with_revenue: Set<string>
  }> = {}

  for (const [skuMs, agg] of Object.entries(skuAgg)) {
    const dim = dimMap[skuMs]
    const category = dim?.category_wb ?? dim?.subject_wb ?? 'Без категории'
    if (!categoryData[category]) {
      categoryData[category] = { category, revenue: 0, ad_spend: 0, chmd: 0, sku_count: 0, skus_with_revenue: new Set() }
    }
    categoryData[category].revenue += agg.revenue
    categoryData[category].ad_spend += agg.ad_spend
    if (agg.revenue > 0) categoryData[category].skus_with_revenue.add(skuMs)

    // chmd из abc если есть совпадение, иначе пропорция
    const abc = abcMap[skuMs]
    if (abc && abc.revenue > 0) {
      // Пропорционируем chmd из abc по доле выручки периода
      const share = agg.revenue / abc.revenue
      categoryData[category].chmd += abc.chmd * Math.min(share, 1)
    } else {
      // Используем среднюю маржинальность из ABC как прокси
      categoryData[category].chmd += agg.revenue * abcMarginRate
    }
  }

  // Добавляем count из dim_sku (все SKU категории, не только с выручкой)
  const dimCatCount: Record<string, number> = {}
  for (const r of Object.values(dimMap)) {
    const cat = r.category_wb ?? r.subject_wb ?? 'Без категории'
    dimCatCount[cat] = (dimCatCount[cat] ?? 0) + 1
  }

  const by_category = Object.values(categoryData)
    .map(c => ({
      category: c.category,
      sku_count: dimCatCount[c.category] ?? c.skus_with_revenue.size,
      revenue: c.revenue,
      delta_pct: 0,
      chmd: c.chmd,
      margin_pct: c.revenue > 0 ? c.chmd / c.revenue : 0,
      drr: c.revenue > 0 ? c.ad_spend / c.revenue : 0,
      stock_rub: 0,
    }))
    .sort((a, b) => b.revenue - a.revenue)

  const totalRevenue = by_category.reduce((s, c) => s + c.revenue, 0)
  const totalChmd = by_category.reduce((s, c) => s + c.chmd, 0)
  const totalAdSpend = by_category.reduce((s, c) => s + c.drr * c.revenue, 0)
  const daysCount = Object.keys(dateAgg).length || 1

  const summary = {
    revenue: totalRevenue,
    revenue_prev: 0,
    chmd: totalChmd,
    chmd_prev: 0,
    margin_pct: totalRevenue > 0 ? totalChmd / totalRevenue : 0,
    margin_prev: 0,
    drr: totalRevenue > 0 ? totalAdSpend / totalRevenue : 0,
    drr_prev: 0,
    cpo: null as number | null,
    delta_revenue_pct: null as number | null,
    forecast_60d: Math.round(totalRevenue / daysCount * 60),
  }

  return NextResponse.json({ summary, daily, by_category, by_manager: [], latest_date: latestDate })
}
