'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
  BarChart, Bar, ComposedChart
} from 'recharts'
import { GlassCard } from '@/components/ui/GlassCard'
import { KPIBar } from '@/components/ui/KPIBar'
import { FilterBar } from '@/components/ui/FilterBar'
import { exportToExcel } from '@/lib/exportExcel'
import { ChevronUp, ChevronDown, ChevronRight } from 'lucide-react'
import { useDateRange } from '@/components/ui/DateRangePicker'
import { priceTabCache } from '@/lib/tabCache'
import { useGlobalFilters } from '@/app/dashboard/page'

interface FunnelKpi {
  ctr: number
  cr_basket: number
  cr_order: number
  cpc: number
  cpm: number
  ad_order_share: number
  drr: number
  cpo: number
}

interface PriceData {
  funnel: FunnelKpi
  prev_funnel?: FunnelKpi
  daily: Array<{
    date: string
    ctr: number
    cr_basket: number
    cr_order: number
    ad_revenue: number
    organic_revenue: number
    avg_price?: number | null
  }>
  price_changes: Array<{
    sku: string
    name: string
    manager: string
    date: string
    price_before: number
    price_after: number
    delta_pct: number
    has_change: boolean
    delta_ctr?: number
    delta_cr_basket?: number
    delta_cr_order?: number
    cpo?: number
    delta_cpm?: number
    delta_cpc?: number
    ad_spend_before?: number
    ad_spend_after?: number
    delta_ad_spend?: number
  }>
  manager_table?: Array<{
    manager: string
    ctr: number
    cr_order: number
    ad_order_share: number
    revenue: number
    sku_count: number
  }>
}

function fmt(n: number | null | undefined) {
  if (n == null) return '—'
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'М'
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(0) + 'К'
  return n.toFixed(0)
}
function fmtRub(n: number | null | undefined) {
  if (n == null) return '—'
  return Math.round(n).toLocaleString('ru-RU') + ' ₽'
}
function fmtDate(iso: string) {
  const d = new Date(iso)
  return `${d.getDate().toString().padStart(2,'0')}.${(d.getMonth()+1).toString().padStart(2,'0')}`
}

function calcDelta(curr: number | null | undefined, prev: number | null | undefined) {
  if (curr == null || prev == null || prev === 0) return undefined
  return ((curr - prev) / Math.abs(prev)) * 100
}

function ChartTip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="glass p-3 text-xs min-w-[130px]" style={{ color: 'var(--text)' }}>
      <p className="font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>{label}</p>
      {payload.map(p => (
        <div key={p.name} className="flex items-center gap-2 mb-1">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span style={{ color: 'var(--text-muted)' }}>{p.name}:</span>
          <span className="font-bold ml-auto">
            {p.name.includes('%') || p.name === 'CTR' || p.name === 'CR корзина' || p.name === 'CR заказ'
              ? p.value.toFixed(2) + '%'
              : fmt(p.value)}
          </span>
        </div>
      ))}
    </div>
  )
}

function DeltaBadge({ v, invert = false }: { v?: number; invert?: boolean }) {
  if (v == null) return null
  const isPositive = v > 0
  const isGood = invert ? !isPositive : isPositive
  return (
    <span
      className="text-[10px] font-semibold px-1 py-0.5 rounded"
      style={{
        color: isGood ? 'var(--success)' : 'var(--danger)',
        background: isGood ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
      }}
    >
      {isPositive ? '+' : ''}{v.toFixed(1)}%
    </span>
  )
}

// v — абсолютная разность долей (напр. 0.01 = +1 п.п.)
// Показываем как %: +1.00п.п. → если хотим % нужна база. Показываем п.п. но с явным знаком
function DeltaCell({ v }: { v?: number }) {
  if (v == null) return <span style={{ color: 'var(--text-subtle)' }}>—</span>
  const up = v > 0
  const pct = (v * 100).toFixed(2)
  return (
    <span className="text-xs font-semibold" style={{ color: up ? 'var(--success)' : 'var(--danger)' }}>
      {up ? '+' : ''}{pct}%
    </span>
  )
}

