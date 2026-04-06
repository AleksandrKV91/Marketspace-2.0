import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export const maxDuration = 30

export async function GET() {
  const supabase = createServiceClient()

  // Latest upload IDs
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
  const abcId = latestByType['abc']

  // dim_sku for category/manager mapping
  const { data: dimRows } = await supabase
    .from('dim_sku')
    .select('sku_ms, sku_wb, name, category_wb, subject_wb, manager')
    .limit(3000)

  const dimByMs: Record<string, { sku_wb: number | null; name: string | null; category_wb: string | null; subject_wb: string | null; manager: string | null }> = {}
  const dimByWb: Record<number, { sku_ms: string; name: string | null; category_wb: string | null; subject_wb: string | null }> = {}
  if (dimRows) {
    for (const r of dimRows) {
      dimByMs[r.sku_ms] = r
      if (r.sku_wb) dimByWb[r.sku_wb] = r
    }
  }

  // Stock snapshot
  let stockAgg = { total_fbo: 0, total_fbs: 0, total_stock: 0, sku_count: 0 }
  const stockByWb: Record<number, { fbo_wb: number; fbs_pushkino: number; fbs_smolensk: number; total_stock: number; price: number | null; margin_pct: number | null }> = {}
  if (stockId) {
    const { data: stockRows } = await supabase
      .from('fact_stock_snapshot')
      .select('sku_wb, fbo_wb, fbs_pushkino, fbs_smolensk, total_stock, price, margin_pct')
      .eq('upload_id', stockId)
    if (stockRows) {
      for (const r of stockRows) {
        stockByWb[r.sku_wb] = r
        stockAgg.total_fbo += r.fbo_wb ?? 0
        stockAgg.total_fbs += (r.fbs_pushkino ?? 0) + (r.fbs_smolensk ?? 0)
        stockAgg.total_stock += r.total_stock ?? 0
        if ((r.total_stock ?? 0) > 0) stockAgg.sku_count++
      }
    }
  }

  // ABC counts + revenue
  let abcCounts = { A: 0, B: 0, C: 0 }
  let totalRevenue = 0
  let totalChmd = 0
  const abcByMs: Record<string, { abc_class: string | null; revenue: number | null; chmd: number | null; profitability: number | null }> = {}
  if (abcId) {
    const { data: abcRows } = await supabase
      .from('fact_abc')
      .select('sku_ms, abc_class, revenue, chmd, profitability')
      .eq('upload_id', abcId)
    if (abcRows) {
      for (const r of abcRows) {
        abcByMs[r.sku_ms] = r
        const cls = (r.abc_class ?? '').toUpperCase().charAt(0)
        if (cls === 'A') abcCounts.A++
        else if (cls === 'B') abcCounts.B++
        else if (cls === 'C') abcCounts.C++
        totalRevenue += r.revenue ?? 0
        totalChmd += r.chmd ?? 0
      }
    }
  }

  // Sales trend: last 30 days from fact_stock_daily
  const { data: maxDateRow } = await supabase
    .from('fact_stock_daily')
    .select('sale_date')
    .order('sale_date', { ascending: false })
    .limit(1)
  const maxDate = maxDateRow?.[0]?.sale_date ?? null

  const trend: Array<{ date: string; sales_qty: number }> = []
  if (maxDate) {
    const from30 = new Date(maxDate)
    from30.setDate(from30.getDate() - 29)
    const from30Str = from30.toISOString().split('T')[0]

    const { data: salesRows } = await supabase
      .from('fact_stock_daily')
      .select('sale_date, sales_qty')
      .gte('sale_date', from30Str)
      .lte('sale_date', maxDate)
      .order('sale_date', { ascending: true })

    const byDate: Record<string, number> = {}
    if (salesRows) {
      for (const r of salesRows) {
        byDate[r.sale_date] = (byDate[r.sale_date] ?? 0) + (r.sales_qty ?? 0)
      }
    }
    for (const [date, qty] of Object.entries(byDate)) {
      trend.push({ date, sales_qty: qty })
    }
    trend.sort((a, b) => a.date.localeCompare(b.date))
  }

  // Category breakdown
  const catMap: Record<string, { revenue: number; chmd: number; sku_count: number }> = {}
  for (const [skuMs, abc] of Object.entries(abcByMs)) {
    const dim = dimByMs[skuMs]
    const cat = dim?.category_wb ?? dim?.subject_wb ?? 'Без категории'
    if (!catMap[cat]) catMap[cat] = { revenue: 0, chmd: 0, sku_count: 0 }
    catMap[cat].revenue += abc.revenue ?? 0
    catMap[cat].chmd += abc.chmd ?? 0
    catMap[cat].sku_count++
  }
  const categories = Object.entries(catMap)
    .map(([cat, v]) => ({ category: cat, ...v }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 8)

  // Manager breakdown
  const managerMap: Record<string, { revenue: number; chmd: number; sku_count: number }> = {}
  for (const [skuMs, abc] of Object.entries(abcByMs)) {
    const dim = dimByMs[skuMs]
    const manager = dim?.manager ?? 'Не указан'
    if (!managerMap[manager]) managerMap[manager] = { revenue: 0, chmd: 0, sku_count: 0 }
    managerMap[manager].revenue += abc.revenue ?? 0
    managerMap[manager].chmd += abc.chmd ?? 0
    managerMap[manager].sku_count++
  }
  const managers = Object.entries(managerMap)
    .map(([manager, v]) => ({ manager, ...v, margin_pct: v.revenue > 0 ? v.chmd / v.revenue : 0 }))
    .sort((a, b) => b.revenue - a.revenue)

  // OOS count
  const oosCount = Object.values(stockByWb).filter(s => (s.total_stock ?? 0) === 0).length

  // Avg margin from stock snapshot
  const marginsWithRevenue = Object.values(stockByWb).filter(s => s.margin_pct !== null && s.margin_pct !== undefined)
  const avgMargin = marginsWithRevenue.length > 0
    ? marginsWithRevenue.reduce((s, r) => s + (r.margin_pct ?? 0), 0) / marginsWithRevenue.length
    : 0

  // Top-15 SKU by revenue
  const top15 = Object.entries(abcByMs)
    .map(([skuMs, abc]) => {
      const dim = dimByMs[skuMs]
      const stock = dim?.sku_wb ? stockByWb[dim.sku_wb] : null
      const dpd = (stock?.total_stock ?? 0) > 0 ? undefined : undefined
      const stockDays = stock?.total_stock && stock.total_stock > 0 ? 999 : 0
      return {
        sku_ms: skuMs,
        sku_wb: dim?.sku_wb ?? null,
        name: dim?.name ?? skuMs,
        revenue: abc.revenue ?? 0,
        margin_pct: abc.profitability ?? (stock?.margin_pct ?? 0),
        stock_days: stockDays,
        abc_class: abc.abc_class ?? '—',
      }
    })
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 15)

  return NextResponse.json({
    kpi: {
      revenue: totalRevenue,
      chmd: totalChmd,
      avg_margin_pct: avgMargin,
      oos_count: oosCount,
      sku_count: dimRows?.length ?? 0,
    },
    stock: stockAgg,
    abc: abcCounts,
    top15,
    trend,
    categories,
    managers,
    latest_date: maxDate,
  })
}
