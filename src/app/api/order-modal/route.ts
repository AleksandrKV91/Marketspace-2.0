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

  const [stockUploadId, chinaUploadId, abcUploadId] = await Promise.all([
    getLatestUploadId('stock'),
    getLatestUploadId('china'),
    getLatestUploadId('abc'),
  ])

  const { data: dim } = await supabase.from('dim_sku')
    .select('sku_ms, sku_wb, name, brand, supplier, manager, lead_time_days, month_jan, month_feb, month_mar, month_apr, month_may, month_jun, month_jul, month_aug, month_sep, month_oct, month_nov, month_dec')
    .eq('sku_ms', skuMs).single()

  const { data: stockSnap } = stockUploadId && dim?.sku_wb ? await supabase.from('fact_stock_snapshot')
    .select('fbo_wb, fbs_pushkino, fbs_smolensk, total_stock, supply_date, supply_qty')
    .eq('sku_wb', dim.sku_wb).eq('upload_id', stockUploadId).single() : { data: null }

  const { data: china } = chinaUploadId ? await supabase.from('fact_china_supply')
    .select('*').eq('sku_ms', skuMs).eq('upload_id', chinaUploadId).single() : { data: null }

  const { data: abc } = abcUploadId ? await supabase.from('fact_abc')
    .select('abc_class, abc_class2, chmd, chmd_clean, revenue, profitability, tz, turnover_days, revenue_margin')
    .eq('sku_ms', skuMs).eq('upload_id', abcUploadId).single() : { data: null }

  // Продажи за 7/14/31 дней из fact_stock_daily
  const { data: sales31 } = dim?.sku_wb ? await supabase.from('fact_stock_daily')
    .select('sale_date, sales_qty').eq('sku_wb', dim.sku_wb)
    .order('sale_date', { ascending: false }).limit(31) : { data: null }

  const salesRows = sales31 ?? []
  const s7 = salesRows.slice(0, 7)
  const s14 = salesRows.slice(0, 14)
  const s31 = salesRows.slice(0, 31)

  const sumQty = (rows: typeof salesRows) => rows.reduce((s, r) => s + (r.sales_qty ?? 0), 0)
  const oosDays = (rows: typeof salesRows) => rows.filter(r => (r.sales_qty ?? 0) === 0).length

  const qty7 = sumQty(s7); const qty14 = sumQty(s14); const qty31 = sumQty(s31)
  const dpd7 = s7.length ? qty7 / s7.length : 0
  const dpd14 = s14.length ? qty14 / s14.length : 0
  const dpd31 = s31.length ? qty31 / s31.length : 0

  // CV (коэффициент вариации)
  const dailyQtys = s31.map(r => r.sales_qty ?? 0)
  const mean = dpd31
  const cv = mean > 0
    ? Math.sqrt(dailyQtys.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / Math.max(dailyQtys.length - 1, 1)) / mean
    : 0

  // Запас дней
  const totalStock = (stockSnap?.fbo_wb ?? 0) + (stockSnap?.fbs_pushkino ?? 0) + (stockSnap?.fbs_smolensk ?? 0)
  const stockDays = dpd31 > 0 ? Math.round(totalStock / dpd31) : 999

  // В наличии
  const inTransit = china?.in_transit ?? 0
  const inProduction = china?.in_production ?? 0
  const alreadyHave = totalStock + inTransit + inProduction

  // Расчёт заказа (упрощённый, без сезонности)
  const leadTimeDays = dim?.lead_time_days ?? 60
  const horizon = 60
  const need = Math.round(dpd31 * horizon)
  const safetyDays = Math.round(Math.sqrt(leadTimeDays) * cv)
  const safetyQty = Math.round(dpd31 * safetyDays)
  const toOrder = Math.max(0, need + safetyQty - alreadyHave)

  return NextResponse.json({
    dim,
    stock_snap: stockSnap,
    china,
    abc,
    sales: { qty7, qty14, qty31, dpd7, dpd14, dpd31, oos7: oosDays(s7), oos14: oosDays(s14), oos31: oosDays(s31), cv },
    stock: { total: totalStock, fbo: stockSnap?.fbo_wb ?? 0, fbs_pushkino: stockSnap?.fbs_pushkino ?? 0, fbs_smolensk: stockSnap?.fbs_smolensk ?? 0, in_transit: inTransit, in_production: inProduction, already_have: alreadyHave, stock_days: stockDays },
    order_calc: { dpd31, lead_time_days: leadTimeDays, horizon, need, safety_days: safetyDays, safety_qty: safetyQty, to_order: toOrder, cost_total: toOrder * (china?.cost_plan ?? 0) },
  })
}
