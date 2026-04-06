'use client'

import { useEffect, useState, useCallback } from 'react'
import { GlassCard } from '@/components/ui/GlassCard'
import { ScoreBadge } from '@/components/ui/ScoreBadge'
import { PriorityBadge } from '@/components/ui/PriorityBadge'
import { Search, Filter, Download, X, ChevronUp, ChevronDown, SlidersHorizontal } from 'lucide-react'
import { SkuModal } from '@/components/ui/SkuModal'
import { usePendingFilter } from '@/app/dashboard/page'

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

type SortKey = keyof SkuRow
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
    p.set('sort', sortKey)
    p.set('dir', sortDir)
    return '/api/dashboard/sku-table?' + p.toString()
  }, [search, filterNovelty, filterOos, filterDrr, filterMargin, filterOosOnly, filterDrrOnly, filterLowMarginOnly, filterWithAds, sortKey, sortDir])

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

  if (error) return <div className="px-6 py-16 text-center" style={{ color: 'var(--danger)' }}>{error}</div>

  return (
    <div className="px-6 py-6 space-y-4 max-w-[1440px] mx-auto">

      {/* Summary bar */}
      {data && (
        <div className="glass px-4 py-3 flex items-center gap-4 flex-wrap text-sm">
          <span style={{ color: 'var(--text-muted)' }}>
            Показано: <span className="font-semibold" style={{ color: 'var(--text)' }}>{data.rows.length}</span> из <span className="font-semibold">{data.total}</span> SKU
          </span>
          {data.selected_revenue > 0 && (
            <span style={{ color: 'var(--text-muted)' }}>
              Выручка: <span className="font-semibold" style={{ color: 'var(--text)' }}>{fmt(data.selected_revenue)}</span>
            </span>
          )}
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
      )}

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
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs border-b" style={{ borderColor: 'var(--border)', color: 'var(--text-subtle)' }}>
                <th className="text-left px-4 py-3 font-medium w-24">Статус</th>
                <th className="text-left px-4 py-3 font-medium">SKU</th>
                <th className="text-left px-4 py-3 font-medium max-w-[180px]">Название</th>
                <th className="text-left px-4 py-3 font-medium">Менеджер</th>
                <th className="text-left px-4 py-3 font-medium">Категория</th>
                <th className="px-4 py-3 font-medium w-24">
                  <span className="flex items-center justify-center gap-0.5 cursor-pointer" onClick={() => toggleSort('score')} style={{ color: sortKey === 'score' ? 'var(--accent)' : 'var(--text-subtle)' }}>
                    Score <SortIcon active={sortKey === 'score'} dir={sortDir} />
                  </span>
                </th>
                <Th label="Выручка" sortKey="revenue" current={sortKey} dir={sortDir} onClick={toggleSort} />
                <Th label="Маржа%" sortKey="margin_pct" current={sortKey} dir={sortDir} onClick={toggleSort} />
                <Th label="ЧМД" sortKey="chmd" current={sortKey} dir={sortDir} onClick={toggleSort} />
                <Th label="ДРР" sortKey="drr" current={sortKey} dir={sortDir} onClick={toggleSort} />
                <Th label="CTR" sortKey="ctr" current={sortKey} dir={sortDir} onClick={toggleSort} />
                <Th label="CR к." sortKey="cr_basket" current={sortKey} dir={sortDir} onClick={toggleSort} />
                <Th label="CR з." sortKey="cr_order" current={sortKey} dir={sortDir} onClick={toggleSort} />
                <Th label="Остаток" sortKey="stock_qty" current={sortKey} dir={sortDir} onClick={toggleSort} />
                <Th label="Запас дн." sortKey="stock_days" current={sortKey} dir={sortDir} onClick={toggleSort} />
                <Th label="CPO" sortKey="cpo" current={sortKey} dir={sortDir} onClick={toggleSort} />
              </tr>
            </thead>
            <tbody>
              {loading && Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="border-t" style={{ borderColor: 'var(--border)' }}>
                  {Array.from({ length: 16 }).map((__, j) => (
                    <td key={j} className="px-4 py-3"><div className="skeleton h-4 w-full" /></td>
                  ))}
                </tr>
              ))}
              {!loading && (data?.rows ?? []).map((row, i) => {
                const isLowMargin = row.margin_pct < 0.10
                const isDrrOver = row.drr > row.margin_pct && row.drr > 0
                return (
                  <tr
                    key={i}
                    className="border-t transition-colors"
                    style={{ borderColor: 'var(--border)', cursor: 'pointer' }}
                    onClick={() => setSelectedSku(row.sku)}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-hover)' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '' }}
                  >
                    <td className="px-4 py-2.5">
                      <PriorityBadge oos={row.oos_status} margin={row.margin_status} />
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs" style={{ color: 'var(--text-muted)' }}>{row.sku}</td>
                    <td className="px-4 py-2.5 max-w-[180px]">
                      <span className="block truncate" style={{ color: 'var(--text)' }}>{row.name}</span>
                      {row.novelty && <span className="text-[10px] px-1.5 rounded" style={{ background: 'var(--info-bg)', color: 'var(--info)' }}>Новинка</span>}
                    </td>
                    <td className="px-4 py-2.5 text-xs" style={{ color: 'var(--text-muted)' }}>{row.manager}</td>
                    <td className="px-4 py-2.5 text-xs" style={{ color: 'var(--text-muted)' }}>{row.category}</td>
                    <td className="px-4 py-2.5"><ScoreBadge score={row.score} size="sm" /></td>
                    <td className="px-4 py-2.5 text-right font-semibold" style={{ color: 'var(--text)' }}>{fmt(row.revenue)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <span className="text-xs font-medium" style={{ color: isLowMargin ? 'var(--danger)' : 'var(--success)' }}>{fmtPct(row.margin_pct)}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right" style={{ color: 'var(--text-muted)' }}>{fmt(row.chmd)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <span className="text-xs font-medium" style={{ color: isDrrOver ? 'var(--danger)' : 'var(--text-muted)' }}>{fmtPct(row.drr)}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right text-xs" style={{ color: 'var(--text-muted)' }}>{fmtPct(row.ctr)}</td>
                    <td className="px-4 py-2.5 text-right text-xs" style={{ color: 'var(--text-muted)' }}>{fmtPct(row.cr_basket)}</td>
                    <td className="px-4 py-2.5 text-right text-xs" style={{ color: 'var(--text-muted)' }}>{fmtPct(row.cr_order)}</td>
                    <td className="px-4 py-2.5 text-right" style={{ color: 'var(--text-muted)' }}>{fmt(row.stock_qty)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <span style={{ color: row.stock_days < 14 ? 'var(--danger)' : row.stock_days < 30 ? 'var(--warning)' : 'var(--text-muted)' }}>{row.stock_days}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right text-xs" style={{ color: 'var(--text-muted)' }}>{fmt(row.cpo)}</td>
                  </tr>
                )
              })}
              {!loading && (data?.rows ?? []).length === 0 && (
                <tr>
                  <td colSpan={16} className="px-4 py-12 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
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
