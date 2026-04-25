import { NextRequest, NextResponse } from 'next/server'
import { parseABC } from '@/lib/parsers/parseABC'
import { createServiceClient } from '@/lib/supabase/server'
import { loadKnownSkus } from '@/lib/supabase/loadKnownSkus'
import { chunk } from '@/lib/parsers/utils'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  const supabase = createServiceClient()

  let buffer: ArrayBuffer
  let filename = 'abc.xlsx'
  try {
    const form = await req.formData()
    const file = form.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'Файл не передан (поле file)' }, { status: 400 })
    filename = file.name
    buffer = await file.arrayBuffer()
  } catch (e) {
    return NextResponse.json({ error: `Ошибка чтения файла: ${String(e)}` }, { status: 400 })
  }

  let parsed
  try {
    parsed = parseABC(buffer, filename)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 422 })
  }

  const knownSkus = await loadKnownSkus(supabase)
  const deduped = [...new Map(parsed.rows.map(r => [r.sku_ms, r])).values()]
  const filtered = deduped.filter(r => knownSkus.has(r.sku_ms))

  const { data: upload, error: uploadErr } = await supabase
    .from('uploads')
    .insert({ file_type: 'abc', filename, rows_count: filtered.length, period_start: parsed.period_month, status: 'ok' })
    .select('id')
    .single()

  if (uploadErr) return NextResponse.json({ error: uploadErr.message }, { status: 500 })

  const uploadId = upload.id
  const rowsWithUpload = filtered.map(r => ({ ...r, upload_id: uploadId }))
  for (const batch of chunk(rowsWithUpload, 500)) {
    const { error } = await supabase.from('fact_abc').upsert(batch, { onConflict: 'sku_ms,upload_id' })
    if (error) {
      await supabase.from('uploads').update({ status: 'error', error_msg: error.message }).eq('id', uploadId)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
  }

  return NextResponse.json({
    ok: true,
    upload_id: uploadId,
    period_month: parsed.period_month,
    rows_parsed: filtered.length,
    rows_skipped: parsed.rows_skipped + (deduped.length - filtered.length),
    sample: filtered.slice(0, 2).map(r => ({ sku_ms: r.sku_ms, abc_class: r.abc_class })),
  })
}
