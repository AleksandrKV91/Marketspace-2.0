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

  // Последние upload_id
  const { data: lastUploads } = await supabase
    .from('uploads').select('id, file_type').eq('status', 'ok')
    .order('uploaded_at', { ascending: false }).limit(20)
  const latestByType: Record<string, string> = {}
  if (lastUploads) for (const u of lastUploads) {
    if (!latestByType[u.file_type]) latestByType[u.file_type] = u.id
  }

  const stockId = latestByType['stock']
  const abcId = latestByType['abc']
  const skuReportId = latestByType['sku_report']

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

  // dim_sku — справочник (фильтрация по поиску) — все строки через пагинацию
  const dimRows = await fetchAll<{ sku_ms: string; sku_wb: number | null; name: string | null; brand: string | null; supplier: string | null; subject_wb: string | null; category_wb: string | null }>(
    (sb) => {
      let q = sb.from('dim_sku').select('sku_ms, sku_wb, name, brand, supplier, subject_wb, category_wb')
      if (search) q = q.or(`name.ilike.%${search}%,sku_ms.ilike.%${search}%,brand.ilike.%${search}%`)
      return q
    },
    supabase,
  )
  if (!dimRows.length) return NextResponse.json({ rows: [], total: 0, selected_count: 0, selected_revenue: 0 })

  const skuMsList = dimRows.map(r => r.sku_ms)
  const wbList = dimRows.map(r => r.sku_wb).filter((v): v is number => v !== null)

  // Хелпер: батчированный запрос через .in() для больших списков (>1000 элементов)
  async function batchIn<T>(
    table: string,
    selectCols: string,
    key: string,
    ids: (string | number)[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    extraFilter?: (q: any) => any,
    batchSize = 500,
  ): Promise<T[]> {
    const results: T[] = []
    for (let i = 0; i < ids.length; i += batchSize) {
      const chunk = ids.slice(i, i + batchSize)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let q: any = supabase.from(table).select(selectCols).in(key, chunk)
      if (extraFilter) q = extraFilter(q)
      const { data } = await q
      if (data) results.push(...(data as T[]))
    }
    return results
  }

  // Параллельные запросы — все через батчи
  const [stockRows, abcRows, skuSnapRows, dailyRows] = await Promise.all([
    // fact_stock_snapshot — остатки по sku_wb
    stockId && wbList.length
      ? batchIn<{ sku_wb: number; sku_ms: string; fbo_wb: number; fbs_pushkino: number; fbs_smolensk: number; total_stock: number; price: number | null; margin_pct: number | null }>(
          'fact_stock_snapshot',
          'sku_wb, sku_ms, fbo_wb, fbs_pushkino, fbs_smolensk, total_stock, price, margin_pct',
          'sku_wb',
          wbList,
          q => q.eq('upload_id', stockId!),
        )
      : Promise.resolve([]),

    // fact_abc — только abc_class как дополнение
    abcId
      ? batchIn<{ sku_ms: string; abc_class: string | null }>(
          'fact_abc', 'sku_ms, abc_class', 'sku_ms', skuMsList,
          q => q.eq('upload_id', abcId!),
        )
      : Promise.resolve([]),

    // fact_sku_snapshot — маржа, ЧМД, запас дней, менеджер
    skuReportId
      ? batchIn<{ sku_ms: string; margin_rub: number | null; chmd_5d: number | null; stock_days: number | null; novelty_status: string | null; manager: string | null; price: number | null; fbo_wb: number | null; fbs_pushkino: number | null; fbs_smolensk: number | null }>(
          'fact_sku_snapshot',
          'sku_ms, margin_rub, chmd_5d, stock_days, novelty_status, manager, price, fbo_wb, fbs_pushkino, fbs_smolensk',
          'sku_ms',
          skuMsList,
          q => q.eq('upload_id', skuReportId!),
        )
      : Promise.resolve([]),

    // fact_sku_daily — выручка, ДРР, CTR, CR за период
    // ВСЕГДА фильтруем по дате (effectiveFrom/effectiveTo) — иначе 176k строк = таймаут
    effectiveFrom && effectiveTo
      ? fetchAll<{ sku_ms: string; metric_date: string; revenue: number | null; ad_spend: number | null; drr_total: number | null; ctr: number | null; cr_cart: number | null; cr_order: number | null; cpm: number | null; cpc: number | null; ad_order_share: number | null }>(
          (sb) => sb.from('fact_sku_daily')
            .select('sku_ms, metric_date, revenue, ad_spend, drr_total, ctr, cr_cart, cr_order, cpm, cpc, ad_order_share')
            .gte('metric_date', effectiveFrom!).lte('metric_date', effectiveTo!),
          supabase,
        )
      : Promise.resolve([]),
  ])

  // Маппинги
  const stockByWb: Record<number, { fbo_wb: number; fbs_pushkino: number; fbs_smolensk: number; total_stock: number; price: number | null; margin_pct: number | null }> = {}
  for (const r of stockRows) stockByWb[r.sku_wb] = r

  const abcByMs: Record<string, { abc_class: string | null }> = {}
  for (const r of abcRows) abcByMs[r.sku_ms] = r

  const snapByMs: Record<string, { margin_rub: number | null; chmd_5d: number | null; stock_days: number | null; novelty_status: string | null; manager: string | null; price: number | null; fbo_wb: number | null; fbs_pushkino: number | null; fbs_smolensk: number | null }> = {}
  for (const r of skuSnapRows) snapByMs[r.sku_ms] = r

  // Агрегация daily по SKU (фильтр по skuMsList в памяти)
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
    const wb = sku.sku_wb ?? 0
    const stockSnap = stockByWb[wb]
    const skuSnap = snapByMs[sku.sku_ms]
    const abc = abcByMs[sku.sku_ms]
    const daily = dailyByMs[sku.sku_ms]

    // Остатки — из fact_stock_snapshot (Таблица остатков, ADC)
    const totalStock = stockSnap?.total_stock ?? 0

    // Выручка, ДРР — из fact_sku_daily
    const revenue = daily?.revenue ?? 0
    const adSpend = daily?.ad_spend ?? 0
    const drr = revenue > 0 ? adSpend / revenue : (avg(daily?.drr ?? []))
    const ctr = avg(daily?.ctr ?? [])
    const cr_basket = avg(daily?.cr_cart ?? [])
    const cr_order = avg(daily?.cr_order ?? [])
    const cpo = daily && daily.days > 0 && adSpend > 0 ? adSpend / daily.days : null

    // Маржа % — из fact_sku_snapshot (колонка X Отчёта по SKU)
    // margin_rub = маржа ₽ на единицу, price = цена → margin_pct = margin_rub / price
    const price = skuSnap?.price ?? stockSnap?.price ?? null
    const marginRub = skuSnap?.margin_rub ?? null
    const marginPct = marginRub != null && price && price > 0 ? marginRub / price : (stockSnap?.margin_pct ?? 0)

    // ЧМД — из fact_sku_snapshot (chmd_5d, колонка Z)
    const chmd = skuSnap?.chmd_5d ?? 0

    // Запас дней — из fact_sku_snapshot (колонка W)
    const stockDays = skuSnap?.stock_days ?? 0

    const abcClass = abc?.abc_class ?? null

    const oos_status: 'critical' | 'warning' | 'ok' | 'none' =
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
      sku: String(wb || sku.sku_ms),
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
      stock_days: stockDays,
      cpo,
      score,
      abc_class: abcClass,
      oos_status,
      margin_status,
      novelty: skuSnap?.novelty_status === 'Новинки' || skuSnap?.novelty_status === 'new',
    }
  })

  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0)

  return NextResponse.json({
    rows,
    total: rows.length,
    selected_count: rows.length,
    selected_revenue: totalRevenue,
  })
}
