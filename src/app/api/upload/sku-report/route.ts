import { NextRequest, NextResponse } from 'next/server'
import { parseSkuReport } from '@/lib/parsers/parseSkuReport'
import { createServiceClient } from '@/lib/supabase/server'
import { chunk } from '@/lib/parsers/utils'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  const supabase = createServiceClient()

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'Файл не передан' }, { status: 400 })

  const buffer = await file.arrayBuffer()

  let parsed
  try {
    parsed = parseSkuReport(buffer)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 422 })
  }

  // Определить period_start/end из датированных метрик
  const dates = [...new Set(parsed.daily.map(d => d.metric_date))].sort()
  const periodStart = dates[0] ?? null
  const periodEnd = dates[dates.length - 1] ?? null

  const { data: upload, error: uploadErr } = await supabase
    .from('uploads')
    .insert({
      file_type: 'sku_report',
      filename: file.name,
      rows_count: parsed.rows_parsed,
      period_start: periodStart,
      period_end: periodEnd,
      status: 'ok',
    })
    .select('id')
    .single()

  if (uploadErr) return NextResponse.json({ error: uploadErr.message }, { status: 500 })

  const uploadId = upload.id

  // UPSERT fact_sku_daily
  const dedupedDaily = [...new Map(parsed.daily.map(r => [`${r.sku_ms}|${r.metric_date}`, r])).values()]
  const dailyWithUpload = dedupedDaily.map(r => ({ ...r, upload_id: uploadId }))
  for (const batch of chunk(dailyWithUpload, 500)) {
    const { error } = await supabase
      .from('fact_sku_daily')
      .upsert(batch, { onConflict: 'sku_ms,metric_date' })
    if (error) {
      await supabase.from('uploads').update({ status: 'error', error_msg: error.message }).eq('id', uploadId)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
  }

  // UPSERT fact_sku_snapshot (не затираем novelty_status если новое значение пустое)
  const dedupedSnaps = [...new Map(parsed.snapshots.map(r => [r.sku_ms, r])).values()]
  const snapshotsWithUpload = dedupedSnaps.map(r => {
    const snap = { ...r, upload_id: uploadId }
    if (!snap.novelty_status) delete (snap as Record<string, unknown>).novelty_status
    return snap
  })
  for (const batch of chunk(snapshotsWithUpload, 500)) {
    const { error } = await supabase
      .from('fact_sku_snapshot')
      .upsert(batch, { onConflict: 'sku_ms,upload_id' })
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
    skipped_skus: parsed.skipped_skus,
    diag: parsed.daily[0] ?? null,
  })
}
