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

  const [chinaUploadId, abcUploadId] = await Promise.all([
    getLatestUploadId('china'),
    getLatestUploadId('abc'),
  ])

  const { data: dim } = await supabase.from('dim_sku')
    .select('sku_ms, sku_wb, name, brand, supplier, month_jan, month_feb, month_mar, month_apr, month_may, month_jun, month_jul, month_aug, month_sep, month_oct, month_nov, month_dec')
    .eq('sku_ms', skuMs).single()

  // Снапшот из fact_sku_daily (последняя snap_date)
  const { data: snapRows } = await supabase.from('fact_sku_daily')
    .select('snap_date, fbo_wb, fbs_pushkino, fbs_smolensk, kits_stock, stock_days, supply_date, supply_qty, days_to_arrival, price, margin_pct')
    .eq('sku_ms', skuMs)
    .not('snap_date', 'is', null)
    .order('snap_date', { ascending: false })
    .limit(1)
  const snap = snapRows?.[0] ?? null

  const { data: china } = chinaUploadId ? await supabase.from('fact_china_supply')
    .select('*').eq('sku_ms', skuMs).eq('upload_id', chinaUploadId).single() : { data: null }

  const { data: abc } = abcUploadId ? await supabase.from('fact_abc')
    .select('abc_class, abc_class2, chmd, chmd_clean, revenue, profitability, tz, turnover_days, revenue_margin')
    .eq('sku_ms', skuMs).eq('upload_id', abcUploadId).single() : { data: null }

  // Продажи за 31 день из fact_sku_daily (revenue как прокси)
  const { data: sales31 } = await supabase.from('fact_sku_daily')
    .select('metric_date, revenue, ad_spend')
    .eq('sku_ms', skuMs)
    .order('metric_date', { ascending: false })
    .limit(31)

  const salesRows = sales31 ?? []
  const s7 = salesRows.slice(0, 7)
  const s14 = salesRows.slice(0, 14)
  const s31 = salesRows.slice(0, 31)

  const sumRev = (rows: typeof salesRows) => rows.reduce((s, r) => s + (r.revenue ?? 0), 0)
  const oosDays = (rows: typeof salesRows) => rows.filter(r => (r.revenue ?? 0) === 0).length

  const rev7 = sumRev(s7); const rev14 = sumRev(s14); const rev31 = sumRev(s31)
  const price = snap?.price ?? 1

  // Конвертируем выручку в приблизительные шт
  const qty7  = price > 0 ? Math.round(rev7 / price) : 0
  const qty14 = price > 0 ? Math.round(rev14 / price) : 0
  const qty31 = price > 0 ? Math.round(rev31 / price) : 0

  const dpd31 = s31.length > 0 ? qty31 / 31 : 0

  // CV
  const dailyQtys = s31.map(r => price > 0 ? (r.revenue ?? 0) / price : 0)
  const mean = dpd31
  const cv = mean > 0
    ? Math.sqrt(dailyQtys.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / Math.max(dailyQtys.length - 1, 1)) / mean
    : 0

  const fbo = snap?.fbo_wb ?? 0
  const fbsPush = snap?.fbs_pushkino ?? 0
  const fbsSmol = snap?.fbs_smolensk ?? 0
  const kits = snap?.kits_stock ?? 0
  const totalStock = fbo + fbsPush + fbsSmol + kits
  const stockDays = dpd31 > 0 ? Math.round(totalStock / dpd31) : 999

  const inTransit = china?.in_transit ?? 0
  const inProduction = china?.in_production ?? 0
  const alreadyHave = totalStock + inTransit + inProduction

  const leadTimeDays = china?.lead_time_days ?? 60
  const horizon = 60
  const need = Math.round(dpd31 * horizon)
  const safetyDays = Math.round(Math.sqrt(leadTimeDays) * cv)
  const safetyQty = Math.round(dpd31 * safetyDays)
  const toOrder = Math.max(0, need + safetyQty - alreadyHave)

  // GMROI
  const gmroi = (abc?.chmd_clean != null && abc?.tz != null && abc.tz > 0)
    ? Math.round((abc.chmd_clean / abc.tz) * 100) / 100
    : null

  return NextResponse.json({
    dim,
    snap,
    china,
    abc,
    gmroi,
    sales: {
      rev7, rev14, rev31,
      qty7, qty14, qty31,
      dpd7: s7.length > 0 ? qty7 / s7.length : 0,
      dpd14: s14.length > 0 ? qty14 / s14.length : 0,
      dpd31,
      oos7: oosDays(s7), oos14: oosDays(s14), oos31: oosDays(s31),
      cv,
    },
    stock: {
      total: totalStock, fbo, fbs_pushkino: fbsPush, fbs_smolensk: fbsSmol,
      kits_stock: kits, in_transit: inTransit, in_production: inProduction,
      already_have: alreadyHave, stock_days: stockDays,
    },
    order_calc: {
      dpd31, lead_time_days: leadTimeDays, horizon,
      need, safety_days: safetyDays, safety_qty: safetyQty,
      to_order: toOrder,
      cost_total: toOrder * (china?.cost_plan ?? 0),
    },
  })
}
