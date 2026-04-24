'use client'

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { GlassCard } from '@/components/ui/GlassCard'
import { ScoreBadge } from '@/components/ui/ScoreBadge'
import { Search, Filter, Download, X, ChevronUp, ChevronDown, SlidersHorizontal } from 'lucide-react'
import { SkuModal } from '@/components/ui/SkuModal'
import { useDateRange } from '@/components/ui/DateRangePicker'
import { usePendingFilter, useGlobalFilters } from '@/app/dashboard/page'
import { fmtAxis, fmtFull } from '@/lib/formatters'
import { skuTableCache } from '@/lib/tabCache'
import { exportToExcel } from '@/lib/exportExcel'

interface SkuRow {
  sku: string
  sku_ms: string
  name: string
  manager: string
  category: string
  revenue: number
  margin_pct: number
  chmd: number
  drr: number | null
  ctr: number | null
  cr_basket: number | null
  cr_order: number | null
  stock_qty: number
  stock_days: number
  price: number | null
  cpo: number | null
  forecast_30d: number | null
  delta_revenue_pct: number | null
  score: number
  oos_status: 'critical' | 'warning' | 'ok'
  margin_status: 'high' | 'medium' | 'low'
  novelty: boolean
  fbo_wb: number
  fbs_pushkino: number
  fbs_smolensk: number
  kits_stock: number
}

interface SkuTableData {
  rows: SkuRow[]
  total: number
  selected_count: number
  selected_revenue: number
}

type SortKey = 'sku' | 'name' | 'manager' | 'category' | 'revenue' | 'margin_pct' | 'chmd' | 'drr' | 'ctr' | 'cr_basket' | 'cr_order' | 'stock_qty' | 'stock_days' | 'cpo' | 'forecast_30d' | 'score'
type SortDir = 'asc' | 'desc'

// Module-level cache — survives tab switches within a session
const skuCache = skuTableCache as Map<string, SkuTableData>

function fmtPct(n: number | null | undefined) {
  if (n == null) return '—'
  return (n * 100).toFixed(1) + '%'
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ChevronUp size={12} style={{ opacity: 0.3 }} />
  return dir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />
}

function Th({ label, sortKey, current, dir, onClick, align = 'right' }: {
  label: string; sortKey: SortKey; current: SortKey; dir: SortDir
  onClick: (k: SortKey) => void; align?: 'left' | 'right'
}) {
  return (
    <th
      className={`text-${align} pb-2 pt-2 px-2 font-medium cursor-pointer select-none whitespace-nowrap`}
      style={{ color: current === sortKey ? 'var(--accent)' : 'var(--text-subtle)', fontSize: 11 }}
      onClick={() => onClick(sortKey)}
    >
      <span className={`inline-flex items-center gap-0.5 ${align === 'right' ? 'justify-end' : ''}`}>
        {label}
        <SortIcon active={current === sortKey} dir={dir} />
      </span>
    </th>
  )
}

