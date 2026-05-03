'use client'

import { useEffect, useState } from 'react'
import { ComposedChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, ReferenceLine } from 'recharts'
import { GlassCard } from './GlassCard'
import { fmtAxis } from '@/lib/formatters'

interface ForecastPoint {
  date: string
  fact: number | null
  forecast: number | null
  stock: number | null
}

export function ForecastChart() {
  const [data, setData] = useState<ForecastPoint[]>([])
  const [latestDate, setLatestDate] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/dashboard/orders/forecast-chart')
      .then(r => r.json())
      .then((d: { rows: ForecastPoint[]; latest_date: string | null }) => {
        setData(d.rows ?? [])
        setLatestDate(d.latest_date ?? null)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  return (
    <GlassCard padding="md">
      <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text)' }}>
        Прогноз продаж 30д
        <span className="ml-2 text-[10px] font-normal" style={{ color: 'var(--text-subtle)' }}>
          (синий=факт прошлое, зелёный=прогноз будущее, красный=остаток)
        </span>
      </h3>
      {loading ? (
        <div className="h-56 flex items-center justify-center text-xs" style={{ color: 'var(--text-subtle)' }}>Загрузка…</div>
      ) : data.length === 0 ? (
        <div className="h-56 flex items-center justify-center text-xs" style={{ color: 'var(--text-subtle)' }}>Нет данных</div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
            <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" />
            <XAxis dataKey="date" tickFormatter={(d: string) => d.slice(5)} tick={{ fontSize: 10, fill: 'var(--text-subtle)' }} interval="preserveStartEnd" />
            <YAxis tickFormatter={fmtAxis} tick={{ fontSize: 10, fill: 'var(--text-subtle)' }} />
            <Tooltip
              contentStyle={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
              formatter={(v) => v != null ? fmtAxis(Number(v)) + ' шт' : '—'}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {latestDate && <ReferenceLine x={latestDate} stroke="var(--text-subtle)" strokeDasharray="2 4" label={{ value: 'today', fontSize: 9, fill: 'var(--text-subtle)' }} />}
            <Line type="monotone" dataKey="fact" name="Факт" stroke="#3b82f6" strokeWidth={2} dot={false} connectNulls={false} />
            <Line type="monotone" dataKey="forecast" name="Прогноз" stroke="#22c55e" strokeWidth={2} dot={false} connectNulls={false} />
            <Line type="monotone" dataKey="stock" name="Остаток" stroke="#ef4444" strokeWidth={2} strokeDasharray="5 4" dot={false} connectNulls={true} />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </GlassCard>
  )
}
