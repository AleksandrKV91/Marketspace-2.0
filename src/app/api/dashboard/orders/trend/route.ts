import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/supabase/fetchAll'

export const maxDuration = 30

// Тренд: суммарная выручка/продажи и % SKU без продаж по дням.
// В новой схеме дневных остатков нет — для индикатора OOS используем
// долю SKU с sales_qty=0 в этот день (близкий по смыслу прокси).
export async function GET(req: Request) {
  const supabase = createServiceClient()
  const url = new URL(req.url)
  const fromParam = url.searchParams.get('from')
  const toParam   = url.searchParams.get('to')

  let to = toParam
  let from = fromParam
  if (!to) {
    const { data } = await supabase
      .from('fact_sku_daily')
      .select('metric_date')
      .order('metric_date', { ascending: false })
      .limit(1)
    to = data?.[0]?.metric_date ?? null
  }
  if (!to) return NextResponse.json({ rows: [] })

  if (!from) {
    const d = new Date(to); d.setDate(d.getDate() - 29)
    from = d.toISOString().split('T')[0]
  }

  type Row = { metric_date: string; sku_ms: string; sales_qty: number | null; revenue: number | null }
  const rows = await fetchAll<Row>(
    (sb) => sb.from('fact_sku_daily')
      .select('metric_date, sku_ms, sales_qty, revenue')
      .gte('metric_date', from!)
      .lte('metric_date', to!),
    supabase,
  )

  const byDate: Record<string, { total_revenue: number; sku_count: number; no_sales_count: number }> = {}
  for (const r of rows) {
    if (!byDate[r.metric_date]) byDate[r.metric_date] = { total_revenue: 0, sku_count: 0, no_sales_count: 0 }
    const e = byDate[r.metric_date]
    e.total_revenue += r.revenue ?? 0
    e.sku_count++
    if ((r.sales_qty ?? 0) === 0) e.no_sales_count++
  }

  const result = Object.entries(byDate)
    .map(([date, e]) => ({
      date,
      total_stock_qty: Math.round(e.total_revenue), // используем как «объём оборота» для графика
      oos_pct: e.sku_count > 0 ? Math.round((e.no_sales_count / e.sku_count) * 1000) / 10 : 0,
    }))
    .sort((a, b) => a.date.localeCompare(b.date))

  return NextResponse.json({ rows: result, from, to })
}
