type OosStatus = 'critical' | 'warning' | 'ok' | 'none'
type MarginStatus = 'high' | 'medium' | 'low'

interface Props {
  oos?: OosStatus
  margin?: MarginStatus
}

const oosCfg: Record<OosStatus, { label: string; bg: string; color: string }> = {
  critical: { label: 'OOS Крит.',   bg: 'var(--danger-bg)',  color: 'var(--danger)' },
  warning:  { label: 'OOS Вним.',   bg: 'var(--warning-bg)', color: 'var(--warning)' },
  ok:       { label: 'OOS Норма',   bg: 'var(--success-bg)', color: 'var(--success)' },
  none:     { label: '',             bg: '',                  color: '' },
}

const marginCfg: Record<MarginStatus, { label: string; bg: string; color: string }> = {
  high:   { label: 'Маржа Высок.', bg: 'var(--success-bg)', color: 'var(--success)' },
  medium: { label: 'Маржа Средн.', bg: 'var(--warning-bg)', color: 'var(--warning)' },
  low:    { label: 'Маржа Низк.',  bg: 'var(--danger-bg)',  color: 'var(--danger)' },
}

function Chip({ label, bg, color }: { label: string; bg: string; color: string }) {
  if (!label) return null
  return (
    <span
      className="inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ background: bg, color }}
    >
      {label}
    </span>
  )
}

export function PriorityBadge({ oos, margin }: Props) {
  return (
    <div className="flex flex-col gap-1">
      {oos && oos !== 'none' && <Chip {...oosCfg[oos]} />}
      {margin && <Chip {...marginCfg[margin]} />}
    </div>
  )
}
