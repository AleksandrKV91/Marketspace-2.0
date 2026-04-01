'use client'

import { useEffect, useState, useMemo } from 'react'

interface PriceChange {
  sku_wb: number
  sku_ms: string | null
  name: string | null
  brand: string | null
  subject_wb: string | null
  price_date: string
  price_after: number | null
  price_before: number | null
  delta_pct: number | null
}

type SortKey = 'price_date' | 'delta_pct' | 'price_after' | 'price_before' | 'sku_ms'
type SortDir = 'asc' | 'desc'

function fmt(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined) return '—'
  return n.toFixed(digits)
}

function fmtDate(iso: string): string {
  return iso.split('-').reverse().join('.')
}

export default function PriceTab() {
  const [changes, setChanges] = useState<PriceChange[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('price_date')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [filterDir, setFilterDir] = useState<'' | 'up' | 'down'>('')

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 400)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    setLoading(true)
    const params = debouncedSearch ? `?search=${encodeURIComponent(debouncedSearch)}` : ''
    fetch(`/api/dashboard/prices${params}`)
      .then(r => r.json())
      .then(d => { setChanges(d.changes ?? []); setLoading(false) })
      .catch(e => { setError(String(e)); setLoading(false) })
  }, [debouncedSearch])

  const sorted = useMemo(() => {
    let result = [...changes]
    if (filterDir === 'up') result = result.filter(r => (r.delta_pct ?? 0) > 0)
    if (filterDir === 'down') result = result.filter(r => (r.delta_pct ?? 0) < 0)
    result.sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      if (av === null || av === undefined) return 1
      if (bv === null || bv === undefined) return -1
      const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true })
      return sortDir === 'asc' ? cmp : -cmp
    })
    return result
  }, [changes, sortKey, sortDir, filterDir])

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  function SortBtn({ col, label }: { col: SortKey; label: string }) {
    const active = sortKey === col
    return (
      <button
        onClick={() => toggleSort(col)}
        className={`flex items-center gap-0.5 whitespace-nowrap ${active ? 'text-[#E63946]' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
      >
        {label}
        <span className="text-xs">{active ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}</span>
      </button>
    )
  }

  return (
    <div className="max-w-full px-4">
      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <input
          type="text"
          placeholder="Поиск по артикулу..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="border border-gray-200 dark:border-white/10 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-white/5 text-gray-800 dark:text-white placeholder:text-gray-400 w-56 focus:outline-none focus:ring-1 focus:ring-[#E63946]"
        />
        <div className="flex gap-1">
          {[
            { v: '' as const, label: 'Все' },
            { v: 'up' as const, label: '↑ Рост' },
            { v: 'down' as const, label: '↓ Снижение' },
          ].map(opt => (
            <button
              key={opt.v}
              onClick={() => setFilterDir(opt.v)}
              className={`px-2.5 py-1 rounded-lg text-sm font-medium transition-colors ${
                filterDir === opt.v
                  ? 'bg-[#E63946] text-white'
                  : 'bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 text-gray-600 dark:text-gray-300'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <span className="text-xs text-gray-400 ml-2">{sorted.length} изменений</span>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-20 text-gray-400">
          <div className="animate-spin w-5 h-5 border-2 border-[#E63946] border-t-transparent rounded-full mr-2" />
          Загрузка...
        </div>
      )}
      {error && <p className="text-red-500 py-8 text-center">{error}</p>}

      {!loading && !error && (
        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-white/10">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-white/5">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium"><SortBtn col="price_date" label="Дата" /></th>
                <th className="px-3 py-2 font-medium"><SortBtn col="sku_ms" label="Артикул МС" /></th>
                <th className="px-3 py-2 font-medium text-gray-500 max-w-[200px]">Название</th>
                <th className="px-3 py-2 font-medium text-gray-500">Категория</th>
                <th className="px-3 py-2 font-medium"><SortBtn col="price_before" label="Цена до" /></th>
                <th className="px-3 py-2 font-medium"><SortBtn col="price_after" label="Цена после" /></th>
                <th className="px-3 py-2 font-medium"><SortBtn col="delta_pct" label="Изм. %" /></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-white/5">
              {sorted.map((row, i) => {
                const delta = row.delta_pct
                const up = delta !== null && delta > 0
                const down = delta !== null && delta < 0
                return (
                  <tr key={i} className="hover:bg-gray-50 dark:hover:bg-white/5">
                    <td className="px-3 py-2 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                      {fmtDate(row.price_date)}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-gray-600 dark:text-gray-300">
                      <div>{row.sku_ms ?? '—'}</div>
                      <div className="text-gray-400">{row.sku_wb}</div>
                    </td>
                    <td className="px-3 py-2 max-w-[200px]">
                      <div className="truncate text-gray-800 dark:text-gray-200" title={row.name ?? ''}>
                        {row.name ?? '—'}
                      </div>
                      {row.brand && <div className="text-xs text-gray-400 truncate">{row.brand}</div>}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">{row.subject_wb ?? '—'}</td>
                    <td className="px-3 py-2 text-gray-600 dark:text-gray-400">
                      {row.price_before !== null ? fmt(row.price_before) + ' ₽' : '—'}
                    </td>
                    <td className="px-3 py-2 font-medium text-gray-800 dark:text-gray-200">
                      {row.price_after !== null ? fmt(row.price_after) + ' ₽' : '—'}
                    </td>
                    <td className="px-3 py-2">
                      {delta !== null ? (
                        <span className={`font-medium ${up ? 'text-green-600 dark:text-green-400' : down ? 'text-red-500' : 'text-gray-500'}`}>
                          {up ? '+' : ''}{(delta * 100).toFixed(1)}%
                        </span>
                      ) : '—'}
                    </td>
                  </tr>
                )
              })}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-gray-400">Нет данных</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
