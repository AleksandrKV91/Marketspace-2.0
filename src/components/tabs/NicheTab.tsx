'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { GlassCard } from '@/components/ui/GlassCard'
import { KPIBar } from '@/components/ui/KPIBar'
import { FilterBar } from '@/components/ui/FilterBar'
import { SeasonalitySparkline } from '@/components/ui/SeasonalitySparkline'
import { exportToExcel } from '@/lib/exportExcel'

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

export default function NicheTab() {
  const [data, setData] = useState<NicheData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [nicheFilter, setNicheFilter] = useState<Record<string, string>>({ seasonal: 'all', abc: 'all' })

  useEffect(() => {
    fetch('/api/dashboard/niches')
      .then(r => r.json())
      .then((d: NicheData) => { setData(d); setLoading(false) })
      .catch((e: unknown) => { setError(String(e)); setLoading(false) })
  }, [])

  if (error) return <div className="px-6 py-16 text-center" style={{ color: 'var(--danger)' }}>{error}</div>

  const allRows = data?.rows ?? []
  const hasFilter = search.trim() !== '' || nicheFilter.seasonal !== 'all' || nicheFilter.abc !== 'all'
  const filteredRows = allRows.filter(row => {
    if (search && !row.niche.toLowerCase().includes(search.toLowerCase()) && !row.category.toLowerCase().includes(search.toLowerCase())) return false
    if (nicheFilter.seasonal === 'seasonal' && !row.seasonal) return false
    if (nicheFilter.seasonal === 'no' && row.seasonal) return false
    if (nicheFilter.abc !== 'all' && row.abc_class !== nicheFilter.abc) return false
    return true
  })

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
      ]} />

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
            ]}
            values={nicheFilter}
            onChange={(k, v) => setNicheFilter(f => ({ ...f, [k]: v }))}
            onReset={() => { setNicheFilter({ seasonal: 'all', abc: 'all' }); setSearch('') }}
            hasActive={hasFilter}
            onExport={exportNiches}
            summary={<span className="text-xs" style={{ color: 'var(--text-muted)' }}>Ниши · {filteredRows.length}</span>}
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs border-b" style={{ borderColor: 'var(--border)', color: 'var(--text-subtle)' }}>
                <th className="text-left px-4 py-3 font-medium">Ниша / Категория</th>
                <th className="text-right px-4 py-3 font-medium">Рейтинг</th>
                <th className="text-right px-4 py-3 font-medium">Привл.</th>
                <th className="text-right px-4 py-3 font-medium">Выручка</th>
                <th className="text-center px-4 py-3 font-medium">Сезонность</th>
                <th className="text-right px-4 py-3 font-medium">Старт</th>
                <th className="text-right px-4 py-3 font-medium">Пик</th>
                <th className="text-right px-4 py-3 font-medium">Доступность</th>
                <th className="text-right px-4 py-3 font-medium">ABC</th>
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
