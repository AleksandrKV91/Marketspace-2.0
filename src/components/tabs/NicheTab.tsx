'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { GlassCard } from '@/components/ui/GlassCard'
import { StatCard } from '@/components/ui/StatCard'
import { SeasonalitySparkline } from '@/components/ui/SeasonalitySparkline'
import { Globe, Star, TrendingUp, BarChart2 } from 'lucide-react'

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

const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.06 } } }
const fadeUp = { hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0, transition: { duration: 0.3 } } }

export default function NicheTab() {
  const [data, setData] = useState<NicheData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [filterSeasonal, setFilterSeasonal] = useState<'all' | 'seasonal' | 'no'>('all')

  useEffect(() => {
    const p = new URLSearchParams()
    if (search) p.set('search', search)
    if (filterSeasonal !== 'all') p.set('seasonal', filterSeasonal)
    fetch('/api/dashboard/niches?' + p.toString())
      .then(r => r.json())
      .then((d: NicheData) => { setData(d); setLoading(false) })
      .catch((e: unknown) => { setError(String(e)); setLoading(false) })
  }, [search, filterSeasonal])

  if (error) return <div className="px-6 py-16 text-center" style={{ color: 'var(--danger)' }}>{error}</div>

  return (
    <div className="px-6 py-6 space-y-6 max-w-[1440px] mx-auto">

      {/* KPI */}
      <motion.div variants={stagger} initial="hidden" animate="show"
        className="grid grid-cols-2 md:grid-cols-4 gap-3"
      >
        {loading ? Array.from({ length: 4 }).map((_, i) => (
          <GlassCard key={i}><div className="space-y-3"><div className="skeleton h-9 w-9 rounded-full" /><div className="skeleton h-4 w-20" /><div className="skeleton h-7 w-28" /></div></GlassCard>
        )) : [
          { label: 'Ср. привлекательность', value: data?.summary.avg_attractiveness?.toFixed(1) ?? '—', icon: <Star size={16} /> },
          { label: 'Доля рынка',            value: data?.summary.avg_market_share != null ? (data.summary.avg_market_share * 100).toFixed(1) + '%' : '—', icon: <TrendingUp size={16} />, iconColor: 'var(--info)' },
          { label: 'Сезонных ниш',          value: String(data?.summary.seasonal_count ?? '—'), icon: <Globe size={16} />, iconColor: 'var(--warning)' },
          { label: 'Средний ABC-класс',     value: data?.summary.avg_abc ?? '—', icon: <BarChart2 size={16} />, iconColor: 'var(--success)' },
        ].map((card, i) => (
          <motion.div key={i} variants={fadeUp}><StatCard {...card} /></motion.div>
        ))}
      </motion.div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Поиск по нише, категории..."
          className="text-sm px-3 py-2 rounded-xl border outline-none min-w-[240px]"
          style={{ background: 'var(--surface-solid)', border: '1px solid var(--border)', color: 'var(--text)' }}
        />
        {(['all','seasonal','no'] as const).map(v => (
          <button key={v} onClick={() => setFilterSeasonal(v)}
            className="text-xs px-3 py-1.5 rounded-xl font-medium"
            style={{ background: filterSeasonal === v ? 'var(--accent)' : 'var(--border)', color: filterSeasonal === v ? 'white' : 'var(--text-muted)' }}>
            {v === 'all' ? 'Все' : v === 'seasonal' ? 'Сезонные' : 'Несезонные'}
          </button>
        ))}
      </div>

      {/* Table */}
      <GlassCard padding="none">
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
              {!loading && (data?.rows ?? []).map((row, i) => (
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
              {!loading && (data?.rows ?? []).length === 0 && (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Нет данных по нишам</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </GlassCard>
    </div>
  )
}
