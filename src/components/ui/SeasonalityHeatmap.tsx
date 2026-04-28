'use client'

import { GlassCard } from './GlassCard'

const MONTH_RU = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек']

export interface HeatmapRow {
  sku_ms: string
  name: string
  subject_wb: string
  coeffs: Array<number | null>  // 12 значений
}

function colorFor(v: number | null, min: number, max: number): string {
  if (v == null) return 'var(--surface-2)'
  if (max === min) return 'var(--surface-2)'
  const t = (v - min) / (max - min)
  // от серого (низ) к зелёному (пик)
  const r = Math.round(120 - t * 80)
  const g = Math.round(120 + t * 80)
  const b = Math.round(120 - t * 80)
  return `rgb(${r},${g},${b})`
}

export function SeasonalityHeatmap({ rows, currentMonth }: { rows: HeatmapRow[]; currentMonth: number }) {
  // Топ-15 строк
  const top = rows.slice(0, 15)

  return (
    <GlassCard padding="md">
      <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text)' }}>Сезонность ниш</h3>
      {top.length === 0 ? (
        <div className="h-56 flex items-center justify-center text-xs" style={{ color: 'var(--text-subtle)' }}>Нет данных по сезонности</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[10px]">
            <thead>
              <tr>
                <th className="text-left py-1 px-1 sticky left-0" style={{ background: 'var(--surface)', color: 'var(--text-subtle)' }}>Ниша/SKU</th>
                {MONTH_RU.map((m, i) => (
                  <th key={m} className="px-1 py-1 text-center" style={{ color: i === currentMonth ? 'var(--accent)' : 'var(--text-subtle)', fontWeight: i === currentMonth ? 700 : 500 }}>
                    {m}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {top.map(r => {
                const valid = r.coeffs.filter((v): v is number => v != null)
                const min = valid.length > 0 ? Math.min(...valid) : 0
                const max = valid.length > 0 ? Math.max(...valid) : 1
                return (
                  <tr key={r.sku_ms}>
                    <td className="py-1 px-1 truncate max-w-[140px] sticky left-0" style={{ background: 'var(--surface)', color: 'var(--text-muted)' }} title={r.name}>
                      {r.subject_wb || r.name || r.sku_ms}
                    </td>
                    {r.coeffs.map((v, i) => (
                      <td key={i} className="px-0 py-0">
                        <div
                          className="w-full text-center font-mono font-semibold"
                          style={{
                            background: colorFor(v, min, max),
                            color: '#fff',
                            padding: '4px 0',
                            fontSize: 9,
                            border: i === currentMonth ? '2px solid var(--accent)' : '1px solid var(--border-subtle)',
                          }}
                        >
                          {v != null ? v.toFixed(1) : '—'}
                        </div>
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </GlassCard>
  )
}
