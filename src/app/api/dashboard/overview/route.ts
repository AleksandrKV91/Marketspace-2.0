import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export const maxDuration = 30

export async function GET() {
  const supabase = createServiceClient()

  // Последний upload_id для каждого типа файла
  const { data: lastUploads } = await supabase
    .from('uploads')
    .select('id, file_type, uploaded_at')
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
  const stockId = latestByType['stock']
  const abcId = latestByType['abc']

  // Последние дневные метрики (5 дней) — топ SKU по расходу
  const { data: recentDates } = await supabase
    .from('fact_sku_daily')
    .select('metric_date')
    .order('metric_date', { ascending: false })
    .limit(1)

  const latestDate = recentDates?.[0]?.metric_date ?? null

  // Агрегаты за последние 5 дат
  let dailyAgg: { total_revenue: number; total_ad_spend: number; drr: number } | null = null
  if (latestDate) {
    const { data: daily5 } = await supabase
      .from('fact_sku_daily')
      .select('revenue, ad_spend')
      .gte('metric_date', latestDate)
      .lte('metric_date', latestDate)

    if (daily5?.length) {
      const revenue = daily5.reduce((s, r) => s + (r.revenue ?? 0), 0)
      const adSpend = daily5.reduce((s, r) => s + (r.ad_spend ?? 0), 0)
      dailyAgg = {
        total_revenue: revenue,
        total_ad_spend: adSpend,
        drr: revenue > 0 ? adSpend / revenue : 0,
      }
    }
  }

  // Снапшот остатков — суммарно
  let stockAgg: { total_fbo: number; total_fbs: number; total_stock: number; sku_count: number } | null = null
  if (stockId) {
    const { data: stockRows } = await supabase
      .from('fact_stock_snapshot')
      .select('fbo_wb, fbs_pushkino, fbs_smolensk, total_stock')
      .eq('upload_id', stockId)

    if (stockRows?.length) {
      stockAgg = {
        total_fbo: stockRows.reduce((s, r) => s + (r.fbo_wb ?? 0), 0),
        total_fbs: stockRows.reduce((s, r) => s + ((r.fbs_pushkino ?? 0) + (r.fbs_smolensk ?? 0)), 0),
        total_stock: stockRows.reduce((s, r) => s + (r.total_stock ?? 0), 0),
        sku_count: stockRows.length,
      }
    }
  }

  // АВС — количество по классам
  let abcCounts: { A: number; B: number; C: number } | null = null
  if (abcId) {
    const { data: abcRows } = await supabase
      .from('fact_abc')
      .select('abc_class')
      .eq('upload_id', abcId)

    if (abcRows?.length) {
      abcCounts = { A: 0, B: 0, C: 0 }
      for (const r of abcRows) {
        const cls = (r.abc_class ?? '').toUpperCase()
        if (cls === 'A') abcCounts.A++
        else if (cls === 'B') abcCounts.B++
        else if (cls === 'C') abcCounts.C++
      }
    }
  }

  // Снапшот SKU (из SKU report)
  let skuAgg: { sku_count: number; avg_margin: number; oos_count: number } | null = null
  if (skuReportId) {
    const { data: skuRows } = await supabase
      .from('fact_sku_snapshot')
      .select('fbo_wb, fbs_pushkino, fbs_smolensk, margin_rub')
      .eq('upload_id', skuReportId)

    if (skuRows?.length) {
      const oosCount = skuRows.filter(r =>
        (r.fbo_wb ?? 0) + (r.fbs_pushkino ?? 0) + (r.fbs_smolensk ?? 0) === 0
      ).length
      const margins = skuRows.filter(r => r.margin_rub !== null).map(r => r.margin_rub ?? 0)
      skuAgg = {
        sku_count: skuRows.length,
        avg_margin: margins.length ? margins.reduce((s, v) => s + v, 0) / margins.length : 0,
        oos_count: oosCount,
      }
    }
  }

  // Revenue trend — последние 14 дат из fact_sku_daily
  const { data: trendRows } = await supabase
    .from('fact_sku_daily')
    .select('metric_date, revenue, ad_spend')
    .order('metric_date', { ascending: false })
    .limit(1000)

  const trendByDate: Record<string, { revenue: number; ad_spend: number }> = {}
  if (trendRows) {
    for (const r of trendRows) {
      const d = r.metric_date
      if (!trendByDate[d]) trendByDate[d] = { revenue: 0, ad_spend: 0 }
      trendByDate[d].revenue += r.revenue ?? 0
      trendByDate[d].ad_spend += r.ad_spend ?? 0
    }
  }
  const trend = Object.entries(trendByDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-14)
    .map(([date, vals]) => ({ date, ...vals }))

  return NextResponse.json({
    daily: dailyAgg,
    stock: stockAgg,
    abc: abcCounts,
    sku: skuAgg,
    trend,
    latest_date: latestDate,
  })
}
