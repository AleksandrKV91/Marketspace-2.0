import { NextRequest, NextResponse } from 'next/server'
import { parseCatalog } from '@/lib/parsers/parseCatalog'
import { createServiceClient } from '@/lib/supabase/server'
import { chunk } from '@/lib/parsers/utils'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  const supabase = createServiceClient()

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'Файл не передан' }, { status: 400 })

  const buffer = await file.arrayBuffer()

  let parsed
  try {
    parsed = parseCatalog(buffer)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 422 })
  }

  // Создать запись в uploads
  const { data: upload, error: uploadErr } = await supabase
    .from('uploads')
    .insert({
      file_type: 'catalog',
      filename: file.name,
      rows_count: parsed.rows_parsed,
      status: 'ok',
    })
    .select('id')
    .single()

  if (uploadErr) return NextResponse.json({ error: uploadErr.message }, { status: 500 })

  // UPSERT батчами по 500
  for (const batch of chunk(parsed.rows, 500)) {
    const { error } = await supabase
      .from('dim_sku')
      .upsert(batch, { onConflict: 'sku_ms' })
    if (error) {
      await supabase.from('uploads').update({ status: 'error', error_msg: error.message }).eq('id', upload.id)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
  }

  return NextResponse.json({
    ok: true,
    upload_id: upload.id,
    rows_parsed: parsed.rows_parsed,
    rows_skipped: parsed.rows_skipped,
  })
}
