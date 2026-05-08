'use client'

import { useState, useMemo } from 'react'
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
  const r = Math.round(120 - t * 80)
  const g = Math.round(120 + t * 80)
  const b = Math.round(120 - t * 80)
  return `rgb(${r},${g},${b})`
}

export function SeasonalityHeatmap({ rows, currentMonth }: { rows: HeatmapRow[]; currentMonth: number }) {
  const [selectedMonth, setSelectedMonth] = useState<number>(currentMonth)
  // По умолчанию — фильтр «пиковые в выбранном месяце» включён.
  // Это показывает ниши, для которых selectedMonth = argmax их собственного годового профиля сезонности.
  const [peakOnly, setPeakOnly] = useState<boolean>(true)

  const filteredRows = useMemo(() => {
    if (!peakOnly) return rows
    // Оставляем только ниши, у которых argmax(coeffs) === selectedMonth
    return rows.filter(r => {
      const valid = r.coeffs.map((v, i) => ({ v, i })).filter(x => x.v != null && x.v > 0)
      if (valid.length === 0) return false
      let bestIdx = -1
      let bestVal = -Infinity
      for (const { v, i } of valid) {
        if ((v as number) > bestVal) { bestVal = v as number; bestIdx = i }
      }
      return bestIdx === selectedMonth
    })
  }, [rows, peakOnly, selectedMonth])

  // Сортируем по коэффициенту в выбранном месяце (по убыванию)
  const top = useMemo(() => [...filteredRows].sort((a, b) => {
    const av = a.coeffs[selectedMonth] ?? -Infinity
    const bv = b.coeffs[selectedMonth] ?? -Infinity
    return bv - av
  }), [filteredRows, selectedMonth])

  return (
    <GlassCard padding="md">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h3 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
          Сезонность ниш
          <span className="ml-2 text-[10px] font-normal" style={{ color: 'var(--text-subtle)' }}>
            {peakOnly
              ? `пиковые в ${MONTH_RU[selectedMonth]}: ${top.length} из ${rows.length}`
              : `${rows.length} ниш`}
          </span>
        </h3>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPeakOnly(p => !p)}
            className="text-[11px] rounded-lg px-2 py-1 cursor-pointer"
            style={{
              background: peakOnly ? 'var(--accent-glass)' : 'var(--surface)',
              border: '1px solid ' + (peakOnly ? 'var(--accent)' : 'var(--border)'),
              color: peakOnly ? 'var(--accent)' : 'var(--text-muted)',
            }}
            title="Только ниши, для которых выбранный месяц — пик годовой сезонности"
          >
            {peakOnly ? '★ Пиковые' : 'Все ниши'}
          </button>
          <select
            value={selectedMonth}
            onChange={e => setSelectedMonth(Number(e.target.value))}
            className="text-[11px] rounded-lg px-2 py-1"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)' }}
          >
            {MONTH_RU.map((m, i) => (
              <option key={m} value={i}>{m}{i === currentMonth ? ' ●' : ''}</option>
            ))}
          </select>
        </div>
      </div>
      {top.length === 0 ? (
        <div className="h-56 flex items-center justify-center text-xs" style={{ color: 'var(--text-subtle)' }}>
          {peakOnly ? `Нет ниш с пиком в ${MONTH_RU[selectedMonth]}` : 'Нет данных по сезонности'}
        </div>
      ) : (
        <div style={{ maxHeight: 480, overflowY: 'auto', overflowX: 'auto' }}>
          <table className="w-full text-[10px]">
            <thead style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 2 }}>
              <tr>
                <th className="text-left py-1 px-1 sticky left-0" style={{ background: 'var(--surface)', color: 'var(--text-subtle)', zIndex: 3 }}>Ниша/SKU</th>
                {MONTH_RU.map((m, i) => (
                  <th
                    key={m}
                    className="px-1 py-1 text-center cursor-pointer"
                    style={{
                      background: 'var(--surface)',
                      color: i === selectedMonth ? 'var(--accent)' : i === currentMonth ? 'var(--text)' : 'var(--text-subtle)',
                      fontWeight: i === selectedMonth || i === currentMonth ? 700 : 500,
                    }}
                    onClick={() => setSelectedMonth(i)}
                  >
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
                            border: i === selectedMonth ? '2px solid var(--accent)' : '1px solid var(--border-subtle)',
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