export default function SkuTableTab() {
  const { range } = useDateRange()
  const { filters } = useGlobalFilters()
  const { pending, setPending } = usePendingFilter()

  // Build cache key
  function makeCacheKey(extra?: Record<string, string>) {
    const p = new URLSearchParams({ from: range.from, to: range.to })
    if (filters.category) p.set('category', filters.category)
    if (filters.manager)  p.set('manager', filters.manager)
    if (filters.novelty)  p.set('gnovelty', filters.novelty)
    if (extra) for (const [k, v] of Object.entries(extra)) p.set(k, v)
    return p.toString()
  }

  const baseCacheKey = makeCacheKey()

  const [data, setData] = useState<SkuTableData | null>(() =>
    skuCache.get(baseCacheKey) ?? null
  )
  const [loading, setLoading] = useState(() => !skuCache.has(baseCacheKey))
  const [error, setError] = useState<string | null>(null)

  // Filters
  const [search, setSearch] = useState('')
  const [filterNovelty, setFilterNovelty] = useState<'all' | 'novelty' | 'no_novelty'>('all')
  const [filterOos, setFilterOos] = useState<'all' | 'critical' | 'warning' | 'ok'>('all')
  const [filterDrr, setFilterDrr] = useState<'all' | 'over' | 'under'>('all')
  const [filterMargin, setFilterMargin] = useState<'all' | 'low' | 'mid' | 'high'>('all')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [sidePanelOpen, setSidePanelOpen] = useState(false)
  const [filterOosOnly, setFilterOosOnly] = useState(false)
  const [filterDrrOnly, setFilterDrrOnly] = useState(false)
  const [filterLowMarginOnly, setFilterLowMarginOnly] = useState(false)
  const [filterWithAds, setFilterWithAds] = useState(false)
  const [filterNoSales, setFilterNoSales] = useState(false)
  const [categoryFilter, setCategoryFilter] = useState('')

  // Sort — default revenue DESC
  const [sortKey, setSortKey] = useState<SortKey>('revenue')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  // Pagination
  const [pageSize, setPageSize] = useState<50 | 100 | 0>(50)
  const [page, setPage] = useState(0)

  // SKU modal
  const [selectedSku, setSelectedSku] = useState<string | null>(null)

  // Sticky layout
  const filterBarRef = useRef<HTMLDivElement>(null)
  const summaryBarRef = useRef<HTMLDivElement>(null)
  const [stickyTop, setStickyTop] = useState({ summaryBar: 88, filterBar: 88 + 44, thead: 88 + 44 + 52 })

  useEffect(() => {
    function measure() {
      const header = document.querySelector('header.top-nav') as HTMLElement | null
      const headerH = header ? header.getBoundingClientRect().height : 88
      const summaryH = summaryBarRef.current ? summaryBarRef.current.getBoundingClientRect().height : 44
      const filterH  = filterBarRef.current  ? filterBarRef.current.getBoundingClientRect().height  : 52
      setStickyTop({
        summaryBar: headerH,
        filterBar:  headerH + summaryH,
        thead:      headerH + summaryH + filterH,
      })
    }
    const t = setTimeout(() => requestAnimationFrame(measure), 100)
    window.addEventListener('resize', measure)
    return () => { clearTimeout(t); window.removeEventListener('resize', measure) }
  }, [filtersOpen, sidePanelOpen])

  // Fetch data
  useEffect(() => {
    const p = new URLSearchParams({ from: range.from, to: range.to })
    if (filters.category) p.set('category', filters.category)
    if (filters.manager)  p.set('manager', filters.manager)
    if (filters.novelty)  p.set('gnovelty', filters.novelty)
    const cacheKey = p.toString()

    const hit = skuCache.get(cacheKey)
    if (hit) { setData(hit); setLoading(false); return }

    setLoading(true)
    setError(null)
    fetch(`/api/dashboard/sku-table?${p}`)
      .then(r => r.ok ? r.json() : r.json().then((e: { error?: string }) => Promise.reject(new Error(e?.error ?? `HTTP ${r.status}`))))
      .then((d: SkuTableData) => {
        skuCache.set(cacheKey, d)
        setData(d)
        setLoading(false)
      })
      .catch((e: unknown) => { setError(String(e)); setLoading(false) })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.from, range.to, filters.category, filters.manager, filters.novelty])

  // Handle pending filter from Overview tab
  useEffect(() => {
    if (!pending) return
    if (pending.type === 'stop_ads' || pending.type === 'oos') setFilterOos('critical')
    else if (pending.type === 'low_stock') setFilterOos('warning')
    else if (pending.type === 'drr_over') setFilterDrr('over')
    setPending(null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggleSort = useCallback((key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }, [sortKey])

  // Reset page on filter/sort change
  useEffect(() => { setPage(0) }, [search, filterNovelty, filterOos, filterDrr, filterMargin, filterOosOnly, filterDrrOnly, filterLowMarginOnly, filterWithAds, filterNoSales, categoryFilter, sortKey, sortDir])

  function resetFilters() {
    setSearch('')
    setFilterNovelty('all')
    setFilterOos('all')
    setFilterDrr('all')
    setFilterMargin('all')
    setFilterOosOnly(false)
    setFilterDrrOnly(false)
    setFilterLowMarginOnly(false)
    setFilterWithAds(false)
    setFilterNoSales(false)
    setCategoryFilter('')
  }

  // Client-side filtering + sorting
  const filteredRows = useMemo(() => {
    if (!data?.rows) return []
    return data.rows.filter(r => {
      if (categoryFilter && r.category !== categoryFilter) return false
      if (search) {
        const q = search.toLowerCase()
        if (!r.name.toLowerCase().includes(q) && !r.sku.includes(q) && !r.sku_ms.toLowerCase().includes(q)) return false
      }
      if (filterNovelty === 'novelty' && !r.novelty) return false
      if (filterNovelty === 'no_novelty' && r.novelty) return false
      if (filterOos !== 'all' && r.oos_status !== filterOos) return false
      if (filterDrr === 'over' && (r.drr == null || r.drr <= r.margin_pct)) return false
      if (filterDrr === 'under' && (r.drr != null && r.drr > r.margin_pct)) return false
      if (filterMargin === 'low' && r.margin_pct >= 0.15) return false
      if (filterMargin === 'mid' && (r.margin_pct < 0.15 || r.margin_pct > 0.20)) return false
      if (filterMargin === 'high' && r.margin_pct <= 0.20) return false
      if (filterOosOnly && r.oos_status !== 'critical') return false
      if (filterDrrOnly && (r.drr == null || r.drr <= r.margin_pct)) return false
      if (filterLowMarginOnly && r.margin_pct >= 0.15) return false
      if (filterWithAds && (r.drr == null || r.drr === 0)) return false
      if (filterNoSales && !(r.stock_qty > 0 && r.revenue < 1)) return false
      return true
    }).sort((a, b) => {
      const mult = sortDir === 'asc' ? 1 : -1
      const av = (a[sortKey] as number | string | null) ?? (typeof a[sortKey] === 'number' ? -Infinity : '')
      const bv = (b[sortKey] as number | string | null) ?? (typeof b[sortKey] === 'number' ? -Infinity : '')
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * mult
      return String(av).localeCompare(String(bv)) * mult
    })
  }, [data?.rows, search, filterNovelty, filterOos, filterDrr, filterMargin, filterOosOnly, filterDrrOnly, filterLowMarginOnly, filterWithAds, categoryFilter, sortKey, sortDir])

  // Mini chart data — computed from ALL loaded rows (no local filter applied)
  const categoryChartData = useMemo(() => {
    if (!data?.rows.length) return []
    const totalRevenue = data.rows.reduce((s, r) => s + r.revenue, 0)
    const catMap: Record<string, { revenue: number; prevRevenue: number; count: number }> = {}
    for (const r of data.rows) {
      const cat = r.category || 'Без категории'
      if (!catMap[cat]) catMap[cat] = { revenue: 0, prevRevenue: 0, count: 0 }
      catMap[cat].revenue += r.revenue
      catMap[cat].count++
      if (r.delta_revenue_pct != null && r.revenue > 0) {
        // delta_revenue_pct = (curr - prev) / curr → prev = curr * (1 - delta/100)
        const prev = r.revenue / (1 - r.delta_revenue_pct)
        catMap[cat].prevRevenue += isFinite(prev) ? prev : 0
      } else {
        catMap[cat].prevRevenue += r.revenue // no delta → assume no change
      }
    }
    return Object.entries(catMap)
      .sort((a, b) => b[1].revenue - a[1].revenue)
      .map(([name, v]) => ({
        name: name.length > 22 ? name.slice(0, 21) + '…' : name,
        fullName: name,
        revenue: v.revenue,
        count: v.count,
        sharePct: totalRevenue > 0 ? (v.revenue / totalRevenue * 100) : 0,
      }))
  }, [data?.rows])

  const categoryDeltaData = useMemo(() => {
    if (!data?.rows.length) return []
    const catMap: Record<string, { revenue: number; count: number; deltaSum: number; deltaN: number }> = {}
    for (const r of data.rows) {
      const cat = r.category || 'Без категории'
      if (!catMap[cat]) catMap[cat] = { revenue: 0, count: 0, deltaSum: 0, deltaN: 0 }
      catMap[cat].revenue += r.revenue
      catMap[cat].count++
      if (r.delta_revenue_pct != null) {
        catMap[cat].deltaSum += r.delta_revenue_pct * 100
        catMap[cat].deltaN++
      }
    }
    return Object.entries(catMap)
      .filter(([, v]) => v.deltaN > 0)
      .map(([name, v]) => ({
        name: name.length > 16 ? name.slice(0, 15) + '…' : name,
        fullName: name,
        delta: v.deltaN > 0 ? v.deltaSum / v.deltaN : 0,
        revenue: v.revenue,
        count: v.count,
      }))
      .sort((a, b) => b.delta - a.delta)
  }, [data?.rows])

  const hasFilters = !!(search || filterNovelty !== 'all' || filterOos !== 'all' || filterDrr !== 'all' || filterMargin !== 'all' || filterOosOnly || filterDrrOnly || filterLowMarginOnly || filterWithAds || filterNoSales || categoryFilter)

  const pagedRows = pageSize === 0
    ? filteredRows
    : filteredRows.slice(page * pageSize, (page + 1) * pageSize)
  const totalPages = pageSize === 0 ? 1 : Math.ceil(filteredRows.length / pageSize)

  const atRiskCount = (data?.rows ?? []).filter(r => r.stock_days < 7 || r.score < 3).length
  const forecast30dTotal = filteredRows.reduce((s, r) => s + (r.forecast_30d ?? 0), 0)
  const filteredRevenue = filteredRows.reduce((s, r) => s + r.revenue, 0)

  if (error) return <div className="px-6 py-16 text-center" style={{ color: 'var(--danger)' }}>{error}</div>

  return (
    <div className="py-6 space-y-4" style={{ position: 'relative' }}>

      {/* ── 1. Summary bar (sticky) ── */}
      <div
        ref={summaryBarRef}
        className="px-6"
        style={{ position: 'sticky', top: stickyTop.summaryBar, zIndex: 30 }}
      >
        <div className="glass px-4 py-2.5 flex items-center gap-3 flex-wrap text-sm" style={{ background: 'var(--surface-solid)', backdropFilter: 'blur(12px)' }}>
          <span style={{ color: 'var(--text-muted)' }}>
            Показано: <span className="font-semibold" style={{ color: 'var(--text)' }}>{filteredRows.length}</span>
            <span className="text-xs ml-1" style={{ color: 'var(--text-subtle)' }}>из {data?.total ?? 0}</span>
          </span>
          <span style={{ color: 'var(--border-subtle)' }}>•</span>
          <span style={{ color: 'var(--text-muted)' }}>
            Выручка: <span className="font-semibold" style={{ color: 'var(--text)' }}>{fmtFull(filteredRevenue)} ₽</span>
          </span>
          {atRiskCount > 0 && <>
            <span style={{ color: 'var(--border-subtle)' }}>•</span>
            <span style={{ color: 'var(--text-muted)' }}>
              В риске: <span className="font-semibold" style={{ color: 'var(--danger)' }}>{atRiskCount} SKU</span>
            </span>
          </>}
          <span style={{ color: 'var(--border-subtle)' }}>•</span>
          <span style={{ color: 'var(--text-muted)' }}>
            Прогноз 30д: <span className="font-semibold" style={{ color: 'var(--text)' }}>{fmtFull(forecast30dTotal)} ₽</span>
          </span>
          <div className="ml-auto flex items-center gap-2">
            {hasFilters && (
              <button onClick={resetFilters} className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg" style={{ color: 'var(--accent)', background: 'var(--accent-glow)' }}>
                <X size={11} /> Сбросить
              </button>
            )}
            <button
              onClick={() => {
                const rows = filteredRows.map(r => ({
                  'SKU WB': r.sku,
                  'SKU МС': r.sku_ms,
                  'Название': r.name,
                  'Менеджер': r.manager,
                  'Категория': r.category,
                  'Выручка, ₽': Math.round(r.revenue),
                  'Δ выручка %': r.delta_revenue_pct != null ? +((r.delta_revenue_pct * 100).toFixed(1)) : '',
                  'Маржа %': +((r.margin_pct * 100).toFixed(1)),
                  'ЧМД, ₽': Math.round(r.chmd),
                  'ДРР %': r.drr != null ? +((r.drr * 100).toFixed(1)) : '',
                  'CTR %': r.ctr != null ? +((r.ctr * 100).toFixed(1)) : '',
                  'CR заказ %': r.cr_order != null ? +((r.cr_order * 100).toFixed(1)) : '',
                  'Остаток, шт': r.stock_qty,
                  'Запас, дн.': r.stock_days,
                  'CPO, ₽': r.cpo != null ? Math.round(r.cpo) : '',
                  'Прогноз 30д, ₽': r.forecast_30d != null ? Math.round(r.forecast_30d) : '',
                  'Score': r.score,
                }))
                exportToExcel(rows, `SKU_аналитика_${new Date().toISOString().slice(0, 10)}`)
              }}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl font-medium"
              style={{ background: 'var(--border)', color: 'var(--text-muted)' }}
            >
              <Download size={13} /> Скачать
            </button>
          </div>
        </div>
      </div>

      {/* ── 2. Mini charts (2 в ряд) ── */}
      {!loading && (categoryChartData.length > 0 || categoryDeltaData.length > 0) && (
        <div className="px-6 grid grid-cols-1 xl:grid-cols-2 gap-4">

          {/* Chart A — Категории по выручке */}
          {categoryChartData.length > 0 && (
            <GlassCard padding="none">
              <div className="px-4 pt-3 pb-3">
                <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-subtle)' }}>
                  Категории по выручке
                  {categoryFilter && (
                    <button onClick={() => setCategoryFilter('')} className="ml-2 text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--accent-glow)', color: 'var(--accent)' }}>
                      × сброс
                    </button>
                  )}
                </p>
                <div style={{ maxHeight: 320, overflowY: 'auto' }} className="space-y-2 pr-1">
                  {(() => {
                    const maxRev = categoryChartData[0]?.revenue ?? 1
                    return categoryChartData.map((item, i) => {
                      const isActive = categoryFilter === item.fullName
                      const pct = Math.max(2, (item.revenue / maxRev) * 100)
                      return (
                        <div
                          key={i}
                          className="group cursor-pointer"
                          onClick={() => setCategoryFilter(prev => prev === item.fullName ? '' : item.fullName)}
                        >
                          <div className="flex items-center justify-between mb-0.5 gap-2">
                            <span className="text-xs truncate flex-1 font-medium" style={{ color: isActive ? 'var(--accent)' : 'var(--text)' }}>
                              <span className="mr-1.5 text-[10px]" style={{ color: 'var(--text-subtle)' }}>{i + 1}</span>
                              {item.fullName}
                            </span>
                            <span className="text-xs whitespace-nowrap font-semibold shrink-0" style={{ color: 'var(--text)' }}>
                              {fmtAxis(item.revenue)} ₽
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
                              <div
                                className="h-full rounded-full transition-all"
                                style={{ width: `${pct}%`, background: isActive ? 'var(--accent)' : 'var(--accent)', opacity: categoryFilter && !isActive ? 0.3 : 0.75 }}
                              />
                            </div>
                            <span className="text-[10px] shrink-0" style={{ color: 'var(--text-subtle)' }}>
                              {item.count} SKU · {item.sharePct.toFixed(1)}%
                            </span>
                          </div>
                        </div>
                      )
                    })
                  })()}
                </div>
                <p className="text-[10px] mt-2" style={{ color: 'var(--text-subtle)' }}>Нажмите на категорию для фильтрации таблицы</p>
              </div>
            </GlassCard>
          )}

          {/* Chart B — Динамика категорий (дельта %) */}
          {categoryDeltaData.length > 0 && (
            <GlassCard padding="none">
              <div className="px-4 pt-3 pb-3">
                <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-subtle)' }}>
                  Динамика категорий vs пред. период
                </p>
                <div style={{ maxHeight: 320, overflowY: 'auto' }} className="space-y-2 pr-1">
                  {(() => {
                    const maxAbs = Math.max(...categoryDeltaData.map(d => Math.abs(d.delta)), 1)
                    return categoryDeltaData.map((item, i) => {
                      const isPos = item.delta >= 0
                      const barPct = Math.max(2, (Math.abs(item.delta) / maxAbs) * 100)
                      return (
                        <div key={i}>
                          <div className="flex items-center justify-between mb-0.5 gap-2">
                            <span className="flex items-center gap-1 text-xs truncate flex-1 font-medium" style={{ color: 'var(--text)' }}>
                              <span style={{ color: isPos ? '#22c55e' : '#ef4444' }}>{isPos ? '▲' : '▼'}</span>
                              {item.fullName}
                            </span>
                            <div className="text-right shrink-0">
                              <span className="text-xs font-semibold" style={{ color: isPos ? '#22c55e' : '#ef4444' }}>
                                {isPos ? '+' : ''}{item.delta.toFixed(1)}%
                              </span>
                              <span className="text-[10px] ml-1.5" style={{ color: 'var(--text-subtle)' }}>
                                {fmtAxis(item.revenue)} ₽
                              </span>
                            </div>
                          </div>
                          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
                            <div
                              className="h-full rounded-full"
                              style={{ width: `${barPct}%`, background: isPos ? '#22c55e' : '#ef4444', opacity: 0.75 }}
                            />
                          </div>
                        </div>
                      )
                    })
                  })()}
                </div>
              </div>
            </GlassCard>
          )}
        </div>
      )}

      {/* ── 3. Filter bar (sticky) ── */}
      <div
        ref={filterBarRef}
        className="px-6"
        style={{ position: 'sticky', top: stickyTop.filterBar, zIndex: 29 }}
      >
        <div
          className="py-2 flex flex-wrap gap-2 items-center"
          style={{ background: 'var(--surface-solid)', backdropFilter: 'blur(12px)' }}
        >
          {/* Search */}
          <div className="relative flex-1 min-w-[180px] max-w-xs">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="SKU, название..."
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-xl border outline-none"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)' }}
            />
          </div>

          {/* Novelty toggle */}
          {(['all', 'novelty', 'no_novelty'] as const).map(v => (
            <button key={v} onClick={() => setFilterNovelty(v)}
              className="text-xs px-2.5 py-1.5 rounded-xl font-medium transition-all"
              style={{ background: filterNovelty === v ? 'var(--accent)' : 'var(--border)', color: filterNovelty === v ? 'white' : 'var(--text-muted)' }}>
              {v === 'all' ? 'Все' : v === 'novelty' ? 'Новинки' : 'Без новинок'}
            </button>
          ))}

          {/* Filters toggle */}
          <button onClick={() => setFiltersOpen(v => !v)}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-xl font-medium"
            style={{ background: filtersOpen ? 'var(--accent-glow)' : 'var(--border)', color: filtersOpen ? 'var(--accent)' : 'var(--text-muted)' }}>
            <Filter size={11} /> Фильтры {hasFilters ? '●' : ''}
          </button>
          <button onClick={() => setSidePanelOpen(v => !v)}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-xl font-medium"
            style={{ background: sidePanelOpen ? 'var(--accent-glow)' : 'var(--border)', color: sidePanelOpen ? 'var(--accent)' : 'var(--text-muted)' }}>
            <SlidersHorizontal size={11} /> Ещё {(filterOosOnly || filterDrrOnly || filterLowMarginOnly || filterWithAds) ? '●' : ''}
          </button>

          {/* Pagination size */}
          <div className="ml-auto flex items-center gap-1">
            {([50, 100, 0] as const).map(s => (
              <button key={s} onClick={() => { setPageSize(s); setPage(0) }}
                className="text-xs px-2 py-1 rounded-lg font-medium"
                style={{ background: pageSize === s ? 'var(--accent)' : 'var(--border)', color: pageSize === s ? 'white' : 'var(--text-muted)' }}>
                {s === 0 ? 'Все' : s}
              </button>
            ))}
          </div>
        </div>

        {/* Expanded filters panel */}
        {filtersOpen && (
          <div className="glass px-4 py-3 flex flex-wrap gap-4 mt-1" style={{ background: 'var(--surface-solid)' }}>
            <div className="space-y-1">
              <p className="text-xs font-medium" style={{ color: 'var(--text-subtle)' }}>OOS</p>
              <div className="flex gap-1">
                {(['all', 'critical', 'warning', 'ok'] as const).map(v => (
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
                {(['all', 'over', 'under'] as const).map(v => (
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
                {(['all', 'low', 'mid', 'high'] as const).map(v => (
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
      </div>

      {/* ── 4. Table ── */}
      <div className="px-6 flex gap-4 items-start">

        {/* Side panel */}
        {sidePanelOpen && (
          <div className="w-[200px] shrink-0 glass rounded-2xl p-4 space-y-3">
            <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Быстрые фильтры</p>
            {[
              { key: 'oos',    label: 'OOS критично',       state: filterOosOnly,       toggle: () => setFilterOosOnly(v => !v) },
              { key: 'drr',    label: 'ДРР > Маржа',        state: filterDrrOnly,       toggle: () => setFilterDrrOnly(v => !v) },
              { key: 'margin', label: 'Маржа < 15%',        state: filterLowMarginOnly, toggle: () => setFilterLowMarginOnly(v => !v) },
              { key: 'ads',    label: 'Только с рекламой',  state: filterWithAds,       toggle: () => setFilterWithAds(v => !v) },
              { key: 'nosales', label: 'Остаток, нет продаж', state: filterNoSales,      toggle: () => setFilterNoSales(v => !v) },
            ].map(f => (
              <label key={f.key} className="flex items-center gap-2 cursor-pointer" onClick={f.toggle}>
                <div className="w-4 h-4 rounded flex items-center justify-center shrink-0" style={{ background: f.state ? 'var(--accent)' : 'transparent', border: f.state ? 'none' : '1px solid var(--border)' }}>
                  {f.state && <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                </div>
                <span className="text-xs" style={{ color: 'var(--text)' }}>{f.label}</span>
              </label>
            ))}
            <button
              onClick={() => { setFilterOosOnly(false); setFilterDrrOnly(false); setFilterLowMarginOnly(false); setFilterWithAds(false); setFilterNoSales(false) }}
              className="w-full text-xs py-1 rounded-xl font-medium"
              style={{ background: 'var(--border)', color: 'var(--text-muted)' }}
            >
              Сбросить
            </button>
          </div>
        )}

        {/* Main table */}
        <div className="flex-1 min-w-0">
          <GlassCard padding="none">
            <div style={{ overflowX: 'clip' }}>
              <table className="w-full text-xs">
                <thead>
                  <tr
                    className="border-b"
                    style={{
                      borderColor: 'var(--border)',
                      position: 'sticky',
                      top: stickyTop.thead,
                      zIndex: 28,
                      background: 'var(--surface-solid)',
                      backdropFilter: 'blur(12px)',
                    }}
                  >
                    <th className="text-left px-2 py-2 font-medium whitespace-nowrap" style={{ color: 'var(--text-subtle)', fontSize: 11 }}>OOS</th>
                    <th className="px-2 py-2 font-medium whitespace-nowrap" style={{ color: sortKey === 'score' ? 'var(--accent)' : 'var(--text-subtle)', fontSize: 11, cursor: 'pointer' }} onClick={() => toggleSort('score')}>
                      <span className="inline-flex items-center gap-0.5">Score <SortIcon active={sortKey === 'score'} dir={sortDir} /></span>
                    </th>
                    <th className="text-left px-2 py-2 font-medium" style={{ color: 'var(--text-subtle)', fontSize: 11 }}>SKU</th>
                    <th className="text-left px-2 py-2 font-medium max-w-[140px]" style={{ color: 'var(--text-subtle)', fontSize: 11 }}>Название</th>
                    <th className="text-left px-2 py-2 font-medium max-w-[80px]" style={{ color: 'var(--text-subtle)', fontSize: 11 }}>Менеджер</th>
                    <th className="text-left px-2 py-2 font-medium" style={{ color: 'var(--text-subtle)', fontSize: 11 }}>Категория</th>
                    <Th label="Выручка"    sortKey="revenue"     current={sortKey} dir={sortDir} onClick={toggleSort} />
                    <Th label="Маржа%"     sortKey="margin_pct"  current={sortKey} dir={sortDir} onClick={toggleSort} />
                    <Th label="ЧМД"        sortKey="chmd"        current={sortKey} dir={sortDir} onClick={toggleSort} />
                    <Th label="ДРР"        sortKey="drr"         current={sortKey} dir={sortDir} onClick={toggleSort} />
                    <Th label="CTR"        sortKey="ctr"         current={sortKey} dir={sortDir} onClick={toggleSort} />
                    <Th label="CR з."      sortKey="cr_order"    current={sortKey} dir={sortDir} onClick={toggleSort} />
                    <Th label="Остаток"    sortKey="stock_qty"   current={sortKey} dir={sortDir} onClick={toggleSort} />
                    <Th label="Запас дн."  sortKey="stock_days"  current={sortKey} dir={sortDir} onClick={toggleSort} />
                    <Th label="CPO"        sortKey="cpo"         current={sortKey} dir={sortDir} onClick={toggleSort} />
                    <Th label="Прогноз 30д ₽" sortKey="forecast_30d" current={sortKey} dir={sortDir} onClick={toggleSort} />
                  </tr>
                </thead>
                <tbody>
                  {loading && Array.from({ length: 10 }).map((_, i) => (
                    <tr key={i} className="border-t" style={{ borderColor: 'var(--border)' }}>
                      {Array.from({ length: 16 }).map((__, j) => (
                        <td key={j} className="px-2 py-1.5"><div className="skeleton h-3 w-full" /></td>
                      ))}
                    </tr>
                  ))}
                  {!loading && pagedRows.map((row, i) => {
                    const isLowMargin = row.margin_pct < 0.10
                    const isDrrOver = row.drr != null && row.drr > row.margin_pct && row.drr > 0
                    const oosColor = row.oos_status === 'critical' ? 'var(--danger)' : row.oos_status === 'warning' ? 'var(--warning)' : 'var(--text-subtle)'
                    const marginColor = row.margin_pct > 0.30 ? 'var(--success)' : row.margin_pct > 0.15 ? 'var(--warning)' : 'var(--danger)'
                    return (
                      <tr
                        key={i}
                        className="border-t transition-colors"
                        style={{ borderColor: 'var(--border)', cursor: 'pointer' }}
                        onClick={() => setSelectedSku(row.sku_ms)}
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
                        {/* Score */}
                        <td className="px-2 py-1"><ScoreBadge score={row.score} size="sm" /></td>
                        {/* SKU */}
                        <td className="px-2 py-1 font-mono whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>{row.sku}</td>
                        {/* Name */}
                        <td className="px-2 py-1 max-w-[140px]">
                          <span className="block truncate" title={row.name} style={{ color: 'var(--text)' }}>{row.name}</span>
                          {row.novelty && <span className="text-[10px] px-1 rounded" style={{ background: 'var(--info-bg)', color: 'var(--info)' }}>Новинка</span>}
                        </td>
                        {/* Manager */}
                        <td className="px-2 py-1 max-w-[80px]">
                          <span className="block truncate" title={row.manager} style={{ color: 'var(--text-muted)' }}>{row.manager || '—'}</span>
                        </td>
                        {/* Category */}
                        <td className="px-2 py-1 max-w-[100px]">
                          <span className="block truncate" title={row.category} style={{ color: 'var(--text-muted)' }}>{row.category || '—'}</span>
                        </td>
                        {/* Revenue */}
                        <td className="px-2 py-1 text-right font-semibold whitespace-nowrap" title={fmtFull(row.revenue) + ' ₽'} style={{ color: 'var(--text)' }}>
                          {fmtAxis(row.revenue)}
                          {row.delta_revenue_pct != null && (
                            <div className="text-[10px] font-normal leading-none mt-0.5"
                              style={{ color: row.delta_revenue_pct >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                              {row.delta_revenue_pct >= 0 ? '▲' : '▼'} {Math.abs(row.delta_revenue_pct * 100).toFixed(1)}%
                            </div>
                          )}
                        </td>
                        {/* Margin % */}
                        <td className="px-2 py-1 text-right" style={{ color: marginColor }}>{fmtPct(row.margin_pct)}</td>
                        {/* ЧМД */}
                        <td className="px-2 py-1 text-right whitespace-nowrap" title={fmtFull(row.chmd) + ' ₽'} style={{ color: 'var(--text-muted)' }}>{fmtAxis(row.chmd)}</td>
                        {/* ДРР */}
                        <td className="px-2 py-1 text-right" style={{ color: isDrrOver ? 'var(--danger)' : 'var(--text-muted)' }}>{fmtPct(row.drr)}</td>
                        {/* CTR */}
                        <td className="px-2 py-1 text-right" style={{ color: 'var(--text-muted)' }}>{fmtPct(row.ctr)}</td>
                        {/* CR заказ */}
                        <td className="px-2 py-1 text-right" style={{ color: 'var(--text-muted)' }}>{fmtPct(row.cr_order)}</td>
                        {/* Остаток */}
                        <td className="px-2 py-1 text-right" style={{ color: 'var(--text-muted)' }}>{fmtAxis(row.stock_qty)}</td>
                        {/* Запас дней */}
                        <td className="px-2 py-1 text-right">
                          <span style={{ color: row.stock_days < 7 ? 'var(--danger)' : row.stock_days < 14 ? 'var(--warning)' : 'var(--text-muted)' }}>{row.stock_days}</span>
                        </td>
                        {/* CPO */}
                        <td className="px-2 py-1 text-right whitespace-nowrap" title={row.cpo != null ? fmtFull(row.cpo) + ' ₽' : ''} style={{ color: 'var(--text-muted)' }}>
                          {row.cpo != null ? fmtAxis(row.cpo) : '—'}
                        </td>
                        {/* Прогноз 30д ₽ */}
                        <td className="px-2 py-1 text-right whitespace-nowrap" title={row.forecast_30d != null ? fmtFull(row.forecast_30d) + ' ₽' : ''} style={{ color: 'var(--text-muted)' }}>
                          {row.forecast_30d != null ? fmtAxis(row.forecast_30d) : '—'}
                        </td>
                      </tr>
                    )
                  })}
                  {!loading && pagedRows.length === 0 && (
                    <tr>
                      <td colSpan={17} className="px-4 py-12 text-center" style={{ color: 'var(--text-muted)' }}>
                        Нет данных по заданным фильтрам
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {!loading && totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-2.5 border-t" style={{ borderColor: 'var(--border)' }}>
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {filteredRows.length} строк · страница {page + 1} из {totalPages}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage(p => Math.max(0, p - 1))}
                    disabled={page === 0}
                    className="text-xs px-2 py-1 rounded-lg disabled:opacity-30"
                    style={{ background: 'var(--border)', color: 'var(--text-muted)' }}
                  >
                    ← Пред.
                  </button>
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    const p = Math.max(0, Math.min(page - 2, totalPages - 5)) + i
                    return (
                      <button key={p} onClick={() => setPage(p)}
                        className="text-xs px-2 py-1 rounded-lg"
                        style={{ background: page === p ? 'var(--accent)' : 'var(--border)', color: page === p ? 'white' : 'var(--text-muted)' }}>
                        {p + 1}
                      </button>
                    )
                  })}
                  <button
                    onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                    disabled={page >= totalPages - 1}
                    className="text-xs px-2 py-1 rounded-lg disabled:opacity-30"
                    style={{ background: 'var(--border)', color: 'var(--text-muted)' }}
                  >
                    След. →
                  </button>
                </div>
              </div>
            )}
          </GlassCard>
        </div>
      </div>

      <SkuModal skuMs={selectedSku} onClose={() => setSelectedSku(null)} />
    </div>
  )
}
