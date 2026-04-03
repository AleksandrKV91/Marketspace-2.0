interface Props {
  values: number[]      // 12 значений (янв..дек) коэффициент сезонности
  peakCount?: number    // топ N месяцев подсветить, default 3
}

const MONTHS_SHORT = ['Я','Ф','М','А','М','И','И','А','С','О','Н','Д']

export function SeasonalitySparkline({ values, peakCount = 3 }: Props) {
  if (!values || values.length === 0) return <span style={{ color: 'var(--text-subtle)', fontSize: 11 }}>—</span>

  const sorted = [...values].sort((a, b) => b - a)
  const threshold = sorted[peakCount - 1] ?? 0
  const max = sorted[0] ?? 1

  return (
    <div className="flex items-end gap-0.5 h-6" title={values.map((v, i) => `${MONTHS_SHORT[i]}: ${v}`).join(', ')}>
      {values.map((v, i) => {
        const isPeak = v >= threshold && v > 0
        const height = max > 0 ? Math.round((v / max) * 20) : 4
        return (
          <div
            key={i}
            className="w-1.5 rounded-sm transition-all"
            style={{
              height: `${Math.max(height, 2)}px`,
              background: isPeak ? 'var(--accent)' : 'var(--border)',
              opacity: isPeak ? 1 : 0.6,
            }}
            title={`${MONTHS_SHORT[i]}: ${v}`}
          />
        )
      })}
    </div>
  )
}
