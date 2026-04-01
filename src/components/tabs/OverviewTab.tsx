'use client'

import { useEffect, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'

interface OverviewData {
  daily: { total_revenue: number; total_ad_spend: number; drr: number } | null
  stock: { total_fbo: number; total_fbs: number; total_stock: number; sku_count: number } | null
  abc: { A: number; B: number; C: number } | null
  sku: { sku_count: number; avg_margin: number; oos_count: number } | null
  trend: Array<{ date: string; revenue: number; ad_spend: number }>
  latest_date: string | null
}

function fmt(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined) return '—'
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'М'
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(digits > 0 ? digits : 0) + 'К'
  return n.toFixed(digits)
}

function pct(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  return (n * 100).toFixed(1) + '%'
}

function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className={`rounded-xl p-4 border ${accent ? 'bg-[#E63946]/10 border-[#E63946]/30' : 'bg-white dark:bg-white/5 border-gray-200 dark:border-white/10'}`}>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{label}</p>
      <p className="text-2xl font-bold text-[#1A1A2E] dark:text-white">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  )
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getDate().toString().padStart(2, '0')}.${(d.getMonth() + 1).toString().padStart(2, '0')}`
}

export default function OverviewTab() {
  const [data, setData] = useState<OverviewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/dashboard/overview')
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(e => { setError(String(e)); setLoading(false) })
  }, [])

  if (loading) return (
    <div className="flex items-center justify-center py-32 text-gray-400">
      <div className="animate-spin w-6 h-6 border-2 border-[#E63946] border-t-transparent rounded-full mr-3" />
      Загрузка...
    </div>
  )

  if (error) return (
    <div className="max-w-xl mx-auto px-4 py-16 text-center text-red-500">{error}</div>
  )

  if (!data) return null

  const trendData = data.trend.map(r => ({
    date: formatDate(r.date),
    revenue: Math.round(r.revenue),
    ad_spend: Math.round(r.ad_spend),
  }))

  return (
    <div className="max-w-6xl mx-auto px-4 space-y-6">
      {data.latest_date && (
        <p className="text-xs text-gray-400">
          Данные на: {formatDate(data.latest_date)}
        </p>
      )}

      {/* KPI карточки */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Выручка (день)"
          value={fmt(data.daily?.total_revenue)}
          sub="руб."
        />
        <StatCard
          label="Расходы на рекламу"
          value={fmt(data.daily?.total_ad_spend)}
          sub="руб."
        />
        <StatCard
          label="ДРР"
          value={pct(data.daily?.drr)}
          accent={(data.daily?.drr ?? 0) > 0.3}
        />
        <StatCard
          label="Всего остатки"
          value={fmt(data.stock?.total_stock)}
          sub={`FBO: ${fmt(data.stock?.total_fbo)} / FBS: ${fmt(data.stock?.total_fbs)}`}
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Артикулов"
          value={String(data.sku?.sku_count ?? '—')}
          sub={data.sku ? `OOS: ${data.sku.oos_count}` : undefined}
        />
        <StatCard
          label="Средняя маржа"
          value={fmt(data.sku?.avg_margin)}
          sub="руб."
        />
        <StatCard
          label="ABC: A / B / C"
          value={data.abc ? `${data.abc.A} / ${data.abc.B} / ${data.abc.C}` : '—'}
        />
        <StatCard
          label="SKU на складах"
          value={String(data.stock?.sku_count ?? '—')}
        />
      </div>

      {/* График тренда */}
      {trendData.length > 0 && (
        <div className="bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl p-4">
          <p className="text-sm font-medium text-[#1A1A2E] dark:text-white mb-4">Выручка и расходы (14 дней)</p>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={trendData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" strokeOpacity={0.5} />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} width={60} tickFormatter={v => fmt(v)} />
              <Tooltip formatter={(v) => fmt(Number(v)) + ' руб.'} />
              <Line type="monotone" dataKey="revenue" stroke="#E63946" strokeWidth={2} dot={false} name="Выручка" />
              <Line type="monotone" dataKey="ad_spend" stroke="#3B82F6" strokeWidth={2} dot={false} name="Реклама" />
            </LineChart>
          </ResponsiveContainer>
          <div className="flex gap-4 mt-2 justify-center text-xs text-gray-500">
            <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-[#E63946] inline-block" /> Выручка</span>
            <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-blue-500 inline-block" /> Реклама</span>
          </div>
        </div>
      )}

      {/* АВС распределение */}
      {data.abc && (
        <div className="bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl p-4">
          <p className="text-sm font-medium text-[#1A1A2E] dark:text-white mb-3">АВС анализ</p>
          <div className="flex gap-4">
            {[
              { cls: 'A', count: data.abc.A, color: '#22c55e' },
              { cls: 'B', count: data.abc.B, color: '#f59e0b' },
              { cls: 'C', count: data.abc.C, color: '#ef4444' },
            ].map(({ cls, count, color }) => {
              const total = data.abc!.A + data.abc!.B + data.abc!.C
              const pctVal = total > 0 ? Math.round(count / total * 100) : 0
              return (
                <div key={cls} className="flex-1 text-center">
                  <div className="h-2 rounded-full mb-2" style={{ backgroundColor: color, opacity: 0.2 }}>
                    <div className="h-2 rounded-full" style={{ backgroundColor: color, width: pctVal + '%' }} />
                  </div>
                  <p className="text-lg font-bold" style={{ color }}>{count}</p>
                  <p className="text-xs text-gray-500">Класс {cls} ({pctVal}%)</p>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
