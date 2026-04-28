'use client'

import { Fragment, useEffect, useMemo, useState } from 'react'
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
  // sezonality coeffs (для heatmap)
}

interface OrderData {
  summary: {
    critical_count: number
    warning_count: number
    oos_with_demand: number
    to_order_count: number
    order_sum_rub: number
    total_stock_qty: number
    total_stock_rub: number
    velocity_avg: number
    turnover_days_avg: number
    forecast_30d_total: number
  }
  rows: OrderRow[]
  latest_date: string | null
  latest_snap: string | null
  period: number
  horizon: number
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

function SortTh({ label, sk, align = 'right', sortKey, sortDir, onSort }: {
  label: string; sk: string; align?: 'left' | 'right' | 'center'
  sortKey: string; sortDir: 'asc' | 'desc'; onSort: (k: string) => void
}) {
  const active = sortKey === sk
  return (
    <th className={`text-${align} pb-3 font-medium cursor-pointer select-none whitespace-nowrap text-xs`}
        style={{ color: active ? 'var(--accent)' : 'var(--text-subtle)' }}
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

export default function OrderTab() {
  const [data, setData] = useState<OrderData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [orderFilter, setOrderFilter] = useState<Record<string, string>>({
    status: 'all', abc: 'all', horizon: '60', period: '31', only_to_order: 'all',
  })
  const [expandedSku, setExpandedSku] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<keyof OrderRow>('calc_order')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  function toggleSort(key: keyof OrderRow) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  useEffect(() => {
    setLoading(true)
    fetch(`/api/dashboard/orders?horizon=${orderFilter.horizon}&period=${orderFilter.period}`)
      .then(r => r.json())
      .then((d: OrderData) => { setData(d); setLoading(false) })
      .catch((e: unknown) => { setError(String(e)); setLoading(false) })
  }, [orderFilter.horizon, orderFilter.period])

  const heatmapRows: HeatmapRow[] = useMemo(() => {
    if (!data) return []
    // Уникальные ниши, топ-15 по выручке (используем sales_qty_31d × price как прокси)
    const byNiche: Record<string, { row: OrderRow; rev: number }> = {}
    for (const r of data.rows) {
      const key = r.subject_wb || r.brand || r.sku_ms
      const rev = r.sales_qty_31d * (r.price ?? 0)
      if (!byNiche[key] || rev > byNiche[key].rev) {
        byNiche[key] = { row: r, rev }
      }
    }
    // Загружаем коэффициенты из row.horizon_months — но они только для горизонта
    // Поэтому для heatmap нужен отдельный запрос; пока используем что есть
    return Object.entries(byNiche)
      .sort((a, b) => b[1].rev - a[1].rev)
      .slice(0, 15)
      .map(([key, { row }]) => ({
        sku_ms: row.sku_ms,
        name: row.name,
        subject_wb: key,
        // 12 значений: попробуем достать из row.horizon_months (но там обычно <12)
        // → fallback: рендерим только горизонт-месяцы, остальные null
        coeffs: Array(12).fill(null) as Array<number | null>,
      }))
  }, [data])

  if (loading) return (
    <div className="px-6 py-6 space-y-6 max-w-[1440px] mx-auto">
      <KPIBar loading items={Array(7).fill({ label: '', value: '' })} />
    </div>
  )
  if (error) return <div className="px-6 py-16 text-center" style={{ color: 'var(--danger)' }}>{error}</div>
  if (!data) return null

  const s = data.summary
  const hasFilter = search.trim() !== ''
    || orderFilter.status !== 'all'
    || orderFilter.abc !== 'all'
    || orderFilter.only_to_order !== 'all'

  const filteredRows = (data.rows ?? []).filter(row => {
    if (search) {
      const q = search.toLowerCase()
      if (!row.name.toLowerCase().includes(q) && !String(row.sku_wb).includes(search) && !row.sku_ms.toLowerCase().includes(q)) return false
    }
    if (orderFilter.status !== 'all' && row.status !== orderFilter.status) return false
    if (orderFilter.abc !== 'all' && (row.abc_class ?? '').charAt(0) !== orderFilter.abc) return false
    if (orderFilter.only_to_order === 'with' && row.calc_order <= 0) return false
    return true
  }).sort((a, b) => {
    const av = a[sortKey] as number | string | null | undefined
    const bv = b[sortKey] as number | string | null | undefined
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * (sortDir === 'asc' ? 1 : -1)
    return String(av ?? '').localeCompare(String(bv ?? '')) * (sortDir === 'asc' ? 1 : -1)
  })

  const selectedSum = filteredRows.reduce((sum, r) => sum + r.calc_order * (r.cost_plan ?? 0), 0)

  function exportOrders() {
    exportToExcel(filteredRows.map(r => ({
      'SKU WB': r.sku_wb,
      'SKU МС': r.sku_ms,
      'Название': r.name,
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
      'base_norm': r.base_norm,
      'cur_coef': r.cur_coef,
      'target_coef': r.target_coef,
      'Потребность (шт)': r.demand_qty,
      'CV': r.cv,
      'Страх. запас (шт)': r.safety_qty,
      'Расч. заказ (шт)': r.calc_order,
      'Прогноз 30д (шт)': r.forecast_30d,
      'Заказ менеджера': r.manager_order,
      'Δ': r.delta_order,
      'Маржа %': r.margin_pct != null ? (r.margin_pct * 100).toFixed(1) : '',
      'GMROI': r.gmroi,
    })), 'Заказы')
  }

  function clickAlert(filterStatus: 'critical' | 'warning' | 'oos_demand' | 'to_order') {
    if (filterStatus === 'critical') setOrderFilter(f => ({ ...f, status: 'critical', only_to_order: 'all' }))
    else if (filterStatus === 'warning') setOrderFilter(f => ({ ...f, status: 'warning', only_to_order: 'all' }))
    else if (filterStatus === 'oos_demand') setOrderFilter(f => ({ ...f, status: 'critical', only_to_order: 'all' }))
    else if (filterStatus === 'to_order') setOrderFilter(f => ({ ...f, only_to_order: 'with', status: 'all' }))
  }

  return (
    <div className="px-6 py-6 space-y-6 max-w-[1440px] mx-auto">

      {/* KPI: 7 карточек по спеке */}
      <KPIBar items={[
        { label: 'Текущий остаток (шт)',  value: fmt(s.total_stock_qty) },
        { label: 'К заказу (₽)',           value: fmt(s.order_sum_rub) },
        { label: 'SKU крит. запас',        value: String(s.critical_count), danger: s.critical_count > 0 },
        { label: 'Скорость продаж',        value: fmt(s.velocity_avg) + '/дн' },
        { label: 'Оборачиваемость (дни)',  value: fmt(s.turnover_days_avg) },
        { label: 'Расчётный заказ (шт)',   value: fmt(s.to_order_count), accent: true },
        { label: 'Прогноз продаж 30д',     value: fmt(s.forecast_30d_total) },
      ]} />

      {/* Alert row — clickable */}
      <div className="flex justify-center">
        <div className="glass overflow-hidden inline-flex" style={{ borderRadius: 'var(--radius-xl)' }}>
          {[
            { key: 'critical', icon: <AlertCircle size={13} />, title: 'Критический запас', count: s.critical_count,  color: 'var(--danger)',  description: 'Запас < 50% лог. плеча' },
            { key: 'warning', icon: <AlertTriangle size={13} />, title: 'Требует внимания', count: s.warning_count,  color: 'var(--warning)', description: 'Запас < лог. плеча' },
            { key: 'oos_demand', icon: <PackageOpen size={13} />, title: 'OOS с продажами', count: s.oos_with_demand, color: 'var(--danger)',  description: 'Нет стока, есть спрос' },
            { key: 'to_order', icon: <Package size={13} />,    title: 'К заказу',          count: s.to_order_count,  color: 'var(--info)',    description: 'Сумма: ' + fmt(s.order_sum_rub) + ' ₽' },
          ].map((item, idx, arr) => (
            <button
              key={item.key}
              onClick={() => clickAlert(item.key as 'critical' | 'warning' | 'oos_demand' | 'to_order')}
              className="px-6 py-4 text-center hover:opacity-80 transition-opacity"
              style={{ borderRight: idx < arr.length - 1 ? '1px solid var(--border-subtle)' : undefined, minWidth: 140 }}
            >
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <span style={{ color: item.color }}>{item.icon}</span>
                <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>{item.title}</p>
              </div>
              <p className="text-2xl font-black" style={{ color: item.color, letterSpacing: '-0.03em' }}>{item.count}</p>
              <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-subtle)' }}>{item.description}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Charts 2x2 */}
      <div className="grid grid-cols-2 gap-4">
        <StockTrendChart />
        <PlanVsFactChart />
        <SeasonalityHeatmap rows={heatmapRows} currentMonth={new Date().getMonth()} />
        <ForecastChart velocity={s.velocity_avg} totalStock={s.total_stock_qty} />
      </div>

      {/* Main table */}
      <GlassCard padding="lg">
        <div className="mb-4">
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
            ]}
            values={orderFilter}
            onChange={(k, v) => setOrderFilter(f => ({ ...f, [k]: v }))}
            onReset={() => {
              setOrderFilter({ status: 'all', abc: 'all', horizon: '60', period: '31', only_to_order: 'all' })
              setSearch('')
            }}
            hasActive={hasFilter}
            onExport={exportOrders}
            summary={
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Выбрано: {filteredRows.length} SKU • Сумма к заказу: {fmt(selectedSum)} ₽
              </span>
            }
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm sticky-thead">
            <thead style={{ background: 'var(--surface)' }}>
              <tr>
                <SortTh label="SKU WB" sk="sku_wb" align="left" sortKey={sortKey as string} sortDir={sortDir} onSort={k => toggleSort(k as keyof OrderRow)} />
                <SortTh label="Название" sk="name" align="left" sortKey={sortKey as string} sortDir={sortDir} onSort={k => toggleSort(k as keyof OrderRow)} />
                <SortTh label="Статус" sk="status" align="center" sortKey={sortKey as string} sortDir={sortDir} onSort={k => toggleSort(k as keyof OrderRow)} />
                <SortTh label="ABC" sk="abc_class" align="center" sortKey={sortKey as string} sortDir={sortDir} onSort={k => toggleSort(k as keyof OrderRow)} />
                <SortTh label="Прод. 31д" sk="sales_qty_31d" sortKey={sortKey as string} sortDir={sortDir} onSort={k => toggleSort(k as keyof OrderRow)} />
                <SortTh label="OOS дн" sk="oos_days_31" sortKey={sortKey as string} sortDir={sortDir} onSort={k => toggleSort(k as keyof OrderRow)} />
                <SortTh label="Наличие" sk="total_stock" sortKey={sortKey as string} sortDir={sortDir} onSort={k => toggleSort(k as keyof OrderRow)} />
                <SortTh label="Дни" sk="stock_days" sortKey={sortKey as string} sortDir={sortDir} onSort={k => toggleSort(k as keyof OrderRow)} />
                <SortTh label="Лог.пл." sk="lead_time_days" sortKey={sortKey as string} sortDir={sortDir} onSort={k => toggleSort(k as keyof OrderRow)} />
                <SortTh label="Расч.заказ" sk="calc_order" sortKey={sortKey as string} sortDir={sortDir} onSort={k => toggleSort(k as keyof OrderRow)} />
                <SortTh label="Прогн.30д" sk="forecast_30d" sortKey={sortKey as string} sortDir={sortDir} onSort={k => toggleSort(k as keyof OrderRow)} />
                <SortTh label="Менедж." sk="manager_order" sortKey={sortKey as string} sortDir={sortDir} onSort={k => toggleSort(k as keyof OrderRow)} />
                <SortTh label="Δ" sk="delta_order" sortKey={sortKey as string} sortDir={sortDir} onSort={k => toggleSort(k as keyof OrderRow)} />
                <SortTh label="Маржа" sk="margin_pct" sortKey={sortKey as string} sortDir={sortDir} onSort={k => toggleSort(k as keyof OrderRow)} />
                <SortTh label="GMROI" sk="gmroi" sortKey={sortKey as string} sortDir={sortDir} onSort={k => toggleSort(k as keyof OrderRow)} />
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row, i) => {
                const sc = statusCfg[row.status] ?? statusCfg.ok
                const isLowMargin = row.margin_pct != null && row.margin_pct < 0.10
                const isExpanded = expandedSku === row.sku_ms
                return (
                  <Fragment key={row.sku_ms + i}>
                    <tr className="border-t hover:bg-[var(--surface-2)]"
                        style={{ borderColor: 'var(--border)', cursor: 'pointer' }}
                        onClick={() => setExpandedSku(s => s === row.sku_ms ? null : row.sku_ms)}>
                      <td className="py-2 pr-2 font-mono text-xs" style={{ color: 'var(--text-muted)' }}>{row.sku_wb}</td>
                      <td className="py-2 pr-4 max-w-[160px] truncate text-xs" style={{ color: 'var(--text)' }} title={row.name}>{row.name}</td>
                      <td className="py-2 text-center">
                        <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap"
                              style={{ background: sc.bg, color: sc.color }}>{sc.label}</span>
                      </td>
                      <td className="py-2 text-center">
                        <span className="font-bold text-xs" style={{
                          color: (row.abc_class ?? '').charAt(0) === 'A' ? 'var(--success)'
                               : (row.abc_class ?? '').charAt(0) === 'B' ? 'var(--warning)'
                               : (row.abc_class ?? '').charAt(0) === 'C' ? 'var(--danger)' : 'var(--text-subtle)',
                        }}>{row.abc_class ?? '—'}</span>
                      </td>
                      <td className="py-2 text-right text-xs" style={{ color: 'var(--text-muted)' }}>{fmt(row.sales_qty_31d)}</td>
                      <td className="py-2 text-right text-xs">
                        {row.oos_days_31 > 0
                          ? <span className="font-semibold" style={{ color: 'var(--danger)' }}>{row.oos_days_31}</span>
                          : <span style={{ color: 'var(--text-subtle)' }}>0</span>}
                      </td>
                      <td className="py-2 text-right text-xs" style={{ color: 'var(--text-muted)' }}>{fmt(row.total_stock)}</td>
                      <td className="py-2 text-right text-xs">
                        <span style={{ color: row.stock_days < row.lead_time_days ? 'var(--danger)' : 'var(--text-muted)' }}>{row.stock_days}</span>
                      </td>
                      <td className="py-2 text-right text-xs" style={{ color: 'var(--text-muted)' }}>{row.lead_time_days}</td>
                      <td className="py-2 text-right text-xs font-semibold"
                          style={{ color: row.calc_order > 0 ? 'var(--accent)' : 'var(--text-muted)' }}>{fmt(row.calc_order)}</td>
                      <td className="py-2 text-right text-xs" style={{ color: 'var(--text-muted)' }}>{fmt(row.forecast_30d)}</td>
                      <td className="py-2 text-right text-xs" style={{ color: 'var(--text-muted)' }}>{fmt(row.manager_order)}</td>
                      <td className="py-2 text-right text-xs">
                        {row.delta_order !== 0 ? (
                          <span className="font-semibold" style={{ color: row.delta_order > 0 ? 'var(--warning)' : 'var(--success)' }}>
                            {row.delta_order > 0 ? '+' : ''}{fmt(row.delta_order)}
                          </span>
                        ) : <span style={{ color: 'var(--text-subtle)' }}>0</span>}
                      </td>
                      <td className="py-2 text-right">
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                              style={{ background: isLowMargin ? 'var(--danger-bg)' : 'var(--success-bg)',
                                       color: isLowMargin ? 'var(--danger)' : 'var(--success)' }}>{fmtPct(row.margin_pct)}</span>
                      </td>
                      <td className="py-2 text-right text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                        {row.gmroi != null ? row.gmroi.toFixed(2) : '—'}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr style={{ background: 'var(--surface-2)' }}>
                        <td colSpan={15} className="p-0">
                          <OrderCalcDetails row={row} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
              {filteredRows.length === 0 && (
                <tr><td colSpan={15} className="py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Нет данных. Загрузите таблицы в разделе «Обновление данных».</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </GlassCard>
    </div>
  )
}
