'use client'

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { orderTabCache } from '@/lib/tabCache'
import { GlassCard } from '@/components/ui/GlassCard'
import { KPIBar } from '@/components/ui/KPIBar'
import { FilterBar } from '@/components/ui/FilterBar'
import { exportToExcel } from '@/lib/exportExcel'
import { AlertTriangle, Package, AlertCircle, PackageOpen, ChevronUp, ChevronDown } from 'lucide-react'
import { OrderCalcDetails, type OrderRowDetails } from '@/components/ui/OrderCalcDetails'
import { StockTrendChart } from '@/components/ui/StockTrendChart'
import { PlanVsFactChart } from '@/components/ui/PlanVsFactChart'
import { ForecastChart } from '@/components/ui/ForecastChart'
import { SeasonalityHeatmap, type HeatmapRow } from '@/components/ui/SeasonalityHeatmap'
import { useDateRange } from '@/components/ui/DateRangePicker'
import { useGlobalFilters } from '@/app/dashboard/page'

interface OrderRow extends OrderRowDetails {
  sku_ms: string
  sku_wb: number | string
  name: string
  brand: string
  subject_wb: string
  manager: string | null
  status: 'critical' | 'warning' | 'ok'
  abc_class: string | null
  profitability: number | null
  margin_pct: number | null
  gmroi: number | null
  cost_plan: number | null
  price: number | null
  dpd: number
  stock_days: number
  oos_days_31: number
  forecast_30d: number
  manager_order: number
  delta_order: number
  svod_order_qty: number
  period_revenue: number
  prev_period_revenue: number
  delta_revenue_pct: number | null
}

interface OrderData {
  summary: {
    critical_count: number
    warning_count: number
    oos_with_demand: number
    to_order_count: number
    order_sum_rub: number
    order_sum_rub_calc: number
    order_qty_calc: number
    order_sum_rub_svod: number
    order_qty_svod: number
    total_stock_qty: number
    total_stock_rub: number
    velocity_avg: number
    turnover_days_avg: number
    forecast_30d_total: number
    period_revenue_total: number
    prev_period_revenue_total: number
  }
  rows: OrderRow[]
  heatmap_rows?: HeatmapRow[]
  latest_date: string | null
  latest_snap: string | null
  period: number
  horizon: number
  period_from: string | null
  period_to: string | null
}

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
function fmtRub(n: number | null | undefined) {
  if (n == null) return '—'
  return Math.round(n).toLocaleString('ru-RU') + ' ₽'
}

function SortTh({ label, sk, align = 'right', sortKey, sortDir, onSort }: {
  label: string; sk: string; align?: 'left' | 'right' | 'center'
  sortKey: string; sortDir: 'asc' | 'desc'; onSort: (k: string) => void
}) {
  const active = sortKey === sk
  return (
    <th className={`text-${align} pb-3 pt-2 px-2 font-medium cursor-pointer select-none whitespace-nowrap text-xs`}
        style={{ color: active ? 'var(--accent)' : 'var(--text)' }}
        onClick={() => onSort(sk)}>
      <span className={`inline-flex items-center gap-0.5 ${align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : ''}`}>
        {label}
        {active ? (sortDir === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />) : <ChevronUp size={11} style={{ opacity: 0.3 }} />}
      </span>
    </th>
  )
}

const statusCfg = {
  critical: { label: 'Крит.',    color: 'var(--danger)',  bg: 'var(--danger-bg)' },
  warning:  { label: 'Внимание', color: 'var(--warning)', bg: 'var(--warning-bg)' },
  ok:       { label: 'Норма',    color: 'var(--success)', bg: 'var(--success-bg)' },
}

// Module-shared cache (typed)
const orderCache = orderTabCache as Map<string, OrderData>

