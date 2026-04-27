import { NextRequest, NextResponse } from 'next/server'
import { parseAnalytics } from '@/lib/parsers/parseAnalytics'
import { createServiceClient } from '@/lib/supabase/server'
import { loadKnownSkus } from '@/lib/supabase/loadKnownSkus'
import { chunk } from '@/lib/parsers/utils'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  const supabase = createServiceClient()

  let buffer: ArrayBuffer
  let filename = 'analytics.xlsx'
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
    parsed = parseAnalytics(buffer, filename)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 422 })
  }

  // Deduplicate by sku_ms (keep last occurrence)
  const deduped = [...new Map(parsed.rows.map(r => [r.sku_ms, r])).values()]

  const knownSkus = await loadKnownSkus(supabase)

  const unknownRows = deduped.filter(r => !knownSkus.has(r.sku_ms))
  const unknownSkusList = unknownRows.map(r => r.sku_ms)

  // Create dim_sku stubs for unknown SKUs so the FK constraint is satisfied
  if (unknownRows.length > 0) {
    const stubs = unknownRows.map(r => ({
      sku_ms: r.sku_ms,
      name: (r as unknown as Record<string, unknown>)['name'] as string ?? r.sku_ms,
    }))
    for (const batch of chunk(stubs, 500)) {
      await supabase
        .from('dim_sku')
        .upsert(batch, { onConflict: 'sku_ms', ignoreDuplicates: true })
    }
  }

  // Record the upload
  const { data: upload, error: uploadErr } = await supabase
    .from('uploads')
    .insert({
      file_type: 'analytics',
      filename,
      rows_count: deduped.length,
      status: 'ok',
    })
    .select('id')
    .single()

  if (uploadErr) return NextResponse.json({ error: uploadErr.message }, { status: 500 })

  const uploadId = upload.id

  // Upsert into fact_analytics (overwrite mode — conflict on sku_ms only)
  for (const batch of chunk(deduped, 500)) {
    const payload = batch.map(r => {
      const { unknown_skus: _drop, ...rest } = r as typeof r & { unknown_skus?: unknown }
      void _drop
      return {
        ...rest,
        upload_id: uploadId,
        uploaded_at: new Date().toISOString(),
      }
    })
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
    rows_skipped: parsed.rows_skipped,
    unknown_skus: unknownSkusList,
  })
}
