import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/supabase/fetchAll'
import { rpcFetchAll } from '@/lib/supabase/rpcFetchAll'
import { cached } from '@/lib/cache'
import { matchesNoveltyFilter } from '@/lib/novelty'

export const maxDuration = 300

function shiftDate(iso: string, days: number): string {
  const d = new Date(iso)
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

function daysBetween(from: string, to: string): number {
  return Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000) + 1
}

export async function GET(req: NextRequest) {
  try {
  const supabase = createServiceClient()
  const { searchParams } = new URL(req.url)
  const search = searchParams.get('search') ?? ''
  const fromParam = searchParams.get('from')
  const toParam = searchParams.get('to')
  const categoryFilter = searchParams.get('category') ?? ''
  const managerFilter  = searchParams.get('manager') ?? ''
  const noveltyFilter  = searchParams.get('novelty') ?? ''

  // Latest upload IDs (TTL 60s)
  const latestByType = await cached('latest_uploads', 60_000, async () => {
    const { data: lastUploads } = await supabase
      .from('uploads').select('id, file_type')
      .eq('status', 'ok').order('uploaded_at', { ascending: false }).limit(20)
    const result: Record<string, string> = {}
    if (lastUploads) for (const u of lastUploads) {
      if (!result[u.file_type]) result[u.file_type] = u.id
    }
    return result
  })
  const skuReportId = latestByType['sku_report']

  // Параллельно: snapshot + dim_sku (cached)
  type SnapRow = { sku_ms: string; sku_wb: number | null; manager: string | null; price: number | null; novelty_status: string | null }
  type DimNameRow = { sku_ms: string; name: string | null; brand: string | null; subject_wb: string | null; category_wb: string | null }

  async function fetchSnapshot(): Promise<SnapRow[]> {
    // Берём снапшот из fact_sku_period по последнему period_end
    const { data: maxSnapRow } = await supabase.from('fact_sku_period')
      .select('period_end')
      .order('period_end', { ascending: false }).limit(1)
    const maxSnapDate = maxSnapRow?.[0]?.period_end
    if (!maxSnapDate) return []
    const rows: SnapRow[] = []
    let snapOffset = 0
    const snapPageSize = 1000
    while (true) {
      const { data, error } = await supabase
        .from('fact_sku_period')
        .select('sku_ms, sku_wb, manager, price, novelty_status')
        .eq('period_end', maxSnapDate)
        .range(snapOffset, snapOffset + snapPageSize - 1)
      if (error || !data || data.length === 0) break
      rows.push(...data)
      if (data.length < snapPageSize) break
      snapOffset += snapPageSize
    }
    return rows
  }

  const [allSnapRows, allDimRows] = await Promise.all([
    fetchSnapshot(),
    cached<DimNameRow[]>('dim_sku_names', 10 * 60_000, async () =>
      fetchAll<DimNameRow>(
        (sb) => sb.from('dim_sku').select('sku_ms, name, brand, subject_wb, category_wb'),
        supabase,
      )
    ),
  ])

  const managerMap: Record<string, string> = {}
  const noveltyMap: Record<string, string> = {}
  const snapPriceMap: Record<string, number> = {}
  const snapSkuWbMap: Record<string, number> = {}
  for (const r of allSnapRows) {
    managerMap[r.sku_ms] = r.manager ?? ''
    noveltyMap[r.sku_ms] = r.novelty_status ?? ''
    if (r.price != null) snapPriceMap[r.sku_ms] = r.price
    if (r.sku_wb != null) snapSkuWbMap[r.sku_ms] = r.sku_wb
  }

  const nameMap: Record<string, DimNameRow> = {}
  for (const r of allDimRows) nameMap[r.sku_ms] = r

  // fact_price_changes — история цен
  // Берём записи с запасом: от (from - 14 дней) чтобы иметь "предыдущую" цену перед периодом
  type PriceRow = { sku_wb: number | null; sku_ms: string | null; price_date: string; price: number | null }
  const priceFrom = fromParam ? shiftDate(fromParam, -14) : null
  const priceRows: PriceRow[] = []
  {
    let offset = 0
    const pageSize = 1000
    while (true) {
      let q = supabase
        .from('fact_price_changes')
        .select('sku_wb, sku_ms, price_date, price')
        .order('price_date', { ascending: true })
        .range(offset, offset + pageSize - 1)
      if (priceFrom) q = q.gte('price_date', priceFrom)
      if (toParam) q = q.lte('price_date', toParam)
      const { data, error } = await q
      if (error || !data || data.length === 0) break
      priceRows.push(...data)
      if (data.length < pageSize) break
      offset += pageSize
    }
  }

  // Определить диапазоны дат
  let fromDaily = fromParam
  let toDaily = toParam
  if (!fromDaily || !toDaily) {
    const { data: maxDateRow } = await supabase
      .from('fact_sku_daily').select('metric_date').order('metric_date', { ascending: false }).limit(1)
    const maxDate = maxDateRow?.[0]?.metric_date ?? null
    if (maxDate) {
      const from7 = new Date(maxDate)
      from7.setDate(from7.getDate() - 6)
      fromDaily = from7.toISOString().split('T')[0]
      toDaily = maxDate
    }
  }

  // Предыдущий период
  let prevFrom: string | null = null
  let prevTo: string | null = null
  if (fromDaily && toDaily) {
    const periodDays = daysBetween(fromDaily, toDaily)
    prevTo = shiftDate(fromDaily, -1)
    prevFrom = shiftDate(prevTo, -(periodDays - 1))
  }

  // Расширенный диапазон для расчёта дельт цен (±14 дней от текущего периода)
  const extFrom = fromDaily ? shiftDate(fromDaily, -14) : null
  const extTo = toDaily ? shiftDate(toDaily, 14) : null

  type DailyRow = {
    sku_ms: string; metric_date: string
    revenue: number | null; ad_spend: number | null
    ctr: number | null; cr_cart: number | null; cr_order: number | null
    cpm: number | null; cpc: number | null; ad_order_share: number | null
    price: number | null
  }

  // Allowed-SKU set (для глобальных фильтров)
  let allowedSkuMs: Set<string> | null = null
  if (categoryFilter || managerFilter || noveltyFilter) {
    allowedSkuMs = new Set<string>()
    const allSkuMs = new Set([...Object.keys(managerMap), ...Object.keys(nameMap)])
    for (const ms of allSkuMs) {
      const meetsManager  = !managerFilter  || (managerMap[ms] ?? '') === managerFilter
      const meetsCategory = !categoryFilter || (nameMap[ms]?.category_wb ?? '') === categoryFilter
      const meetsNovelty  = matchesNoveltyFilter(noveltyMap[ms], noveltyFilter)
      if (meetsManager && meetsCategory && meetsNovelty) allowedSkuMs.add(ms)
    }
  }

  // ── KPI воронки и дневной график через RPC (миграция 022) ──────────────────
  type FunnelPeriodRpc = {
    is_current: boolean
    total_revenue: number; total_ad_spend: number
    ctr_avg: number | null; cr_cart_avg: number | null; cr_order_avg: number | null
    cpm_avg: number | null; cpc_avg: number | null; ad_order_share_avg: number | null
  }
  type DailyFunnelRpc = {
    metric_date: string
    revenue: number; ad_spend: number
    ctr_avg: number | null; cr_cart_avg: number | null; cr_order_avg: number | null
    cpm_avg: number | null; cpc_avg: number | null; ad_order_share_avg: number | null
    price_wgt: number; price_weight: number
  }
  // Если глобальные фильтры активны — fallback к лёгкому fetchAll по нужным SKU.
  // Если фильтров нет (типичный случай) — используем RPC, агрегирующую в Postgres.
  let funnelRows: FunnelPeriodRpc[] = []
  let dailyRpcRows: DailyFunnelRpc[] = []
  // Per-SKU агрегаты (для manager_table) — нужны всегда.
  type SkuPeriodAggRpc = {
    sku_ms: string
    curr_revenue: number; curr_ad_spend: number
    curr_ctr_avg: number | null; curr_cr_order_avg: number | null
    curr_cpm_avg: number | null; curr_cpc_avg: number | null
    curr_cr_cart_avg: number | null
  }
  let perSkuAgg: SkuPeriodAggRpc[] = []
  if (fromDaily && toDaily && prevFrom && prevTo) {
    const perSkuPromise = rpcFetchAll<SkuPeriodAggRpc>(() => supabase.rpc('sku_period_full_agg', {
      p_from: fromDaily, p_to: toDaily, p_prev_from: prevFrom, p_prev_to: prevTo,
    }))
    if (!allowedSkuMs) {
      const [funnelRes, dailyRes, perSkuRes] = await Promise.all([
        rpcFetchAll<FunnelPeriodRpc>(() => supabase.rpc('prices_funnel_period_agg', {
          p_from: fromDaily, p_to: toDaily, p_prev_from: prevFrom, p_prev_to: prevTo,
        })),
        rpcFetchAll<DailyFunnelRpc>(() => supabase.rpc('prices_daily_funnel_agg', {
          p_from: fromDaily, p_to: toDaily,
        })),
        perSkuPromise,
      ])
      const firstErr = funnelRes.error ?? dailyRes.error ?? perSkuRes.error
      if (firstErr) {
        const msg = firstErr.message ?? 'unknown'
        if (/function|prices_funnel_period_agg|prices_daily_funnel_agg|sku_period_full_agg/i.test(msg)) {
          return NextResponse.json({
            error: 'Миграция 022_overview_sku_rpcs не применена. Запустите supabase/022_overview_sku_rpcs.sql в Supabase Studio → SQL editor.',
            details: msg,
          }, { status: 503 })
        }
        return NextResponse.json({ error: msg }, { status: 500 })
      }
      funnelRows = funnelRes.data
      dailyRpcRows = dailyRes.data
      perSkuAgg = perSkuRes.data
    } else {
      const perSkuRes = await perSkuPromise
      if (perSkuRes.error) {
        const msg = perSkuRes.error.message ?? 'unknown'
        if (/function|sku_period_full_agg/i.test(msg)) {
          return NextResponse.json({
            error: 'Миграция 022_overview_sku_rpcs не применена. Запустите supabase/022_overview_sku_rpcs.sql в Supabase Studio → SQL editor.',
            details: msg,
          }, { status: 503 })
        }
        return NextResponse.json({ error: msg }, { status: 500 })
      }
      perSkuAgg = perSkuRes.data
    }
  }

  // Для расчёта дельт цен — daily ТОЛЬКО для SKU с реальными изменениями цен в периоде.
  // Окно ±7 дней вокруг каждой даты изменения.
  const WINDOW = 7
  const skusWithChange = new Set<string>()
  {
    const tmpBySkuWb: Record<number, Array<{ date: string; price: number | null; sku_ms: string | null }>> = {}
    for (const r of priceRows) {
      if (!r.sku_wb) continue
      if (!tmpBySkuWb[r.sku_wb]) tmpBySkuWb[r.sku_wb] = []
      tmpBySkuWb[r.sku_wb].push({ date: r.price_date, price: r.price, sku_ms: r.sku_ms })
    }
    for (const entries of Object.values(tmpBySkuWb)) {
      entries.sort((a, b) => a.date.localeCompare(b.date))
      for (let i = 1; i < entries.length; i++) {
        const cur = entries[i]; const prev = entries[i - 1]
        if (cur.price !== prev.price && cur.date >= (fromParam ?? '') && cur.date <= (toParam ?? '9999')) {
          if (cur.sku_ms) skusWithChange.add(cur.sku_ms)
        }
      }
    }
  }

  // Подсчёт диапазона дат, нужных для дельт цен (минимизация выборки).
  const dailyRows: DailyRow[] = []
  if (extFrom && extTo && skusWithChange.size > 0) {
    const skuList = [...skusWithChange]
    // Chunk по 200 SKU чтобы PostgREST URL не разрастался.
    for (let i = 0; i < skuList.length; i += 200) {
      const chunk = skuList.slice(i, i + 200)
      const rows = await fetchAll<DailyRow>(
        (sb) => sb.from('fact_sku_daily')
          .select('sku_ms, metric_date, revenue, ad_spend, ctr, cr_cart, cr_order, cpm, cpc, ad_order_share, price')
          .in('sku_ms', chunk)
          .gte('metric_date', extFrom!).lte('metric_date', extTo!),
        supabase,
      )
      dailyRows.push(...rows)
    }
  }

  // Fallback при активных фильтрах: тянуть полный daily, но только за период (без расширения),
  // для KPI и daily-графика — иначе RPC игнорирует фильтр SKU.
  let currDailyRows: DailyRow[] = []
  let prevDailyRows: DailyRow[] = []
  if (allowedSkuMs && fromDaily && toDaily) {
    const skuList = [...allowedSkuMs]
    for (let i = 0; i < skuList.length; i += 200) {
      const chunk = skuList.slice(i, i + 200)
      const [currR, prevR] = await Promise.all([
        fetchAll<DailyRow>(
          (sb) => sb.from('fact_sku_daily')
            .select('sku_ms, metric_date, revenue, ad_spend, ctr, cr_cart, cr_order, cpm, cpc, ad_order_share, price')
            .in('sku_ms', chunk)
            .gte('metric_date', fromDaily!).lte('metric_date', toDaily!),
          supabase,
        ),
        prevFrom && prevTo ? fetchAll<DailyRow>(
          (sb) => sb.from('fact_sku_daily')
            .select('sku_ms, metric_date, revenue, ad_spend, ctr, cr_cart, cr_order, cpm, cpc, ad_order_share, price')
            .in('sku_ms', chunk)
            .gte('metric_date', prevFrom).lte('metric_date', prevTo),
          supabase,
        ) : Promise.resolve([]),
      ])
      currDailyRows.push(...currR)
      prevDailyRows.push(...prevR)
    }
  }

  // Индекс daily по (sku_ms, metric_date) для расчёта дельт цен
  type DayKey = string
  const dailyIndex: Record<DayKey, DailyRow> = {}
  for (const r of dailyRows) {
    dailyIndex[`${r.sku_ms}|${r.metric_date}`] = r
  }

  function avgWindow(sku_ms: string, fromDate: string, toDate: string, field: keyof DailyRow): number | null {
    const vals: number[] = []
    const start = new Date(fromDate)
    const end = new Date(toDate)
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const key = `${sku_ms}|${d.toISOString().split('T')[0]}`
      const row = dailyIndex[key]
      const v = row ? (row[field] as number | null) : null
      if (v != null) vals.push(v)
    }
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null
  }

  const avg = (arr: number[]) => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0
  function avgRows(rows: DailyRow[], field: keyof DailyRow): number {
    const vals = rows.map(r => r[field] as number | null).filter((v): v is number => v != null)
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0
  }

  // ── Воронка: KPI period и daily-chart ─────────────────────────────────────
  let totalRevenue = 0
  let totalAdSpend = 0
  let avgDayCtr = 0, avgDayCrCart = 0, avgDayCrOrder = 0
  let avgDayCpm = 0, avgDayCpc = 0, avgDayAdShare = 0
  let prevTotalRevenue = 0, prevTotalAdSpend = 0
  let prevAvgCpc = 0, prevAvgCrOrder = 0
  let prevAvgCtr = 0, prevAvgCrCart = 0, prevAvgCpm = 0, prevAvgAdShare = 0

  if (allowedSkuMs) {
    // ── Фильтры активны — считаем по урезанной выборке currDailyRows / prevDailyRows ──
    for (const r of currDailyRows) {
      totalRevenue += r.revenue ?? 0
      totalAdSpend += r.ad_spend ?? 0
    }
    avgDayCtr     = avgRows(currDailyRows, 'ctr')
    avgDayCrCart  = avgRows(currDailyRows, 'cr_cart')
    avgDayCrOrder = avgRows(currDailyRows, 'cr_order')
    avgDayCpm     = avgRows(currDailyRows, 'cpm')
    avgDayCpc     = avgRows(currDailyRows, 'cpc')
    avgDayAdShare = avgRows(currDailyRows, 'ad_order_share')
    for (const r of prevDailyRows) {
      prevTotalRevenue += r.revenue ?? 0
      prevTotalAdSpend += r.ad_spend ?? 0
    }
    prevAvgCpc     = avgRows(prevDailyRows, 'cpc')
    prevAvgCrOrder = avgRows(prevDailyRows, 'cr_order')
    prevAvgCtr     = avgRows(prevDailyRows, 'ctr')
    prevAvgCrCart  = avgRows(prevDailyRows, 'cr_cart')
    prevAvgCpm     = avgRows(prevDailyRows, 'cpm')
    prevAvgAdShare = avgRows(prevDailyRows, 'ad_order_share')
  } else {
    // ── Фильтров нет — KPI из RPC ──
    for (const r of funnelRows) {
      if (r.is_current) {
        totalRevenue   = Number(r.total_revenue  ?? 0)
        totalAdSpend   = Number(r.total_ad_spend ?? 0)
        avgDayCtr      = Number(r.ctr_avg          ?? 0)
        avgDayCrCart   = Number(r.cr_cart_avg      ?? 0)
        avgDayCrOrder  = Number(r.cr_order_avg     ?? 0)
        avgDayCpm      = Number(r.cpm_avg          ?? 0)
        avgDayCpc      = Number(r.cpc_avg          ?? 0)
        avgDayAdShare  = Number(r.ad_order_share_avg ?? 0)
      } else {
        prevTotalRevenue  = Number(r.total_revenue  ?? 0)
        prevTotalAdSpend  = Number(r.total_ad_spend ?? 0)
        prevAvgCpc        = Number(r.cpc_avg          ?? 0)
        prevAvgCrOrder    = Number(r.cr_order_avg     ?? 0)
        prevAvgCtr        = Number(r.ctr_avg          ?? 0)
        prevAvgCrCart     = Number(r.cr_cart_avg      ?? 0)
        prevAvgCpm        = Number(r.cpm_avg          ?? 0)
        prevAvgAdShare    = Number(r.ad_order_share_avg ?? 0)
      }
    }
  }

  const drr = totalRevenue > 0 ? totalAdSpend / totalRevenue : 0
  const cpo = avgDayCrOrder > 0 ? avgDayCpc / avgDayCrOrder : 0

  const funnel = {
    ctr: avgDayCtr,
    cr_basket: avgDayCrCart,
    cr_order: avgDayCrOrder,
    cpc: avgDayCpc,
    cpm: avgDayCpm,
    ad_order_share: avgDayAdShare,
    drr,
    cpo,
  }

  const prevDrr = prevTotalRevenue > 0 ? prevTotalAdSpend / prevTotalRevenue : 0
  const prevCpo = prevAvgCrOrder > 0 ? prevAvgCpc / prevAvgCrOrder : 0

  const prev_funnel = {
    ctr: prevAvgCtr,
    cr_basket: prevAvgCrCart,
    cr_order: prevAvgCrOrder,
    cpc: prevAvgCpc,
    cpm: prevAvgCpm,
    ad_order_share: prevAvgAdShare,
    drr: prevDrr,
    cpo: prevCpo,
  }

  // ── Daily chart ────────────────────────────────────────────────────────────
  type DayChart = { date: string; ctr: number; cr_basket: number; cr_order: number; ad_revenue: number; organic_revenue: number; avg_price: number | null }
  let daily: DayChart[] = []
  if (allowedSkuMs) {
    type DayAgg = {
      ctrSum: number; ctrN: number; crCartSum: number; crCartN: number; crOrderSum: number; crOrderN: number
      adShareSum: number; adShareN: number; revenue: number
      priceWeightedSum: number; priceWeightTotal: number
    }
    const dateMap: Record<string, DayAgg> = {}
    for (const r of currDailyRows) {
      const d = r.metric_date
      if (!dateMap[d]) dateMap[d] = { ctrSum: 0, ctrN: 0, crCartSum: 0, crCartN: 0, crOrderSum: 0, crOrderN: 0, adShareSum: 0, adShareN: 0, revenue: 0, priceWeightedSum: 0, priceWeightTotal: 0 }
      const day = dateMap[d]
      const rev = r.revenue ?? 0
      day.revenue += rev
      if (r.ctr != null) { day.ctrSum += r.ctr; day.ctrN++ }
      if (r.cr_cart != null) { day.crCartSum += r.cr_cart; day.crCartN++ }
      if (r.cr_order != null) { day.crOrderSum += r.cr_order; day.crOrderN++ }
      if (r.ad_order_share != null) { day.adShareSum += r.ad_order_share; day.adShareN++ }
      if (r.price != null && rev > 0) { day.priceWeightedSum += r.price * rev; day.priceWeightTotal += rev }
    }
    daily = Object.entries(dateMap).sort(([a], [b]) => a.localeCompare(b)).map(([date, d]) => {
      const adShare = d.adShareN > 0 ? d.adShareSum / d.adShareN : 0
      const avg_price = d.priceWeightTotal > 0 ? Math.round(d.priceWeightedSum / d.priceWeightTotal) : null
      return {
        date,
        ctr: d.ctrN > 0 ? d.ctrSum / d.ctrN : 0,
        cr_basket: d.crCartN > 0 ? d.crCartSum / d.crCartN : 0,
        cr_order: d.crOrderN > 0 ? d.crOrderSum / d.crOrderN : 0,
        ad_revenue: Math.round(d.revenue * adShare),
        organic_revenue: Math.round(d.revenue * (1 - adShare)),
        avg_price,
      }
    })
  } else {
    daily = dailyRpcRows.map(r => {
      const adShare = Number(r.ad_order_share_avg ?? 0)
      const rev = Number(r.revenue ?? 0)
      const avg_price = Number(r.price_weight ?? 0) > 0 ? Math.round(Number(r.price_wgt) / Number(r.price_weight)) : null
      return {
        date: r.metric_date,
        ctr:       Number(r.ctr_avg      ?? 0),
        cr_basket: Number(r.cr_cart_avg  ?? 0),
        cr_order:  Number(r.cr_order_avg ?? 0),
        ad_revenue:     Math.round(rev * adShare),
        organic_revenue: Math.round(rev * (1 - adShare)),
        avg_price,
      }
    }).sort((a, b) => a.date.localeCompare(b.date))
  }

  // Построить историю цен по sku_wb: Map<sku_wb → sorted entries asc>
  const bySkuWb: Record<number, Array<{ date: string; price: number | null; sku_ms: string | null }>> = {}
  for (const r of priceRows) {
    if (!r.sku_wb) continue
    if (!bySkuWb[r.sku_wb]) bySkuWb[r.sku_wb] = []
    bySkuWb[r.sku_wb].push({ date: r.price_date, price: r.price, sku_ms: r.sku_ms })
  }
  // Отсортировать каждую историю по дате возрастания
  for (const entries of Object.values(bySkuWb)) {
    entries.sort((a, b) => a.date.localeCompare(b.date))
  }

  // Для каждого sku_wb найти изменения цен, которые попали в выбранный период
  // "Изменение" = entry[i].price !== entry[i-1].price
  // Для строк без изменений — берём последнюю цену до/на конец периода
  const periodFrom = fromParam ?? ''
  const periodTo = toParam ?? ''

  type ChangeRow = {
    sku: string; name: string; manager: string
    date: string; price_before: number; price_after: number; delta_pct: number
    has_change: boolean  // true = реальное изменение цены в периоде
    delta_ctr?: number; delta_cr_basket?: number; delta_cr_order?: number
    cpo?: number; delta_cpm?: number; delta_cpc?: number
    ad_spend_before?: number; ad_spend_after?: number; delta_ad_spend?: number
  }
  const changes: ChangeRow[] = []

  // Карта sku_wb → sku_ms из priceRows (берём первое вхождение)
  const skuWbToSkuMs: Record<number, string> = {}
  for (const r of priceRows) {
    if (r.sku_wb && r.sku_ms && !skuWbToSkuMs[r.sku_wb]) skuWbToSkuMs[r.sku_wb] = r.sku_ms
  }

  // Обработать SKU у которых есть история цен
  const processedSkuMs = new Set<string>()

  for (const [skuWbStr, entries] of Object.entries(bySkuWb)) {
    const skuWb = Number(skuWbStr)
    const skuMs = skuWbToSkuMs[skuWb] ?? null
    if (skuMs) processedSkuMs.add(skuMs)
    const dim = skuMs ? nameMap[skuMs] : null
    const manager = skuMs ? (managerMap[skuMs] ?? '') : ''

    // Найти изменения цен внутри периода
    let foundChangeInPeriod = false
    for (let i = 1; i < entries.length; i++) {
      const cur = entries[i]
      const prev = entries[i - 1]
      // Изменение: цена реально изменилась и дата попадает в период
      if (cur.price !== prev.price && cur.date >= periodFrom && cur.date <= periodTo) {
        foundChangeInPeriod = true
        const delta = prev.price && cur.price ? (cur.price - prev.price) / prev.price : 0

        let delta_ctr: number | undefined
        let delta_cr_basket: number | undefined
        let delta_cr_order: number | undefined
        let delta_cpm: number | undefined
        let delta_cpc: number | undefined
        let change_cpo: number | undefined

        if (skuMs) {
          const beforeFrom = shiftDate(cur.date, -WINDOW)
          const beforeTo = shiftDate(cur.date, -1)
          const afterFrom = cur.date
          const afterTo = shiftDate(cur.date, WINDOW)

          const ctrBefore = avgWindow(skuMs, beforeFrom, beforeTo, 'ctr')
          const ctrAfter = avgWindow(skuMs, afterFrom, afterTo, 'ctr')
          if (ctrBefore != null && ctrAfter != null) delta_ctr = ctrAfter - ctrBefore

          const crCartBefore = avgWindow(skuMs, beforeFrom, beforeTo, 'cr_cart')
          const crCartAfter = avgWindow(skuMs, afterFrom, afterTo, 'cr_cart')
          if (crCartBefore != null && crCartAfter != null) delta_cr_basket = crCartAfter - crCartBefore

          const crOrderBefore = avgWindow(skuMs, beforeFrom, beforeTo, 'cr_order')
          const crOrderAfter = avgWindow(skuMs, afterFrom, afterTo, 'cr_order')
          if (crOrderBefore != null && crOrderAfter != null) delta_cr_order = crOrderAfter - crOrderBefore

          const cpmBefore = avgWindow(skuMs, beforeFrom, beforeTo, 'cpm')
          const cpmAfter = avgWindow(skuMs, afterFrom, afterTo, 'cpm')
          if (cpmBefore != null && cpmAfter != null) delta_cpm = cpmAfter - cpmBefore

          const cpcBefore = avgWindow(skuMs, beforeFrom, beforeTo, 'cpc')
          const cpcAfter = avgWindow(skuMs, afterFrom, afterTo, 'cpc')
          if (cpcBefore != null && cpcAfter != null) delta_cpc = cpcAfter - cpcBefore

          if (cpcAfter != null && crOrderAfter != null && crOrderAfter > 0) {
            change_cpo = cpcAfter / crOrderAfter
          }
        }

        let ad_spend_before: number | undefined
        let ad_spend_after: number | undefined
        let delta_ad_spend: number | undefined
        if (skuMs) {
          const beforeFrom = shiftDate(cur.date, -WINDOW)
          const beforeTo = shiftDate(cur.date, -1)
          const afterFrom = cur.date
          const afterTo = shiftDate(cur.date, WINDOW)
          const spBefore = avgWindow(skuMs, beforeFrom, beforeTo, 'ad_spend')
          const spAfter = avgWindow(skuMs, afterFrom, afterTo, 'ad_spend')
          if (spBefore != null) ad_spend_before = Math.round(spBefore * WINDOW)
          if (spAfter != null) ad_spend_after = Math.round(spAfter * WINDOW)
          if (ad_spend_before != null && ad_spend_after != null) delta_ad_spend = ad_spend_after - ad_spend_before
        }

        // price_before: prefer previous history entry; fallback to snapshot price
        const priceBefore = prev.price ?? (skuMs ? (snapPriceMap[skuMs] ?? 0) : 0)
        const priceAfter = cur.price ?? 0
        const deltaFixed = priceBefore > 0 && priceAfter > 0 ? (priceAfter - priceBefore) / priceBefore : delta

        changes.push({
          sku: String(skuWb),
          name: dim?.name ?? skuMs ?? '',
          manager,
          date: cur.date,
          price_before: priceBefore,
          price_after: priceAfter,
          delta_pct: deltaFixed,
          has_change: true,
          delta_ctr,
          delta_cr_basket,
          delta_cr_order,
          cpo: change_cpo,
          delta_cpm,
          delta_cpc,
          ad_spend_before,
          ad_spend_after,
          delta_ad_spend,
        })
      }
    }

    // Если в периоде не было изменений — добавить строку с текущей ценой (без дельты)
    if (!foundChangeInPeriod) {
      const lastEntry = entries.filter(e => e.date <= periodTo).slice(-1)[0]
        ?? entries[entries.length - 1]
      if (lastEntry) {
        const currentPrice = lastEntry.price ?? (skuMs ? snapPriceMap[skuMs] ?? 0 : 0)
        changes.push({
          sku: String(skuWb),
          name: dim?.name ?? skuMs ?? '',
          manager,
          date: lastEntry.date,
          price_before: currentPrice,
          price_after: currentPrice,
          delta_pct: 0,
          has_change: false,
        })
      }
    }
  }

  // Добавить SKU из снапшота, которых вообще нет в fact_price_changes
  for (const snap of allSnapRows) {
    if (processedSkuMs.has(snap.sku_ms)) continue
    const dim = nameMap[snap.sku_ms]
    const skuWb = snap.sku_wb ?? snapSkuWbMap[snap.sku_ms]
    changes.push({
      sku: skuWb ? String(skuWb) : snap.sku_ms,
      name: dim?.name ?? snap.sku_ms,
      manager: managerMap[snap.sku_ms] ?? '',
      date: '',
      price_before: snap.price ?? 0,
      price_after: snap.price ?? 0,
      delta_pct: 0,
      has_change: false,
    })
  }

  // Сортировка: сначала строки с изменением (по дате desc), потом без изменений
  changes.sort((a, b) => {
    if (a.has_change && !b.has_change) return -1
    if (!a.has_change && b.has_change) return 1
    return b.date.localeCompare(a.date)
  })

  // Manager table — агрегация per-SKU средних из sku_period_full_agg по managerMap.
  // ad_order_share берём из дневной агрегации (RPC даёт период_avg в funnelRows),
  // но per-manager мы его не считаем — оставляем revenue-долю как пропорцию выручки.
  type MgrAgg = {
    ctrSum: number; ctrN: number
    crOrderSum: number; crOrderN: number
    adShareSum: number; adShareN: number
    revenue: number
    skus: Set<string>
  }
  const mgrAgg: Record<string, MgrAgg> = {}
  for (const r of perSkuAgg) {
    if (allowedSkuMs && !allowedSkuMs.has(r.sku_ms)) continue
    const mgr = managerMap[r.sku_ms] || 'Без менеджера'
    if (!mgrAgg[mgr]) mgrAgg[mgr] = { ctrSum: 0, ctrN: 0, crOrderSum: 0, crOrderN: 0, adShareSum: 0, adShareN: 0, revenue: 0, skus: new Set() }
    const m = mgrAgg[mgr]
    m.revenue += Number(r.curr_revenue ?? 0)
    m.skus.add(r.sku_ms)
    if (r.curr_ctr_avg != null)      { m.ctrSum    += Number(r.curr_ctr_avg);      m.ctrN++ }
    if (r.curr_cr_order_avg != null) { m.crOrderSum += Number(r.curr_cr_order_avg); m.crOrderN++ }
  }

  const manager_table = Object.entries(mgrAgg)
    .map(([manager, m]) => ({
      manager,
      ctr: m.ctrN ? m.ctrSum / m.ctrN : 0,
      cr_order: m.crOrderN ? m.crOrderSum / m.crOrderN : 0,
      ad_order_share: m.adShareN ? m.adShareSum / m.adShareN : 0,
      revenue: m.revenue,
      sku_count: m.skus.size,
    }))
    .sort((a, b) => b.revenue - a.revenue)

  return NextResponse.json({ funnel, prev_funnel, daily, price_changes: changes, manager_table })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[prices] ERROR:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