export default function OrderTab() {
  const { range } = useDateRange()
  const { filters } = useGlobalFilters()

  function makeCacheKey(p?: { period?: string; horizon?: string }) {
    const params = new URLSearchParams({
      from: range.from, to: range.to,
      horizon: p?.horizon ?? '60',
      period:  p?.period  ?? '31',
    })
    if (filters.category) params.set('category', filters.category)
    if (filters.manager)  params.set('manager',  filters.manager)
    if (filters.novelty)  params.set('novelty',  filters.novelty)
    return params.toString()
  }

  const [orderFilter, setOrderFilter] = useState<Record<string, string>>({
    status: 'all', abc: 'all', horizon: '60', period: '31',
    only_to_order: 'all', only_oos_demand: 'all',
  })
  const [activeKpi, setActiveKpi] = useState<'critical' | 'warning' | 'oos_demand' | 'to_order' | null>(null)

  const initialKey = makeCacheKey({ period: orderFilter.period, horizon: orderFilter.horizon })
  const [data, setData] = useState<OrderData | null>(() => orderCache.get(initialKey) ?? null)
  const [loading, setLoading] = useState(() => !orderCache.has(initialKey))
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [expandedSku, setExpandedSku] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<string>('calc_order')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [pageSize, setPageSize] = useState<50 | 100 | 0>(50)
  const [page, setPage] = useState(0)

  const filterBarRef = useRef<HTMLDivElement>(null)
  const [stickyTop, setStickyTop] = useState({ filterBar: 88, thead: 88 + 56 })

  useEffect(() => {
    function measure() {
      const header = document.querySelector('header.top-nav') as HTMLElement | null
      const headerH = header ? header.getBoundingClientRect().height : 88
      const filterH = filterBarRef.current ? filterBarRef.current.getBoundingClientRect().height : 56
      setStickyTop({ filterBar: headerH, thead: headerH + filterH })
    }
    const t = setTimeout(() => requestAnimationFrame(measure), 100)
    window.addEventListener('resize', measure)
    return () => { clearTimeout(t); window.removeEventListener('resize', measure) }
  }, [])

  function toggleSort(key: string) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  // Reset page on filter/sort change
  useEffect(() => { setPage(0) }, [search, orderFilter, sortKey, sortDir, activeKpi])

  useEffect(() => {
    const key = makeCacheKey({ period: orderFilter.period, horizon: orderFilter.horizon })
    const hit = orderCache.get(key)
    if (hit) { setData(hit); setLoading(false); return }

    setLoading(true); setError(null)
    fetch(`/api/dashboard/orders?${key}`)
      .then(r => {
        if (!r.ok) return r.json().then(e => Promise.reject(new Error(e?.error ?? `HTTP ${r.status}`)))
        return r.json()
      })
      .then((d: OrderData) => {
        orderCache.set(key, d)
        setData(d); setLoading(false)
      })
      .catch((e: unknown) => { setError(String(e)); setLoading(false) })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.from, range.to, filters.category, filters.manager, filters.novelty, orderFilter.period, orderFilter.horizon])

  const heatmapRows: HeatmapRow[] = useMemo(() => data?.heatmap_rows ?? [], [data?.heatmap_rows])

  if (loading && !data) return (
    <div className="px-6 py-6 space-y-6">
      <KPIBar loading items={Array(4).fill({ label: '', value: '' })} />
    </div>
  )
  if (error) return <div className="px-6 py-16 text-center" style={{ color: 'var(--danger)' }}>{error}</div>
  if (!data) return null

  const s = data.summary
  const hasFilter = search.trim() !== ''
    || orderFilter.status !== 'all'
    || orderFilter.abc !== 'all'
    || orderFilter.only_to_order !== 'all'
    || orderFilter.only_oos_demand !== 'all'
    || activeKpi !== null

  const filteredRows = (data.rows ?? []).filter(row => {
    if (search) {
      const q = search.toLowerCase()
      if (!row.name.toLowerCase().includes(q) && !String(row.sku_wb).includes(search) && !row.sku_ms.toLowerCase().includes(q)) return false
    }
    if (orderFilter.status !== 'all' && row.status !== orderFilter.status) return false
    if (orderFilter.abc !== 'all' && (row.abc_class ?? '').charAt(0) !== orderFilter.abc) return false
    if (orderFilter.only_to_order === 'with' && row.calc_order <= 0 && row.svod_order_qty <= 0) return false
    if (orderFilter.only_oos_demand === 'with' && !(row.total_stock === 0 && row.sales_qty_31d > 0)) return false
    return true
  }).sort((a, b) => {
    const av = a[sortKey as keyof OrderRow] as number | string | null | undefined
    const bv = b[sortKey as keyof OrderRow] as number | string | null | undefined
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * (sortDir === 'asc' ? 1 : -1)
    return String(av ?? '').localeCompare(String(bv ?? '')) * (sortDir === 'asc' ? 1 : -1)
  })

  const pagedRows = pageSize === 0
    ? filteredRows
    : filteredRows.slice(page * pageSize, (page + 1) * pageSize)
  const totalPages = pageSize === 0 ? 1 : Math.ceil(filteredRows.length / pageSize)

  // Сумма выручки видимых строк
  const visibleRevenue = filteredRows.reduce((sum, r) => sum + r.period_revenue, 0)
  const visiblePrevRevenue = filteredRows.reduce((sum, r) => sum + r.prev_period_revenue, 0)
  const visibleRevenueDelta = visiblePrevRevenue > 0
    ? (visibleRevenue - visiblePrevRevenue) / visiblePrevRevenue * 100
    : null

  function exportOrders() {
    exportToExcel(filteredRows.map(r => ({
      'SKU WB': r.sku_wb,
      'SKU МС': r.sku_ms,
      'Название': r.name,
      'Категория': r.subject_wb,
      'Менеджер': r.manager,
      'Статус': r.status,
      'ABC': r.abc_class ?? '',
      'Продажи 7д (шт)': r.sales_qty_7d,
      'Продажи 14д (шт)': r.sales_qty_14d,
      'Продажи 31д (шт)': r.sales_qty_31d,
      'OOS дней (за 31д)': r.oos_days_31,
      'Наличие (шт)': r.total_stock,
      'В пути': r.in_transit,
      'В производстве': r.in_production,
      'Остаток дней': r.stock_days,
      'Лог. плечо (дн)': r.lead_time_days,
      'Расч. заказ (шт)': r.calc_order,
      'Заказ менеджера (шт)': r.svod_order_qty,
      'Δ заказа': r.delta_order,
      'Прогноз 30д (шт)': r.forecast_30d,
      'Выручка за период, ₽': r.period_revenue,
      'Δ выручки, %': r.delta_revenue_pct != null ? (r.delta_revenue_pct * 100).toFixed(1) : '',
      'Маржа %': r.margin_pct != null ? (r.margin_pct * 100).toFixed(1) : '',
      'GMROI': r.gmroi,
    })), 'Заказы')
  }

  function clickKpi(kpi: 'critical' | 'warning' | 'oos_demand' | 'to_order') {
    if (activeKpi === kpi) {
      setActiveKpi(null)
      setOrderFilter(f => ({ ...f, status: 'all', only_to_order: 'all', only_oos_demand: 'all' }))
      return
    }
    setActiveKpi(kpi)
    if (kpi === 'critical') setOrderFilter(f => ({ ...f, status: 'critical', only_to_order: 'all', only_oos_demand: 'all' }))
    else if (kpi === 'warning') setOrderFilter(f => ({ ...f, status: 'warning', only_to_order: 'all', only_oos_demand: 'all' }))
    else if (kpi === 'oos_demand') setOrderFilter(f => ({ ...f, status: 'all', only_to_order: 'all', only_oos_demand: 'with' }))
    else if (kpi === 'to_order') setOrderFilter(f => ({ ...f, status: 'all', only_to_order: 'with', only_oos_demand: 'all' }))
  }

  return (
    <div className="px-6 py-6 space-y-6">

      {/* ─── KPI блок 1 — 4 информационные карточки ──────────────────── */}
      <KPIBar items={[
        {
          label: 'Текущий остаток',
          value: fmt(s.total_stock_qty) + ' шт',
          hint: fmtRub(s.total_stock_rub),
        },
        {
          label: 'Скорость продаж',
          value: (s.velocity_avg > 0 ? s.velocity_avg.toFixed(1) : '0') + ' /дн',
          hint: 'среднее по всем SKU',
        },
        {
          label: 'Оборачиваемость',
          value: s.turnover_days_avg + ' дн',
          danger: s.turnover_days_avg > 0 && s.turnover_days_avg < 14,
          hint: 'остаток / скорость',
        },
        {
          label: 'Прогноз 30д',
          value: fmt(s.forecast_30d_total) + ' шт',
          hint: 'сезонность × velocity',
        },
      ]} />

      {/* ─── KPI блок 2 — 4 активные карточки-фильтры ────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {([
          {
            key: 'critical' as const,
            icon: <AlertCircle size={16} />,
            title: 'Критический запас',
            count: s.critical_count,
            color: 'var(--danger)',
            description: 'Запас < 50% лог. плеча',
          },
          {
            key: 'warning' as const,
            icon: <AlertTriangle size={16} />,
            title: 'Требует внимания',
            count: s.warning_count,
            color: 'var(--warning)',
            description: 'Запас < лог. плеча',
          },
          {
            key: 'oos_demand' as const,
            icon: <PackageOpen size={16} />,
            title: 'OOS с продажами',
            count: s.oos_with_demand,
            color: 'var(--danger)',
            description: 'Нет стока, есть спрос',
          },
          {
            key: 'to_order' as const,
            icon: <Package size={16} />,
            title: 'К заказу',
            count: s.to_order_count,
            color: 'var(--info)',
          },
        ]).map(item => {
          const isActive = activeKpi === item.key
          const isToOrder = item.key === 'to_order'
          return (
            <button
              key={item.key}
              onClick={() => clickKpi(item.key)}
              className="text-left p-4 rounded-xl transition-all hover:scale-[1.01]"
              style={{
                background: 'var(--surface-solid)',
                border: '1px solid ' + (isActive ? item.color : 'var(--border)'),
                boxShadow: isActive ? `0 0 0 2px ${item.color}40` : undefined,
              }}
            >
              <div className="flex items-center gap-2 mb-2">
                <span style={{ color: item.color }}>{item.icon}</span>
                <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>{item.title}</p>
              </div>
              <p className="text-3xl font-black mb-1" style={{ color: item.color, letterSpacing: '-0.03em' }}>
                {item.count}
              </p>
              {isToOrder ? (
                <div className="space-y-1 mt-2 text-[11px]">
                  <div className="flex items-baseline justify-between gap-2">
                    <span style={{ color: 'var(--text-subtle)' }}>Расчёт:</span>
                    <span className="font-semibold" style={{ color: 'var(--accent)' }}>
                      {fmt(s.order_qty_calc)} шт · {fmt(s.order_sum_rub_calc)} ₽
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between gap-2">
                    <span style={{ color: 'var(--text-subtle)' }}>СВОД (Китай):</span>
                    <span className="font-semibold" style={{ color: 'var(--warning)' }}>
                      {fmt(s.order_qty_svod)} шт · {fmt(s.order_sum_rub_svod)} ₽
                    </span>
                  </div>
                </div>
              ) : (
                <p className="text-[11px]" style={{ color: 'var(--text-subtle)' }}>{item.description}</p>
              )}
            </button>
          )
        })}
      </div>

      {/* ─── Графики 2×2 ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <StockTrendChart />
        <PlanVsFactChart />
        <SeasonalityHeatmap rows={heatmapRows} currentMonth={new Date().getMonth()} />
        <ForecastChart velocity={s.velocity_avg} totalStock={s.total_stock_qty} />
      </div>

      {/* ─── Таблица в стиле SkuTableTab ─────────────────────────────── */}
      <GlassCard padding="none" style={{ isolation: 'auto' }}>
        {/* Sticky filter bar */}
        <div
          ref={filterBarRef}
          className="px-4 py-3 border-b"
          style={{
            position: 'sticky',
            top: stickyTop.filterBar,
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
            searchPlaceholder="Поиск по SKU или названию..."
            filters={[
              { label: 'Период', key: 'period', options: [
                { value: '7',  label: '7д'  },
                { value: '14', label: '14д' },
                { value: '31', label: '31д' },
              ]},
              { label: 'Горизонт', key: 'horizon', options: [
                { value: '60', label: '60 дней' },
                { value: '90', label: '90 дней' },
              ]},
              { label: 'Статус', key: 'status', options: [
                { value: 'all', label: 'Все' },
                { value: 'critical', label: 'Крит.' },
                { value: 'warning', label: 'Внимание' },
                { value: 'ok', label: 'Норма' },
              ]},
              { label: 'ABC', key: 'abc', options: [
                { value: 'all', label: 'Все' },
                { value: 'A', label: 'A' },
                { value: 'B', label: 'B' },
                { value: 'C', label: 'C' },
              ]},
              { label: 'Заказ', key: 'only_to_order', options: [
                { value: 'all',  label: 'Все' },
                { value: 'with', label: 'Только с заказом' },
              ]},
              { label: 'OOS+спрос', key: 'only_oos_demand', options: [
                { value: 'all',  label: 'Все' },
                { value: 'with', label: 'Только OOS+спрос' },
              ]},
            ]}
            values={orderFilter}
            onChange={(k, v) => setOrderFilter(f => ({ ...f, [k]: v }))}
            onReset={() => {
              setOrderFilter({ status: 'all', abc: 'all', horizon: '60', period: '31', only_to_order: 'all', only_oos_demand: 'all' })
              setSearch('')
              setActiveKpi(null)
            }}
            hasActive={hasFilter}
            onExport={exportOrders}
            summary={
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {filteredRows.length} SKU · {fmt(visibleRevenue)} ₽
                {visibleRevenueDelta != null && (
                  <span className="ml-1" style={{ color: visibleRevenueDelta >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                    {visibleRevenueDelta >= 0 ? '+' : ''}{visibleRevenueDelta.toFixed(1)}%
                  </span>
                )}
              </span>
            }
          />
        </div>

        <div style={{ overflowX: 'auto', padding: '0 1rem' }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs" style={{ position: 'sticky', top: stickyTop.thead, zIndex: 10, background: 'var(--surface-solid)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', color: 'var(--text)', fontWeight: 600 }}>
                <SortTh label="SKU WB" sk="sku_wb" align="left" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortTh label="Название" sk="name" align="left" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortTh label="Менеджер" sk="manager" align="left" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortTh label="Статус" sk="status" align="center" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortTh label="ABC" sk="abc_class" align="center" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortTh label="Прод. 31д" sk="sales_qty_31d" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortTh label="OOS дн" sk="oos_days_31" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortTh label="Наличие" sk="total_stock" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortTh label="Дни" sk="stock_days" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortTh label="Лог.пл." sk="lead_time_days" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortTh label="Расч. заказ" sk="calc_order" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortTh label="Заказ менедж." sk="svod_order_qty" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortTh label="Δ заказа" sk="delta_order" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortTh label="Прогн. 30д" sk="forecast_30d" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortTh label="Выручка" sk="period_revenue" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortTh label="Δ Выручка" sk="delta_revenue_pct" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortTh label="Маржа" sk="margin_pct" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortTh label="GMROI" sk="gmroi" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              </tr>
            </thead>
            <tbody>
              {pagedRows.map((row, i) => {
                const sc = statusCfg[row.status] ?? statusCfg.ok
                const isLowMargin = row.margin_pct != null && row.margin_pct < 0.10
                const isExpanded = expandedSku === row.sku_ms
                return (
                  <Fragment key={row.sku_ms + i}>
                    <tr className="border-t hover:bg-[var(--surface-2)]"
                        style={{ borderColor: 'var(--border)', cursor: 'pointer' }}
                        onClick={() => setExpandedSku(s => s === row.sku_ms ? null : row.sku_ms)}>
                      <td className="py-2 px-2 font-mono text-xs" style={{ color: 'var(--text-muted)' }}>{row.sku_wb}</td>
                      <td className="py-2 px-2 max-w-[180px] truncate text-xs" style={{ color: 'var(--text)' }} title={row.name}>{row.name}</td>
                      <td className="py-2 px-2 text-xs max-w-[120px] truncate" style={{ color: 'var(--text-muted)' }}>{row.manager || '—'}</td>
                      <td className="py-2 px-2 text-center">
                        <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap"
                              style={{ background: sc.bg, color: sc.color }}>{sc.label}</span>
                      </td>
                      <td className="py-2 px-2 text-center">
                        <span className="font-bold text-xs" style={{
                          color: (row.abc_class ?? '').charAt(0) === 'A' ? 'var(--success)'
                               : (row.abc_class ?? '').charAt(0) === 'B' ? 'var(--warning)'
                               : (row.abc_class ?? '').charAt(0) === 'C' ? 'var(--danger)' : 'var(--text-subtle)',
                        }}>{row.abc_class ?? '—'}</span>
                      </td>
                      <td className="py-2 px-2 text-right text-xs" style={{ color: 'var(--text-muted)' }}>{fmt(row.sales_qty_31d)}</td>
                      <td className="py-2 px-2 text-right text-xs">
                        {row.oos_days_31 > 0
                          ? <span className="font-semibold" style={{ color: 'var(--danger)' }}>{row.oos_days_31}</span>
                          : <span style={{ color: 'var(--text-subtle)' }}>0</span>}
                      </td>
                      <td className="py-2 px-2 text-right text-xs" style={{ color: 'var(--text-muted)' }}>{fmt(row.total_stock)}</td>
                      <td className="py-2 px-2 text-right text-xs">
                        <span style={{ color: row.stock_days < row.lead_time_days ? 'var(--danger)' : 'var(--text-muted)' }}>{row.stock_days}</span>
                      </td>
                      <td className="py-2 px-2 text-right text-xs" style={{ color: 'var(--text-muted)' }}>{row.lead_time_days}</td>
                      <td className="py-2 px-2 text-right text-xs font-semibold"
                          style={{ color: row.calc_order > 0 ? 'var(--accent)' : 'var(--text-muted)' }}>{fmt(row.calc_order)}</td>
                      <td className="py-2 px-2 text-right text-xs font-semibold"
                          style={{ color: row.svod_order_qty > 0 ? 'var(--warning)' : 'var(--text-muted)' }}>{fmt(row.svod_order_qty)}</td>
                      <td className="py-2 px-2 text-right text-xs">
                        {row.delta_order !== 0 ? (
                          <span className="font-semibold" style={{ color: row.delta_order > 0 ? 'var(--info)' : 'var(--text-muted)' }}>
                            {row.delta_order > 0 ? '+' : ''}{fmt(row.delta_order)}
                          </span>
                        ) : <span style={{ color: 'var(--text-subtle)' }}>0</span>}
                      </td>
                      <td className="py-2 px-2 text-right text-xs" style={{ color: 'var(--text-muted)' }}>{fmt(row.forecast_30d)}</td>
                      <td className="py-2 px-2 text-right text-xs font-semibold" style={{ color: 'var(--text)' }}>{fmt(row.period_revenue)}</td>
                      <td className="py-2 px-2 text-right text-xs">
                        {row.delta_revenue_pct != null ? (
                          <span className="font-semibold" style={{ color: row.delta_revenue_pct >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                            {row.delta_revenue_pct >= 0 ? '+' : ''}{(row.delta_revenue_pct * 100).toFixed(1)}%
                          </span>
                        ) : <span style={{ color: 'var(--text-subtle)' }}>—</span>}
                      </td>
                      <td className="py-2 px-2 text-right">
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                              style={{ background: isLowMargin ? 'var(--danger-bg)' : 'var(--success-bg)',
                                       color: isLowMargin ? 'var(--danger)' : 'var(--success)' }}>{fmtPct(row.margin_pct)}</span>
                      </td>
                      <td className="py-2 px-2 text-right text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                        {row.gmroi != null ? row.gmroi.toFixed(2) : '—'}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr style={{ background: 'var(--surface-2)' }}>
                        <td colSpan={18} className="p-0">
                          <OrderCalcDetails row={row} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
              {pagedRows.length === 0 && (
                <tr><td colSpan={18} className="py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                  {hasFilter ? 'Нет SKU по выбранным фильтрам' : 'Нет данных. Загрузите таблицы в разделе «Обновление данных».'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {filteredRows.length > 0 && (
          <div className="flex items-center gap-3 px-4 py-3 border-t" style={{ borderColor: 'var(--border)' }}>
            <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              {pageSize === 0
                ? `${filteredRows.length} строк`
                : `${Math.min(page * pageSize + 1, filteredRows.length)}–${Math.min((page + 1) * pageSize, filteredRows.length)} из ${filteredRows.length}`}
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
            {totalPages > 1 && (
              <div className="flex gap-1 ml-auto">
                {Array.from({ length: Math.min(totalPages, 20) }, (_, i) => (
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
