import { NextRequest, NextResponse } from 'next/server'
import { parseChina, type ParseChinaResult, type ChinaRow } from '@/lib/parsers/parseChina'
import { createServiceClient } from '@/lib/supabase/server'
import { loadKnownSkus } from '@/lib/supabase/loadKnownSkus'
import { fetchAll } from '@/lib/supabase/fetchAll'
import { chunk } from '@/lib/parsers/utils'

export const maxDuration = 300

export async function POST(req: NextRequest) {
  const supabase = createServiceClient()
  const filename = req.nextUrl.searchParams.get('filename') ?? 'china.xlsx'
  const ct = req.headers.get('content-type') ?? ''

  let parsed: ParseChinaResult

  if (ct.includes('application/json')) {
    try {
      const body = await req.json()
      if (!body.parsed) return NextResponse.json({ error: 'Поле parsed отсутствует в JSON' }, { status: 400 })
      parsed = body.parsed as ParseChinaResult
    } catch (e) {
      return NextResponse.json({ error: `Ошибка чтения JSON: ${String(e)}` }, { status: 400 })
    }
  } else {
    let buffer: ArrayBuffer
    const storageKey = req.nextUrl.searchParams.get('storageKey')
    try {
      if (storageKey) {
        const { data, error } = await supabase.storage.from('uploads').download(storageKey)
        if (error) return NextResponse.json({ error: `Хранилище: ${error.message}` }, { status: 500 })
        buffer = await data.arrayBuffer()
      } else if (ct.includes('application/octet-stream') || ct.includes('application/vnd')) {
        buffer = await req.arrayBuffer()
      } else {
        const form = await req.formData()
        const file = form.get('file') as File | null
        if (!file) return NextResponse.json({ error: 'Файл не передан' }, { status: 400 })
        buffer = await file.arrayBuffer()
      }
    } catch (e) {
      return NextResponse.json({ error: `Ошибка чтения файла: ${String(e)}` }, { status: 400 })
    }

    try {
      parsed = parseChina(buffer)
    } catch (e) {
      return NextResponse.json({ error: String(e) }, { status: 422 })
    }
  }

  // ── Enrich dim_sku из листа «номен» ───────────────────────────────────────
  if (parsed.nomen?.length) {
    const dimEnrich = parsed.nomen
      .filter(n => n.sku_ms)
      .map(n => {
        const row: Record<string, unknown> = { sku_ms: n.sku_ms }
        if (n.sku_wb      != null) row.sku_wb      = n.sku_wb
        if (n.brand)               row.brand        = n.brand
        if (n.name)                row.name         = n.name
        if (n.seasonality)         row.seasonality  = n.seasonality
        if (n.country)             row.country      = n.country
        return row
      })
      .filter(r => Object.keys(r).length > 1)
    for (const batch of chunk(dimEnrich, 1000)) {
      await supabase.from('dim_sku').upsert(batch, { onConflict: 'sku_ms' })
    }
  }

  // ── Enrich dim_sku из главного листа «свод» по sku_wb (если в файле он есть) ─
  // Иногда «Потребность Китай» содержит свежие WB-артикулы которых ещё нет в Своде.
  // Записываем их сразу, чтобы потом sku_ms ↔ sku_wb matching работал.
  const svodSkuWbEnrich = parsed.rows
    .filter(r => r.sku_ms && r.sku_wb != null)
    .map(r => ({ sku_ms: r.sku_ms, sku_wb: r.sku_wb }))
  if (svodSkuWbEnrich.length > 0) {
    const dedupedEnrich = [...new Map(svodSkuWbEnrich.map(r => [r.sku_ms, r])).values()]
    for (const batch of chunk(dedupedEnrich, 1000)) {
      await supabase.from('dim_sku').upsert(batch, { onConflict: 'sku_ms' })
    }
  }

  // ── Resolve sku_ms через sku_wb (Свод) ────────────────────────────────────
  // Файл «Потребность Китай» может содержать sku_ms в формате не совпадающем
  // с dim_sku (лишние пробелы, регистр, варианты CLASSMARK_).
  // Стратегия: если direct match по sku_ms не найден — берём sku_wb из колонки A
  // и ищем правильный sku_ms через dim_sku.sku_wb → dim_sku.sku_ms.
  const knownSkus = await loadKnownSkus(supabase)
  const dimWbToMs = new Map<number, string>()
  try {
    const dimRows = await fetchAll<{ sku_wb: number | null; sku_ms: string }>(
      (sb) => sb.from('dim_sku').select('sku_wb, sku_ms').not('sku_wb', 'is', null),
      supabase,
    )
    for (const r of dimRows) {
      if (r.sku_wb != null && r.sku_ms) dimWbToMs.set(r.sku_wb, r.sku_ms)
    }
  } catch (e) {
    console.warn('china upload: failed to load dim_sku wb-map for resolve', e)
  }

  const deduped = [...new Map(parsed.rows.map(r => [r.sku_ms, r])).values()]

  const resolved: ChinaRow[] = []
  let resolvedViaWb = 0
  let totallyUnknown = 0
  const unknownList: Array<{ sku_ms: string; sku_wb: number | null }> = []

  for (const r of deduped) {
    if (knownSkus.has(r.sku_ms)) {
      resolved.push(r)
      continue
    }
    // Не нашли по sku_ms — пробуем по sku_wb из колонки A
    if (r.sku_wb != null && dimWbToMs.has(r.sku_wb)) {
      const correctSkuMs = dimWbToMs.get(r.sku_wb)!
      resolved.push({ ...r, sku_ms: correctSkuMs })
      resolvedViaWb++
      continue
    }
    // SKU полностью неизвестен (ни sku_ms, ни sku_wb не найдены)
    totallyUnknown++
    if (unknownList.length < 30) unknownList.push({ sku_ms: r.sku_ms, sku_wb: r.sku_wb })
  }

  // После resolve дедуплицируем повторно (могли появиться дубли с одинаковым resolved sku_ms)
  const final = [...new Map(resolved.map(r => [r.sku_ms, r])).values()]

  const { data: upload, error: uploadErr } = await supabase
    .from('uploads')
    .insert({ file_type: 'china', filename, rows_count: final.length, status: 'ok' })
    .select('id')
    .single()

  if (uploadErr) return NextResponse.json({ error: uploadErr.message }, { status: 500 })

  const uploadId = upload.id

  // fact_china_supply не содержит колонку sku_wb — удаляем перед upsert.
  const rowsWithUpload = final.map(r => {
    const { sku_wb: _omit, ...rest } = r
    void _omit
    return { ...rest, upload_id: uploadId }
  })
  for (const batch of chunk(rowsWithUpload, 1000)) {
    const { error } = await supabase.from('fact_china_supply').upsert(batch, { onConflict: 'sku_ms,upload_id' })
    if (error) {
      await supabase.from('uploads').update({ status: 'error', error_msg: error.message }).eq('id', uploadId)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
  }

  return NextResponse.json({
    ok: true,
    upload_id: uploadId,
    rows_parsed: final.length,
    rows_skipped: parsed.rows_skipped + (deduped.length - final.length),
    diag: {
      total_from_file: parsed.rows.length,
      after_dedup: deduped.length,
      direct_match: deduped.length - resolvedViaWb - totallyUnknown,
      resolved_via_sku_wb: resolvedViaWb,
      totally_unknown: totallyUnknown,
      unknown_sample: unknownList,
    },
  })
}
