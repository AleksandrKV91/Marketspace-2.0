'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from 'recharts'
import { GlassCard } from '@/components/ui/GlassCard'
import { KPIBar } from '@/components/ui/KPIBar'
import { FilterBar } from '@/components/ui/FilterBar'
import { SeasonalitySparkline } from '@/components/ui/SeasonalitySparkline'
import { exportToExcel } from '@/lib/exportExcel'
import { ChevronUp, ChevronDown } from 'lucide-react'

interface NicheRow {
  niche: string
  category: string
  rating: number
  attractiveness: number
  revenue: number
  seasonal: boolean
  season_months: number[]
  season_start: number
  season_peak: number
  availability: number
  abc_class: string
}

interface NicheData {
  summary: {
    avg_attractiveness: number
    avg_market_share: number
    seasonal_count: number
    avg_abc: string
  }
  rows: NicheRow[]
}

function fmt(n: number | null | undefined) {
  if (n == null) return '—'
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'М'
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(0) + 'К'
  return String(Math.round(n))
}

const MONTHS = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек']

function SortTh({ label, sk, align = 'right', sortKey, sortDir, onSort }: {
  label: string; sk: string; align?: 'left' | 'right' | 'center'
  sortKey: string; sortDir: 'asc' | 'desc'; onSort: (k: string) => void
}) {
  const active = sortKey === sk
  return (
    <th className={`text-${align} px-4 py-3 font-medium cursor-pointer select-none whitespace-nowrap`} style={{ color: active ? 'var(--accent)' : 'var(--text-subtle)' }} onClick={() => onSort(sk)}>
      <span className={`inline-flex items-center gap-0.5 ${align === 'right' ? 'justify-end' : ''}`}>
        {label}
        {active ? (sortDir === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />) : <ChevronUp size={11} style={{ opacity: 0.3 }} />}
      </span>
    </th>
  )
}

