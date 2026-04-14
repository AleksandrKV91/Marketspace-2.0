'use client'

import { type ReactNode, type CSSProperties } from 'react'

interface Props {
  children: ReactNode
  className?: string
  style?: CSSProperties
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
  style,
  padding = 'md',
  hover = false,
  solid = false,
  onClick,
}: Props) {
  const base = solid ? 'glass-solid' : 'glass'
  const hoverCls = (hover || onClick) ? 'glass-hover' : ''
  const padCls = padMap[padding]

  return (
    <div
      className={`${base} ${hoverCls} ${padCls} ${className}`}
      onClick={onClick}
      style={{ cursor: onClick ? 'pointer' : undefined, ...style }}
    >
      {children}
    </div>
  )
}
