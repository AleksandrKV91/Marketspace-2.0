'use client'

import { useEffect, useState } from 'react'
import { ComposedChart, Area, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts'
import { GlassCard } from './GlassCard'
import { fmtAxis } from '@/lib/formatters'

interface TrendPoint { date: string; total_stock_qty: number; oos_pct: number }

export function StockTrendChart() {
  const [data, setData] = useState<TrendPoint[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/dashboard/orders/trend')
      .then(r => r.json())
      .then((d: { rows: TrendPoint[] }) => { setData(d.rows ?? []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  return (
    <GlassCard padding="md">
      <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text)' }}>
        Объём оборота и доля SKU без продаж
        <span className="ml-2 text-[10px] font-normal" style={{ color: 'var(--text-subtle)' }}>
          (выручка ₽ / % SKU без продаж в день)
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
            <YAxis yAxisId="left" tickFormatter={fmtAxis} tick={{ fontSize: 10, fill: 'var(--text-subtle)' }} />
            <YAxis yAxisId="right" orientation="right" tickFormatter={(v: number) => v + '%'} tick={{ fontSize: 10, fill: 'var(--text-subtle)' }} />
            <Tooltip
              contentStyle={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
              formatter={(v, name) => name === '% SKU в OOS' ? `${Number(v)}%` : fmtAxis(Number(v)) + ' ₽'}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Area yAxisId="left" type="monotone" dataKey="total_stock_qty" name="Выручка ₽" stroke="var(--accent)" fill="var(--accent)" fillOpacity={0.15} />
            <Line yAxisId="right" type="monotone" dataKey="oos_pct" name="% SKU в OOS" stroke="var(--danger)" strokeWidth={2} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </GlassCard>
  )
}