export default function NicheTab() {
  const [data, setData] = useState<NicheData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [nicheFilter, setNicheFilter] = useState<Record<string, string>>({ seasonal: 'all', abc: 'all', min_revenue: 'all' })
  const [sortKey, setSortKey] = useState<keyof NicheRow>('rating')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  function toggleSort(key: keyof NicheRow) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  useEffect(() => {
    fetch('/api/dashboard/niches')
      .then(r => r.json())
      .then((d: NicheData) => { setData(d); setLoading(false) })
      .catch((e: unknown) => { setError(String(e)); setLoading(false) })
  }, [])

  if (error) return <div className="px-6 py-16 text-center" style={{ color: 'var(--danger)' }}>{error}</div>

  const allRows = data?.rows ?? []
  const hasFilter = search.trim() !== '' || nicheFilter.seasonal !== 'all' || nicheFilter.abc !== 'all' || nicheFilter.min_revenue !== 'all'
  const filteredRows = allRows.filter(row => {
    if (search && !row.niche.toLowerCase().includes(search.toLowerCase()) && !row.category.toLowerCase().includes(search.toLowerCase())) return false
    if (nicheFilter.seasonal === 'seasonal' && !row.seasonal) return false
    if (nicheFilter.seasonal === 'no' && row.seasonal) return false
    if (nicheFilter.abc !== 'all' && row.abc_class !== nicheFilter.abc) return false
    if (nicheFilter.min_revenue === '100k' && row.revenue < 100_000) return false
    if (nicheFilter.min_revenue === '500k' && row.revenue < 500_000) return false
    if (nicheFilter.min_revenue === '1m' && row.revenue < 1_000_000) return false
    return true
  }).sort((a, b) => {
    const mult = sortDir === 'asc' ? 1 : -1
    const av = a[sortKey]; const bv = b[sortKey]
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * mult
    return String(av ?? '').localeCompare(String(bv ?? '')) * mult
  })

  const topNiches = filteredRows.slice(0, 12).map(r => ({
    name: r.niche.length > 18 ? r.niche.slice(0, 16) + '…' : r.niche,
    rating: r.rating,
    attractiveness: r.attractiveness,
    abc: r.abc_class,
  }))

  function exportNiches() {
    exportToExcel(filteredRows.map(r => ({
      'Ниша': r.niche, 'Категория': r.category, 'Рейтинг': r.rating,
      'Привлекательность': r.attractiveness, 'Выручка': r.revenue,
      'Сезонный': r.seasonal ? 'Да' : 'Нет', 'ABC': r.abc_class,
    })), 'Ниши')
  }

  return (
    <div className="px-6 py-6 space-y-6 max-w-[1440px] mx-auto">

      {/* KPI */}
      <KPIBar loading={loading} items={[
        { label: 'Ср. привлекательность', value: data?.summary.avg_attractiveness?.toFixed(1) ?? '—' },
        { label: 'Доля рынка', value: data?.summary.avg_market_share != null ? (data.summary.avg_market_share * 100).toFixed(1) + '%' : '—' },
        { label: 'Сезонных ниш', value: String(data?.summary.seasonal_count ?? '—') },
        { label: 'Средний ABC-класс', value: data?.summary.avg_abc ?? '—' },
        { label: 'Ниш всего', value: String(allRows.length), accent: true },
      ]} />

      {/* Рейтинг ниш */}
      {topNiches.length > 0 && (
        <GlassCard padding="lg">
          <p className="text-sm font-semibold mb-4" style={{ color: 'var(--text)' }}>Рейтинг ниш (ТОП-12)</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={topNiches} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.4} horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickLine={false} domain={[0, 'dataMax']} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} width={120} tickLine={false} axisLine={false} />
              <Tooltip formatter={(v) => [v, 'Рейтинг']} />
              <Bar dataKey="rating" radius={[0, 4, 4, 0]} barSize={14}>
                {topNiches.map((entry, i) => (
                  <Cell
                    key={i}
                    fill={entry.abc === 'A' ? 'var(--success)' : entry.abc === 'B' ? 'var(--warning)' : 'var(--accent)'}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </GlassCard>
      )}

      {/* Table */}
      <GlassCard padding="none">
        <div className="px-4 pt-4">
          <FilterBar
            search={search}
            onSearch={setSearch}
            searchPlaceholder="Поиск по нише, категории..."
            filters={[
              { label: 'Сезонность', key: 'seasonal', options: [
                { value: 'all', label: 'Все' },
                { value: 'seasonal', label: 'Сезонные' },
                { value: 'no', label: 'Несезонные' },
              ]},
              { label: 'ABC класс', key: 'abc', options: [
                { value: 'all', label: 'Все' },
                { value: 'A', label: 'A' },
                { value: 'B', label: 'B' },
                { value: 'C', label: 'C' },
              ]},
              { label: 'Мин. выручка', key: 'min_revenue', options: [
                { value: 'all', label: 'Все' },
                { value: '100k', label: '>100К' },
                { value: '500k', label: '>500К' },
                { value: '1m', label: '>1М' },
              ]},
            ]}
            values={nicheFilter}
            onChange={(k, v) => setNicheFilter(f => ({ ...f, [k]: v }))}
            onReset={() => { setNicheFilter({ seasonal: 'all', abc: 'all', min_revenue: 'all' }); setSearch('') }}
            hasActive={hasFilter}
            onExport={exportNiches}
            summary={<span className="text-xs" style={{ color: 'var(--text-muted)' }}>Ниши · {filteredRows.length}</span>}
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm sticky-thead">
            <thead>
              <tr className="text-xs border-b" style={{ borderColor: 'var(--border)' }}>
                <th className="text-left px-4 py-3 font-medium" style={{ color: 'var(--text-subtle)' }}>Ниша / Категория</th>
                <SortTh label="Рейтинг" sk="rating" sortKey={sortKey as string} sortDir={sortDir} onSort={k => toggleSort(k as keyof NicheRow)} />
                <SortTh label="Привл." sk="attractiveness" sortKey={sortKey as string} sortDir={sortDir} onSort={k => toggleSort(k as keyof NicheRow)} />
                <SortTh label="Выручка" sk="revenue" sortKey={sortKey as string} sortDir={sortDir} onSort={k => toggleSort(k as keyof NicheRow)} />
                <th className="text-center px-4 py-3 font-medium" style={{ color: 'var(--text-subtle)' }}>Сезонность</th>
                <SortTh label="Старт" sk="season_start" sortKey={sortKey as string} sortDir={sortDir} onSort={k => toggleSort(k as keyof NicheRow)} />
                <SortTh label="Пик" sk="season_peak" sortKey={sortKey as string} sortDir={sortDir} onSort={k => toggleSort(k as keyof NicheRow)} />
                <SortTh label="Доступность" sk="availability" sortKey={sortKey as string} sortDir={sortDir} onSort={k => toggleSort(k as keyof NicheRow)} />
                <SortTh label="ABC" sk="abc_class" align="center" sortKey={sortKey as string} sortDir={sortDir} onSort={k => toggleSort(k as keyof NicheRow)} />
              </tr>
            </thead>
            <tbody>
              {loading && Array.from({ length: 6 }).map((_, i) => (
                <tr key={i} className="border-t" style={{ borderColor: 'var(--border)' }}>
                  {Array.from({ length: 9 }).map((__, j) => (
                    <td key={j} className="px-4 py-3"><div className="skeleton h-4 w-full" /></td>
                  ))}
                </tr>
              ))}
              {!loading && filteredRows.map((row, i) => (
                <tr key={i} className="border-t transition-colors"
                  style={{ borderColor: 'var(--border)', cursor: 'pointer' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-hover)' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '' }}
                >
                  <td className="px-4 py-2.5">
                    <p className="font-medium" style={{ color: 'var(--text)' }}>{row.niche}</p>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{row.category}</p>
                  </td>
                  <td className="px-4 py-2.5 text-right font-bold" style={{ color: 'var(--accent)' }}>{row.rating}</td>
                  <td className="px-4 py-2.5 text-right" style={{ color: 'var(--text-muted)' }}>{row.attractiveness?.toFixed(1)}</td>
                  <td className="px-4 py-2.5 text-right font-semibold" style={{ color: 'var(--text)' }}>{fmt(row.revenue)}</td>
                  <td className="px-4 py-2.5 text-center">
                    {row.season_months?.length > 0
                      ? <SeasonalitySparkline values={row.season_months} />
                      : <span style={{ color: 'var(--text-subtle)', fontSize: 11 }}>Не сезонный</span>
                    }
                  </td>
                  <td className="px-4 py-2.5 text-right text-xs" style={{ color: 'var(--text-muted)' }}>
                    {row.season_start ? MONTHS[row.season_start - 1] : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right text-xs" style={{ color: 'var(--accent)', fontWeight: 600 }}>
                    {row.season_peak ? MONTHS[row.season_peak - 1] : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right" style={{ color: 'var(--text-muted)' }}>{row.availability?.toFixed(1)}</td>
                  <td className="px-4 py-2.5 text-right">
                    <span className="font-bold text-xs" style={{ color: row.abc_class === 'A' ? 'var(--success)' : row.abc_class === 'B' ? 'var(--warning)' : 'var(--danger)' }}>
                      {row.abc_class ?? '—'}
                    </span>
                  </td>
                </tr>
              ))}
              {!loading && filteredRows.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Нет данных по нишам</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </GlassCard>
    </div>
  )
}
