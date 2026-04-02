'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  BarChart, Bar, CartesianGrid,
} from 'recharts'
import { Package, TrendingDown, ShoppingBag, AlertTriangle, Zap, BarChart2 } from 'lucide-react'
import { GlassCard } from '@/components/ui/GlassCard'
import { StatCard } from '@/components/ui/StatCard'
import { AlertBox } from '@/components/ui/AlertBox'

// ── types ─────────────────────────────────────────────────────────────────────

interface OverviewData {
  kpi: {
    revenue: number
    chmd: number
    avg_margin_pct: number
    oos_count: number
    sku_count: number
  }
  stock: { total_fbo: number; total_fbs: number; total_stock: number; sku_count: number }
  abc: { A: number; B: number; C: number }
  trend: Array<{ date: string; sales_qty: number }>
  categories: Array<{ category: string; revenue: number; chmd: number; sku_count: number }>
  managers: Array<{ manager: string; revenue: number; chmd: number; sku_count: number; margin_pct: number }>
  latest_date: string | null
}

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'М'
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(0) + 'К'
  return String(Math.round(n))
}

function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  return (n * 100).toFixed(1) + '%'
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getDate().toString().padStart(2, '0')}.${(d.getMonth() + 1).toString().padStart(2, '0')}`
}

// ── animation variants ────────────────────────────────────────────────────────

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07 } },
}

const item = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35 } },
}

// ── skeletons ─────────────────────────────────────────────────────────────────

function SkeletonGrid({ count }: { count: number }) {
  const items = Array.from({ length: count })
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      {items.map((_, i) => (
        <GlassCard key={i}>
          <div className="space-y-3">
            <div className="skeleton h-4 w-20" />
            <div className="skeleton h-8 w-28" />
            <div className="skeleton h-3 w-14" />
          </div>
        </GlassCard>
      ))}
    </div>
  )
}

// ── custom tooltip ────────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="glass p-3 text-xs min-w-[120px]" style={{ color: 'var(--text)' }}>
      <p className="font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>{label}</p>
      {payload.map(p => (
        <div key={p.name} className="flex items-center gap-2 mb-1">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: p.color }} />
          <span style={{ color: 'var(--text-muted)' }}>{p.name}:</span>
          <span className="font-bold ml-auto">{fmtNum(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

// ── main component ────────────────────────────────────────────────────────────

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

  // ── loading ──────────────────────────────────────────────────────────────

  if (loading) return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
      <SkeletonGrid count={5} />
      <SkeletonGrid count={4} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <GlassCard><div className="skeleton h-48 w-full" /></GlassCard>
        <GlassCard><div className="skeleton h-48 w-full" /></GlassCard>
      </div>
    </div>
  )

  // ── error ────────────────────────────────────────────────────────────────

  if (error) return (
    <div className="max-w-xl mx-auto px-4 py-16 text-center" style={{ color: 'var(--danger)' }}>
      {error}
    </div>
  )

  if (!data) return null

  // ── derived data ──────────────────────────────────────────────────────────

  const trendData = data.trend.map(r => ({
    date: fmtDate(r.date),
    Продажи: r.sales_qty,
  }))

  const catData = data.categories.map(c => ({
    name: c.category.length > 18 ? c.category.slice(0, 18) + '…' : c.category,
    Выручка: Math.round(c.revenue / 1000),
  }))

  const abcTotal = data.abc.A + data.abc.B + data.abc.C

  // Build alert counts from available data
  const alertOos = data.kpi.oos_count
  const alertLowMargin = data.managers.filter(m => m.margin_pct < 0.1).length
  const alertHighA = data.abc.A
  const alertCatCount = data.categories.length
  const alertOther = Math.max(0, data.kpi.sku_count - abcTotal)

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">

      {/* Period bar */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text)' }}>Обзор</h2>
          {data.latest_date && (
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
              Данные по: {fmtDate(data.latest_date)} · Последние 30 дней
            </p>
          )}
        </div>
        <div className="text-xs px-3 py-1.5 rounded-lg" style={{ background: 'var(--bg-secondary)', color: 'var(--text-muted)' }}>
          Последние 30 дней
        </div>
      </div>

      {/* KPI row */}
      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="grid grid-cols-2 md:grid-cols-5 gap-3"
      >
        <motion.div variants={item}>
          <StatCard
            label="Выручка (период)"
            value={fmtNum(data.kpi.revenue)}
            icon={<ShoppingBag size={16} />}
          />
        </motion.div>
        <motion.div variants={item}>
          <StatCard
            label="ЧМД (период)"
            value={fmtNum(data.kpi.chmd)}
            icon={<TrendingDown size={16} />}
          />
        </motion.div>
        <motion.div variants={item}>
          <StatCard
            label="Средняя маржа"
            value={fmtPct(data.kpi.avg_margin_pct)}
            icon={<BarChart2 size={16} />}
            accent={data.kpi.avg_margin_pct < 0.1}
          />
        </motion.div>
        <motion.div variants={item}>
          <StatCard
            label="Всего остатки"
            value={fmtNum(data.stock.total_stock)}
            icon={<Package size={16} />}
            deltaLabel={`FBO: ${fmtNum(data.stock.total_fbo)} / FBS: ${fmtNum(data.stock.total_fbs)}`}
          />
        </motion.div>
        <motion.div variants={item}>
          <StatCard
            label="OOS (нет товара)"
            value={String(data.kpi.oos_count)}
            icon={<AlertTriangle size={16} />}
            accent={data.kpi.oos_count > 10}
          />
        </motion.div>
      </motion.div>

      {/* ABC row */}
      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="grid grid-cols-2 md:grid-cols-4 gap-3"
      >
        <motion.div variants={item}>
          <StatCard
            label="Всего артикулов"
            value={String(data.kpi.sku_count)}
            icon={<Package size={16} />}
          />
        </motion.div>
        <motion.div variants={item}>
          <StatCard
            label="ABC — Класс A"
            value={String(data.abc.A)}
            deltaLabel={abcTotal > 0 ? fmtPct(data.abc.A / abcTotal) : undefined}
          />
        </motion.div>
        <motion.div variants={item}>
          <StatCard
            label="ABC — Класс B"
            value={String(data.abc.B)}
            deltaLabel={abcTotal > 0 ? fmtPct(data.abc.B / abcTotal) : undefined}
          />
        </motion.div>
        <motion.div variants={item}>
          <StatCard
            label="ABC — Класс C"
            value={String(data.abc.C)}
            accent={data.abc.C > data.abc.A}
            deltaLabel={abcTotal > 0 ? fmtPct(data.abc.C / abcTotal) : undefined}
          />
        </motion.div>
      </motion.div>

      {/* Alert boxes */}
      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
      >
        <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text)' }}>Алерты</h3>
        <div className="flex gap-3 overflow-x-auto pb-1">
          <div className="min-w-[180px] flex-shrink-0">
            <AlertBox
              icon="🚨"
              title="Стоп реклама"
              count={alertOos}
              severity="critical"
              onClick={() => console.log('filter: oos + active ads')}
            />
          </div>
          <div className="min-w-[180px] flex-shrink-0">
            <AlertBox
              icon="🚀"
              title="Потенциал роста"
              count={alertHighA}
              severity="success"
              onClick={() => console.log('filter: potential growth')}
            />
          </div>
          <div className="min-w-[180px] flex-shrink-0">
            <AlertBox
              icon="📈"
              title="Увеличить рекламу"
              count={alertCatCount}
              severity="info"
              onClick={() => console.log('filter: increase ads')}
            />
          </div>
          <div className="min-w-[180px] flex-shrink-0">
            <AlertBox
              icon="⚠️"
              title="Новинки в риске"
              count={alertOther}
              severity="warning"
              onClick={() => console.log('filter: novelty at risk')}
            />
          </div>
          <div className="min-w-[180px] flex-shrink-0">
            <AlertBox
              icon="💸"
              title="Высокий CPO"
              count={alertLowMargin}
              severity="warning"
              onClick={() => console.log('filter: high CPO')}
            />
          </div>
        </div>
      </motion.div>

      {/* Charts row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* Sales trend */}
        <GlassCard padding="md">
          <p className="text-sm font-semibold mb-4" style={{ color: 'var(--text)' }}>
            Продажи по дням (30 дней)
          </p>
          {trendData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={trendData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.5} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                  tickLine={false}
                  axisLine={false}
                  width={40}
                  tickFormatter={v => fmtNum(v as number)}
                />
                <Tooltip content={<ChartTooltip />} />
                <Area
                  type="monotone"
                  dataKey="Продажи"
                  stroke="var(--accent)"
                  strokeWidth={2}
                  fill="url(#salesGrad)"
                  dot={false}
                  activeDot={{ r: 4, fill: 'var(--accent)' }}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-48 text-sm" style={{ color: 'var(--text-muted)' }}>
              Нет данных о продажах
            </div>
          )}
        </GlassCard>

        {/* Category bar chart */}
        <GlassCard padding="md">
          <p className="text-sm font-semibold mb-4" style={{ color: 'var(--text)' }}>
            Выручка по категориям (тыс. руб.)
          </p>
          {catData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart
                data={catData}
                layout="vertical"
                margin={{ top: 0, right: 8, bottom: 0, left: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.5} horizontal={false} />
                <XAxis
                  type="number"
                  tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={v => fmtNum(v as number)}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fontSize: 9, fill: 'var(--text-muted)' }}
                  tickLine={false}
                  axisLine={false}
                  width={100}
                />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="Выручка" fill="var(--accent)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-48 text-sm" style={{ color: 'var(--text-muted)' }}>
              Нет данных по категориям
            </div>
          )}
        </GlassCard>
      </div>

      {/* Categories table */}
      {data.categories.length > 0 && (
        <GlassCard padding="md">
          <p className="text-sm font-semibold mb-4" style={{ color: 'var(--text)' }}>Рейтинг категорий</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  <th className="text-left pb-3 font-medium">Категория</th>
                  <th className="text-right pb-3 font-medium">SKU</th>
                  <th className="text-right pb-3 font-medium">Выручка</th>
                  <th className="text-right pb-3 font-medium">ЧМД</th>
                  <th className="text-right pb-3 font-medium">Маржа</th>
                </tr>
              </thead>
              <tbody>
                {data.categories.map((cat, i) => {
                  const margin = cat.revenue > 0 ? cat.chmd / cat.revenue : 0
                  const isLow = margin < 0.1 && cat.revenue > 0
                  return (
                    <tr
                      key={cat.category}
                      className="border-t"
                      style={{ borderColor: 'var(--border)' }}
                    >
                      <td className="py-2.5 pr-4" style={{ color: 'var(--text)' }}>
                        <div className="flex items-center gap-2">
                          <span
                            className="w-5 h-5 rounded flex items-center justify-center text-xs font-bold flex-shrink-0"
                            style={{ background: i < 3 ? 'var(--accent-glow)' : 'var(--bg-secondary)', color: i < 3 ? 'var(--accent)' : 'var(--text-muted)' }}
                          >
                            {i + 1}
                          </span>
                          {cat.category}
                        </div>
                      </td>
                      <td className="py-2.5 text-right" style={{ color: 'var(--text-muted)' }}>{cat.sku_count}</td>
                      <td className="py-2.5 text-right font-medium" style={{ color: 'var(--text)' }}>{fmtNum(cat.revenue)}</td>
                      <td className="py-2.5 text-right" style={{ color: 'var(--text-muted)' }}>{fmtNum(cat.chmd)}</td>
                      <td className="py-2.5 text-right">
                        <span
                          className="px-2 py-0.5 rounded text-xs font-medium"
                          style={{
                            background: isLow ? 'rgba(239,68,68,0.1)' : 'rgba(16,185,129,0.1)',
                            color: isLow ? '#EF4444' : '#10B981',
                          }}
                        >
                          {fmtPct(margin)}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </GlassCard>
      )}

      {/* Managers table */}
      {data.managers.length > 0 && (
        <GlassCard padding="md">
          <p className="text-sm font-semibold mb-4" style={{ color: 'var(--text)' }}>
            <Zap size={14} className="inline mr-1.5" style={{ color: 'var(--accent)' }} />
            По менеджерам
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  <th className="text-left pb-3 font-medium">Менеджер</th>
                  <th className="text-right pb-3 font-medium">SKU</th>
                  <th className="text-right pb-3 font-medium">Выручка</th>
                  <th className="text-right pb-3 font-medium">ЧМД</th>
                  <th className="text-right pb-3 font-medium">Маржа</th>
                </tr>
              </thead>
              <tbody>
                {data.managers.map(m => {
                  const isLow = m.margin_pct < 0.1 && m.revenue > 0
                  return (
                    <tr
                      key={m.manager}
                      className="border-t"
                      style={{ borderColor: 'var(--border)' }}
                    >
                      <td className="py-2.5 pr-4 font-medium" style={{ color: 'var(--text)' }}>{m.manager}</td>
                      <td className="py-2.5 text-right" style={{ color: 'var(--text-muted)' }}>{m.sku_count}</td>
                      <td className="py-2.5 text-right font-medium" style={{ color: 'var(--text)' }}>{fmtNum(m.revenue)}</td>
                      <td className="py-2.5 text-right" style={{ color: 'var(--text-muted)' }}>{fmtNum(m.chmd)}</td>
                      <td className="py-2.5 text-right">
                        <span
                          className="px-2 py-0.5 rounded text-xs font-medium"
                          style={{
                            background: isLow ? 'rgba(239,68,68,0.1)' : 'rgba(16,185,129,0.1)',
                            color: isLow ? '#EF4444' : '#10B981',
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
        </GlassCard>
      )}
    </div>
  )
}
