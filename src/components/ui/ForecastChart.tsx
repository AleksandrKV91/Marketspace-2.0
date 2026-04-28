'use client'

import { useEffect, useState } from 'react'
import { ComposedChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts'
import { GlassCard } from './GlassCard'
import { fmtAxis } from '@/lib/formatters'

interface ForecastPoint {
  date: string
  fact: number | null
  forecast: number | null
  stock: number | null
}

interface TrendPoint { date: string; total_stock_qty: number }

export function ForecastChart({ velocity, totalStock }: { velocity: number; totalStock: number }) {
  // Главный график: факт продаж 30д (синий) + прогноз 30д (зелёный) + остаток (красный пунктир)
  const [data, setData] = useState<ForecastPoint[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/dashboard/orders/trend')
      .then(r => r.json())
      .then((d: { rows: TrendPoint[] }) => {
        const trend = d.rows ?? []
        // Конвертируем total_stock в "продажи дня": берём delta между днями как индикатор
        // Здесь упрощённо: используем total_stock_qty как stock, а fact = total_stock_qty (просто как тренд запасов)
        // Forecast = velocity (ср.шт/день) на следующие 30 дней с уменьшающимся остатком
        const factPoints: ForecastPoint[] = trend.map(t => ({
          date: t.date,
          fact: t.total_stock_qty,
          forecast: null,
          stock: t.total_stock_qty,
        }))

        // Прогноз на 30 дней вперёд от последней даты
        const lastDate = trend.length > 0 ? trend[trend.length - 1].date : null
        const forecastPoints: ForecastPoint[] = []
        if (lastDate) {
          let stockProj = totalStock
          for (let i = 1; i <= 30; i++) {
            const d = new Date(lastDate); d.setDate(d.getDate() + i)
            stockProj = Math.max(0, stockProj - velocity)
            forecastPoints.push({
              date: d.toISOString().split('T')[0],
              fact: null,
              forecast: Math.round(velocity * i * 100) / 100,
              stock: Math.round(stockProj),
            })
          }
        }

        setData([...factPoints, ...forecastPoints])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [velocity, totalStock])

  return (
    <GlassCard padding="md">
      <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text)' }}>
        Прогноз продаж 30д
        <span className="ml-2 text-[10px] font-normal" style={{ color: 'var(--text-subtle)' }}>
          (синий=факт, зелёный=прогноз, красный=остаток)
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
            <XAxis dataKey="date" tickFormatter={(d: string) => d.slice(5)} tick={{ fontSize: 10, fill: 'var(--text-subtle)' }} />
            <YAxis tickFormatter={fmtAxis} tick={{ fontSize: 10, fill: 'var(--text-subtle)' }} />
            <Tooltip
              contentStyle={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
              formatter={(v) => v != null ? fmtAxis(Number(v)) : '—'}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="fact" name="Факт" stroke="#3b82f6" strokeWidth={2} dot={false} connectNulls={false} />
            <Line type="monotone" dataKey="forecast" name="Прогноз" stroke="#22c55e" strokeWidth={2} dot={false} connectNulls={false} />
            <Line type="monotone" dataKey="stock" name="Остаток" stroke="#ef4444" strokeWidth={2} strokeDasharray="5 4" dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </GlassCard>
  )
}
