'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  AreaChart, Area, LineChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts'
import {
  Zap, ChevronRight, AlertCircle, AlertTriangle, TrendingDown, TrendingUp,
  Download, ShoppingCart, Rocket,
} from 'lucide-react'
import { GlassCard } from '@/components/ui/GlassCard'
import { AlertBox } from '@/components/ui/AlertBox'
import { KPIBar } from '@/components/ui/KPIBar'
import { usePendingFilter } from '@/app/dashboard/page'
import { exportToExcel } from '@/lib/exportExcel'
import { useDateRange } from '@/components/ui/DateRangePicker'

// ── Types ─────────────────────────────────────────────────────────────────────

interface OverviewData {
  kpi: {
    revenue: number
    chmd: number
    avg_margin_pct: number
    drr: number | null
    ad_spend: number
    cost_of_goods: number
    lost_revenue: number
    oos_count: number
    sku_count: number
  }
  alerts: {
    stop_ads: number
    soon_oos: number
    drr_over_margin: number
    high_ctr_low_cr: number
    lost_revenue: number
  }
  abc: { A: number; B: number; C: number }
  trend: Array<{ date: string; revenue: number; chmd: number; ad_spend: number }>
  unit_econ: Array<{ date: string; margin_pct: number; drr_pct: number }>
  top15: Array<{
    sku_ms: string
    sku_wb: number | null
    name: string
    revenue: number
    chmd: number
    drr: number
    margin_pct: number
    stock_days: number
    lead_time: number
    abc_class: string
    score: number
    is_oos: boolean
  }>
  latest_date: string | null
  period: { from: string | null; to: string | null }
}

// ── Formatters ────────────────────────────────────────────────────────────────

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
  return d.getDate().toString().padStart(2, '0') + '.' + (d.getMonth() + 1).toString().padStart(2, '0')
}

// ── Animations ────────────────────────────────────────────────────────────────

const fadeUp = { hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0, transition: { duration: 0.3 } } }

// ── Custom Tooltip ────────────────────────────────────────────────────────────

interface ChartTipProps {
  active?: boolean
  payload?: Array<{ name: string; value: number; color: string }>
  label?: string
  pct?: boolean
}

function ChartTip({ active, payload, label, pct }: ChartTipProps) {
  if (!active || !payload?.length) return null
  return (
    <div className="glass p-3 text-xs min-w-[140px]" style={{ color: 'var(--text)' }}>
      <p className="font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>{label}</p>
      {payload.map(p => (
        <div key={p.name} className="flex items-center gap-2 mb-1">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span style={{ color: 'var(--text-muted)' }}>{p.name}:</span>
          <span className="font-bold ml-auto">
            {pct ? p.value.toFixed(1) + '%' : fmt(p.value)}
          </span>
        </div>
      ))}
    </div>
  )
}

// ── SKU Score badge ───────────────────────────────────────────────────────────

