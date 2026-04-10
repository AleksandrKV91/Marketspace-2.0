'use client'

import { motion } from 'framer-motion'

interface KPIItem {
  label: string
  value: string
  delta?: string
  deltaColor?: string      // CSS color for delta (overrides deltaPositive)
  deltaPositive?: boolean  // legacy fallback
  hint?: string            // interpretation text under the value
  danger?: boolean
  accent?: boolean
  icon?: string
  onClick?: () => void
}

interface KPIBarProps {
  items: KPIItem[]
  loading?: boolean
}

export function KPIBar({ items, loading }: KPIBarProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 400, damping: 28 }}
      className="glass overflow-hidden"
      style={{ borderRadius: 'var(--radius-xl)' }}
    >
      <div
        className="grid"
        style={{ gridTemplateColumns: `repeat(${items.length}, 1fr)` }}
      >
        {items.map((item, idx) => {
          const dColor = item.deltaColor
            ?? (item.deltaPositive ? 'var(--success)' : 'var(--danger)')
          return (
            <motion.div
              key={idx}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: 'spring', stiffness: 400, damping: 28, delay: idx * 0.05 }}
              className="relative px-5 py-4"
              onClick={item.onClick}
              style={{
                borderRight: idx < items.length - 1
                  ? '1px solid var(--border-subtle)'
                  : undefined,
                background: item.danger
                  ? 'linear-gradient(135deg, rgba(220,38,38,0.08) 0%, rgba(220,38,38,0.03) 100%)'
                  : item.accent
                  ? 'linear-gradient(135deg, rgba(59,130,246,0.10) 0%, rgba(59,130,246,0.04) 100%)'
                  : undefined,
                cursor: item.onClick ? 'pointer' : undefined,
              }}
            >
              {/* Specular per-cell */}
              <div
                className="absolute top-0 right-0 w-1/2 h-full pointer-events-none"
                style={{ background: 'radial-gradient(ellipse at 85% 10%, rgba(255,255,255,0.20) 0%, transparent 60%)' }}
              />

              {loading ? (
                <div className="space-y-2">
                  <div className="skeleton h-2.5 w-16 rounded" />
                  <div className="skeleton h-6 w-24 rounded" />
                  <div className="skeleton h-2 w-14 rounded" />
                </div>
              ) : (
                <div className="space-y-0.5 relative z-10">
                  <p
                    className="text-[10px] uppercase tracking-widest font-semibold"
                    style={{ color: item.danger ? 'rgba(220,38,38,0.70)' : 'var(--text-subtle)' }}
                  >
                    {item.label}
                  </p>
                  <p
                    className="text-xl font-bold tracking-tight leading-tight"
                    style={{ color: item.danger ? 'var(--danger)' : item.accent ? '#3B82F6' : 'var(--text)' }}
                  >
                    {item.value}
                  </p>
                  {item.delta && (
                    <p className="text-[10px] font-semibold flex items-center gap-1">
                      <span style={{ color: dColor }}>{item.delta}</span>
                      <span style={{ color: 'var(--text-subtle)', fontWeight: 400 }}>vs пред.</span>
                    </p>
                  )}
                  {item.hint ? (
                    <p className="text-[10px]" style={{ color: 'var(--text-subtle)' }}>{item.hint}</p>
                  ) : !item.delta && item.danger ? (
                    <p className="text-[10px] font-semibold" style={{ color: 'var(--danger)' }}>
                      Критический
                    </p>
                  ) : !item.delta ? (
                    <p className="text-[10px]" style={{ color: 'transparent' }}>—</p>
                  ) : null}
                </div>
              )}
            </motion.div>
          )
        })}
      </div>
    </motion.div>
  )
}
