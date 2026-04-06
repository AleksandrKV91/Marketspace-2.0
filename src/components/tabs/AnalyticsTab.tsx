'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  LineChart, Line, Legend
} from 'recharts'
import { GlassCard } from '@/components/ui/GlassCard'
import { KPIBar } from '@/components/ui/KPIBar'
import { FilterBar } from '@/components/ui/FilterBar'
import { exportToExcel } from '@/lib/exportExcel'
import { ShoppingBag, TrendingDown, Percent, BarChart2, Target, TrendingUp, ChevronUp, ChevronDown } from 'lucide-react'

interface AnalyticsData {
  summary: {
    revenue: number
    revenue_prev: number
    chmd: number
    chmd_prev: number
    margin_pct: number
    margin_prev: number
    drr: number
    drr_prev: number
    cpo?: number
    delta_revenue_pct?: number
  }
  daily: Array<{ date: string; revenue: number; chmd: number; expenses: number; margin_pct: number; drr: number }>
  by_category: Array<{ category: string; revenue: number; delta_pct: number; chmd: number; margin_pct: number; drr: number; stock_rub: number; sku_count: number }>
  by_manager: Array<{ manager: string; revenue: number; chmd: number; margin_pct: number; drr: number; oos_count: number; sku_count: number }>
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
function fmtDate(iso: string) {
  const d = new Date(iso)
  return `${d.getDate().toString().padStart(2,'0')}.${(d.getMonth()+1).toString().padStart(2,'0')}`
}
function delta(curr: number, prev: number) {
  if (!prev) return undefined
  return ((curr - prev) / prev) * 100
}

const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.06 } } }
const fadeUp = { hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0, transition: { duration: 0.3 } } }

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

type CatSortKey = 'revenue' | 'delta_pct' | 'chmd' | 'margin_pct' | 'drr' | 'sku_count'

function SortTh({ label, sortKey, current, dir, onClick, align = 'right' }: { label: string; sortKey: CatSortKey; current: CatSortKey; dir: 'asc' | 'desc'; onClick: (k: CatSortKey) => void; align?: 'left' | 'right' }) {
  const active = current === sortKey
  return (
    <th className={`text-${align} pb-3 font-medium cursor-pointer select-none whitespace-nowrap`} style={{ color: active ? 'var(--accent)' : 'var(--text-subtle)' }} onClick={() => onClick(sortKey)}>
      <span className={`inline-flex items-center gap-0.5 ${align === 'right' ? 'justify-end' : ''}`}>
        {label}
        {active ? (dir === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />) : <ChevronUp size={11} style={{ opacity: 0.3 }} />}
      </span>
    </th>
  )
}