function ScoreBadge({ score }: { score: number }) {
  let color: string
  let bg: string
  if (score >= 80) { color = 'var(--success)'; bg = 'var(--success-bg)' }
  else if (score >= 60) { color = '#22d3ee'; bg = 'rgba(34,211,238,0.12)' }
  else if (score >= 40) { color = 'var(--warning)'; bg = 'var(--warning-bg)' }
  else if (score >= 20) { color = 'var(--accent)'; bg = 'rgba(var(--accent-rgb),0.12)' }
  else { color = 'var(--danger)'; bg = 'var(--danger-bg)' }
  return (
    <span className="text-xs font-bold px-2 py-0.5 rounded-lg" style={{ color, background: bg }}>
      {Math.round(score)}
    </span>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function OverviewTab() {
  const [data, setData] = useState<OverviewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { navigateToSku } = usePendingFilter()
  const { range } = useDateRange()

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetch(`/api/dashboard/overview?from=${range.from}&to=${range.to}`)
      .then(r => r.json())
      .then((d: OverviewData) => { setData(d); setLoading(false) })
      .catch((e: unknown) => { setError(String(e)); setLoading(false) })
  }, [range.from, range.to])

  // ── Loading state ────────────────────────────────────────────────────────
  if (loading) return (
    <div className="px-6 py-6 space-y-6 max-w-[1440px] mx-auto">
      <KPIBar loading items={[
        { label: 'Выручка', value: '' },
        { label: 'ЧМД', value: '' },
        { label: 'Маржа %', value: '' },
        { label: 'ДРР', value: '' },
        { label: 'Расходы', value: '' },
        { label: 'Себестоимость', value: '' },
        { label: 'Потери', value: '' },
      ]} />
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <GlassCard><div className="skeleton h-56 w-full" /></GlassCard>
        <GlassCard><div className="skeleton h-56 w-full" /></GlassCard>
      </div>
    </div>
  )

  if (error) return (
    <div className="px-6 py-16 text-center" style={{ color: 'var(--danger)' }}>{error}</div>
  )

  if (!data) return null

  const drr = data.kpi.drr ?? 0
  const isHighDrr = data.kpi.avg_margin_pct > 0 && drr > data.kpi.avg_margin_pct

  const trendData = data.trend.map(r => ({
    date: fmtDate(r.date),
    'Выручка': r.revenue,
    'ЧМД': r.chmd,
    'Расходы': r.ad_spend,
  }))

  const unitEconData = data.unit_econ.map(r => ({
    date: fmtDate(r.date),
    'Маржа %': r.margin_pct,
    'ДРР %': r.drr_pct,
  }))

  return (
    <div className="px-6 py-6 space-y-6 max-w-[1440px] mx-auto">

      {/* ── KPI Bar ─────────────────────────────────────────────────────── */}
      <KPIBar items={[
        {
          label: 'Выручка',
          value: fmt(data.kpi.revenue),
          delta: '—',
        },
        {
          label: 'ЧМД',
          value: fmt(data.kpi.chmd),
          delta: '—',
          danger: data.kpi.chmd < 0,
        },
        {
          label: 'Маржа %',
          value: fmtPct(data.kpi.avg_margin_pct),
          delta: '—',
        },
        {
          label: 'ДРР',
          value: drr > 0 ? (drr * 100).toFixed(1) + '%' : '—',
          delta: '—',
          danger: isHighDrr,
        },
        {
          label: 'Расходы',
          value: fmt(data.kpi.ad_spend),
          delta: '—',
        },
        {
          label: 'Себестоимость',
          value: fmt(data.kpi.cost_of_goods),
          delta: '—',
        },
        {
          label: 'Потери',
          value: data.kpi.lost_revenue > 0 ? fmt(data.kpi.lost_revenue) : '—',
          delta: '—',
          danger: data.kpi.lost_revenue > 0,
        },
      ]} />

      {/* ── Charts ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">

        {/* Chart 1: Динамика выручки, ЧМД и Расходов */}
        <GlassCard padding="lg">
          <p className="text-sm font-semibold mb-4" style={{ color: 'var(--text)' }}>
            Динамика выручки, ЧМД и Расходов
          </p>
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
                  <linearGradient id="spendGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--danger)" stopOpacity={0.20} />
                    <stop offset="95%" stopColor="var(--danger)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.6} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} width={48} tickFormatter={v => fmt(v as number)} />
                <Tooltip content={<ChartTip />} />
                <Legend wrapperStyle={{ fontSize: 10, paddingTop: 8 }} />
                <Area type="monotone" dataKey="Выручка" stroke="var(--accent)" strokeWidth={2} fill="url(#revGrad)" dot={false} activeDot={{ r: 4 }} />
                <Area type="monotone" dataKey="ЧМД" stroke="var(--success)" strokeWidth={2} fill="url(#chmdGrad)" dot={false} activeDot={{ r: 4 }} />
                <Area type="monotone" dataKey="Расходы" stroke="var(--danger)" strokeWidth={1.5} fill="url(#spendGrad)" dot={false} activeDot={{ r: 4 }} strokeDasharray="4 2" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-56 text-sm" style={{ color: 'var(--text-muted)' }}>Нет данных</div>
          )}
        </GlassCard>

        {/* Chart 2: Unit-экономика — Маржа% vs ДРР% */}
        <GlassCard padding="lg">
          <p className="text-sm font-semibold mb-4" style={{ color: 'var(--text)' }}>
            Unit-экономика по дням
          </p>
          {unitEconData.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={unitEconData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.6} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} width={36} tickFormatter={v => (v as number).toFixed(0) + '%'} />
                <Tooltip content={<ChartTip pct />} />
                <Legend wrapperStyle={{ fontSize: 10, paddingTop: 8 }} />
                <Line type="monotone" dataKey="Маржа %" stroke="var(--success)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                <Line type="monotone" dataKey="ДРР %" stroke="var(--danger)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} strokeDasharray="5 3" />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-56 text-sm" style={{ color: 'var(--text-muted)' }}>Нет данных</div>
          )}
        </GlassCard>
      </div>

      {/* ── Alerts + Фокус дня ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">

        {/* Алерты */}
        <GlassCard padding="lg" className="xl:col-span-1">
          <p className="text-sm font-semibold mb-3" style={{ color: 'var(--text)' }}>Алерты</p>
          <div className="space-y-2">
            <AlertBox
              icon={<AlertCircle size={14} />}
              title="STOP реклама"
              count={data.alerts.stop_ads}
              severity="critical"
              description={data.alerts.stop_ads > 0 ? ('Потеря: ' + fmt(data.alerts.lost_revenue) + ' ₽') : 'OOS + активная реклама'}
              onClick={data.alerts.stop_ads > 0 ? () => navigateToSku({ type: 'stop_ads', label: 'STOP реклама: OOS + активная реклама' }) : undefined}
            />
            <AlertBox
              icon={<AlertTriangle size={14} />}
              title="Скоро OOS"
              count={data.alerts.soon_oos}
              severity="warning"
              description="Запас < логистического плеча"
              onClick={data.alerts.soon_oos > 0 ? () => navigateToSku({ type: 'low_stock', label: 'Скоро OOS: запас < лог. плеча' }) : undefined}
            />
            <AlertBox
              icon={<TrendingDown size={14} />}
              title="ДРР > Маржа"
              count={data.alerts.drr_over_margin}
              severity="warning"
              description="Реклама работает в убыток"
              onClick={data.alerts.drr_over_margin > 0 ? () => navigateToSku({ type: 'drr_over', label: 'ДРР > Маржа' }) : undefined}
            />
            <AlertBox
              icon={<Rocket size={14} />}
              title="Высокий CTR / низкий CR"
              count={data.alerts.high_ctr_low_cr}
              severity="success"
              description="Потенциал: проблема в карточке/цене"
              onClick={data.alerts.high_ctr_low_cr > 0 ? () => navigateToSku({ type: 'potential', label: 'Потенциал: высокий CTR + низкий CR' }) : undefined}
            />
          </div>
        </GlassCard>

        {/* Фокус дня */}
        <GlassCard padding="lg" className="xl:col-span-2">
          <div className="flex items-center gap-2 mb-4">
            <Zap size={14} style={{ color: 'var(--accent)' }} />
            <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Фокус дня</p>
          </div>
          <div className="space-y-2">

            {/* 1. STOP реклама */}
            {data.alerts.stop_ads > 0 && (
              <motion.div
                whileHover={{ scale: 1.01, y: -2 }}
                className="flex items-start gap-3 p-3 rounded-xl cursor-pointer"
                style={{ background: 'var(--danger-bg)' }}
                onClick={() => navigateToSku({ type: 'stop_ads', label: 'STOP реклама' })}
              >
                <AlertCircle size={15} style={{ color: 'var(--danger)', flexShrink: 0, marginTop: 1 }} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold" style={{ color: 'var(--danger)' }}>Стоп реклама</p>
                  <p className="text-sm" style={{ color: 'var(--text)' }}>
                    {data.alerts.stop_ads} SKU — нет стока, активная реклама.{' '}
                    <span style={{ color: 'var(--danger)' }}>Потеря: {fmt(data.alerts.lost_revenue)} ₽</span>
                  </p>
                </div>
                <ChevronRight size={14} style={{ color: 'var(--text-subtle)', flexShrink: 0 }} />
              </motion.div>
            )}

            {/* 2. Заказать пополнение */}
            {data.alerts.soon_oos > 0 && (
              <motion.div
                whileHover={{ scale: 1.01, y: -2 }}
                className="flex items-start gap-3 p-3 rounded-xl cursor-pointer"
                style={{ background: 'var(--warning-bg)' }}
                onClick={() => navigateToSku({ type: 'low_stock', label: 'Скоро OOS' })}
              >
                <ShoppingCart size={15} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: 1 }} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold" style={{ color: 'var(--warning)' }}>Срочный заказ</p>
                  <p className="text-sm" style={{ color: 'var(--text)' }}>
                    {data.alerts.soon_oos} SKU — запас ниже логистического плеча
                  </p>
                </div>
                <ChevronRight size={14} style={{ color: 'var(--text-subtle)', flexShrink: 0 }} />
              </motion.div>
            )}

            {/* 3. ДРР > Маржа — оптимизировать рекламу */}
            {data.alerts.drr_over_margin > 0 && (
              <motion.div
                whileHover={{ scale: 1.01, y: -2 }}
                className="flex items-start gap-3 p-3 rounded-xl cursor-pointer"
                style={{ background: 'var(--warning-bg)' }}
                onClick={() => navigateToSku({ type: 'drr_over', label: 'ДРР > Маржа' })}
              >
                <TrendingDown size={15} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: 1 }} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold" style={{ color: 'var(--warning)' }}>Оптимизировать рекламу</p>
                  <p className="text-sm" style={{ color: 'var(--text)' }}>
                    {data.alerts.drr_over_margin} SKU — ДРР превышает маржу
                  </p>
                </div>
                <ChevronRight size={14} style={{ color: 'var(--text-subtle)', flexShrink: 0 }} />
              </motion.div>
            )}

            {/* 4. Масштабировать — если ДРР низкий и запас ок */}
            {data.kpi.drr != null && data.kpi.avg_margin_pct >= 0.20 && drr < data.kpi.avg_margin_pct * 0.5 && (
              <motion.div
                whileHover={{ scale: 1.01, y: -2 }}
                className="flex items-start gap-3 p-3 rounded-xl cursor-pointer"
                style={{ background: 'var(--success-bg)' }}
                onClick={() => navigateToSku({ type: 'scale', label: 'Масштабировать рекламу' })}
              >
                <TrendingUp size={15} style={{ color: 'var(--success)', flexShrink: 0, marginTop: 1 }} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold" style={{ color: 'var(--success)' }}>Увеличить рекламу</p>
                  <p className="text-sm" style={{ color: 'var(--text)' }}>
                    Маржа {fmtPct(data.kpi.avg_margin_pct)}, ДРР {(drr * 100).toFixed(1)}% — есть запас для роста
                  </p>
                </div>
                <ChevronRight size={14} style={{ color: 'var(--text-subtle)', flexShrink: 0 }} />
              </motion.div>
            )}

            {/* 5. Улучшить карточку */}
            {data.alerts.high_ctr_low_cr > 0 && (
              <motion.div
                whileHover={{ scale: 1.01, y: -2 }}
                className="flex items-start gap-3 p-3 rounded-xl cursor-pointer"
                style={{ background: 'rgba(34,211,238,0.08)' }}
                onClick={() => navigateToSku({ type: 'potential', label: 'Улучшить карточку' })}
              >
                <Rocket size={15} style={{ color: '#22d3ee', flexShrink: 0, marginTop: 1 }} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold" style={{ color: '#22d3ee' }}>Улучшить карточку</p>
                  <p className="text-sm" style={{ color: 'var(--text)' }}>
                    {data.alerts.high_ctr_low_cr} SKU — высокий CTR, низкий CR → проблема в карточке/цене
                  </p>
                </div>
                <ChevronRight size={14} style={{ color: 'var(--text-subtle)', flexShrink: 0 }} />
              </motion.div>
            )}

            {/* Если нет задач */}
            {data.alerts.stop_ads === 0 && data.alerts.soon_oos === 0
              && data.alerts.drr_over_margin === 0 && data.alerts.high_ctr_low_cr === 0
              && !(data.kpi.avg_margin_pct >= 0.20 && drr < data.kpi.avg_margin_pct * 0.5) && (
              <p className="text-sm py-4 text-center" style={{ color: 'var(--text-muted)' }}>
                Критических задач нет
              </p>
            )}
          </div>
        </GlassCard>
      </div>

      {/* ── TOP-15 SKU by Score ────────────────────────────────────────── */}
      <GlassCard padding="lg">
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
            ТОП-15 SKU по SKU Score
          </p>
          <button
            onClick={() => exportToExcel(
              (data.top15 ?? []).map((r, i) => ({
                '#': i + 1,
                'Артикул МС': r.sku_ms,
                'Артикул WB': r.sku_wb,
                'Название': r.name,
                'Score': Math.round(r.score),
                'Выручка': r.revenue,
                'ЧМД': Math.round(r.chmd),
                'ДРР%': (r.drr * 100).toFixed(1),
                'Маржа%': (r.margin_pct * 100).toFixed(1),
                'Остаток дней': r.stock_days,
                'ABC': r.abc_class,
              })),
              'ТОП-15'
            )}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
          >
            <Download size={12} /> Excel
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs" style={{ color: 'var(--text-subtle)', borderBottom: '1px solid var(--border)' }}>
                <th className="text-left pb-2 font-medium w-8">#</th>
                <th className="text-center pb-2 font-medium w-16">Score</th>
                <th className="text-left pb-2 font-medium">Название</th>
                <th className="text-left pb-2 font-medium">Арт. WB</th>
                <th className="text-right pb-2 font-medium">Выручка</th>
                <th className="text-right pb-2 font-medium">ЧМД</th>
                <th className="text-right pb-2 font-medium">ДРР</th>
                <th className="text-right pb-2 font-medium">Маржа</th>
                <th className="text-right pb-2 font-medium">Остаток дн.</th>
              </tr>
            </thead>
            <tbody>
              {(data.top15 ?? []).map((row, i) => {
                const isLowMargin = row.margin_pct < 0.10
                const isOos = row.is_oos
                const isHighDrrRow = row.drr > row.margin_pct && row.margin_pct > 0
                return (
                  <motion.tr
                    key={row.sku_ms}
                    variants={fadeUp}
                    className="border-t cursor-pointer"
                    style={{ borderColor: 'var(--border)' }}
                    onClick={() => navigateToSku({ type: 'sku', label: row.name })}
                    whileHover={{ backgroundColor: 'rgba(255,255,255,0.03)' }}
                  >
                    <td className="py-2 text-xs" style={{ color: 'var(--text-subtle)' }}>{i + 1}</td>
                    <td className="py-2 text-center">
                      <ScoreBadge score={row.score} />
                    </td>
                    <td className="py-2 pr-4 max-w-[200px]">
                      <span className="block truncate text-xs font-medium" style={{ color: 'var(--text)' }}>
                        {row.name}
                      </span>
                      {isOos && (
                        <span className="text-[10px] font-bold" style={{ color: 'var(--danger)' }}>OOS</span>
                      )}
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
                      {row.sku_wb ?? '—'}
                    </td>
                    <td className="py-2 text-right font-semibold text-xs" style={{ color: 'var(--text)' }}>
                      {fmt(row.revenue)}
                    </td>
                    <td className="py-2 text-right text-xs" style={{ color: row.chmd < 0 ? 'var(--danger)' : 'var(--success)' }}>
                      {fmt(row.chmd)}
                    </td>
                    <td className="py-2 text-right">
                      <span className="text-xs px-1.5 py-0.5 rounded"
                        style={{
                          background: isHighDrrRow ? 'var(--danger-bg)' : 'var(--success-bg)',
                          color: isHighDrrRow ? 'var(--danger)' : 'var(--success)',
                        }}
                      >
                        {(row.drr * 100).toFixed(1)}%
                      </span>
                    </td>
                    <td className="py-2 text-right">
                      <span className="text-xs px-1.5 py-0.5 rounded"
                        style={{
                          background: isLowMargin ? 'var(--danger-bg)' : 'var(--success-bg)',
                          color: isLowMargin ? 'var(--danger)' : 'var(--success)',
                        }}
                      >
                        {(row.margin_pct * 100).toFixed(1)}%
                      </span>
                    </td>
                    <td className="py-2 text-right text-xs"
                      style={{
                        color: row.stock_days < row.lead_time
                          ? 'var(--danger)'
                          : row.stock_days < row.lead_time * 1.5
                          ? 'var(--warning)'
                          : 'var(--text-muted)',
                      }}
                    >
                      {row.stock_days >= 999 ? '∞' : row.stock_days}
                    </td>
                  </motion.tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </GlassCard>

    </div>
  )
}
