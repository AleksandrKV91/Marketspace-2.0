import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export const maxDuration = 20

export async function GET() {
  const supabase = createServiceClient()

  const [uploadsRes, dailySampleRes, dailyCountRes] = await Promise.all([
    supabase.from('uploads').select('id, file_type, filename, uploaded_at, status, rows_count').order('uploaded_at', { ascending: false }).limit(15),
    supabase.from('fact_sku_daily').select('sku_ms, snap_date, manager, price, upload_id').not('snap_date', 'is', null).order('snap_date', { ascending: false }).limit(5),
    supabase.from('fact_sku_daily').select('sku_ms', { count: 'exact', head: true }),
  ])

  return NextResponse.json({
    uploads: uploadsRes.data ?? [],
    uploads_error: uploadsRes.error?.message,
    daily_snapshot_sample: dailySampleRes.data ?? [],
    daily_error: dailySampleRes.error?.message,
    fact_sku_daily_total: dailyCountRes.count,
  })
}
