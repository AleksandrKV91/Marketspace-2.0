'use client'

import { useEffect, useState } from 'react'
import { ComposedChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, ReferenceLine } from 'recharts'
import { GlassCard } from './GlassCard'
import { fmtAxis } from '@/lib/formatters'

interface WeekPoint {
  week_label: string
  week_start: string
  week_end:   string
  type: 'past' | 'future'
  fact_rub: number | null
  forecast_rub: number | null
  stock_rub: number | null
}

function fmtRub(n: number | null) {
  if (n == null) return '—'
  return Math.round(n).toLocaleString('ru-RU') + ' ₽'
}

export function ForecastChart() {
  const [data, setData] = useState<WeekPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [todayLabel, setTodayLabel] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/dashboard/orders/forecast-chart')
      .then(r => r.json())
      .then((d: { rows: WeekPoint[]; latest_date: string | null }) => {
        setData(d.rows ?? [])
        // «Сегодня» = последняя прошлая неделя (правая граница past)
        const lastPast = (d.rows ?? []).filter(r => r.type === 'past').pop()
        setTodayLabel(lastPast?.week_label ?? null)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  return (
    <GlassCard padding="md">
      <h3 className="text-sm font-semibold mb-1" style={{ color: 'var(--text)' }}>
        Прогноз продаж: 4 недели назад + 4 вперёд
      </h3>
      <p className="text-[10px] mb-3" style={{ color: 'var(--text-subtle)' }}>
        Синий = факт выручки (₽). Зелёный = прогноз выручки (velocity × сезонность × цена). Красный = остаток на складах в ₽.
      </p>
      {loading ? (
        <div className="h-56 flex items-center justify-center text-xs" style={{ color: 'var(--text-subtle)' }}>Загрузка…</div>
      ) : data.length === 0 ? (
        <div className="h-56 flex items-center justify-center text-xs" style={{ color: 'var(--text-subtle)' }}>Нет данных</div>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <ComposedChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
            <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" />
            <XAxis dataKey="week_label" tick={{ fontSize: 10, fill: 'var(--text-subtle)' }} interval={0} />
            <YAxis tickFormatter={(v) => fmtAxis(Number(v))} tick={{ fontSize: 10, fill: 'var(--text-subtle)' }} />
            <Tooltip
              contentStyle={{ background: '#fff', border: '1px solid #ccc', borderRadius: 8, fontSize: 12, color: '#000' }}
              formatter={(v) => fmtRub(Number(v))}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {todayLabel && (
              <ReferenceLine
                x={todayLabel}
                stroke="var(--text-subtle)"
                strokeDasharray="2 4"
                label={{ value: 'сегодня', fontSize: 9, fill: 'var(--text-subtle)', position: 'top' }}
              />
            )}
            <ReferenceLine y={0} stroke="#ef4444" strokeDasharray="3 3" label={{ value: 'Стоков нет', fontSize: 9, fill: '#ef4444', position: 'insideLeft' }} />
            <Line type="monotone" dataKey="fact_rub" name="Факт, ₽" stroke="#3b82f6" strokeWidth={2.5} dot={{ r: 3 }} connectNulls={false} />
            <Line type="monotone" dataKey="forecast_rub" name="Прогноз, ₽" stroke="#22c55e" strokeWidth={2.5} dot={{ r: 3 }} connectNulls={false} />
            <Line type="monotone" dataKey="stock_rub" name="Остаток, ₽" stroke="#ef4444" strokeWidth={2} strokeDasharray="5 4" dot={{ r: 2 }} connectNulls={true} />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </GlassCard>
  )
}
