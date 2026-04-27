import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/supabase/fetchAll'
import { invalidatePrefix } from '@/lib/cache'

export const maxDuration = 60

// POST /api/admin/refresh-daily-agg-sku
// Body: { from?: string; to?: string }
// Заполняет daily_agg_sku последовательным расчётом по дням (от начала периода).
// Порядок: сначала daily_agg_sku, затем вызывает refresh_daily_agg для fact_daily_agg.

export async function POST(req: NextRequest) {
  const supabase = createServiceClient()
  const body = await req.json().catch(() => ({}))

  // ── 1. Определить диапазон дат ───────────────────────────────────────────────
  let fromDate: string = body.from
  let toDate: string = body.to

  if (!fromDate || !toDate) {
    const { data } = await supabase
      .from('fact_sku_daily')
      .select('metric_date')
      .order('metric_date', { ascending: true })
      .limit(1)
    const { data: data2 } = await supabase
      .from('fact_sku_daily')
      .select('metric_date')
      .order('metric_date', { ascending: false })
      .limit(1)
    if (!data?.[0] || !data2?.[0]) {
      return NextResponse.json({ ok: false, error: 'Нет данных в fact_sku_daily' }, { status: 400 })
    }
    fromDate = fromDate ?? data[0].metric_date
    toDate = toDate ?? data2[0].metric_date
  }

  // ── 2. Загрузить дневные метрики из fact_sku_daily ───────────────────────────
  type DailyRow = {
    sku_ms: string
    sku_wb: number | null
    metric_date: string
    revenue: number | null
    ad_spend: number | null
    margin_pct: number | null
    fbo_wb: number | null
    fbs_pushkino: number | null
    fbs_smolensk: number | null
    snap_date: string | null
  }

  const dailyRows = await fetchAll<DailyRow>(
    (sb) => sb.from('fact_sku_daily')
      .select('sku_ms,sku_wb,metric_date,revenue,ad_spend,margin_pct,fbo_wb,fbs_pushkino,fbs_smolensk,snap_date')
      .gte('metric_date', fromDate)
      .lte('metric_date', toDate)
      .order('metric_date', { ascending: true }),
    supabase,
  )

  if (dailyRows.length === 0) {
    return NextResponse.json({ ok: false, error: 'Нет данных в fact_sku_daily для периода' }, { status: 400 })
  }

  // ── 3. Загрузить историю цен из fact_price_changes (с запасом -30 дней) ──────
  const extFrom = new Date(fromDate)
  extFrom.setDate(extFrom.getDate() - 30)
  const extFromStr = extFrom.toISOString().split('T')[0]

  type PriceRow = { sku_wb: number; price_date: string; price: number }
  const priceRows = await fetchAll<PriceRow>(
    (sb) => sb.from('fact_price_changes')
      .select('sku_wb,price_date,price')
      .gte('price_date', extFromStr)
      .lte('price_date', toDate)
      .order('price_date', { ascending: true }),
    supabase,
  )

  // Индекс цен: sku_wb → sorted array of {date, price}
  const priceHistory: Record<number, Array<{ date: string; price: number }>> = {}
  for (const r of priceRows) {
    if (!priceHistory[r.sku_wb]) priceHistory[r.sku_wb] = []
    priceHistory[r.sku_wb].push({ date: r.price_date, price: r.price })
  }

  function getPriceOnDate(skuWb: number, date: string): number | null {
    const hist = priceHistory[skuWb]
    if (!hist || hist.length === 0) return null
    let last: number | null = null
    for (const h of hist) {
      if (h.date <= date) last = h.price
      else break
    }
    return last
  }

  // ── 4. Сгруппировать данные по артикулу ─────────────────────────────────────
  const bySkuMs: Record<string, DailyRow[]> = {}
  for (const r of dailyRows) {
    if (!bySkuMs[r.sku_ms]) bySkuMs[r.sku_ms] = []
    bySkuMs[r.sku_ms].push(r)
  }

  // ── 5. Последовательный расчёт по дням для каждого артикула ─────────────────
  type AggSkuRow = {
    metric_date: string
    sku_wb: number
    sku_ms: string
    stock_qty: number | null
    stock_rub: number | null
    price: number | null
    sales_qty: number | null
    cost_sum: number | null
    cost_unit: number | null
    margin_rub: number | null
    chmd_rub: number | null
    marginality: number | null
    chmd_pct: number | null
  }

  const output: AggSkuRow[] = []

  for (const [skuMs, rows] of Object.entries(bySkuMs)) {
    rows.sort((a, b) => a.metric_date.localeCompare(b.metric_date))

    const firstRow = rows[0]
    const skuWb = firstRow.sku_wb
    if (!skuWb) continue

    const marginPct = rows.find(r => r.margin_pct != null)?.margin_pct ?? 0

    let prevStockQty: number =
      (firstRow.fbo_wb ?? 0) + (firstRow.fbs_pushkino ?? 0) + (firstRow.fbs_smolensk ?? 0)
    let prevSalesQty = 0

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const date = row.metric_date
      const revenue = row.revenue ?? 0
      const adSpend = row.ad_spend ?? 0

      const price = getPriceOnDate(skuWb, date)

      const salesQty = price != null && price > 0 && revenue > 0
        ? revenue / price
        : null

      const costSum = revenue > 0 ? revenue * (1 - marginPct) : null
      const costUnit = costSum != null && salesQty != null && salesQty > 0
        ? costSum / salesQty
        : null

      const marginRub = costSum != null ? revenue - costSum : null
      const chmdRub = marginRub != null ? marginRub - adSpend : null
      const marginality = marginRub != null && revenue > 0 ? marginRub / revenue : null
      const chmdPct = chmdRub != null && revenue > 0 ? chmdRub / revenue : null

      const stockQty = i === 0
        ? prevStockQty
        : Math.max(0, prevStockQty - prevSalesQty)

      const stockRub = costUnit != null ? stockQty * costUnit : null

      output.push({
        metric_date: date,
        sku_wb: skuWb,
        sku_ms: skuMs,
        stock_qty: stockQty,
        stock_rub: stockRub,
        price,
        sales_qty: salesQty != null ? Math.round(salesQty * 100) / 100 : null,
        cost_sum: costSum != null ? Math.round(costSum * 100) / 100 : null,
        cost_unit: costUnit != null ? Math.round(costUnit * 100) / 100 : null,
        margin_rub: marginRub != null ? Math.round(marginRub * 100) / 100 : null,
        chmd_rub: chmdRub != null ? Math.round(chmdRub * 100) / 100 : null,
        marginality,
        chmd_pct: chmdPct,
      })

      prevStockQty = stockQty
      prevSalesQty = salesQty ?? 0
    }
  }

  // ── 6. Upsert в daily_agg_sku ────────────────────────────────────────────────
  const chunkSize = 500
  let upsertErrors = 0
  for (let i = 0; i < output.length; i += chunkSize) {
    const batch = output.slice(i, i + chunkSize)
    const { error } = await supabase
      .from('daily_agg_sku')
      .upsert(batch, { onConflict: 'metric_date,sku_wb' })
    if (error) {
      console.error('daily_agg_sku upsert error:', error.message)
      upsertErrors++
    }
  }

  // ── 7. Пересчитать fact_daily_agg из daily_agg_sku ─────────────────────────
  const { error: aggError } = await supabase.rpc('refresh_daily_agg', {
    from_date: fromDate,
    to_date: toDate,
  })
  if (aggError) console.error('refresh_daily_agg error:', aggError.message)

  invalidatePrefix('overview|')

  return NextResponse.json({
    ok: upsertErrors === 0,
    rows_written: output.length,
    sku_count: Object.keys(bySkuMs).length,
    from: fromDate,
    to: toDate,
    upsert_errors: upsertErrors,
    agg_refreshed: !aggError,
  })
}
