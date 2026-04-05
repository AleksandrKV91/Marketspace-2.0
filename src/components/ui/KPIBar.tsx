'use client'

import { motion } from 'framer-motion'

interface KPIItem {
  label: string
  value: string
  delta?: string
  deltaPositive?: boolean
  danger?: boolean
  icon?: string
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
      style={{
        borderRadius: 'var(--radius-xl)',
        boxShadow: 'var(--shadow-float), inset 0 1px 0 var(--specular)',
      }}
    >
      <div
        className="grid"
        style={{ gridTemplateColumns: `repeat(${items.length}, 1fr)` }}
      >
        {items.map((item, idx) => (
          <motion.div
            key={idx}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 28, delay: idx * 0.05 }}
            className="relative px-5 py-4 space-y-1"
            style={{
              borderRight: idx < items.length - 1 ? '1px solid var(--border-subtle)' : undefined,
              background: item.danger
                ? 'linear-gradient(135deg, rgba(220,38,38,0.07) 0%, rgba(220,38,38,0.02) 100%)'
                : undefined,
            }}
          >
            {/* Per-cell specular top-right */}
            <div
              className="absolute top-0 right-0 w-1/2 h-full pointer-events-none"
              style={{
                background: 'radial-gradient(ellipse at 85% 10%, rgba(255,255,255,0.18) 0%, transparent 60%)',
              }}
            />

            {loading ? (
              <>
                <div className="skeleton h-2.5 w-16 rounded" />
                <div className="skeleton h-6 w-24 rounded mt-1" />
              </>
            ) : (
              <>
                <p
                  className="text-[10px] uppercase tracking-widest font-semibold relative z-10"
                  style={{ color: item.danger ? 'rgba(220,38,38,0.65)' : 'var(--text-subtle)' }}
                >
                  {item.label}
                </p>
                <p
                  className="text-xl font-bold tracking-tight leading-none relative z-10"
                  style={{ color: item.danger ? 'var(--danger)' : 'var(--text)' }}
                >
                  {item.value}
                </p>
                {item.delta && (
                  <p className="text-[10px] font-semibold relative z-10 flex items-center gap-1">
                    <span style={{ color: item.deltaPositive ? 'var(--success)' : 'var(--danger)' }}>
                      {item.deltaPositive ? '↑' : '↓'} {item.delta}
                    </span>
                    <span style={{ color: 'var(--text-subtle)', fontWeight: 400 }}>vs пред.</span>
                  </p>
                )}
                {!item.delta && item.danger && (
                  <p className="text-[10px] font-semibold relative z-10" style={{ color: 'var(--danger)' }}>
                    Критический
                  </p>
                )}
              </>
            )}
          </motion.div>
        ))}
      </div>
    </motion.div>
  )
}
