import { NextRequest, NextResponse } from 'next/server'
import { parseChina } from '@/lib/parsers/parseChina'
import { createServiceClient } from '@/lib/supabase/server'
import { loadKnownSkus } from '@/lib/supabase/loadKnownSkus'
import { chunk } from '@/lib/parsers/utils'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  const supabase = createServiceClient()

  let buffer: ArrayBuffer
  let filename = 'china.xlsx'
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
    parsed = parseChina(buffer)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 422 })
  }

  // Enrich dim_sku from «номен» sheet — master reference for brand/country/seasonality/name
  if (parsed.nomen?.length) {
    const dimEnrich = parsed.nomen
      .filter(n => n.sku_ms)
      .map(n => {
        const row: Record<string, unknown> = { sku_ms: n.sku_ms }
        if (n.sku_wb      != null) row.sku_wb      = n.sku_wb
        if (n.brand)               row.brand        = n.brand
        if (n.name)                row.name         = n.name
        if (n.seasonality)         row.seasonality  = n.seasonality
        if (n.country)             row.country      = n.country
        return row
      })
      .filter(r => Object.keys(r).length > 1)
    for (const batch of chunk(dimEnrich, 500)) {
      await supabase.from('dim_sku').upsert(batch, { onConflict: 'sku_ms' })
    }
  }

  const knownSkus = await loadKnownSkus(supabase)
  const deduped = [...new Map(parsed.rows.map(r => [r.sku_ms, r])).values()]
  const filtered = deduped.filter(r => knownSkus.has(r.sku_ms))

  const { data: upload, error: uploadErr } = await supabase
    .from('uploads')
    .insert({ file_type: 'china', filename, rows_count: filtered.length, status: 'ok' })
    .select('id')
    .single()

  if (uploadErr) return NextResponse.json({ error: uploadErr.message }, { status: 500 })

  const uploadId = upload.id
  const rowsWithUpload = filtered.map(r => ({ ...r, upload_id: uploadId }))
  for (const batch of chunk(rowsWithUpload, 500)) {
    const { error } = await supabase.from('fact_china_supply').upsert(batch, { onConflict: 'sku_ms,upload_id' })
    if (error) {
      await supabase.from('uploads').update({ status: 'error', error_msg: error.message }).eq('id', uploadId)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
  }

  return NextResponse.json({
    ok: true,
    upload_id: uploadId,
    rows_parsed: filtered.length,
    rows_skipped: parsed.rows_skipped + (deduped.length - filtered.length),
  })
}