export default function AnalyticsTab() {
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [catFilter, setCatFilter] = useState<Record<string, string>>({ margin: 'all', drr: 'all' })
  const [sortKey, setSortKey] = useState<CatSortKey>('revenue')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  function toggleSort(key: CatSortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  useEffect(() => {
    fetch('/api/dashboard/analytics')
      .then(r => r.json())
      .then((d: AnalyticsData) => { setData(d); setLoading(false) })
      .catch((e: unknown) => { setError(String(e)); setLoading(false) })
  }, [])

  if (loading) return (
    <div className="px-6 py-6 space-y-6 max-w-[1440px] mx-auto">
      <KPIBar loading items={[
        { label: 'Выручка', value: '' }, { label: 'ЧМД', value: '' },
        { label: 'Маржа %', value: '' }, { label: 'ДРР', value: '' },
        { label: 'CPO', value: '' }, { label: 'Δ Выручки', value: '' },
      ]} />
    </div>
  )
  if (error) return <div className="px-6 py-16 text-center" style={{ color: 'var(--danger)' }}>{error}</div>
  if (!data) return null

  const s = data.summary
  const dailyFmt = (data.daily ?? []).map(d => ({
    date: fmtDate(d.date),
    'Выручка': d.revenue,
    'ЧМД': d.chmd,
    'Расходы': d.expenses,
    'Маржа%': +(d.margin_pct * 100).toFixed(1),
    'ДРР%': +(d.drr * 100).toFixed(1),
  }))

  const hasFilter = catFilter.margin !== 'all' || catFilter.drr !== 'all'
  const filteredCats = (data.by_category ?? []).filter(c => {
    if (catFilter.margin === 'low' && c.margin_pct >= 0.15) return false
    if (catFilter.margin === 'mid' && (c.margin_pct < 0.15 || c.margin_pct > 0.25)) return false
    if (catFilter.margin === 'high' && c.margin_pct <= 0.25) return false
    if (catFilter.drr === 'over' && c.drr <= c.margin_pct) return false
    if (catFilter.drr === 'under' && c.drr > c.margin_pct) return false
    return true
  }).sort((a, b) => {
    const mult = sortDir === 'asc' ? 1 : -1
    return ((a[sortKey] ?? 0) - (b[sortKey] ?? 0)) * mult
  })

  function exportCats() {
    exportToExcel(filteredCats.map(c => ({
      'Категория': c.category, 'SKU': c.sku_count, 'Выручка': c.revenue,
      'Δ%': c.delta_pct, 'ЧМД': c.chmd, 'Маржа%': (c.margin_pct * 100).toFixed(1),
      'ДРР%': (c.drr * 100).toFixed(1), 'Остаток': c.stock_rub,
    })), 'Аналитика_категории')
  }

  return (
    <div className="px-6 py-6 space-y-6 max-w-[1440px] mx-auto">

      {/* KPI bar — единый стиль */}
      <KPIBar items={[
        { label: 'Выручка', value: fmt(s.revenue), delta: s.revenue_prev ? ((s.revenue - s.revenue_prev) / s.revenue_prev * 100).toFixed(1) + '%' : undefined, deltaPositive: s.revenue >= s.revenue_prev },
        { label: 'ЧМД', value: fmt(s.chmd) },
        { label: 'Маржа %', value: fmtPct(s.margin_pct), danger: s.margin_pct < 0.10 },
        { label: 'ДРР', value: fmtPct(s.drr) },
        { label: 'CPO', value: s.cpo ? fmt(s.cpo) + ' ₽' : '—' },
        { label: 'Δ Выручки', value: s.delta_revenue_pct != null ? (s.delta_revenue_pct > 0 ? '+' : '') + s.delta_revenue_pct.toFixed(1) + '%' : '—', deltaPositive: (s.delta_revenue_pct ?? 0) >= 0 },
        { label: 'Прогноз 60д', value: s.revenue > 0 ? fmt(Math.round(s.revenue / 30 * 60)) : '—', accent: true },
      ]} />

      {/* Charts */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <GlassCard padding="lg">
          <p className="text-sm font-semibold mb-4" style={{ color: 'var(--text)' }}>Выручка и расходы по дням</p>
          {dailyFmt.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={dailyFmt} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="revG" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="chmdG" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--success)" stopOpacity={0.20} />
                    <stop offset="95%" stopColor="var(--success)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.6} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis yAxisId="left" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} width={44} tickFormatter={v => fmt(v as number)} />
                <Tooltip content={<ChartTip />} />
                <Area yAxisId="left" type="monotone" dataKey="Выручка" stroke="var(--accent)" strokeWidth={2} fill="url(#revG)" dot={false} />
                <Area yAxisId="left" type="monotone" dataKey="ЧМД" stroke="var(--success)" strokeWidth={2} fill="url(#chmdG)" dot={false} />
                <Area yAxisId="left" type="monotone" dataKey="Расходы" stroke="var(--danger)" strokeWidth={1.5} fill="none" dot={false} strokeDasharray="4 2" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-56 text-sm" style={{ color: 'var(--text-muted)' }}>Нет данных</div>
          )}
        </GlassCard>

        <GlassCard padding="lg">
          <p className="text-sm font-semibold mb-4" style={{ color: 'var(--text)' }}>Маржа % vs ДРР % по дням</p>
          {dailyFmt.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={dailyFmt} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.6} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} width={36} tickFormatter={v => `${v}%`} />
                <Tooltip content={<ChartTip />} />
                <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="Маржа%" stroke="var(--success)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                <Line type="monotone" dataKey="ДРР%" stroke="var(--accent)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} strokeDasharray="4 2" />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-56 text-sm" style={{ color: 'var(--text-muted)' }}>Нет данных</div>
          )}
        </GlassCard>
      </div>

      {/* По категориям */}
      <GlassCard padding="lg">
        <div className="mb-4">
          <FilterBar
            filters={[
              { label: 'Маржа', key: 'margin', options: [
                { value: 'all', label: 'Все' },
                { value: 'low', label: '<15%' },
                { value: 'mid', label: '15–25%' },
                { value: 'high', label: '>25%' },
              ]},
              { label: 'ДРР vs Маржа', key: 'drr', options: [
                { value: 'all', label: 'Все' },
                { value: 'over', label: 'ДРР > Маржи' },
                { value: 'under', label: 'ДРР ≤ Маржи' },
              ]},
            ]}
            values={catFilter}
            onChange={(k, v) => setCatFilter(f => ({ ...f, [k]: v }))}
            onReset={() => setCatFilter({ margin: 'all', drr: 'all' })}
            hasActive={hasFilter}
            onExport={exportCats}
            summary={<span className="text-xs" style={{ color: 'var(--text-muted)' }}>По категориям · {filteredCats.length}</span>}
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs">
                <th className="text-left pb-3 font-medium" style={{ color: 'var(--text-subtle)' }}>Категория</th>
                <SortTh label="SKU" sortKey="sku_count" current={sortKey} dir={sortDir} onClick={toggleSort} />
                <SortTh label="Выручка" sortKey="revenue" current={sortKey} dir={sortDir} onClick={toggleSort} />
                <SortTh label="Δ%" sortKey="delta_pct" current={sortKey} dir={sortDir} onClick={toggleSort} />
                <SortTh label="ЧМД" sortKey="chmd" current={sortKey} dir={sortDir} onClick={toggleSort} />
                <SortTh label="Маржа" sortKey="margin_pct" current={sortKey} dir={sortDir} onClick={toggleSort} />
                <SortTh label="ДРР" sortKey="drr" current={sortKey} dir={sortDir} onClick={toggleSort} />
                <th className="text-right pb-3 font-medium" style={{ color: 'var(--text-subtle)' }}>Остаток</th>
              </tr>
            </thead>
            <tbody>
              {filteredCats.map((cat, i) => {
                const isLow = cat.margin_pct < 0.10
                const dUp = (cat.delta_pct ?? 0) > 0
                return (
                  <tr key={i} className="border-t" style={{ borderColor: 'var(--border)' }}>
                    <td className="py-2.5 pr-4 font-medium" style={{ color: 'var(--text)' }}>{cat.category}</td>
                    <td className="py-2.5 text-right" style={{ color: 'var(--text-muted)' }}>{cat.sku_count}</td>
                    <td className="py-2.5 text-right font-semibold" style={{ color: 'var(--text)' }}>{fmt(cat.revenue)}</td>
                    <td className="py-2.5 text-right">
                      <span className="text-xs font-semibold" style={{ color: dUp ? 'var(--success)' : 'var(--danger)' }}>
                        {cat.delta_pct != null ? (dUp ? '+' : '') + cat.delta_pct.toFixed(1) + '%' : '—'}
                      </span>
                    </td>
                    <td className="py-2.5 text-right" style={{ color: 'var(--text-muted)' }}>{fmt(cat.chmd)}</td>
                    <td className="py-2.5 text-right">
                      <span className="px-2 py-0.5 rounded text-xs font-medium" style={{ background: isLow ? 'var(--danger-bg)' : 'var(--success-bg)', color: isLow ? 'var(--danger)' : 'var(--success)' }}>{fmtPct(cat.margin_pct)}</span>
                    </td>
                    <td className="py-2.5 text-right" style={{ color: 'var(--text-muted)' }}>{fmtPct(cat.drr)}</td>
                    <td className="py-2.5 text-right" style={{ color: 'var(--text-muted)' }}>{fmt(cat.stock_rub)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </GlassCard>
    </div>
  )
}
