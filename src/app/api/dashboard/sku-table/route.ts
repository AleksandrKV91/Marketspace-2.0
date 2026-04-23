import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/supabase/fetchAll'
import { computeScore } from '@/lib/scoring'

export const maxDuration = 60

export async function GET(req: NextRequest) {
  const supabase = createServiceClient()
  const { searchParams } = new URL(req.url)
  const search = (searchParams.get('search') ?? '').trim()
  const fromParam = searchParams.get('from')
  const toParam = searchParams.get('to')
  const categoryFilter = searchParams.get('category') ?? ''
  const managerFilter  = searchParams.get('manager') ?? ''
  const noveltyFilter  = searchParams.get('gnovelty') ?? ''

  // Последние upload_id
  const { data: lastUploads } = await supabase
    .from('uploads').select('id, file_type').eq('status', 'ok')
    .order('uploaded_at', { ascending: false }).limit(20)
  const latestByType: Record<string, string> = {}
  if (lastUploads) for (const u of lastUploads) {
    if (!latestByType[u.file_type]) latestByType[u.file_type] = u.id
  }
  const abcId = latestByType['abc']

  // Если даты не переданы — берём последние 7 дней из fact_sku_daily
  let effectiveFrom = fromParam
  let effectiveTo = toParam
  if (!effectiveFrom || !effectiveTo) {
    const { data: maxRow } = await supabase
      .from('fact_sku_daily').select('metric_date').order('metric_date', { ascending: false }).limit(1)
    const maxDate = maxRow?.[0]?.metric_date
    if (maxDate) {
      effectiveTo = maxDate
      const d = new Date(maxDate)
      d.setDate(d.getDate() - 6)
      effectiveFrom = d.toISOString().split('T')[0]
    }
  }

  // E.6: вычислить предыдущий период той же длины
  let prevFrom: string | null = null
  let prevTo: string | null = null
  if (effectiveFrom && effectiveTo) {
    const days = Math.round(
      (new Date(effectiveTo).getTime() - new Date(effectiveFrom).getTime()) / 86400000
    ) + 1
    const pTo = new Date(effectiveFrom)
    pTo.setDate(pTo.getDate() - 1)
    const pFrom = new Date(pTo)
    pFrom.setDate(pFrom.getDate() - (days - 1))
    prevTo   = pTo.toISOString().split('T')[0]
    prevFrom = pFrom.toISOString().split('T')[0]
  }

  // dim_sku — справочник
  const dimRows = await fetchAll<{
    sku_ms: string; sku_wb: number | null; name: string | null
    brand: string | null; supplier: string | null
    subject_wb: string | null; category_wb: string | null
  }>(
    (sb) => {
      let q = sb.from('dim_sku').select('sku_ms, sku_wb, name, brand, supplier, subject_wb, category_wb')
      if (search) q = q.or(`name.ilike.%${search}%,sku_ms.ilike.%${search}%,brand.ilike.%${search}%`)
      return q
    },
    supabase,
  )
  if (!dimRows.length) return NextResponse.json({ rows: [], total: 0, selected_count: 0, selected_revenue: 0 })

  const skuMsList = dimRows.map(r => r.sku_ms)

  // Снапшот из fact_sku_daily (последняя snap_date)
  const { data: maxSnapRow } = await supabase.from('fact_sku_daily')
    .select('snap_date').not('snap_date', 'is', null)
    .order('snap_date', { ascending: false }).limit(1)
  const maxSnapDate = maxSnapRow?.[0]?.snap_date

  type SnapRow = {
    sku_ms: string; margin_pct: number | null; chmd_5d: number | null
    stock_days: number | null; novelty_status: string | null; manager: string | null
    price: number | null; fbo_wb: number | null; fbs_pushkino: number | null
    fbs_smolensk: number | null; kits_stock: number | null
  }
  const snapByMs: Record<string, SnapRow> = {}
  if (maxSnapDate) {
    const snapRows = await fetchAll<SnapRow>(
      (sb) => sb.from('fact_sku_daily')
        .select('sku_ms, margin_pct, chmd_5d, stock_days, novelty_status, manager, price, fbo_wb, fbs_pushkino, fbs_smolensk, kits_stock')
        .eq('snap_date', maxSnapDate),
      supabase,
    )
    for (const r of snapRows) { if (!snapByMs[r.sku_ms]) snapByMs[r.sku_ms] = r }
  }

  // ABC
  type AbcRow = { sku_ms: string; abc_class: string | null }
  const abcByMs: Record<string, AbcRow> = {}
  if (abcId) {
    const abcRows = await fetchAll<AbcRow>(
      (sb) => sb.from('fact_abc').select('sku_ms, abc_class').eq('upload_id', abcId),
      supabase,
    )
    for (const r of abcRows) abcByMs[r.sku_ms] = r
  }

  // fact_sku_daily — метрики за период
  type DailyRow = {
    sku_ms: string; metric_date: string; revenue: number | null; ad_spend: number | null
    drr_total: number | null; ctr: number | null; cr_cart: number | null
    cr_order: number | null; cpm: number | null; cpc: number | null; ad_order_share: number | null
  }
  const [dailyRows, prevDailyRows] = await Promise.all([
    effectiveFrom && effectiveTo
      ? fetchAll<DailyRow>(
          (sb) => sb.from('fact_sku_daily')
            .select('sku_ms, metric_date, revenue, ad_spend, drr_total, ctr, cr_cart, cr_order, cpm, cpc, ad_order_share')
            .gte('metric_date', effectiveFrom!).lte('metric_date', effectiveTo!),
          supabase,
        )
      : Promise.resolve([]),
    prevFrom && prevTo
      ? fetchAll<Pick<DailyRow, 'sku_ms' | 'revenue'>>(
          (sb) => sb.from('fact_sku_daily')
            .select('sku_ms, revenue')
            .gte('metric_date', prevFrom!).lte('metric_date', prevTo!),
          supabase,
        )
      : Promise.resolve([]),
  ])

  // Агрегация предыдущего периода по SKU (только revenue для delta)
  const prevRevByMs: Record<string, number> = {}
  for (const r of prevDailyRows) {
    prevRevByMs[r.sku_ms] = (prevRevByMs[r.sku_ms] ?? 0) + (r.revenue ?? 0)
  }

  // Агрегация daily по SKU
  const skuMsSet = new Set(skuMsList)
  type DailyAgg = { revenue: number; ad_spend: number; drr: number[]; ctr: number[]; cr_cart: number[]; cr_order: number[]; cpm: number[]; days: number }
  const dailyByMs: Record<string, DailyAgg> = {}
  for (const r of dailyRows) {
    if (!skuMsSet.has(r.sku_ms)) continue
    if (!dailyByMs[r.sku_ms]) dailyByMs[r.sku_ms] = { revenue: 0, ad_spend: 0, drr: [], ctr: [], cr_cart: [], cr_order: [], cpm: [], days: 0 }
    const d = dailyByMs[r.sku_ms]
    d.revenue += r.revenue ?? 0
    d.ad_spend += r.ad_spend ?? 0
    if (r.drr_total != null) d.drr.push(r.drr_total)
    if (r.ctr != null) d.ctr.push(r.ctr)
    if (r.cr_cart != null) d.cr_cart.push(r.cr_cart)
    if (r.cr_order != null) d.cr_order.push(r.cr_order)
    if (r.cpm != null) d.cpm.push(r.cpm)
    d.days++
  }

  const avg = (arr: number[]) => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null

  // Собираем строки
  const rows = dimRows.map(sku => {
    const skuSnap = snapByMs[sku.sku_ms]
    const abc = abcByMs[sku.sku_ms]
    const daily = dailyByMs[sku.sku_ms]

    const fbo = skuSnap?.fbo_wb ?? 0
    const fbsPush = skuSnap?.fbs_pushkino ?? 0
    const fbsSmol = skuSnap?.fbs_smolensk ?? 0
    const kits = skuSnap?.kits_stock ?? 0
    const totalStock = fbo + fbsPush + fbsSmol + kits

    const revenue = daily?.revenue ?? 0
    const adSpend = daily?.ad_spend ?? 0
    const drr = revenue > 0 ? adSpend / revenue : (avg(daily?.drr ?? []))
    const ctr = avg(daily?.ctr ?? [])
    const cr_basket = avg(daily?.cr_cart ?? [])
    const cr_order = avg(daily?.cr_order ?? [])
    const cpo = daily && daily.days > 0 && adSpend > 0 ? adSpend / daily.days : null

    const price = skuSnap?.price ?? null
    const forecast30d = daily && daily.days > 0 && price != null && price > 0
      ? Math.round((revenue / daily.days) * 30 / price)
      : null
    const marginPct = skuSnap?.margin_pct ?? 0
    const chmd = skuSnap?.chmd_5d ?? 0
    const stockDays = skuSnap?.stock_days ?? 0
    const abcClass = abc?.abc_class ?? null

    const oos_status: 'critical' | 'warning' | 'ok' =
      totalStock === 0 ? 'critical' : totalStock < 30 ? 'warning' : 'ok'
    const margin_status: 'high' | 'medium' | 'low' =
      marginPct > 0.20 ? 'high' : marginPct > 0.10 ? 'medium' : 'low'

    const score = computeScore({
      margin_pct: marginPct,
      drr: drr ?? 0,
      revenue_growth: 0,
      cr_order: cr_order ?? 0,
      stock_days: stockDays,
      is_oos: totalStock === 0,
      drr_over_margin: drr != null && drr > marginPct,
      is_novelty_low: false,
    })

    return {
      sku: String(sku.sku_wb || sku.sku_ms),
      sku_ms: sku.sku_ms,
      name: sku.name ?? '',
      manager: skuSnap?.manager ?? '',
      category: sku.category_wb ?? sku.subject_wb ?? '',
      revenue,
      margin_pct: marginPct,
      chmd,
      drr: drr ?? null,
      ctr,
      cr_basket,
      cr_order,
      stock_qty: totalStock,
      fbo_wb: fbo,
      fbs_pushkino: fbsPush,
      fbs_smolensk: fbsSmol,
      kits_stock: kits,
      stock_days: stockDays,
      price,
      cpo,
      forecast_30d: forecast30d,
      delta_revenue_pct: (() => {
        const prev = prevRevByMs[sku.sku_ms]
        if (prev == null || prev === 0) return null
        return (revenue - prev) / prev
      })(),
      score,
      abc_class: abcClass,
      oos_status,
      margin_status,
      novelty: skuSnap?.novelty_status === 'Новинки' || skuSnap?.novelty_status === 'new',
    }
  })

  // Apply global filters (category, manager, novelty)
  const filteredRows = rows.filter(r => {
    if (categoryFilter && r.category !== categoryFilter) return false
    if (managerFilter  && r.manager !== managerFilter)  return false
    if (noveltyFilter === 'Новинки'    && !r.novelty)   return false
    if (noveltyFilter === 'Не новинки' && r.novelty)   return false
    return true
  })

  const totalRevenue = filteredRows.reduce((s, r) => s + r.revenue, 0)

  return NextResponse.json({
    rows: filteredRows,
    total: filteredRows.length,
    selected_count: filteredRows.length,
    selected_revenue: totalRevenue,
  })
}
