import { NextRequest, NextResponse } from 'next/server'
import { parseSkuReport } from '@/lib/parsers/parseSkuReport'
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

  // Загружаем маппинг WB→MS из dim_sku (col 0 в Отчёте = WB арт)
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
    .insert({ file_type: 'sku_report', filename, rows_count: parsed.rows_parsed, period_start: dates[0] ?? null, period_end: dates[dates.length - 1] ?? null, status: 'ok' })
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

  const dedupedSnaps = [...new Map(
    parsed.snapshots.map(r => [r.sku_ms, r])
  ).values()]

  const snapsWithUpload = dedupedSnaps.map(r => {
    const snap = { ...r, upload_id: uploadId }
    if (!snap.novelty_status) delete (snap as Record<string, unknown>).novelty_status
    return snap
  })

  for (const batch of chunk(snapsWithUpload, 500)) {
    const { error } = await supabase.from('fact_sku_snapshot').upsert(batch, { onConflict: 'sku_ms,upload_id' })
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
    skipped_no_map: parsed.skipped_skus.length,
    sku_map_size: skuMap.size,
    diag_daily: parsed.daily.slice(0, 2),
    diag_skipped_skus: parsed.skipped_skus,
    diag_service_rows: parsed.diag_service_rows,
    diag_sku_map_sample: [...skuMap.entries()].slice(0, 3).map(([wb, ms]) => ({ wb, ms })),
    diag_421992755: skuMap.get('421992755') ?? 'NOT IN MAP',
    diag_421992756: skuMap.get('421992756') ?? 'NOT IN MAP',
  })
}
