import { ReactNode } from 'react'

interface Props {
  children: ReactNode
  className?: string
  padding?: 'none' | 'sm' | 'md' | 'lg'
  hover?: boolean
  solid?: boolean
  onClick?: () => void
}

const padMap = { none: '', sm: 'p-3', md: 'p-4', lg: 'p-6' }

export function GlassCard({ children, className = '', padding = 'md', hover = false, solid = false, onClick }: Props) {
  const base = solid ? 'glass-solid' : 'glass'
  const hoverCls = hover ? 'glass-hover cursor-pointer' : ''
  return (
    <div className={`${base} ${hoverCls} ${padMap[padding]} ${className}`} onClick={onClick}>
      {children}
    </div>
  )
}
