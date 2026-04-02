import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export const maxDuration = 30

export async function GET() {
  const supabase = createServiceClient()

  // Get sample dim_sku values
  const { data: dimSample } = await supabase
    .from('dim_sku')
    .select('sku_ms, sku_wb, sku_warehouse, name')
    .limit(10)

  // Get last sku_report upload info
  const { data: lastUpload } = await supabase
    .from('uploads')
    .select('*')
    .eq('file_type', 'sku_report')
    .order('uploaded_at', { ascending: false })
    .limit(1)
    .single()

  // Check what's in fact tables
  const { count: dailyCount } = await supabase
    .from('fact_sku_daily')
    .select('*', { count: 'exact', head: true })

  const { count: snapCount } = await supabase
    .from('fact_sku_snapshot')
    .select('*', { count: 'exact', head: true })

  // Sample rows from fact tables if any exist
  const { data: dailySample } = await supabase
    .from('fact_sku_daily')
    .select('sku_ms, metric_date, revenue')
    .limit(5)

  return NextResponse.json({
    dim_sample: dimSample,
    last_upload: lastUpload,
    fact_sku_daily_count: dailyCount,
    fact_sku_snapshot_count: snapCount,
    fact_sku_daily_sample: dailySample,
    note: 'Check dim_sample.sku_ms format vs what the parser extracts from row[0] or skuMsCol',
  })
}
