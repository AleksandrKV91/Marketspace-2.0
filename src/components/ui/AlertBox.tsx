'use client'

import { motion } from 'framer-motion'

interface Props {
  icon?: string
  title: string
  count?: number
  description?: string
  severity?: 'critical' | 'warning' | 'info' | 'success'
  onClick?: () => void
}

const severityColor: Record<string, string> = {
  critical: 'var(--accent)',
  warning:  'var(--warning)',
  success:  'var(--success)',
  info:     'var(--info)',
}

export function AlertBox({ icon, title, count, description, severity = 'info', onClick }: Props) {
  const color = severityColor[severity]
  const isClickable = !!onClick

  return (
    <motion.div
      whileHover={isClickable ? { y: -3, scale: 1.006 } : undefined}
      whileTap={isClickable ? { y: -1, scale: 0.997 } : undefined}
      transition={{ type: 'spring', stiffness: 400, damping: 28 }}
      className={`alert-card alert-${severity} px-4 py-3 ${isClickable ? 'cursor-pointer' : ''}`}
      onClick={onClick}
    >
      <div className="flex items-center gap-2 mb-0.5 relative z-10">
        {icon && <span className="text-base leading-none">{icon}</span>}
        <span className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{title}</span>
        {isClickable && (
          <span className="ml-auto text-xs" style={{ color: 'var(--text-subtle)' }}>→</span>
        )}
      </div>
      {count !== undefined && (
        <p
          className="text-2xl font-bold relative z-10"
          style={{ color, letterSpacing: '-0.025em', lineHeight: 1.2 }}
        >
          {count}
        </p>
      )}
      {description && (
        <p className="text-xs mt-0.5 relative z-10" style={{ color: 'var(--text-muted)' }}>
          {description}
        </p>
      )}
    </motion.div>
  )
}
