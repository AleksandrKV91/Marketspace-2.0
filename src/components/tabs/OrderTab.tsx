'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { GlassCard } from '@/components/ui/GlassCard'
import { StatCard } from '@/components/ui/StatCard'
import { AlertBox } from '@/components/ui/AlertBox'
import { Package, AlertTriangle, TrendingDown, DollarSign, ShoppingBag } from 'lucide-react'

interface OrderRow {
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
  critical: { label: '🚨 Критический', color: 'var(--danger)',  bg: 'var(--danger-bg)' },
  warning:  { label: '⚠️ Внимание',   color: 'var(--warning)', bg: 'var(--warning-bg)' },
  ok:       { label: '✅ Норма',       color: 'var(--success)', bg: 'var(--success-bg)' },
}

const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.06 } } }
const fadeUp = { hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0, transition: { duration: 0.3 } } }

export default function OrderTab() {
  const [data, setData] = useState<OrderData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/dashboard/orders')
      .then(r => r.json())
      .then((d: OrderData) => { setData(d); setLoading(false) })
      .catch((e: unknown) => { setError(String(e)); setLoading(false) })
  }, [])

  if (loading) return (
    <div className="px-6 py-6 space-y-6 max-w-[1440px] mx-auto">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <GlassCard key={i}><div className="space-y-3"><div className="skeleton h-9 w-9 rounded-full" /><div className="skeleton h-4 w-20" /><div className="skeleton h-7 w-28" /></div></GlassCard>
        ))}
      </div>
    </div>
  )
  if (error) return <div className="px-6 py-16 text-center" style={{ color: 'var(--danger)' }}>{error}</div>
  if (!data) return null

  const s = data.summary

  return (
    <div className="px-6 py-6 space-y-6 max-w-[1440px] mx-auto">

      {/* KPI — 5 карточек */}
      <motion.div variants={stagger} initial="hidden" animate="show"
        className="grid grid-cols-2 md:grid-cols-5 gap-3"
      >
        {[
          { label: 'Текущий остаток (руб)',  value: fmt(s.total_stock_rub),   icon: <Package size={16} /> },
          { label: 'Среднее дней до OOS',    value: fmt(s.avg_days_to_oos),   icon: <TrendingDown size={16} />, iconColor: 'var(--warning)', accent: (s.avg_days_to_oos ?? 99) < 14 },
          { label: 'Расчётный заказ (шт)',   value: fmt(s.to_order_count),    icon: <ShoppingBag size={16} />, iconColor: 'var(--info)' },
          { label: 'Сумма к заказу',         value: fmt(s.order_sum_rub),     icon: <DollarSign size={16} />, iconColor: 'var(--success)' },
          { label: 'SKU крит. запас',        value: String(s.critical_count), icon: <AlertTriangle size={16} />, iconColor: 'var(--danger)', accent: s.critical_count > 0 },
        ].map((card, i) => (
          <motion.div key={i} variants={fadeUp}><StatCard {...card} /></motion.div>
        ))}
      </motion.div>

      {/* Alert row */}
      <div className="flex gap-3 flex-wrap">
        <AlertBox icon="🚨" title="Критический запас" count={s.critical_count}  severity="critical" description="Запас < 50% лог. плеча" />
        <AlertBox icon="⚠️" title="Требует внимания"  count={s.warning_count}   severity="warning"  description="Запас < лог. плеча" />
        <AlertBox icon="📭" title="OOS с продажами"   count={s.oos_with_demand} severity="critical" description="Нет стока, есть спрос" />
        <AlertBox icon="📦" title="К заказу"          count={s.to_order_count}  severity="info"     description={`Сумма: ${fmt(s.order_sum_rub)} ₽`} />
      </div>

      {/* Main table */}
      <GlassCard padding="lg">
        <p className="text-sm font-semibold mb-4" style={{ color: 'var(--text)' }}>Таблица запасов и заказов</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs" style={{ color: 'var(--text-subtle)' }}>
                <th className="text-left pb-3 font-medium">SKU WB</th>
                <th className="text-left pb-3 font-medium">Название</th>
                <th className="text-center pb-3 font-medium">Статус</th>
                <th className="text-center pb-3 font-medium">ABC</th>
                <th className="text-right pb-3 font-medium">Продажи 31д</th>
                <th className="text-right pb-3 font-medium">OOS дней</th>
                <th className="text-right pb-3 font-medium">Наличие</th>
                <th className="text-right pb-3 font-medium">Остаток дней</th>
                <th className="text-right pb-3 font-medium">Лог. плечо</th>
                <th className="text-right pb-3 font-medium">Расч. заказ</th>
                <th className="text-right pb-3 font-medium">Заказ менедж.</th>
                <th className="text-right pb-3 font-medium">Δ</th>
                <th className="text-right pb-3 font-medium">Маржа</th>
              </tr>
            </thead>
            <tbody>
              {(data.rows ?? []).map((row, i) => {
                const sc = statusCfg[row.status] ?? statusCfg.ok
                const isLowMargin = row.margin_pct < 0.10
                return (
                  <tr key={i} className="border-t" style={{ borderColor: 'var(--border)' }}>
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
              {(data.rows ?? []).length === 0 && (
                <tr><td colSpan={13} className="py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Нет данных. Загрузите таблицы в разделе «Обновление данных».</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </GlassCard>
    </div>
  )
}
