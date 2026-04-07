'use client'

import { useEffect, useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
  BarChart, Bar, ComposedChart
} from 'recharts'
import { GlassCard } from '@/components/ui/GlassCard'
import { KPIBar } from '@/components/ui/KPIBar'
import { FilterBar } from '@/components/ui/FilterBar'
import { exportToExcel } from '@/lib/exportExcel'
import { MousePointerClick, ShoppingCart, ArrowRight, DollarSign, Megaphone, Percent, ChevronUp, ChevronDown } from 'lucide-react'
import { useDateRange } from '@/components/ui/DateRangePicker'

interface PriceData {
  funnel: {
    ctr: number
    cr_basket: number
    cr_order: number
    cpc: number
    cpm: number
    ad_order_share: number
  }
  daily: Array<{
    date: string
    ctr: number
    cr_basket: number
    cr_order: number
    ad_revenue: number
    organic_revenue: number
  }>
  price_changes: Array<{
    sku: string
    name: string
    manager: string
    date: string
    price_before: number
    price_after: number
    delta_pct: number
    delta_ctr?: number
    delta_cr_basket?: number
    delta_cr_order?: number
    cpo?: number
    delta_cpm?: number
    delta_cpc?: number
  }>
}

function fmt(n: number | null | undefined) {
  if (n == null) return '—'
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'М'
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(0) + 'К'
  return n.toFixed(0)
}
function fmtDate(iso: string) {
  const d = new Date(iso)
  return `${d.getDate().toString().padStart(2,'0')}.${(d.getMonth()+1).toString().padStart(2,'0')}`
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
          <span className="font-bold ml-auto">{fmt(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

function DeltaCell({ v }: { v?: number }) {
  if (v == null) return <span style={{ color: 'var(--text-subtle)' }}>—</span>
  const up = v > 0
  return (
    <span className="text-xs font-semibold" style={{ color: up ? 'var(--success)' : 'var(--danger)' }}>
      {up ? '+' : ''}{v.toFixed(2)}
    </span>
  )
}

export default function PriceTab() {
  const [data, setData] = useState<PriceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { range } = useDateRange()
  const [search, setSearch] = useState('')
  const [priceFilter, setPriceFilter] = useState<Record<string, string>>({ direction: 'all', manager: 'all' })
  const [sortKey, setSortKey] = useState<string>('date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  function toggleSort(key: string) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }
  function SortTh({ label, sk, align = 'right' }: { label: string; sk: string; align?: 'left' | 'right' }) {
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
    fetch(`/api/dashboard/prices?from=${range.from}&to=${range.to}`)
      .then(r => r.json())
      .then((d: PriceData) => { setData(d); setLoading(false) })
      .catch((e: unknown) => { setError(String(e)); setLoading(false) })
  }, [range.from, range.to])

  if (loading) return (
    <div className="px-6 py-6 space-y-6 max-w-[1440px] mx-auto">
      <KPIBar loading items={[
        { label: 'CTR', value: '' }, { label: 'CR в корзину', value: '' },
        { label: 'CR в заказ', value: '' }, { label: 'CPC', value: '' },
        { label: 'CPM', value: '' }, { label: 'Доля рекл.', value: '' },
      ]} />
    </div>
  )
  if (error) return <div className="px-6 py-16 text-center" style={{ color: 'var(--danger)' }}>{error}</div>
  if (!data) return null

  const f = data.funnel
  const priceChanges = data.price_changes ?? []
  const hasFilter = priceFilter.direction !== 'all' || search.trim() !== ''

  const filteredPrices = priceChanges.filter(row => {
    if (search && !row.name.toLowerCase().includes(search.toLowerCase()) && !row.sku.includes(search)) return false
    if (priceFilter.direction === 'up' && row.delta_pct <= 0) return false
    if (priceFilter.direction === 'down' && row.delta_pct >= 0) return false
    return true
  }).sort((a, b) => {
    const mult = sortDir === 'asc' ? 1 : -1
    type PriceRow = typeof a
    const key = sortKey as keyof PriceRow
    const av = a[key]; const bv = b[key]
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * mult
    return String(av ?? '').localeCompare(String(bv ?? '')) * mult
  })

  // Top-10 изменений для графика до/после
  const priceBeforeAfter = filteredPrices.slice(0, 10).map(r => ({
    name: r.name.length > 16 ? r.name.slice(0, 14) + '…' : r.name,
    'Было': r.price_before,
    'Стало': r.price_after,
    delta: r.delta_pct,
  }))

  function exportPrices() {
    exportToExcel(filteredPrices.map(r => ({
      'SKU': r.sku, 'Название': r.name, 'Менеджер': r.manager, 'Дата': r.date,
      'Было': r.price_before, 'Стало': r.price_after, 'Δ%': r.delta_pct.toFixed(1),
      'CPO': r.cpo ?? '',
    })), 'Цены_изменения')
  }

  const dailyFmt = (data.daily ?? []).map(d => ({
    date: fmtDate(d.date),
    'CTR': +(d.ctr * 100).toFixed(2),
    'CR корзина': +(d.cr_basket * 100).toFixed(2),
    'CR заказ': +(d.cr_order * 100).toFixed(2),
    'Рекламные': d.ad_revenue,
    'Органические': d.organic_revenue,
  }))

  return (
    <div className="px-6 py-6 space-y-6 max-w-[1440px] mx-auto">

      {/* KPI bar */}
      <KPIBar items={[
        { label: 'CTR',                value: f.ctr != null ? (f.ctr * 100).toFixed(2) + '%' : '—' },
        { label: 'CR в корзину',       value: f.cr_basket != null ? (f.cr_basket * 100).toFixed(2) + '%' : '—' },
        { label: 'CR в заказ',         value: f.cr_order != null ? (f.cr_order * 100).toFixed(2) + '%' : '—' },
        { label: 'CPC',                value: f.cpc != null ? fmt(f.cpc) + ' ₽' : '—' },
        { label: 'CPM',                value: f.cpm != null ? fmt(f.cpm) + ' ₽' : '—' },
        { label: 'Доля рекл. заказов', value: f.ad_order_share != null ? (f.ad_order_share * 100).toFixed(1) + '%' : '—' },
      ]} />

      {/* Charts */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <GlassCard padding="lg">
          <p className="text-sm font-semibold mb-4" style={{ color: 'var(--text)' }}>Воронка конверсий по дням</p>
          {dailyFmt.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={dailyFmt} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.6} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} width={36} tickFormatter={v => `${v}%`} />
                <Tooltip content={<ChartTip />} />
                <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="CTR" stroke="var(--info)" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="CR корзина" stroke="var(--warning)" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="CR заказ" stroke="var(--success)" strokeWidth={2} dot={false} />
              </LineChart>
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
                <Tooltip content={<ChartTip />} />
                <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="Рекламные" fill="var(--accent)" radius={[4,4,0,0]} />
                <Bar dataKey="Органические" fill="var(--info)" radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <div className="flex items-center justify-center h-56 text-sm" style={{ color: 'var(--text-muted)' }}>Нет данных</div>}
        </GlassCard>
      </div>

      {/* График до/после изменения цены */}
      {priceBeforeAfter.length > 0 && (
        <GlassCard padding="lg">
          <p className="text-sm font-semibold mb-4" style={{ color: 'var(--text)' }}>Цена до / после — последние изменения</p>
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart data={priceBeforeAfter} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.5} horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickLine={false} tickFormatter={v => fmt(v as number)} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} width={100} tickLine={false} axisLine={false} />
              <Tooltip formatter={(v) => fmt(v as number) + ' ₽'} />
              <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="Было" fill="var(--border)" radius={[0,4,4,0]} barSize={8} />
              <Bar dataKey="Стало" fill="var(--accent)" radius={[0,4,4,0]} barSize={8} />
            </ComposedChart>
          </ResponsiveContainer>
        </GlassCard>
      )}

      {/* Таблица изменений цен */}
      <GlassCard padding="lg">
        <div className="mb-4">
          <FilterBar
            search={search}
            onSearch={setSearch}
            searchPlaceholder="Поиск по названию или SKU..."
            filters={[
              { label: 'Направление', key: 'direction', options: [
                { value: 'all', label: 'Все' },
                { value: 'up', label: 'Рост цены' },
                { value: 'down', label: 'Снижение цены' },
              ]},
            ]}
            values={priceFilter}
            onChange={(k, v) => setPriceFilter(f => ({ ...f, [k]: v }))}
            onReset={() => { setPriceFilter({ direction: 'all', manager: 'all' }); setSearch('') }}
            hasActive={hasFilter}
            onExport={exportPrices}
            summary={<span className="text-xs" style={{ color: 'var(--text-muted)' }}>Изменения цен · {filteredPrices.length}</span>}
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm sticky-thead">
            <thead>
              <tr className="text-xs">
                <th className="text-left pb-3 font-medium" style={{ color: 'var(--text-subtle)' }}>SKU</th>
                <th className="text-left pb-3 font-medium" style={{ color: 'var(--text-subtle)' }}>Название</th>
                <th className="text-left pb-3 font-medium" style={{ color: 'var(--text-subtle)' }}>Менеджер</th>
                <SortTh label="Дата" sk="date" />
                <SortTh label="Было" sk="price_before" />
                <SortTh label="Стало" sk="price_after" />
                <SortTh label="Δ%" sk="delta_pct" />
                <SortTh label="Δ CTR" sk="delta_ctr" />
                <SortTh label="Δ CR корз." sk="delta_cr_basket" />
                <SortTh label="Δ CR заказ" sk="delta_cr_order" />
                <SortTh label="CPO" sk="cpo" />
                <SortTh label="Δ CPM" sk="delta_cpm" />
                <SortTh label="Δ CPC" sk="delta_cpc" />
              </tr>
            </thead>
            <tbody>
              {filteredPrices.map((row, i) => {
                const up = row.delta_pct > 0
                return (
                  <tr key={i} className="border-t" style={{ borderColor: 'var(--border)' }}>
                    <td className="py-2 pr-2 font-mono text-xs" style={{ color: 'var(--text-muted)' }}>{row.sku}</td>
                    <td className="py-2 pr-4 max-w-[160px] truncate" style={{ color: 'var(--text)' }}>{row.name}</td>
                    <td className="py-2 pr-4" style={{ color: 'var(--text-muted)' }}>{row.manager}</td>
                    <td className="py-2 text-right text-xs" style={{ color: 'var(--text-muted)' }}>{fmtDate(row.date)}</td>
                    <td className="py-2 text-right" style={{ color: 'var(--text-muted)' }}>{fmt(row.price_before)} ₽</td>
                    <td className="py-2 text-right font-semibold" style={{ color: 'var(--text)' }}>{fmt(row.price_after)} ₽</td>
                    <td className="py-2 text-right"><span className="text-xs font-semibold" style={{ color: up ? 'var(--success)' : 'var(--danger)' }}>{up ? '+' : ''}{row.delta_pct.toFixed(1)}%</span></td>
                    <td className="py-2 text-right"><DeltaCell v={row.delta_ctr} /></td>
                    <td className="py-2 text-right"><DeltaCell v={row.delta_cr_basket} /></td>
                    <td className="py-2 text-right"><DeltaCell v={row.delta_cr_order} /></td>
                    <td className="py-2 text-right" style={{ color: 'var(--text-muted)' }}>{row.cpo != null ? fmt(row.cpo) + ' ₽' : '—'}</td>
                    <td className="py-2 text-right"><DeltaCell v={row.delta_cpm} /></td>
                    <td className="py-2 text-right"><DeltaCell v={row.delta_cpc} /></td>
                  </tr>
                )
              })}
              {filteredPrices.length === 0 && (
                <tr><td colSpan={13} className="py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Нет изменений цен за выбранный период</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </GlassCard>
    </div>
  )
}
