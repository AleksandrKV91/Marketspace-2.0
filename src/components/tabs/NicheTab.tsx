'use client'

import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { GlassCard } from '@/components/ui/GlassCard'
import { KPIBar } from '@/components/ui/KPIBar'
import { SkuModal } from '@/components/ui/SkuModal'
import { exportToExcel } from '@/lib/exportExcel'
import { fmtFull, fmtAxis } from '@/lib/formatters'
import { ChevronUp, ChevronDown, ChevronRight, Download, X } from 'lucide-react'

// suppress unused import warning for fmtAxis (kept per spec)
void fmtAxis

// ── Types ─────────────────────────────────────────────────────────────────────

interface SkuInNiche {
  sku_ms: string
  sku_wb: number | null
  name: string
  final_class_1: string | null
  final_class_2: string | null
  abc_class: string | null
  revenue: number
  profitability: number | null
  revenue_margin: number | null
  gmroi: number | null
}

interface NicheRow {
  niche: string
  category: string
  attractiveness: number
  revenue: number
  seasonal: boolean
  season_months: number[]
  season_start: number
  season_peak: number
  final_class_1: string
  final_class_2: string
  abc_class: string
  gmroi: number | null
  sku_count: number
  buyout_pct: number | null
  profitability: number | null
  revenue_margin: number | null
  months: number[]
  skus: SkuInNiche[]
}

