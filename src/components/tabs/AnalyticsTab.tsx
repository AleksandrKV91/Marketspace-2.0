'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { GlassCard } from '@/components/ui/GlassCard'
import { KPIBar } from '@/components/ui/KPIBar'
import { SkuModal } from '@/components/ui/SkuModal'
import { useDateRange } from '@/components/ui/DateRangePicker'
import { useGlobalFilters } from '@/app/dashboard/page'
import { ChevronUp, ChevronDown, ChevronRight, Download, Search, X } from 'lucide-react'
import type { AnalyticsResponse, CategoryNode, SubjectNode, SkuNode } from '@/types/analytics'
import { exportToExcelMultiSheet } from '@/lib/exportExcel'

// ── Formatters ────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined) {
  if (n == null) return '—'
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'М'
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(0) + 'К'
  return String(Math.round(n))
}
function fmtRub(n: number | null | undefined) {
  if (n == null) return '—'
  return Math.round(n).toLocaleString('ru-RU') + ' ₽'
}
function fmtPct(n: number | null | undefined) {
  if (n == null) return '—'
  return (n * 100).toFixed(1) + '%'
}
function fmtDate(iso: string) {
  const d = new Date(iso)
  return `${d.getDate().toString().padStart(2, '0')}.${(d.getMonth() + 1).toString().padStart(2, '0')}`
}

// ── Inline SVG Sparkline ──────────────────────────────────────────────────────

function Sparkline({
  data,
  color = '#3b82f6',
  height = 56,
  fill = true,
}: {
  data: number[]
  color?: string
  height?: number
  fill?: boolean
}) {
  if (!data.length) return null
  const w = 240
  const h = height
  const max = Math.max(...data, 1)
  const min = Math.min(...data, 0)
  const range = max - min || 1
  const pts = data.map((v, i) => {
    const x = (i / Math.max(data.length - 1, 1)) * w
    const y = h - ((v - min) / range) * (h - 4) - 2
    return `${x},${y}`
  })
  const polyline = pts.join(' ')
  const fillPath = `M${pts[0]} ${pts.join(' L')} L${w},${h} L0,${h} Z`
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height }} preserveAspectRatio="none">
      {fill && (
        <path d={fillPath} fill={color} fillOpacity={0.12} />
      )}
      <polyline points={polyline} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

// ── Bar Chart (SVG) ───────────────────────────────────────────────────────────

