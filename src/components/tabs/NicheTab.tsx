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
import { nicheTabCache } from '@/lib/tabCache'
import {
  ChevronUp, ChevronDown, ChevronRight, Download, X,
  Search, Filter, List, GitBranch, AlertTriangle,
} from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

interface SkuEntry {
  sku_ms: string; name: string; revenue: number; chmd: number
  abc_class: string; abc_class2: string | null
  profitability: number | null; revenue_margin: number | null
  gmroy: number | null; season_months: number[]
  season_start: number; season_peak: number; seasonal: boolean
  attractiveness: number; availability: number
}

interface NicheRow {
  niche: string; category: string
  rating: number; attractiveness: number
  revenue: number; chmd: number
  avg_profitability: number | null; avg_revenue_margin: number | null
  ad_spend: number; storage: number; transport: number
  seasonal: boolean; season_months_coeffs: number[]
  season_months: number[]; season_start: number; season_peak: number
  availability: number
  abc_class: string      // top base letter (A/B/C/—)
  abc_combo: string      // top full combo class
  abc_status: string     // normal / loss / nd
  abc_distribution: Record<string, number>
  abc_combo_distribution: Record<string, number>
  gmroy: number | null; sku_count: number; has_abc: boolean
  skus: SkuEntry[]
}

interface NicheData {
  summary: {
    avg_attractiveness: number
    seasonal_count: number; non_seasonal_count: number
    abc_distribution: Record<string, number>
    abc_combo_distribution: Record<string, number>
    avg_chmd_margin: number | null
    avg_revenue_margin: number | null
    total_niches: number; total_skus: number
    has_abc_data: boolean
    abc_period: string | null
    dim_sku_count: number
  }
  rows: NicheRow[]
  scatter: Array<{ niche: string; attractiveness: number; revenue: number; market_share: number; abc_class: string }>
  heatmap: Array<{ niche: string; months: number[] }>
  abc_chart: Array<{ group: string; count: number; revenue: number; sku_count: number }>
  rating_chart: Array<{ name: string; rating: number; abc: string }>
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MONTHS = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек']

const ABC_COLORS: Record<string, string> = {
  A: '#22c55e', B: '#f59e0b', C: '#ef4444',
  'Убыток': '#f97316', 'Н/Д': '#9ca3af', '—': '#6b7280',
}

function abcColor(cls: string): string {
  if (!cls) return '#6b7280'
  const first = cls.charAt(0).toUpperCase()
  if (cls.toLowerCase().startsWith('убыток')) return '#f97316'
  if (first === 'A') return '#22c55e'
  if (first === 'B') return '#f59e0b'
  if (first === 'C') return '#ef4444'
  return '#9ca3af'
}

// ── Formatters ────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined) {
  if (n == null) return '—'
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'М'
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(0) + 'К'
  return String(Math.round(n))
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SortTh({ label, sk, align = 'right', sortKey, sortDir, onSort }: {
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
          ? (sortDir === 'asc' ? <ChevronUp size={10} /> : <ChevronDown size={10} />)
          : <ChevronDown size={10} style={{ opacity: 0.25 }} />}
      </span>
    </th>
  )
}

function MiniSparkline({ values, peakColor = '#FF3B5C' }: { values: number[]; peakColor?: string }) {
  if (!values || values.length !== 12) return <span style={{ color: 'var(--text-subtle)', fontSize: 11 }}>—</span>
  const sorted = [...values].sort((a, b) => b - a)
  const threshold = sorted[2] ?? 0
  const max = sorted[0] ?? 1
  return (
    <div className="flex items-end gap-0.5 h-5">
      {values.map((v, i) => {
        const isPeak = v >= threshold && v > 0
        const height = max > 0 ? Math.round((v / max) * 18) : 2
        return (
          <div
            key={i}
            className="w-1.5 rounded-sm"
            style={{
              height: `${Math.max(height, 2)}px`,
              background: isPeak ? peakColor : 'var(--border)',
              opacity: isPeak ? 1 : 0.5,
            }}
            title={`${MONTHS[i]}: ${v.toFixed(2)}`}
          />
        )
      })}
    </div>
  )
}

