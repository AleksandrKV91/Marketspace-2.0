import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export const maxDuration = 30

export async function GET(req: NextRequest) {
  const supabase = createServiceClient()
  const { searchParams } = new URL(req.url)
  const from = searchParams.get('from') ?? '2026-03-01'
  const to = searchParams.get('to') ?? '2026-04-05'

  const [uploadsRes, priceCountRes, priceRangeMinRes, priceRangeMaxRes, dailyRangeMinRes, dailyRangeMaxRes, dailyCountRes] = await Promise.all([
    supabase.from('uploads').select('id, file_type, uploaded_at, status').eq('status', 'ok').order('uploaded_at', { ascending: false }).limit(10),
    supabase.from('fact_price_changes').select('sku_wb', { count: 'exact', head: true }),
    supabase.from('fact_price_changes').select('price_date').order('price_date', { ascending: true }).limit(1),
    supabase.from('fact_price_changes').select('price_date').order('price_date', { ascending: false }).limit(1),
    supabase.from('fact_sku_daily').select('metric_date').order('metric_date', { ascending: true }).limit(1),
    supabase.from('fact_sku_daily').select('metric_date').order('metric_date', { ascending: false }).limit(1),
    supabase.from('fact_sku_daily').select('sku_ms', { count: 'exact', head: true }).gte('metric_date', from).lte('metric_date', to),
  ])

  const latestByType: Record<string, string> = {}
  for (const u of uploadsRes.data ?? []) {
    if (!latestByType[u.file_type]) latestByType[u.file_type] = u.id
  }
  const skuReportId = latestByType['sku_report'] ?? null

  const snapCountRes = skuReportId
    ? await supabase.from('fact_sku_daily').select('sku_ms', { count: 'exact', head: true }).eq('upload_id', skuReportId)
    : { count: null }

  const priceSampleRes = await supabase.from('fact_price_changes').select('sku_wb, sku_ms, price_date, price').order('price_date', { ascending: false }).limit(5)

  return NextResponse.json({
    period: { from, to },
    uploads: (uploadsRes.data ?? []).map(u => ({ file_type: u.file_type, uploaded_at: u.uploaded_at, id: u.id.slice(0,8) })),
    sku_report_upload_id: skuReportId?.slice(0, 8),
    fact_price_changes: {
      total_rows: priceCountRes.count,
      date_min: priceRangeMinRes.data?.[0]?.price_date ?? null,
      date_max: priceRangeMaxRes.data?.[0]?.price_date ?? null,
      sample: priceSampleRes.data,
    },
    fact_sku_daily: {
      date_min: dailyRangeMinRes.data?.[0]?.metric_date ?? null,
      date_max: dailyRangeMaxRes.data?.[0]?.metric_date ?? null,
      rows_in_period: dailyCountRes.count,
      rows_in_sku_report: snapCountRes.count,
    },
  })
}
