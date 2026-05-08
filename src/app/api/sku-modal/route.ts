import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export const maxDuration = 30

export async function GET(req: NextRequest) {
  const skuMs = req.nextUrl.searchParams.get('sku_ms')
  if (!skuMs) return NextResponse.json({ error: 'sku_ms required' }, { status: 400 })

  const from = req.nextUrl.searchParams.get('from')
  const to = req.nextUrl.searchParams.get('to')

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

  // Снапшот из fact_sku_daily (последняя snap_date для этого SKU — всегда самый свежий, без фильтра периода)
  const { data: snapRows } = await supabase.from('fact_sku_daily')
    .select('snap_date, fbo_wb, fbs_pushkino, fbs_smolensk, kits_stock, stock_days, margin_pct, chmd_5d, price, supply_date, supply_qty, days_to_arrival, manager, novelty_status, ots_reserve_days')
    .eq('sku_ms', skuMs)
    .not('snap_date', 'is', null)
    .order('snap_date', { ascending: false })
    .limit(1)
  const snap = snapRows?.[0] ?? null

  // FALLBACK: те же поля из fact_sku_period (заполняется при загрузке Свода / Отчёт по SKU).
  // Если snap (из fact_sku_daily) пуст или часть полей NULL — берём из периодического снапшота.
  const { data: periodSnapRows } = await supabase.from('fact_sku_period')
    .select('period_end, price, plan_supply_date, plan_supply_qty, fbo_wb, fbs_pushkino, fbs_smolensk, kits_qty, period_marginality_wgt, manager, days_until_arrival')
    .eq('sku_ms', skuMs)
    .order('period_end', { ascending: false })
    .limit(1)
  const periodSnap = periodSnapRows?.[0] ?? null

  // FALLBACK 2: данные из «Потребность Китай» (fact_china_supply) — там тоже есть nearest_date,
  // in_transit, in_production, cost_plan, order_qty
  const { data: chinaRows } = await supabase.from('fact_china_supply')
    .select('nearest_date, in_transit, in_production, cost_plan, order_qty')
    .eq('sku_ms', skuMs)
    .order('upload_id', { ascending: false })
    .limit(1)
  const chinaSnap = chinaRows?.[0] ?? null

  // ABC данные — всегда последний файл, без фильтра периода
  const { data: abc } = abcUploadId ? await supabase.from('fact_abc')
    .select('final_class_1, final_class_2, chmd_class, revenue_class, chmd_clean, chmd, revenue, profitability, tz, turnover_days')
    .eq('sku_ms', skuMs).eq('upload_id', abcUploadId).single() : { data: null }

  // Дневные метрики — за выбранный период (или последние 30 дней если период не задан)
  let dailyQuery = supabase.from('fact_sku_daily')
    .select('metric_date, revenue, ad_spend, drr_total, ctr, cr_cart, cr_order, cpm, cpc, ad_order_share')
    .eq('sku_ms', skuMs)

  if (from && to) {
    dailyQuery = dailyQuery.gte('metric_date', from).lte('metric_date', to)
  } else {
    dailyQuery = dailyQuery.order('metric_date', { ascending: false }).limit(30)
  }

  const { data: dailyRaw } = await dailyQuery.order('metric_date', { ascending: true })

  const daily = dailyRaw ?? []

  // Изменения цен — за выбранный период
  let priceChangesQuery = supabase.from('fact_price_changes')
    .select('price_date, price, delta_pct')
    .eq('sku_wb', dim?.sku_wb ?? 0)
    .order('price_date', { ascending: false })

  if (from && to) {
    priceChangesQuery = priceChangesQuery.gte('price_date', from).lte('price_date', to)
  } else {
    priceChangesQuery = priceChangesQuery.limit(10)
  }

  const { data: priceChanges } = dim?.sku_wb ? await priceChangesQuery : { data: null }

  // Заметка
  const { data: note } = await supabase.from('sku_notes')
    .select('note').eq('sku_ms', skuMs).single()

  // Агрегаты за период
  const revenues = daily.map(d => d.revenue ?? 0)
  const adSpends = daily.map(d => d.ad_spend ?? 0)
  const totalRevenue = revenues.reduce((s, v) => s + v, 0)
  const totalAdSpend = adSpends.reduce((s, v) => s + v, 0)
  const avgCtr = avg(daily.map(d => d.ctr).filter(v => v != null) as number[])
  const avgCrCart = avg(daily.map(d => d.cr_cart).filter(v => v != null) as number[])
  const avgCrOrder = avg(daily.map(d => d.cr_order).filter(v => v != null) as number[])
  const avgCpm = avg(daily.map(d => d.cpm).filter(v => v != null) as number[])
  const avgCpc = avg(daily.map(d => d.cpc).filter(v => v != null) as number[])

  // Строим stock_snap: snap (fact_sku_daily) → periodSnap (fact_sku_period) → chinaSnap (fact_china_supply).
  // Каскад фоллбэков обеспечивает данные при любой комбинации загруженных файлов.
  const fbo_wb       = snap?.fbo_wb       ?? periodSnap?.fbo_wb       ?? 0
  const fbs_pushkino = snap?.fbs_pushkino ?? periodSnap?.fbs_pushkino ?? 0
  const fbs_smolensk = snap?.fbs_smolensk ?? periodSnap?.fbs_smolensk ?? 0
  const kits_stock   = snap?.kits_stock   ?? periodSnap?.kits_qty     ?? 0

  const supply_date  = snap?.supply_date ?? periodSnap?.plan_supply_date ?? chinaSnap?.nearest_date ?? ''
  const supply_qty   = snap?.supply_qty  ?? periodSnap?.plan_supply_qty  ?? null
  const price        = snap?.price       ?? periodSnap?.price ?? null
  const margin_pct   = snap?.margin_pct  ?? periodSnap?.period_marginality_wgt ?? null

  const stock_snap = (snap || periodSnap || chinaSnap) ? {
    fbo_wb,
    fbs_pushkino,
    fbs_smolensk,
    total_stock: fbo_wb + fbs_pushkino + fbs_smolensk + kits_stock,
    supply_date,
    supply_qty,
    price,
    margin_pct,
    in_transit:    chinaSnap?.in_transit    ?? 0,
    in_production: chinaSnap?.in_production ?? 0,
    cost_plan:     chinaSnap?.cost_plan     ?? null,
    order_qty:     chinaSnap?.order_qty     ?? null,
  } : null

  // manager: fact_sku_daily → fact_sku_period
  const manager = snap?.manager ?? periodSnap?.manager ?? null

  return NextResponse.json({
    dim: dim ? { ...dim, manager } : null,
    snap,
    stock_snap,
    abc,
    daily,
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
