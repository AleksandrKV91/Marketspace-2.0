'use client'

interface Props {
  icon: string
  title: string
  count: number
  amount?: string
  severity: 'critical' | 'warning' | 'info' | 'success'
  onClick?: () => void
}

const severityStyles = {
  critical: { bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.25)', text: '#EF4444' },
  warning:  { bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.25)', text: '#F59E0B' },
  info:     { bg: 'rgba(59,130,246,0.08)', border: 'rgba(59,130,246,0.25)', text: '#3B82F6' },
  success:  { bg: 'rgba(16,185,129,0.08)', border: 'rgba(16,185,129,0.25)', text: '#10B981' },
}

export function AlertBox({ icon, title, count, amount, severity, onClick }: Props) {
  const s = severityStyles[severity]
  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-xl p-3 transition-all hover:scale-[1.02] active:scale-[0.98]"
      style={{ background: s.bg, border: `1px solid ${s.border}` }}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="text-lg">{icon}</span>
        <span className="text-xs font-semibold" style={{ color: s.text }}>{title}</span>
      </div>
      <div className="flex items-end gap-2">
        <span className="text-xl font-bold" style={{ color: 'var(--text)' }}>{count}</span>
        <span className="text-xs pb-0.5" style={{ color: 'var(--text-muted)' }}>SKU</span>
        {amount && <span className="text-xs pb-0.5 ml-auto" style={{ color: s.text }}>{amount}</span>}
      </div>
    </button>
  )
}
