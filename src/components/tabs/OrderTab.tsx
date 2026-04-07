'use client'

import { useEffect, useState } from 'react'
import { GlassCard } from '@/components/ui/GlassCard'
import { KPIBar } from '@/components/ui/KPIBar'
import { FilterBar } from '@/components/ui/FilterBar'
import { exportToExcel } from '@/lib/exportExcel'
import { Package, AlertTriangle, TrendingDown, DollarSign, ShoppingBag, AlertCircle, PackageOpen, ChevronUp, ChevronDown } from 'lucide-react'
import { OrderModal } from '@/components/ui/OrderModal'
import { useDateRange } from '@/components/ui/DateRangePicker'

interface OrderRow {
  sku_ms: string
  sku_wb: string
  name: string
  status: 'critical' | 'warning' | 'ok'
  abc: string
  sales_31d: number
  oos_days: number
  trend: number
  stock_qty: number
  stock_days: number
  lead_time: number
  calc_order: number
  manager_order: number
  delta_order: number
  margin_pct: number
}

interface OrderData {
  summary: {
    critical_count: number
    warning_count: number
    oos_with_demand: number
    to_order_count: number
    order_sum_rub: number
    avg_days_to_oos: number
    total_stock_rub: number
  }
  rows: OrderRow[]
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

const statusCfg = {
  critical: { label: 'Критический', color: 'var(--danger)',  bg: 'var(--danger-bg)' },
  warning:  { label: 'Внимание',    color: 'var(--warning)', bg: 'var(--warning-bg)' },
  ok:       { label: 'Норма',       color: 'var(--success)', bg: 'var(--success-bg)' },
}

export default function OrderTab() {
  const [data, setData] = useState<OrderData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [orderFilter, setOrderFilter] = useState<Record<string, string>>({ status: 'all', abc: 'all', horizon: '60' })
  const [selectedSku, setSelectedSku] = useState<string | null>(null)
  const { range } = useDateRange()
  const [sortKey, setSortKey] = useState<keyof OrderRow>('stock_days')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  function toggleSort(key: keyof OrderRow) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }
  function SortTh({ label, sk, align = 'right' }: { label: string; sk: keyof OrderRow; align?: 'left' | 'right' | 'center' }) {
    const active = sortKey === sk
    return (
      <th className={`text-${align} pb-3 font-medium cursor-pointer select-none whitespace-nowrap`} style={{ color: active ? 'var(--accent)' : 'var(--text-subtle)' }} onClick={() => toggleSort(sk)}>
        <span className={`inline-flex items-center gap-0.5 ${align === 'right' ? 'justify-end' : ''}`}>
          {label}
          {active ? (sortDir === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />) : <ChevronUp size={11} style={{ opacity: 0.3 }} />}
        </span>
      </th>
    )
  }

  useEffect(() => {
    fetch(`/api/dashboard/orders?from=${range.from}&to=${range.to}&horizon=${orderFilter.horizon}`)
      .then(r => r.json())
      .then((d: OrderData) => { setData(d); setLoading(false) })
      .catch((e: unknown) => { setError(String(e)); setLoading(false) })
  }, [range.from, range.to, orderFilter.horizon])

  if (loading) return (
    <div className="px-6 py-6 space-y-6 max-w-[1440px] mx-auto">
      <KPIBar loading items={[
        { label: 'Остаток (руб)', value: '' }, { label: 'Дней до OOS', value: '' },
        { label: 'К заказу (шт)', value: '' }, { label: 'Сумма заказа', value: '' },
        { label: 'SKU крит.', value: '' },
      ]} />
    </div>
  )
  if (error) return <div className="px-6 py-16 text-center" style={{ color: 'var(--danger)' }}>{error}</div>
  if (!data) return null

  const s = data.summary
  const hasFilter = search.trim() !== '' || orderFilter.status !== 'all' || orderFilter.abc !== 'all'
  const filteredRows = (data.rows ?? []).filter(row => {
    if (search && !row.name.toLowerCase().includes(search.toLowerCase()) && !row.sku_wb.includes(search)) return false
    if (orderFilter.status !== 'all' && row.status !== orderFilter.status) return false
    if (orderFilter.abc !== 'all' && row.abc !== orderFilter.abc) return false
    return true
  }).sort((a, b) => {
    const av = a[sortKey]; const bv = b[sortKey]
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * (sortDir === 'asc' ? 1 : -1)
    return String(av).localeCompare(String(bv)) * (sortDir === 'asc' ? 1 : -1)
  })

