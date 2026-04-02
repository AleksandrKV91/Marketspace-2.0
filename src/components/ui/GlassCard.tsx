import { ReactNode } from 'react'

interface Props {
  children: ReactNode
  className?: string
  padding?: 'none' | 'sm' | 'md' | 'lg'
}

const padMap = { none: '', sm: 'p-3', md: 'p-4', lg: 'p-6' }

export function GlassCard({ children, className = '', padding = 'md' }: Props) {
  return (
    <div className={`glass ${padMap[padding]} ${className}`}>
      {children}
    </div>
  )
}
