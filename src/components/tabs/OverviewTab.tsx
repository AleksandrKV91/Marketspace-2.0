'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  ComposedChart, Area, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
  LineChart,
} from 'recharts'
import {
  Zap, ChevronRight, AlertCircle, AlertTriangle, TrendingDown, TrendingUp,
  Download, ShoppingCart, Rocket, Package,
} from 'lucide-react'
import { GlassCard } from '@/components/ui/GlassCard'
import { KPIBar } from '@/components/ui/KPIBar'
import { ScoreBadge } from '@/components/ui/ScoreBadge'
import { SkuModal } from '@/components/ui/SkuModal'
import { usePendingFilter } from '@/app/dashboard/page'
import { useGlobalFilters } from '@/app/dashboard/page'
import { exportToExcel } from '@/lib/exportExcel'
import { useDateRange } from '@/components/ui/DateRangePicker'

// ── Types ─────────────────────────────────────────────────────────────────────

interface FocusSku {
  sku_ms: string
  name: string
  sku_wb: number | null
}

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
  kpi_delta: {
    revenue: number | null
    chmd: number | null
    avg_margin_pct: number | null
    drr: number | null
    ad_spend: number | null
    cost_of_goods: number | null
    lost_revenue: number | null
  }
  alerts: {
    stop_ads: number
    soon_oos: number
    drr_over_margin: number
    high_ctr_low_cr: number
    high_cpo: number
    can_scale: number
    novelty_risk: number
    lost_revenue: number
  }
  focus: {
    stop_ads: Array<FocusSku & { ad_spend: number }>
    soon_oos: Array<FocusSku & { stock_days: number; lead_time: number; revenue_per_day: number }>
    drr_margin: Array<FocusSku & { drr: number; margin_pct: number; revenue: number }>
    novelty: Array<FocusSku & { revenue: number }>
    can_scale: Array<FocusSku & { revenue: number; drr: number }>
  }
  margin_distribution: { neg: number; low: number; mid: number; ok: number; good: number }
  abc: { A: number; B: number; C: number }
  trend: Array<{ date: string; revenue: number; chmd: number; ad_spend: number }>
  unit_econ: Array<{ date: string; margin_pct: number; drr_pct: number; chmd_pct: number }>
  top15: Array<{
    sku_ms: string
    sku_wb: number | null
    name: string
    revenue: number
    chmd: number
    ad_spend: number
    cost_of_goods: number
    total_stock: number
    drr: number
    margin_pct: number
    stock_days: number | null
    lead_time: number
    abc_class: string
    novelty_status: string | null
    score: number
    is_oos: boolean
  }>
  latest_date: string | null
  period: { from: string | null; to: string | null }
  meta: { categories: string[]; managers: string[] }
  lost_detail?: Array<{ sku_ms: string; name: string; sku_wb: number | null; lost_oos: number; lost_ads: number; total: number }>
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

function fmtDelta(d: number | null | undefined): string {
  if (d == null) return ''
  const sign = d >= 0 ? '+' : ''
  return sign + (d * 100).toFixed(1) + '%'
}

function deltaColor(d: number | null | undefined, invert = false): string {
  if (d == null) return 'var(--text-muted)'
  const positive = invert ? d < 0 : d >= 0
  return positive ? 'var(--success)' : 'var(--danger)'
}

// ── KPI hint ─────────────────────────────────────────────────────────────────

function kpiHint(key: string, data: OverviewData): string {
  const drr = data.kpi.drr ?? 0
  const margin = data.kpi.avg_margin_pct
  switch (key) {
    case 'revenue':
      return data.kpi.sku_count > 0 ? `${data.kpi.sku_count} SKU` : ''
    case 'chmd':
      return data.kpi.chmd < 0 ? 'убыток' : margin > 0 ? `маржа ${fmtPct(margin)}` : ''
    case 'margin':
      if (margin < 0.10) return 'ниже нормы'
      if (margin < 0.20) return 'средняя'
      return 'хорошая'
    case 'drr':
      if (drr === 0) return 'нет данных'
      if (drr > margin && margin > 0) return 'выше маржи ⚠'
      if (drr < margin * 0.5) return 'можно масштабировать'
      return 'в норме'
    case 'ad_spend':
      return drr > 0 ? `ДРР ${(drr * 100).toFixed(1)}%` : ''
    case 'cogs':
      return margin > 0 ? `маржа ${fmtPct(margin)}` : ''
    case 'lost':
      return data.kpi.oos_count > 0 ? `OOS: ${data.kpi.oos_count} SKU` : ''
    default: return ''
  }
}

