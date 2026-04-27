import { NextRequest, NextResponse } from 'next/server'
import { parseSkuReport } from '@/lib/parsers/parseSkuReport'
import { createServiceClient } from '@/lib/supabase/server'
import { chunk } from '@/lib/parsers/utils'

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

  const dates = [...new Set(parsed.daily.map(d => d.metric_date))].sort()

  const { data: upload, error: uploadErr } = await supabase
    .from('uploads')
    .insert({
      file_type: 'sku_report',
      filename,
      rows_count: parsed.rows_parsed,
      period_start: dates[0] ?? null,
      period_end: dates[dates.length - 1] ?? null,
      status: 'ok',
    })
    .select('id')
    .single()

  if (uploadErr) return NextResponse.json({ error: uploadErr.message }, { status: 500 })

  const uploadId = upload.id

  const dedupedDaily = [...new Map(
    parsed.daily.map(r => [`${r.sku_ms}|${r.metric_date}`, r])
  ).values()]

  for (const batch of chunk(dedupedDaily.map(r => ({ ...r, upload_id: uploadId })), 500)) {
    const { error } = await supabase.from('fact_sku_daily').upsert(batch, { onConflict: 'sku_ms,metric_date' })
    if (error) {
      await supabase.from('uploads').update({ status: 'error', error_msg: error.message }).eq('id', uploadId)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
  }

  // Изменения цен
  const priceChangeDedup = new Map<string, typeof parsed.priceChanges[0]>()
  for (const r of parsed.priceChanges) {
    priceChangeDedup.set(`${r.sku_wb}|${r.price_date}`, r)
  }
  const dedupedPriceChanges = [...priceChangeDedup.values()].map(r => ({
    sku_wb: r.sku_wb!,
    sku_ms: r.sku_ms,
    price_date: r.price_date,
    price: r.price,
    delta_pct: r.delta_pct,
  }))

  for (const batch of chunk(dedupedPriceChanges, 500)) {
    const { error } = await supabase.from('fact_price_changes').upsert(batch, { onConflict: 'sku_wb,price_date' })
    if (error) console.error('fact_price_changes upsert error:', error.message)
  }

  // Пересчитываем daily_agg_sku → fact_daily_agg (fire-and-forget)
  const aggFrom = dates[0] ?? null
  const aggTo = dates[dates.length - 1] ?? null
  if (aggFrom && aggTo) {
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
    fetch(`${baseUrl}/api/admin/refresh-daily-agg-sku`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: aggFrom, to: aggTo }),
    }).catch(e => console.error('refresh-daily-agg-sku error:', e))
  }

  return NextResponse.json({
    ok: true,
    upload_id: uploadId,
    rows_parsed: parsed.rows_parsed,
    rows_skipped: parsed.skipped_skus.length,
    daily_rows: dedupedDaily.length,
    price_change_rows: dedupedPriceChanges.length,
    skipped_no_map: parsed.skipped_skus.length,
    sku_map_size: skuMap.size,
    diag_daily: parsed.daily.slice(0, 2),
    diag_price_changes: parsed.priceChanges.slice(0, 5),
    diag_skipped_skus: parsed.skipped_skus,
    diag_service_rows: parsed.diag_service_rows,
    diag_sku_map_sample: [...skuMap.entries()].slice(0, 3).map(([wb, ms]) => ({ wb, ms })),
    diag_blocks: parsed.diag_blocks,
  })
}
