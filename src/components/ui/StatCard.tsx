'use client'
import { ReactNode } from 'react'
import { TrendingUp, TrendingDown } from 'lucide-react'
import { GlassCard } from './GlassCard'

interface Props {
  label: string
  value: string
  icon?: ReactNode
  delta?: number        // percentage change e.g. +12.5
  deltaLabel?: string
  accent?: boolean      // red highlight
  loading?: boolean
}

export function StatCard({ label, value, icon, delta, deltaLabel, accent, loading }: Props) {
  if (loading) return (
    <GlassCard>
      <div className="space-y-3">
        <div className="skeleton h-4 w-20" />
        <div className="skeleton h-8 w-32" />
        <div className="skeleton h-3 w-16" />
      </div>
    </GlassCard>
  )

  const up = delta !== undefined && delta > 0
  const down = delta !== undefined && delta < 0

  return (
    <GlassCard className={accent ? 'border-[var(--accent)]/30 bg-[var(--accent-glow)]' : ''}>
      <div className="flex items-start justify-between mb-3">
        {icon && (
          <div className="p-2 rounded-lg" style={{ background: 'var(--accent-glow)', color: 'var(--accent)' }}>
            {icon}
          </div>
        )}
        {delta !== undefined && (
          <span className={`flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full ${
            up ? 'bg-green-500/10 text-green-500' : down ? 'bg-red-500/10 text-red-400' : 'bg-gray-500/10'
          }`} style={{ color: up ? 'var(--success)' : down ? 'var(--danger)' : 'var(--text-muted)' }}>
            {up ? <TrendingUp size={11} /> : down ? <TrendingDown size={11} /> : null}
            {delta > 0 ? '+' : ''}{delta.toFixed(1)}%
          </span>
        )}
      </div>
      <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>{label}</p>
      <p className="text-2xl font-bold" style={{ color: 'var(--text)' }}>{value}</p>
      {deltaLabel && <p className="text-xs mt-1" style={{ color: 'var(--text-subtle)' }}>{deltaLabel}</p>}
    </GlassCard>
  )
}