  function exportOrders() {
    exportToExcel(filteredRows.map(r => ({
      'SKU WB': r.sku_wb, 'Название': r.name, 'Статус': r.status, 'ABC': r.abc,
      'Продажи 31д': r.sales_31d, 'OOS дней': r.oos_days, 'Остаток': r.stock_qty,
      'Остаток дней': r.stock_days, 'Лог. плечо': r.lead_time,
      'Расч. заказ': r.calc_order, 'Заказ менедж.': r.manager_order,
      'Маржа%': (r.margin_pct * 100).toFixed(1),
    })), 'Заказы')
  }

  return (
    <div className="px-6 py-6 space-y-6 max-w-[1440px] mx-auto">

      <KPIBar items={[
        { label: 'Остаток (руб)',     value: fmt(s.total_stock_rub) },
        { label: 'Среднее дней до OOS', value: fmt(s.avg_days_to_oos), danger: (s.avg_days_to_oos ?? 99) < 14 },
        { label: 'К заказу (шт)',     value: fmt(s.to_order_count) },
        { label: 'Сумма к заказу',    value: fmt(s.order_sum_rub) },
        { label: 'SKU крит. запас',   value: String(s.critical_count), danger: s.critical_count > 0 },
        { label: 'Прогноз продаж 60д', value: s.avg_days_to_oos > 0 ? fmt(Math.round((s.to_order_count ?? 0) * 1)) : '—', accent: true },
      ]} />

      {/* Alert row */}
      <div className="flex justify-center">
        <div className="glass overflow-hidden inline-flex" style={{ borderRadius: 'var(--radius-xl)' }}>
          {[
            { icon: <AlertCircle size={13} />, title: 'Критический запас', count: s.critical_count,  color: 'var(--danger)',  description: 'Запас < 50% лог. плеча' },
            { icon: <AlertTriangle size={13} />, title: 'Требует внимания', count: s.warning_count,  color: 'var(--warning)', description: 'Запас < лог. плеча' },
            { icon: <PackageOpen size={13} />, title: 'OOS с продажами',   count: s.oos_with_demand, color: 'var(--danger)',  description: 'Нет стока, есть спрос' },
            { icon: <Package size={13} />,     title: 'К заказу',          count: s.to_order_count,  color: 'var(--info)',    description: 'Сумма: ' + fmt(s.order_sum_rub) + ' ₽' },
          ].map((item, idx, arr) => (
            <div key={idx} className="px-6 py-4 text-center" style={{ borderRight: idx < arr.length - 1 ? '1px solid var(--border-subtle)' : undefined, minWidth: 140 }}>
              <div className="flex items-center justify-center gap-1.5 mb-1">
                <span style={{ color: item.color }}>{item.icon}</span>
                <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>{item.title}</p>
              </div>
              <p className="text-2xl font-black" style={{ color: item.color, letterSpacing: '-0.03em' }}>{item.count}</p>
              <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-subtle)' }}>{item.description}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Main table */}
      <GlassCard padding="lg">
        <div className="mb-4">
          <FilterBar
            search={search}
            onSearch={setSearch}
            searchPlaceholder="Поиск по SKU или названию..."
            filters={[
              { label: 'Статус', key: 'status', options: [
                { value: 'all', label: 'Все' },
                { value: 'critical', label: 'Критический' },
                { value: 'warning', label: 'Внимание' },
                { value: 'ok', label: 'Норма' },
              ]},
              { label: 'ABC', key: 'abc', options: [
                { value: 'all', label: 'Все' },
                { value: 'A', label: 'A' },
                { value: 'B', label: 'B' },
                { value: 'C', label: 'C' },
              ]},
              { label: 'Горизонт', key: 'horizon', options: [
                { value: '60', label: '60 дней' },
                { value: '90', label: '90 дней' },
                { value: '30', label: '30 дней' },
              ]},
            ]}
            values={orderFilter}
            onChange={(k, v) => setOrderFilter(f => ({ ...f, [k]: v }))}
            onReset={() => { setOrderFilter({ status: 'all', abc: 'all', horizon: '60' }); setSearch('') }}
            hasActive={hasFilter}
            onExport={exportOrders}
            summary={<span className="text-xs" style={{ color: 'var(--text-muted)' }}>Запасы · {filteredRows.length}</span>}
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm sticky-thead">
            <thead>
              <tr className="text-xs">
                <th className="text-left pb-3 font-medium" style={{ color: 'var(--text-subtle)' }}>SKU WB</th>
                <th className="text-left pb-3 font-medium" style={{ color: 'var(--text-subtle)' }}>Название</th>
                <SortTh label="Статус" sk="status" align="center" />
                <SortTh label="ABC" sk="abc" align="center" />
                <SortTh label="Продажи 31д" sk="sales_31d" />
                <SortTh label="OOS дней" sk="oos_days" />
                <SortTh label="Наличие" sk="stock_qty" />
                <SortTh label="Остаток дней" sk="stock_days" />
                <SortTh label="Лог. плечо" sk="lead_time" />
                <SortTh label="Расч. заказ" sk="calc_order" />
                <SortTh label="Заказ менедж." sk="manager_order" />
                <SortTh label="Δ" sk="delta_order" />
                <SortTh label="Маржа" sk="margin_pct" />
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row, i) => {
                const sc = statusCfg[row.status] ?? statusCfg.ok
                const isLowMargin = row.margin_pct < 0.10
                return (
                  <tr key={i} className="border-t" style={{ borderColor: 'var(--border)', cursor: 'pointer' }} onClick={() => setSelectedSku(row.sku_ms)}>
                    <td className="py-2 pr-2 font-mono text-xs" style={{ color: 'var(--text-muted)' }}>{row.sku_wb}</td>
                    <td className="py-2 pr-4 max-w-[180px] truncate" style={{ color: 'var(--text)' }}>{row.name}</td>
                    <td className="py-2 text-center">
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap" style={{ background: sc.bg, color: sc.color }}>{sc.label}</span>
                    </td>
                    <td className="py-2 text-center">
                      <span className="font-bold text-xs" style={{ color: row.abc === 'A' ? 'var(--success)' : row.abc === 'B' ? 'var(--warning)' : 'var(--danger)' }}>{row.abc}</span>
                    </td>
                    <td className="py-2 text-right" style={{ color: 'var(--text-muted)' }}>{fmt(row.sales_31d)}</td>
                    <td className="py-2 text-right">
                      {row.oos_days > 0 ? <span className="text-xs font-semibold" style={{ color: 'var(--danger)' }}>{row.oos_days}</span> : <span style={{ color: 'var(--text-subtle)' }}>0</span>}
                    </td>
                    <td className="py-2 text-right" style={{ color: 'var(--text-muted)' }}>{fmt(row.stock_qty)}</td>
                    <td className="py-2 text-right">
                      <span style={{ color: row.stock_days < row.lead_time ? 'var(--danger)' : 'var(--text-muted)' }}>{row.stock_days}</span>
                    </td>
                    <td className="py-2 text-right" style={{ color: 'var(--text-muted)' }}>{row.lead_time}</td>
                    <td className="py-2 text-right font-semibold" style={{ color: row.calc_order > 0 ? 'var(--accent)' : 'var(--text-muted)' }}>{fmt(row.calc_order)}</td>
                    <td className="py-2 text-right" style={{ color: 'var(--text-muted)' }}>{fmt(row.manager_order)}</td>
                    <td className="py-2 text-right">
                      {row.delta_order !== 0 ? (
                        <span className="text-xs font-semibold" style={{ color: row.delta_order > 0 ? 'var(--warning)' : 'var(--success)' }}>
                          {row.delta_order > 0 ? '+' : ''}{fmt(row.delta_order)}
                        </span>
                      ) : <span style={{ color: 'var(--text-subtle)' }}>0</span>}
                    </td>
                    <td className="py-2 text-right">
                      <span className="px-2 py-0.5 rounded text-xs font-medium" style={{ background: isLowMargin ? 'var(--danger-bg)' : 'var(--success-bg)', color: isLowMargin ? 'var(--danger)' : 'var(--success)' }}>{fmtPct(row.margin_pct)}</span>
                    </td>
                  </tr>
                )
              })}
              {filteredRows.length === 0 && (
                <tr><td colSpan={13} className="py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Нет данных. Загрузите таблицы в разделе «Обновление данных».</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </GlassCard>
      <OrderModal skuMs={selectedSku} onClose={() => setSelectedSku(null)} />
    </div>
  )
}
