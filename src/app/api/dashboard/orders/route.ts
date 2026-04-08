import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/supabase/fetchAll'

export const maxDuration = 30

export async function GET(req: Request) {
  const supabase = createServiceClient()
  const url = new URL(req.url)
  const fromParam = url.searchParams.get('from')
  const toParam = url.searchParams.get('to')
  const horizon = parseInt(url.searchParams.get('horizon') ?? '60', 10)

  // Последние uploads по типам
  const { data: lastUploads } = await supabase
    .from('uploads')
    .select('id, file_type')
    .eq('status', 'ok')
    .order('uploaded_at', { ascending: false })
    .limit(20)

  const latestByType: Record<string, string> = {}
  if (lastUploads) {
    for (const u of lastUploads) {
      if (!latestByType[u.file_type]) latestByType[u.file_type] = u.id
    }
  }

  const stockId = latestByType['stock']
  const chinaId = latestByType['china']
  const abcId = latestByType['abc']

  // dim_sku — все SKU с сезонностью (без лимита)
  type DimRow = { sku_ms: string; sku_wb: number | null; name: string | null; brand: string | null; subject_wb: string | null; month_jan: number | null; month_feb: number | null; month_mar: number | null; month_apr: number | null; month_may: number | null; month_jun: number | null; month_jul: number | null; month_aug: number | null; month_sep: number | null; month_oct: number | null; month_nov: number | null; month_dec: number | null }
  const dimRows = await fetchAll<DimRow>(
    (sb) => sb.from('dim_sku').select('sku_ms, sku_wb, name, brand, subject_wb, month_jan, month_feb, month_mar, month_apr, month_may, month_jun, month_jul, month_aug, month_sep, month_oct, month_nov, month_dec'),
    supabase,
  )

  const dimMap: Record<string, DimRow> = {}
  for (const r of dimRows) dimMap[r.sku_ms] = r

  // fact_stock_snapshot — остатки
  const stockMap: Record<number, { fbo_wb: number; fbs_pushkino: number; fbs_smolensk: number; total_stock: number; snap_date: string | null }> = {}
  if (stockId) {
    const { data: stockRows } = await supabase
      .from('fact_stock_snapshot')
      .select('sku_wb, fbo_wb, fbs_pushkino, fbs_smolensk, total_stock, snap_date, sku_ms')
      .eq('upload_id', stockId)
    if (stockRows) {
      for (const r of stockRows) {
        stockMap[r.sku_wb] = {
          fbo_wb: r.fbo_wb ?? 0,
          fbs_pushkino: r.fbs_pushkino ?? 0,
          fbs_smolensk: r.fbs_smolensk ?? 0,
          total_stock: r.total_stock ?? 0,
          snap_date: r.snap_date,
        }
      }
    }
  }

  // fact_stock_daily — продажи за последние 31 день
  const { data: maxDateRow } = await supabase
    .from('fact_stock_daily')
    .select('sale_date')
    .order('sale_date', { ascending: false })
    .limit(1)
  const maxDate = maxDateRow?.[0]?.sale_date

  const salesMap31: Record<number, { qty: number; days_with_stock: number }> = {}
  const salesMap7: Record<number, number> = {}
  const salesMap14: Record<number, number> = {}

  if (maxDate) {
    // 31 дней
    const date31 = new Date(maxDate)
    date31.setDate(date31.getDate() - 30)
    const from31 = date31.toISOString().split('T')[0]

    const { data: salesRows } = await supabase
      .from('fact_stock_daily')
      .select('sku_wb, sale_date, sales_qty')
      .gte('sale_date', from31)
      .lte('sale_date', maxDate)

    if (salesRows) {
      for (const r of salesRows) {
        const wb = r.sku_wb
        if (!salesMap31[wb]) salesMap31[wb] = { qty: 0, days_with_stock: 0 }
        salesMap31[wb].qty += r.sales_qty ?? 0
        if ((r.sales_qty ?? 0) > 0) salesMap31[wb].days_with_stock++

        const daysDiff = Math.ceil((new Date(maxDate).getTime() - new Date(r.sale_date).getTime()) / 86400000)
        if (daysDiff <= 7) { salesMap7[wb] = (salesMap7[wb] ?? 0) + (r.sales_qty ?? 0) }
        if (daysDiff <= 14) { salesMap14[wb] = (salesMap14[wb] ?? 0) + (r.sales_qty ?? 0) }
      }
    }
  }

  // fact_china_supply — в пути и в производстве
  const chinaMap: Record<string, { in_transit: number; in_production: number; nearest_date: string | null }> = {}
  if (chinaId) {
    const { data: chinaRows } = await supabase
      .from('fact_china_supply')
      .select('sku_ms, in_transit, in_production, nearest_date')
      .eq('upload_id', chinaId)
    if (chinaRows) {
      for (const r of chinaRows) chinaMap[r.sku_ms] = r
    }
  }

  // fact_abc
  const abcMap: Record<string, { abc_class: string | null; profitability: number | null }> = {}
  if (abcId) {
    const { data: abcRows } = await supabase
      .from('fact_abc')
      .select('sku_ms, abc_class, profitability')
      .eq('upload_id', abcId)
    if (abcRows) {
      for (const r of abcRows) abcMap[r.sku_ms] = r
    }
  }

  // Сборка строк
  const rows = dimRows.map(sku => {
    const skuWb = sku.sku_wb ?? 0
    const stock = stockMap[skuWb]
    const sales31 = salesMap31[skuWb]
    const china = chinaMap[sku.sku_ms]
    const abc = abcMap[sku.sku_ms]

    const totalStock = stock?.total_stock ?? 0
    const inTransit = china?.in_transit ?? 0
    const inProduction = china?.in_production ?? 0
    const alreadyHave = totalStock + inTransit + inProduction

    const dpd31 = sales31?.qty ?? 0
    const daysWithStock = sales31?.days_with_stock ?? 1
    const dpd = daysWithStock > 0 ? dpd31 / daysWithStock : 0

    const daysStock = dpd > 0 ? totalStock / dpd : (totalStock > 0 ? 999 : 0)
    const logPleche = horizon // дней (горизонт поставки)

    const needed = Math.max(0, Math.round(dpd * logPleche - alreadyHave))

    // Статус
    let status: 'ok' | 'warning' | 'critical' | 'oos'
    if (totalStock === 0) status = 'oos'
    else if (daysStock < logPleche * 0.5) status = 'critical'
    else if (daysStock < logPleche) status = 'warning'
    else status = 'ok'

    return {
      sku_ms: sku.sku_ms,
      sku_wb: skuWb,
      name: sku.name,
      brand: sku.brand,
      subject_wb: sku.subject_wb,
      total_stock: totalStock,
      fbo_wb: stock?.fbo_wb ?? 0,
      fbs_pushkino: stock?.fbs_pushkino ?? 0,
      fbs_smolensk: stock?.fbs_smolensk ?? 0,
      in_transit: inTransit,
      in_production: inProduction,
      already_have: alreadyHave,
      sales_7d: salesMap7[skuWb] ?? 0,
      sales_14d: salesMap14[skuWb] ?? 0,
      sales_31d: dpd31,
      dpd: Math.round(dpd * 10) / 10,
      days_stock: Math.round(daysStock),
      log_pleche: logPleche,
      calc_order: needed,
      abc_class: abc?.abc_class ?? null,
      profitability: abc?.profitability ?? null,
      nearest_arrival: china?.nearest_date ?? null,
      status,
    }
  })

  // Сортировка: сначала критичные и OOS
  const statusOrder = { oos: 0, critical: 1, warning: 2, ok: 3 }
  rows.sort((a, b) => statusOrder[a.status] - statusOrder[b.status])

  const criticalRows = rows.filter(r => r.status === 'critical' || r.status === 'oos')
  const warningRows = rows.filter(r => r.status === 'warning')
  const toOrderRows = rows.filter(r => r.calc_order > 0)
  const avgDaysToOos = rows.reduce((s, r) => s + r.days_stock, 0) / Math.max(rows.length, 1)

  const summary = {
    critical_count: criticalRows.length,
    warning_count: warningRows.length,
    oos_with_demand: rows.filter(r => r.status === 'oos' && r.sales_31d > 0).length,
    to_order_count: toOrderRows.reduce((s, r) => s + r.calc_order, 0),
    order_sum_rub: 0,
    avg_days_to_oos: Math.round(avgDaysToOos),
    total_stock_rub: 0,
  }

  const mappedRows = rows.map(r => ({
    sku_wb: String(r.sku_wb),
    name: r.name ?? '',
    status: r.status === 'oos' ? 'critical' : r.status,
    abc: r.abc_class ?? '—',
    sales_31d: r.sales_31d,
    oos_days: r.status === 'oos' ? 1 : 0,
    trend: 0,
    stock_qty: r.total_stock,
    stock_days: r.days_stock,
    lead_time: r.log_pleche,
    calc_order: r.calc_order,
    manager_order: 0,
    delta_order: r.calc_order,
    margin_pct: r.profitability ?? 0,
  }))

  return NextResponse.json({ summary, rows: mappedRows, latest_date: maxDate })
}
