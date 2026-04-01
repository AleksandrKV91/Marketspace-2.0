'use client'

import { useEffect, useState, useMemo } from 'react'

interface SkuRow {
  sku_ms: string
  sku_wb: number | null
  name: string | null
  brand: string | null
  supplier: string | null
  subject_wb: string | null
  fbo_wb: number
  fbs: number
  total_stock: number
  price: number | null
  margin_rub: number | null
  margin_pct: number | null
  supply_date: string | null
  supply_qty: number | null
  abc_class: string | null
  profitability: number | null
  revenue_5d: number | null
  ad_spend_5d: number | null
  drr_5d: number | null
}

type SortKey = keyof SkuRow
type SortDir = 'asc' | 'desc'

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

function abcBadge(cls: string | null) {
  if (!cls) return null
  const colors: Record<string, string> = {
    A: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400',
    B: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400',
    C: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
  }
  const color = colors[cls.toUpperCase()] ?? 'bg-gray-100 text-gray-600'
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-bold ${color}`}>
      {cls.toUpperCase()}
    </span>
  )
}

export default function SkuTableTab() {
  const [rows, setRows] = useState<SkuRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('total_stock')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [filterAbc, setFilterAbc] = useState<string>('')

  // Дебаунс поиска
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 400)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    setLoading(true)
    const params = debouncedSearch ? `?search=${encodeURIComponent(debouncedSearch)}` : ''
    fetch(`/api/dashboard/sku-table${params}`)
      .then(r => r.json())
      .then(d => { setRows(d.rows ?? []); setLoading(false) })
      .catch(e => { setError(String(e)); setLoading(false) })
  }, [debouncedSearch])

  const sorted = useMemo(() => {
    let result = [...rows]
    if (filterAbc) result = result.filter(r => (r.abc_class ?? '').toUpperCase() === filterAbc)
    result.sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      if (av === null || av === undefined) return 1
      if (bv === null || bv === undefined) return -1
      const cmp = av < bv ? -1 : av > bv ? 1 : 0
      return sortDir === 'asc' ? cmp : -cmp
    })
    return result
  }, [rows, sortKey, sortDir, filterAbc])

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
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
      {/* Фильтры */}
      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <input
          type="text"
          placeholder="Поиск по артикулу или названию..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="border border-gray-200 dark:border-white/10 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-white/5 text-gray-800 dark:text-white placeholder:text-gray-400 w-64 focus:outline-none focus:ring-1 focus:ring-[#E63946]"
        />
        <div className="flex gap-1">
          {['', 'A', 'B', 'C'].map(cls => (
            <button
              key={cls}
              onClick={() => setFilterAbc(cls)}
              className={`px-2.5 py-1 rounded-lg text-sm font-medium transition-colors ${
                filterAbc === cls
                  ? 'bg-[#E63946] text-white'
                  : 'bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 text-gray-600 dark:text-gray-300 hover:border-[#E63946]'
              }`}
            >
              {cls === '' ? 'Все' : `ABC: ${cls}`}
            </button>
          ))}
        </div>
        <span className="text-xs text-gray-400 ml-2">{sorted.length} артикулов</span>
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
                <th className="px-3 py-2 font-medium"><SortBtn col="sku_ms" label="Арт. МС" /></th>
                <th className="px-3 py-2 font-medium text-gray-500 max-w-[180px]">Название</th>
                <th className="px-3 py-2 font-medium"><SortBtn col="abc_class" label="ABC" /></th>
                <th className="px-3 py-2 font-medium"><SortBtn col="total_stock" label="Остаток" /></th>
                <th className="px-3 py-2 font-medium"><SortBtn col="fbo_wb" label="FBO" /></th>
                <th className="px-3 py-2 font-medium"><SortBtn col="fbs" label="FBS" /></th>
                <th className="px-3 py-2 font-medium"><SortBtn col="price" label="Цена" /></th>
                <th className="px-3 py-2 font-medium"><SortBtn col="margin_rub" label="Маржа ₽" /></th>
                <th className="px-3 py-2 font-medium"><SortBtn col="revenue_5d" label="Выручка 5д" /></th>
                <th className="px-3 py-2 font-medium"><SortBtn col="ad_spend_5d" label="Реклама 5д" /></th>
                <th className="px-3 py-2 font-medium"><SortBtn col="drr_5d" label="ДРР 5д" /></th>
                <th className="px-3 py-2 font-medium text-gray-500">Поставка</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-white/5">
              {sorted.map(row => {
                const isOOS = row.total_stock === 0
                const highDrr = (row.drr_5d ?? 0) > 0.35
                return (
                  <tr
                    key={row.sku_ms}
                    className={`hover:bg-gray-50 dark:hover:bg-white/5 transition-colors ${isOOS ? 'opacity-60' : ''}`}
                  >
                    <td className="px-3 py-2 font-mono text-xs text-gray-600 dark:text-gray-300">
                      <div>{row.sku_ms}</div>
                      {row.sku_wb && <div className="text-gray-400">{row.sku_wb}</div>}
                    </td>
                    <td className="px-3 py-2 max-w-[180px]">
                      <div className="truncate text-gray-800 dark:text-gray-200" title={row.name ?? ''}>
                        {row.name ?? '—'}
                      </div>
                      {row.brand && <div className="text-xs text-gray-400 truncate">{row.brand}</div>}
                    </td>
                    <td className="px-3 py-2">{abcBadge(row.abc_class)}</td>
                    <td className="px-3 py-2 font-medium">
                      <span className={isOOS ? 'text-red-500' : 'text-gray-800 dark:text-gray-200'}>
                        {isOOS ? 'OOS' : row.total_stock}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-gray-600 dark:text-gray-400">{row.fbo_wb || '—'}</td>
                    <td className="px-3 py-2 text-gray-600 dark:text-gray-400">{row.fbs || '—'}</td>
                    <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{fmt(row.price)}</td>
                    <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{fmt(row.margin_rub)}</td>
                    <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{fmt(row.revenue_5d)}</td>
                    <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{fmt(row.ad_spend_5d)}</td>
                    <td className="px-3 py-2">
                      <span className={highDrr ? 'text-red-500 font-medium' : 'text-gray-700 dark:text-gray-300'}>
                        {pct(row.drr_5d)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500">
                      {row.supply_date ? (
                        <div>
                          <div>{row.supply_date.split('-').reverse().join('.')}</div>
                          {row.supply_qty && <div className="text-gray-400">{row.supply_qty} шт</div>}
                        </div>
                      ) : '—'}
                    </td>
                  </tr>
                )
              })}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={12} className="px-4 py-12 text-center text-gray-400">
                    Нет данных
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
