'use client'

interface Props {
  icon?: string
  title: string
  count?: number
  description?: string
  severity?: 'critical' | 'warning' | 'info' | 'success'
  onClick?: () => void
}

export function AlertBox({ icon, title, count, description, severity = 'info', onClick }: Props) {
  return (
    <div
      className={`alert-card alert-${severity} px-4 py-3 ${onClick ? 'cursor-pointer' : ''}`}
      onClick={onClick}
      style={{ transition: 'transform 0.15s, box-shadow 0.15s' }}
      onMouseEnter={e => {
        if (onClick) {
          const el = e.currentTarget as HTMLElement
          el.style.transform = 'translateY(-2px)'
          el.style.boxShadow = 'var(--shadow-md)'
        }
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLElement
        el.style.transform = ''
        el.style.boxShadow = ''
      }}
    >
      <div className="flex items-center gap-2 mb-1">
        {icon && <span className="text-base leading-none">{icon}</span>}
        <span className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{title}</span>
      </div>
      {count !== undefined && (
        <p className="text-2xl font-bold" style={{
          color: severity === 'critical' ? 'var(--accent)' :
                 severity === 'warning'  ? 'var(--warning)' :
                 severity === 'success'  ? 'var(--success)' : 'var(--info)',
          letterSpacing: '-0.02em'
        }}>{count}</p>
      )}
      {description && (
        <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{description}</p>
      )}
    </div>
  )
}
