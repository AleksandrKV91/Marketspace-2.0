'use client'

import { useEffect, useState, useMemo } from 'react'

interface Niche {
  name: string
  category?: string
  rating?: number
  appeal?: number
  revenue?: number
  seasonality?: string
  season_start?: string
  top_month?: string
  availability?: string
  top_phrase?: string
  [key: string]: unknown
}

export default function NicheTab() {
  const [niches, setNiches] = useState<Niche[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [filterSeason, setFilterSeason] = useState('')

  useEffect(() => {
    fetch('/niches.json')
      .then(r => r.json())
      .then((d: unknown) => {
        const arr = Array.isArray(d) ? d : (d as { niches?: Niche[] }).niches ?? []
        setNiches(arr)
        setLoading(false)
      })
      .catch(() => {
        setError('niches.json не найден. Добавьте файл в /public/niches.json')
        setLoading(false)
      })
  }, [])

  const filtered = useMemo(() => {
    let result = [...niches]
    if (search) {
      const q = search.toLowerCase()
      result = result.filter(n =>
        String(n.name ?? '').toLowerCase().includes(q) ||
        String(n.category ?? '').toLowerCase().includes(q)
      )
    }
    if (filterSeason === 'seasonal') result = result.filter(n => n.seasonality && n.seasonality !== 'Нет')
    if (filterSeason === 'nonseasonal') result = result.filter(n => !n.seasonality || n.seasonality === 'Нет')
    return result
  }, [niches, search, filterSeason])

  if (loading) return (
    <div className="flex items-center justify-center py-32 text-gray-400">
      <div className="animate-spin w-6 h-6 border-2 border-[#E63946] border-t-transparent rounded-full mr-3" />
      Загрузка...
    </div>
  )

  if (error) return (
    <div className="max-w-xl mx-auto px-4 py-16 text-center">
      <p className="text-yellow-500 text-lg mb-2">⚠️</p>
      <p className="text-gray-600 dark:text-gray-400">{error}</p>
    </div>
  )

  if (niches.length === 0) return (
    <div className="max-w-xl mx-auto px-4 py-16 text-center text-gray-400">
      <p className="text-4xl mb-3">📭</p>
      <p>Файл niches.json пуст или имеет неверный формат</p>
    </div>
  )

  return (
    <div className="max-w-6xl mx-auto px-4 space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        <input
          type="text"
          placeholder="Поиск по нише или категории..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="border border-gray-200 dark:border-white/10 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-white/5 text-gray-800 dark:text-white placeholder:text-gray-400 w-64 focus:outline-none focus:ring-1 focus:ring-[#E63946]"
        />
        <div className="flex gap-1">
          {[
            { v: '', label: 'Все' },
            { v: 'seasonal', label: 'Сезонные' },
            { v: 'nonseasonal', label: 'Несезонные' },
          ].map(opt => (
            <button
              key={opt.v}
              onClick={() => setFilterSeason(opt.v)}
              className={`px-2.5 py-1 rounded-lg text-sm font-medium transition-colors ${
                filterSeason === opt.v
                  ? 'bg-[#E63946] text-white'
                  : 'bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 text-gray-600 dark:text-gray-300'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <span className="text-xs text-gray-400 ml-2">{filtered.length} ниш</span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-white/10">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-white/5">
            <tr className="text-left">
              <th className="px-3 py-2 font-medium text-gray-600 dark:text-gray-300">Ниша</th>
              <th className="px-3 py-2 font-medium text-gray-600 dark:text-gray-300">Категория</th>
              <th className="px-3 py-2 font-medium text-gray-600 dark:text-gray-300">Рейтинг</th>
              <th className="px-3 py-2 font-medium text-gray-600 dark:text-gray-300">Привл.</th>
              <th className="px-3 py-2 font-medium text-gray-600 dark:text-gray-300">Выручка</th>
              <th className="px-3 py-2 font-medium text-gray-600 dark:text-gray-300">Сезонность</th>
              <th className="px-3 py-2 font-medium text-gray-600 dark:text-gray-300">Пик</th>
              <th className="px-3 py-2 font-medium text-gray-600 dark:text-gray-300">Доступность</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-white/5">
            {filtered.slice(0, 200).map((n, i) => (
              <tr key={i} className="hover:bg-gray-50 dark:hover:bg-white/5">
                <td className="px-3 py-2">
                  <div className="font-medium text-gray-800 dark:text-gray-200">{String(n.name ?? '—')}</div>
                  {n.top_phrase && <div className="text-xs text-gray-400 truncate max-w-[200px]">{String(n.top_phrase)}</div>}
                </td>
                <td className="px-3 py-2 text-gray-500 dark:text-gray-400 text-xs">{String(n.category ?? '—')}</td>
                <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{n.rating !== undefined ? String(n.rating) : '—'}</td>
                <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{n.appeal !== undefined ? String(n.appeal) : '—'}</td>
                <td className="px-3 py-2 text-gray-700 dark:text-gray-300">
                  {n.revenue !== undefined ? (
                    Number(n.revenue) >= 1_000_000
                      ? (Number(n.revenue) / 1_000_000).toFixed(1) + 'М'
                      : Number(n.revenue) >= 1_000
                        ? (Number(n.revenue) / 1_000).toFixed(0) + 'К'
                        : String(n.revenue)
                  ) : '—'}
                </td>
                <td className="px-3 py-2 text-xs">
                  {n.seasonality && n.seasonality !== 'Нет' ? (
                    <span className="bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 rounded">
                      {String(n.seasonality)}
                    </span>
                  ) : (
                    <span className="text-gray-400">Нет</span>
                  )}
                </td>
                <td className="px-3 py-2 text-gray-500 text-xs">{String(n.top_month ?? '—')}</td>
                <td className="px-3 py-2 text-xs">
                  {n.availability ? (
                    <span className={`px-1.5 py-0.5 rounded ${
                      String(n.availability).toLowerCase().includes('высок')
                        ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400'
                        : String(n.availability).toLowerCase().includes('низк')
                          ? 'bg-red-100 dark:bg-red-900/40 text-red-500'
                          : 'bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-400'
                    }`}>
                      {String(n.availability)}
                    </span>
                  ) : '—'}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-gray-400">Ничего не найдено</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {filtered.length > 200 && (
        <p className="text-xs text-gray-400 text-center">Показано 200 из {filtered.length}. Уточните поиск.</p>
      )}
    </div>
  )
}
