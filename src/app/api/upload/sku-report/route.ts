import { NextRequest, NextResponse } from 'next/server'
import { parseSkuReport } from '@/lib/parsers/parseSkuReport'
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
    parsed = parseSkuReport(buffer)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 422 })
  }

  const dates = [...new Set(parsed.daily.map(d => d.metric_date))].sort()
  const knownSkus = await loadKnownSkus(supabase)

  const { data: upload, error: uploadErr } = await supabase
    .from('uploads')
    .insert({ file_type: 'sku_report', filename, rows_count: parsed.rows_parsed, period_start: dates[0] ?? null, period_end: dates[dates.length - 1] ?? null, status: 'ok' })
    .select('id')
    .single()

  if (uploadErr) return NextResponse.json({ error: uploadErr.message }, { status: 500 })

  const uploadId = upload.id

  const dedupedDaily = [...new Map(
    parsed.daily.filter(r => knownSkus.has(r.sku_ms)).map(r => [`${r.sku_ms}|${r.metric_date}`, r])
  ).values()]

  for (const batch of chunk(dedupedDaily.map(r => ({ ...r, upload_id: uploadId })), 500)) {
    const { error } = await supabase.from('fact_sku_daily').upsert(batch, { onConflict: 'sku_ms,metric_date' })
    if (error) {
      await supabase.from('uploads').update({ status: 'error', error_msg: error.message }).eq('id', uploadId)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
  }

  const dedupedSnaps = [...new Map(
    parsed.snapshots.filter(r => knownSkus.has(r.sku_ms)).map(r => [r.sku_ms, r])
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

  return NextResponse.json({ ok: true, upload_id: uploadId, rows_parsed: parsed.rows_parsed, rows_skipped: parsed.rows_skipped, diag: parsed.daily[0] ?? null })
}
