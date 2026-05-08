import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export const maxDuration = 30

// Шаг 1 chunked-upload: создаёт запись в `uploads` со статусом 'pending'.
// Возвращает upload_id, который FE использует для последующих batch-запросов.
export async function POST(req: NextRequest) {
  const supabase = createServiceClient()
  let body: { filename?: string; period_start?: string | null; period_end?: string | null; rows_parsed?: number }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Невалидный JSON' }, { status: 400 })
  }

  const { data: upload, error } = await supabase
    .from('uploads')
    .insert({
      file_type: 'sku_report',
      filename: body.filename ?? 'sku-report.xlsb',
      rows_count: body.rows_parsed ?? 0,
      period_start: body.period_start ?? null,
      period_end: body.period_end ?? null,
      status: 'pending',
    })
    .select('id')
    .single()

  if (error || !upload) {
    return NextResponse.json({ error: error?.message ?? 'Не удалось создать upload' }, { status: 500 })
  }

  return NextResponse.json({ upload_id: upload.id })
}
