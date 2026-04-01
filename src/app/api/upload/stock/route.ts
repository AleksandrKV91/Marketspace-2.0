import { NextRequest, NextResponse } from 'next/server'
import { parseStock } from '@/lib/parsers/parseStock'
import { createServiceClient } from '@/lib/supabase/server'
import { downloadFromStorage } from '@/lib/supabase/downloadFromStorage'
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

  // Загрузить маппинг sku_wb → sku_ms
  const skuMap = new Map<number, string>()
  let from = 0
  while (true) {
    const { data, error } = await supabase.from('dim_sku').select('sku_wb,sku_ms').not('sku_wb', 'is', null).range(from, from + 999)
    if (error || !data?.length) break
    for (const row of data) { if (row.sku_wb) skuMap.set(row.sku_wb, row.sku_ms) }
    if (data.length < 1000) break
    from += 1000
  }

  let parsed
  try {
    parsed = parseStock(buffer, skuMap)
  } catch (e) {
    return NextResponse.json({ error: String(e), buffer_size: buffer.byteLength }, { status: 422 })
  }

  const { data: upload, error: uploadErr } = await supabase
    .from('uploads')
    .insert({ file_type: 'stock', filename, rows_count: parsed.rows_parsed, status: 'ok' })
    .select('id')
    .single()

  if (uploadErr) return NextResponse.json({ error: uploadErr.message }, { status: 500 })

  const uploadId = upload.id

  // Пишем снапшот только если в файле есть данные об остатках (не все нули)
  // Если файл "обрезанный" (только новые продажи), остатки будут все нули — пропускаем
  const hasStockData = parsed.snapshots.some(r =>
    (r.fbo_wb ?? 0) > 0 || (r.fbs_pushkino ?? 0) > 0 || (r.fbs_smolensk ?? 0) > 0 || (r.total_stock ?? 0) > 0
  )
  const skipSnapshot = !hasStockData

  if (!skipSnapshot) {
    for (const batch of chunk(parsed.snapshots.map(r => ({ ...r, upload_id: uploadId })), 500)) {
      const { error } = await supabase.from('fact_stock_snapshot').upsert(batch, { onConflict: 'sku_wb,upload_id' })
      if (error) {
        await supabase.from('uploads').update({ status: 'error', error_msg: error.message }).eq('id', uploadId)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
    }
  }

  for (const batch of chunk(parsed.daily.map(r => ({ ...r, upload_id: uploadId })), 500)) {
    const { error } = await supabase.from('fact_stock_daily').upsert(batch, { onConflict: 'sku_wb,sale_date', ignoreDuplicates: true })
    if (error) {
      await supabase.from('uploads').update({ status: 'error', error_msg: error.message }).eq('id', uploadId)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
  }

  for (const batch of chunk(parsed.price_changes.map(r => ({ ...r, upload_id: uploadId })), 500)) {
    const { error } = await supabase.from('fact_price_changes').upsert(batch, { onConflict: 'sku_wb,price_date' })
    if (error) {
      await supabase.from('uploads').update({ status: 'error', error_msg: error.message }).eq('id', uploadId)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
  }

  return NextResponse.json({ ok: true, upload_id: uploadId, rows_parsed: parsed.rows_parsed, rows_skipped: parsed.rows_skipped, daily_rows: parsed.daily.length, price_change_rows: parsed.price_changes.length, snapshot_skipped: skipSnapshot })
}
