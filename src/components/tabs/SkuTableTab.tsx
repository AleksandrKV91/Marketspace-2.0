'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { GlassCard } from '@/components/ui/GlassCard'
import { ScoreBadge } from '@/components/ui/ScoreBadge'
import { PriorityBadge } from '@/components/ui/PriorityBadge'
import { Search, Filter, Download, X, ChevronUp, ChevronDown, SlidersHorizontal } from 'lucide-react'
import { SkuModal } from '@/components/ui/SkuModal'
import { useDateRange } from '@/components/ui/DateRangePicker'
import { usePendingFilter, useGlobalFilters } from '@/app/dashboard/page'
import { fmtAxis, fmtFull } from '@/lib/formatters'

interface SkuRow {
  sku: string
  name: string
  manager: string
  category: string
  revenue: number
  margin_pct: number
  chmd: number
  drr: number
  ctr: number
  cr_basket: number
  cr_order: number
  stock_qty: number
  stock_days: number
  cpo: number
  forecast_30d: number | null
  delta_revenue_pct: number | null
  score: number
  oos_status: 'critical' | 'warning' | 'ok' | 'none'
  margin_status: 'high' | 'medium' | 'low'
  novelty: boolean
}

interface SkuTableData {
  rows: SkuRow[]
  total: number
  selected_count: number
  selected_revenue: number
}

type SortKey = 'sku' | 'name' | 'manager' | 'category' | 'revenue' | 'margin_pct' | 'chmd' | 'drr' | 'ctr' | 'cr_basket' | 'cr_order' | 'stock_qty' | 'stock_days' | 'cpo' | 'forecast_30d' | 'score'
type SortDir = 'asc' | 'desc'

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

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ChevronUp size={12} style={{ opacity: 0.3 }} />
  return dir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />
}

function Th({ label, sortKey, current, dir, onClick }: {
  label: string; sortKey: SortKey; current: SortKey; dir: SortDir; onClick: (k: SortKey) => void
}) {
  return (
    <th
      className="text-right pb-3 px-4 font-medium cursor-pointer select-none whitespace-nowrap"
      style={{ color: current === sortKey ? 'var(--accent)' : 'var(--text-subtle)' }}
      onClick={() => onClick(sortKey)}
    >
      <span className="inline-flex items-center gap-0.5">
        {label}
        <SortIcon active={current === sortKey} dir={dir} />
      </span>
    </th>
  )
}

