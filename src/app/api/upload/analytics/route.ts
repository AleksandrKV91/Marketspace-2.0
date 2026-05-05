import { NextRequest, NextResponse } from 'next/server'
import { parseAnalytics } from '@/lib/parsers/parseAnalytics'
import { createServiceClient } from '@/lib/supabase/server'
import { loadKnownSkus } from '@/lib/supabase/loadKnownSkus'
import { chunk } from '@/lib/parsers/utils'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  const supabase = createServiceClient()

  let buffer: ArrayBuffer
  let filename = req.nextUrl.searchParams.get('filename') ?? 'analytics.xlsx'
  const storageKey = req.nextUrl.searchParams.get('storageKey')
  try {
    if (storageKey) {
      const { data, error } = await supabase.storage.from('uploads').download(storageKey)
      if (error) return NextResponse.json({ error: `Хранилище: ${error.message}` }, { status: 500 })
      buffer = await data.arrayBuffer()
    } else {
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
    }
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

  // dim_sku enrichment from analytics: upsert non-null fields for ALL SKUs
  // (creates stubs for new ones, fills missing fields for existing).
  // Null fields are stripped so we never overwrite good data from Свод with null.
  const dimEnrich = deduped
    .filter(r => r.sku_ms)
    .map(r => {
      const row: Record<string, unknown> = { sku_ms: r.sku_ms }
      if (r.sku_wb     != null) row.sku_wb      = r.sku_wb
      if (r.name)               row.name        = r.name
      if (r.brand)              row.brand       = r.brand
      if (r.category)           row.category_wb = r.category
      if (r.supplier)           row.supplier    = r.supplier
      if (r.country)            row.country     = r.country
      if (r.buyout_pct != null) row.buyout_pct  = r.buyout_pct
      if (r.rating     != null) row.avg_rating  = r.rating
      return row
    })
    .filter(r => Object.keys(r).length > 1)
  for (const batch of chunk(dimEnrich, 500)) {
    await supabase.from('dim_sku').upsert(batch, { onConflict: 'sku_ms' })
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
