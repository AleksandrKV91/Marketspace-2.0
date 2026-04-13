'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import {
  ComposedChart, AreaChart, Area, Line, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts'
import { GlassCard } from '@/components/ui/GlassCard'
import { KPIBar } from '@/components/ui/KPIBar'
import { SkuModal } from '@/components/ui/SkuModal'
import { useDateRange } from '@/components/ui/DateRangePicker'
import { useGlobalFilters } from '@/app/dashboard/page'
import { ChevronUp, ChevronDown, ChevronRight, Download, Search, X } from 'lucide-react'
import type { AnalyticsResponse, CategoryNode, SubjectNode, SkuNode } from '@/app/api/dashboard/analytics/route'

// ── Formatters ────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined) {
  if (n == null) return '—'
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'М'
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(0) + 'К'
  return String(Math.round(n))
}
function fmtPct(n: number | null | undefined) {
  if (n == null) return '—'
  return (n * 100).toFixed(1) + '%'
}
function fmtDate(iso: string) {
  const d = new Date(iso)
  return `${d.getDate().toString().padStart(2, '0')}.${(d.getMonth() + 1).toString().padStart(2, '0')}`
}

// ── Chart Tooltip ─────────────────────────────────────────────────────────────

function ChartTip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="glass p-3 text-xs min-w-[140px]" style={{ color: 'var(--text)' }}>
      <p className="font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>{label}</p>
      {payload.map(p => (
        <div key={p.name} className="flex items-center gap-2 mb-1">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span style={{ color: 'var(--text-muted)' }}>{p.name}:</span>
          <span className="font-bold ml-auto">
            {p.name.includes('%') ? `${p.value.toFixed(1)}%` : fmt(p.value)}
          </span>
        </div>
      ))}
    </div>
  )
}

// ── Column filter dropdown ────────────────────────────────────────────────────

function ColFilter({ label, value, onChange, options }: {
  label: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  const active = value !== 'all'
  return (
    <div className="relative flex items-center">
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="appearance-none pl-2 pr-5 py-1 rounded-lg text-[11px] font-medium cursor-pointer"
        style={{
          background: active ? 'var(--accent-glass)' : 'var(--surface)',
          border: '1px solid ' + (active ? 'var(--accent)' : 'var(--border)'),
          color: active ? 'var(--accent)' : 'var(--text-muted)',
          outline: 'none',
        }}
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.value === 'all' ? label : o.label}</option>
        ))}
      </select>
      <ChevronDown size={9} className="absolute right-1 pointer-events-none" style={{ color: active ? 'var(--accent)' : 'var(--text-muted)' }} />
    </div>
  )
}

// ── Sort helper ───────────────────────────────────────────────────────────────

type SortKey = 'revenue' | 'delta_pct' | 'chmd' | 'margin_pct' | 'drr' | 'stock_rub' | 'stock_qty' | 'forecast_30d_qty' | 'forecast_30d_rev' | 'stock_days'

function SortTh({ label, sortKey, current, dir, onClick, align = 'right' }: {
  label: string; sortKey: SortKey; current: SortKey; dir: 'asc' | 'desc'; onClick: (k: SortKey) => void; align?: 'left' | 'right'
}) {
  const active = current === sortKey
  return (
    <th
      className={`pb-2 font-medium cursor-pointer select-none whitespace-nowrap text-${align}`}
      style={{ color: active ? 'var(--accent)' : 'var(--text-subtle)', fontSize: 11 }}
      onClick={() => onClick(sortKey)}
    >
      <span className={`inline-flex items-center gap-0.5 ${align === 'right' ? 'justify-end' : ''}`}>
        {label}
        {active
          ? (dir === 'asc' ? <ChevronUp size={10} /> : <ChevronDown size={10} />)
          : <ChevronDown size={10} style={{ opacity: 0.25 }} />}
      </span>
    </th>
  )
}

// ── CSV export ────────────────────────────────────────────────────────────────

