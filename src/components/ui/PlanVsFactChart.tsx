'use client'

import { useEffect, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts'
import { GlassCard } from './GlassCard'
import { fmtAxis } from '@/lib/formatters'

interface PvfPoint { month: string; label: string; plan_qty: number; fact_qty: number }

export function PlanVsFactChart() {
  const [data, setData] = useState<PvfPoint[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/dashboard/orders/plan-vs-fact')
      .then(r => r.json())
      .then((d: { rows: PvfPoint[] }) => { setData(d.rows ?? []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  return (
    <GlassCard padding="md">
      <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text)' }}>План vs Факт</h3>
      {loading ? (
        <div className="h-56 flex items-center justify-center text-xs" style={{ color: 'var(--text-subtle)' }}>Загрузка…</div>
      ) : data.length === 0 ? (
        <div className="h-56 flex items-center justify-center text-xs" style={{ color: 'var(--text-subtle)' }}>Нет данных</div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
            <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--text-subtle)' }} />
            <YAxis tickFormatter={fmtAxis} tick={{ fontSize: 10, fill: 'var(--text-subtle)' }} />
            <Tooltip
              contentStyle={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
              formatter={(v) => fmtAxis(Number(v))}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="plan_qty" name="План (шт)" fill="var(--info)" radius={[4, 4, 0, 0]} />
            <Bar dataKey="fact_qty" name="Факт (шт)" fill="var(--success)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </GlassCard>
  )
}
