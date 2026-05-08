'use client'

import { useEffect, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts'
import { GlassCard } from './GlassCard'
import { fmtAxis } from '@/lib/formatters'

interface PvfPoint { month: string; label: string; plan_rub: number; fact_rub: number }

function fmtRub(n: number) {
  return Math.round(n).toLocaleString('ru-RU') + ' ₽'
}

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
      <h3 className="text-sm font-semibold mb-1" style={{ color: 'var(--text)' }}>
        План vs Факт продаж по месяцам
        <span className="ml-2 text-[10px] font-normal" style={{ color: 'var(--text-subtle)' }}>(₽)</span>
      </h3>
      {loading ? (
        <div className="h-56 flex items-center justify-center text-xs" style={{ color: 'var(--text-subtle)' }}>Загрузка…</div>
      ) : data.length === 0 ? (
        <div className="h-56 flex items-center justify-center text-xs" style={{ color: 'var(--text-subtle)' }}>Нет данных</div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
            <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--text-subtle)' }} />
            <YAxis tickFormatter={(v) => fmtAxis(Number(v))} tick={{ fontSize: 10, fill: 'var(--text-subtle)' }} />
            <Tooltip
              contentStyle={{ background: '#fff', border: '1px solid #ccc', borderRadius: 8, fontSize: 12, color: '#000' }}
              formatter={(v) => fmtRub(Number(v))}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="plan_rub" name="План, ₽" fill="#3B82F6" radius={[4, 4, 0, 0]} />
            <Bar dataKey="fact_rub" name="Факт, ₽" fill="#10B981" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </GlassCard>
  )
}
