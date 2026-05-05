import { NextRequest, NextResponse } from 'next/server'
import { parseCatalog } from '@/lib/parsers/parseCatalog'
import { createServiceClient } from '@/lib/supabase/server'
import { chunk } from '@/lib/parsers/utils'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  const supabase = createServiceClient()

  let buffer: ArrayBuffer
  let filename = req.nextUrl.searchParams.get('filename') ?? 'catalog.xlsb'
  try {
    const ct = req.headers.get('content-type') ?? ''
    if (ct.includes('application/octet-stream') || ct.includes('application/vnd')) {
      buffer = await req.arrayBuffer()
    } else {
      const form = await req.formData()
      const file = form.get('file') as File | null
      if (!file) return NextResponse.json({ error: 'Файл не передан (поле file)' }, { status: 400 })
      filename = file.name
      buffer = await file.arrayBuffer()
    }
  } catch (e) {
    return NextResponse.json({ error: `Ошибка чтения файла: ${String(e)}` }, { status: 400 })
  }

  let parsed
  try {
    parsed = parseCatalog(buffer)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 422 })
  }

  const { data: upload, error: uploadErr } = await supabase
    .from('uploads')
    .insert({ file_type: 'catalog', filename, rows_count: parsed.rows_parsed, status: 'ok' })
    .select('id')
    .single()

  if (uploadErr) return NextResponse.json({ error: uploadErr.message }, { status: 500 })

  const deduped = [...new Map(parsed.rows.map(r => [r.sku_ms, r])).values()]

  for (const batch of chunk(deduped, 500)) {
    const { error } = await supabase.from('dim_sku').upsert(batch, { onConflict: 'sku_ms' })
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
    sample: parsed.rows.slice(0, 3).map(r => ({ sku_ms: r.sku_ms, sku_wb: r.sku_wb, name: r.name })),
  })
}
