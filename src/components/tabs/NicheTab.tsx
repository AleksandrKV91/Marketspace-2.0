'use client'

import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Cell, ScatterChart, Scatter, ZAxis, ReferenceLine,
} from 'recharts'
import { GlassCard } from '@/components/ui/GlassCard'
import { KPIBar } from '@/components/ui/KPIBar'
import { SkuModal } from '@/components/ui/SkuModal'
import { exportToExcel } from '@/lib/exportExcel'
import { fmtAxis } from '@/lib/formatters'
import {
  ChevronUp, ChevronDown, ChevronRight, Download, X,
  Search, Filter,
} from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

interface SkuEntry {
  sku_ms: string
  name: string
  revenue: number
  abc_class: string
  abc_class2: string | null
  gmroy: number | null
  attractiveness: number
  season_months: number[]
  season_start: number
  season_peak: number
  seasonal: boolean
  availability: number
}

interface NicheRow {
  niche: string
  category: string
  rating: number
  attractiveness: number
  revenue: number
  chmd: number
  chmd_clean: number
  avg_profitability: number | null
  avg_revenue_margin: number | null
  ad_spend: number
  storage: number
  transport: number
  seasonal: boolean
  season_months_coeffs: number[]
  season_months: number[]
  season_start: number
  season_peak: number
  availability: number
  abc_class: string
  abc_distribution: Record<string, number>
  gmroy: number | null
  sku_count: number
  skus: SkuEntry[]
}

interface CategoryRow {
  category: string
  revenue: number
  chmd: number
  sku_count: number
  abc_class: string
  attractiveness: number
  gmroy: number | null
  niches: NicheRow[]
}

interface NicheData {
  summary: {
    avg_attractiveness: number
    seasonal_count: number
    non_seasonal_count: number
    abc_distribution: Record<string, number>
    avg_chmd_margin: number | null
    avg_revenue_margin: number | null
    total_niches: number
    total_skus: number
  }
  hierarchy: CategoryRow[]
  scatter: Array<{ niche: string; attractiveness: number; revenue: number; market_share: number; abc_class: string }>
  heatmap: Array<{ niche: string; months: number[] }>
  abc_chart: Array<{ group: string; count: number; revenue: number; sku_count: number }>
  rating_chart: Array<{ name: string; rating: number; attractiveness: number; abc: string }>
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MONTHS = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек']
const MONTHS_SHORT = ['Я', 'Ф', 'М', 'А', 'М', 'И', 'И', 'А', 'С', 'О', 'Н', 'Д']

const ABC_COLORS: Record<string, string> = {
  A: '#22c55e',
  B: '#f59e0b',
  C: '#ef4444',
  '—': 'var(--text-subtle)',
  'Н/Д': 'var(--text-subtle)',
}

// ── Formatters ────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined) {
  if (n == null) return '—'
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'М'
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(0) + 'К'
  return String(Math.round(n))
}