function BarChart({
  data,
  keys,
  colors,
  height = 180,
  formatY = fmt,
  formatLabel,
}: {
  data: Record<string, number | string>[]
  keys: string[]
  colors: string[]
  height?: number
  formatY?: (n: number) => string
  formatLabel?: (d: Record<string, number | string>) => string
}) {
  const w = 600
  const h = height
  const pad = { top: 8, right: 8, bottom: 24, left: 44 }
  const chartH = h - pad.top - pad.bottom
  const chartW = w - pad.left - pad.right

  const values = data.flatMap(d => keys.map(k => Number(d[k]) || 0))
  const maxV = Math.max(...values, 1)

  const barW = chartW / data.length
  const groupW = barW * 0.8
  const singleW = groupW / keys.length

  const yTicks = 4
  const yStep = maxV / yTicks

  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height }} preserveAspectRatio="none">
      {/* Y grid + labels */}
      {Array.from({ length: yTicks + 1 }, (_, i) => {
        const v = yStep * i
        const y = pad.top + chartH - (v / maxV) * chartH
        return (
          <g key={i}>
            <line x1={pad.left} y1={y} x2={w - pad.right} y2={y} stroke="var(--border)" strokeOpacity={0.4} />
            <text x={pad.left - 4} y={y + 4} textAnchor="end" fontSize={9} fill="var(--text-muted)">{formatY(v)}</text>
          </g>
        )
      })}
      {/* Bars */}
      {data.map((d, di) => {
        const xBase = pad.left + di * barW + barW * 0.1
        return (
          <g key={di}>
            {keys.map((k, ki) => {
              const v = Number(d[k]) || 0
              const barH = (v / maxV) * chartH
              const x = xBase + ki * singleW
              const y = pad.top + chartH - barH
              return (
                <rect key={k} x={x} y={y} width={singleW - 1} height={barH}
                  fill={colors[ki] ?? '#3b82f6'} fillOpacity={0.8} rx={2} />
              )
            })}
            {formatLabel && (
              <text x={pad.left + di * barW + barW / 2} y={h - 4}
                textAnchor="middle" fontSize={9} fill="var(--text-muted)">
                {formatLabel(d)}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

// ── Line Chart (SVG) ──────────────────────────────────────────────────────────

function LineChart({
  data,
  series,
  height = 180,
  formatY = fmt,
  formatLabel,
}: {
  data: Record<string, number | string | undefined | null>[]
  series: { key: string; color: string; dash?: boolean; fill?: boolean }[]
  height?: number
  formatY?: (n: number) => string
  formatLabel?: (d: Record<string, number | string | undefined | null>) => string
}) {
  const w = 600
  const h = height
  const pad = { top: 8, right: 8, bottom: 24, left: 44 }
  const chartH = h - pad.top - pad.bottom
  const chartW = w - pad.left - pad.right

  const allVals = data.flatMap(d => series.map(s => Number(d[s.key]) || 0))
  const maxV = Math.max(...allVals, 1)
  const minV = Math.min(...allVals.filter(v => v > 0), 0)
  const range = maxV - minV || 1

  const px = (i: number) => pad.left + (i / Math.max(data.length - 1, 1)) * chartW
  const py = (v: number) => pad.top + chartH - ((v - minV) / range) * chartH

  const yTicks = 4
  const yStep = (maxV - minV) / yTicks

  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height }} preserveAspectRatio="none">
      {Array.from({ length: yTicks + 1 }, (_, i) => {
        const v = minV + yStep * i
        const y = py(v)
        return (
          <g key={i}>
            <line x1={pad.left} y1={y} x2={w - pad.right} y2={y} stroke="var(--border)" strokeOpacity={0.4} />
            <text x={pad.left - 4} y={y + 4} textAnchor="end" fontSize={9} fill="var(--text-muted)">{formatY(v)}</text>
          </g>
        )
      })}
      {series.map(s => {
        const validPts = data.map((d, i) => ({ x: px(i), y: py(Number(d[s.key]) || 0), v: d[s.key] }))
          .filter(p => p.v != null && p.v !== '')
        if (!validPts.length) return null
        const pts = validPts.map(p => `${p.x},${p.y}`).join(' ')
        return (
          <g key={s.key}>
            {s.fill && (
              <path
                d={`M${validPts[0].x},${py(minV)} L${pts.split(' ').join(' L')} L${validPts[validPts.length-1].x},${py(minV)} Z`}
                fill={s.color} fillOpacity={0.1}
              />
            )}
            <polyline points={pts} fill="none" stroke={s.color} strokeWidth={2}
              strokeDasharray={s.dash ? '5 3' : undefined}
              strokeLinejoin="round" strokeLinecap="round" />
          </g>
        )
      })}
      {formatLabel && data.map((d, i) => (
        <text key={i} x={px(i)} y={h - 4} textAnchor="middle" fontSize={9} fill="var(--text-muted)">
          {formatLabel(d)}
        </text>
      ))}
    </svg>
  )
}

// ── Sort helper ───────────────────────────────────────────────────────────────

type SortKey = 'revenue' | 'delta_pct' | 'chmd' | 'margin_pct' | 'drr' | 'stock_rub' | 'stock_qty' | 'forecast_30d_qty' | 'stock_days'

function SortTh({ label, sortKey, current, dir, onClick, align = 'right' }: {
  label: string; sortKey: SortKey; current: SortKey; dir: 'asc' | 'desc'
  onClick: (k: SortKey) => void; align?: 'left' | 'right'
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

// ── Module-level cache ────────────────────────────────────────────────────────

const analyticsCache = new Map<string, AnalyticsResponse>()

// ── Main component ────────────────────────────────────────────────────────────

export default function AnalyticsTab() {
  const { range } = useDateRange()
  const { filters, setMeta } = useGlobalFilters()
  const tableRef = useRef<HTMLDivElement>(null)

  const [data, setData]       = useState<AnalyticsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  const [expandedCats,  setExpandedCats]  = useState<Set<string>>(new Set())
  const [expandedSubjs, setExpandedSubjs] = useState<Set<string>>(new Set())
  const [sortKey,  setSortKey]  = useState<SortKey>('revenue')
  const [sortDir,  setSortDir]  = useState<'asc' | 'desc'>('desc')
  const [search,       setSearch]       = useState('')
  const [deltaFilter,  setDeltaFilter]  = useState<'all' | 'growth' | 'decline'>('all')
  const [pageSize, setPageSize] = useState<50 | 100 | 0>(50)
  const [page,     setPage]     = useState(0)
  const [modalSku, setModalSku] = useState<string | null>(null)

  // Sync meta to parent — in useEffect to avoid React #310
  useEffect(() => {
    if (data?.meta) {
      setMeta({ categories: data.meta.categories ?? [], managers: data.meta.managers ?? [] })
    }
  }, [data]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reset page on filter change
  useEffect(() => { setPage(0) }, [search, deltaFilter, sortKey, sortDir])

  // Fetch data
  useEffect(() => {
    const params = new URLSearchParams({ from: range.from, to: range.to })
    if (filters.category) params.set('category', filters.category)
    if (filters.manager)  params.set('manager',  filters.manager)
    if (filters.novelty)  params.set('novelty',  filters.novelty)
    const key = params.toString()

    const cached = analyticsCache.get(key)
    if (cached) { setData(cached); setLoading(false); return }

    setLoading(true); setError(null)
    fetch(`/api/dashboard/analytics?${params}`)
      .then(r => r.ok ? r.json() : r.json().then((e: {error?: string}) => Promise.reject(new Error(e?.error ?? `HTTP ${r.status}`))))
      .then((d: AnalyticsResponse) => {
        analyticsCache.set(key, d)
        setData(d)
        setLoading(false)
      })
      .catch((e: unknown) => { setError(String(e)); setLoading(false) })
  }, [range.from, range.to, filters.category, filters.manager, filters.novelty]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handlers ──────────────────────────────────────────────────────────────

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  const handleForecastClick = useCallback(() => {
    if (!data) return
    setExpandedCats(new Set(data.hierarchy.map((c: CategoryNode) => c.category)))
    setExpandedSubjs(new Set(
      data.hierarchy.flatMap((c: CategoryNode) => c.subjects.map((s: SubjectNode) => `${c.category}::${s.subject}`))
    ))
    setSortKey('forecast_30d_qty'); setSortDir('desc')
    setTimeout(() => tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }, [data])

  // ── Loading / error ───────────────────────────────────────────────────────

  if (loading) return (
    <div className="py-6 space-y-6">
      <KPIBar loading items={[
        { label: 'Выручка', value: '' }, { label: 'ЧМД', value: '' },
        { label: 'Маржа %', value: '' }, { label: 'ДРР', value: '' },
        { label: 'CPO', value: '' }, { label: 'Прогноз 30д', value: '' },
      ]} />
    </div>
  )
  if (error) return (
    <div className="py-16 text-center text-sm" style={{ color: 'var(--danger)' }}>{error}</div>
  )
  if (!data) return null

  const { kpi, hierarchy, daily_chart, daily_chart_prev, daily_by_sku } = data

  // ── Filter SKUs ───────────────────────────────────────────────────────────

  function filterSkus(skus: SkuNode[]): SkuNode[] {
    return skus.filter(s => {
      if (search) {
        const q = search.toLowerCase()
        if (!s.name.toLowerCase().includes(q) && !String(s.sku_wb ?? '').includes(q) && !s.sku_ms.toLowerCase().includes(q)) return false
      }
      if (deltaFilter === 'growth'  && (s.delta_pct == null || s.delta_pct <= 0)) return false
      if (deltaFilter === 'decline' && (s.delta_pct == null || s.delta_pct >= 0)) return false
      return true
    }).sort((a, b) => {
      let av: number, bv: number
      if (sortKey === 'delta_pct') { av = a.delta_pct ?? -Infinity; bv = b.delta_pct ?? -Infinity }
      else if (sortKey === 'forecast_30d_qty') {
        av = a.forecast_30d_qty ?? -Infinity; bv = b.forecast_30d_qty ?? -Infinity
      } else {
        av = (a[sortKey as keyof SkuNode] as number | null) ?? -Infinity
        bv = (b[sortKey as keyof SkuNode] as number | null) ?? -Infinity
      }
      return sortDir === 'asc' ? (av < bv ? -1 : 1) : (av > bv ? -1 : 1)
    })
  }

  // ── Visible SKUs & filtered KPI ───────────────────────────────────────────

  const visibleSkuMs = new Set<string>()
  for (const cat of hierarchy)
    for (const subj of cat.subjects)
      for (const sku of filterSkus(subj.skus)) visibleSkuMs.add(sku.sku_ms)

  const isFiltered = visibleSkuMs.size < hierarchy.reduce((s, c) => s + c.subjects.reduce((ss, sub) => ss + sub.skus.length, 0), 0)

  const activeKpi = (() => {
    if (!isFiltered) return kpi
    let revenue = 0, chmd = 0, ad_spend = 0, margin_num = 0, price_num = 0
    for (const cat of hierarchy)
      for (const subj of cat.subjects)
        for (const sku of filterSkus(subj.skus)) {
          revenue    += sku.revenue
          chmd       += sku.chmd
          ad_spend   += sku.drr * sku.revenue
          margin_num += sku.margin_pct * sku.revenue
          price_num  += sku.price * sku.revenue
        }
    const drr = revenue > 0 ? ad_spend / revenue : 0
    const margin_pct = revenue > 0 ? margin_num / revenue : 0
    const avgPrice = revenue > 0 ? price_num / revenue : 0
    const cpo = avgPrice > 0 && ad_spend > 0 ? ad_spend / (revenue / avgPrice) : kpi.cpo
    const forecast_30d_revenue = kpi.period_days > 0 ? (revenue / kpi.period_days) * 30 : 0
    return { ...kpi, revenue, chmd, drr, margin_pct, forecast_30d_revenue, cpo, sku_count: visibleSkuMs.size }
  })()

  function calcDelta(curr: number, prev: number) {
    if (!prev) return undefined
    const d = (curr - prev) / Math.abs(prev) * 100
    return (d >= 0 ? '+' : '') + d.toFixed(1) + '%'
  }

  const deltaRev    = calcDelta(activeKpi.revenue,     activeKpi.prev_revenue)
  const deltaChmd   = calcDelta(activeKpi.chmd,        activeKpi.prev_chmd)
  const deltaMargin = calcDelta(activeKpi.margin_pct,  activeKpi.prev_margin_pct)
  const deltaDrr    = calcDelta(activeKpi.drr,         activeKpi.prev_drr)
  const deltaCpo    = activeKpi.cpo != null && activeKpi.prev_cpo != null
    ? calcDelta(activeKpi.cpo, activeKpi.prev_cpo) : undefined

  // ── Chart data ────────────────────────────────────────────────────────────

  const chartRows = (daily_chart ?? []).map(d => ({
    label:   fmtDate(d.date),
    revenue: d.revenue,
    spend:   d.ad_spend,
    drr:     +(d.drr * 100).toFixed(1),
  }))

  const prevRevLine = (daily_chart_prev ?? []).map(d => d.revenue)

  // ── Sort hierarchy ────────────────────────────────────────────────────────

  function sortNodes<T extends { revenue: number; delta_pct: number | null; chmd: number }>(nodes: T[]): T[] {
    return [...nodes].sort((a, b) => {
      let av = (a[sortKey as keyof T] as number) ?? -Infinity
      let bv = (b[sortKey as keyof T] as number) ?? -Infinity
      if (sortKey === 'delta_pct') { av = a.delta_pct ?? -Infinity; bv = b.delta_pct ?? -Infinity }
      if (['stock_rub','stock_qty','forecast_30d_qty','stock_days'].includes(sortKey)) return 0
      return sortDir === 'asc' ? (av < bv ? -1 : 1) : (av > bv ? -1 : 1)
    })
  }

  const sortedHierarchy = sortNodes(hierarchy).map(cat => ({
    ...cat, subjects: sortNodes(cat.subjects),
  }))

  // ── Pagination ────────────────────────────────────────────────────────────

  const pagedHierarchy = (() => {
    if (pageSize === 0) return sortedHierarchy
    const start = page * pageSize
    const end = start + pageSize
    let idx = 0
    return sortedHierarchy.map(cat => ({
      ...cat,
      subjects: cat.subjects.map(subj => ({
        ...subj,
        skus: filterSkus(subj.skus).filter(() => { const i = idx++; return i >= start && i < end }),
      })).filter(s => s.skus.length > 0),
    })).filter(c => c.subjects.length > 0)
  })()

  const totalFiltered = sortedHierarchy.reduce((s, c) => s + c.subjects.reduce((ss, sub) => ss + filterSkus(sub.skus).length, 0), 0)
  const totalPages = pageSize === 0 ? 1 : Math.ceil(totalFiltered / pageSize)

  // ── Excel export ──────────────────────────────────────────────────────────

  function doExport() {
    const sheet1 = hierarchy.flatMap(cat => cat.subjects.flatMap(subj =>
      filterSkus(subj.skus).map(sku => ({
        'Категория': cat.category, 'Предмет': subj.subject,
        'SKU МС': sku.sku_ms, 'Название': sku.name,
        'Выручка, ₽': Math.round(sku.revenue),
        'Δ%': sku.delta_pct != null ? +(sku.delta_pct * 100).toFixed(1) : '',
        'ЧМД, ₽': Math.round(sku.chmd),
        'Маржа%': +(sku.margin_pct * 100).toFixed(1),
        'ДРР%': +(sku.drr * 100).toFixed(1),
        'Остаток ₽': Math.round(sku.stock_rub),
        'Остаток шт.': sku.stock_qty,
        'Цена': sku.price,
      }))
    ))
    const sheet2 = (daily_by_sku ?? []).filter(r => visibleSkuMs.has(r.sku_ms)).map(r => ({
      'SKU МС': r.sku_ms, 'Дата': r.date,
      'Выручка, ₽': Math.round(r.revenue),
      'Расходы, ₽': Math.round(r.ad_spend),
      'ДРР%': r.revenue > 0 ? +((r.ad_spend / r.revenue) * 100).toFixed(1) : '',
    }))
    exportToExcelMultiSheet(
      [{ data: sheet1, name: 'Сводная' }, { data: sheet2, name: 'По дням' }],
      'Продажи_и_экономика'
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="py-6 space-y-6">

      {/* KPI */}
      <KPIBar items={[
        { label: 'Выручка',    value: fmt(activeKpi.revenue),    delta: deltaRev,    deltaPositive: activeKpi.revenue >= activeKpi.prev_revenue },
        { label: 'ЧМД',       value: fmt(activeKpi.chmd),       delta: deltaChmd,   deltaPositive: activeKpi.chmd >= activeKpi.prev_chmd },
        { label: 'Маржа %',   value: fmtPct(activeKpi.margin_pct), delta: deltaMargin, deltaPositive: activeKpi.margin_pct >= activeKpi.prev_margin_pct, danger: activeKpi.margin_pct < 0.10 },
        { label: 'ДРР',       value: fmtPct(activeKpi.drr),     delta: deltaDrr,    deltaPositive: activeKpi.drr <= activeKpi.prev_drr },
        { label: 'CPO',       value: activeKpi.cpo != null ? fmt(activeKpi.cpo) + ' ₽' : '—', delta: deltaCpo, deltaPositive: activeKpi.cpo != null && activeKpi.prev_cpo != null ? activeKpi.cpo <= activeKpi.prev_cpo : undefined, tooltip: 'Стоимость заказа = Рекл. расходы / (Выручка / Ср. цена)' },
        { label: 'Прогноз 30д', value: fmt(activeKpi.forecast_30d_revenue), accent: true, hint: `(Выручка / ${kpi.period_days}д) × 30`, onClick: handleForecastClick },
      ]} />

      {/* Charts */}
      {chartRows.length > 0 && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {/* Chart 1: Revenue + Expenses bars */}
          <GlassCard padding="lg">
            <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text)' }}>Выручка / Расходы по дням</p>
            <div className="flex items-center gap-4 mb-3">
              {[{ label: 'Выручка', color: '#3b82f6' }, { label: 'Расходы', color: '#ef4444' }].map(l => (
                <div key={l.label} className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ background: l.color }} />
                  <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{l.label}</span>
                </div>
              ))}
            </div>
            <BarChart
              data={chartRows}
              keys={['revenue', 'spend']}
              colors={['#3b82f6', '#ef4444']}
              height={180}
              formatY={fmt}
              formatLabel={d => String(d.label)}
            />
          </GlassCard>

          {/* Chart 2: Current vs Prev period */}
          <GlassCard padding="lg">
            <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text)' }}>Сравнение периодов: выручка</p>
            <div className="flex items-center gap-4 mb-3">
              {[{ label: 'Текущий', color: '#3b82f6' }, { label: 'Пред. период', color: '#94a3b8' }].map(l => (
                <div key={l.label} className="flex items-center gap-1.5">
                  <span className="w-2.5 h-0.5 rounded" style={{ background: l.color }} />
                  <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{l.label}</span>
                </div>
              ))}
            </div>
            <LineChart
              data={chartRows.map((d, i) => ({ ...d, prev: prevRevLine[i] ?? null, label: d.label }))}
              series={[
                { key: 'revenue', color: '#3b82f6', fill: true },
                { key: 'prev',    color: '#94a3b8', dash: true },
              ]}
              height={180}
              formatY={fmt}
              formatLabel={d => String(d.label ?? '')}
            />
          </GlassCard>
        </div>
      )}

      {/* Table */}
      <div ref={tableRef}>
        <GlassCard padding="none">

          {/* Filter row */}
          <div className="flex items-center gap-2 px-4 py-2.5 border-b flex-wrap" style={{ borderColor: 'var(--border)' }}>
            <div className="relative flex-1 max-w-xs">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
              <input
                value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Поиск по SKU / названию"
                className="w-full pl-7 pr-3 py-1 rounded-lg text-xs"
                style={{ border: '1px solid var(--border)', color: 'var(--text)', outline: 'none', background: 'var(--surface)' }}
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2">
                  <X size={10} style={{ color: 'var(--text-muted)' }} />
                </button>
              )}
            </div>
            <div className="flex items-center gap-0.5">
              {(['all', 'growth', 'decline'] as const).map(f => (
                <button key={f} onClick={() => setDeltaFilter(f)}
                  className="px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all"
                  style={{
                    background: deltaFilter === f ? 'var(--accent-glass)' : 'var(--surface)',
                    border: '1px solid ' + (deltaFilter === f ? 'var(--accent)' : 'var(--border)'),
                    color: deltaFilter === f ? 'var(--accent)' : 'var(--text-muted)',
                  }}>
                  {f === 'all' ? 'Все' : f === 'growth' ? '↑ Рост' : '↓ Падение'}
                </button>
              ))}
            </div>
            <span className="ml-auto text-[10px]" style={{ color: 'var(--text-subtle)' }}>
              {visibleSkuMs.size} SKU · {fmtRub(activeKpi.revenue)}
            </span>
            <button onClick={doExport} className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px]"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
              <Download size={11} /> Excel
            </button>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, background: 'var(--surface-solid)', zIndex: 10 }}>
                  <th className="text-left px-4 py-2 font-medium w-6" style={{ color: 'var(--text-subtle)', fontSize: 11 }} />
                  <th className="text-left px-2 py-2 font-medium" style={{ color: 'var(--text-subtle)', fontSize: 11 }}>SKU / Название</th>
                  <SortTh label="Выручка"  sortKey="revenue"         current={sortKey} dir={sortDir} onClick={toggleSort} />
                  <SortTh label="Δ%"       sortKey="delta_pct"       current={sortKey} dir={sortDir} onClick={toggleSort} />
                  <SortTh label="ЧМД"      sortKey="chmd"            current={sortKey} dir={sortDir} onClick={toggleSort} />
                  <SortTh label="Маржа%"   sortKey="margin_pct"      current={sortKey} dir={sortDir} onClick={toggleSort} />
                  <SortTh label="ДРР%"     sortKey="drr"             current={sortKey} dir={sortDir} onClick={toggleSort} />
                  <SortTh label="Остаток₽" sortKey="stock_rub"       current={sortKey} dir={sortDir} onClick={toggleSort} />
                  <SortTh label="Ост.шт"   sortKey="stock_qty"       current={sortKey} dir={sortDir} onClick={toggleSort} />
                  <SortTh label="Прогноз"  sortKey="forecast_30d_qty" current={sortKey} dir={sortDir} onClick={toggleSort} />
                  <SortTh label="Дни"      sortKey="stock_days"      current={sortKey} dir={sortDir} onClick={toggleSort} />
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {pagedHierarchy.map(cat => {
                  const catOpen = expandedCats.has(cat.category)
                  return [
                    // Category row
                    <tr key={`cat-${cat.category}`}
                      className="cursor-pointer"
                      style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}
                      onClick={() => setExpandedCats(prev => {
                        const n = new Set(prev)
                        n.has(cat.category) ? n.delete(cat.category) : n.add(cat.category)
                        return n
                      })}>
                      <td className="px-4 py-2">
                        <ChevronRight size={12} style={{ color: 'var(--text-muted)', transform: catOpen ? 'rotate(90deg)' : undefined, transition: 'transform 0.15s' }} />
                      </td>
                      <td className="px-2 py-2 font-semibold" style={{ color: 'var(--text)', fontSize: 12 }} colSpan={2}>
                        {cat.category}
                      </td>
                      <td className="text-right px-2 py-2 font-semibold" style={{ color: 'var(--text)' }}>{fmtRub(cat.chmd)}</td>
                      <td className="text-right px-2 py-2" style={{ color: 'var(--text-muted)' }}>{fmtPct(cat.margin_pct)}</td>
                      <td className="text-right px-2 py-2" style={{ color: 'var(--text-muted)' }}>{fmtPct(cat.drr)}</td>
                      <td colSpan={5} />
                      <td className="text-right px-2 py-2 text-[10px]" style={{ color: 'var(--text-subtle)' }}>{fmtRub(cat.revenue)}</td>
                    </tr>,
                    // Subject + SKU rows
                    ...(catOpen ? cat.subjects.map(subj => {
                      const subjKey = `${cat.category}::${subj.subject}`
                      const subjOpen = expandedSubjs.has(subjKey)
                      return [
                        <tr key={`subj-${subjKey}`}
                          className="cursor-pointer"
                          style={{ borderBottom: '1px solid var(--border)', background: 'rgba(0,0,0,0.02)' }}
                          onClick={() => setExpandedSubjs(prev => {
                            const n = new Set(prev)
                            n.has(subjKey) ? n.delete(subjKey) : n.add(subjKey)
                            return n
                          })}>
                          <td className="px-4 py-1.5 pl-8">
                            <ChevronRight size={11} style={{ color: 'var(--text-subtle)', transform: subjOpen ? 'rotate(90deg)' : undefined, transition: 'transform 0.15s' }} />
                          </td>
                          <td className="px-2 py-1.5 font-medium" style={{ color: 'var(--text-muted)', fontSize: 11 }} colSpan={2}>
                            {subj.subject}
                          </td>
                          <td className="text-right px-2 py-1.5" style={{ color: 'var(--text-muted)' }}>{fmtRub(subj.chmd)}</td>
                          <td className="text-right px-2 py-1.5" style={{ color: 'var(--text-muted)' }}>{fmtPct(subj.margin_pct)}</td>
                          <td className="text-right px-2 py-1.5" style={{ color: 'var(--text-muted)' }}>{fmtPct(subj.drr)}</td>
                          <td colSpan={5} />
                          <td className="text-right px-2 py-1.5 text-[10px]" style={{ color: 'var(--text-subtle)' }}>{fmtRub(subj.revenue)}</td>
                        </tr>,
                        ...(subjOpen ? filterSkus(subj.skus).map(sku => (
                          <tr key={`sku-${sku.sku_ms}`}
                            style={{ borderBottom: '1px solid var(--border-subtle, rgba(0,0,0,0.05))' }}>
                            <td />
                            <td className="px-2 py-1.5 pl-10">
                              <div className="font-medium text-[11px] leading-tight" style={{ color: 'var(--text)' }}>{sku.name}</div>
                              <div className="text-[10px]" style={{ color: 'var(--text-subtle)' }}>{sku.sku_ms}</div>
                            </td>
                            <td className="text-right px-2 py-1.5 font-medium" style={{ color: 'var(--text)' }}>{fmtRub(sku.revenue)}</td>
                            <td className="text-right px-2 py-1.5" style={{ color: sku.delta_pct == null ? 'var(--text-subtle)' : sku.delta_pct >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                              {sku.delta_pct != null ? (sku.delta_pct >= 0 ? '+' : '') + (sku.delta_pct * 100).toFixed(1) + '%' : '—'}
                            </td>
                            <td className="text-right px-2 py-1.5" style={{ color: 'var(--text)' }}>{fmtRub(sku.chmd)}</td>
                            <td className="text-right px-2 py-1.5" style={{ color: sku.margin_pct < 0.10 ? 'var(--danger)' : 'var(--text)' }}>{fmtPct(sku.margin_pct)}</td>
                            <td className="text-right px-2 py-1.5" style={{ color: sku.drr > 0.3 ? 'var(--danger)' : 'var(--text-muted)' }}>{fmtPct(sku.drr)}</td>
                            <td className="text-right px-2 py-1.5" style={{ color: 'var(--text-muted)' }}>{fmtRub(sku.stock_rub)}</td>
                            <td className="text-right px-2 py-1.5" style={{ color: 'var(--text-muted)' }}>{sku.stock_qty ?? '—'}</td>
                            <td className="text-right px-2 py-1.5" style={{ color: 'var(--text-muted)' }}>
                              {sku.forecast_30d_qty != null ? Math.round(sku.forecast_30d_qty) : '—'}
                            </td>
                            <td className="text-right px-2 py-1.5" style={{ color: (sku.stock_days ?? 999) < 14 ? 'var(--danger)' : 'var(--text-muted)' }}>
                              {sku.stock_days != null ? Math.round(sku.stock_days) + 'д' : '—'}
                            </td>
                            <td className="px-2 py-1.5">
                              <button onClick={() => setModalSku(sku.sku_ms)}
                                className="text-[10px] px-1.5 py-0.5 rounded"
                                style={{ background: 'var(--accent-glass)', color: 'var(--accent)' }}>
                                →
                              </button>
                            </td>
                          </tr>
                        )) : []),
                      ]
                    }).flat() : []),
                  ]
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalFiltered > 50 && (
            <div className="flex items-center gap-3 px-4 py-3 border-t" style={{ borderColor: 'var(--border)' }}>
              <div className="flex gap-1">
                {([50, 100, 0] as const).map(n => (
                  <button key={n} onClick={() => { setPageSize(n); setPage(0) }}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all"
                    style={{
                      background: pageSize === n ? 'var(--accent-glass)' : 'var(--surface)',
                      border: '1px solid ' + (pageSize === n ? 'var(--accent)' : 'var(--border)'),
                      color: pageSize === n ? 'var(--accent)' : 'var(--text-muted)',
                    }}>
                    {n === 0 ? 'Все' : n}
                  </button>
                ))}
              </div>
              {pageSize > 0 && totalPages > 1 && (
                <div className="flex gap-1 ml-auto">
                  {Array.from({ length: Math.min(totalPages, 10) }, (_, i) => (
                    <button key={i} onClick={() => setPage(i)}
                      className="w-7 h-7 rounded-lg text-[11px] font-medium transition-all"
                      style={{
                        background: page === i ? 'var(--accent)' : 'var(--surface)',
                        border: '1px solid ' + (page === i ? 'var(--accent)' : 'var(--border)'),
                        color: page === i ? 'white' : 'var(--text-muted)',
                      }}>
                      {i + 1}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

        </GlassCard>
      </div>

      {/* SKU modal */}
      {modalSku && (
        <SkuModal
          skuMs={modalSku}
          onClose={() => setModalSku(null)}
        />
      )}

    </div>
  )
}
