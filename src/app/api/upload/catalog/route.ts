import { NextRequest, NextResponse } from 'next/server'
import { parseCatalog, type ParseCatalogResult } from '@/lib/parsers/parseCatalog'
import { createServiceClient } from '@/lib/supabase/server'
import { chunk } from '@/lib/parsers/utils'

export const maxDuration = 300

export async function POST(req: NextRequest) {
  const supabase = createServiceClient()
  const filename = req.nextUrl.searchParams.get('filename') ?? 'catalog.xlsb'
  const ct = req.headers.get('content-type') ?? ''

  let parsed: ParseCatalogResult

  if (ct.includes('application/json')) {
    try {
      const body = await req.json()
      if (!body.parsed) return NextResponse.json({ error: 'Поле parsed отсутствует в JSON' }, { status: 400 })
      parsed = body.parsed as ParseCatalogResult
    } catch (e) {
      return NextResponse.json({ error: `Ошибка чтения JSON: ${String(e)}` }, { status: 400 })
    }
  } else {
    let buffer: ArrayBuffer
    const storageKey = req.nextUrl.searchParams.get('storageKey')
    try {
      if (storageKey) {
        const { data, error } = await supabase.storage.from('uploads').download(storageKey)
        if (error) return NextResponse.json({ error: `Хранилище: ${error.message}` }, { status: 500 })
        buffer = await data.arrayBuffer()
      } else if (ct.includes('application/octet-stream') || ct.includes('application/vnd')) {
        buffer = await req.arrayBuffer()
      } else {
        const form = await req.formData()
        const file = form.get('file') as File | null
        if (!file) return NextResponse.json({ error: 'Файл не передан' }, { status: 400 })
        buffer = await file.arrayBuffer()
      }
    } catch (e) {
      return NextResponse.json({ error: `Ошибка чтения файла: ${String(e)}` }, { status: 400 })
    }

    try {
      parsed = parseCatalog(buffer)
    } catch (e) {
      return NextResponse.json({ error: String(e) }, { status: 422 })
    }
  }

  const { data: upload, error: uploadErr } = await supabase
    .from('uploads')
    .insert({ file_type: 'catalog', filename, rows_count: parsed.rows_parsed, status: 'ok' })
    .select('id')
    .single()

  if (uploadErr) return NextResponse.json({ error: uploadErr.message }, { status: 500 })

  const deduped = [...new Map(parsed.rows.map(r => [r.sku_ms, r])).values()]

  for (const batch of chunk(deduped, 1000)) {
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
