'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import { Zap, ChevronRight } from 'lucide-react'
import { GlassCard } from '@/components/ui/GlassCard'
import { AlertBox } from '@/components/ui/AlertBox'
import { KPIBar } from '@/components/ui/KPIBar'

interface OverviewData {
  kpi: {
    revenue: number
    chmd: number
    avg_margin_pct: number
    drr?: number
    oos_count: number
    sku_count: number
    lost_revenue?: number
  }
  stock: { total_fbo: number; total_fbs: number; total_stock: number; sku_count: number }
  abc: { A: number; B: number; C: number }
  trend: Array<{ date: string; sales_qty: number; revenue?: number; chmd?: number }>
  categories: Array<{ category: string; revenue: number; chmd: number; sku_count: number }>
  managers: Array<{ manager: string; revenue: number; chmd: number; sku_count: number; margin_pct: number }>
  latest_date: string | null
}

function fmt(n: number | null | undefined): string {
  if (n == null) return '—'
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'М'
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(0) + 'К'
  return String(Math.round(n))
}

function fmtPct(n: number | null | undefined): string {
  if (n == null) return '—'
  return (n * 100).toFixed(1) + '%'
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  const day = d.getDate().toString().padStart(2, '0')
  const month = (d.getMonth() + 1).toString().padStart(2, '0')
  return day + '.' + month
}

const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.06 } } }
const fadeUp = { hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0, transition: { duration: 0.3 } } }

interface ChartTipProps {
  active?: boolean
  payload?: Array<{ name: string; value: number; color: string }>
  label?: string
}

