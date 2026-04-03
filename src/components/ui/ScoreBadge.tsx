interface Props {
  score: number
  size?: 'sm' | 'md'
}

function getColor(s: number): string {
  if (s >= 80) return '#22C55E'
  if (s >= 60) return '#10B981'
  if (s >= 40) return '#F59E0B'
  if (s >= 20) return '#F97316'
  return '#EF4444'
}

function getLabel(s: number): string {
  if (s >= 80) return 'Масштабировать'
  if (s >= 60) return 'Стабильный рост'
  if (s >= 40) return 'Оптимизация'
  if (s >= 20) return 'Риск'
  return 'Проблемный'
}

export function ScoreBadge({ score, size = 'md' }: Props) {
  const color = getColor(score)
  const clamp = Math.max(0, Math.min(100, score))
  return (
    <div className={size === 'sm' ? 'w-16' : 'w-20'}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-bold" style={{ color }}>{clamp}</span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${clamp}%`, background: color }}
        />
      </div>
      {size === 'md' && (
        <span className="block text-[10px] mt-0.5" style={{ color: 'var(--text-subtle)' }}>
          {getLabel(score)}
        </span>
      )}
    </div>
  )
}
