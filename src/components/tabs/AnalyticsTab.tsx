'use client'

import { useEffect, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'

interface CategoryRow {
  category: string
  sku_count: number
  revenue: number
  ad_spend: number
  drr: number
  chmd: number
  avg_margin_rub: number
}

function fmt(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined) return '—'
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'М'
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(1) + 'К'
  return n.toFixed(digits)
}

function pct(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  return (n * 100).toFixed(1) + '%'
}

export default function AnalyticsTab() {
  const [categories, setCategories] = useState<CategoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [latestDate, setLatestDate] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/dashboard/analytics')
      .then(r => r.json())
      .then(d => {
        setCategories(d.categories ?? [])
        setLatestDate(d.latest_date ?? null)
        setLoading(false)
      })
      .catch(e => { setError(String(e)); setLoading(false) })
  }, [])

  if (loading) return (
    <div className="flex items-center justify-center py-32 text-gray-400">
      <div className="animate-spin w-6 h-6 border-2 border-[#E63946] border-t-transparent rounded-full mr-3" />
      Загрузка...
    </div>
  )

  if (error) return <div className="max-w-xl mx-auto px-4 py-16 text-center text-red-500">{error}</div>

  const top10 = categories.slice(0, 10)
  const chartData = top10.map(c => ({
    name: c.category.length > 16 ? c.category.slice(0, 16) + '…' : c.category,
    revenue: Math.round(c.revenue),
    ad_spend: Math.round(c.ad_spend),
  }))

  return (
    <div className="max-w-6xl mx-auto px-4 space-y-6">
      {latestDate && (
        <p className="text-xs text-gray-400">
          Данные за 5 дней до: {latestDate.split('-').reverse().join('.')}
        </p>
      )}

      {/* Топ-10 график */}
      {chartData.length > 0 && (
        <div className="bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl p-4">
          <p className="text-sm font-medium text-[#1A1A2E] dark:text-white mb-4">Выручка по категориям (топ-10)</p>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={chartData} layout="vertical" margin={{ top: 0, right: 40, bottom: 0, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" strokeOpacity={0.4} horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={v => fmt(v)} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={120} />
              <Tooltip formatter={(v: number) => fmt(v) + ' руб.'} />
              <Bar dataKey="revenue" fill="#E63946" name="Выручка" radius={[0, 4, 4, 0]} />
              <Bar dataKey="ad_spend" fill="#3B82F6" name="Реклама" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <div className="flex gap-4 mt-2 justify-center text-xs text-gray-500">
            <span className="flex items-center gap-1"><span className="w-3 h-2 bg-[#E63946] inline-block rounded" /> Выручка</span>
            <span className="flex items-center gap-1"><span className="w-3 h-2 bg-blue-500 inline-block rounded" /> Реклама</span>
          </div>
        </div>
      )}

      {/* Таблица по категориям */}
      <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-white/10">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-white/5">
            <tr className="text-left">
              <th className="px-3 py-2 font-medium text-gray-600 dark:text-gray-300">Категория</th>
              <th className="px-3 py-2 font-medium text-gray-600 dark:text-gray-300">SKU</th>
              <th className="px-3 py-2 font-medium text-gray-600 dark:text-gray-300">Выручка 5д</th>
              <th className="px-3 py-2 font-medium text-gray-600 dark:text-gray-300">Реклама 5д</th>
              <th className="px-3 py-2 font-medium text-gray-600 dark:text-gray-300">ДРР</th>
              <th className="px-3 py-2 font-medium text-gray-600 dark:text-gray-300">ЧМД</th>
              <th className="px-3 py-2 font-medium text-gray-600 dark:text-gray-300">Маржа ср.</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-white/5">
            {categories.map((cat, i) => (
              <tr key={i} className="hover:bg-gray-50 dark:hover:bg-white/5">
                <td className="px-3 py-2 text-gray-800 dark:text-gray-200 font-medium">{cat.category}</td>
                <td className="px-3 py-2 text-gray-500">{cat.sku_count}</td>
                <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{fmt(cat.revenue)}</td>
                <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{fmt(cat.ad_spend)}</td>
                <td className="px-3 py-2">
                  <span className={cat.drr > 0.35 ? 'text-red-500 font-medium' : 'text-gray-700 dark:text-gray-300'}>
                    {pct(cat.drr)}
                  </span>
                </td>
                <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{fmt(cat.chmd)}</td>
                <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{fmt(cat.avg_margin_rub)} ₽</td>
              </tr>
            ))}
            {categories.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-gray-400">Нет данных</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
