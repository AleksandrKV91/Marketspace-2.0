'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import {
  ComposedChart, AreaChart, Area, Line, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Legend, BarChart,
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
          <span className="font-bold ml-auto">{typeof p.value === 'number' && p.value < 2 ? fmtPct(p.value) : fmt(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

// ── Sort helper ───────────────────────────────────────────────────────────────

type SortKey = 'revenue' | 'delta_pct' | 'chmd' | 'margin_pct' | 'drr' | 'stock_rub' | 'forecast_30d_qty'

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
  const rows: string[] = ['Категория,Предмет,SKU MS,SKU WB,Название,Выручка,Δ%,ЧМД,Маржа%,ДРР%,Остаток(руб),Прогноз30д(шт)']
  for (const cat of hierarchy) {
    for (const subj of cat.subjects) {
      for (const sku of subj.skus) {
        rows.push([
          cat.category, subj.subject, sku.sku_ms, sku.sku_wb ?? '', `"${sku.name}"`,
          sku.revenue, sku.delta_pct != null ? (sku.delta_pct * 100).toFixed(1) : '',
          sku.chmd, (sku.margin_pct * 100).toFixed(1), (sku.drr * 100).toFixed(1),
          sku.stock_rub, sku.forecast_30d_qty ?? '',
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

  // SKU modal
  const [modalSku, setModalSku] = useState<string | null>(null)

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
      setExpandedCats(new Set(data.hierarchy.map(c => c.category)))
      setExpandedSubjs(new Set(
        data.hierarchy.flatMap(c => c.subjects.map(s => `${c.category}::${s.subject}`))
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

  const { kpi, hierarchy, daily_chart, daily_margin_drr } = data

  // Delta helpers
  const deltaRev = kpi.prev_revenue > 0
    ? ((kpi.revenue - kpi.prev_revenue) / kpi.prev_revenue * 100).toFixed(1) + '%'
    : undefined

  // Chart data
  const chartData = daily_chart.map(d => ({
    date:    fmtDate(d.date),
    Выручка: d.revenue,
    ЧМД:     d.chmd,
    Расходы: d.ad_spend,
    'ДРР%':  +(d.drr * 100).toFixed(1),
  }))

  const marginDrrData = daily_margin_drr.map(d => ({
    date:    fmtDate(d.date),
    'Маржа%': +(d.margin_pct * 100).toFixed(1),
    'ДРР%':   +(d.drr * 100).toFixed(1),
  }))

  // Apply search + delta filter to SKU nodes, recompute rollup for display
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
      const av = (a[sortKey] as number | null) ?? -Infinity
      const bv = (b[sortKey] as number | null) ?? -Infinity
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

  return (
    <div className="py-6 space-y-6">

      {/* KPI bar */}
      <KPIBar items={[
        {
          label: 'Выручка',
          value: fmt(kpi.revenue),
          delta: deltaRev,
          deltaPositive: kpi.revenue >= kpi.prev_revenue,
        },
        { label: 'ЧМД',    value: fmt(kpi.chmd) },
        { label: 'Маржа %', value: fmtPct(kpi.margin_pct), danger: kpi.margin_pct < 0.10 },
        { label: 'ДРР',     value: fmtPct(kpi.drr) },
        { label: 'CPO',     value: kpi.cpo != null ? fmt(kpi.cpo) + ' ₽' : '—' },
        {
          label: 'Прогноз 30д',
          value: fmt(kpi.forecast_30d_revenue),
          accent: true,
          hint: 'Кликните для сортировки',
          onClick: handleForecastClick,
        },
      ]} />

      {/* Chart 1 — wide: Revenue/CHMD/Expenses/DRR */}
      <GlassCard padding="lg">
        <p className="text-sm font-semibold mb-4" style={{ color: 'var(--text)' }}>Выручка / ЧМД / Расходы / ДРР по дням</p>
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={chartData} margin={{ top: 4, right: 40, bottom: 0, left: 0 }}>
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
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} width={36} tickFormatter={v => `${v}%`} domain={['auto', 'auto']} />
              <Tooltip content={<ChartTip />} />
              <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
              <Area yAxisId="left"  type="monotone" dataKey="Выручка" stroke="#3b82f6" strokeWidth={2} fill="url(#aRevG)"  dot={false} />
              <Area yAxisId="left"  type="monotone" dataKey="ЧМД"     stroke="#22c55e" strokeWidth={2} fill="url(#aChmdG)" dot={false} />
              <Line  yAxisId="left"  type="monotone" dataKey="Расходы" stroke="#ef4444" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
              <Line  yAxisId="right" type="monotone" dataKey="ДРР%"    stroke="#f59e0b" strokeWidth={2}   dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex items-center justify-center h-56 text-sm" style={{ color: 'var(--text-muted)' }}>Нет данных</div>
        )}
      </GlassCard>

      {/* Charts 2+3 — side by side */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Chart 2 — by category bar */}
        <GlassCard padding="lg">
          <p className="text-sm font-semibold mb-4" style={{ color: 'var(--text)' }}>Выручка по дням</p>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={210}>
              <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.5} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} width={44} tickFormatter={v => fmt(v as number)} domain={['auto', 'auto']} />
                <Tooltip content={<ChartTip />} />
                <Bar dataKey="Выручка" fill="#3b82f6" fillOpacity={0.75} radius={[3, 3, 0, 0]} />
                <Bar dataKey="Расходы" fill="#ef4444" fillOpacity={0.60} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-52 text-sm" style={{ color: 'var(--text-muted)' }}>Нет данных</div>
          )}
        </GlassCard>

        {/* Chart 3 — Margin% vs DRR% */}
        <GlassCard padding="lg">
          <p className="text-sm font-semibold mb-4" style={{ color: 'var(--text)' }}>Маржа % vs ДРР % по дням</p>
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

      {/* Hierarchical table */}
      <div ref={tableRef}>
        <GlassCard padding="none">
          {/* Table filter row */}
          <div className="flex items-center gap-2 px-4 py-2.5 border-b" style={{ borderColor: 'var(--border)' }}>
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

            {(search || deltaFilter !== 'all') && (
              <button onClick={() => { setSearch(''); setDeltaFilter('all') }} className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px]" style={{ color: 'var(--text-muted)', border: '1px solid var(--border)', background: 'var(--surface)' }}>
                <X size={9} /> Сбросить
              </button>
            )}
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--surface)', position: 'sticky', top: 0, zIndex: 10 }}>
                  <th className="text-left pl-4 pr-2 py-2.5 font-medium" style={{ color: 'var(--text-subtle)', minWidth: 160 }}>Категория / Предмет / SKU</th>
                  <th className="text-left px-2 py-2.5 font-medium" style={{ color: 'var(--text-subtle)', minWidth: 160 }}>Название</th>
                  <SortTh label="Выручка"       sortKey="revenue"          current={sortKey} dir={sortDir} onClick={toggleSort} />
                  <SortTh label="Δ%"            sortKey="delta_pct"        current={sortKey} dir={sortDir} onClick={toggleSort} />
                  <SortTh label="ЧМД"           sortKey="chmd"             current={sortKey} dir={sortDir} onClick={toggleSort} />
                  <SortTh label="Маржа%"        sortKey="margin_pct"       current={sortKey} dir={sortDir} onClick={toggleSort} />
                  <SortTh label="ДРР%"          sortKey="drr"              current={sortKey} dir={sortDir} onClick={toggleSort} />
                  <SortTh label="Остаток (₽)"   sortKey="stock_rub"        current={sortKey} dir={sortDir} onClick={toggleSort} />
                  <SortTh label="Прогноз 30д"   sortKey="forecast_30d_qty" current={sortKey} dir={sortDir} onClick={toggleSort} />
                </tr>
              </thead>
              <tbody>
                {hierarchy.map(cat => {
                  const catKey = cat.category
                  const catExpanded = expandedCats.has(catKey)
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
                      <td className="px-2 py-2.5" style={{ color: 'var(--text-muted)' }}></td>
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
                      <td className="px-2 py-2.5 text-right" style={{ color: 'var(--text-muted)' }}>—</td>
                      <td className="px-2 py-2.5 text-right" style={{ color: 'var(--text-muted)' }}>—</td>
                    </tr>,

                    // Subject rows (if expanded)
                    ...(catExpanded ? visibleSubjects.map(({ subj, skus }) => {
                      const subjKey = `${catKey}::${subj.subject}`
                      const subjExpanded = expandedSubjs.has(subjKey)
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
                          <td className="px-2 py-2" style={{ color: 'var(--text-muted)' }}></td>
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
                          <td className="px-2 py-2 text-right" style={{ color: 'var(--text-muted)' }}>—</td>
                          <td className="px-2 py-2 text-right" style={{ color: 'var(--text-muted)' }}>—</td>
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
                              <td className="pl-14 pr-2 py-1.5" style={{ color: 'var(--text-muted)' }}>
                                {sku.sku_wb ?? sku.sku_ms}
                              </td>
                              <td className="px-2 py-1.5 max-w-[220px] truncate" style={{ color: 'var(--text)' }} title={sku.name}>{sku.name}</td>
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
                              <td className="px-2 py-1.5 text-right font-semibold" style={{ color: forecast != null ? forecastColor : 'var(--text-muted)' }}>
                                {forecast != null ? forecast : '—'}
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

          {/* Summary bar */}
          <div className="flex items-center justify-between px-4 py-2.5 border-t" style={{ borderColor: 'var(--border)' }}>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Выбрано: <strong style={{ color: 'var(--text)' }}>{visibleSkuCount}</strong> SKU
              &nbsp;•&nbsp;
              Выручка: <strong style={{ color: 'var(--text)' }}>{fmt(visibleRevenue)}</strong>
            </p>
            <button
              onClick={() => exportCsv(hierarchy)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--accent)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--accent)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)' }}
            >
              <Download size={12} /> Скачать CSV
            </button>
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
