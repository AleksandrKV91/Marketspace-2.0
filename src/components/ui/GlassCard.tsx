'use client'

import { motion } from 'framer-motion'
import { type ReactNode } from 'react'

interface Props {
  children: ReactNode
  className?: string
  padding?: 'none' | 'sm' | 'md' | 'lg'
  hover?: boolean
  solid?: boolean
  onClick?: () => void
  delay?: number
}

const padMap = { none: '', sm: 'p-3', md: 'p-4', lg: 'p-5' }

export function GlassCard({
  children,
  className = '',
  padding = 'md',
  hover = false,
  solid = false,
  onClick,
  delay = 0,
}: Props) {
  const base = solid ? 'glass-solid' : 'glass'
  const hoverCls = (hover || onClick) ? 'glass-hover' : ''
  const padCls = padMap[padding]

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 400, damping: 28, delay }}
      className={`${base} ${hoverCls} ${padCls} ${className}`}
      onClick={onClick}
      style={{ cursor: onClick ? 'pointer' : undefined }}
    >
      {children}
    </motion.div>
  )
}