function SortTh({ label, sk, align = 'right', sortKey, sortDir, onSort }: {
  label: string; sk: string; align?: 'left' | 'right'
  sortKey: string; sortDir: 'asc' | 'desc'; onSort: (k: string) => void
}) {
  const active = sortKey === sk
  return (
    <th className={`text-${align} pb-3 pt-2 font-medium cursor-pointer select-none whitespace-nowrap`} style={{ color: active ? 'var(--accent)' : 'var(--text)' }} onClick={() => onSort(sk)}>
      <span className={`inline-flex items-center gap-0.5 ${align === 'right' ? 'justify-end' : ''}`}>
        {label}
        {active ? (sortDir === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />) : <ChevronUp size={11} style={{ opacity: 0.3 }} />}
      </span>
    </th>
  )
}

// ── Client-side cache (shared module, survives tab switches) ──────────────────
const priceCache = priceTabCache as Map<string, PriceData>

export default function PriceTab() {
  const { range } = useDateRange()
  const { filters } = useGlobalFilters()
  // Cache key includes global filters
  function makeCacheKey() {
    const p = new URLSearchParams({ from: range.from, to: range.to })
    if (filters.category) p.set('category', filters.category)
    if (filters.manager)  p.set('manager', filters.manager)
    if (filters.novelty)  p.set('novelty', filters.novelty)
    return p.toString()
  }
  // Initialize from cache immediately — no loading flash on tab switch
  const [data, setData] = useState<PriceData | null>(() =>
    priceCache.get(makeCacheKey()) ?? null
  )
  const [loading, setLoading] = useState(() =>
    !priceCache.has(makeCacheKey())
  )
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [priceFilter, setPriceFilter] = useState<Record<string, string>>({
    direction: 'all', ctr_delta: 'all', cr_delta: 'all', cpo: 'all', show: 'changes',
  })
  const [sortKey, setSortKey] = useState<string>('date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [expandedManager, setExpandedManager] = useState<string | null>(null)
  const [pageSize, setPageSize] = useState<50 | 100 | 0>(50)
  const [page, setPage] = useState(0)
  const filterBarRef = useRef<HTMLDivElement>(null)
  const [stickyTop, setStickyTop] = useState({ filterRow: 88, thead: 88 + 52 })

  useEffect(() => {
    function measure() {
      const header = document.querySelector('header.top-nav') as HTMLElement | null
      const filterBar = filterBarRef.current
      const headerH = header ? header.getBoundingClientRect().height : 88
      const filterH = filterBar ? filterBar.getBoundingClientRect().height : 52
      setStickyTop({ filterRow: headerH, thead: headerH + filterH })
    }
    const t = setTimeout(() => requestAnimationFrame(measure), 100)
    window.addEventListener('resize', measure)
    return () => { clearTimeout(t); window.removeEventListener('resize', measure) }
  }, [])

  function toggleSort(key: string) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  // Must be BEFORE early returns (loading/error/null) — Rules of Hooks
  useEffect(() => { setPage(0) }, [search, priceFilter, sortKey, sortDir])

  useEffect(() => {
    const params = new URLSearchParams({ from: range.from, to: range.to })
    if (filters.category) params.set('category', filters.category)
    if (filters.manager)  params.set('manager', filters.manager)
    if (filters.novelty)  params.set('novelty', filters.novelty)
    const cacheKey = params.toString()
    const hit = priceCache.get(cacheKey)
    if (hit) { setData(hit); setLoading(false); return }

    setLoading(true)
    setError(null)
    fetch(`/api/dashboard/prices?${params}`)
      .then(r => {
        if (!r.ok) return r.json().then(e => Promise.reject(new Error(e?.error ?? `HTTP ${r.status}`)))
        return r.json()
      })
      .then((d: PriceData & { error?: string }) => {
        if (d.error) { setError(d.error); setLoading(false); return }
        if (!d.funnel) { setError('Неверный формат ответа API'); setLoading(false); return }
        priceCache.set(cacheKey, d as PriceData)
        setData(d as PriceData)
        setLoading(false)
      })
      .catch((e: unknown) => { setError(String(e)); setLoading(false) })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.from, range.to, filters.category, filters.manager, filters.novelty])

  if (loading) return (
    <div className="px-6 py-6 space-y-6">
      <KPIBar loading items={[
        { label: 'CTR', value: '' }, { label: 'CR в корзину', value: '' },
        { label: 'CR в заказ', value: '' }, { label: 'Доля рекл. заказов', value: '' },
        { label: 'CPO', value: '' },
      ]} />
    </div>
  )
  if (error) return <div className="px-6 py-16 text-center" style={{ color: 'var(--danger)' }}>{error}</div>
  if (!data) return null

  const f = data.funnel
  const pf = data.prev_funnel
  const priceChanges = data.price_changes ?? []
  const managerTable = data.manager_table ?? []
  const hasFilter = Object.entries(priceFilter).some(([k, v]) => k === 'show' ? v !== 'changes' : v !== 'all') || search.trim() !== ''

  const filteredPrices = priceChanges.filter(row => {
    if (priceFilter.show === 'changes' && !row.has_change) return false
    if (search && !row.name.toLowerCase().includes(search.toLowerCase()) && !row.sku.includes(search)) return false
    if (row.has_change) {
      if (priceFilter.direction === 'up' && row.delta_pct <= 0) return false
      if (priceFilter.direction === 'down' && row.delta_pct >= 0) return false
      if (priceFilter.ctr_delta === 'up' && (row.delta_ctr == null || row.delta_ctr <= 0)) return false
      if (priceFilter.ctr_delta === 'down' && (row.delta_ctr == null || row.delta_ctr >= 0)) return false
      if (priceFilter.cr_delta === 'up' && (row.delta_cr_order == null || row.delta_cr_order <= 0)) return false
      if (priceFilter.cr_delta === 'down' && (row.delta_cr_order == null || row.delta_cr_order >= 0)) return false
      if (priceFilter.cpo === 'over200' && (row.cpo == null || row.cpo <= 200)) return false
      if (priceFilter.cpo === 'under200' && (row.cpo == null || row.cpo > 200)) return false
    }
    return true
  }).sort((a, b) => {
    const mult = sortDir === 'asc' ? 1 : -1
    type PriceRow = typeof a
    const key = sortKey as keyof PriceRow
    const av = a[key]; const bv = b[key]
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * mult
    return String(av ?? '').localeCompare(String(bv ?? '')) * mult
  })


  const pagedPrices = pageSize === 0
    ? filteredPrices
    : filteredPrices.slice(page * pageSize, (page + 1) * pageSize)
  const totalPricePages = pageSize === 0 ? 1 : Math.ceil(filteredPrices.length / pageSize)

  function exportPrices() {
    exportToExcel(filteredPrices.map(r => ({
      'SKU': r.sku, 'Название': r.name, 'Менеджер': r.manager, 'Дата': r.date,
      'Было': r.price_before, 'Стало': r.price_after, 'Δ%': r.delta_pct.toFixed(1),
      'Δ CTR (п.п.)': r.delta_ctr != null ? (r.delta_ctr * 100).toFixed(2) : '',
      'Δ CR корзина (п.п.)': r.delta_cr_basket != null ? (r.delta_cr_basket * 100).toFixed(2) : '',
      'Δ CR заказ (п.п.)': r.delta_cr_order != null ? (r.delta_cr_order * 100).toFixed(2) : '',
      'CPO': r.cpo != null ? r.cpo.toFixed(0) : '',
      'Расходы до, ₽': r.ad_spend_before ?? '',
      'Расходы после, ₽': r.ad_spend_after ?? '',
      'Δ расходов, ₽': r.delta_ad_spend ?? '',
    })), 'Цены_изменения')
  }

  const dailyFmt = (data.daily ?? []).map(d => ({
    date: fmtDate(d.date),
    'CTR': +(d.ctr * 100).toFixed(2),
    'CR корзина': +(d.cr_basket * 100).toFixed(2),
    'CR заказ': +(d.cr_order * 100).toFixed(2),
    'Рекламные': d.ad_revenue,
    'Органические': d.organic_revenue,
    'Цена ср.': d.avg_price ?? null,
  }))

  // KPI дельты
  const dCtr = calcDelta(f.ctr, pf?.ctr)
  const dCrBasket = calcDelta(f.cr_basket, pf?.cr_basket)
  const dCrOrder = calcDelta(f.cr_order, pf?.cr_order)
  const dAdShare = calcDelta(f.ad_order_share, pf?.ad_order_share)
  const dCpo = calcDelta(f.cpo, pf?.cpo)

  return (
    <div className="px-6 py-6 space-y-6">

      {/* KPI bar — 5 карточек */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
        {([
          { label: 'CTR', value: f.ctr != null ? (f.ctr * 100).toFixed(2) + '%' : '—', delta: dCtr, invert: false },
          { label: 'CR в корзину', value: f.cr_basket != null ? (f.cr_basket * 100).toFixed(2) + '%' : '—', delta: dCrBasket, invert: false },
          { label: 'CR в заказ', value: f.cr_order != null ? (f.cr_order * 100).toFixed(2) + '%' : '—', delta: dCrOrder, invert: false },
          { label: 'Доля рекл. заказов', value: f.ad_order_share != null ? (f.ad_order_share * 100).toFixed(1) + '%' : '—', delta: dAdShare, invert: false },
          { label: 'CPO', value: f.cpo != null ? fmt(f.cpo) + ' ₽' : '—', delta: dCpo, invert: true },
        ] as const).map(item => (
          <GlassCard key={item.label} padding="md">
            <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>{item.label}</p>
            <p className="text-xl font-bold" style={{ color: 'var(--text)' }}>{item.value}</p>
            {item.delta != null && (
              <div className="mt-1">
                <DeltaBadge v={item.delta} invert={item.invert} />
              </div>
            )}
          </GlassCard>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Воронка конверсий + средневзвешенная цена (правая ось) */}
        <GlassCard padding="lg">
          <p className="text-sm font-semibold mb-4" style={{ color: 'var(--text)' }}>Воронка конверсий по дням</p>
          {dailyFmt.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart data={dailyFmt} margin={{ top: 4, right: 48, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.6} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis yAxisId="left" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} width={36} tickFormatter={v => `${v}%`} />
                <YAxis yAxisId="right" orientation="right" domain={['auto', 'auto']} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} width={52} tickFormatter={v => Math.round(v as number).toLocaleString('ru-RU')} />
                <Tooltip content={(p) => <ChartTip active={p.active} payload={p.payload as unknown as Array<{ name: string; value: number; color: string }>} label={p.label != null ? String(p.label) : undefined} />} />
                <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                <Line yAxisId="left" type="monotone" dataKey="CTR" stroke="var(--info)" strokeWidth={2} dot={false} />
                <Line yAxisId="left" type="monotone" dataKey="CR корзина" stroke="var(--warning)" strokeWidth={2} dot={false} />
                <Line yAxisId="left" type="monotone" dataKey="CR заказ" stroke="var(--success)" strokeWidth={2} dot={false} />
                <Line yAxisId="right" type="monotone" dataKey="Цена ср." stroke="var(--accent)" strokeWidth={2} dot={false} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          ) : <div className="flex items-center justify-center h-56 text-sm" style={{ color: 'var(--text-muted)' }}>Нет данных</div>}
        </GlassCard>

        <GlassCard padding="lg">
          <p className="text-sm font-semibold mb-4" style={{ color: 'var(--text)' }}>Рекламные vs Органические продажи</p>
          {dailyFmt.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={dailyFmt} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.6} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} width={44} tickFormatter={v => fmt(v as number)} />
                <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} content={(p) => <ChartTip active={p.active} payload={p.payload as unknown as Array<{ name: string; value: number; color: string }>} label={p.label != null ? String(p.label) : undefined} />} />
                <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="Рекламные" fill="var(--accent)" radius={[4,4,0,0]} activeBar={{ fill: 'rgba(99,102,241,0.5)', stroke: 'none' }} />
                <Bar dataKey="Органические" fill="var(--info)" radius={[4,4,0,0]} activeBar={{ fill: 'rgba(59,130,246,0.5)', stroke: 'none' }} />
              </BarChart>
            </ResponsiveContainer>
          ) : <div className="flex items-center justify-center h-56 text-sm" style={{ color: 'var(--text-muted)' }}>Нет данных</div>}
        </GlassCard>
      </div>

      {/* Таблица менеджеров */}
      {managerTable.length > 0 && (
        <GlassCard padding="lg">
          <p className="text-sm font-semibold mb-4" style={{ color: 'var(--text)' }}>По менеджерам</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs border-b" style={{ borderColor: 'var(--border)', color: 'var(--text)', fontWeight: 600 }}>
                  <th className="text-left pb-2 font-medium">Менеджер</th>
                  <th className="text-right pb-2 font-medium">CTR</th>
                  <th className="text-right pb-2 font-medium">CR заказ</th>
                  <th className="text-right pb-2 font-medium">Доля рекл.</th>
                  <th className="text-right pb-2 font-medium">Выручка</th>
                  <th className="text-right pb-2 font-medium">SKU</th>
                  <th className="text-right pb-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {managerTable.map(m => {
                  const isExpanded = expandedManager === m.manager
                  const mgrChanges = filteredPrices.filter(r => r.manager === m.manager)
                  return (
                    <>
                      <tr
                        key={m.manager}
                        className="border-t cursor-pointer hover:bg-white/5 transition-colors"
                        style={{ borderColor: 'var(--border)' }}
                        onClick={() => setExpandedManager(isExpanded ? null : m.manager)}
                      >
                        <td className="py-2 pr-4 font-medium" style={{ color: 'var(--text)' }}>{m.manager || '—'}</td>
                        <td className="py-2 text-right text-xs" style={{ color: 'var(--text-muted)' }}>{(m.ctr * 100).toFixed(2)}%</td>
                        <td className="py-2 text-right text-xs" style={{ color: 'var(--text-muted)' }}>{(m.cr_order * 100).toFixed(2)}%</td>
                        <td className="py-2 text-right text-xs" style={{ color: 'var(--text-muted)' }}>{(m.ad_order_share * 100).toFixed(1)}%</td>
                        <td className="py-2 text-right font-semibold text-xs" style={{ color: 'var(--text)' }}>{fmtRub(m.revenue)}</td>
                        <td className="py-2 text-right text-xs" style={{ color: 'var(--text-muted)' }}>{m.sku_count}</td>
                        <td className="py-2 text-right">
                          <ChevronRight
                            size={14}
                            style={{
                              color: 'var(--text-muted)',
                              transform: isExpanded ? 'rotate(90deg)' : 'none',
                              transition: 'transform 0.15s',
                              display: 'inline-block',
                            }}
                          />
                        </td>
                      </tr>
                      {isExpanded && mgrChanges.length > 0 && (
                        <tr key={`${m.manager}-exp`} style={{ borderColor: 'var(--border)' }}>
                          <td colSpan={7} className="pb-3 pt-0">
                            <div className="rounded-lg overflow-x-auto" style={{ background: 'var(--surface-popup)', border: '1px solid var(--border)' }}>
                              <table className="w-full text-xs">
                                <thead>
                                  <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-subtle)' }}>
                                    <th className="text-left px-3 py-2 font-medium">SKU</th>
                                    <th className="text-left px-3 py-2 font-medium">Название</th>
                                    <th className="text-right px-3 py-2 font-medium">Дата</th>
                                    <th className="text-right px-3 py-2 font-medium">Было</th>
                                    <th className="text-right px-3 py-2 font-medium">Стало</th>
                                    <th className="text-right px-3 py-2 font-medium">Δ%</th>
                                    <th className="text-right px-3 py-2 font-medium">Δ CTR</th>
                                    <th className="text-right px-3 py-2 font-medium">Δ CR заказ</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {mgrChanges.slice(0, 20).map((row, i) => {
                                    const up = row.delta_pct > 0
                                    return (
                                      <tr key={i} style={{ borderTop: i > 0 ? '1px solid var(--border)' : undefined }}>
                                        <td className="px-3 py-1.5 font-mono" style={{ color: 'var(--text-muted)' }}>{row.sku}</td>
                                        <td className="px-3 py-1.5 max-w-[160px] truncate" style={{ color: 'var(--text)' }}>{row.name}</td>
                                        <td className="px-3 py-1.5 text-right" style={{ color: 'var(--text-muted)' }}>{fmtDate(row.date)}</td>
                                        <td className="px-3 py-1.5 text-right" style={{ color: 'var(--text-muted)' }}>{fmtRub(row.price_before)}</td>
                                        <td className="px-3 py-1.5 text-right font-semibold" style={{ color: 'var(--text)' }}>{fmtRub(row.price_after)}</td>
                                        <td className="px-3 py-1.5 text-right"><span className="font-semibold" style={{ color: up ? 'var(--success)' : 'var(--danger)' }}>{up ? '+' : ''}{(row.delta_pct * 100).toFixed(1)}%</span></td>
                                        <td className="px-3 py-1.5 text-right"><DeltaCell v={row.delta_ctr} /></td>
                                        <td className="px-3 py-1.5 text-right"><DeltaCell v={row.delta_cr_order} /></td>
                                      </tr>
                                    )
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  )
                })}
              </tbody>
            </table>
          </div>
        </GlassCard>
      )}

      {/* Таблица изменений цен */}
      <GlassCard padding="none" style={{ isolation: 'auto' }}>
        {/* Sticky filter bar */}
        <div
          ref={filterBarRef}
          className="px-4 py-3 border-b"
          style={{
            position: 'sticky',
            top: stickyTop.filterRow,
            zIndex: 20,
            background: 'var(--surface-solid)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            borderColor: 'var(--border)',
          }}
        >
          <FilterBar
            search={search}
            onSearch={setSearch}
            searchPlaceholder="Поиск по названию или SKU..."
            filters={[
              { label: 'Показать', key: 'show', options: [
                { value: 'changes', label: 'С изменением' },
                { value: 'all', label: 'Все SKU' },
              ]},
              { label: 'Δ Цены', key: 'direction', options: [
                { value: 'all', label: 'Все' },
                { value: 'up', label: '↑ Рост' },
                { value: 'down', label: '↓ Снижение' },
              ]},
              { label: 'Δ CTR', key: 'ctr_delta', options: [
                { value: 'all', label: 'Все' },
                { value: 'up', label: '↑ Вырос' },
                { value: 'down', label: '↓ Упал' },
              ]},
              { label: 'Δ CR заказ', key: 'cr_delta', options: [
                { value: 'all', label: 'Все' },
                { value: 'up', label: '↑ Вырос' },
                { value: 'down', label: '↓ Упал' },
              ]},
              { label: 'CPO', key: 'cpo', options: [
                { value: 'all', label: 'Все' },
                { value: 'over200', label: '> 200 ₽' },
                { value: 'under200', label: '≤ 200 ₽' },
              ]},
            ]}
            values={priceFilter}
            onChange={(k, v) => setPriceFilter(f => ({ ...f, [k]: v }))}
            onReset={() => { setPriceFilter({ direction: 'all', ctr_delta: 'all', cr_delta: 'all', cpo: 'all', show: 'changes' }); setSearch('') }}
            hasActive={hasFilter}
            onExport={exportPrices}
            summary={<span className="text-xs" style={{ color: 'var(--text-muted)' }}>Изменения цен · {filteredPrices.length}</span>}
          />
        </div>
        <div style={{ overflowX: 'clip', padding: '0 1rem' }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs" style={{ position: 'sticky', top: stickyTop.thead, zIndex: 10, background: 'var(--surface-solid)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', color: 'var(--text)', fontWeight: 600 }}>
                <th className="text-left pb-3 pt-2 font-medium">SKU</th>
                <th className="text-left pb-3 pt-2 font-medium">Название</th>
                <th className="text-left pb-3 pt-2 font-medium">Менеджер</th>
                <SortTh label="Дата" sk="date" align="right" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortTh label="Было" sk="price_before" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortTh label="Стало" sk="price_after" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortTh label="Δ%" sk="delta_pct" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortTh label="Δ CTR" sk="delta_ctr" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortTh label="Δ CR корз." sk="delta_cr_basket" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortTh label="Δ CR заказ" sk="delta_cr_order" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortTh label="CPO" sk="cpo" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortTh label="Расх. до" sk="ad_spend_before" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortTh label="Расх. после" sk="ad_spend_after" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortTh label="Δ расходов" sk="delta_ad_spend" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              </tr>
            </thead>
            <tbody>
              {pagedPrices.map((row, i) => {
                const up = row.delta_pct > 0
                return (
                  <tr key={i} className="border-t" style={{ borderColor: 'var(--border)' }}>
                    <td className="py-2 pr-2 font-mono text-xs" style={{ color: 'var(--text-muted)' }}>{row.sku}</td>
                    <td className="py-2 pr-4 max-w-[160px] truncate" style={{ color: 'var(--text)' }}>{row.name}</td>
                    <td className="py-2 pr-4" style={{ color: 'var(--text-muted)' }}>{row.manager || '—'}</td>
                    <td className="py-2 text-right text-xs" style={{ color: 'var(--text-muted)' }}>{row.date ? fmtDate(row.date) : '—'}</td>
                    <td className="py-2 text-right" style={{ color: 'var(--text-muted)' }}>{row.price_before ? fmtRub(row.price_before) : '—'}</td>
                    <td className="py-2 text-right font-semibold" style={{ color: 'var(--text)' }}>{row.price_after ? fmtRub(row.price_after) : '—'}</td>
                    <td className="py-2 text-right">
                      {row.has_change
                        ? <span className="text-xs font-semibold" style={{ color: up ? 'var(--success)' : 'var(--danger)' }}>{up ? '+' : ''}{(row.delta_pct * 100).toFixed(1)}%</span>
                        : <span style={{ color: 'var(--text-subtle)' }}>—</span>
                      }
                    </td>
                    <td className="py-2 text-right">{row.has_change ? <DeltaCell v={row.delta_ctr} /> : <span style={{ color: 'var(--text-subtle)' }}>—</span>}</td>
                    <td className="py-2 text-right">{row.has_change ? <DeltaCell v={row.delta_cr_basket} /> : <span style={{ color: 'var(--text-subtle)' }}>—</span>}</td>
                    <td className="py-2 text-right">{row.has_change ? <DeltaCell v={row.delta_cr_order} /> : <span style={{ color: 'var(--text-subtle)' }}>—</span>}</td>
                    <td className="py-2 text-right" style={{ color: 'var(--text-muted)' }}>{row.has_change && row.cpo != null ? fmt(row.cpo) + ' ₽' : '—'}</td>
                    <td className="py-2 text-right" style={{ color: 'var(--text-muted)' }}>{row.has_change && row.ad_spend_before != null ? fmtRub(row.ad_spend_before) : '—'}</td>
                    <td className="py-2 text-right" style={{ color: 'var(--text-muted)' }}>{row.has_change && row.ad_spend_after != null ? fmtRub(row.ad_spend_after) : '—'}</td>
                    <td className="py-2 text-right">
                      {row.has_change && row.delta_ad_spend != null
                        ? <span className="text-xs font-semibold" style={{ color: row.delta_ad_spend > 0 ? 'var(--danger)' : 'var(--success)' }}>
                            {row.delta_ad_spend > 0 ? '+' : ''}{fmtRub(row.delta_ad_spend)}
                          </span>
                        : <span style={{ color: 'var(--text-subtle)' }}>—</span>
                      }
                    </td>
                  </tr>
                )
              })}
              {filteredPrices.length === 0 && (
                <tr><td colSpan={14} className="py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Нет изменений цен за выбранный период</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {filteredPrices.length > 0 && (
          <div className="flex items-center gap-3 px-4 py-3 border-t" style={{ borderColor: 'var(--border)' }}>
            <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              {pageSize === 0
                ? `${filteredPrices.length} строк`
                : `${Math.min(page * pageSize + 1, filteredPrices.length)}–${Math.min((page + 1) * pageSize, filteredPrices.length)} из ${filteredPrices.length}`}
            </span>
            <div className="flex gap-1">
              {([50, 100, 0] as const).map(n => (
                <button key={n} onClick={() => { setPageSize(n); setPage(0) }}
                  className="px-2 py-0.5 rounded text-[11px] font-medium"
                  style={{ background: pageSize === n ? 'var(--accent-glass)' : 'var(--surface)', border: '1px solid ' + (pageSize === n ? 'var(--accent)' : 'var(--border)'), color: pageSize === n ? 'var(--accent)' : 'var(--text-muted)' }}>
                  {n === 0 ? 'Все' : n}
                </button>
              ))}
            </div>
            {totalPricePages > 1 && (
              <div className="flex gap-1 ml-auto">
                {Array.from({ length: Math.min(totalPricePages, 20) }, (_, i) => (
                  <button key={i} onClick={() => setPage(i)}
                    className="w-7 h-6 rounded text-[11px] font-medium"
                    style={{ background: page === i ? 'var(--accent)' : 'var(--surface)', border: '1px solid ' + (page === i ? 'var(--accent)' : 'var(--border)'), color: page === i ? '#fff' : 'var(--text-muted)' }}>
                    {i + 1}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

      </GlassCard>
    </div>
  )
}