interface NicheData {
  periods: string[]
  current_period: string | null
  summary: {
    avg_attractiveness: number
    avg_buyout_pct: number | null
    seasonal_count: number
    non_seasonal_count: number
    total_niches: number
    weighted_profitability: number | null
    weighted_revenue_margin: number | null
  }
  rows: NicheRow[]
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MONTHS = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек']
const MONTHS_SHORT = ['Я','Ф','М','А','М','И','И','А','С','О','Н','Д']

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtPct(n: number | null | undefined, digits = 1) {
  if (n == null) return '—'
  const v = Math.abs(n) <= 1 ? n * 100 : n
  return v.toFixed(digits) + '%'
}

function fmtGmroi(n: number | null | undefined) {
  if (n == null) return '—'
  return (n * 100).toFixed(0) + '%'
}

function formatPeriod(iso: string): string {
  // "2026-02-01" → "Фев 2026"
  const parts = iso.split('-')
  if (parts.length < 2) return iso
  const month = parseInt(parts[1], 10)
  const year = parts[0]
  if (month < 1 || month > 12) return iso
  return `${MONTHS[month - 1]} ${year}`
}

function abcColor(cls: string | null) {
  if (!cls) return 'var(--text-subtle)'
  const lower = cls.toLowerCase()
  if (lower.startsWith('убыток')) return 'var(--danger)'
  const c = cls.charAt(0).toUpperCase()
  if (c === 'A') return 'var(--success)'
  if (c === 'B') return 'var(--warning)'
  if (c === 'C') return 'var(--danger)'
  return 'var(--text-subtle)'
}

// ── Sort Header ───────────────────────────────────────────────────────────────

type SortDir = 'asc' | 'desc'

function SortTh({ label, sk, align = 'right', sortKey, sortDir, onSort }: {
  label: string; sk: string; align?: 'left' | 'right' | 'center'
  sortKey: string; sortDir: SortDir; onSort: (k: string) => void
}) {
  const active = sortKey === sk
  return (
    <th
      className={`text-${align} px-3 py-2 font-medium cursor-pointer select-none whitespace-nowrap`}
      style={{ color: active ? 'var(--accent)' : 'var(--text-subtle)', fontSize: 11 }}
      onClick={() => onSort(sk)}
    >
      <span className={`inline-flex items-center gap-0.5 ${align === 'right' ? 'justify-end' : ''}`}>
        {label}
        {active
          ? (sortDir === 'asc' ? <ChevronUp size={10} /> : <ChevronDown size={10} />)
          : <ChevronUp size={10} style={{ opacity: 0.25 }} />}
      </span>
    </th>
  )
}

// ── SeasonSparkline ───────────────────────────────────────────────────────────

function SeasonSparkline({ values, seasonMonths, peakMonth }: {
  values: number[]
  seasonMonths: number[]
  peakMonth: number
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)

  if (!values || values.every(v => v === 0)) {
    return <span className="text-[11px]" style={{ color: 'var(--text-subtle)' }}>—</span>
  }
  const max = Math.max(...values, 0.01)

  return (
    <div className="flex items-end gap-[2px] h-6 relative">
      {values.map((v, i) => {
        const h = max > 0 ? Math.round((v / max) * 20) : 2
        const isSeason = seasonMonths.includes(i + 1)
        const isPeak = (i + 1) === peakMonth
        const bg = isPeak
          ? '#FF3B5C'
          : isSeason
            ? '#fda4af'
            : `rgba(156,163,175,${0.15 + (v / max) * 0.45})`
        return (
          <div
            key={i}
            className="relative"
            onMouseEnter={() => setHoverIdx(i)}
            onMouseLeave={() => setHoverIdx(null)}
          >
            <div
              className="w-1.5 rounded-sm transition-all"
              style={{
                height: hoverIdx === i ? `${Math.max(h + 4, 8)}px` : `${Math.max(h, 2)}px`,
                background: bg,
              }}
            />
            {hoverIdx === i && (
              <div
                className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-1.5 py-0.5 rounded text-[9px] whitespace-nowrap z-10"
                style={{
                  background: 'var(--surface-popup)',
                  border: '1px solid var(--border)',
                  color: 'var(--text)',
                }}
              >
                {MONTHS_SHORT[i]}: {v.toFixed(2)}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── SeasonHeatmap ─────────────────────────────────────────────────────────────

function SeasonHeatmap({ rows }: { rows: NicheRow[] }) {
  const seasonal = [...rows.filter(r => r.seasonal)].sort((a, b) => b.revenue - a.revenue)
  if (seasonal.length === 0) return null

  return (
    <GlassCard padding="none">
      <div className="px-4 pt-3 pb-3">
        <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-subtle)' }}>
          Сезонность ниш (тепловая карта)
        </p>
        <div style={{ overflowX: 'auto', maxHeight: 400, overflowY: 'auto' }}>
          <table className="text-[10px] w-full border-separate" style={{ borderSpacing: 2 }}>
            <thead>
              <tr>
                <th className="text-left pr-2 font-normal" style={{ color: 'var(--text-subtle)', minWidth: 100 }}>Ниша</th>
                {MONTHS_SHORT.map((m, i) => (
                  <th key={i} className="text-center font-medium w-6" style={{ color: 'var(--text-subtle)' }}>{m}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {seasonal.map((r) => {
                const max = Math.max(...r.months, 0.01)
                const avg = r.months.reduce((s, v) => s + v, 0) / r.months.length
                return (
                  <tr key={r.niche}>
                    <td className="pr-2 truncate max-w-[120px]" style={{ color: 'var(--text-muted)' }} title={r.niche}>
                      {r.niche.length > 16 ? r.niche.slice(0, 15) + '…' : r.niche}
                    </td>
                    {r.months.map((v, i) => {
                      const intensity = max > 0 ? v / max : 0
                      const isPeak = v === max
                      const isSeasonal = v > avg * 1.2
                      let bg: string
                      if (isPeak) {
                        bg = '#22c55e'
                      } else if (isSeasonal) {
                        bg = `rgba(34,197,94,${0.2 + intensity * 0.4})`
                      } else {
                        bg = `rgba(156,163,175,${0.05 + intensity * 0.25})`
                      }
                      return (
                        <td key={i} className="text-center" title={`${r.niche} / ${MONTHS[i]}: ${v.toFixed(2)}`}>
                          <div
                            className="rounded-sm mx-auto"
                            style={{ width: 20, height: 16, background: bg }}
                          />
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="flex items-center gap-3 mt-2">
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-sm" style={{ background: 'rgba(156,163,175,0.15)' }} />
            <span className="text-[10px]" style={{ color: 'var(--text-subtle)' }}>0</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-sm" style={{ background: 'rgba(34,197,94,0.5)' }} />
            <span className="text-[10px]" style={{ color: 'var(--text-subtle)' }}>Сезонный</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-sm" style={{ background: '#22c55e' }} />
            <span className="text-[10px]" style={{ color: 'var(--text-subtle)' }}>Пик</span>
          </div>
        </div>
      </div>
    </GlassCard>
  )
}

// ── ABC Chart components ──────────────────────────────────────────────────────

const SEGS_1 = ['AA','AB','BA','BB','CA','CB','CC'] as const
const SEGS_2 = ['AA','AB','AC','BA','BB','BC','CA','CB','CC','A|н/д','B|н/д','C|н/д','убыток|A','убыток|B','убыток|C','убыток|н/д'] as const

const ABC_COLORS_ALL: Record<string, string> = {
  'AA': '#15803d', 'AB': '#16a34a', 'AC': '#22c55e',
  'BA': '#92400e', 'BB': '#b45309', 'BC': '#d97706',
  'CA': '#991b1b', 'CB': '#b91c1c', 'CC': '#ef4444',
  'A|н/д': '#86efac', 'B|н/д': '#fde68a', 'C|н/д': '#fca5a5',
  'убыток|A': '#7f1d1d', 'убыток|B': '#7c2d12', 'убыток|C': '#4c0519',
  'убыток|н/д': '#44403c',
}

function normSeg1(cls: string | null): string {
  if (!cls) return ''
  const up = cls.toUpperCase().trim()
  return (SEGS_1 as readonly string[]).includes(up) ? up : ''
}

function normSeg2(cls: string | null): string {
  if (!cls) return ''
  const lo = cls.toLowerCase().trim()
  const up2 = lo.toUpperCase()
  if (/^[ABC]{2}$/.test(up2)) return up2
  if (/^убыток\|[aа]$/.test(lo)) return 'убыток|A'
  if (/^убыток\|[bб]$/.test(lo)) return 'убыток|B'
  if (/^убыток\|[cс]$/.test(lo)) return 'убыток|C'
  if (lo.startsWith('убыток')) return 'убыток|н/д'
  if (/^[aа]\|н\/д$/.test(lo)) return 'A|н/д'
  if (/^[bб]\|н\/д$/.test(lo)) return 'B|н/д'
  if (/^[cс]\|н\/д$/.test(lo)) return 'C|н/д'
  return ''
}

function OneBar({ rows, getKey, segments, mode }: {
  rows: NicheRow[]
  getKey: (sku: SkuInNiche) => string
  segments: readonly string[]
  mode: 'revenue' | 'sku'
}) {
  const counts: Record<string, { revenue: number; sku: number }> = {}
  for (const seg of segments) counts[seg] = { revenue: 0, sku: 0 }
  for (const row of rows) {
    for (const sku of row.skus) {
      const seg = getKey(sku)
      if (!seg || !(seg in counts)) continue
      counts[seg].revenue += sku.revenue
      counts[seg].sku += 1
    }
  }
  const key = mode === 'revenue' ? 'revenue' : 'sku'
  const total = segments.reduce((s, seg) => s + counts[seg][key], 0)
  return (
    <div className="relative h-7 w-full rounded-lg overflow-hidden flex" style={{ background: 'var(--border)' }}>
      {segments.map(seg => {
        const val = counts[seg][key]
        const pct = total > 0 ? (val / total) * 100 : 0
        if (pct < 0.5) return null
        return (
          <div
            key={seg}
            style={{ width: `${pct}%`, background: ABC_COLORS_ALL[seg] ?? '#6b7280' }}
            title={`${seg}: ${mode === 'revenue' ? fmtFull(val) : val + ' SKU'} (${pct.toFixed(1)}%)`}
          />
        )
      })}
    </div>
  )
}

function AbcCardHeader({ title, mode, setMode }: {
  title: string
  mode: 'revenue' | 'sku'
  setMode: (m: 'revenue' | 'sku') => void
}) {
  return (
    <div className="flex items-center justify-between mb-3">
      <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-subtle)' }}>
        {title}
      </p>
      <div className="flex gap-1">
        {(['revenue', 'sku'] as const).map(m => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className="text-[10px] px-2 py-0.5 rounded-lg font-medium"
            style={{
              background: mode === m ? 'var(--accent)' : 'var(--border)',
              color: mode === m ? 'white' : 'var(--text-muted)',
            }}
          >
            {m === 'revenue' ? 'Выручка' : 'SKU'}
          </button>
        ))}
      </div>
    </div>
  )
}

function AbcLegend({ segments }: { segments: readonly string[] }) {
  return (
    <div className="flex flex-wrap gap-x-2 gap-y-1 mt-3">
      {segments.map(seg => (
        <div key={seg} className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-sm" style={{ background: ABC_COLORS_ALL[seg] }} />
          <span className="text-[9px]" style={{ color: 'var(--text-muted)' }}>{seg}</span>
        </div>
      ))}
    </div>
  )
}

function AbcBarChmd({ rows }: { rows: NicheRow[] }) {
  const [mode, setMode] = useState<'revenue' | 'sku'>('revenue')
  return (
    <GlassCard padding="none">
      <div className="px-4 pt-3 pb-3">
        <AbcCardHeader title="ABC: ЧМД / Выручка" mode={mode} setMode={setMode} />
        <OneBar rows={rows} getKey={s => normSeg1(s.final_class_1)} segments={SEGS_1} mode={mode} />
        <AbcLegend segments={SEGS_1} />
      </div>
    </GlassCard>
  )
}

function AbcBarRent({ rows }: { rows: NicheRow[] }) {
  const [mode, setMode] = useState<'revenue' | 'sku'>('revenue')
  return (
    <GlassCard padding="none">
      <div className="px-4 pt-3 pb-3">
        <AbcCardHeader title="ABC: Рент. / Оборот" mode={mode} setMode={setMode} />
        <OneBar rows={rows} getKey={s => normSeg2(s.final_class_2)} segments={SEGS_2} mode={mode} />
        <AbcLegend segments={SEGS_2} />
      </div>
    </GlassCard>
  )
}

// ── NicheSelect — custom dropdown ────────────────────────────────────────────

function NicheSelect<T extends string | number>({
  value, onChange, options,
}: {
  value: T
  onChange: (v: T) => void
  options: Array<{ value: T; label: string }>
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const label = options.find(o => o.value === value)?.label ?? String(value)
  const isActive = options.length > 0 && options[0].value !== value

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[11px] font-medium whitespace-nowrap transition-all"
        style={{
          background: isActive ? 'var(--accent-glass)' : 'var(--surface)',
          border: '1px solid ' + (isActive ? 'var(--accent)' : 'var(--border)'),
          color: isActive ? 'var(--accent)' : 'var(--text-muted)',
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        {label}
        <span style={{ fontSize: 9, opacity: 0.7 }}>▼</span>
      </button>
      {open && (
        <div
          className="absolute left-0 top-[calc(100%+4px)] z-[300] py-1 min-w-max max-h-48 overflow-y-auto"
          style={{
            background: 'var(--surface-popup, var(--surface-solid))',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-xl)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
          }}
        >
          {options.map(o => (
            <button
              key={String(o.value)}
              onClick={() => { onChange(o.value); setOpen(false) }}
              className="w-full text-left px-3 py-1.5 text-[11px] whitespace-nowrap"
              style={{ color: value === o.value ? 'var(--accent)' : 'var(--text)' }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--accent-glass)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Module-level cache ────────────────────────────────────────────────────────
const nicheCache = new Map<string, NicheData>()

// ── Main Component ─────────────────────────────────────────────────────────────

export default function NicheTab() {
  const [data, setData] = useState<NicheData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Period selector
  const [period, setPeriod] = useState<string>('')

  // Filters
  const [search, setSearch] = useState('')
  const [filterSeasonal, setFilterSeasonal] = useState<'all' | 'seasonal' | 'no'>('all')
  const [filterAbcCombo, setFilterAbcCombo] = useState('all')
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterSeasonStart, setFilterSeasonStart] = useState(0)
  const [filterSeasonPeak, setFilterSeasonPeak] = useState(0)

  // Sort
  const [sortKey, setSortKey] = useState('revenue')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  // Expand state
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set())
  const [expandedNiches, setExpandedNiches] = useState<Set<string>>(new Set())

  // SKU modal
  const [selectedSku, setSelectedSku] = useState<string | null>(null)

  // View mode
  const [viewMode, setViewMode] = useState<'hierarchy' | 'list'>('hierarchy')
  const [pageSize, setPageSize] = useState<50 | 100 | 'all'>(50)

  // Fetch on period change (with module-level cache)
  useEffect(() => {
    const url = period ? `/api/dashboard/niches?period=${period}` : '/api/dashboard/niches'
    const cached = nicheCache.get(url)
    if (cached) { setData(cached); setLoading(false); return }
    setLoading(true)
    fetch(url)
      .then(r => r.json())
      .then((d: NicheData) => { nicheCache.set(url, d); setData(d); setLoading(false) })
      .catch((e: unknown) => { setError(String(e)); setLoading(false) })
  }, [period])

  const toggleSort = useCallback((key: string) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }, [sortKey])

  const toggleCategory = useCallback((cat: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
  }, [])

  const toggleNiche = useCallback((niche: string) => {
    setExpandedNiches(prev => {
      const next = new Set(prev)
      if (next.has(niche)) next.delete(niche)
      else next.add(niche)
      return next
    })
  }, [])

  // Filtered + sorted niches
  const filteredRows = useMemo(() => {
    if (!data?.rows) return []
    return data.rows.filter(r => {
      if (search) {
        const q = search.toLowerCase()
        if (!r.niche.toLowerCase().includes(q) && !r.category.toLowerCase().includes(q)) return false
      }
      if (filterSeasonal === 'seasonal' && !r.seasonal) return false
      if (filterSeasonal === 'no' && r.seasonal) return false
      if (filterAbcCombo !== 'all') {
        if (!r.final_class_1.toUpperCase().startsWith(filterAbcCombo)) return false
      }
      if (filterStatus !== 'all') {
        if (filterStatus === 'убыток' && !r.final_class_1.toLowerCase().startsWith('убыток')) return false
        if (filterStatus === 'н/д' && !r.final_class_1.toLowerCase().includes('н/д')) return false
      }
      if (filterSeasonStart > 0 && r.season_start !== filterSeasonStart) return false
      if (filterSeasonPeak > 0 && r.season_peak !== filterSeasonPeak) return false
      return true
    }).sort((a, b) => {
      const mult = sortDir === 'asc' ? 1 : -1
      const av = (a as unknown as Record<string, unknown>)[sortKey] as number | string | null
      const bv = (b as unknown as Record<string, unknown>)[sortKey] as number | string | null
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * mult
      return String(av ?? '').localeCompare(String(bv ?? '')) * mult
    })
  }, [data?.rows, search, filterSeasonal, filterAbcCombo, filterStatus, filterSeasonStart, filterSeasonPeak, sortKey, sortDir])

  // Group by category
  const categoryGroups = useMemo(() => {
    const map: Record<string, NicheRow[]> = {}
    for (const r of filteredRows) {
      if (!map[r.category]) map[r.category] = []
      map[r.category].push(r)
    }
    return Object.entries(map).sort((a, b) => {
      const ra = a[1].reduce((s, r) => s + r.revenue, 0)
      const rb = b[1].reduce((s, r) => s + r.revenue, 0)
      return rb - ra
    })
  }, [filteredRows])

  // List mode: flat SKU list
  const allSkusList = useMemo(() =>
    filteredRows.flatMap(r => r.skus.map(s => ({ ...s, niche: r.niche, category: r.category }))),
    [filteredRows]
  )
  const visibleSkus = pageSize === 'all' ? allSkusList : allSkusList.slice(0, pageSize)

  const filteredRevenue = filteredRows.reduce((s, r) => s + r.revenue, 0)
  const hasFilters = !!(search || filterSeasonal !== 'all' || filterAbcCombo !== 'all' || filterStatus !== 'all' || filterSeasonStart > 0 || filterSeasonPeak > 0)

  function resetFilters() {
    setSearch('')
    setFilterSeasonal('all')
    setFilterAbcCombo('all')
    setFilterStatus('all')
    setFilterSeasonStart(0)
    setFilterSeasonPeak(0)
  }

  function exportData() {
    exportToExcel(filteredRows.map(r => ({
      'Ниша': r.niche,
      'Категория': r.category,
      'Привлекательность': r.attractiveness,
      'Выручка': r.revenue,
      'Сезонный': r.seasonal ? 'Да' : 'Нет',
      'Старт': r.season_start ? MONTHS[r.season_start - 1] : '—',
      'Пик': r.season_peak ? MONTHS[r.season_peak - 1] : '—',
      'Класс 1': r.final_class_1,
      'Класс 2': r.final_class_2,
      'ABC': r.abc_class,
      'GMROI': r.gmroi?.toFixed(2) ?? '',
      'SKU': r.sku_count,
      '% выкупа': r.buyout_pct?.toFixed(1) ?? '',
      'Рент. ЧМД%': r.profitability != null ? fmtPct(r.profitability) : '',
      'Рент. выручки': r.revenue_margin != null ? fmtPct(r.revenue_margin) : '',
    })), 'Ниши')
  }

  if (error) return (
    <div className="px-6 py-16 text-center" style={{ color: 'var(--danger)' }}>{error}</div>
  )

  return (
    <div className="py-6 space-y-4" style={{ position: 'relative' }}>

      {/* ── KPI ── */}
      <div className="px-6" style={{ position: 'sticky', top: 88, zIndex: 31, background: 'var(--bg, var(--surface-solid))' }}>
        <KPIBar loading={loading} items={[
          {
            label: 'Ср. привлекательность',
            value: data?.summary.avg_attractiveness?.toFixed(1) ?? '—',
          },
          {
            label: '% выкупа (ср.)',
            value: data?.summary.avg_buyout_pct != null ? fmtPct(data.summary.avg_buyout_pct) : '—',
          },
          {
            label: 'Сезонных / несезон.',
            value: data ? `${data.summary.seasonal_count} / ${data.summary.non_seasonal_count}` : '—',
            hint: data ? `всего ${data.summary.total_niches} ниш` : undefined,
          },
          {
            label: 'Ср. рент. ЧМД,%',
            value: data?.summary.weighted_profitability != null
              ? fmtPct(data.summary.weighted_profitability)
              : '—',
          },
          {
            label: 'Рент. выручки,%',
            value: data?.summary.weighted_revenue_margin != null
              ? fmtPct(data.summary.weighted_revenue_margin)
              : '—',
          },
        ]} />
      </div>

      {/* ── Charts: Heatmap + 2 ABC bars ── */}
      {!loading && (
        <div className="px-6 grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
          <SeasonHeatmap rows={filteredRows} />
          <AbcBarChmd rows={filteredRows} />
          <AbcBarRent rows={filteredRows} />
        </div>
      )}

      {/* ── Summary bar (sticky) ── */}
      <div
        className="px-6"
        style={{ position: 'sticky', top: 132, zIndex: 30 }}
      >
        <div
          className="glass px-4 py-2.5 flex items-center gap-3 flex-wrap text-sm"
          style={{ background: 'var(--surface-solid)', backdropFilter: 'blur(12px)' }}
        >
          {/* View mode toggle */}
          <div className="flex gap-1">
            {(['hierarchy', 'list'] as const).map(m => (
              <button
                key={m}
                onClick={() => setViewMode(m)}
                className="text-xs px-2.5 py-1.5 rounded-xl font-medium"
                style={{
                  background: viewMode === m ? 'var(--accent)' : 'var(--border)',
                  color: viewMode === m ? 'white' : 'var(--text-muted)',
                }}
              >
                {m === 'hierarchy' ? 'Иерархия' : 'Список'}
              </button>
            ))}
          </div>

          <span style={{ color: 'var(--border-subtle)' }}>•</span>
          <span style={{ color: 'var(--text-muted)' }}>
            Выбрано: <span className="font-semibold" style={{ color: 'var(--text)' }}>{filteredRows.length}</span>
            <span className="text-xs ml-1" style={{ color: 'var(--text-subtle)' }}>ниш</span>
          </span>
          <span style={{ color: 'var(--border-subtle)' }}>•</span>
          <span style={{ color: 'var(--text-muted)' }}>
            Выручка: <span className="font-semibold" style={{ color: 'var(--text)' }}>{fmtFull(filteredRevenue)} ₽</span>
          </span>
          <div className="ml-auto flex items-center gap-2">
            {hasFilters && (
              <button
                onClick={resetFilters}
                className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg"
                style={{ color: 'var(--accent)', background: 'var(--accent-glow)' }}
              >
                <X size={11} /> Сбросить
              </button>
            )}
            <button
              onClick={exportData}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl font-medium"
              style={{ background: 'var(--border)', color: 'var(--text-muted)' }}
            >
              <Download size={13} /> Скачать
            </button>
          </div>
        </div>
      </div>

      {/* ── Filter bar (sticky) ── */}
      <div
        className="px-6"
        style={{ position: 'sticky', top: 180, zIndex: 29 }}
      >
        <div
          className="py-2 flex flex-wrap gap-2 items-center"
          style={{ background: 'var(--surface-solid)', backdropFilter: 'blur(12px)' }}
        >
          {/* Period selector */}
          <NicheSelect
            value={period}
            onChange={setPeriod}
            options={[
              { value: '' as string, label: 'Период: последний' },
              ...(data?.periods ?? []).map(p => ({ value: p, label: formatPeriod(p) })),
            ]}
          />

          {/* Search */}
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Поиск по нише, категории..."
            className="pl-3 pr-3 py-1.5 text-xs rounded-xl border outline-none min-w-[200px]"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)' }}
          />

          {/* Seasonal toggle */}
          {(['all', 'seasonal', 'no'] as const).map(v => (
            <button
              key={v}
              onClick={() => setFilterSeasonal(v)}
              className="text-xs px-2.5 py-1.5 rounded-xl font-medium"
              style={{
                background: filterSeasonal === v ? 'var(--accent)' : 'var(--border)',
                color: filterSeasonal === v ? 'white' : 'var(--text-muted)',
              }}
            >
              {v === 'all' ? 'Все' : v === 'seasonal' ? 'Сезонные' : 'Несезонные'}
            </button>
          ))}

          {/* ABC Combo filter */}
          <NicheSelect
            value={filterAbcCombo}
            onChange={setFilterAbcCombo}
            options={[
              { value: 'all', label: 'Класс 1: все' },
              ...['AA','AB','AC','BA','BB','BC','CA','CB','CC'].map(c => ({ value: c, label: c })),
            ]}
          />

          {/* Status filter */}
          <NicheSelect
            value={filterStatus}
            onChange={setFilterStatus}
            options={[
              { value: 'all', label: 'Статус: все' },
              { value: 'убыток', label: 'убыток' },
              { value: 'н/д', label: 'н/д' },
            ]}
          />

          {/* Season start */}
          <NicheSelect
            value={filterSeasonStart}
            onChange={setFilterSeasonStart}
            options={[
              { value: 0, label: 'Старт: любой' },
              ...MONTHS.map((m, i) => ({ value: i + 1, label: m })),
            ]}
          />

          {/* Season peak */}
          <NicheSelect
            value={filterSeasonPeak}
            onChange={setFilterSeasonPeak}
            options={[
              { value: 0, label: 'Пик: любой' },
              ...MONTHS.map((m, i) => ({ value: i + 1, label: m })),
            ]}
          />
        </div>
      </div>

      {/* ── Table ── */}
      <div className="px-6">
        <GlassCard padding="none">
          <div style={{ overflowX: 'clip' }}>

            {/* ── Hierarchy Mode ── */}
            {viewMode === 'hierarchy' && (
              <table className="w-full text-xs">
                <thead>
                  <tr
                    className="border-b"
                    style={{
                      borderColor: 'var(--border)',
                      position: 'sticky',
                      top: 228,
                      zIndex: 28,
                      background: 'var(--surface-solid)',
                      backdropFilter: 'blur(12px)',
                    }}
                  >
                    <th className="text-left px-3 py-2 font-medium whitespace-nowrap" style={{ color: 'var(--text-subtle)', fontSize: 11, minWidth: 180 }}>
                      Ниша / Категория / SKU
                    </th>
                    <SortTh label="Привл." sk="attractiveness" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortTh label="Выручка" sk="revenue" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <th className="text-center px-3 py-2 font-medium whitespace-nowrap" style={{ color: 'var(--text-subtle)', fontSize: 11 }}>Сезонность</th>
                    <SortTh label="Старт" sk="season_start" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortTh label="Пик" sk="season_peak" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <th className="text-center px-3 py-2 font-medium whitespace-nowrap" style={{ color: 'var(--text-subtle)', fontSize: 11 }}>ABC</th>
                    <th className="text-center px-3 py-2 font-medium whitespace-nowrap" style={{ color: 'var(--text-subtle)', fontSize: 11 }}>Класс 1 (ЧМД/Выр.)</th>
                    <th className="text-center px-3 py-2 font-medium whitespace-nowrap" style={{ color: 'var(--text-subtle)', fontSize: 11 }}>Класс 2 (Рент./Об.)</th>
                    <SortTh label="GMROI" sk="gmroi" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortTh label="SKU" sk="sku_count" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortTh label="Выкуп%" sk="buyout_pct" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  </tr>
                </thead>
                <tbody>
                  {loading && Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="border-t" style={{ borderColor: 'var(--border)' }}>
                      {Array.from({ length: 12 }).map((__, j) => (
                        <td key={j} className="px-3 py-2"><div className="skeleton h-3 w-full" /></td>
                      ))}
                    </tr>
                  ))}

                  {!loading && filteredRows.map(row => {
                    const nicheExpanded = expandedNiches.has(row.niche)
                    return [
                      // Niche row (top level — no category grouping)
                      <tr
                        key={`niche-${row.niche}`}
                        className="border-t cursor-pointer transition-colors"
                        style={{ borderColor: 'var(--border)' }}
                        onClick={() => toggleNiche(row.niche)}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-hover)' }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '' }}
                      >
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            {row.skus.length > 0 && (
                              <span style={{ color: 'var(--text-subtle)', display: 'inline-block', transform: nicheExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform .2s' }}>
                                <ChevronRight size={12} />
                              </span>
                            )}
                            <span className="font-medium text-[11px]" style={{ color: 'var(--text)' }}>{row.niche}</span>
                            <span className="text-[10px]" style={{ color: 'var(--text-subtle)' }}>{row.category}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right" style={{ color: 'var(--text-muted)' }}>{row.attractiveness.toFixed(1)}</td>
                        <td className="px-3 py-2 text-right font-semibold" style={{ color: 'var(--text)' }}>{fmtFull(row.revenue)}</td>
                        <td className="px-3 py-2 text-center">
                          <SeasonSparkline values={row.months} seasonMonths={row.season_months} peakMonth={row.season_peak} />
                        </td>
                        <td className="px-3 py-2 text-right text-[11px]" style={{ color: 'var(--text-muted)' }}>
                          {row.season_start ? MONTHS[row.season_start - 1] : '—'}
                        </td>
                        <td className="px-3 py-2 text-right text-[11px] font-semibold" style={{ color: '#FF3B5C' }}>
                          {row.season_peak ? MONTHS[row.season_peak - 1] : '—'}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span className="font-bold text-[11px]" style={{ color: abcColor(row.abc_class) }}>{row.abc_class}</span>
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span className="font-bold text-[11px]" style={{ color: abcColor(row.final_class_1) }}>{row.final_class_1 || '—'}</span>
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{row.final_class_2 || '—'}</span>
                        </td>
                        <td className="px-3 py-2 text-right" style={{ color: 'var(--text-muted)' }}>{fmtGmroi(row.gmroi)}</td>
                        <td className="px-3 py-2 text-right" style={{ color: 'var(--text-subtle)' }}>{row.sku_count}</td>
                        <td className="px-3 py-2 text-right" style={{ color: 'var(--text-subtle)' }}>{row.buyout_pct != null ? fmtPct(row.buyout_pct) : '—'}</td>
                      </tr>,

                      // SKU rows (if niche expanded)
                      ...(nicheExpanded ? row.skus.map(sku => (
                        <tr
                          key={`sku-${sku.sku_ms}`}
                          className="border-t cursor-pointer transition-colors"
                          style={{ borderColor: 'var(--border)', background: 'var(--surface-deep, rgba(0,0,0,0.08))' }}
                          onClick={() => setSelectedSku(sku.sku_ms)}
                          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '0.8' }}
                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '1' }}
                        >
                          <td className="px-3 py-1.5">
                            <div className="pl-8 flex items-center gap-2">
                              <span className="font-mono text-[10px]" style={{ color: 'var(--text-subtle)' }}>{sku.sku_ms}</span>
                              <span className="text-[11px] truncate max-w-[200px]" style={{ color: 'var(--text-muted)' }} title={sku.name}>{sku.name}</span>
                            </div>
                          </td>
                          <td colSpan={1} />
                          <td className="px-3 py-1.5 text-right text-[11px]" style={{ color: 'var(--text-muted)' }}>{fmtFull(sku.revenue)}</td>
                          <td colSpan={3} />
                          <td className="px-3 py-1.5 text-center">
                            <span className="font-bold text-[10px]" style={{ color: abcColor(sku.abc_class) }}>{sku.abc_class || '—'}</span>
                          </td>
                          <td className="px-3 py-1.5 text-center">
                            <span className="font-bold text-[10px]" style={{ color: abcColor(sku.final_class_1) }}>{sku.final_class_1 || '—'}</span>
                          </td>
                          <td className="px-3 py-1.5 text-center">
                            <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{sku.final_class_2 || '—'}</span>
                          </td>
                          <td className="px-3 py-1.5 text-right text-[11px]" style={{ color: 'var(--text-muted)' }}>{fmtGmroi(sku.gmroi)}</td>
                          <td colSpan={2} />
                        </tr>
                      )) : []),
                    ]
                  })}

                  {!loading && filteredRows.length === 0 && (
                    <tr>
                      <td colSpan={12} className="px-4 py-12 text-center" style={{ color: 'var(--text-muted)' }}>
                        Нет данных по заданным фильтрам
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}

            {/* ── List Mode ── */}
            {viewMode === 'list' && (
              <>
                <table className="w-full text-xs">
                  <thead>
                    <tr
                      className="border-b"
                      style={{
                        borderColor: 'var(--border)',
                        position: 'sticky',
                        top: 228,
                        zIndex: 28,
                        background: 'var(--surface-solid)',
                        backdropFilter: 'blur(12px)',
                      }}
                    >
                      <th className="text-left px-3 py-2 font-medium whitespace-nowrap" style={{ color: 'var(--text-subtle)', fontSize: 11 }}>Артикул</th>
                      <th className="text-left px-3 py-2 font-medium whitespace-nowrap" style={{ color: 'var(--text-subtle)', fontSize: 11 }}>Название</th>
                      <th className="text-left px-3 py-2 font-medium whitespace-nowrap" style={{ color: 'var(--text-subtle)', fontSize: 11 }}>Ниша</th>
                      <th className="text-left px-3 py-2 font-medium whitespace-nowrap" style={{ color: 'var(--text-subtle)', fontSize: 11 }}>Категория</th>
                      <th className="text-center px-3 py-2 font-medium whitespace-nowrap" style={{ color: 'var(--text-subtle)', fontSize: 11 }}>Класс 1</th>
                      <th className="text-center px-3 py-2 font-medium whitespace-nowrap" style={{ color: 'var(--text-subtle)', fontSize: 11 }}>Класс 2</th>
                      <th className="text-right px-3 py-2 font-medium whitespace-nowrap" style={{ color: 'var(--text-subtle)', fontSize: 11 }}>Выручка</th>
                      <th className="text-right px-3 py-2 font-medium whitespace-nowrap" style={{ color: 'var(--text-subtle)', fontSize: 11 }}>Рент. ЧМД%</th>
                      <th className="text-right px-3 py-2 font-medium whitespace-nowrap" style={{ color: 'var(--text-subtle)', fontSize: 11 }}>GMROI</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading && Array.from({ length: 8 }).map((_, i) => (
                      <tr key={i} className="border-t" style={{ borderColor: 'var(--border)' }}>
                        {Array.from({ length: 9 }).map((__, j) => (
                          <td key={j} className="px-3 py-2"><div className="skeleton h-3 w-full" /></td>
                        ))}
                      </tr>
                    ))}

                    {!loading && visibleSkus.map(sku => (
                      <tr
                        key={`list-${sku.sku_ms}`}
                        className="border-t cursor-pointer transition-colors"
                        style={{ borderColor: 'var(--border)' }}
                        onClick={() => setSelectedSku(sku.sku_ms)}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-hover)' }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '' }}
                      >
                        <td className="px-3 py-1.5">
                          <span className="font-mono text-[10px]" style={{ color: 'var(--text-subtle)' }}>{sku.sku_ms}</span>
                        </td>
                        <td className="px-3 py-1.5 max-w-[200px] truncate" style={{ color: 'var(--text-muted)' }} title={sku.name}>{sku.name}</td>
                        <td className="px-3 py-1.5 text-[11px]" style={{ color: 'var(--text-muted)' }}>{sku.niche}</td>
                        <td className="px-3 py-1.5 text-[11px]" style={{ color: 'var(--text-subtle)' }}>{sku.category}</td>
                        <td className="px-3 py-1.5 text-center">
                          <span className="font-bold text-[10px]" style={{ color: abcColor(sku.final_class_1) }}>{sku.final_class_1 || '—'}</span>
                        </td>
                        <td className="px-3 py-1.5 text-center">
                          <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{sku.final_class_2 || '—'}</span>
                        </td>
                        <td className="px-3 py-1.5 text-right font-semibold text-[11px]" style={{ color: 'var(--text)' }}>{fmtFull(sku.revenue)}</td>
                        <td className="px-3 py-1.5 text-right text-[11px]" style={{ color: 'var(--text-muted)' }}>{fmtPct(sku.profitability)}</td>
                        <td className="px-3 py-1.5 text-right text-[11px]" style={{ color: 'var(--text-muted)' }}>{fmtGmroi(sku.gmroi)}</td>
                      </tr>
                    ))}

                    {!loading && allSkusList.length === 0 && (
                      <tr>
                        <td colSpan={9} className="px-4 py-12 text-center" style={{ color: 'var(--text-muted)' }}>
                          Нет данных по заданным фильтрам
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>

                {/* Pagination */}
                {!loading && allSkusList.length > 0 && (
                  <div className="px-4 py-3 flex items-center gap-3 border-t" style={{ borderColor: 'var(--border)' }}>
                    <span className="text-xs" style={{ color: 'var(--text-subtle)' }}>
                      Показано {visibleSkus.length} из {allSkusList.length}
                    </span>
                    <div className="flex gap-1 ml-2">
                      {([50, 100, 'all'] as const).map(size => (
                        <button
                          key={String(size)}
                          onClick={() => setPageSize(size)}
                          className="text-[10px] px-2 py-0.5 rounded-lg font-medium"
                          style={{
                            background: pageSize === size ? 'var(--accent)' : 'var(--border)',
                            color: pageSize === size ? 'white' : 'var(--text-muted)',
                          }}
                        >
                          {size === 'all' ? 'Все' : size}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </GlassCard>
      </div>

      <SkuModal skuMs={selectedSku} onClose={() => setSelectedSku(null)} />
    </div>
  )
}