// ── Alert item (glass + left border) ─────────────────────────────────────────

interface AlertItemProps {
  icon: React.ReactNode
  title: string
  count: number
  description: string
  severity: 'danger' | 'warning' | 'success' | 'info'
  onClick?: () => void
  tooltip?: string
}

function AlertItem({ icon, title, count, description, severity, onClick, tooltip }: AlertItemProps) {
  const colorMap = {
    danger:  'var(--danger)',
    warning: 'var(--warning)',
    success: 'var(--success)',
    info:    '#22d3ee',
  }
  const color = colorMap[severity]
  return (
    <motion.div
      whileHover={onClick ? { x: 2 } : undefined}
      onClick={onClick}
      title={tooltip}
      className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderLeft: `3px solid ${color}`,
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      <span style={{ color }}>{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold" style={{ color: 'var(--text)' }}>{title}</span>
          {count > 0 && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md" style={{ background: color + '22', color }}>
              {count}
            </span>
          )}
        </div>
        <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{description}</p>
      </div>
      {onClick && <ChevronRight size={13} style={{ color: 'var(--text-subtle)', flexShrink: 0 }} />}
    </motion.div>
  )
}

// ── Focus item (weak tinted bg) ───────────────────────────────────────────────

interface FocusItemProps {
  icon: React.ReactNode
  label: string
  headline: string
  detail: string
  color: string
  onClick?: () => void
}

// Map CSS variable names to raw RGBA for tinted backgrounds
function tintedBg(color: string): string {
  const map: Record<string, string> = {
    'var(--danger)':  'rgba(220, 38, 38, 0.06)',
    'var(--warning)': 'rgba(234,179, 8, 0.07)',
    'var(--success)': 'rgba( 34,197, 94, 0.06)',
    '#22d3ee':        'rgba( 34,211,238, 0.07)',
  }
  return map[color] ?? 'rgba(255,255,255,0.04)'
}

