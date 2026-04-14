import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export const maxDuration = 20

export async function GET() {
  const supabase = createServiceClient()

  const [uploadsRes, snapSampleRes, snapCountByUploadRes] = await Promise.all([
    supabase.from('uploads').select('id, file_type, filename, uploaded_at, status, rows_count').order('uploaded_at', { ascending: false }).limit(15),
    supabase.from('fact_sku_snapshot').select('sku_ms, sku_wb, manager, price, upload_id').limit(5),
    supabase.from('fact_sku_snapshot').select('upload_id').limit(1),
  ])

  return NextResponse.json({
    uploads: uploadsRes.data ?? [],
    uploads_error: uploadsRes.error?.message,
    snapshot_sample: snapSampleRes.data ?? [],
    snapshot_error: snapSampleRes.error?.message,
    snapshot_upload_id_sample: snapCountByUploadRes.data ?? [],
  })
}