function AbcBadge({ cls, status }: { cls: string; status?: string }) {
  if (!cls || cls === '—') return <span style={{ color: 'var(--text-subtle)' }}>—</span>
  const isLoss = cls.toLowerCase().startsWith('убыток') || status === 'loss'
  const isNd = status === 'nd'
  const color = abcColor(cls)
  const bg = isLoss ? 'rgba(249,115,22,0.12)' : isNd ? 'rgba(156,163,175,0.15)' : `${color}18`
  return (
    <span
      className="text-[10px] font-bold px-1.5 py-0.5 rounded-md whitespace-nowrap"
      style={{ background: bg, color }}
      title={cls}
    >
      {cls.length > 10 ? cls.slice(0, 9) + '…' : cls}
    </span>
  )
}

function SeasonHeatmap({ data }: { data: Array<{ niche: string; months: number[] }> }) {
  if (!data.length) return null
  const allVals = data.flatMap(d => d.months)
  const globalMax = Math.max(...allVals, 1)
  function cellColor(v: number): string {
    const intensity = Math.min(1, v / globalMax)
    if (intensity < 0.05) return 'var(--border)'
    const r = Math.round(30 + intensity * 225)
    const g = Math.round(120 - intensity * 100)
    const b = Math.round(200 - intensity * 160)
    return `rgb(${r},${g},${b})`
  }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="text-[10px] border-separate" style={{ borderSpacing: 2 }}>
        <thead>
          <tr>
            <th className="text-right pr-2 pb-1 font-normal" style={{ color: 'var(--text-subtle)', minWidth: 110 }}>Ниша</th>
            {MONTHS.map(m => (
              <th key={m} className="text-center pb-1 font-normal" style={{ color: 'var(--text-subtle)', width: 26 }}>{m}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr key={i}>
              <td className="text-right pr-2 py-0.5" style={{ color: 'var(--text-muted)', maxWidth: 120 }} title={row.niche}>
                <span className="block truncate">{row.niche}</span>
              </td>
              {row.months.map((v, j) => (
                <td key={j} title={`${MONTHS[j]}: ${v.toFixed(2)}`}>
                  <div className="rounded-sm mx-auto" style={{ width: 20, height: 16, background: cellColor(v) }} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Empty / no-data banner ────────────────────────────────────────────────────

function DataAlert({ summary }: { summary: NicheData['summary'] }) {
  if (summary.dim_sku_count === 0) {
    return (
      <div className="mx-6 mb-4 px-4 py-3 rounded-xl flex items-start gap-3" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
        <AlertTriangle size={16} style={{ color: '#ef4444', flexShrink: 0, marginTop: 1 }} />
        <div>
          <p className="text-sm font-semibold" style={{ color: '#ef4444' }}>Каталог не загружен</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            Нет данных в таблице dim_sku. Загрузите каталог товаров через вкладку «Обновление данных».
          </p>
        </div>
      </div>
    )
  }
  if (!summary.has_abc_data) {
    return (
      <div className="mx-6 mb-4 px-4 py-3 rounded-xl flex items-start gap-3" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)' }}>
        <AlertTriangle size={16} style={{ color: '#f59e0b', flexShrink: 0, marginTop: 1 }} />
        <div>
          <p className="text-sm font-semibold" style={{ color: '#f59e0b' }}>ABC-анализ не загружен</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            Каталог загружен ({summary.dim_sku_count} SKU), но данные ABC-анализа отсутствуют.
            Загрузите файл ABC через вкладку «Обновление данных» — данные обновляются раз в месяц.
          </p>
        </div>
      </div>
    )
  }
  return null
}

// ── Cache key ─────────────────────────────────────────────────────────────────

function makeCacheKey(params: Record<string, string | number>) {
  return Object.entries(params)
    .filter(([, v]) => v !== '' && v !== 'all' && v !== 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('&') || 'default'
}

// ── Main component ────────────────────────────────────────────────────────────

const nicheCache = nicheTabCache as Map<string, NicheData>

export default function NicheTab() {
  // Filters
  const [search, setSearch] = useState('')
  const [seasonalFilter, setSeasonalFilter] = useState<'all' | 'seasonal' | 'no'>('all')
  const [abcFilter, setAbcFilter] = useState('all')
  const [abcStatusFilter, setAbcStatusFilter] = useState('all')
  const [minRevenue, setMinRevenue] = useState('all')
  const [startMonth, setStartMonth] = useState(0)
  const [peakMonth, setPeakMonth] = useState(0)
  const [filtersOpen, setFiltersOpen] = useState(false)

  const cacheKey = makeCacheKey({ search, seasonal: seasonalFilter, abc: abcFilter, abc_status: abcStatusFilter, min_revenue: minRevenue, start_month: startMonth, peak_month: peakMonth })

  const [data, setData] = useState<NicheData | null>(() => nicheCache.get(cacheKey) ?? null)
  const [loading, setLoading] = useState(() => !nicheCache.has(cacheKey))
  const [error, setError] = useState<string | null>(null)

  // Sort
  const [sortKey, setSortKey] = useState('revenue')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  // View: flat list or hierarchy (niche → SKU)
  const [flatMode, setFlatMode] = useState(false)

  // Expand state
  const [expandedNiches, setExpandedNiches] = useState<Set<string>>(new Set())

  // SKU modal
  const [selectedSku, setSelectedSku] = useState<string | null>(null)

  // Sticky layout
  const summaryBarRef = useRef<HTMLDivElement>(null)
  const filterBarRef = useRef<HTMLDivElement>(null)
  const [stickyTop, setStickyTop] = useState({ summaryBar: 88, filterBar: 132, thead: 180 })

  useEffect(() => {
    function measure() {
      const header = document.querySelector('header.top-nav') as HTMLElement | null
      const headerH = header ? header.getBoundingClientRect().height : 88
      const summaryH = summaryBarRef.current?.getBoundingClientRect().height ?? 44
      const filterH = filterBarRef.current?.getBoundingClientRect().height ?? 48
      setStickyTop({ summaryBar: headerH, filterBar: headerH + summaryH, thead: headerH + summaryH + filterH })
    }
    const t = setTimeout(() => requestAnimationFrame(measure), 100)
    window.addEventListener('resize', measure)
    return () => { clearTimeout(t); window.removeEventListener('resize', measure) }
  }, [filtersOpen])

  useEffect(() => {
    const key = cacheKey
    const hit = nicheCache.get(key)
    if (hit) { setData(hit); setLoading(false); return }

    setLoading(true); setError(null)
    const p = new URLSearchParams()
    if (search) p.set('search', search)
    if (seasonalFilter !== 'all') p.set('seasonal', seasonalFilter)
    if (abcFilter !== 'all') p.set('abc', abcFilter)
    if (abcStatusFilter !== 'all') p.set('abc_status', abcStatusFilter)
    if (minRevenue !== 'all') p.set('min_revenue', minRevenue)
    if (startMonth > 0) p.set('start_month', String(startMonth))
    if (peakMonth > 0) p.set('peak_month', String(peakMonth))

    fetch(`/api/dashboard/niches${p.toString() ? `?${p}` : ''}`)
      .then(r => r.ok ? r.json() : r.json().then((e: { error?: string }) => Promise.reject(new Error(e?.error ?? `HTTP ${r.status}`))))
      .then((d: NicheData) => { nicheCache.set(key, d); setData(d); setLoading(false) })
      .catch((e: unknown) => { setError(String(e)); setLoading(false) })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey])

  const toggleSort = useCallback((key: string) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }, [sortKey])

  const toggleNiche = (niche: string) => {
    setExpandedNiches(prev => {
      const next = new Set(prev)
      if (next.has(niche)) next.delete(niche)
      else next.add(niche)
      return next
    })
  }

  const hasFilter = !!(search || seasonalFilter !== 'all' || abcFilter !== 'all' || abcStatusFilter !== 'all' || minRevenue !== 'all' || startMonth > 0 || peakMonth > 0)

  const resetFilters = () => {
    setSearch(''); setSeasonalFilter('all'); setAbcFilter('all')
    setAbcStatusFilter('all'); setMinRevenue('all'); setStartMonth(0); setPeakMonth(0)
  }

  const sortedRows = useMemo(() => {
    if (!data?.rows) return []
    return [...data.rows].sort((a, b) => {
      const mult = sortDir === 'asc' ? 1 : -1
      const ra = a as unknown as Record<string, unknown>
      const rb = b as unknown as Record<string, unknown>
      const av = ra[sortKey]; const bv = rb[sortKey]
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * mult
      return String(av ?? '').localeCompare(String(bv ?? '')) * mult
    })
  }, [data?.rows, sortKey, sortDir])

  const totalRevenue = data?.rows.reduce((s, r) => s + r.revenue, 0) ?? 0
  const totalSkus = data?.rows.reduce((s, r) => s + r.sku_count, 0) ?? 0

  function exportNiches() {
    exportToExcel((data?.rows ?? []).map(r => ({
      'Ниша': r.niche, 'Категория': r.category,
      'Рейтинг': r.rating,
      'Привлекательность': r.attractiveness,
      'Выручка, ₽': Math.round(r.revenue),
      'ЧМД, ₽': Math.round(r.chmd),
      'Gmroy, %': r.gmroy?.toFixed(1) ?? '',
      'Рен-ть ЧМД, %': r.avg_profitability?.toFixed(2) ?? '',
      'Рен-ть выручки, %': r.avg_revenue_margin?.toFixed(2) ?? '',
      'Сезонный': r.seasonal ? 'Да' : 'Нет',
      'Старт': r.season_start ? MONTHS[r.season_start - 1] : '',
      'Пик': r.season_peak ? MONTHS[r.season_peak - 1] : '',
      'ABC': r.abc_combo,
      'Кол-во SKU': r.sku_count,
    })), `Ниши_ABC_${new Date().toISOString().slice(0, 10)}`)
  }

  if (error) return (
    <div className="px-6 py-16 text-center" style={{ color: 'var(--danger)' }}>
      Ошибка загрузки: {error}
    </div>
  )

  // KPI items
  const kpiItems = [
    {
      label: 'Ср. привлекательность',
      value: data ? String(data.summary.avg_attractiveness) : '—',
      hint: 'по всем нишам (0–100)',
    },
    {
      label: 'Сезонных / Несезонных',
      value: data ? `${data.summary.seasonal_count} / ${data.summary.non_seasonal_count}` : '—',
    },
    {
      label: 'Рент. ЧМД, %',
      value: data?.summary.avg_chmd_margin != null
        ? data.summary.avg_chmd_margin.toFixed(1) + '%' : '—',
    },
    {
      label: 'Рент. выручки, %',
      value: data?.summary.avg_revenue_margin != null
        ? data.summary.avg_revenue_margin.toFixed(1) + '%' : '—',
    },
    {
      label: 'Процент выкупа',
      value: '—',
      hint: 'нет данных в ABC-файле',
    },
    {
      label: 'SKU в анализе',
      value: String(data?.summary.total_skus ?? '—'),
      accent: true,
    },
  ]

  const ratingChart = data?.rating_chart ?? []
  const avgRating = ratingChart.length > 0
    ? ratingChart.reduce((s, r) => s + r.rating, 0) / ratingChart.length
    : 0

  return (
    <div className="py-6 space-y-5" style={{ position: 'relative' }}>

      {/* Period info */}
      {data?.summary.abc_period && (
        <div className="px-6">
          <p className="text-xs" style={{ color: 'var(--text-subtle)' }}>
            Данные ABC-анализа за период:&nbsp;
            <span className="font-semibold" style={{ color: 'var(--text-muted)' }}>
              {new Date(data.summary.abc_period).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })}
            </span>
            <span className="ml-2 opacity-60">(данные обновляются раз в месяц)</span>
          </p>
        </div>
      )}

      {/* Data alerts */}
      {data && <DataAlert summary={data.summary} />}

      {/* KPI */}
      <div className="px-6">
        <KPIBar loading={loading} items={kpiItems} />
      </div>

      {/* Charts (2-column grid) */}
      {!loading && data && (data.rating_chart.length > 0 || data.scatter.length > 0) && (
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
                  {avgRating > 0 && (
                    <ReferenceLine
                      x={avgRating}
                      stroke="var(--accent)"
                      strokeDasharray="4 3"
                      label={{ value: 'Ср.', fill: 'var(--accent)', fontSize: 10, position: 'top' }}
                    />
                  )}
                  <Bar dataKey="rating" radius={[0, 4, 4, 0]} barSize={12}>
                    {[...data.rating_chart].reverse().map((entry, i) => (
                      <Cell key={i} fill={ABC_COLORS[entry.abc] ?? 'var(--accent)'} opacity={0.85} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <div className="flex items-center gap-3 mt-2 flex-wrap">
                {(['A', 'B', 'C'] as const).map(k => (
                  <span key={k} className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>
                    <span className="w-2.5 h-2.5 rounded-sm" style={{ background: ABC_COLORS[k] }} />
                    Класс {k}
                  </span>
                ))}
                <span className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  <span className="inline-block w-5 border-t-2 border-dashed" style={{ borderColor: 'var(--accent)' }} />
                  Средний
                </span>
              </div>
            </GlassCard>
          )}

          {/* Chart 2 — Scatter: Привлекательность vs Выручка */}
          {data.scatter.length > 0 && (
            <GlassCard padding="lg">
              <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-subtle)' }}>
                Привлекательность vs Выручка
              </p>
              <ResponsiveContainer width="100%" height={280}>
                <ScatterChart margin={{ top: 10, right: 10, bottom: 24, left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.4} />
                  <XAxis
                    dataKey="attractiveness" type="number" name="Привлекательность"
                    domain={[0, 100]}
                    tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickLine={false}
                    label={{ value: 'Привлекательность', position: 'insideBottom', offset: -12, fontSize: 10, fill: 'var(--text-subtle)' }}
                  />
                  <YAxis
                    dataKey="revenue" type="number" name="Выручка"
                    tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickLine={false}
                    tickFormatter={v => fmtAxis(v)}
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
                          <p style={{ color: 'var(--text-muted)' }}>Привл.: {d.attractiveness}</p>
                          <p style={{ color: 'var(--text-muted)' }}>Выручка: {fmt(d.revenue)} ₽</p>
                          <p style={{ color: 'var(--text-muted)' }}>SKU: {d.market_share}</p>
                          <p style={{ color: abcColor(d.abc_class) }}>ABC: {d.abc_class}</p>
                        </div>
                      )
                    }}
                  />
                  {['A', 'B', 'C'].map(cls => (
                    <Scatter key={cls} data={data.scatter.filter(d => d.abc_class === cls)} fill={ABC_COLORS[cls]} opacity={0.8} />
                  ))}
                </ScatterChart>
              </ResponsiveContainer>
              <p className="text-[10px] mt-1" style={{ color: 'var(--text-subtle)' }}>Размер точки — кол-во SKU в нише</p>
            </GlassCard>
          )}

          {/* Chart 3 — Тепловая карта сезонности */}
          {data.heatmap.length > 0 && (
            <GlassCard padding="lg">
              <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-subtle)' }}>
                Сезонность ниш по месяцам
              </p>
              <SeasonHeatmap data={data.heatmap} />
              <p className="text-[10px] mt-2" style={{ color: 'var(--text-subtle)' }}>
                ТОП-20 ниш по выручке · темнее = выше коэф. сезонности
              </p>
            </GlassCard>
          )}

          {/* Chart 4 — ABC структура */}
          {data.abc_chart.length > 0 && (
            <GlassCard padding="lg">
              <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-subtle)' }}>
                ABC-структура портфеля
              </p>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={data.abc_chart} layout="vertical" margin={{ top: 0, right: 20, bottom: 0, left: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.4} horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickLine={false} tickFormatter={v => fmt(v)} />
                  <YAxis type="category" dataKey="group" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} width={48} tickLine={false} axisLine={false} />
                  <Tooltip formatter={(v) => [fmt(Number(v)) + ' ₽', 'Выручка']} />
                  <Bar dataKey="revenue" barSize={20} radius={[0, 4, 4, 0]}>
                    {data.abc_chart.map((entry, i) => (
                      <Cell key={i} fill={ABC_COLORS[entry.group] ?? '#9ca3af'} opacity={0.85} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <div className="grid grid-cols-2 gap-1.5 mt-3">
                {data.abc_chart.map(row => (
                  <div key={row.group} className="flex items-center gap-1.5 text-[10px]">
                    <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: ABC_COLORS[row.group] ?? '#9ca3af' }} />
                    <span style={{ color: 'var(--text-muted)' }}>
                      {row.group}: <span className="font-semibold" style={{ color: 'var(--text)' }}>{row.sku_count} SKU</span>
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
        <div className="glass px-4 py-2.5 flex items-center gap-3 flex-wrap text-sm" style={{ background: 'var(--surface-solid)', backdropFilter: 'blur(12px)' }}>
          <span style={{ color: 'var(--text-muted)' }}>
            Выбрано: <span className="font-semibold" style={{ color: 'var(--text)' }}>{totalSkus} SKU</span>
          </span>
          <span style={{ color: 'var(--border-subtle)' }}>•</span>
          <span style={{ color: 'var(--text-muted)' }}>
            Выручка: <span className="font-semibold" style={{ color: 'var(--text)' }}>{fmt(totalRevenue)} ₽</span>
          </span>
          <span style={{ color: 'var(--border-subtle)' }}>•</span>
          <span style={{ color: 'var(--text-muted)' }}>
            Ниш: <span className="font-semibold" style={{ color: 'var(--text)' }}>{sortedRows.length}</span>
          </span>

          <div className="ml-auto flex items-center gap-2">
            {/* View mode toggle */}
            <div className="flex items-center rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
              <button
                onClick={() => setFlatMode(false)}
                className="flex items-center gap-1 px-2 py-1 text-xs font-medium transition-all"
                style={{ background: !flatMode ? 'var(--accent)' : 'transparent', color: !flatMode ? 'white' : 'var(--text-muted)' }}
                title="Иерархический вид"
              >
                <GitBranch size={11} /> Иерархия
              </button>
              <button
                onClick={() => setFlatMode(true)}
                className="flex items-center gap-1 px-2 py-1 text-xs font-medium transition-all"
                style={{ background: flatMode ? 'var(--accent)' : 'transparent', color: flatMode ? 'white' : 'var(--text-muted)' }}
                title="Плоский список"
              >
                <List size={11} /> Список
              </button>
            </div>

            {hasFilter && (
              <button onClick={resetFilters} className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg" style={{ color: 'var(--accent)', background: 'var(--accent-glow)' }}>
                <X size={11} /> Сбросить
              </button>
            )}
            <button onClick={exportNiches} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl font-medium" style={{ background: 'var(--border)', color: 'var(--text-muted)' }}>
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
        <div className="py-2 flex flex-wrap gap-2 items-center" style={{ background: 'var(--surface-solid)', backdropFilter: 'blur(12px)' }}>
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
              className="text-xs px-2.5 py-1.5 rounded-xl font-medium"
              style={{ background: seasonalFilter === v ? 'var(--accent)' : 'var(--border)', color: seasonalFilter === v ? 'white' : 'var(--text-muted)' }}>
              {v === 'all' ? 'Все' : v === 'seasonal' ? 'Сезонные' : 'Несезонные'}
            </button>
          ))}

          {/* ABC base filter */}
          <select value={abcFilter} onChange={e => setAbcFilter(e.target.value)}
            className="text-xs px-2.5 py-1.5 rounded-xl border outline-none appearance-none"
            style={{ background: abcFilter !== 'all' ? 'var(--accent-glow)' : 'var(--border)', border: abcFilter !== 'all' ? '1px solid var(--accent)' : '1px solid transparent', color: abcFilter !== 'all' ? 'var(--accent)' : 'var(--text-muted)' }}>
            <option value="all">ABC класс</option>
            <option value="A">Класс A</option>
            <option value="B">Класс B</option>
            <option value="C">Класс C</option>
          </select>

          {/* ABC status filter */}
          <select value={abcStatusFilter} onChange={e => setAbcStatusFilter(e.target.value)}
            className="text-xs px-2.5 py-1.5 rounded-xl border outline-none appearance-none"
            style={{ background: abcStatusFilter !== 'all' ? 'var(--accent-glow)' : 'var(--border)', border: abcStatusFilter !== 'all' ? '1px solid var(--accent)' : '1px solid transparent', color: abcStatusFilter !== 'all' ? 'var(--accent)' : 'var(--text-muted)' }}>
            <option value="all">Статус</option>
            <option value="normal">Обычный</option>
            <option value="loss">Убыток</option>
            <option value="nd">Н/Д</option>
          </select>

          {/* More filters */}
          <button onClick={() => setFiltersOpen(v => !v)}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-xl font-medium"
            style={{ background: (filtersOpen || minRevenue !== 'all' || startMonth > 0 || peakMonth > 0) ? 'var(--accent-glow)' : 'var(--border)', color: (filtersOpen || minRevenue !== 'all' || startMonth > 0 || peakMonth > 0) ? 'var(--accent)' : 'var(--text-muted)' }}>
            <Filter size={11} /> Ещё {(minRevenue !== 'all' || startMonth > 0 || peakMonth > 0) ? '●' : ''}
          </button>
        </div>

        {filtersOpen && (
          <div className="glass px-4 py-3 flex flex-wrap gap-4 mt-0.5" style={{ background: 'var(--surface-solid)' }}>
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
              <div className="flex gap-1 flex-wrap max-w-[320px]">
                <button onClick={() => setStartMonth(0)} className="text-xs px-2 py-1 rounded-lg"
                  style={{ background: startMonth === 0 ? 'var(--accent)' : 'var(--border)', color: startMonth === 0 ? 'white' : 'var(--text-muted)' }}>Все</button>
                {MONTHS.map((m, i) => (
                  <button key={i} onClick={() => setStartMonth(i + 1)} className="text-xs px-2 py-1 rounded-lg"
                    style={{ background: startMonth === i + 1 ? 'var(--accent)' : 'var(--border)', color: startMonth === i + 1 ? 'white' : 'var(--text-muted)' }}>{m}</button>
                ))}
              </div>
            </div>
            {/* Peak month */}
            <div className="space-y-1">
              <p className="text-xs font-medium" style={{ color: 'var(--text-subtle)' }}>Пик сезона</p>
              <div className="flex gap-1 flex-wrap max-w-[320px]">
                <button onClick={() => setPeakMonth(0)} className="text-xs px-2 py-1 rounded-lg"
                  style={{ background: peakMonth === 0 ? 'var(--accent)' : 'var(--border)', color: peakMonth === 0 ? 'white' : 'var(--text-muted)' }}>Все</button>
                {MONTHS.map((m, i) => (
                  <button key={i} onClick={() => setPeakMonth(i + 1)} className="text-xs px-2 py-1 rounded-lg"
                    style={{ background: peakMonth === i + 1 ? 'var(--accent)' : 'var(--border)', color: peakMonth === i + 1 ? 'white' : 'var(--text-muted)' }}>{m}</button>
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
            <table className="w-full text-xs" style={{ minWidth: 860 }}>
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
                  <th className="text-left px-3 py-2.5 font-medium" style={{ color: 'var(--text-subtle)', fontSize: 11, minWidth: 200 }}>
                    Ниша / SKU
                  </th>
                  <SortTh label="Рейтинг" sk="rating" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortTh label="Привл." sk="attractiveness" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortTh label="Выручка" sk="revenue" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <th className="text-center px-2 py-2.5 font-medium whitespace-nowrap" style={{ color: 'var(--text-subtle)', fontSize: 11 }}>Сезонность</th>
                  <SortTh label="Старт" sk="season_start" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortTh label="Пик" sk="season_peak" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortTh label="Доступн." sk="availability" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <th className="text-center px-2 py-2.5 font-medium whitespace-nowrap" style={{ color: 'var(--text-subtle)', fontSize: 11 }}>Итог. класс</th>
                  <SortTh label="Gmroy %" sk="gmroy" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortTh label="SKU" sk="sku_count" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                </tr>
              </thead>
              <tbody>
                {/* Loading skeletons */}
                {loading && Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="border-t" style={{ borderColor: 'var(--border)' }}>
                    {Array.from({ length: 11 }).map((__, j) => (
                      <td key={j} className="px-3 py-2.5"><div className="skeleton h-4 w-full" /></td>
                    ))}
                  </tr>
                ))}

                {!loading && sortedRows.map(niche => {
                  const nicheExpanded = !flatMode && expandedNiches.has(niche.niche)
                  return (
                    <>
                      {/* ── Niche row ── */}
                      <tr
                        key={`niche-${niche.niche}`}
                        className="border-t cursor-pointer transition-colors"
                        style={{ borderColor: 'var(--border)' }}
                        onClick={() => !flatMode && toggleNiche(niche.niche)}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-hover)' }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '' }}
                      >
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            {!flatMode && (
                              <ChevronRight
                                size={13}
                                style={{
                                  color: 'var(--accent)',
                                  transform: nicheExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                                  transition: 'transform 0.15s',
                                  flexShrink: 0,
                                }}
                              />
                            )}
                            <div>
                              <p className="font-semibold" style={{ color: 'var(--text)', fontSize: 12 }}>{niche.niche}</p>
                              <p className="text-[10px]" style={{ color: 'var(--text-subtle)' }}>{niche.category}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-2 py-2.5 text-right font-bold" style={{ color: 'var(--accent)', fontSize: 12 }}>{niche.rating}</td>
                        <td className="px-2 py-2.5 text-right" style={{ color: 'var(--text-muted)' }}>{niche.attractiveness}</td>
                        <td className="px-2 py-2.5 text-right font-semibold" style={{ color: 'var(--text)' }}>{fmt(niche.revenue)}</td>
                        <td className="px-2 py-2.5 text-center">
                          {niche.season_months_coeffs.some(v => v > 0)
                            ? <MiniSparkline values={niche.season_months_coeffs} />
                            : <span style={{ color: 'var(--text-subtle)', fontSize: 10 }}>Несезонный</span>}
                        </td>
                        <td className="px-2 py-2.5 text-right" style={{ color: 'var(--text-muted)' }}>
                          {niche.season_start ? MONTHS[niche.season_start - 1] : '—'}
                        </td>
                        <td className="px-2 py-2.5 text-right font-semibold" style={{ color: niche.season_peak ? 'var(--accent)' : 'var(--text-subtle)' }}>
                          {niche.season_peak ? MONTHS[niche.season_peak - 1] : '—'}
                        </td>
                        <td className="px-2 py-2.5 text-right" style={{ color: 'var(--text-muted)' }}>{niche.availability.toFixed(1)}</td>
                        <td className="px-2 py-2.5 text-center">
                          <AbcBadge cls={niche.abc_combo} status={niche.abc_status} />
                        </td>
                        <td className="px-2 py-2.5 text-right" style={{ color: 'var(--text-muted)' }}>
                          {niche.gmroy != null ? niche.gmroy.toFixed(1) + '%' : '—'}
                        </td>
                        <td className="px-2 py-2.5 text-right" style={{ color: 'var(--text-muted)' }}>{niche.sku_count}</td>
                      </tr>

                      {/* ── SKU rows (hierarchy mode only) ── */}
                      {nicheExpanded && niche.skus.map((sku, si) => (
                        <tr
                          key={`sku-${niche.niche}-${si}`}
                          className="border-t cursor-pointer"
                          style={{ borderColor: 'var(--border)' }}
                          onClick={e => { e.stopPropagation(); setSelectedSku(sku.sku_ms) }}
                          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,59,92,0.04)' }}
                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '' }}
                        >
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2 pl-6">
                              <span className="font-mono text-[10px]" style={{ color: 'var(--text-subtle)' }}>{sku.sku_ms}</span>
                              <span className="truncate max-w-[180px] text-[10px]" style={{ color: 'var(--text-muted)' }} title={sku.name}>{sku.name}</span>
                            </div>
                          </td>
                          <td className="px-2 py-2 text-right" style={{ color: 'var(--text-subtle)', fontSize: 10 }}>—</td>
                          <td className="px-2 py-2 text-right" style={{ color: 'var(--text-muted)', fontSize: 10 }}>{sku.attractiveness}</td>
                          <td className="px-2 py-2 text-right" style={{ color: 'var(--text-muted)', fontSize: 10 }}>{fmt(sku.revenue)}</td>
                          <td className="px-2 py-2 text-center">
                            {sku.season_months.some(v => v > 0)
                              ? <MiniSparkline values={sku.season_months} />
                              : <span style={{ color: 'var(--text-subtle)', fontSize: 10 }}>—</span>}
                          </td>
                          <td className="px-2 py-2 text-right" style={{ color: 'var(--text-subtle)', fontSize: 10 }}>
                            {sku.season_start ? MONTHS[sku.season_start - 1] : '—'}
                          </td>
                          <td className="px-2 py-2 text-right font-semibold" style={{ color: sku.season_peak ? 'var(--accent)' : 'var(--text-subtle)', fontSize: 10 }}>
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

                {!loading && sortedRows.length === 0 && (
                  <tr>
                    <td colSpan={11} className="px-4 py-12 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                      {hasFilter
                        ? 'Нет ниш по заданным фильтрам — попробуйте сбросить фильтры'
                        : 'Нет данных. Загрузите каталог и ABC-анализ через вкладку «Обновление данных».'}
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
