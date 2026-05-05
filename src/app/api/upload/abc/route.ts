import { NextRequest, NextResponse } from 'next/server'
import { parseABC, ABCRow } from '@/lib/parsers/parseABC'
import { createServiceClient } from '@/lib/supabase/server'
import { loadKnownSkus } from '@/lib/supabase/loadKnownSkus'
import { chunk } from '@/lib/parsers/utils'

export const maxDuration = 60

// Aggregate rows sharing the same (sku_ms, product_name) key.
// Different product_name = different size/kit variant → kept as separate rows.
// Only exact (sku_ms + product_name) duplicates are collapsed (rare data artifacts).
function aggregateByVariant(rows: ABCRow[]): ABCRow[] {
  const byKey = new Map<string, { dominant: ABCRow; sums: Partial<ABCRow> }>()

  for (const row of rows) {
    const key = `${row.sku_ms}|${row.product_name ?? ''}`
    const entry = byKey.get(key)
    if (!entry) {
      byKey.set(key, {
        dominant: row,
        sums: {
          qty_stock_rub:  row.qty_stock_rub  ?? 0,
          cost:           row.cost           ?? 0,
          revenue:        row.revenue        ?? 0,
          chmd:           row.chmd           ?? 0,
          ad_spend:       row.ad_spend       ?? 0,
          storage:        row.storage        ?? 0,
          transport:      row.transport      ?? 0,
          chmd_clean:     row.chmd_clean     ?? 0,
          tz:             row.tz             ?? 0,
          qty_cur_month:  row.qty_cur_month  ?? 0,
          qty_prev_month: row.qty_prev_month ?? 0,
        },
      })
      continue
    }
    // Accumulate financials for exact duplicates
    const s = entry.sums
    s.qty_stock_rub  = (s.qty_stock_rub  ?? 0) + (row.qty_stock_rub  ?? 0)
    s.cost           = (s.cost           ?? 0) + (row.cost           ?? 0)
    s.revenue        = (s.revenue        ?? 0) + (row.revenue        ?? 0)
    s.chmd           = (s.chmd           ?? 0) + (row.chmd           ?? 0)
    s.ad_spend       = (s.ad_spend       ?? 0) + (row.ad_spend       ?? 0)
    s.storage        = (s.storage        ?? 0) + (row.storage        ?? 0)
    s.transport      = (s.transport      ?? 0) + (row.transport      ?? 0)
    s.chmd_clean     = (s.chmd_clean     ?? 0) + (row.chmd_clean     ?? 0)
    s.tz             = (s.tz             ?? 0) + (row.tz             ?? 0)
    s.qty_cur_month  = (s.qty_cur_month  ?? 0) + (row.qty_cur_month  ?? 0)
    s.qty_prev_month = (s.qty_prev_month ?? 0) + (row.qty_prev_month ?? 0)
    if ((row.revenue ?? 0) > (entry.dominant.revenue ?? 0)) {
      entry.dominant = row
    }
  }

  return [...byKey.values()].map(({ dominant, sums }) => {
    const rev = sums.revenue ?? 0
    return {
      ...dominant,
      ...sums,
      profitability:  rev > 0 ? (sums.chmd_clean ?? 0) / rev : dominant.profitability,
      revenue_margin: rev > 0 ? (sums.chmd ?? 0) / rev : dominant.revenue_margin,
      chmd_share:     null, // not meaningful after aggregation
    }
  })
}

export async function POST(req: NextRequest) {
  const supabase = createServiceClient()

  let buffer: ArrayBuffer
  let filename = req.nextUrl.searchParams.get('filename') ?? 'abc.xlsx'
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
    parsed = parseABC(buffer, filename)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 422 })
  }

  // Keep size variants separate — group only by exact (sku_ms, product_name)
  const aggregated = aggregateByVariant(parsed.rows)
  const skippedVariants = parsed.rows.length - aggregated.length

  // Update dim_sku name for all SKUs; create stubs for new ones
  const dimUpdates = aggregated
    .filter(r => r.product_name)
    .map(r => ({ sku_ms: r.sku_ms, name: r.product_name! }))
  for (const batch of chunk(dimUpdates, 500)) {
    await supabase.from('dim_sku').upsert(batch, { onConflict: 'sku_ms' })
  }

  // Write subject_wb from «Ниша/Предмет» column into dim_sku
  const nicheUpdates = aggregated
    .filter(r => r.niche)
    .map(r => ({ sku_ms: r.sku_ms, subject_wb: r.niche! }))
  for (const batch of chunk(nicheUpdates, 500)) {
    await supabase.from('dim_sku').upsert(batch, { onConflict: 'sku_ms' })
  }

  // Cascade niche seasonality/month coefficients to SKUs that share the same subject_wb
  if (nicheUpdates.length > 0) {
    await supabase.rpc('refresh_dim_sku_niche_cascade')
  }

  const knownSkus = await loadKnownSkus(supabase)
  const unknownList = aggregated.filter(r => !knownSkus.has(r.sku_ms))

  const { data: upload, error: uploadErr } = await supabase
    .from('uploads')
    .insert({
      file_type: 'abc',
      filename,
      rows_count: aggregated.length,
      period_start: parsed.period_month,
      status: 'ok',
    })
    .select('id')
    .single()

  if (uploadErr) return NextResponse.json({ error: uploadErr.message }, { status: 500 })

  const uploadId = upload.id
  const rowsWithUpload = aggregated.map(r => ({
    ...r,
    upload_id: uploadId,
    variant_name: r.product_name ?? '',
  }))
  for (const batch of chunk(rowsWithUpload, 500)) {
    const { error } = await supabase.from('fact_abc').upsert(batch, { onConflict: 'sku_ms,upload_id,variant_name' })
    if (error) {
      await supabase.from('uploads').update({ status: 'error', error_msg: error.message }).eq('id', uploadId)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
  }

  return NextResponse.json({
    ok: true,
    upload_id: uploadId,
    period_month: parsed.period_month,
    rows_parsed: aggregated.length,
    rows_skipped: parsed.rows_skipped,
    skipped_variants: skippedVariants,
    unknown_skus: unknownList.map(r => r.sku_ms),
  })
}
