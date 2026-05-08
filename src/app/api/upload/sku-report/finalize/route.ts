import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { invalidatePrefix, invalidate } from '@/lib/cache'

export const maxDuration = 30

// Шаг 3 chunked-upload: помечает upload как ok, инвалидирует серверный кэш.
export async function POST(req: NextRequest) {
  const supabase = createServiceClient()
  const url = new URL(req.url)
  const uploadId = url.searchParams.get('upload_id')

  if (!uploadId) return NextResponse.json({ error: 'upload_id обязателен' }, { status: 400 })

  const { error } = await supabase.from('uploads').update({ status: 'ok' }).eq('id', uploadId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Инвалидация серверного кэша — следующие запросы получат свежие данные
  invalidatePrefix('overview|')
  invalidate('dim_sku_all')
  invalidate('dim_sku_names')
  invalidate('latest_uploads')
  invalidate('orders_dim_sku')
  invalidate('orders_latest_uploads')
  invalidate('forecast_chart_dim_sku')

  return NextResponse.json({ ok: true })
}