function ChartTip({ active, payload, label }: ChartTipProps) {
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


export default function OverviewTab() {
  const [data, setData] = useState<OverviewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/dashboard/overview')
      .then(r => r.json())
      .then((d: OverviewData) => { setData(d); setLoading(false) })
      .catch((e: unknown) => { setError(String(e)); setLoading(false) })
  }, [])

  if (loading) return (
    <div className="px-6 py-6 space-y-6 max-w-[1440px] mx-auto">
      <KPIBar loading items={[
        { label: 'Выручка', value: '' },
        { label: 'ЧМД', value: '' },
        { label: 'Маржа %', value: '' },
        { label: 'ДРР', value: '' },
        { label: 'SKU в риске', value: '' },
        { label: 'Потери', value: '' },
      ]} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <GlassCard><div className="skeleton h-56 w-full" /></GlassCard>
        <GlassCard><div className="skeleton h-56 w-full" /></GlassCard>
      </div>
    </div>
  )

  if (error) return (
    <div className="px-6 py-16 text-center" style={{ color: 'var(--danger)' }}>{error}</div>
  )

  if (!data) return null

  const trendData = data.trend.map(r => ({
    date: fmtDate(r.date),
    'Выручка': r.revenue ?? r.sales_qty,
    'ЧМД': r.chmd ?? 0,
  }))

  const abcTotal = data.abc.A + data.abc.B + data.abc.C
  const drr = data.kpi.drr ?? 0
  const isHighDrr = data.kpi.avg_margin_pct > 0 && drr > data.kpi.avg_margin_pct

  const abcItems: Array<{ cls: 'A' | 'B' | 'C'; count: number; color: string }> = [
    { cls: 'A', count: data.abc.A, color: 'var(--success)' },
    { cls: 'B', count: data.abc.B, color: 'var(--warning)' },
    { cls: 'C', count: data.abc.C, color: 'var(--danger)' },
  ]

  return (
    <div className="px-6 py-6 space-y-6 max-w-[1440px] mx-auto">

      <KPIBar items={[
        { label: 'Выручка', value: fmt(data.kpi.revenue) },
        { label: 'ЧМД', value: fmt(data.kpi.chmd) },
        { label: 'Маржа %', value: fmtPct(data.kpi.avg_margin_pct) },
        { label: 'ДРР', value: drr > 0 ? (drr * 100).toFixed(1) + '%' : '—', danger: isHighDrr },
        { label: 'SKU в риске', value: String(data.kpi.oos_count), danger: data.kpi.oos_count > 0 },
        { label: 'Потери', value: data.kpi.lost_revenue ? fmt(data.kpi.lost_revenue) : '—', danger: (data.kpi.lost_revenue ?? 0) > 0 },
      ]} />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <GlassCard padding="lg" className="xl:col-span-2">
          <p className="text-sm font-semibold mb-4" style={{ color: 'var(--text)' }}>Динамика выручки и ЧМД</p>
          {trendData.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={trendData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="chmdGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--success)" stopOpacity={0.20} />
                    <stop offset="95%" stopColor="var(--success)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.6} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} width={44} tickFormatter={v => fmt(v as number)} />
                <Tooltip content={<ChartTip />} />
                <Area type="monotone" dataKey="Выручка" stroke="var(--accent)" strokeWidth={2} fill="url(#revGrad)" dot={false} activeDot={{ r: 4, fill: 'var(--accent)' }} />
                <Area type="monotone" dataKey="ЧМД" stroke="var(--success)" strokeWidth={2} fill="url(#chmdGrad)" dot={false} activeDot={{ r: 4, fill: 'var(--success)' }} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-56 text-sm" style={{ color: 'var(--text-muted)' }}>Нет данных</div>
          )}
        </GlassCard>

        <div className="space-y-3">
          <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Критические алерты</p>
          <AlertBox icon="🚨" title="STOP реклама" count={data.kpi.oos_count} severity="critical" description={data.kpi.lost_revenue ? ('Потеря: ' + fmt(data.kpi.lost_revenue) + ' ₽') : undefined} onClick={() => {}} />
          <AlertBox icon="⚠️" title="Скоро OOS" count={0} severity="warning" description="Запас < лог. плеча" onClick={() => {}} />
          <AlertBox icon="💸" title="ДРР > Маржа" count={0} severity="warning" onClick={() => {}} />
          <AlertBox icon="🚀" title="Потенциал роста" count={data.abc.A} severity="success" onClick={() => {}} />
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <GlassCard padding="lg">
          <div className="flex items-center gap-2 mb-4">
            <Zap size={14} style={{ color: 'var(--accent)' }} />
            <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Фокус дня</p>
          </div>
          <div className="space-y-3">
            {data.kpi.oos_count > 0 && (
              <div className="flex items-start gap-3 p-3 rounded-xl" style={{ background: 'var(--danger-bg)' }}>
                <span className="text-base">🚨</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold" style={{ color: 'var(--danger)' }}>Стоп реклама</p>
                  <p className="text-sm" style={{ color: 'var(--text)' }}>{data.kpi.oos_count} SKU без стока с активной рекламой</p>
                </div>
                <ChevronRight size={14} style={{ color: 'var(--text-subtle)', flexShrink: 0 }} />
              </div>
            )}
            {data.kpi.avg_margin_pct < 0.10 && (
              <div className="flex items-start gap-3 p-3 rounded-xl" style={{ background: 'var(--warning-bg)' }}>
                <span className="text-base">💸</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold" style={{ color: 'var(--warning)' }}>Низкая маржа</p>
                  <p className="text-sm" style={{ color: 'var(--text)' }}>Средняя маржа {fmtPct(data.kpi.avg_margin_pct)} — ниже порога 10%</p>
                </div>
              </div>
            )}
            {data.kpi.oos_count === 0 && data.kpi.avg_margin_pct >= 0.10 && (
              <p className="text-sm py-4 text-center" style={{ color: 'var(--text-muted)' }}>Критических задач нет</p>
            )}
          </div>
        </GlassCard>

        <GlassCard padding="lg">
          <p className="text-sm font-semibold mb-4" style={{ color: 'var(--text)' }}>По менеджерам</p>
          {data.managers.length === 0 ? (
            <p className="text-sm py-4 text-center" style={{ color: 'var(--text-muted)' }}>Нет данных</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs" style={{ color: 'var(--text-subtle)' }}>
                    <th className="text-left pb-2 font-medium">Менеджер</th>
                    <th className="text-right pb-2 font-medium">SKU</th>
                    <th className="text-right pb-2 font-medium">Выручка</th>
                    <th className="text-right pb-2 font-medium">Маржа</th>
                  </tr>
                </thead>
                <tbody>
                  {data.managers.map(m => {
                    const isLow = m.margin_pct < 0.10
                    return (
                      <tr key={m.manager} className="border-t" style={{ borderColor: 'var(--border)' }}>
                        <td className="py-2 pr-4 font-medium" style={{ color: 'var(--text)' }}>{m.manager}</td>
                        <td className="py-2 text-right" style={{ color: 'var(--text-muted)' }}>{m.sku_count}</td>
                        <td className="py-2 text-right font-semibold" style={{ color: 'var(--text)' }}>{fmt(m.revenue)}</td>
                        <td className="py-2 text-right">
                          <span
                            className="px-2 py-0.5 rounded text-xs font-medium"
                            style={{
                              background: isLow ? 'var(--danger-bg)' : 'var(--success-bg)',
                              color: isLow ? 'var(--danger)' : 'var(--success)',
                            }}
                          >
                            {fmtPct(m.margin_pct)}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </GlassCard>
      </div>

      <GlassCard padding="lg">
        <p className="text-sm font-semibold mb-4" style={{ color: 'var(--text)' }}>ABC — распределение</p>
        <div className="grid grid-cols-3 gap-4">
          {abcItems.map(({ cls, count, color }) => {
            const pct = abcTotal > 0 ? (count / abcTotal * 100).toFixed(0) : '0'
            return (
              <div key={cls} className="text-center p-4 rounded-xl" style={{ background: 'var(--bg)' }}>
                <p className="text-3xl font-black" style={{ color }}>{count}</p>
                <p className="text-xs font-bold mt-1" style={{ color }}>Класс {cls}</p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-subtle)' }}>{pct}% от всех</p>
              </div>
            )
          })}
        </div>
      </GlassCard>
    </div>
  )
}