function fmtPct(n: number | null | undefined, mult = 1) {
  if (n == null) return '—'
  return (n * mult).toFixed(1) + '%'
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SortTh({
  label, sk, align = 'right', sortKey, sortDir, onSort,
}: {
  label: string; sk: string; align?: 'left' | 'right' | 'center'
  sortKey: string; sortDir: 'asc' | 'desc'; onSort: (k: string) => void
}) {
  const active = sortKey === sk
  return (
    <th
      className={`text-${align} px-2 py-2.5 font-medium cursor-pointer select-none whitespace-nowrap`}
      style={{ color: active ? 'var(--accent)' : 'var(--text-subtle)', fontSize: 11 }}
      onClick={() => onSort(sk)}
    >
      <span className={`inline-flex items-center gap-0.5 ${align !== 'left' ? 'justify-end' : ''}`}>
        {label}
        {active
          ? (sortDir === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />)
          : <ChevronUp size={11} style={{ opacity: 0.25 }} />}
      </span>
    </th>
  )
}

// Inline sparkline (seasonal months coefficients)
function MiniSparkline({ values, peakColor = '#FF3B5C' }: { values: number[]; peakColor?: string }) {
  if (!values || values.length !== 12) return <span style={{ color: 'var(--text-subtle)', fontSize: 11 }}>—</span>
  const sorted = [...values].sort((a, b) => b - a)
  const threshold = sorted[2] ?? 0
  const max = sorted[0] ?? 1
  return (
    <div className="flex items-end gap-0.5 h-6" title={values.map((v, i) => `${MONTHS_SHORT[i]}: ${v.toFixed(2)}`).join(', ')}>
      {values.map((v, i) => {
        const isPeak = v >= threshold && v > 0
        const height = max > 0 ? Math.round((v / max) * 20) : 4
        return (
          <div
            key={i}
            className="w-1.5 rounded-sm"
            style={{
              height: `${Math.max(height, 2)}px`,
              background: isPeak ? peakColor : 'var(--border)',
              opacity: isPeak ? 1 : 0.55,
            }}
            title={`${MONTHS[i]}: ${v.toFixed(2)}`}
          />
        )
      })}
    </div>
  )
}

// ABC badge
function AbcBadge({ cls }: { cls: string }) {
  const base = cls?.charAt(0)?.toUpperCase()
  const isLoss = cls?.toLowerCase().startsWith('убыток')
  if (isLoss) {
    return (
      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md" style={{ background: 'rgba(239,68,68,0.12)', color: '#ef4444' }}>
        {cls}
      </span>
    )
  }
  const color = ABC_COLORS[base] ?? 'var(--text-subtle)'
  return (
    <span className="font-bold text-xs" style={{ color }}>
      {cls || '—'}
    </span>
  )
}

// Seasonality heatmap
function SeasonHeatmap({ data }: { data: Array<{ niche: string; months: number[] }> }) {
  if (!data.length) return null

  // Global max for color scaling
  const allVals = data.flatMap(d => d.months)
  const globalMax = Math.max(...allVals, 1)

  function cellColor(v: number): string {
    const intensity = Math.min(1, v / globalMax)
    if (intensity < 0.1) return 'var(--border)'
    // Gradient: light blue → deep pink
    const r = Math.round(30 + intensity * (255 - 30))
    const g = Math.round(100 - intensity * 80)
    const b = Math.round(200 - intensity * 140)
    return `rgb(${r},${g},${b})`
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="text-[10px] border-separate" style={{ borderSpacing: 2 }}>
        <thead>
          <tr>
            <th className="text-right pr-2 pb-1 font-normal" style={{ color: 'var(--text-subtle)', minWidth: 120 }}>Ниша</th>
            {MONTHS.map(m => (
              <th key={m} className="text-center pb-1 font-normal" style={{ color: 'var(--text-subtle)', width: 28 }}>{m}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr key={i}>
              <td className="text-right pr-2 py-0.5 truncate" style={{ color: 'var(--text-muted)', maxWidth: 130 }} title={row.niche}>
                {row.niche}
              </td>
              {row.months.map((v, j) => (
                <td key={j} title={`${MONTHS[j]}: ${v.toFixed(2)}`}>
                  <div
                    className="rounded-sm mx-auto"
                    style={{
                      width: 22, height: 18,
                      background: cellColor(v),
                      opacity: v > 0 ? 1 : 0.25,
                    }}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ABC stacked bar custom legend
function AbcStructureChart({ data }: { data: Array<{ group: string; count: number; revenue: number; sku_count: number }> }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 20, bottom: 0, left: 20 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.4} horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickLine={false} tickFormatter={v => fmt(v)} />
        <YAxis type="category" dataKey="group" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} width={32} tickLine={false} axisLine={false} />
        <Tooltip
          formatter={(v, name) => [
            name === 'revenue' ? fmt(Number(v)) + ' ₽' : v,
            name === 'revenue' ? 'Выручка' : name === 'sku_count' ? 'SKU' : 'Ниши',
          ]}
        />
        <Bar dataKey="revenue" barSize={20} radius={[0, 4, 4, 0]}>
          {data.map((entry, i) => (
            <Cell key={i} fill={ABC_COLORS[entry.group] ?? 'var(--accent)'} opacity={0.85} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function NicheTab() {
  const [data, setData] = useState<NicheData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Filters
  const [search, setSearch] = useState('')
  const [seasonalFilter, setSeasonalFilter] = useState<'all' | 'seasonal' | 'no'>('all')
  const [abcFilter, setAbcFilter] = useState('all')
  const [minRevenue, setMinRevenue] = useState('all')
  const [startMonth, setStartMonth] = useState(0)
  const [peakMonth, setPeakMonth] = useState(0)
  const [filtersOpen, setFiltersOpen] = useState(false)

  // Sort
  const [sortKey, setSortKey] = useState('revenue')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  // Expand state: { [category]: true } and { [category + '|' + niche]: true }
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set())
  const [expandedNiches, setExpandedNiches] = useState<Set<string>>(new Set())

  // SKU modal
  const [selectedSku, setSelectedSku] = useState<string | null>(null)

  // Sticky layout
  const summaryBarRef = useRef<HTMLDivElement>(null)
  const filterBarRef = useRef<HTMLDivElement>(null)
  const [stickyTop, setStickyTop] = useState({ summaryBar: 88, filterBar: 132, thead: 184 })

  useEffect(() => {
    function measure() {
      const header = document.querySelector('header.top-nav') as HTMLElement | null
      const headerH = header ? header.getBoundingClientRect().height : 88
      const summaryH = summaryBarRef.current ? summaryBarRef.current.getBoundingClientRect().height : 44
      const filterH = filterBarRef.current ? filterBarRef.current.getBoundingClientRect().height : 52
      setStickyTop({
        summaryBar: headerH,
        filterBar: headerH + summaryH,
        thead: headerH + summaryH + filterH,
      })
    }
    const t = setTimeout(() => requestAnimationFrame(measure), 100)
    window.addEventListener('resize', measure)
    return () => { clearTimeout(t); window.removeEventListener('resize', measure) }
  }, [filtersOpen])

  useEffect(() => {
    setLoading(true)
    setError(null)
    const p = new URLSearchParams()
    if (search) p.set('search', search)
    if (seasonalFilter !== 'all') p.set('seasonal', seasonalFilter)
    if (abcFilter !== 'all') p.set('abc', abcFilter)
    if (minRevenue !== 'all') p.set('min_revenue', minRevenue)
    if (startMonth > 0) p.set('start_month', String(startMonth))
    if (peakMonth > 0) p.set('peak_month', String(peakMonth))

    const q = p.toString()
    fetch(`/api/dashboard/niches${q ? `?${q}` : ''}`)
      .then(r => r.ok ? r.json() : r.json().then((e: { error?: string }) => Promise.reject(new Error(e?.error ?? `HTTP ${r.status}`))))
      .then((d: NicheData) => { setData(d); setLoading(false) })
      .catch((e: unknown) => { setError(String(e)); setLoading(false) })
  }, [search, seasonalFilter, abcFilter, minRevenue, startMonth, peakMonth])

  const toggleSort = useCallback((key: string) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }, [sortKey])

  const toggleCat = (cat: string) => {
    setExpandedCats(prev => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
  }

  const toggleNiche = (cat: string, niche: string) => {
    const key = `${cat}|${niche}`
    setExpandedNiches(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const hasFilter = !!(search || seasonalFilter !== 'all' || abcFilter !== 'all' || minRevenue !== 'all' || startMonth > 0 || peakMonth > 0)

  const resetFilters = () => {
    setSearch(''); setSeasonalFilter('all'); setAbcFilter('all')
    setMinRevenue('all'); setStartMonth(0); setPeakMonth(0)
  }

  // Flatten hierarchy for sort + stats
  const flatNiches = useMemo(() => {
    if (!data) return []
    return data.hierarchy.flatMap(cat => cat.niches)
  }, [data])

  const sortedHierarchy = useMemo(() => {
    if (!data) return []
    function compareRows(a: unknown, b: unknown, key: string, mult: number): number {
      const ar = a as Record<string, unknown>
      const br = b as Record<string, unknown>
      const av = ar[key]; const bv = br[key]
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * mult
      return String(av ?? '').localeCompare(String(bv ?? '')) * mult
    }
    const mult = sortDir === 'asc' ? 1 : -1
    return data.hierarchy.map(cat => ({
      ...cat,
      niches: [...cat.niches].sort((a, b) => compareRows(a, b, sortKey, mult)),
    })).sort((a, b) => compareRows(a, b, sortKey === 'sku_count' || sortKey === 'revenue' ? sortKey : 'revenue', mult))
  }, [data, sortKey, sortDir])

  const selectedRevenue = flatNiches.reduce((s, n) => s + n.revenue, 0)
  const selectedSkuCount = flatNiches.reduce((s, n) => s + n.sku_count, 0)

  function exportNiches() {
    exportToExcel(flatNiches.map(r => ({
      'Ниша': r.niche,
      'Категория': r.category,
      'Рейтинг': r.rating,
      'Привлекательность': r.attractiveness.toFixed(1),
      'Выручка, ₽': Math.round(r.revenue),
      'ЧМД, ₽': Math.round(r.chmd),
      'Gmroy, %': r.gmroy != null ? r.gmroy.toFixed(1) : '',
      'Рен-ть ЧМД, %': r.avg_profitability != null ? r.avg_profitability.toFixed(2) : '',
      'Рен-ть выручки, %': r.avg_revenue_margin != null ? r.avg_revenue_margin.toFixed(2) : '',
      'Сезонный': r.seasonal ? 'Да' : 'Нет',
      'Старт сезона': r.season_start ? MONTHS[r.season_start - 1] : '',
      'Пик сезона': r.season_peak ? MONTHS[r.season_peak - 1] : '',
      'Доступность': r.availability.toFixed(1),
      'ABC класс': r.abc_class,
      'Кол-во SKU': r.sku_count,
    })), `Ниши_ABC_${new Date().toISOString().slice(0, 10)}`)
  }

  if (error) return (
    <div className="px-6 py-16 text-center" style={{ color: 'var(--danger)' }}>
      Ошибка загрузки: {error}
    </div>
  )

  const kpiItems = [
    {
      label: 'Ср. привлекательность',
      value: data ? data.summary.avg_attractiveness.toFixed(1) : '—',
    },
    {
      label: 'Сезонных ниш',
      value: data ? `${data.summary.seasonal_count} / ${data.summary.non_seasonal_count}` : '—',
      hint: 'сезонных / несезонных',
    },
    {
      label: 'Ср. рент. ЧМД, %',
      value: data?.summary.avg_chmd_margin != null
        ? data.summary.avg_chmd_margin.toFixed(2) + '%' : '—',
    },
    {
      label: 'Рент. выручки, %',
      value: data?.summary.avg_revenue_margin != null
        ? data.summary.avg_revenue_margin.toFixed(2) + '%' : '—',
    },
    {
      label: 'Ниш всего',
      value: String(data?.summary.total_niches ?? '—'),
      accent: true,
    },
    {
      label: 'SKU в анализе',
      value: String(data?.summary.total_skus ?? '—'),
    },
  ]

  return (
    <div className="py-6 space-y-5 max-w-[1600px] mx-auto" style={{ position: 'relative' }}>

      {/* ── KPI ── */}
      <div className="px-6">
        <KPIBar loading={loading} items={kpiItems} />
      </div>

      {/* ── Charts grid ── */}
      {!loading && data && (
        <div className="px-6 grid grid-cols-1 xl:grid-cols-2 gap-4">

          {/* Chart 1 — Рейтинг ниш */}
          {data.rating_chart.length > 0 && (
            <GlassCard padding="lg">
              <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-subtle)' }}>
                Рейтинг ниш (ТОП-15)
              </p>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={[...data.rating_chart].reverse()} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.4} horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickLine={false} domain={[0, 100]} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} width={130} tickLine={false} axisLine={false} />
                  <Tooltip formatter={(v) => [v, 'Рейтинг']} />
                  <ReferenceLine
                    x={data.rating_chart.reduce((s, r) => s + r.rating, 0) / Math.max(1, data.rating_chart.length)}
                    stroke="var(--accent)"
                    strokeDasharray="4 3"
                    label={{ value: 'Ср.', fill: 'var(--accent)', fontSize: 10, position: 'top' }}
                  />
                  <Bar dataKey="rating" radius={[0, 4, 4, 0]} barSize={12}>
                    {[...data.rating_chart].reverse().map((entry, i) => (
                      <Cell key={i} fill={ABC_COLORS[entry.abc] ?? 'var(--accent)'} opacity={0.85} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <div className="flex items-center gap-3 mt-2 flex-wrap">
                {Object.entries(ABC_COLORS).filter(([k]) => 'ABC'.includes(k)).map(([k, c]) => (
                  <span key={k} className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>
                    <span className="w-2.5 h-2.5 rounded-sm" style={{ background: c }} />
                    Класс {k}
                  </span>
                ))}
                <span className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  <span className="w-5 border-t-2 border-dashed" style={{ borderColor: 'var(--accent)' }} />
                  Средний рейтинг
                </span>
              </div>
            </GlassCard>
          )}

          {/* Chart 2 — Привлекательность vs Выручка (scatter) */}
          {data.scatter.length > 0 && (
            <GlassCard padding="lg">
              <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-subtle)' }}>
                Привлекательность vs Выручка
              </p>
              <ResponsiveContainer width="100%" height={280}>
                <ScatterChart margin={{ top: 10, right: 10, bottom: 20, left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.4} />
                  <XAxis
                    dataKey="attractiveness"
                    type="number"
                    name="Привлекательность"
                    domain={[0, 10]}
                    tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                    label={{ value: 'Привлекательность', position: 'insideBottom', offset: -8, fontSize: 10, fill: 'var(--text-subtle)' }}
                    tickLine={false}
                  />
                  <YAxis
                    dataKey="revenue"
                    type="number"
                    name="Выручка"
                    tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                    tickFormatter={v => fmtAxis(v)}
                    tickLine={false}
                  />
                  <ZAxis dataKey="market_share" range={[40, 400]} name="SKU" />
                  <Tooltip
                    cursor={{ strokeDasharray: '3 3' }}
                    content={({ payload }) => {
                      if (!payload?.[0]) return null
                      const d = payload[0].payload as typeof data.scatter[0]
                      return (
                        <div className="glass px-3 py-2 text-xs space-y-0.5" style={{ background: 'var(--surface-solid)', border: '1px solid var(--border)', borderRadius: 8 }}>
                          <p className="font-semibold" style={{ color: 'var(--text)' }}>{d.niche}</p>
                          <p style={{ color: 'var(--text-muted)' }}>Привлекательность: {d.attractiveness.toFixed(1)}</p>
                          <p style={{ color: 'var(--text-muted)' }}>Выручка: {fmt(d.revenue)} ₽</p>
                          <p style={{ color: 'var(--text-muted)' }}>SKU в нише: {d.market_share}</p>
                          <p style={{ color: ABC_COLORS[d.abc_class] ?? 'var(--text-muted)' }}>ABC: {d.abc_class}</p>
                        </div>
                      )
                    }}
                  />
                  {['A', 'B', 'C'].map(cls => (
                    <Scatter
                      key={cls}
                      name={`Класс ${cls}`}
                      data={data.scatter.filter(d => d.abc_class === cls)}
                      fill={ABC_COLORS[cls]}
                      opacity={0.8}
                    />
                  ))}
                </ScatterChart>
              </ResponsiveContainer>
              <p className="text-[10px] mt-1" style={{ color: 'var(--text-subtle)' }}>
                Размер точки — кол-во SKU в нише · Цвет — ABC-класс
              </p>
            </GlassCard>
          )}

          {/* Chart 3 — Тепловая карта сезонности */}
          {data.heatmap.length > 0 && (
            <GlassCard padding="lg">
              <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-subtle)' }}>
                Сезонность ниш (коэф. по месяцам)
              </p>
              <SeasonHeatmap data={data.heatmap} />
              <p className="text-[10px] mt-2" style={{ color: 'var(--text-subtle)' }}>
                ТОП-20 ниш по выручке · Чем темнее — тем выше коэффициент сезонности
              </p>
            </GlassCard>
          )}

          {/* Chart 4 — ABC структура */}
          {data.abc_chart.length > 0 && (
            <GlassCard padding="lg">
              <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-subtle)' }}>
                ABC-структура портфеля
              </p>
              <AbcStructureChart data={data.abc_chart} />
              <div className="mt-3 grid grid-cols-2 gap-2">
                {data.abc_chart.map(row => (
                  <div key={row.group} className="flex items-center gap-2 text-xs">
                    <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: ABC_COLORS[row.group] ?? 'var(--accent)' }} />
                    <span style={{ color: 'var(--text-muted)' }}>
                      Класс {row.group}: <span className="font-semibold" style={{ color: 'var(--text)' }}>{row.count} ниш</span>
                      <span className="ml-1" style={{ color: 'var(--text-subtle)' }}>/ {row.sku_count} SKU</span>
                    </span>
                  </div>
                ))}
              </div>
            </GlassCard>
          )}
        </div>
      )}

      {/* ── Summary bar (sticky) ── */}
      <div
        ref={summaryBarRef}
        className="px-6"
        style={{ position: 'sticky', top: stickyTop.summaryBar, zIndex: 30 }}
      >
        <div
          className="glass px-4 py-2.5 flex items-center gap-3 flex-wrap text-sm"
          style={{ background: 'var(--surface-solid)', backdropFilter: 'blur(12px)' }}
        >
          <span style={{ color: 'var(--text-muted)' }}>
            Выбрано: <span className="font-semibold" style={{ color: 'var(--text)' }}>{selectedSkuCount} SKU</span>
          </span>
          <span style={{ color: 'var(--border-subtle)' }}>•</span>
          <span style={{ color: 'var(--text-muted)' }}>
            Выручка: <span className="font-semibold" style={{ color: 'var(--text)' }}>{fmt(selectedRevenue)} ₽</span>
          </span>
          <span style={{ color: 'var(--border-subtle)' }}>•</span>
          <span style={{ color: 'var(--text-muted)' }}>
            Ниш: <span className="font-semibold" style={{ color: 'var(--text)' }}>{flatNiches.length}</span>
          </span>
          <div className="ml-auto flex items-center gap-2">
            {hasFilter && (
              <button
                onClick={resetFilters}
                className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg"
                style={{ color: 'var(--accent)', background: 'var(--accent-glow)' }}
              >
                <X size={11} /> Сбросить
              </button>
            )}
            <button
              onClick={exportNiches}
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
        ref={filterBarRef}
        className="px-6"
        style={{ position: 'sticky', top: stickyTop.filterBar, zIndex: 29 }}
      >
        <div
          className="py-2 flex flex-wrap gap-2 items-center"
          style={{ background: 'var(--surface-solid)', backdropFilter: 'blur(12px)' }}
        >
          {/* Search */}
          <div className="relative min-w-[180px] max-w-xs flex-1">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Ниша, категория..."
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-xl border outline-none"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)' }}
            />
          </div>

          {/* Seasonal toggle */}
          {(['all', 'seasonal', 'no'] as const).map(v => (
            <button key={v} onClick={() => setSeasonalFilter(v)}
              className="text-xs px-2.5 py-1.5 rounded-xl font-medium transition-all"
              style={{ background: seasonalFilter === v ? 'var(--accent)' : 'var(--border)', color: seasonalFilter === v ? 'white' : 'var(--text-muted)' }}>
              {v === 'all' ? 'Все' : v === 'seasonal' ? 'Сезонные' : 'Несезонные'}
            </button>
          ))}

          {/* ABC filter */}
          <select
            value={abcFilter}
            onChange={e => setAbcFilter(e.target.value)}
            className="text-xs px-2.5 py-1.5 rounded-xl border outline-none"
            style={{ background: abcFilter !== 'all' ? 'var(--accent-glow)' : 'var(--border)', border: abcFilter !== 'all' ? '1px solid var(--accent)' : '1px solid transparent', color: abcFilter !== 'all' ? 'var(--accent)' : 'var(--text-muted)' }}
          >
            <option value="all">Все ABC</option>
            <option value="A">Класс A</option>
            <option value="B">Класс B</option>
            <option value="C">Класс C</option>
          </select>

          {/* More filters toggle */}
          <button onClick={() => setFiltersOpen(v => !v)}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-xl font-medium"
            style={{ background: filtersOpen || minRevenue !== 'all' || startMonth > 0 || peakMonth > 0 ? 'var(--accent-glow)' : 'var(--border)', color: filtersOpen || minRevenue !== 'all' || startMonth > 0 || peakMonth > 0 ? 'var(--accent)' : 'var(--text-muted)' }}>
            <Filter size={11} /> Фильтры {(minRevenue !== 'all' || startMonth > 0 || peakMonth > 0) ? '●' : ''}
          </button>
        </div>

        {/* Expanded filters */}
        {filtersOpen && (
          <div className="glass px-4 py-3 flex flex-wrap gap-4 mt-1" style={{ background: 'var(--surface-solid)' }}>
            {/* Min revenue */}
            <div className="space-y-1">
              <p className="text-xs font-medium" style={{ color: 'var(--text-subtle)' }}>Мин. выручка</p>
              <div className="flex gap-1">
                {[{ v: 'all', l: 'Все' }, { v: '100k', l: '>100К' }, { v: '500k', l: '>500К' }, { v: '1m', l: '>1М' }].map(o => (
                  <button key={o.v} onClick={() => setMinRevenue(o.v)}
                    className="text-xs px-2 py-1 rounded-lg"
                    style={{ background: minRevenue === o.v ? 'var(--accent)' : 'var(--border)', color: minRevenue === o.v ? 'white' : 'var(--text-muted)' }}>
                    {o.l}
                  </button>
                ))}
              </div>
            </div>

            {/* Start month */}
            <div className="space-y-1">
              <p className="text-xs font-medium" style={{ color: 'var(--text-subtle)' }}>Старт сезона</p>
              <div className="flex gap-1 flex-wrap max-w-[280px]">
                <button onClick={() => setStartMonth(0)}
                  className="text-xs px-2 py-1 rounded-lg"
                  style={{ background: startMonth === 0 ? 'var(--accent)' : 'var(--border)', color: startMonth === 0 ? 'white' : 'var(--text-muted)' }}>
                  Все
                </button>
                {MONTHS.map((m, i) => (
                  <button key={i} onClick={() => setStartMonth(i + 1)}
                    className="text-xs px-2 py-1 rounded-lg"
                    style={{ background: startMonth === i + 1 ? 'var(--accent)' : 'var(--border)', color: startMonth === i + 1 ? 'white' : 'var(--text-muted)' }}>
                    {m}
                  </button>
                ))}
              </div>
            </div>

            {/* Peak month */}
            <div className="space-y-1">
              <p className="text-xs font-medium" style={{ color: 'var(--text-subtle)' }}>Пик сезона</p>
              <div className="flex gap-1 flex-wrap max-w-[280px]">
                <button onClick={() => setPeakMonth(0)}
                  className="text-xs px-2 py-1 rounded-lg"
                  style={{ background: peakMonth === 0 ? 'var(--accent)' : 'var(--border)', color: peakMonth === 0 ? 'white' : 'var(--text-muted)' }}>
                  Все
                </button>
                {MONTHS.map((m, i) => (
                  <button key={i} onClick={() => setPeakMonth(i + 1)}
                    className="text-xs px-2 py-1 rounded-lg"
                    style={{ background: peakMonth === i + 1 ? 'var(--accent)' : 'var(--border)', color: peakMonth === i + 1 ? 'white' : 'var(--text-muted)' }}>
                    {m}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Table ── */}
      <div className="px-6">
        <GlassCard padding="none">
          <div style={{ overflowX: 'auto' }}>
            <table className="w-full text-xs" style={{ minWidth: 900 }}>
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
                  <th className="text-left px-3 py-2.5 font-medium" style={{ color: 'var(--text-subtle)', fontSize: 11, minWidth: 200 }}>Ниша / Категория / SKU</th>
                  <SortTh label="Рейтинг WB" sk="rating" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortTh label="Привл." sk="attractiveness" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortTh label="Выручка" sk="revenue" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <th className="text-center px-2 py-2.5 font-medium whitespace-nowrap" style={{ color: 'var(--text-subtle)', fontSize: 11 }}>Сезонность</th>
                  <SortTh label="Старт" sk="season_start" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortTh label="Пик" sk="season_peak" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortTh label="Доступн." sk="availability" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <th className="text-center px-2 py-2.5 font-medium" style={{ color: 'var(--text-subtle)', fontSize: 11 }}>ABC</th>
                  <SortTh label="Gmroy, %" sk="gmroy" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortTh label="Кол-во SKU" sk="sku_count" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                </tr>
              </thead>
              <tbody>
                {loading && Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-t" style={{ borderColor: 'var(--border)' }}>
                    {Array.from({ length: 11 }).map((__, j) => (
                      <td key={j} className="px-3 py-2.5"><div className="skeleton h-4 w-full" /></td>
                    ))}
                  </tr>
                ))}

                {!loading && sortedHierarchy.map(cat => {
                  const catExpanded = expandedCats.has(cat.category)
                  return (
                    <>
                      {/* Category row */}
                      <tr
                        key={`cat-${cat.category}`}
                        className="border-t cursor-pointer transition-colors"
                        style={{ borderColor: 'var(--border)', background: 'var(--surface-hover)' }}
                        onClick={() => toggleCat(cat.category)}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '0.85' }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '1' }}
                      >
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <ChevronRight
                              size={14}
                              style={{
                                color: 'var(--accent)',
                                transform: catExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                                transition: 'transform 0.15s',
                                flexShrink: 0,
                              }}
                            />
                            <span className="font-semibold" style={{ color: 'var(--text)', fontSize: 12 }}>{cat.category}</span>
                          </div>
                        </td>
                        <td className="px-2 py-2.5 text-right" style={{ color: 'var(--text-subtle)' }}>—</td>
                        <td className="px-2 py-2.5 text-right font-semibold" style={{ color: 'var(--text-muted)' }}>{cat.attractiveness.toFixed(1)}</td>
                        <td className="px-2 py-2.5 text-right font-semibold" style={{ color: 'var(--text)' }}>{fmt(cat.revenue)}</td>
                        <td className="px-2 py-2.5" />
                        <td className="px-2 py-2.5" />
                        <td className="px-2 py-2.5" />
                        <td className="px-2 py-2.5" />
                        <td className="px-2 py-2.5 text-center">
                          <AbcBadge cls={cat.abc_class} />
                        </td>
                        <td className="px-2 py-2.5 text-right" style={{ color: 'var(--text-muted)' }}>
                          {cat.gmroy != null ? cat.gmroy.toFixed(1) + '%' : '—'}
                        </td>
                        <td className="px-2 py-2.5 text-right" style={{ color: 'var(--text-muted)' }}>{cat.sku_count}</td>
                      </tr>

                      {/* Niche rows */}
                      {catExpanded && cat.niches.map(niche => {
                        const nicheKey = `${cat.category}|${niche.niche}`
                        const nicheExpanded = expandedNiches.has(nicheKey)
                        const isSameAsCat = niche.niche === niche.category

                        return (
                          <>
                            <tr
                              key={`niche-${nicheKey}`}
                              className="border-t cursor-pointer transition-colors"
                              style={{ borderColor: 'var(--border)' }}
                              onClick={() => toggleNiche(cat.category, niche.niche)}
                              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-hover)' }}
                              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '' }}
                            >
                              <td className="px-3 py-2.5">
                                <div className="flex items-center gap-2 pl-5">
                                  <ChevronRight
                                    size={12}
                                    style={{
                                      color: 'var(--text-subtle)',
                                      transform: nicheExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                                      transition: 'transform 0.15s',
                                      flexShrink: 0,
                                    }}
                                  />
                                  <span className="font-medium" style={{ color: isSameAsCat ? 'var(--text-muted)' : 'var(--text)', fontSize: 11 }}>
                                    {niche.niche}
                                  </span>
                                </div>
                              </td>
                              <td className="px-2 py-2.5 text-right font-bold" style={{ color: 'var(--accent)', fontSize: 11 }}>
                                {niche.rating}
                              </td>
                              <td className="px-2 py-2.5 text-right" style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                                {niche.attractiveness.toFixed(1)}
                              </td>
                              <td className="px-2 py-2.5 text-right font-semibold" style={{ color: 'var(--text)', fontSize: 11 }}>
                                {fmt(niche.revenue)}
                              </td>
                              <td className="px-2 py-2.5 text-center">
                                {niche.season_months_coeffs && niche.season_months_coeffs.some(v => v > 0)
                                  ? <MiniSparkline values={niche.season_months_coeffs} />
                                  : <span style={{ color: 'var(--text-subtle)', fontSize: 10 }}>Несезонный</span>
                                }
                              </td>
                              <td className="px-2 py-2.5 text-right" style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                                {niche.season_start ? MONTHS[niche.season_start - 1] : '—'}
                              </td>
                              <td className="px-2 py-2.5 text-right font-semibold" style={{ color: niche.season_peak ? 'var(--accent)' : 'var(--text-subtle)', fontSize: 11 }}>
                                {niche.season_peak ? MONTHS[niche.season_peak - 1] : '—'}
                              </td>
                              <td className="px-2 py-2.5 text-right" style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                                {niche.availability.toFixed(1)}
                              </td>
                              <td className="px-2 py-2.5 text-center">
                                <AbcBadge cls={niche.abc_class} />
                              </td>
                              <td className="px-2 py-2.5 text-right" style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                                {niche.gmroy != null ? niche.gmroy.toFixed(1) + '%' : '—'}
                              </td>
                              <td className="px-2 py-2.5 text-right" style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                                {niche.sku_count}
                              </td>
                            </tr>

                            {/* SKU rows */}
                            {nicheExpanded && niche.skus.map((sku, si) => (
                              <tr
                                key={`sku-${nicheKey}-${si}`}
                                className="border-t cursor-pointer transition-colors"
                                style={{ borderColor: 'var(--border)' }}
                                onClick={e => { e.stopPropagation(); setSelectedSku(sku.sku_ms) }}
                                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(var(--accent-rgb, 255,59,92),0.05)' }}
                                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '' }}
                              >
                                <td className="px-3 py-2">
                                  <div className="flex items-center gap-2 pl-10">
                                    <span className="font-mono text-[10px]" style={{ color: 'var(--text-subtle)' }}>
                                      {sku.sku_ms}
                                    </span>
                                    <span className="truncate max-w-[160px]" style={{ color: 'var(--text-muted)', fontSize: 10 }} title={sku.name}>
                                      {sku.name}
                                    </span>
                                  </div>
                                </td>
                                <td className="px-2 py-2 text-right" style={{ color: 'var(--text-subtle)', fontSize: 10 }}>—</td>
                                <td className="px-2 py-2 text-right" style={{ color: 'var(--text-muted)', fontSize: 10 }}>{sku.attractiveness.toFixed(1)}</td>
                                <td className="px-2 py-2 text-right" style={{ color: 'var(--text-muted)', fontSize: 10 }}>{fmt(sku.revenue)}</td>
                                <td className="px-2 py-2 text-center">
                                  {sku.season_months && sku.season_months.some(v => v > 0)
                                    ? <MiniSparkline values={sku.season_months} />
                                    : <span style={{ color: 'var(--text-subtle)', fontSize: 10 }}>—</span>}
                                </td>
                                <td className="px-2 py-2 text-right" style={{ color: 'var(--text-subtle)', fontSize: 10 }}>
                                  {sku.season_start ? MONTHS[sku.season_start - 1] : '—'}
                                </td>
                                <td className="px-2 py-2 text-right" style={{ color: 'var(--accent)', fontSize: 10, fontWeight: 600 }}>
                                  {sku.season_peak ? MONTHS[sku.season_peak - 1] : '—'}
                                </td>
                                <td className="px-2 py-2 text-right" style={{ color: 'var(--text-muted)', fontSize: 10 }}>{sku.availability.toFixed(1)}</td>
                                <td className="px-2 py-2 text-center">
                                  <AbcBadge cls={sku.abc_class} />
                                </td>
                                <td className="px-2 py-2 text-right" style={{ color: 'var(--text-muted)', fontSize: 10 }}>
                                  {sku.gmroy != null ? sku.gmroy.toFixed(1) + '%' : '—'}
                                </td>
                                <td className="px-2 py-2 text-right" style={{ color: 'var(--text-subtle)', fontSize: 10 }}>—</td>
                              </tr>
                            ))}
                          </>
                        )
                      })}
                    </>
                  )
                })}

                {!loading && sortedHierarchy.length === 0 && (
                  <tr>
                    <td colSpan={11} className="px-4 py-12 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                      Нет данных по нишам. Загрузите ABC-файл через вкладку «Обновление данных».
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </GlassCard>
      </div>

      <SkuModal skuMs={selectedSku} onClose={() => setSelectedSku(null)} />
    </div>
  )
}
