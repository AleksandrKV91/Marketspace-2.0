'use client'
import { ReactNode } from 'react'
import { TrendingUp, TrendingDown } from 'lucide-react'
import { GlassCard } from './GlassCard'

interface Props {
  label: string
  value: string
  icon?: ReactNode
  iconColor?: string
  delta?: number
  deltaLabel?: string
  accent?: boolean
  loading?: boolean
  hover?: boolean
  onClick?: () => void
}

export function StatCard({
  label, value, icon, iconColor, delta, deltaLabel, accent, loading, hover, onClick
}: Props) {
  if (loading) return (
    <GlassCard>
      <div className="space-y-3">
        <div className="skeleton h-9 w-9 rounded-full" />
        <div className="skeleton h-4 w-20" />
        <div className="skeleton h-7 w-28" />
        <div className="skeleton h-3 w-14" />
      </div>
    </GlassCard>
  )

  const up   = delta !== undefined && delta > 0
  const down = delta !== undefined && delta < 0
  const ic   = iconColor ?? 'var(--accent)'

  return (
    <GlassCard
      className={accent ? 'border-[var(--accent)]/30' : ''}
      hover={hover}
      onClick={onClick}
    >
      <div className="flex items-start justify-between mb-3">
        {icon ? (
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: `color-mix(in srgb, ${ic} 15%, transparent)`, color: ic }}
          >
            {icon}
          </div>
        ) : <div />}
        {delta !== undefined && (
          <span
            className="flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full"
            style={{
              background: up ? 'var(--success-bg)' : down ? 'var(--danger-bg)' : 'var(--border)',
              color: up ? 'var(--success)' : down ? 'var(--danger)' : 'var(--text-muted)',
            }}
          >
            {up ? <TrendingUp size={11} /> : down ? <TrendingDown size={11} /> : null}
            {delta > 0 ? '+' : ''}{delta.toFixed(1)}%
          </span>
        )}
      </div>
      <p className="text-xs mb-1 font-medium" style={{ color: 'var(--text-subtle)' }}>{label}</p>
      <p
        className="text-2xl font-bold"
        style={{ color: accent ? 'var(--accent)' : 'var(--text)', letterSpacing: '-0.02em' }}
      >
        {value}
      </p>
      {deltaLabel && <p className="text-xs mt-1" style={{ color: 'var(--text-subtle)' }}>{deltaLabel}</p>}
    </GlassCard>
  )
}
