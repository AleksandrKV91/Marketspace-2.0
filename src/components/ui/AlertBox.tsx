'use client'

import { motion } from 'framer-motion'
import { type ReactNode } from 'react'

interface Props {
  icon?: ReactNode
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

const severityIconBg: Record<string, string> = {
  critical: 'var(--danger-bg)',
  warning:  'var(--warning-bg)',
  success:  'var(--success-bg)',
  info:     'var(--info-bg)',
}

export function AlertBox({ icon, title, count, description, severity = 'info', onClick }: Props) {
  const color = severityColor[severity]
  const iconBg = severityIconBg[severity]
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
        {icon && (
          <span
            className="flex items-center justify-center w-5 h-5 rounded-md flex-shrink-0"
            style={{ background: iconBg, color }}
          >
            {icon}
          </span>
        )}
        <span className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{title}</span>
        {isClickable && (
          <span className="ml-auto" style={{ color: 'var(--text-subtle)' }}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M4.5 2.5L8 6L4.5 9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </span>
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
