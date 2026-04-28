import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/supabase/fetchAll'

export const maxDuration = 30

// Тренд: запас (шт) и % SKU в OOS по дням за последние 30 дней.
export async function GET(req: Request) {
  const supabase = createServiceClient()
  const url = new URL(req.url)
  const fromParam = url.searchParams.get('from')
  const toParam   = url.searchParams.get('to')

  let to = toParam
  let from = fromParam
  if (!to) {
    const { data } = await supabase
      .from('daily_agg_sku')
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

  type Row = { metric_date: string; sku_ms: string; stock_qty: number | null }
  const rows = await fetchAll<Row>(
    (sb) => sb.from('daily_agg_sku')
      .select('metric_date, sku_ms, stock_qty')
      .gte('metric_date', from!)
      .lte('metric_date', to!),
    supabase,
  )

  const byDate: Record<string, { total_stock: number; sku_count: number; oos_count: number }> = {}
  for (const r of rows) {
    if (!byDate[r.metric_date]) byDate[r.metric_date] = { total_stock: 0, sku_count: 0, oos_count: 0 }
    const e = byDate[r.metric_date]
    e.total_stock += r.stock_qty ?? 0
    e.sku_count++
    if ((r.stock_qty ?? 0) === 0) e.oos_count++
  }

  const result = Object.entries(byDate)
    .map(([date, e]) => ({
      date,
      total_stock_qty: Math.round(e.total_stock),
      oos_pct: e.sku_count > 0 ? Math.round((e.oos_count / e.sku_count) * 1000) / 10 : 0,
    }))
    .sort((a, b) => a.date.localeCompare(b.date))

  return NextResponse.json({ rows: result, from, to })
}