export default function SkuTableTab() {
  const [data, setData] = useState<SkuTableData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const { range } = useDateRange()
  const [filterNovelty, setFilterNovelty] = useState<'all' | 'novelty' | 'no_novelty'>('all')
  const [filterOos, setFilterOos] = useState<'all' | 'critical' | 'warning' | 'ok'>('all')
  const [filterDrr, setFilterDrr] = useState<'all' | 'over' | 'under'>('all')
  const [filterMargin, setFilterMargin] = useState<'all' | 'low' | 'mid' | 'high'>('all')
  const [sortKey, setSortKey] = useState<SortKey>('score')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [sidePanelOpen, setSidePanelOpen] = useState(false)
  const [filterOosOnly, setFilterOosOnly] = useState(false)
  const [filterDrrOnly, setFilterDrrOnly] = useState(false)
  const [filterLowMarginOnly, setFilterLowMarginOnly] = useState(false)
  const [filterWithAds, setFilterWithAds] = useState(false)

  const { filters } = useGlobalFilters()

  const buildUrl = useCallback(() => {
    const p = new URLSearchParams()
    if (search) p.set('search', search)
    if (filterNovelty !== 'all') p.set('novelty', filterNovelty)
    if (filterOos !== 'all') p.set('oos', filterOos)
    if (filterDrr !== 'all') p.set('drr', filterDrr)
    if (filterMargin !== 'all') p.set('margin', filterMargin)
    if (filterOosOnly) p.set('oos', 'critical')
    if (filterDrrOnly) p.set('drr', 'over')
    if (filterLowMarginOnly) p.set('margin', 'low')
    if (filterWithAds) p.set('with_ads', '1')
    if (filters.category) p.set('category', filters.category)
    if (filters.manager)  p.set('manager', filters.manager)
    if (filters.novelty)  p.set('gnovelty', filters.novelty)
    p.set('sort', sortKey)
    p.set('dir', sortDir)
    p.set('from', range.from)
    p.set('to', range.to)
    return '/api/dashboard/sku-table?' + p.toString()
  }, [search, filterNovelty, filterOos, filterDrr, filterMargin, filterOosOnly, filterDrrOnly, filterLowMarginOnly, filterWithAds, sortKey, sortDir, range.from, range.to, filters.category, filters.manager, filters.novelty])

  useEffect(() => {
    setLoading(true)
    fetch(buildUrl())
      .then(r => r.json())
      .then((d: SkuTableData) => { setData(d); setLoading(false) })
      .catch((e: unknown) => { setError(String(e)); setLoading(false) })
  }, [buildUrl])

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  function resetFilters() {
    setSearch(''); setFilterNovelty('all'); setFilterOos('all')
    setFilterDrr('all'); setFilterMargin('all')
  }

  const hasFilters = search || filterNovelty !== 'all' || filterOos !== 'all' || filterDrr !== 'all' || filterMargin !== 'all'
  const [selectedSku, setSelectedSku] = useState<string | null>(null)
  const { pending, setPending } = usePendingFilter()

  useEffect(() => {
    if (!pending) return
    if (pending.type === 'stop_ads' || pending.type === 'oos') setFilterOos('critical')
    else if (pending.type === 'low_stock') setFilterOos('warning')
    else if (pending.type === 'drr_over') setFilterDrr('over')
    setPending(null)
  }, [])

  // E.4: Mini chart data — computed from loaded rows
  const categoryChartData = useMemo(() => {
    if (!data?.rows.length) return []
    const catMap: Record<string, { revenue: number; count: number }> = {}
    for (const r of data.rows) {
      const cat = r.category || 'Без категории'
      if (!catMap[cat]) catMap[cat] = { revenue: 0, count: 0 }
      catMap[cat].revenue += r.revenue
      catMap[cat].count++
    }
    return Object.entries(catMap)
      .sort((a, b) => b[1].revenue - a[1].revenue)
      .slice(0, 10)
      .map(([name, v]) => ({ name: name.length > 14 ? name.slice(0, 13) + '…' : name, revenue: v.revenue, count: v.count }))
  }, [data?.rows])

  if (error) return <div className="px-6 py-16 text-center" style={{ color: 'var(--danger)' }}>{error}</div>

  return (
    <div className="px-6 py-6 space-y-4">

      {/* Summary bar */}
      {data && (() => {
        const atRiskCount = data.rows.filter(r => r.stock_days < 7 || r.score < 3).length
        const forecast30dTotal = data.rows.reduce((s, r) => s + (r.forecast_30d ?? 0), 0)
        return (
          <div className="glass px-4 py-3 flex items-center gap-3 flex-wrap text-sm">
            <span style={{ color: 'var(--text-muted)' }}>
              Показано: <span className="font-semibold" style={{ color: 'var(--text)' }}>{data.rows.length}</span>
              <span className="text-xs ml-1" style={{ color: 'var(--text-subtle)' }}>из {data.total}</span>
            </span>
            <span style={{ color: 'var(--border-subtle)' }}>•</span>
            {data.selected_revenue > 0 && <>
              <span style={{ color: 'var(--text-muted)' }}>
                Выручка: <span className="font-semibold" style={{ color: 'var(--text)' }}>{fmt(data.selected_revenue)} ₽</span>
              </span>
              <span style={{ color: 'var(--border-subtle)' }}>•</span>
            </>}
            <span style={{ color: 'var(--text-muted)' }}>
              В риске: <span className="font-semibold" style={{ color: atRiskCount > 0 ? 'var(--danger)' : 'var(--success)' }}>{atRiskCount} SKU</span>
            </span>
            <span style={{ color: 'var(--border-subtle)' }}>•</span>
            <span style={{ color: 'var(--text-muted)' }}>
              Прогноз 30д: <span className="font-semibold" style={{ color: 'var(--text)' }}>{fmt(forecast30dTotal)} шт</span>
            </span>
            <div className="ml-auto flex items-center gap-2">
              {hasFilters && (
                <button onClick={resetFilters} className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg" style={{ color: 'var(--accent)', background: 'var(--accent-glow)' }}>
                  <X size={11} /> Сбросить
                </button>
              )}
              <button
                onClick={() => {}}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl font-medium"
                style={{ background: 'var(--border)', color: 'var(--text-muted)' }}
              >
                <Download size={13} /> Скачать
              </button>
            </div>
          </div>
        )
      })()}

      {/* Filter bar */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="SKU, название, бренд..."
            className="w-full pl-8 pr-3 py-2 text-sm rounded-xl border outline-none"
            style={{ background: 'var(--surface-solid)', border: '1px solid var(--border)', color: 'var(--text)' }}
          />
        </div>

        {(['all','novelty','no_novelty'] as const).map(v => (
          <button key={v} onClick={() => setFilterNovelty(v)}
            className="text-xs px-3 py-1.5 rounded-xl font-medium transition-all"
            style={{ background: filterNovelty === v ? 'var(--accent)' : 'var(--border)', color: filterNovelty === v ? 'white' : 'var(--text-muted)' }}>
            {v === 'all' ? 'Все' : v === 'novelty' ? 'Новинки' : 'Без новинок'}
          </button>
        ))}

        <button onClick={() => setFiltersOpen(v => !v)}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl font-medium"
          style={{ background: filtersOpen ? 'var(--accent-glow)' : 'var(--border)', color: filtersOpen ? 'var(--accent)' : 'var(--text-muted)' }}>
          <Filter size={12} /> Фильтры {hasFilters ? '●' : ''}
        </button>
        <button onClick={() => setSidePanelOpen(v => !v)}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl font-medium"
          style={{ background: sidePanelOpen ? 'var(--accent-glow)' : 'var(--border)', color: sidePanelOpen ? 'var(--accent)' : 'var(--text-muted)' }}>
          <SlidersHorizontal size={12} /> Доп. фильтры {(filterOosOnly || filterDrrOnly || filterLowMarginOnly || filterWithAds) ? '●' : ''}
        </button>
      </div>

      {/* Additional filters */}
      {filtersOpen && (
        <div className="glass px-4 py-3 flex flex-wrap gap-4">
          <div className="space-y-1">
            <p className="text-xs font-medium" style={{ color: 'var(--text-subtle)' }}>OOS</p>
            <div className="flex gap-1">
              {(['all','critical','warning','ok'] as const).map(v => (
                <button key={v} onClick={() => setFilterOos(v)}
                  className="text-xs px-2 py-1 rounded-lg"
                  style={{ background: filterOos === v ? 'var(--danger-bg)' : 'var(--border)', color: filterOos === v ? 'var(--danger)' : 'var(--text-muted)' }}>
                  {v === 'all' ? 'Все' : v === 'critical' ? 'Крит.' : v === 'warning' ? 'Вним.' : 'Норма'}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium" style={{ color: 'var(--text-subtle)' }}>ДРР</p>
            <div className="flex gap-1">
              {(['all','over','under'] as const).map(v => (
                <button key={v} onClick={() => setFilterDrr(v)}
                  className="text-xs px-2 py-1 rounded-lg"
                  style={{ background: filterDrr === v ? 'var(--warning-bg)' : 'var(--border)', color: filterDrr === v ? 'var(--warning)' : 'var(--text-muted)' }}>
                  {v === 'all' ? 'Все' : v === 'over' ? 'ДРР>Маржа' : 'ДРР<Маржа'}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium" style={{ color: 'var(--text-subtle)' }}>Маржа</p>
            <div className="flex gap-1">
              {(['all','low','mid','high'] as const).map(v => (
                <button key={v} onClick={() => setFilterMargin(v)}
                  className="text-xs px-2 py-1 rounded-lg"
                  style={{ background: filterMargin === v ? 'var(--success-bg)' : 'var(--border)', color: filterMargin === v ? 'var(--success)' : 'var(--text-muted)' }}>
                  {v === 'all' ? 'Все' : v === 'low' ? '<15%' : v === 'mid' ? '15–20%' : '>20%'}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* E.4: Mini charts — категории по выручке */}
      {categoryChartData.length > 0 && (
        <GlassCard padding="none">
          <div className="px-4 pt-3 pb-1">
            <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-subtle)' }}>
              Топ категорий по выручке
            </p>
            <ResponsiveContainer width="100%" height={140}>
              <BarChart data={categoryChartData} margin={{ top: 0, right: 8, bottom: 0, left: 8 }} layout="vertical">
                <XAxis type="number" hide tickFormatter={v => fmtAxis(v as number)} />
                <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
                <Tooltip
                  contentStyle={{ background: 'var(--surface-popup)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 12 }}
                  formatter={(v, _n, p) => [fmtFull(v as number) + ' ₽ · ' + (p.payload as { count: number }).count + ' SKU', '']}
                />
                <Bar dataKey="revenue" radius={[0, 4, 4, 0]} maxBarSize={16}>
                  {categoryChartData.map((_, i) => (
                    <Cell key={i} fill={`hsl(${210 + i * 18}, 70%, ${55 - i * 2}%)`} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </GlassCard>
      )}

      {/* Side panel + table layout */}
      <div className="flex gap-4 items-start">

      {/* Side panel */}
      {sidePanelOpen && (
        <div className="w-[240px] shrink-0 glass rounded-2xl p-4 space-y-4" style={{ borderRadius: 'var(--radius-xl)' }}>
          <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Быстрые фильтры</p>
          {[
            { key: 'oos', label: 'OOS критично', state: filterOosOnly, toggle: () => setFilterOosOnly(v => !v) },
            { key: 'drr', label: 'ДРР > Маржа', state: filterDrrOnly, toggle: () => setFilterDrrOnly(v => !v) },
            { key: 'margin', label: 'Маржа < 15%', state: filterLowMarginOnly, toggle: () => setFilterLowMarginOnly(v => !v) },
            { key: 'ads', label: 'Только с рекламой', state: filterWithAds, toggle: () => setFilterWithAds(v => !v) },
          ].map(f => (
            <label key={f.key} className="flex items-center gap-2.5 cursor-pointer" onClick={f.toggle}>
              <div
                className="w-4 h-4 rounded flex items-center justify-center shrink-0 transition-colors"
                style={{ background: f.state ? 'var(--accent)' : 'transparent', border: f.state ? 'none' : '1px solid var(--border)' }}
              >
                {f.state && <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
              </div>
              <span className="text-xs" style={{ color: 'var(--text)' }}>{f.label}</span>
            </label>
          ))}
          <button
            onClick={() => { setFilterOosOnly(false); setFilterDrrOnly(false); setFilterLowMarginOnly(false); setFilterWithAds(false) }}
            className="w-full text-xs py-1.5 rounded-xl font-medium mt-2"
            style={{ background: 'var(--border)', color: 'var(--text-muted)' }}
          >
            Сбросить
          </button>
        </div>
      )}

      {/* Main table */}
      <div className="flex-1 min-w-0">
      <GlassCard padding="none">
        <div className="overflow-x-auto">
          <table className="w-full text-sm sticky-thead">
            <thead>
              <tr className="text-xs border-b" style={{ borderColor: 'var(--border)', color: 'var(--text-subtle)' }}>
                <th className="text-left px-2 py-2.5 font-medium whitespace-nowrap">OOS</th>
                <th className="text-left px-2 py-2.5 font-medium whitespace-nowrap">Маржа</th>
                <th className="px-2 py-2.5 font-medium whitespace-nowrap">
                  <span className="flex items-center justify-center gap-0.5 cursor-pointer" onClick={() => toggleSort('score')} style={{ color: sortKey === 'score' ? 'var(--accent)' : 'var(--text-subtle)' }}>
                    Score <SortIcon active={sortKey === 'score'} dir={sortDir} />
                  </span>
                </th>
                <th className="text-left px-2 py-2.5 font-medium">SKU</th>
                <th className="text-left px-2 py-2.5 font-medium max-w-[140px]">Название</th>
                <th className="text-left px-2 py-2.5 font-medium max-w-[80px]">Менеджер</th>
                <th className="text-left px-2 py-2.5 font-medium">Категория</th>
                <Th label="Выручка" sortKey="revenue" current={sortKey} dir={sortDir} onClick={toggleSort} />
                <Th label="Маржа%" sortKey="margin_pct" current={sortKey} dir={sortDir} onClick={toggleSort} />
                <Th label="ЧМД" sortKey="chmd" current={sortKey} dir={sortDir} onClick={toggleSort} />
                <Th label="ДРР" sortKey="drr" current={sortKey} dir={sortDir} onClick={toggleSort} />
                <Th label="CTR" sortKey="ctr" current={sortKey} dir={sortDir} onClick={toggleSort} />
                <Th label="CR з." sortKey="cr_order" current={sortKey} dir={sortDir} onClick={toggleSort} />
                <Th label="Остаток" sortKey="stock_qty" current={sortKey} dir={sortDir} onClick={toggleSort} />
                <Th label="Запас дн." sortKey="stock_days" current={sortKey} dir={sortDir} onClick={toggleSort} />
                <Th label="CPO" sortKey="cpo" current={sortKey} dir={sortDir} onClick={toggleSort} />
                <Th label="Прогноз 30д" sortKey="forecast_30d" current={sortKey} dir={sortDir} onClick={toggleSort} />
              </tr>
            </thead>
            <tbody>
              {loading && Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="border-t" style={{ borderColor: 'var(--border)' }}>
                  {Array.from({ length: 17 }).map((__, j) => (
                    <td key={j} className="px-2 py-1.5"><div className="skeleton h-4 w-full" /></td>
                  ))}
                </tr>
              ))}
              {!loading && (data?.rows ?? []).map((row, i) => {
                const isLowMargin = row.margin_pct < 0.10
                const isDrrOver = row.drr != null && row.drr > row.margin_pct && row.drr > 0
                const oosColor = row.oos_status === 'critical' ? 'var(--danger)' : row.oos_status === 'warning' ? 'var(--warning)' : 'var(--text-subtle)'
                const marginColor = row.margin_pct > 0.30 ? 'var(--success)' : row.margin_pct > 0.15 ? 'var(--warning)' : 'var(--danger)'
                return (
                  <tr
                    key={i}
                    className="border-t transition-colors"
                    style={{ borderColor: 'var(--border)', cursor: 'pointer' }}
                    onClick={() => setSelectedSku(row.sku)}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-hover)' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '' }}
                  >
                    {/* OOS badge */}
                    <td className="px-2 py-1">
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md whitespace-nowrap"
                        style={{ background: row.oos_status === 'critical' ? 'var(--danger-bg)' : row.oos_status === 'warning' ? 'var(--warning-bg)' : 'transparent', color: oosColor }}>
                        {row.oos_status === 'critical' ? 'OOS' : row.oos_status === 'warning' ? 'Low' : '—'}
                      </span>
                    </td>
                    {/* Margin badge */}
                    <td className="px-2 py-1">
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md"
                        style={{ background: isLowMargin ? 'var(--danger-bg)' : row.margin_pct > 0.15 ? 'var(--success-bg)' : 'var(--warning-bg)', color: marginColor }}>
                        {fmtPct(row.margin_pct)}
                      </span>
                    </td>
                    {/* Score */}
                    <td className="px-2 py-1"><ScoreBadge score={row.score} size="sm" /></td>
                    {/* SKU */}
                    <td className="px-2 py-1 font-mono text-xs whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>{row.sku}</td>
                    {/* Name */}
                    <td className="px-2 py-1 max-w-[140px]">
                      <span className="block truncate text-xs" title={row.name} style={{ color: 'var(--text)' }}>{row.name}</span>
                      {row.novelty && <span className="text-[10px] px-1 rounded" style={{ background: 'var(--info-bg)', color: 'var(--info)' }}>Новинка</span>}
                    </td>
                    {/* Manager */}
                    <td className="px-2 py-1 max-w-[80px]">
                      <span className="block truncate text-xs" title={row.manager} style={{ color: 'var(--text-muted)' }}>{row.manager || '—'}</span>
                    </td>
                    {/* Category */}
                    <td className="px-2 py-1 text-xs max-w-[100px]">
                      <span className="block truncate" title={row.category} style={{ color: 'var(--text-muted)' }}>{row.category || '—'}</span>
                    </td>
                    {/* Revenue */}
                    <td className="px-2 py-1 text-right text-xs font-semibold whitespace-nowrap" title={fmtFull(row.revenue) + ' ₽'} style={{ color: 'var(--text)' }}>
                      {fmt(row.revenue)}
                      {row.delta_revenue_pct != null && (
                        <div className="text-[10px] font-normal leading-none mt-0.5"
                          style={{ color: row.delta_revenue_pct >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                          {row.delta_revenue_pct >= 0 ? '▲' : '▼'} {Math.abs(row.delta_revenue_pct * 100).toFixed(1)}%
                        </div>
                      )}
                    </td>
                    {/* Margin % — already in badge, just show number */}
                    <td className="px-2 py-1 text-right text-xs" style={{ color: marginColor }}>{fmtPct(row.margin_pct)}</td>
                    {/* ЧМД */}
                    <td className="px-2 py-1 text-right text-xs whitespace-nowrap" title={Math.round(row.chmd).toLocaleString('ru-RU') + ' ₽'} style={{ color: 'var(--text-muted)' }}>{fmt(row.chmd)}</td>
                    {/* ДРР */}
                    <td className="px-2 py-1 text-right text-xs" style={{ color: isDrrOver ? 'var(--danger)' : 'var(--text-muted)' }}>{fmtPct(row.drr)}</td>
                    {/* CTR */}
                    <td className="px-2 py-1 text-right text-xs" style={{ color: 'var(--text-muted)' }}>{fmtPct(row.ctr)}</td>
                    {/* CR заказ */}
                    <td className="px-2 py-1 text-right text-xs" style={{ color: 'var(--text-muted)' }}>{fmtPct(row.cr_order)}</td>
                    {/* Остаток */}
                    <td className="px-2 py-1 text-right text-xs" style={{ color: 'var(--text-muted)' }}>{fmt(row.stock_qty)}</td>
                    {/* Запас дней */}
                    <td className="px-2 py-1 text-right text-xs">
                      <span style={{ color: row.stock_days < 7 ? 'var(--danger)' : row.stock_days < 14 ? 'var(--warning)' : 'var(--text-muted)' }}>{row.stock_days}</span>
                    </td>
                    {/* CPO */}
                    <td className="px-2 py-1 text-right text-xs whitespace-nowrap" title={row.cpo != null ? Math.round(row.cpo).toLocaleString('ru-RU') + ' ₽' : ''} style={{ color: 'var(--text-muted)' }}>{fmt(row.cpo)}</td>
                    {/* Прогноз 30д */}
                    <td className="px-2 py-1 text-right text-xs" style={{ color: 'var(--text-muted)' }}>{row.forecast_30d != null ? fmt(row.forecast_30d) : '—'}</td>
                  </tr>
                )
              })}
              {!loading && (data?.rows ?? []).length === 0 && (
                <tr>
                  <td colSpan={17} className="px-4 py-12 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                    Нет данных по заданным фильтрам
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </GlassCard>
      </div>
      </div>
      <SkuModal skuMs={selectedSku} onClose={() => setSelectedSku(null)} />
    </div>
  )
}
