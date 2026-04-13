/**
 * POST /api/admin/backfill-prices
 * Читает все строки fact_sku_snapshot (snap_date + price + sku_wb)
 * и заполняет fact_price_changes — по одной записи на (sku_wb, snap_date).
 * Безопасно перезапускать: используется upsert с onConflict.
 */
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export const maxDuration = 60

export async function POST() {
  const supabase = createServiceClient()

  // Читаем fact_sku_snapshot постранично
  type SnapRow = { sku_wb: number | null; sku_ms: string | null; snap_date: string; price: number | null }
  const allSnaps: SnapRow[] = []
  let offset = 0
  const pageSize = 1000
  while (true) {
    const { data, error } = await supabase
      .from('fact_sku_snapshot')
      .select('sku_wb, sku_ms, snap_date, price')
      .not('sku_wb', 'is', null)
      .not('price', 'is', null)
      .range(offset, offset + pageSize - 1)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data || data.length === 0) break
    allSnaps.push(...data)
    if (data.length < pageSize) break
    offset += pageSize
  }

  // Дедупликация по (sku_wb, snap_date) — берём последнюю цену
  const dedup = new Map<string, SnapRow>()
  for (const r of allSnaps) {
    if (!r.sku_wb || !r.snap_date || r.price == null) continue
    dedup.set(`${r.sku_wb}|${r.snap_date}`, r)
  }

  const priceRows = [...dedup.values()].map(r => ({
    sku_wb: r.sku_wb!,
    sku_ms: r.sku_ms,
    price_date: r.snap_date,
    price: r.price,
  }))

  // Upsert батчами по 500
  let upserted = 0
  let errors = 0
  for (let i = 0; i < priceRows.length; i += 500) {
    const batch = priceRows.slice(i, i + 500)
    const { error } = await supabase
      .from('fact_price_changes')
      .upsert(batch, { onConflict: 'sku_wb,price_date' })
    if (error) { errors++; console.error(error.message) }
    else upserted += batch.length
  }

  return NextResponse.json({
    ok: true,
    snaps_read: allSnaps.length,
    unique_price_records: priceRows.length,
    upserted,
    errors,
  })
}
