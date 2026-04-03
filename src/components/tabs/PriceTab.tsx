'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
  BarChart, Bar
} from 'recharts'
import { GlassCard } from '@/components/ui/GlassCard'
import { StatCard } from '@/components/ui/StatCard'
import { MousePointerClick, ShoppingCart, ArrowRight, DollarSign, Megaphone, Percent } from 'lucide-react'

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

  useEffect(() => {
    fetch('/api/dashboard/prices')
      .then(r => r.json())
      .then((d: PriceData) => { setData(d); setLoading(false) })
      .catch((e: unknown) => { setError(String(e)); setLoading(false) })
  }, [])

  if (loading) return (
    <div className="px-6 py-6 space-y-6 max-w-[1440px] mx-auto">
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <GlassCard key={i}><div className="space-y-3"><div className="skeleton h-9 w-9 rounded-full" /><div className="skeleton h-4 w-20" /><div className="skeleton h-7 w-28" /></div></GlassCard>
        ))}
      </div>
    </div>
  )
  if (error) return <div className="px-6 py-16 text-center" style={{ color: 'var(--danger)' }}>{error}</div>
  if (!data) return null

  const f = data.funnel
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

      {/* KPI — 6 карточек воронки */}
      <motion.div variants={stagger} initial="hidden" animate="show"
        className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3"
      >
        {[
          { label: 'CTR',                value: f.ctr != null ? (f.ctr * 100).toFixed(2) + '%' : '—',                        icon: <MousePointerClick size={16} />, iconColor: 'var(--info)' },
          { label: 'CR в корзину',       value: f.cr_basket != null ? (f.cr_basket * 100).toFixed(2) + '%' : '—',            icon: <ShoppingCart size={16} />,      iconColor: 'var(--warning)' },
          { label: 'CR в заказ',         value: f.cr_order != null ? (f.cr_order * 100).toFixed(2) + '%' : '—',              icon: <ArrowRight size={16} />,        iconColor: 'var(--success)' },
          { label: 'CPC',                value: f.cpc != null ? fmt(f.cpc) + ' ₽' : '—',                                    icon: <DollarSign size={16} />,        iconColor: 'var(--accent)' },
          { label: 'CPM',                value: f.cpm != null ? fmt(f.cpm) + ' ₽' : '—',                                    icon: <Megaphone size={16} />,         iconColor: 'var(--danger)' },
          { label: 'Доля рекл. заказов', value: f.ad_order_share != null ? (f.ad_order_share * 100).toFixed(1) + '%' : '—', icon: <Percent size={16} />,           iconColor: 'var(--info)' },
        ].map((card, i) => (
          <motion.div key={i} variants={fadeUp}><StatCard {...card} /></motion.div>
        ))}
      </motion.div>

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

      {/* Таблица изменений цен */}
      <GlassCard padding="lg">
        <p className="text-sm font-semibold mb-4" style={{ color: 'var(--text)' }}>Изменения цен и влияние на метрики</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs" style={{ color: 'var(--text-subtle)' }}>
                <th className="text-left pb-3 font-medium">SKU</th>
                <th className="text-left pb-3 font-medium">Название</th>
                <th className="text-left pb-3 font-medium">Менеджер</th>
                <th className="text-right pb-3 font-medium">Дата</th>
                <th className="text-right pb-3 font-medium">Было</th>
                <th className="text-right pb-3 font-medium">Стало</th>
                <th className="text-right pb-3 font-medium">Δ%</th>
                <th className="text-right pb-3 font-medium">Δ CTR</th>
                <th className="text-right pb-3 font-medium">Δ CR корз.</th>
                <th className="text-right pb-3 font-medium">Δ CR заказ</th>
                <th className="text-right pb-3 font-medium">CPO</th>
              </tr>
            </thead>
            <tbody>
              {(data.price_changes ?? []).map((row, i) => {
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
                  </tr>
                )
              })}
              {(data.price_changes ?? []).length === 0 && (
                <tr><td colSpan={11} className="py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Нет изменений цен за выбранный период</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </GlassCard>
    </div>
  )
}