function exportCsv(hierarchy: CategoryNode[]) {
  const rows: string[] = ['Категория,Предмет,SKU WB,SKU MS,Название,Выручка,Δ%,ЧМД,Маржа%,ДРР%,Остаток(руб),Остаток(шт),Прогноз30д(шт),Прогноз30д(руб)']
  for (const cat of hierarchy) {
    for (const subj of cat.subjects) {
      for (const sku of subj.skus) {
        const fcRev = sku.forecast_30d_qty != null ? Math.round(sku.forecast_30d_qty * sku.price) : ''
        rows.push([
          cat.category, subj.subject, sku.sku_ms, sku.sku_wb ?? '', `"${sku.name}"`,
          sku.revenue, sku.delta_pct != null ? (sku.delta_pct * 100).toFixed(1) : '',
          sku.chmd, (sku.margin_pct * 100).toFixed(1), (sku.drr * 100).toFixed(1),
          sku.stock_rub, sku.stock_qty, sku.forecast_30d_qty ?? '', fcRev,
        ].join(','))
      }
    }
  }
  const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'Продажи_и_экономика.csv'; a.click()
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AnalyticsTab() {
  const { range } = useDateRange()
  const { filters, setMeta } = useGlobalFilters()
  const tableRef = useRef<HTMLDivElement>(null)
  const filterRowRef = useRef<HTMLDivElement>(null)
  const [stickyTop, setStickyTop] = useState({ filterRow: 110, thead: 110 + 52 })

  const [data, setData] = useState<AnalyticsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Hierarchical expand state: Set of expanded category keys, Set of expanded subject keys
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set())
  const [expandedSubjs, setExpandedSubjs] = useState<Set<string>>(new Set())

  // Sort
  const [sortKey, setSortKey] = useState<SortKey>('revenue')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  // Table filter
  const [search, setSearch] = useState('')
  const [deltaFilter, setDeltaFilter] = useState<'all' | 'growth' | 'decline'>('all')
  // Numeric column filters (collapsed state)
  const [stockDaysFilter, setStockDaysFilter] = useState<'all' | 'low' | 'ok' | 'high'>('all')
  const [stockRubFilter, setStockRubFilter] = useState<'all' | 'low' | 'high'>('all')
  const [forecastQtyFilter, setForecastQtyFilter] = useState<'all' | 'oos_risk' | 'ok'>('all')
  const [forecastRevFilter, setForecastRevFilter] = useState<'all' | 'low' | 'high'>('all')

  // SKU modal
  const [modalSku, setModalSku] = useState<string | null>(null)

  // Measure actual header height for sticky positioning
  useEffect(() => {
    function measure() {
      const header = document.querySelector('header.top-nav') as HTMLElement | null
      const filterRow = filterRowRef.current
      const headerH = header ? header.getBoundingClientRect().height : 88
      const filterH = filterRow ? filterRow.getBoundingClientRect().height : 44
      setStickyTop({ filterRow: headerH, thead: headerH + filterH })
    }
    // Wait for layout to complete
    const t = setTimeout(() => requestAnimationFrame(measure), 100)
    window.addEventListener('resize', measure)
    return () => { clearTimeout(t); window.removeEventListener('resize', measure) }
  }, [])

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  const scrollToTable = useCallback(() => {
    tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  const handleForecastClick = useCallback(() => {
    // Expand all categories, sort by forecast
    if (data) {
      setExpandedCats(new Set(data.hierarchy.map((c: CategoryNode) => c.category)))
      setExpandedSubjs(new Set(
        data.hierarchy.flatMap((c: CategoryNode) => c.subjects.map((s: SubjectNode) => `${c.category}::${s.subject}`))
      ))
    }
    setSortKey('forecast_30d_qty')
    setSortDir('desc')
    scrollToTable()
  }, [data, scrollToTable])

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams({ from: range.from, to: range.to })
    if (filters.category) params.set('category', filters.category)
    if (filters.manager)  params.set('manager', filters.manager)
    if (filters.novelty)  params.set('novelty', filters.novelty)

    fetch(`/api/dashboard/analytics?${params}`)
      .then(r => r.json())
      .then((d: AnalyticsResponse) => {
        setData(d)
        setMeta({ categories: d.meta.categories, managers: d.meta.managers })
        setLoading(false)
      })
      .catch((e: unknown) => { setError(String(e)); setLoading(false) })
  }, [range.from, range.to, filters.category, filters.manager, filters.novelty, setMeta])

  if (loading) return (
    <div className="py-6 space-y-6">
      <KPIBar loading items={[
        { label: 'Выручка', value: '' }, { label: 'ЧМД', value: '' },
        { label: 'Маржа %', value: '' }, { label: 'ДРР', value: '' },
        { label: 'CPO', value: '' }, { label: 'Прогноз 30д', value: '' },
      ]} />
    </div>
  )
  if (error) return <div className="py-16 text-center text-sm" style={{ color: 'var(--danger)' }}>{error}</div>
  if (!data) return null

  const { kpi, hierarchy, daily_chart, daily_chart_prev, daily_by_sku } = data

  // Delta helpers
  function calcDelta(curr: number, prev: number): string | undefined {
    if (prev === 0) return undefined
    const d = (curr - prev) / Math.abs(prev) * 100
    return (d >= 0 ? '+' : '') + d.toFixed(1) + '%'
  }
  const deltaRev      = calcDelta(activeKpi.revenue, activeKpi.prev_revenue)
  const deltaChmd     = calcDelta(activeKpi.chmd, activeKpi.prev_chmd)
  const deltaMargin   = calcDelta(activeKpi.margin_pct, activeKpi.prev_margin_pct)
  const deltaDrr      = calcDelta(activeKpi.drr, activeKpi.prev_drr)
  const deltaCpo      = activeKpi.cpo != null && activeKpi.prev_cpo != null
    ? calcDelta(activeKpi.cpo, activeKpi.prev_cpo)
    : undefined

  // Collect visible SKU set for chart filtering (populated after filterSkus calls below)
  // We compute it eagerly here so charts respond to table filters
  const visibleSkuMs = new Set<string>()
  for (const cat of hierarchy) {
    for (const subj of cat.subjects) {
      for (const sku of filterSkus(subj.skus)) visibleSkuMs.add(sku.sku_ms)
    }
  }
  const isFiltered = visibleSkuMs.size < hierarchy.reduce((s, c) => s + c.subjects.reduce((ss, subj) => ss + subj.skus.length, 0), 0)

  // Build filtered daily chart from daily_by_sku when table filters are active
  function buildFilteredChart() {
    if (!isFiltered || !daily_by_sku?.length) return null
    const dateMap: Record<string, { revenue: number; ad_spend: number }> = {}
    for (const r of daily_by_sku) {
      if (!visibleSkuMs.has(r.sku_ms)) continue
      if (!dateMap[r.date]) dateMap[r.date] = { revenue: 0, ad_spend: 0 }
      dateMap[r.date].revenue += r.revenue
      dateMap[r.date].ad_spend += r.ad_spend
    }
    return Object.entries(dateMap).sort(([a], [b]) => a.localeCompare(b))
      .map(([date, d]) => ({ date, revenue: d.revenue, ad_spend: d.ad_spend, drr: d.revenue > 0 ? d.ad_spend / d.revenue : 0 }))
  }
  const filteredChart = buildFilteredChart()
  const activeChart = filteredChart ?? daily_chart

  // Chart data
  const chartData = activeChart.map(d => ({
    date:    fmtDate(d.date),
    Выручка: d.revenue,
    ЧМД:     'chmd' in d ? d.chmd : d.revenue * activeKpi.margin_pct - d.ad_spend,
    Расходы: d.ad_spend,
    'ДРР%':  +(d.drr * 100).toFixed(1),
  }))

  const marginDrrData = activeChart.map(d => ({
    date:     fmtDate(d.date),
    'Маржа%': 'margin_pct' in d ? +((d.margin_pct as number) * 100).toFixed(1) : +(activeKpi.margin_pct * 100).toFixed(1),
    'ДРР%':   +(d.drr * 100).toFixed(1),
  }))

  // Filtered KPI — пересчитываем из видимых SKU когда фильтр активен
  const activeKpi = (() => {
    if (!isFiltered) return kpi
    let revenue = 0, chmd = 0, ad_spend = 0, margin_num = 0
    for (const cat of hierarchy) {
      for (const subj of cat.subjects) {
        for (const sku of filterSkus(subj.skus)) {
          revenue += sku.revenue
          chmd += sku.chmd
          ad_spend += sku.drr * sku.revenue
          margin_num += sku.margin_pct * sku.revenue
        }
      }
    }
    const drr = revenue > 0 ? ad_spend / revenue : 0
    const margin_pct = revenue > 0 ? margin_num / revenue : 0
    const forecast_30d_revenue = kpi.period_days > 0 ? (revenue / kpi.period_days) * 30 : 0
    return {
      ...kpi,
      revenue, chmd, drr, margin_pct, forecast_30d_revenue,
      // prev не пересчитываем — нет prev_daily_by_sku
      prev_revenue: kpi.prev_revenue, prev_chmd: kpi.prev_chmd,
      prev_margin_pct: kpi.prev_margin_pct, prev_drr: kpi.prev_drr,
      sku_count: visibleSkuMs.size,
    }
  })()

  // Comparison chart — используем activeChart вместо daily_chart
  const maxDays = Math.max(activeChart.length, daily_chart_prev?.length ?? 0)
  const compData: Array<{ day: number; currDate?: string; prevDate?: string; 'Текущий период'?: number; 'Пред. период'?: number; 'Прогноз'?: number }> = []
  const actualDays = activeChart.length
  const totalRevenueSoFar = activeChart.reduce((s, d) => s + d.revenue, 0)
  const avgDailyRev = actualDays > 0 ? totalRevenueSoFar / actualDays : 0
  for (let i = 0; i < maxDays; i++) {
    const curr = activeChart[i]
    const prev = daily_chart_prev?.[i]
    compData.push({
      day: i + 1,
      currDate: curr?.date ? fmtDate(curr.date) : undefined,
      prevDate: prev?.date ? fmtDate(prev.date) : undefined,
      'Текущий период': curr?.revenue,
      'Пред. период':   isFiltered ? undefined : prev?.revenue,
      'Прогноз': i >= actualDays ? Math.round(avgDailyRev) : undefined,
    })
  }
  const periodTarget = kpi.period_days
  if (actualDays < periodTarget) {
    for (let i = maxDays; i < periodTarget; i++) {
      compData.push({ day: i + 1, 'Прогноз': Math.round(avgDailyRev) })
    }
  }

  // Apply search + delta filter to SKU nodes, recompute rollup for display
  function filterSkus(skus: SkuNode[]): SkuNode[] {
    return skus.filter(s => {
      if (search) {
        const q = search.toLowerCase()
        if (!s.name.toLowerCase().includes(q) && !String(s.sku_wb ?? '').includes(q) && !s.sku_ms.toLowerCase().includes(q)) return false
      }
      if (deltaFilter === 'growth'  && (s.delta_pct == null || s.delta_pct <= 0)) return false
      if (deltaFilter === 'decline' && (s.delta_pct == null || s.delta_pct >= 0)) return false
      // stock_days filter (from stock_qty/price approximation or snapshot days_to_arrival)
      if (stockDaysFilter !== 'all') {
        const days = s.stock_days ?? null
        if (stockDaysFilter === 'low'  && (days == null || days >= 14)) return false
        if (stockDaysFilter === 'ok'   && (days == null || days < 14 || days > 60)) return false
        if (stockDaysFilter === 'high' && (days == null || days <= 60)) return false
      }
      // stock_rub filter
      if (stockRubFilter !== 'all') {
        const rub = s.stock_rub ?? 0
        if (stockRubFilter === 'low'  && rub >= 100_000) return false
        if (stockRubFilter === 'high' && rub < 100_000) return false
      }
      // forecast_qty (OOS risk = forecast > stock)
      if (forecastQtyFilter !== 'all') {
        const qty = s.forecast_30d_qty ?? null
        const stock = s.stock_qty ?? 0
        if (forecastQtyFilter === 'oos_risk' && (qty == null || qty <= stock)) return false
        if (forecastQtyFilter === 'ok'       && (qty != null && qty > stock)) return false
      }
      // forecast_rev filter
      if (forecastRevFilter !== 'all') {
        const rev = s.forecast_30d_qty != null ? s.forecast_30d_qty * s.price : 0
        if (forecastRevFilter === 'low'  && rev >= 100_000) return false
        if (forecastRevFilter === 'high' && rev < 100_000) return false
      }
      return true
    }).sort((a, b) => {
      let av: number, bv: number
      if (sortKey === 'forecast_30d_rev') {
        av = a.forecast_30d_qty != null ? a.forecast_30d_qty * a.price : -Infinity
        bv = b.forecast_30d_qty != null ? b.forecast_30d_qty * b.price : -Infinity
      } else {
        av = (a[sortKey as keyof SkuNode] as number | null) ?? -Infinity
        bv = (b[sortKey as keyof SkuNode] as number | null) ?? -Infinity
      }
      return sortDir === 'asc' ? (av < bv ? -1 : 1) : (av > bv ? -1 : 1)
    })
  }

  // Count visible SKUs for summary
  let visibleSkuCount = 0
  let visibleRevenue = 0
  for (const cat of hierarchy) {
    for (const subj of cat.subjects) {
      const filtered = filterSkus(subj.skus)
      visibleSkuCount += filtered.length
      visibleRevenue  += filtered.reduce((s, r) => s + r.revenue, 0)
    }
  }

  // Auto-expand categories/subjects that match the current filter
  const hasFilter = search !== '' || deltaFilter !== 'all' || stockDaysFilter !== 'all' || stockRubFilter !== 'all' || forecastQtyFilter !== 'all' || forecastRevFilter !== 'all'
  const matchingCats = new Set<string>()
  const matchingSubjs = new Set<string>()
  if (hasFilter) {
    for (const cat of hierarchy) {
      for (const subj of cat.subjects) {
        if (filterSkus(subj.skus).length > 0) {
          matchingCats.add(cat.category)
          matchingSubjs.add(`${cat.category}::${subj.subject}`)
        }
      }
    }
  }

  // Sort hierarchy: categories and subjects within each category by sortKey
  function sortNodes<T extends { revenue: number; delta_pct: number | null; chmd: number; margin_pct: number; drr: number }>(nodes: T[]): T[] {
    return [...nodes].sort((a, b) => {
      let av: number, bv: number
      if (sortKey === 'delta_pct') {
        av = a.delta_pct ?? -Infinity
        bv = b.delta_pct ?? -Infinity
      } else if (sortKey === 'stock_rub' || sortKey === 'stock_qty' || sortKey === 'forecast_30d_qty' || sortKey === 'forecast_30d_rev') {
        av = -Infinity; bv = -Infinity // not on cat/subj — keep original order
      } else {
        av = (a[sortKey as keyof T] as number) ?? -Infinity
        bv = (b[sortKey as keyof T] as number) ?? -Infinity
      }
      return sortDir === 'asc' ? (av < bv ? -1 : 1) : (av > bv ? -1 : 1)
    })
  }
  const sortedHierarchy = sortNodes(hierarchy).map(cat => ({
    ...cat,
    subjects: sortNodes(cat.subjects),
  }))

  return (
    <div className="py-6 space-y-6">

      {/* KPI bar */}
      <KPIBar items={[
        {
          label: 'Выручка',
          value: fmt(activeKpi.revenue),
          delta: deltaRev,
          deltaPositive: activeKpi.revenue >= activeKpi.prev_revenue,
        },
        {
          label: 'ЧМД',
          value: fmt(activeKpi.chmd),
          delta: deltaChmd,
          deltaPositive: activeKpi.chmd >= activeKpi.prev_chmd,
        },
        {
          label: 'Маржа %',
          value: fmtPct(activeKpi.margin_pct),
          delta: deltaMargin,
          deltaPositive: activeKpi.margin_pct >= activeKpi.prev_margin_pct,
          danger: activeKpi.margin_pct < 0.10,
        },
        {
          label: 'ДРР',
          value: fmtPct(activeKpi.drr),
          delta: deltaDrr,
          deltaPositive: activeKpi.drr <= activeKpi.prev_drr,
        },
        {
          label: 'CPO',
          value: activeKpi.cpo != null ? fmt(activeKpi.cpo) + ' ₽' : '—',
          delta: deltaCpo,
          deltaPositive: activeKpi.cpo != null && activeKpi.prev_cpo != null ? activeKpi.cpo <= activeKpi.prev_cpo : undefined,
        },
        {
          label: 'Прогноз 30д',
          value: fmt(activeKpi.forecast_30d_revenue),
          accent: true,
          hint: `(Выручка / ${kpi.period_days}д) × 30. Кликните для сортировки.`,
          onClick: handleForecastClick,
        },
      ]} />

      {/* Chart 1 — wide: Revenue/CHMD/Expenses/DRR */}
      <GlassCard padding="lg">
        <p className="text-sm font-semibold mb-4" style={{ color: 'var(--text)' }}>Выручка / ЧМД / Расходы / ДРР по дням</p>
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={chartData} margin={{ top: 4, right: 48, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="aRevG" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.22} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="aChmdG" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#22c55e" stopOpacity={0.18} />
                  <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.5} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis yAxisId="left"  tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} width={48} tickFormatter={v => fmt(v as number)} domain={['auto', 'auto']} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} width={44} tickFormatter={v => fmt(v as number)} domain={['auto', 'auto']} />
              <Tooltip content={<ChartTip />} />
              <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
              <Area yAxisId="left"  type="monotone" dataKey="Выручка" stroke="#3b82f6" strokeWidth={2} fill="url(#aRevG)"  dot={false} />
              <Area yAxisId="right" type="monotone" dataKey="ЧМД"     stroke="#22c55e" strokeWidth={2} fill="url(#aChmdG)" dot={false} />
              <Line  yAxisId="right" type="monotone" dataKey="Расходы" stroke="#ef4444" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
              <Line  yAxisId="right" type="monotone" dataKey="ДРР%"    stroke="#f59e0b" strokeWidth={2}   dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex items-center justify-center h-56 text-sm" style={{ color: 'var(--text-muted)' }}>Нет данных</div>
        )}
      </GlassCard>

      {/* Chart 1.5 — Comparison: current vs prev period */}
      {compData.length > 0 && (
        <GlassCard padding="lg">
          <p className="text-sm font-semibold mb-4" style={{ color: 'var(--text)' }}>Сравнение периодов: выручка по дням</p>
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart data={compData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="aCurrG" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="aPrevG" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#94a3b8" stopOpacity={0.18} />
                  <stop offset="95%" stopColor="#94a3b8" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.5} />
              <XAxis
                dataKey="day"
                tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                tickLine={false} axisLine={false}
                tickFormatter={v => {
                  const idx = (v as number) - 1
                  const d = compData[idx]
                  return d?.currDate ?? `День ${v}`
                }}
                interval={Math.max(0, Math.floor(compData.length / 10) - 1)}
              />
              <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} width={44} tickFormatter={v => fmt(v as number)} domain={['auto', 'auto']} />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null
                  const idx = (label as number) - 1
                  const d = compData[idx]
                  return (
                    <div className="glass p-3 text-xs min-w-[160px]" style={{ color: 'var(--text)' }}>
                      <p className="font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>День {label}</p>
                      {d?.currDate && <p className="mb-1 text-[10px]" style={{ color: 'var(--text-subtle)' }}>Текущий: {d.currDate} / Пред.: {d.prevDate ?? '—'}</p>}
                      {payload.map((p) => p.value != null && (
                        <div key={p.name} className="flex items-center gap-2 mb-1">
                          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: p.color }} />
                          <span style={{ color: 'var(--text-muted)' }}>{p.name}:</span>
                          <span className="font-bold ml-auto">{fmt(p.value as number)}</span>
                        </div>
                      ))}
                    </div>
                  )
                }}
              />
              <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
              <Area type="monotone" dataKey="Текущий период" stroke="#3b82f6" strokeWidth={2} fill="url(#aCurrG)" dot={false} connectNulls={false} />
              <Area type="monotone" dataKey="Пред. период"   stroke="#94a3b8" strokeWidth={1.5} fill="url(#aPrevG)" dot={false} strokeDasharray="4 3" connectNulls={false} />
              <Line type="monotone" dataKey="Прогноз" stroke="#3b82f6" strokeWidth={1.5} dot={false} strokeDasharray="3 3" strokeOpacity={0.5} connectNulls={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </GlassCard>
      )}

      {/* Charts 2+3 — side by side */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Chart 2 — Revenue by day with Expenses line */}
        <GlassCard padding="lg">
          <p className="text-sm font-semibold mb-4" style={{ color: 'var(--text)' }}>Выручка по дням</p>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={210}>
              <ComposedChart data={chartData} margin={{ top: 4, right: 44, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.5} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} interval={chartData.length > 14 ? 1 : 0} />
                <YAxis yAxisId="left"  tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} width={44} tickFormatter={v => fmt(v as number)} domain={['auto', 'auto']} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} width={40} tickFormatter={v => fmt(v as number)} domain={['auto', 'auto']} />
                <Tooltip content={<ChartTip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                <Bar  yAxisId="left"  dataKey="Выручка" fill="#3b82f6" fillOpacity={0.75} radius={[3, 3, 0, 0]} activeBar={{ fill: 'rgba(59,130,246,0.25)', stroke: 'none' }} />
                <Line yAxisId="right" type="monotone" dataKey="Расходы" stroke="#ef4444" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-52 text-sm" style={{ color: 'var(--text-muted)' }}>Нет данных</div>
          )}
        </GlassCard>

        {/* Chart 3 — Margin% vs DRR% */}
        <GlassCard padding="lg">
          <div className="mb-4">
            <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Маржа % vs ДРР % по дням</p>
            <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-subtle)' }}>
              Маржа% — средняя за период (исторические данные недоступны)
            </p>
          </div>
          {marginDrrData.length > 0 ? (
            <ResponsiveContainer width="100%" height={210}>
              <ComposedChart data={marginDrrData} margin={{ top: 4, right: 40, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.5} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis yAxisId="left"  tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} width={36} tickFormatter={v => `${v}%`} domain={['auto', 'auto']} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} width={36} tickFormatter={v => `${v}%`} domain={['auto', 'auto']} />
                <Tooltip content={<ChartTip />} />
                <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                <Line yAxisId="left"  type="monotone" dataKey="Маржа%" stroke="#22c55e" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                <Line yAxisId="right" type="monotone" dataKey="ДРР%"   stroke="#f59e0b" strokeWidth={2} dot={false} activeDot={{ r: 4 }} strokeDasharray="4 2" />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-52 text-sm" style={{ color: 'var(--text-muted)' }}>Нет данных</div>
          )}
        </GlassCard>
      </div>

      {/* Hierarchical table — isolation:auto needed so sticky thead works through GlassCard */}
      <div ref={tableRef}>
        <GlassCard padding="none" style={{ isolation: 'auto' }}>
          {/* Table filter row */}
          <div
            ref={filterRowRef}
            className="flex items-center gap-2 px-4 py-2.5 border-b flex-wrap"
            style={{
              position: 'sticky',
              top: stickyTop.filterRow,
              zIndex: 20,
              background: 'var(--surface-solid)',
              borderColor: 'var(--border)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
            }}
          >
            {/* Search */}
            <div className="relative flex-1 max-w-xs">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Поиск по SKU / названию"
                className="w-full pl-7 pr-3 py-1 rounded-lg text-xs bg-transparent border"
                style={{ border: '1px solid var(--border)', color: 'var(--text)', outline: 'none', background: 'var(--surface)' }}
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2">
                  <X size={10} style={{ color: 'var(--text-muted)' }} />
                </button>
              )}
            </div>

            {/* Delta filter */}
            <div className="flex items-center gap-0.5">
              {(['all', 'growth', 'decline'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setDeltaFilter(f)}
                  className="px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all"
                  style={{
                    background: deltaFilter === f ? 'var(--accent-glass)' : 'var(--surface)',
                    border: '1px solid ' + (deltaFilter === f ? 'var(--accent)' : 'var(--border)'),
                    color: deltaFilter === f ? 'var(--accent)' : 'var(--text-muted)',
                  }}
                >
                  {f === 'all' ? 'Все' : f === 'growth' ? '↑ Рост' : '↓ Падение'}
                </button>
              ))}
            </div>

            {/* Stock days filter */}
            <ColFilter
              label="Ост. дни"
              value={stockDaysFilter}
              onChange={v => setStockDaysFilter(v as typeof stockDaysFilter)}
              options={[
                { value: 'all', label: 'Все' },
                { value: 'low', label: '< 14 дн.' },
                { value: 'ok', label: '14–60 дн.' },
                { value: 'high', label: '> 60 дн.' },
              ]}
            />

            {/* Stock rub filter */}
            <ColFilter
              label="Ост. ₽"
              value={stockRubFilter}
              onChange={v => setStockRubFilter(v as typeof stockRubFilter)}
              options={[
                { value: 'all', label: 'Все' },
                { value: 'low', label: '< 100К' },
                { value: 'high', label: '≥ 100К' },
              ]}
            />

            {/* Forecast qty filter */}
            <ColFilter
              label="Прогноз шт."
              value={forecastQtyFilter}
              onChange={v => setForecastQtyFilter(v as typeof forecastQtyFilter)}
              options={[
                { value: 'all', label: 'Все' },
                { value: 'oos_risk', label: '⚠ OOS риск' },
                { value: 'ok', label: 'В норме' },
              ]}
            />

            {/* Forecast rev filter */}
            <ColFilter
              label="Прогноз ₽"
              value={forecastRevFilter}
              onChange={v => setForecastRevFilter(v as typeof forecastRevFilter)}
              options={[
                { value: 'all', label: 'Все' },
                { value: 'low', label: '< 100К' },
                { value: 'high', label: '≥ 100К' },
              ]}
            />

            {hasFilter && (
              <button onClick={() => { setSearch(''); setDeltaFilter('all'); setStockDaysFilter('all'); setStockRubFilter('all'); setForecastQtyFilter('all'); setForecastRevFilter('all') }} className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px]" style={{ color: 'var(--text-muted)', border: '1px solid var(--border)', background: 'var(--surface)' }}>
                <X size={9} /> Сбросить
              </button>
            )}

            {/* Expand/Collapse all + summary + download */}
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => {
                  setExpandedCats(new Set(sortedHierarchy.map(c => c.category)))
                  setExpandedSubjs(new Set(sortedHierarchy.flatMap(c => c.subjects.map(s => `${c.category}::${s.subject}`))))
                }}
                className="px-2 py-1 rounded-lg text-[11px]"
                style={{ color: 'var(--text-muted)', border: '1px solid var(--border)', background: 'var(--surface)' }}
              >
                Развернуть
              </button>
              <button
                onClick={() => { setExpandedCats(new Set()); setExpandedSubjs(new Set()) }}
                className="px-2 py-1 rounded-lg text-[11px]"
                style={{ color: 'var(--text-muted)', border: '1px solid var(--border)', background: 'var(--surface)' }}
              >
                Свернуть
              </button>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                <strong style={{ color: 'var(--text)' }}>{visibleSkuCount}</strong> SKU
                &nbsp;•&nbsp;
                <strong style={{ color: 'var(--text)' }}>{fmt(visibleRevenue)}</strong> ₽
              </span>
              <button
                onClick={() => exportCsv(hierarchy)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all"
                style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--accent)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--accent)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)' }}
              >
                <Download size={12} /> CSV
              </button>
            </div>
          </div>

          {/* Table */}
          <div style={{ overflowX: 'clip' }}>
            <table className="w-full text-xs" style={{ borderCollapse: 'collapse', minWidth: 800 }}>
              <thead>
                <tr style={{ background: 'var(--surface-solid)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', position: 'sticky', top: stickyTop.thead, zIndex: 10 }}>
                  <th className="text-left pl-4 pr-2 py-2.5 font-medium" style={{ color: 'var(--text-subtle)', minWidth: 280 }}>Категория / Предмет / SKU</th>
                  <SortTh label="Выручка"       sortKey="revenue"          current={sortKey} dir={sortDir} onClick={toggleSort} />
                  <SortTh label="Δ%"            sortKey="delta_pct"        current={sortKey} dir={sortDir} onClick={toggleSort} />
                  <SortTh label="ЧМД"           sortKey="chmd"             current={sortKey} dir={sortDir} onClick={toggleSort} />
                  <SortTh label="Маржа%"        sortKey="margin_pct"       current={sortKey} dir={sortDir} onClick={toggleSort} />
                  <SortTh label="ДРР%"          sortKey="drr"              current={sortKey} dir={sortDir} onClick={toggleSort} />
                  <SortTh label="Остаток (₽)"   sortKey="stock_rub"        current={sortKey} dir={sortDir} onClick={toggleSort} />
                  <SortTh label="Остаток (шт.)" sortKey="stock_qty"        current={sortKey} dir={sortDir} onClick={toggleSort} />
                  <th
                    className="pb-2 font-medium cursor-pointer select-none whitespace-nowrap text-right"
                    style={{ color: sortKey === 'forecast_30d_qty' ? 'var(--accent)' : 'var(--text-subtle)', fontSize: 11 }}
                    onClick={() => toggleSort('forecast_30d_qty')}
                  >
                    <span
                      className="inline-flex items-center gap-0.5 justify-end"
                      title="Прогноз продаж в штуках на 30 дней: (Выручка / Дней периода × 30) / Цена. Красный — прогноз выше текущего остатка (риск OOS)."
                    >
                      Прогноз (шт.) <span style={{ color: 'var(--accent)', fontSize: 9 }}>?</span>
                      {sortKey === 'forecast_30d_qty'
                        ? (sortDir === 'asc' ? <ChevronUp size={10} /> : <ChevronDown size={10} />)
                        : <ChevronDown size={10} style={{ opacity: 0.25 }} />}
                    </span>
                  </th>
                  <SortTh label="Прогноз (₽)" sortKey="forecast_30d_rev" current={sortKey} dir={sortDir} onClick={toggleSort} />
                </tr>
              </thead>
              <tbody>
                {sortedHierarchy.map(cat => {
                  const catKey = cat.category
                  const catExpanded = expandedCats.has(catKey) || matchingCats.has(catKey)
                  // Filter subjects to only those with visible SKUs
                  const visibleSubjects = cat.subjects
                    .map(subj => ({ subj, skus: filterSkus(subj.skus) }))
                    .filter(({ skus }) => skus.length > 0)

                  if (visibleSubjects.length === 0 && (search || deltaFilter !== 'all')) return null

                  return [
                    // Category row
                    <tr
                      key={catKey}
                      onClick={() => setExpandedCats(s => {
                        const n = new Set(s)
                        n.has(catKey) ? n.delete(catKey) : n.add(catKey)
                        return n
                      })}
                      className="cursor-pointer border-b"
                      style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
                      onMouseEnter={e => (e.currentTarget as HTMLTableRowElement).style.background = 'var(--accent-glass)'}
                      onMouseLeave={e => (e.currentTarget as HTMLTableRowElement).style.background = 'var(--surface)'}
                    >
                      <td className="pl-4 pr-2 py-2.5 font-semibold" style={{ color: 'var(--text)' }}>
                        <span className="inline-flex items-center gap-1.5">
                          <ChevronRight size={12} style={{ transform: catExpanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s', color: 'var(--text-muted)' }} />
                          {cat.category}
                        </span>
                      </td>
                      <td className="px-2 py-2.5 text-right font-semibold" style={{ color: 'var(--text)' }}>{fmt(cat.revenue)}</td>
                      <td className="px-2 py-2.5 text-right">
                        {cat.delta_pct != null && (
                          <span className="text-[10px] font-semibold" style={{ color: cat.delta_pct > 0 ? 'var(--success)' : 'var(--danger)' }}>
                            {cat.delta_pct > 0 ? '+' : ''}{(cat.delta_pct * 100).toFixed(1)}%
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2.5 text-right" style={{ color: 'var(--text-muted)' }}>{fmt(cat.chmd)}</td>
                      <td className="px-2 py-2.5 text-right">
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium" style={{ background: cat.margin_pct < 0.10 ? 'var(--danger-bg)' : 'var(--success-bg)', color: cat.margin_pct < 0.10 ? 'var(--danger)' : 'var(--success)' }}>
                          {fmtPct(cat.margin_pct)}
                        </span>
                      </td>
                      <td className="px-2 py-2.5 text-right" style={{ color: 'var(--text-muted)' }}>{fmtPct(cat.drr)}</td>
                      <td className="px-2 py-2.5 text-right" style={{ color: 'var(--text-muted)' }}>
                        {fmt(cat.subjects.reduce((s, subj) => s + subj.skus.reduce((ss, sku) => ss + sku.stock_rub, 0), 0))}
                      </td>
                      <td className="px-2 py-2.5 text-right" style={{ color: 'var(--text-muted)' }}>
                        {(() => { const total = cat.subjects.reduce((s, subj) => s + subj.skus.reduce((ss, sku) => ss + sku.stock_qty, 0), 0); return total > 0 ? total : '—' })()}
                      </td>
                      <td className="px-2 py-2.5 text-right" style={{ color: 'var(--text-muted)' }}>
                        {(() => { const total = cat.subjects.reduce((s, subj) => s + subj.skus.reduce((ss, sku) => ss + (sku.forecast_30d_qty ?? 0), 0), 0); return total > 0 ? `${total} шт.` : '—' })()}
                      </td>
                      <td className="px-2 py-2.5 text-right" style={{ color: 'var(--text-muted)' }}>
                        {(() => { const total = cat.subjects.reduce((s, subj) => s + subj.skus.reduce((ss, sku) => ss + (sku.forecast_30d_qty != null ? sku.forecast_30d_qty * sku.price : 0), 0), 0); return total > 0 ? fmt(total) : '—' })()}
                      </td>
                    </tr>,

                    // Subject rows (if expanded)
                    ...(catExpanded ? visibleSubjects.map(({ subj, skus }) => {
                      const subjKey = `${catKey}::${subj.subject}`
                      const subjExpanded = expandedSubjs.has(subjKey) || matchingSubjs.has(subjKey)
                      return [
                        // Subject row
                        <tr
                          key={subjKey}
                          onClick={() => setExpandedSubjs(s => {
                            const n = new Set(s)
                            n.has(subjKey) ? n.delete(subjKey) : n.add(subjKey)
                            return n
                          })}
                          className="cursor-pointer border-b"
                          style={{ borderColor: 'var(--border)' }}
                          onMouseEnter={e => (e.currentTarget as HTMLTableRowElement).style.background = 'var(--accent-glass)'}
                          onMouseLeave={e => (e.currentTarget as HTMLTableRowElement).style.background = 'transparent'}
                        >
                          <td className="pl-9 pr-2 py-2" style={{ color: 'var(--text)' }}>
                            <span className="inline-flex items-center gap-1.5">
                              <ChevronRight size={11} style={{ transform: subjExpanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s', color: 'var(--text-muted)' }} />
                              {subj.subject}
                            </span>
                          </td>
                          <td className="px-2 py-2 text-right" style={{ color: 'var(--text)' }}>{fmt(subj.revenue)}</td>
                          <td className="px-2 py-2 text-right">
                            {subj.delta_pct != null && (
                              <span className="text-[10px] font-semibold" style={{ color: subj.delta_pct > 0 ? 'var(--success)' : 'var(--danger)' }}>
                                {subj.delta_pct > 0 ? '+' : ''}{(subj.delta_pct * 100).toFixed(1)}%
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-2 text-right" style={{ color: 'var(--text-muted)' }}>{fmt(subj.chmd)}</td>
                          <td className="px-2 py-2 text-right" style={{ color: 'var(--text-muted)' }}>{fmtPct(subj.margin_pct)}</td>
                          <td className="px-2 py-2 text-right" style={{ color: 'var(--text-muted)' }}>{fmtPct(subj.drr)}</td>
                          <td className="px-2 py-2 text-right" style={{ color: 'var(--text-muted)' }}>
                            {fmt(subj.skus.reduce((s, sku) => s + sku.stock_rub, 0))}
                          </td>
                          <td className="px-2 py-2 text-right" style={{ color: 'var(--text-muted)' }}>
                            {(() => { const total = subj.skus.reduce((s, sku) => s + sku.stock_qty, 0); return total > 0 ? total : '—' })()}
                          </td>
                          <td className="px-2 py-2 text-right" style={{ color: 'var(--text-muted)' }}>
                            {(() => { const total = subj.skus.reduce((s, sku) => s + (sku.forecast_30d_qty ?? 0), 0); return total > 0 ? `${total} шт.` : '—' })()}
                          </td>
                          <td className="px-2 py-2 text-right" style={{ color: 'var(--text-muted)' }}>
                            {(() => { const total = subj.skus.reduce((s, sku) => s + (sku.forecast_30d_qty != null ? sku.forecast_30d_qty * sku.price : 0), 0); return total > 0 ? fmt(total) : '—' })()}
                          </td>
                        </tr>,

                        // SKU rows (if subject expanded)
                        ...(subjExpanded ? skus.map(sku => {
                          const forecast = sku.forecast_30d_qty
                          const forecastColor = forecast != null && forecast > sku.stock_qty ? 'var(--danger)' : 'var(--success)'
                          return (
                            <tr
                              key={sku.sku_ms}
                              onClick={() => setModalSku(sku.sku_ms)}
                              className="cursor-pointer border-b"
                              style={{ borderColor: 'var(--border)' }}
                              onMouseEnter={e => (e.currentTarget as HTMLTableRowElement).style.background = 'rgba(59,130,246,0.04)'}
                              onMouseLeave={e => (e.currentTarget as HTMLTableRowElement).style.background = 'transparent'}
                            >
                              <td className="pl-14 pr-2 py-1.5 max-w-[320px]" style={{ color: 'var(--text)' }}>
                                <div className="truncate" title={sku.name}>{sku.name}</div>
                                <div className="text-[10px]" style={{ color: 'var(--text-subtle)' }}>{sku.sku_wb ?? sku.sku_ms}</div>
                              </td>
                              <td className="px-2 py-1.5 text-right" style={{ color: 'var(--text)' }}>{fmt(sku.revenue)}</td>
                              <td className="px-2 py-1.5 text-right">
                                {sku.delta_pct != null ? (
                                  <span className="text-[10px] font-semibold" style={{ color: sku.delta_pct > 0 ? 'var(--success)' : 'var(--danger)' }}>
                                    {sku.delta_pct > 0 ? '+' : ''}{(sku.delta_pct * 100).toFixed(1)}%
                                  </span>
                                ) : <span style={{ color: 'var(--text-subtle)' }}>—</span>}
                              </td>
                              <td className="px-2 py-1.5 text-right" style={{ color: 'var(--text-muted)' }}>{fmt(sku.chmd)}</td>
                              <td className="px-2 py-1.5 text-right" style={{ color: 'var(--text-muted)' }}>{fmtPct(sku.margin_pct)}</td>
                              <td className="px-2 py-1.5 text-right" style={{ color: 'var(--text-muted)' }}>{fmtPct(sku.drr)}</td>
                              <td className="px-2 py-1.5 text-right" style={{ color: 'var(--text-muted)' }}>{fmt(sku.stock_rub)}</td>
                              <td className="px-2 py-1.5 text-right" style={{ color: 'var(--text-muted)' }}>{sku.stock_qty > 0 ? sku.stock_qty : '—'}</td>
                              <td className="px-2 py-1.5 text-right font-semibold" style={{ color: forecast != null ? forecastColor : 'var(--text-muted)' }}>
                                {forecast != null ? `${forecast} шт.` : '—'}
                              </td>
                              <td className="px-2 py-1.5 text-right" style={{ color: 'var(--text-muted)' }}>
                                {forecast != null ? fmt(forecast * sku.price) : '—'}
                              </td>
                            </tr>
                          )
                        }) : []),
                      ]
                    }).flat() : []),
                  ]
                })}
              </tbody>
            </table>
          </div>

        </GlassCard>
      </div>

      {/* SKU Modal */}
      {modalSku && (
        <SkuModal skuMs={modalSku} onClose={() => setModalSku(null)} />
      )}
    </div>
  )
}
