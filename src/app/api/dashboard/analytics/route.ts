import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export const maxDuration = 30

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

  // dim_sku — категории и менеджеры
  const { data: dimRows } = await supabase
    .from('dim_sku')
    .select('sku_ms, name, brand, subject_wb, category_wb')
    .limit(2000)

  const dimMap: Record<string, { name: string | null; subject_wb: string | null; category_wb: string | null }> = {}
  if (dimRows) {
    for (const r of dimRows) dimMap[r.sku_ms] = r
  }

  // fact_sku_daily — последние 5 дней
  const { data: lastDateRow } = await supabase
    .from('fact_sku_daily')
    .select('metric_date')
    .order('metric_date', { ascending: false })
    .limit(1)
  const latestDate = lastDateRow?.[0]?.metric_date

  const dailyAgg: Record<string, { revenue: number; ad_spend: number; drr: number }> = {}
  if (latestDate) {
    let dailyQ = supabase
      .from('fact_sku_daily')
      .select('sku_ms, revenue, ad_spend')
    if (fromParam && toParam) {
      dailyQ = dailyQ.gte('metric_date', fromParam).lte('metric_date', toParam)
    } else {
      const { data: dates5 } = await supabase
        .from('fact_sku_daily')
        .select('metric_date')
        .order('metric_date', { ascending: false })
        .limit(5)
      const dateList = [...new Set((dates5 ?? []).map(d => d.metric_date))]
      dailyQ = dailyQ.in('metric_date', dateList)
    }
    const { data: dailyRows } = await dailyQ

    if (dailyRows) {
      for (const r of dailyRows) {
        if (!dailyAgg[r.sku_ms]) dailyAgg[r.sku_ms] = { revenue: 0, ad_spend: 0, drr: 0 }
        dailyAgg[r.sku_ms].revenue += r.revenue ?? 0
        dailyAgg[r.sku_ms].ad_spend += r.ad_spend ?? 0
      }
      for (const sku of Object.keys(dailyAgg)) {
        const d = dailyAgg[sku]
        d.drr = d.revenue > 0 ? d.ad_spend / d.revenue : 0
      }
    }
  }

  // fact_sku_snapshot — маржа и остатки
  const snapMap: Record<string, { margin_rub: number | null; fbo_wb: number | null; fbs_pushkino: number | null; fbs_smolensk: number | null }> = {}
  if (skuReportId) {
    const { data: snapRows } = await supabase
      .from('fact_sku_snapshot')
      .select('sku_ms, margin_rub, fbo_wb, fbs_pushkino, fbs_smolensk')
      .eq('upload_id', skuReportId)
    if (snapRows) {
      for (const r of snapRows) snapMap[r.sku_ms] = r
    }
  }

  // fact_abc — класс и рентабельность
  const abcMap: Record<string, { abc_class: string | null; profitability: number | null; chmd: number | null; revenue: number | null; turnover_days: number | null }> = {}
  if (abcId) {
    const { data: abcRows } = await supabase
      .from('fact_abc')
      .select('sku_ms, abc_class, profitability, chmd, revenue, turnover_days')
      .eq('upload_id', abcId)
    if (abcRows) {
      for (const r of abcRows) abcMap[r.sku_ms] = r
    }
  }

  // Строим сводку по категориям
  const categoryData: Record<string, {
    category: string; skus: string[]
    revenue: number; ad_spend: number; chmd: number; margin_rub_sum: number; margin_revenue: number
  }> = {}

  const allSkus = Object.keys(dimMap)
  for (const skuMs of allSkus) {
    const dim = dimMap[skuMs]
    const category = dim.category_wb ?? dim.subject_wb ?? 'Без категории'
    if (!categoryData[category]) {
      categoryData[category] = { category, skus: [], revenue: 0, ad_spend: 0, chmd: 0, margin_rub_sum: 0, margin_revenue: 0 }
    }
    const cat = categoryData[category]
    cat.skus.push(skuMs)

    const daily = dailyAgg[skuMs]
    if (daily) {
      cat.revenue += daily.revenue
      cat.ad_spend += daily.ad_spend
    }
    const abc = abcMap[skuMs]
    if (abc?.chmd) cat.chmd += abc.chmd
    const snap = snapMap[skuMs]
    if (snap?.margin_rub) {
      cat.margin_rub_sum += snap.margin_rub
      cat.margin_revenue += dailyAgg[skuMs]?.revenue ?? 0
    }
  }

  const by_category = Object.values(categoryData).map(c => ({
    category: c.category,
    sku_count: c.skus.length,
    revenue: c.revenue,
    delta_pct: 0,
    chmd: c.chmd,
    margin_pct: c.revenue > 0 ? c.chmd / c.revenue : 0,
    drr: c.revenue > 0 ? c.ad_spend / c.revenue : 0,
    stock_rub: 0,
  })).sort((a, b) => b.revenue - a.revenue)

  const totalRevenue = by_category.reduce((s, c) => s + c.revenue, 0)
  const totalChmd = by_category.reduce((s, c) => s + c.chmd, 0)
  const totalAdSpend = Object.values(dailyAgg).reduce((s, d) => s + d.ad_spend, 0)

  const summary = {
    revenue: totalRevenue,
    revenue_prev: 0,
    chmd: totalChmd,
    chmd_prev: 0,
    margin_pct: totalRevenue > 0 ? totalChmd / totalRevenue : 0,
    margin_prev: 0,
    drr: totalRevenue > 0 ? totalAdSpend / totalRevenue : 0,
    drr_prev: 0,
  }

  // Daily data from fact_stock_daily as proxy (no fact_sku_daily data)
  const daily: Array<{ date: string; revenue: number; chmd: number; expenses: number; margin_pct: number; drr: number }> = []

  return NextResponse.json({ summary, daily, by_category, by_manager: [], latest_date: latestDate })
}
