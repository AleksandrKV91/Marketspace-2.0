'use client'

import { useEffect, useState, useMemo } from 'react'

interface OrderRow {
  sku_ms: string
  sku_wb: number
  name: string | null
  brand: string | null
  subject_wb: string | null
  total_stock: number
  fbo_wb: number
  fbs_pushkino: number
  fbs_smolensk: number
  in_transit: number
  in_production: number
  already_have: number
  sales_7d: number
  sales_14d: number
  sales_31d: number
  dpd: number
  days_stock: number
  log_pleche: number
  calc_order: number
  abc_class: string | null
  profitability: number | null
  nearest_arrival: string | null
  status: 'ok' | 'warning' | 'critical' | 'oos'
}

interface Kpi {
  critical: number
  warning: number
  oos: number
  to_order: number
}

type SortKey = keyof OrderRow
type SortDir = 'asc' | 'desc'

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return iso.split('-').reverse().join('.')
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

const STATUS_CONFIG = {
  oos: { label: 'OOS', color: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400' },
  critical: { label: '🚨', color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400' },
  warning: { label: '⚠️', color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400' },
  ok: { label: '✓', color: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400' },
}

export default function OrderTab() {
  const [rows, setRows] = useState<OrderRow[]>([])
  const [kpi, setKpi] = useState<Kpi | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterAbc, setFilterAbc] = useState('')
  const [onlyToOrder, setOnlyToOrder] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('status')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/dashboard/orders')
      .then(r => r.json())
      .then(d => {
        setRows(d.rows ?? [])
        setKpi(d.kpi ?? null)
        setLoading(false)
      })
      .catch(e => { setError(String(e)); setLoading(false) })
  }, [])

  const sorted = useMemo(() => {
    let result = [...rows]
    if (search) {
      const q = search.toLowerCase()
      result = result.filter(r =>
        r.sku_ms.toLowerCase().includes(q) ||
        String(r.name ?? '').toLowerCase().includes(q)
      )
    }
    if (filterStatus) result = result.filter(r => r.status === filterStatus)
    if (filterAbc) result = result.filter(r => (r.abc_class ?? '').toUpperCase() === filterAbc)
    if (onlyToOrder) result = result.filter(r => r.calc_order > 0)
    result.sort((a, b) => {
      const statusOrder = { oos: 0, critical: 1, warning: 2, ok: 3 }
      if (sortKey === 'status') {
        const cmp = statusOrder[a.status] - statusOrder[b.status]
        return sortDir === 'asc' ? cmp : -cmp
      }
      const av = a[sortKey]
      const bv = b[sortKey]
      if (av === null || av === undefined) return 1
      if (bv === null || bv === undefined) return -1
      const cmp = av < bv ? -1 : av > bv ? 1 : 0
      return sortDir === 'asc' ? cmp : -cmp
    })
    return result
  }, [rows, search, filterStatus, filterAbc, onlyToOrder, sortKey, sortDir])

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
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
    <div className="max-w-full px-4 space-y-4">
      {/* KPI */}
      {kpi && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: '🚨 Критично', value: kpi.critical, color: 'text-red-500' },
            { label: '⚠️ Внимание', value: kpi.warning, color: 'text-yellow-600' },
            { label: '📭 OOS', value: kpi.oos, color: 'text-orange-500' },
            { label: '📦 К заказу', value: kpi.to_order, color: 'text-blue-500' },
          ].map(item => (
            <div key={item.label} className="bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl p-4">
              <p className="text-xs text-gray-500 mb-1">{item.label}</p>
              <p className={`text-2xl font-bold ${item.color}`}>{item.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Фильтры */}
      <div className="flex flex-wrap gap-2 items-center">
        <input
          type="text"
          placeholder="Поиск по артикулу..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="border border-gray-200 dark:border-white/10 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-white/5 text-gray-800 dark:text-white placeholder:text-gray-400 w-56 focus:outline-none focus:ring-1 focus:ring-[#E63946]"
        />
        <div className="flex gap-1">
          {[
            { v: '', label: 'Все' },
            { v: 'oos', label: 'OOS' },
            { v: 'critical', label: '🚨 Критично' },
            { v: 'warning', label: '⚠️ Внимание' },
          ].map(opt => (
            <button
              key={opt.v}
              onClick={() => setFilterStatus(opt.v)}
              className={`px-2.5 py-1 rounded-lg text-sm font-medium transition-colors ${
                filterStatus === opt.v
                  ? 'bg-[#E63946] text-white'
                  : 'bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 text-gray-600 dark:text-gray-300'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          {['', 'A', 'B', 'C'].map(cls => (
            <button
              key={cls}
              onClick={() => setFilterAbc(cls)}
              className={`px-2.5 py-1 rounded-lg text-sm font-medium transition-colors ${
                filterAbc === cls
                  ? 'bg-[#E63946] text-white'
                  : 'bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 text-gray-600 dark:text-gray-300'
              }`}
            >
              {cls === '' ? 'ABC: все' : cls}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 cursor-pointer select-none text-sm text-gray-600 dark:text-gray-300">
          <input
            type="checkbox"
            checked={onlyToOrder}
            onChange={e => setOnlyToOrder(e.target.checked)}
            className="rounded border-gray-300 text-[#E63946] focus:ring-[#E63946]"
          />
          Только к заказу
        </label>
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
                <th className="px-3 py-2 font-medium"><SortBtn col="status" label="Статус" /></th>
                <th className="px-3 py-2 font-medium"><SortBtn col="sku_ms" label="Артикул" /></th>
                <th className="px-3 py-2 font-medium text-gray-500 max-w-[160px]">Название</th>
                <th className="px-3 py-2 font-medium"><SortBtn col="abc_class" label="ABC" /></th>
                <th className="px-3 py-2 font-medium"><SortBtn col="total_stock" label="Остаток" /></th>
                <th className="px-3 py-2 font-medium"><SortBtn col="already_have" label="На руках" /></th>
                <th className="px-3 py-2 font-medium"><SortBtn col="days_stock" label="Дней" /></th>
                <th className="px-3 py-2 font-medium"><SortBtn col="dpd" label="Прод/день" /></th>
                <th className="px-3 py-2 font-medium"><SortBtn col="sales_31d" label="31д прод." /></th>
                <th className="px-3 py-2 font-medium"><SortBtn col="calc_order" label="К заказу" /></th>
                <th className="px-3 py-2 font-medium text-gray-500">Приход</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-white/5">
              {sorted.map(row => {
                const sc = STATUS_CONFIG[row.status]
                const isExpanded = expanded === row.sku_ms
                return (
                  <>
                    <tr
                      key={row.sku_ms}
                      onClick={() => setExpanded(isExpanded ? null : row.sku_ms)}
                      className="hover:bg-gray-50 dark:hover:bg-white/5 cursor-pointer"
                    >
                      <td className="px-3 py-2">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${sc.color}`}>
                          {sc.label}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-gray-600 dark:text-gray-300">
                        {row.sku_ms}
                      </td>
                      <td className="px-3 py-2 max-w-[160px]">
                        <div className="truncate text-gray-800 dark:text-gray-200" title={row.name ?? ''}>
                          {row.name ?? '—'}
                        </div>
                      </td>
                      <td className="px-3 py-2">{abcBadge(row.abc_class)}</td>
                      <td className="px-3 py-2 font-medium">
                        <span className={row.total_stock === 0 ? 'text-red-500' : 'text-gray-800 dark:text-gray-200'}>
                          {row.total_stock === 0 ? 'OOS' : row.total_stock}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-gray-600 dark:text-gray-400">{row.already_have}</td>
                      <td className="px-3 py-2">
                        <span className={
                          row.days_stock < 30 ? 'text-red-500 font-medium' :
                          row.days_stock < 60 ? 'text-yellow-600 font-medium' :
                          'text-gray-700 dark:text-gray-300'
                        }>
                          {row.days_stock === 999 ? '∞' : row.days_stock}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-gray-600 dark:text-gray-400">{row.dpd}</td>
                      <td className="px-3 py-2 text-gray-600 dark:text-gray-400">{row.sales_31d}</td>
                      <td className="px-3 py-2">
                        <span className={row.calc_order > 0 ? 'text-blue-600 dark:text-blue-400 font-medium' : 'text-gray-400'}>
                          {row.calc_order > 0 ? row.calc_order : '—'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-500">{fmtDate(row.nearest_arrival)}</td>
                    </tr>
                    {isExpanded && (
                      <tr key={row.sku_ms + '_detail'} className="bg-blue-50 dark:bg-blue-900/10">
                        <td colSpan={11} className="px-4 py-3">
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                            <div>
                              <p className="text-xs text-gray-500 mb-1 font-medium">Остатки</p>
                              <p>FBO WB: <span className="font-medium">{row.fbo_wb}</span></p>
                              <p>FBS Пушкино: <span className="font-medium">{row.fbs_pushkino}</span></p>
                              <p>FBS Смоленск: <span className="font-medium">{row.fbs_smolensk}</span></p>
                            </div>
                            <div>
                              <p className="text-xs text-gray-500 mb-1 font-medium">В движении</p>
                              <p>В пути: <span className="font-medium">{row.in_transit}</span></p>
                              <p>В производстве: <span className="font-medium">{row.in_production}</span></p>
                              <p>Итого на руках: <span className="font-bold text-blue-600">{row.already_have}</span></p>
                            </div>
                            <div>
                              <p className="text-xs text-gray-500 mb-1 font-medium">Продажи</p>
                              <p>7 дней: <span className="font-medium">{row.sales_7d}</span></p>
                              <p>14 дней: <span className="font-medium">{row.sales_14d}</span></p>
                              <p>31 день: <span className="font-medium">{row.sales_31d}</span></p>
                            </div>
                            <div>
                              <p className="text-xs text-gray-500 mb-1 font-medium">Расчёт заказа</p>
                              <p>Прод/день: <span className="font-medium">{row.dpd}</span></p>
                              <p>Дней остатка: <span className={`font-medium ${row.days_stock < 30 ? 'text-red-500' : ''}`}>{row.days_stock === 999 ? '∞' : row.days_stock}</span></p>
                              <p>Лог.плечо: <span className="font-medium">{row.log_pleche} дн.</span></p>
                              <p className="mt-1 text-blue-600 dark:text-blue-400 font-bold">
                                К заказу: {row.calc_order > 0 ? row.calc_order + ' шт.' : '—'}
                              </p>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-4 py-12 text-center text-gray-400">Нет данных</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
