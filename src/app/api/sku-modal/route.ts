import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export const maxDuration = 30

export async function GET(req: NextRequest) {
  const skuMs = req.nextUrl.searchParams.get('sku_ms')
  if (!skuMs) return NextResponse.json({ error: 'sku_ms required' }, { status: 400 })

  const supabase = createServiceClient()

  const getLatestUploadId = async (fileType: string) => {
    const { data } = await supabase.from('uploads').select('id')
      .eq('file_type', fileType).eq('status', 'ok')
      .order('uploaded_at', { ascending: false }).limit(1)
    return data?.[0]?.id ?? null
  }

  const abcUploadId = await getLatestUploadId('abc')

  // Базовая инфо о SKU
  const { data: dim } = await supabase.from('dim_sku')
    .select('sku_ms, sku_wb, name, brand, category_wb, subject_wb, supplier')
    .eq('sku_ms', skuMs).single()

  // Снапшот из fact_sku_daily (последняя snap_date для этого SKU)
  const { data: snapRows } = await supabase.from('fact_sku_daily')
    .select('snap_date, fbo_wb, fbs_pushkino, fbs_smolensk, kits_stock, stock_days, margin_pct, chmd_5d, price, supply_date, supply_qty, days_to_arrival, manager, novelty_status, ots_reserve_days')
    .eq('sku_ms', skuMs)
    .not('snap_date', 'is', null)
    .order('snap_date', { ascending: false })
    .limit(1)
  const snap = snapRows?.[0] ?? null

  // ABC данные
  const { data: abc } = abcUploadId ? await supabase.from('fact_abc')
    .select('*').eq('sku_ms', skuMs).eq('upload_id', abcUploadId).single() : { data: null }

  // Дневные метрики — последние 30 дней
  const { data: daily } = await supabase.from('fact_sku_daily')
    .select('metric_date, revenue, ad_spend, drr_total, ctr, cr_cart, cr_order, cpm, cpc, ad_order_share')
    .eq('sku_ms', skuMs)
    .order('metric_date', { ascending: false })
    .limit(30)

  // Изменения цен — последние 10
  const { data: priceChanges } = dim?.sku_wb ? await supabase.from('fact_price_changes')
    .select('price_date, price, delta_pct').eq('sku_wb', dim.sku_wb)
    .order('price_date', { ascending: false }).limit(10) : { data: null }

  // Заметка
  const { data: note } = await supabase.from('sku_notes')
    .select('note').eq('sku_ms', skuMs).single()

  // Агрегаты за период
  const revenues = (daily ?? []).map(d => d.revenue ?? 0)
  const adSpends = (daily ?? []).map(d => d.ad_spend ?? 0)
  const totalRevenue = revenues.reduce((s, v) => s + v, 0)
  const totalAdSpend = adSpends.reduce((s, v) => s + v, 0)
  const avgCtr = avg((daily ?? []).map(d => d.ctr).filter(v => v != null) as number[])
  const avgCrCart = avg((daily ?? []).map(d => d.cr_cart).filter(v => v != null) as number[])
  const avgCrOrder = avg((daily ?? []).map(d => d.cr_order).filter(v => v != null) as number[])
  const avgCpm = avg((daily ?? []).map(d => d.cpm).filter(v => v != null) as number[])
  const avgCpc = avg((daily ?? []).map(d => d.cpc).filter(v => v != null) as number[])

  return NextResponse.json({
    dim,
    snap,
    abc,
    daily: (daily ?? []).slice(0, 30).reverse(),
    price_changes: priceChanges ?? [],
    note: note?.note ?? '',
    aggregates: {
      revenue: totalRevenue,
      ad_spend: totalAdSpend,
      drr: totalRevenue > 0 ? totalAdSpend / totalRevenue : null,
      avg_ctr: avgCtr,
      avg_cr_cart: avgCrCart,
      avg_cr_order: avgCrOrder,
      avg_cpm: avgCpm,
      avg_cpc: avgCpc,
    },
  })
}

function avg(arr: number[]): number | null {
  if (!arr.length) return null
  return arr.reduce((s, v) => s + v, 0) / arr.length
}
