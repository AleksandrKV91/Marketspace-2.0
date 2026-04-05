'use client'
import { type ReactNode } from 'react'
import { TrendingUp, TrendingDown } from 'lucide-react'
import { GlassCard } from './GlassCard'

interface Props {
  label: string
  value: string
  icon?: ReactNode
  iconColor?: string
  iconGradient?: string    /* CSS gradient class e.g. "icon-gradient-red" */
  delta?: number
  deltaLabel?: string
  accent?: boolean
  loading?: boolean
  hover?: boolean
  onClick?: () => void
  delay?: number
}

export function StatCard({
  label, value, icon, iconColor, iconGradient,
  delta, deltaLabel, accent, loading, hover, onClick, delay = 0,
}: Props) {
  if (loading) return (
    <GlassCard>
      <div className="space-y-3">
        <div className="skeleton h-10 w-10 rounded-[27%]" />
        <div className="skeleton h-3 w-20" />
        <div className="skeleton h-7 w-28" />
        <div className="skeleton h-2.5 w-14" />
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
      delay={delay}
    >
      <div className="flex items-start justify-between mb-3">
        {icon ? (
          /* Squircle icon container */
          <div
            className={`icon-squircle w-10 h-10 ${iconGradient ?? ''}`}
            style={
              !iconGradient
                ? { background: `color-mix(in srgb, ${ic} 18%, rgba(255,255,255,0.7))`, color: ic }
                : { color: 'white' }
            }
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
              backdropFilter: 'blur(8px)',
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
        style={{ color: accent ? 'var(--accent)' : 'var(--text)', letterSpacing: '-0.025em' }}
      >
        {value}
      </p>
      {deltaLabel && <p className="text-xs mt-1" style={{ color: 'var(--text-subtle)' }}>{deltaLabel}</p>}
    </GlassCard>
  )
}
