import { NextRequest, NextResponse } from 'next/server'
import { parseSkuReport } from '@/lib/parsers/parseSkuReport'
import { createServiceClient } from '@/lib/supabase/server'
import { chunk } from '@/lib/parsers/utils'
import { invalidatePrefix, invalidate } from '@/lib/cache'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  const supabase = createServiceClient()

  let buffer: ArrayBuffer
  let filename = 'sku-report.xlsb'
  try {
    const form = await req.formData()
    const file = form.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'Файл не передан (поле file)' }, { status: 400 })
    filename = file.name
    buffer = await file.arrayBuffer()
  } catch (e) {
    return NextResponse.json({ error: `Ошибка чтения файла: ${String(e)}` }, { status: 400 })
  }

  // Загружаем маппинг WB→MS из dim_sku
  const skuMap = new Map<string, string>()
  let from = 0
  while (true) {
    const { data, error } = await supabase.from('dim_sku').select('sku_wb,sku_ms').not('sku_wb', 'is', null).range(from, from + 999)
    if (error || !data?.length) break
    for (const row of data) { if (row.sku_wb) skuMap.set(String(row.sku_wb), row.sku_ms) }
    if (data.length < 1000) break
    from += 1000
  }

  let parsed
  try {
    parsed = parseSkuReport(buffer, skuMap.size > 0 ? skuMap : undefined)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 422 })
  }

  const { data: upload, error: uploadErr } = await supabase
    .from('uploads')
    .insert({
      file_type: 'sku_report',
      filename,
      rows_count: parsed.rows_parsed,
      period_start: parsed.period_start,
      period_end: parsed.period_end,
      status: 'ok',
    })
    .select('id')
    .single()

  if (uploadErr) return NextResponse.json({ error: uploadErr.message }, { status: 500 })

  const uploadId = upload.id

  // ── 1. dim_sku enrichment — ПЕРВЫМ, чтобы FK на sku_ms был удовлетворён ──
  const dedupedPeriod = [...new Map(
    parsed.period.map(r => [`${r.sku_ms}|${r.period_start}|${r.period_end}`, r])
  ).values()]

  const dimUpdates = [...new Map(
    dedupedPeriod.map(r => [r.sku_ms, {
      sku_ms: r.sku_ms,
      ...(r.sku_wb != null ? { sku_wb: r.sku_wb } : {}),
      ...(r.product_name ? { name: r.product_name } : {}),
      ...(r.brand ? { brand: r.brand } : {}),
      ...(r.category ? { category_wb: r.category } : {}),
      ...(r.subject_wb ? { subject_wb: r.subject_wb } : {}),
    }])
  ).values()]
  for (const batch of chunk(dimUpdates, 500)) {
    await supabase.from('dim_sku').upsert(batch, { onConflict: 'sku_ms' })
  }

  // ── 2. fact_sku_daily ─────────────────────────────────────────
  const dedupedDaily = [...new Map(
    parsed.daily.map(r => [`${r.sku_ms}|${r.metric_date}`, r])
  ).values()]

  for (const batch of chunk(dedupedDaily.map(r => ({ ...r, upload_id: uploadId })), 500)) {
    const { error } = await supabase.from('fact_sku_daily').upsert(batch, { onConflict: 'sku_ms,metric_date' })
    if (error) {
      await supabase.from('uploads').update({ status: 'error', error_msg: error.message }).eq('id', uploadId)
      return NextResponse.json({ error: `fact_sku_daily: ${error.message}` }, { status: 500 })
    }
  }

  // ── 3. fact_sku_period ────────────────────────────────────────
  for (const batch of chunk(dedupedPeriod.map(r => ({ ...r, upload_id: uploadId })), 500)) {
    const { error } = await supabase.from('fact_sku_period').upsert(batch, { onConflict: 'sku_ms,period_start,period_end' })
    if (error) {
      await supabase.from('uploads').update({ status: 'error', error_msg: error.message }).eq('id', uploadId)
      return NextResponse.json({ error: `fact_sku_period: ${error.message}` }, { status: 500 })
    }
  }

  // ── 4. fact_price_changes ─────────────────────────────────────
  const priceChangeDedup = new Map<string, typeof parsed.priceChanges[0]>()
  for (const r of parsed.priceChanges) {
    priceChangeDedup.set(`${r.sku_wb}|${r.price_date}`, r)
  }
  const dedupedPriceChanges = [...priceChangeDedup.values()].map(r => ({
    sku_wb: r.sku_wb,
    sku_ms: r.sku_ms,
    price_date: r.price_date,
    price: r.price,
    price_before: r.price_before,
    delta_pct: r.delta_pct,
    ctr_change: r.ctr_change,
    cr_change: r.cr_change,
    upload_id: uploadId,
  }))

  for (const batch of chunk(dedupedPriceChanges, 500)) {
    const { error } = await supabase.from('fact_price_changes').upsert(batch, { onConflict: 'sku_wb,price_date' })
    if (error) console.error('fact_price_changes upsert error:', error.message)
  }

  // Инвалидировать серверный кэш — следующие запросы к дашборду получат свежие данные
  invalidatePrefix('overview|')
  invalidate('dim_sku_all')
  invalidate('dim_sku_names')
  invalidate('latest_uploads')

  return NextResponse.json({
    ok: true,
    upload_id: uploadId,
    period_start: parsed.period_start,
    period_end: parsed.period_end,
    rows_parsed: parsed.rows_parsed,
    rows_skipped: parsed.skipped_skus.length,
    daily_rows: dedupedDaily.length,
    period_rows: dedupedPeriod.length,
    price_change_rows: dedupedPriceChanges.length,
    skipped_no_map: parsed.skipped_skus.length,
    sku_map_size: skuMap.size,
    diag_skipped_skus: parsed.skipped_skus.slice(0, 20),
  })
}
