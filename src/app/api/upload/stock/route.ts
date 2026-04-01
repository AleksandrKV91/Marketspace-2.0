import { NextRequest, NextResponse } from 'next/server'
import { parseStock } from '@/lib/parsers/parseStock'
import { createServiceClient } from '@/lib/supabase/server'
import { chunk } from '@/lib/parsers/utils'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  const supabase = createServiceClient()

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'Файл не передан' }, { status: 400 })

  const buffer = await file.arrayBuffer()

  // Загрузить маппинг sku_wb → sku_ms из dim_sku
  const skuMap = new Map<number, string>()
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from('dim_sku')
      .select('sku_wb,sku_ms')
      .not('sku_wb', 'is', null)
      .range(from, from + 999)
    if (error || !data?.length) break
    for (const row of data) {
      if (row.sku_wb) skuMap.set(row.sku_wb, row.sku_ms)
    }
    if (data.length < 1000) break
    from += 1000
  }

  let parsed
  try {
    parsed = parseStock(buffer, skuMap)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 422 })
  }

  const { data: upload, error: uploadErr } = await supabase
    .from('uploads')
    .insert({
      file_type: 'stock',
      filename: file.name,
      rows_count: parsed.rows_parsed,
      status: 'ok',
    })
    .select('id')
    .single()

  if (uploadErr) return NextResponse.json({ error: uploadErr.message }, { status: 500 })

  const uploadId = upload.id

  // UPSERT fact_stock_snapshot
  const snapsWithUpload = parsed.snapshots.map(r => ({ ...r, upload_id: uploadId }))
  for (const batch of chunk(snapsWithUpload, 500)) {
    const { error } = await supabase
      .from('fact_stock_snapshot')
      .upsert(batch, { onConflict: 'sku_wb,upload_id' })
    if (error) {
      await supabase.from('uploads').update({ status: 'error', error_msg: error.message }).eq('id', uploadId)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
  }

  // UPSERT fact_stock_daily (только новые даты)
  const dailyWithUpload = parsed.daily.map(r => ({ ...r, upload_id: uploadId }))
  for (const batch of chunk(dailyWithUpload, 500)) {
    const { error } = await supabase
      .from('fact_stock_daily')
      .upsert(batch, { onConflict: 'sku_wb,sale_date', ignoreDuplicates: true })
    if (error) {
      await supabase.from('uploads').update({ status: 'error', error_msg: error.message }).eq('id', uploadId)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
  }

  // UPSERT fact_price_changes
  const priceWithUpload = parsed.price_changes.map(r => ({ ...r, upload_id: uploadId }))
  for (const batch of chunk(priceWithUpload, 500)) {
    const { error } = await supabase
      .from('fact_price_changes')
      .upsert(batch, { onConflict: 'sku_wb,price_date' })
    if (error) {
      await supabase.from('uploads').update({ status: 'error', error_msg: error.message }).eq('id', uploadId)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
  }

  return NextResponse.json({
    ok: true,
    upload_id: uploadId,
    rows_parsed: parsed.rows_parsed,
    rows_skipped: parsed.rows_skipped,
    daily_rows: parsed.daily.length,
    price_change_rows: parsed.price_changes.length,
  })
}