function FocusItem({ icon, label, headline, detail, color, onClick }: FocusItemProps) {
  return (
    <motion.div
      whileHover={onClick ? { scale: 1.005, y: -1 } : undefined}
      transition={{ type: 'spring', stiffness: 400, damping: 28 }}
      className="flex items-start gap-3 p-3 rounded-xl"
      style={{
        background: tintedBg(color),
        cursor: onClick ? 'pointer' : 'default',
      }}
      onClick={onClick}
    >
      <span style={{ color, flexShrink: 0, marginTop: 1 }}>{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-wide mb-0.5" style={{ color }}>{label}</p>
        <p className="text-xs font-medium" style={{ color: 'var(--text)' }}>{headline}</p>
        <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{detail}</p>
      </div>
      {onClick && <ChevronRight size={13} style={{ color: 'var(--text-subtle)', flexShrink: 0, marginTop: 2 }} />}
    </motion.div>
  )
}

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

// ── Main Component ────────────────────────────────────────────────────────────

export default function OverviewTab() {
  const [data, setData] = useState<OverviewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [modalSkuMs, setModalSkuMs] = useState<string | null>(null)
  const [showLostModal, setShowLostModal] = useState(false)
  const { navigateToSku } = usePendingFilter()
  const { filters, setMeta } = useGlobalFilters()
  const { range } = useDateRange()

  useEffect(() => {
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({
      from: range.from,
      to: range.to,
      ...(filters.category ? { category: filters.category } : {}),
      ...(filters.manager  ? { manager:  filters.manager  } : {}),
      ...(filters.novelty  ? { novelty:  filters.novelty  } : {}),
    })
    fetch(`/api/dashboard/overview?${params}`)
      .then(r => r.json())
      .then((d: OverviewData) => {
        setData(d)
        setLoading(false)
        if (d.meta) setMeta(d.meta)
      })
      .catch((e: unknown) => { setError(String(e)); setLoading(false) })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.from, range.to, filters.category, filters.manager, filters.novelty])

  // ── Loading ──────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="py-6 space-y-6">
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
    <div className="py-16 text-center" style={{ color: 'var(--danger)' }}>{error}</div>
  )

  if (!data) return null

  const drr = data.kpi.drr ?? 0
  const isHighDrr = data.kpi.avg_margin_pct > 0 && drr > data.kpi.avg_margin_pct
  const d = data.kpi_delta

  // ── Chart data ───────────────────────────────────────────────────────────
  const trendData = data.trend.map(r => ({
    date: fmtDate(r.date),
    'Выручка': r.revenue,
    'ЧМД': r.chmd,
    'Расходы': r.ad_spend,
  }))

  const unitEconData = data.unit_econ.map(r => ({
    date: fmtDate(r.date),
    'ДРР %': r.drr_pct,
    'ЧМД %': r.chmd_pct,
  }))

  // ── Фокус дня items (конкретные детали, не дублируют алерты) ─────────────
  const focusItems: FocusItemProps[] = []

  // 1. STOP реклама — топ-3 с суммой потерь
  if (data.focus.stop_ads.length > 0) {
    const top = data.focus.stop_ads.slice(0, 3)
    const totalSpend = data.focus.stop_ads.reduce((s, r) => s + r.ad_spend, 0)
    focusItems.push({
      icon: <AlertCircle size={15} />,
      label: 'Стоп реклама',
      headline: `${data.alerts.stop_ads} SKU — OOS, деньги утекают`,
      detail: `${top.map(r => r.name.split(' ').slice(0, 2).join(' ')).join(', ')}… — выкл. рекл., потери ${fmt(totalSpend)} ₽`,
      color: 'var(--danger)',
      onClick: () => navigateToSku({ type: 'stop_ads', label: 'STOP реклама: OOS + активная реклама' }),
    })
  }

  // 2. Заказать пополнение — самые критичные (минимум дней остатка)
  if (data.focus.soon_oos.length > 0) {
    const critical = [...data.focus.soon_oos].sort((a, b) => a.stock_days - b.stock_days)
    const top = critical.slice(0, 2)
    focusItems.push({
      icon: <ShoppingCart size={15} />,
      label: 'Срочный заказ',
      headline: `${data.alerts.soon_oos} SKU уйдут в OOS раньше, чем придёт товар`,
      detail: top.map(r => `${r.name.split(' ').slice(0, 2).join(' ')}: ${r.stock_days}д (плечо ${r.lead_time}д, ~${fmt(r.revenue_per_day)} ₽/д)`).join(' • '),
      color: 'var(--warning)',
      onClick: () => navigateToSku({ type: 'low_stock', label: 'Скоро OOS' }),
    })
  }

  // 3. Оптимизировать рекламу — ДРР > маржа, крупнейшие по выручке
  if (data.focus.drr_margin.length > 0) {
    const top = [...data.focus.drr_margin].sort((a, b) => b.revenue - a.revenue).slice(0, 2)
    focusItems.push({
      icon: <TrendingDown size={15} />,
      label: 'Убыточная реклама',
      headline: `${data.alerts.drr_over_margin} SKU: ДРР превышает маржу`,
      detail: top.map(r => `${r.name.split(' ').slice(0, 2).join(' ')}: ДРР ${(r.drr * 100).toFixed(0)}% при марже ${(r.margin_pct * 100).toFixed(0)}%`).join(' • '),
      color: 'var(--warning)',
      onClick: () => navigateToSku({ type: 'drr_over', label: 'ДРР > Маржа' }),
    })
  }

  // 4. Масштабировать — конкретные SKU с запасом ДРР
  if (data.focus.can_scale.length > 0) {
    const top = data.focus.can_scale.slice(0, 2)
    focusItems.push({
      icon: <TrendingUp size={15} />,
      label: 'Масштабировать',
      headline: `${data.alerts.can_scale} SKU — ДРР <50% маржи, CTR/CR выше медианы`,
      detail: top.map(r => `${r.name.split(' ').slice(0, 2).join(' ')}: ДРР ${(r.drr * 100).toFixed(0)}%, выручка ${fmt(r.revenue)} ₽`).join(' • '),
      color: 'var(--success)',
      onClick: () => navigateToSku({ type: 'scale', label: 'Масштабировать рекламу' }),
    })
  }

  // 5. Новинки в зоне риска
  if (data.focus.novelty.length > 0) {
    const top = data.focus.novelty.slice(0, 3)
    focusItems.push({
      icon: <Package size={15} />,
      label: 'Новинки под риском',
      headline: `${data.alerts.novelty_risk} новинок не набирают выручку`,
      detail: top.map(r => `${r.name.split(' ').slice(0, 2).join(' ')}: ${fmt(r.revenue)} ₽`).join(' • '),
      color: '#22d3ee',
      onClick: () => navigateToSku({ type: 'novelty_risk', label: 'Новинки: зона риска' }),
    })
  }

  // ── Margin distribution totals ────────────────────────────────────────────
  const md = data.margin_distribution
  const mdTotal = md.neg + md.low + md.mid + md.ok + md.good || 1

  return (
    <div className="py-6 space-y-6">

      {/* ── KPI Bar ─────────────────────────────────────────────────────── */}
      <KPIBar items={[
        {
          label: 'Выручка',
          value: fmt(data.kpi.revenue),
          delta: d.revenue != null ? fmtDelta(d.revenue) : undefined,
          deltaColor: deltaColor(d.revenue),
          hint: kpiHint('revenue', data),
        },
        {
          label: 'ЧМД',
          value: fmt(data.kpi.chmd),
          delta: d.chmd != null ? fmtDelta(d.chmd) : undefined,
          deltaColor: deltaColor(d.chmd),
          hint: kpiHint('chmd', data),
          danger: data.kpi.chmd < 0,
        },
        {
          label: 'Маржа %',
          value: fmtPct(data.kpi.avg_margin_pct),
          delta: d.avg_margin_pct != null ? fmtDelta(d.avg_margin_pct) : undefined,
          deltaColor: deltaColor(d.avg_margin_pct),
          hint: kpiHint('margin', data),
        },
        {
          label: 'ДРР',
          value: drr > 0 ? (drr * 100).toFixed(1) + '%' : '—',
          delta: d.drr != null ? fmtDelta(d.drr) : undefined,
          deltaColor: deltaColor(d.drr, true),
          hint: kpiHint('drr', data),
          danger: isHighDrr,
        },
        {
          label: 'Расходы',
          value: fmt(data.kpi.ad_spend),
          delta: d.ad_spend != null ? fmtDelta(d.ad_spend) : undefined,
          deltaColor: deltaColor(d.ad_spend, true),
          hint: kpiHint('ad_spend', data),
        },
        {
          label: 'Себестоимость',
          value: fmt(data.kpi.cost_of_goods),
          hint: kpiHint('cogs', data),
        },
        {
          label: 'Потери',
          value: data.kpi.lost_revenue > 0 ? fmt(data.kpi.lost_revenue) : '—',
          hint: kpiHint('lost', data),
          danger: data.kpi.lost_revenue > 0,
          onClick: data.kpi.lost_revenue > 0 ? () => setShowLostModal(true) : undefined,
        },
      ]} />

      {/* ── Charts ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">

        {/* Chart 1: Динамика — Area для Выручка+ЧМД, Line для Расходов */}
        <GlassCard padding="lg">
          <p className="text-sm font-semibold mb-4" style={{ color: 'var(--text)' }}>
            Динамика выручки и ЧМД
          </p>
          {trendData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={trendData} margin={{ top: 4, right: 8, bottom: 0, left: -8 }}>
                <defs>
                  <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.20} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="chmdGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#22c55e" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.6} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis yAxisId="left" orientation="left" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} width={40} tickFormatter={v => fmt(v as number)} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} width={40} tickFormatter={v => fmt(v as number)} />
                <Tooltip content={(p) => <ChartTip active={p.active} payload={p.payload as unknown as Array<{ name: string; value: number; color: string }>} label={p.label != null ? String(p.label) : undefined} />} />
                <Legend wrapperStyle={{ fontSize: 10, paddingTop: 8 }} />
                <Area yAxisId="left"  type="monotone" dataKey="Выручка" stroke="#3b82f6"        fill="url(#revGrad)"  strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                <Area yAxisId="left"  type="monotone" dataKey="ЧМД"    stroke="#22c55e"        fill="url(#chmdGrad)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                <Line yAxisId="right" type="monotone" dataKey="Расходы" stroke="#ef4444"       strokeWidth={1.5} dot={false} activeDot={{ r: 4 }} strokeDasharray="4 2" />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-56 text-sm" style={{ color: 'var(--text-muted)' }}>Нет данных</div>
          )}
        </GlassCard>

        {/* Chart 2: Unit-экономика — Маржа%, ДРР%, ЧМД% */}
        <GlassCard padding="lg">
          <p className="text-sm font-semibold mb-4" style={{ color: 'var(--text)' }}>
            Unit-экономика по дням
          </p>
          {unitEconData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={unitEconData} margin={{ top: 4, right: 8, bottom: 0, left: -8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.6} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis yAxisId="left" orientation="left" domain={['auto', 'auto']} tick={{ fontSize: 10, fill: '#ef4444' }} tickLine={false} axisLine={false} width={36} tickFormatter={v => (v as number).toFixed(1) + '%'} />
                <YAxis yAxisId="right" orientation="right" domain={['auto', 'auto']} tick={{ fontSize: 10, fill: '#22d3ee' }} tickLine={false} axisLine={false} width={40} tickFormatter={v => (v as number).toFixed(1) + '%'} />
                <Tooltip content={(p) => <ChartTip active={p.active} payload={p.payload as unknown as Array<{ name: string; value: number; color: string }>} label={p.label != null ? String(p.label) : undefined} pct />} />
                <Legend wrapperStyle={{ fontSize: 10, paddingTop: 8 }} />
                <Line yAxisId="left"  type="monotone" dataKey="ДРР %"  stroke="#ef4444" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                <Line yAxisId="right" type="monotone" dataKey="ЧМД %"  stroke="#22d3ee" strokeWidth={2} dot={false} activeDot={{ r: 4 }} strokeDasharray="5 3" />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-56 text-sm" style={{ color: 'var(--text-muted)' }}>Нет данных</div>
          )}
        </GlassCard>
      </div>

      {/* ── Маржинальность + Алерты + Фокус дня ─────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">

        {/* Маржинальность */}
        <GlassCard padding="lg">
          <p className="text-sm font-semibold mb-3" style={{ color: 'var(--text)' }}>Маржинальность SKU ({data.kpi.sku_count} шт.)</p>
          <div className="space-y-2.5">
            {([
              { key: 'neg',  label: '< 0%',    color: 'var(--danger)', count: md.neg  },
              { key: 'low',  label: '0–10%',   color: 'var(--warning)', count: md.low  },
              { key: 'mid',  label: '10–20%',  color: '#22d3ee', count: md.mid  },
              { key: 'ok',   label: '20–30%',  color: 'var(--success)', count: md.ok   },
              { key: 'good', label: '≥ 30%',   color: '#34d399', count: md.good },
            ] as const).map(b => (
              <div key={b.key}>
                <div className="flex justify-between text-[11px] mb-1">
                  <span style={{ color: 'var(--text-muted)' }}>{b.label}</span>
                  <span style={{ color: 'var(--text)' }} className="font-medium">{b.count} SKU</span>
                </div>
                <div className="h-1.5 rounded-full" style={{ background: 'var(--border)' }}>
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${(b.count / mdTotal * 100).toFixed(1)}%`, background: b.color }}
                  />
                </div>
              </div>
            ))}
          </div>
        </GlassCard>

        {/* Алерты */}
        <GlassCard padding="lg">
          <p className="text-sm font-semibold mb-3" style={{ color: 'var(--text)' }}>Алерты</p>
          <div className="space-y-2">
            <AlertItem
              icon={<AlertCircle size={14} />}
              title="STOP реклама"
              count={data.alerts.stop_ads}
              severity="danger"
              description="OOS + активная реклама"
              tooltip="Условие: stock = 0 AND ad_spend > 0 за период"
              onClick={data.alerts.stop_ads > 0 ? () => navigateToSku({ type: 'stop_ads', label: 'STOP реклама' }) : undefined}
            />
            <AlertItem
              icon={<AlertTriangle size={14} />}
              title="Скоро OOS"
              count={data.alerts.soon_oos}
              severity="warning"
              description="Запас < логистического плеча"
              tooltip="Условие: stock_days < lead_time_days AND stock > 0"
              onClick={data.alerts.soon_oos > 0 ? () => navigateToSku({ type: 'low_stock', label: 'Скоро OOS' }) : undefined}
            />
            <AlertItem
              icon={<TrendingDown size={14} />}
              title="ДРР > Маржа"
              count={data.alerts.drr_over_margin}
              severity="warning"
              description="Реклама работает в убыток"
              tooltip="Условие: ad_spend / revenue > margin_pct"
              onClick={data.alerts.drr_over_margin > 0 ? () => navigateToSku({ type: 'drr_over', label: 'ДРР > Маржа' }) : undefined}
            />
            <AlertItem
              icon={<Rocket size={14} />}
              title="Высокий CTR / низкий CR"
              count={data.alerts.high_ctr_low_cr}
              severity="info"
              description="Потенциал — проблема в карточке/цене"
              tooltip="Условие: CTR > median_CTR × 1.5 AND CR < median_CR × 0.7"
              onClick={data.alerts.high_ctr_low_cr > 0 ? () => navigateToSku({ type: 'potential', label: 'Высокий CTR / низкий CR' }) : undefined}
            />
            <AlertItem
              icon={<TrendingDown size={14} />}
              title="Высокий CPO"
              count={data.alerts.high_cpo}
              severity="danger"
              description="ДРР > 35% — стоимость заказа высокая"
              tooltip="Условие: ad_spend / revenue > 0.35"
              onClick={data.alerts.high_cpo > 0 ? () => navigateToSku({ type: 'high_cpo', label: 'Высокий CPO' }) : undefined}
            />
            <AlertItem
              icon={<TrendingUp size={14} />}
              title="Можно масштабировать"
              count={data.alerts.can_scale}
              severity="success"
              description="ДРР <50% маржи, CTR/CR выше медианы"
              tooltip="Условие: drr < margin_pct × 0.5 AND cr_order > median_cr"
              onClick={data.alerts.can_scale > 0 ? () => navigateToSku({ type: 'scale', label: 'Масштабировать' }) : undefined}
            />
            <AlertItem
              icon={<Package size={14} />}
              title="Новинки под риском"
              count={data.alerts.novelty_risk}
              severity="info"
              description="Новинка с выручкой < 10 000 ₽ за период"
              tooltip="Условие: novelty_status = 'Новинки' AND revenue < 10 000 ₽"
              onClick={data.alerts.novelty_risk > 0 ? () => navigateToSku({ type: 'novelty_risk', label: 'Новинки: зона риска' }) : undefined}
            />
          </div>
        </GlassCard>

        {/* Фокус дня */}
        <GlassCard padding="lg">
          <div className="flex items-center gap-2 mb-3">
            <Zap size={14} style={{ color: 'var(--accent)' }} />
            <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Фокус дня</p>
          </div>
          <div className="space-y-2">
            {focusItems.length === 0 ? (
              <p className="text-sm py-4 text-center" style={{ color: 'var(--text-muted)' }}>
                Критических задач нет
              </p>
            ) : (
              focusItems.map((item, i) => <FocusItem key={i} {...item} />)
            )}
          </div>
        </GlassCard>
      </div>

      {/* ── Score formula ─────────────────────────────────────────────── */}
      <GlassCard padding="lg">
        <p className="text-sm font-semibold mb-3" style={{ color: 'var(--text)' }}>Формула SKU Score</p>
        <div className="flex flex-wrap gap-2 mb-2">
          {[
            { label: 'Маржа', max: 25, color: '#22c55e', hint: '<10% → 0; 10–15% → 0–12.5; ≥15% → до 25' },
            { label: 'ДРР', max: 20, color: '#3b82f6', hint: '1 − ДРР/Маржа × 20; нет рекламы → 20' },
            { label: 'Рост выручки', max: 10, color: '#a78bfa', hint: 'sigmoid(growth×4) × 10; нейтраль = 5' },
            { label: 'Конверсия', max: 10, color: '#f59e0b', hint: 'CR / медиана по акк. × 10' },
            { label: 'Остаток', max: 20, color: '#22d3ee', hint: '< плечо → 0–10; плечо..2×плечо → 10–20' },
          ].map(c => (
            <div key={c.label} title={c.hint}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg cursor-help"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
            >
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: c.color }} />
              <span className="text-xs font-medium" style={{ color: 'var(--text)' }}>{c.label}</span>
              <span className="text-xs font-bold" style={{ color: c.color }}>{c.max}</span>
            </div>
          ))}
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Штрафы:</span>
            <span className="text-xs" style={{ color: 'var(--danger)' }}>OOS → 0</span>
            <span className="text-xs" style={{ color: 'var(--text-subtle)' }}>•</span>
            <span className="text-xs" style={{ color: 'var(--danger)' }}>ДРР&gt;Маржа → ×0.5</span>
            <span className="text-xs" style={{ color: 'var(--text-subtle)' }}>•</span>
            <span className="text-xs" style={{ color: 'var(--warning)' }}>Новинка &lt;10К → −10</span>
          </div>
        </div>
        <p className="text-[11px]" style={{ color: 'var(--text-subtle)' }}>Наведи на компонент для расшифровки</p>
      </GlassCard>

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
                'Расходы': Math.round(r.ad_spend),
                'Себестоимость': Math.round(r.cost_of_goods),
                'ДРР%': (r.drr * 100).toFixed(1),
                'Маржа%': (r.margin_pct * 100).toFixed(1),
                'Остаток шт.': r.total_stock,
                'Остаток дней': r.stock_days,
                'ABC': r.abc_class,
                'Новинка': r.novelty_status ?? '',
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
                <th className="text-left pb-2 font-medium whitespace-nowrap">Арт. WB</th>
                <th className="text-right pb-2 font-medium">Выручка</th>
                <th className="text-right pb-2 font-medium">ЧМД</th>
                <th className="text-right pb-2 font-medium whitespace-nowrap">Расходы</th>
                <th className="text-right pb-2 font-medium whitespace-nowrap">Себест.</th>
                <th className="text-right pb-2 font-medium">ДРР</th>
                <th className="text-right pb-2 font-medium">Маржа</th>
                <th className="text-right pb-2 font-medium whitespace-nowrap">Ост. шт.</th>
                <th className="text-right pb-2 font-medium whitespace-nowrap">Ост. дн.</th>
              </tr>
            </thead>
            <tbody>
              {(data.top15 ?? []).map((row, i) => {
                const isLowMargin  = row.margin_pct < 0.10
                const isHighDrrRow = row.drr > row.margin_pct && row.margin_pct > 0
                return (
                  <tr
                    key={row.sku_ms}
                    className="border-t cursor-pointer"
                    style={{ borderColor: 'var(--border)' }}
                    onClick={() => setModalSkuMs(row.sku_ms)}
                  >
                    <td className="py-2 text-xs" style={{ color: 'var(--text-subtle)' }}>{i + 1}</td>
                    <td className="py-2 text-center">
                      <ScoreBadge score={row.score} />
                    </td>
                    <td className="py-2 pr-4 max-w-[200px]">
                      <span className="block truncate text-xs font-medium" style={{ color: 'var(--text)' }}>
                        {row.name}
                      </span>
                      <div className="flex items-center gap-1 mt-0.5">
                        {row.is_oos && (
                          <span className="text-[10px] font-bold" style={{ color: 'var(--danger)' }}>OOS</span>
                        )}
                        {row.novelty_status === 'Новинки' && (
                          <span className="text-[10px] px-1 rounded" style={{ background: 'rgba(34,211,238,0.12)', color: '#22d3ee' }}>new</span>
                        )}
                      </div>
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
                    <td className="py-2 text-right text-xs" style={{ color: 'var(--text-muted)' }}>
                      {fmt(row.ad_spend)}
                    </td>
                    <td className="py-2 text-right text-xs" style={{ color: 'var(--text-muted)' }}>
                      {fmt(row.cost_of_goods)}
                    </td>
                    <td className="py-2 text-right">
                      <span className="text-xs px-1.5 py-0.5 rounded"
                        style={{
                          background: isHighDrrRow ? 'var(--danger-bg)' : 'var(--success-bg)',
                          color:      isHighDrrRow ? 'var(--danger)'    : 'var(--success)',
                        }}
                      >
                        {(row.drr * 100).toFixed(1)}%
                      </span>
                    </td>
                    <td className="py-2 text-right">
                      <span className="text-xs px-1.5 py-0.5 rounded"
                        style={{
                          background: isLowMargin ? 'var(--danger-bg)' : 'var(--success-bg)',
                          color:      isLowMargin ? 'var(--danger)'    : 'var(--success)',
                        }}
                      >
                        {(row.margin_pct * 100).toFixed(1)}%
                      </span>
                    </td>
                    <td className="py-2 text-right text-xs" style={{ color: 'var(--text-muted)' }}>
                      {row.total_stock}
                    </td>
                    <td className="py-2 text-right text-xs"
                      style={{
                        color: row.stock_days == null
                          ? 'var(--text-subtle)'
                          : row.stock_days < row.lead_time
                          ? 'var(--danger)'
                          : row.stock_days < row.lead_time * 1.5
                          ? 'var(--warning)'
                          : 'var(--text-muted)',
                      }}
                    >
                      {row.stock_days == null ? '—' : row.stock_days}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </GlassCard>

      {/* ── SKU Modal ────────────────────────────────────────────────────── */}
      <SkuModal
        skuMs={modalSkuMs}
        onClose={() => setModalSkuMs(null)}
      />

      {/* ── Потери Modal ─────────────────────────────────────────────────── */}
      {showLostModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
          onClick={() => setShowLostModal(false)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 400, damping: 28 }}
            className="glass w-full max-w-2xl mx-4 rounded-2xl overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-6 py-4 flex items-center justify-between gap-2" style={{ borderBottom: '1px solid var(--border)' }}>
              <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Упущенная выручка — все SKU с потерями</p>
              <div className="flex items-center gap-2">
                {data.lost_detail && data.lost_detail.length > 0 && (
                  <button
                    onClick={() => exportToExcel(
                      data.lost_detail!.map(r => ({
                        'Название': r.name,
                        'Артикул WB': r.sku_wb ?? '',
                        'Артикул МС': r.sku_ms,
                        'OOS потери (₽)': Math.round(r.lost_oos),
                        'Слитый бюджет (₽)': Math.round(r.lost_ads),
                        'Итого (₽)': Math.round(r.total),
                      })),
                      'Потери'
                    )}
                    className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg"
                    style={{ color: 'var(--text-muted)', background: 'var(--surface)', border: '1px solid var(--border)' }}
                  >
                    <Download size={12} /> Excel
                  </button>
                )}
                <button
                  onClick={() => setShowLostModal(false)}
                  className="text-xs px-2 py-1 rounded-lg"
                  style={{ color: 'var(--text-muted)', background: 'var(--surface)' }}
                >✕</button>
              </div>
            </div>
            <div className="px-6 py-4 overflow-y-auto max-h-[70vh]">
              {!data.lost_detail?.length ? (
                <p className="text-sm py-8 text-center" style={{ color: 'var(--text-muted)' }}>Нет данных об OOS-потерях</p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr style={{ color: 'var(--text-subtle)', borderBottom: '1px solid var(--border)' }}>
                      <th className="text-left pb-2 font-medium">Название</th>
                      <th className="text-right pb-2 font-medium whitespace-nowrap">
                        <span
                          title="Упущенная выручка из-за отсутствия товара на складе. Рассчитывается как: среднедневные продажи × дни OOS × цена."
                          className="cursor-help inline-flex items-center gap-1"
                        >
                          OOS потери <span style={{ color: 'var(--accent)', fontSize: 10 }}>?</span>
                        </span>
                      </th>
                      <th className="text-right pb-2 font-medium whitespace-nowrap">
                        <span
                          title="Рекламные расходы в период нулевых остатков — деньги потрачены, но продаж не было из-за OOS."
                          className="cursor-help inline-flex items-center gap-1"
                        >
                          Слитый бюджет <span style={{ color: 'var(--accent)', fontSize: 10 }}>?</span>
                        </span>
                      </th>
                      <th className="text-right pb-2 font-medium">Итого</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.lost_detail.map((r, i) => (
                      <tr key={r.sku_ms} style={{ borderTop: '1px solid var(--border)' }}>
                        <td className="py-2 pr-4 max-w-[240px]">
                          <span className="block truncate font-medium" style={{ color: 'var(--text)' }}>{r.name}</span>
                          {r.sku_wb && <span className="font-mono" style={{ color: 'var(--text-muted)' }}>{r.sku_wb}</span>}
                        </td>
                        <td className="py-2 text-right" style={{ color: r.lost_oos > 0 ? 'var(--danger)' : 'var(--text-muted)' }}>
                          {r.lost_oos > 0 ? fmt(r.lost_oos) : '—'}
                        </td>
                        <td className="py-2 text-right" style={{ color: r.lost_ads > 0 ? 'var(--warning)' : 'var(--text-muted)' }}>
                          {r.lost_ads > 0 ? fmt(r.lost_ads) : '—'}
                        </td>
                        <td className="py-2 text-right font-semibold" style={{ color: 'var(--danger)' }}>
                          {fmt(r.total)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </motion.div>
        </div>
      )}

    </div>
  )
}
