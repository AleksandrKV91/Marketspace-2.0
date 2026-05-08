import { NextRequest, NextResponse } from 'next/server'
import { parseSkuReport } from '@/lib/parsers/parseSkuReport'
import { createServiceClient } from '@/lib/supabase/server'
import { chunk } from '@/lib/parsers/utils'
import { invalidatePrefix, invalidate } from '@/lib/cache'

export const maxDuration = 300

// Параллельный upsert с ограничением concurrency.
// Снимает «Connection to the database timed out» — частые сервиальные апсерты
// исчерпывают пул соединений Supabase. С concurrency=4 — 4 одновременных батча,
// каждый ждёт своего соединения, нет долгих ожиданий в одной очереди.
async function parallelUpsert<T>(
  batches: T[][],
  upsertFn: (batch: T[]) => Promise<{ error: { message: string } | null }>,
  concurrency = 4,
): Promise<{ error: string | null }> {
  let firstError: string | null = null
  const queue = batches.slice()
  async function worker() {
    while (queue.length > 0 && !firstError) {
      const batch = queue.shift()
      if (!batch) break
      const { error } = await upsertFn(batch)
      if (error && !firstError) firstError = error.message
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, worker))
  return { error: firstError }
}

export async function POST(req: NextRequest) {
  const supabase = createServiceClient()

  let buffer: ArrayBuffer
  let filename = req.nextUrl.searchParams.get('filename') ?? 'sku-report.xlsb'
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
  // dim_sku остаётся последовательным — нужно завершить перед FK-зависимыми таблицами.
  // Но размер батча увеличиваем до 1000 (Supabase REST лимит).
  for (const batch of chunk(dimUpdates, 1000)) {
    const { error } = await supabase.from('dim_sku').upsert(batch, { onConflict: 'sku_ms' })
    if (error) {
      await supabase.from('uploads').update({ status: 'error', error_msg: error.message }).eq('id', uploadId)
      return NextResponse.json({ error: `dim_sku: ${error.message}` }, { status: 500 })
    }
  }

  // ── 2. fact_sku_daily ──────────────────────────────────────────
  // Это самая большая таблица (60K+ строк). Параллельный upsert critically важен.
  const dedupedDaily = [...new Map(
    parsed.daily.map(r => [`${r.sku_ms}|${r.metric_date}`, r])
  ).values()]

  const dailyBatches = chunk(dedupedDaily.map(r => ({ ...r, upload_id: uploadId })), 1000)
  const dailyRes = await parallelUpsert(
    dailyBatches,
    async (b) => {
      const r = await supabase.from('fact_sku_daily').upsert(b, { onConflict: 'sku_ms,metric_date' })
      return { error: r.error }
    },
    4,
  )
  if (dailyRes.error) {
    await supabase.from('uploads').update({ status: 'error', error_msg: dailyRes.error }).eq('id', uploadId)
    return NextResponse.json({ error: `fact_sku_daily: ${dailyRes.error}` }, { status: 500 })
  }

  // ── 3. fact_sku_period ─────────────────────────────────────────
  const periodBatches = chunk(dedupedPeriod.map(r => ({ ...r, upload_id: uploadId })), 1000)
  const periodRes = await parallelUpsert(
    periodBatches,
    async (b) => {
      const r = await supabase.from('fact_sku_period').upsert(b, { onConflict: 'sku_ms,period_start,period_end' })
      return { error: r.error }
    },
    4,
  )
  if (periodRes.error) {
    await supabase.from('uploads').update({ status: 'error', error_msg: periodRes.error }).eq('id', uploadId)
    return NextResponse.json({ error: `fact_sku_period: ${periodRes.error}` }, { status: 500 })
  }

  // ── 4. fact_price_changes ──────────────────────────────────────
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

  const priceBatches = chunk(dedupedPriceChanges, 1000)
  const priceRes = await parallelUpsert(
    priceBatches,
    async (b) => {
      const r = await supabase.from('fact_price_changes').upsert(b, { onConflict: 'sku_wb,price_date' })
      return { error: r.error }
    },
    4,
  )
  if (priceRes.error) console.error('fact_price_changes upsert error:', priceRes.error)

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
