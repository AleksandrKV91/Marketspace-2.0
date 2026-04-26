import { NextRequest, NextResponse } from 'next/server'
import { parseAnalytics } from '@/lib/parsers/parseAnalytics'
import { createServiceClient } from '@/lib/supabase/server'
import { downloadFromStorage } from '@/lib/supabase/downloadFromStorage'
import { loadKnownSkus } from '@/lib/supabase/loadKnownSkus'
import { chunk } from '@/lib/parsers/utils'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  const supabase = createServiceClient()
  const { storageKey, filename } = await req.json()
  if (!storageKey) return NextResponse.json({ error: 'storageKey не передан' }, { status: 400 })

  let buffer: ArrayBuffer
  try {
    buffer = await downloadFromStorage(supabase, storageKey)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }

  let parsed
  try {
    parsed = parseAnalytics(buffer, filename ?? '')
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 422 })
  }

  // Deduplicate by sku_ms (keep last occurrence)
  const deduped = [...new Map(parsed.rows.map(r => [r.sku_ms, r])).values()]

  const knownSkus = await loadKnownSkus(supabase)

  const knownRows = deduped.filter(r => knownSkus.has(r.sku_ms))
  const unknownRows = deduped.filter(r => !knownSkus.has(r.sku_ms))
  const unknownSkusList = unknownRows.map(r => r.sku_ms)

  // Create dim_sku stubs for unknown SKUs so the FK constraint is satisfied
  if (unknownRows.length > 0) {
    const stubs = unknownRows.map(r => ({
      sku_ms: r.sku_ms,
      name: r.name ?? r.sku_ms,
    }))
    for (const batch of chunk(stubs, 500)) {
      await supabase
        .from('dim_sku')
        .upsert(batch, { onConflict: 'sku_ms', ignoreDuplicates: true })
    }
  }

  // All rows (known + newly-stubbed) go into analytics
  const allRows = deduped

  // Record the upload
  const { data: upload, error: uploadErr } = await supabase
    .from('uploads')
    .insert({
      file_type: 'analytics',
      filename,
      rows_count: allRows.length,
      status: 'ok',
    })
    .select('id')
    .single()

  if (uploadErr) return NextResponse.json({ error: uploadErr.message }, { status: 500 })

  const uploadId = upload.id

  // Upsert into fact_analytics (overwrite mode — conflict on sku_ms only)
  for (const batch of chunk(allRows, 500)) {
    const payload = batch.map(({ unknown_skus: _omit, ...r }) => ({
      ...r,
      upload_id: uploadId,
      uploaded_at: new Date().toISOString(),
    }))
    const { error } = await supabase
      .from('fact_analytics')
      .upsert(payload, { onConflict: 'sku_ms' })
    if (error) {
      await supabase
        .from('uploads')
        .update({ status: 'error', error_msg: error.message })
        .eq('id', uploadId)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
  }

  return NextResponse.json({
    ok: true,
    upload_id: uploadId,
    rows_parsed: parsed.rows_parsed,
    rows_skipped: parsed.rows_skipped + (deduped.length - allRows.length),
    unknown_skus: unknownSkusList,
  })
}
