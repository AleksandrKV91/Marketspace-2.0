import { NextRequest, NextResponse } from 'next/server'
import { parseABC, ABCRow } from '@/lib/parsers/parseABC'
import { createServiceClient } from '@/lib/supabase/server'
import { loadKnownSkus } from '@/lib/supabase/loadKnownSkus'
import { chunk } from '@/lib/parsers/utils'

export const maxDuration = 60

// Aggregate rows sharing the same sku_ms: sum financials, take classes from highest-revenue row.
// The ABC file contains multiple rows per sku_ms (size variants, e.g. S/M/L of same article).
function aggregateBySkuMs(rows: ABCRow[]): ABCRow[] {
  const byMs = new Map<string, { dominant: ABCRow; sums: Partial<ABCRow> }>()

  for (const row of rows) {
    const entry = byMs.get(row.sku_ms)
    if (!entry) {
      byMs.set(row.sku_ms, {
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
    // Accumulate financials
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
    // Keep classes from the row with highest revenue (most representative variant)
    if ((row.revenue ?? 0) > (entry.dominant.revenue ?? 0)) {
      entry.dominant = row
    }
  }

  return [...byMs.values()].map(({ dominant, sums }) => {
    const rev = sums.revenue ?? 0
    return {
      ...dominant,
      ...sums,
      // Re-derive ratio fields from aggregated sums
      profitability:   rev > 0 ? (sums.chmd_clean ?? 0) / rev : dominant.profitability,
      revenue_margin:  rev > 0 ? (sums.chmd ?? 0) / rev : dominant.revenue_margin,
      chmd_share:      null, // not meaningful after aggregation
    }
  })
}

export async function POST(req: NextRequest) {
  const supabase = createServiceClient()

  let buffer: ArrayBuffer
  let filename = 'abc.xlsx'
  try {
    const form = await req.formData()
    const file = form.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'Файл не передан (поле file)' }, { status: 400 })
    filename = file.name
    buffer = await file.arrayBuffer()
  } catch (e) {
    return NextResponse.json({ error: `Ошибка чтения файла: ${String(e)}` }, { status: 400 })
  }

  let parsed
  try {
    parsed = parseABC(buffer, filename)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 422 })
  }

  // Aggregate size variants sharing the same sku_ms
  const aggregated = aggregateBySkuMs(parsed.rows)
  const skippedVariants = parsed.rows.length - aggregated.length

  // Upsert dim_sku: create stubs for new SKUs, update name for all
  const dimUpdates = aggregated
    .filter(r => r.product_name)
    .map(r => ({ sku_ms: r.sku_ms, name: r.product_name! }))
  for (const batch of chunk(dimUpdates, 500)) {
    await supabase.from('dim_sku').upsert(batch, { onConflict: 'sku_ms' })
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
  const rowsWithUpload = aggregated.map(r => ({ ...r, upload_id: uploadId }))
  for (const batch of chunk(rowsWithUpload, 500)) {
    const { error } = await supabase.from('fact_abc').upsert(batch, { onConflict: 'sku_ms,upload_id' })
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
