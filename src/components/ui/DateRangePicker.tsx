'use client'

import { createContext, useContext, useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react'

// ── Types ────────────────────────────────────────────────────────────────────

export interface DateRange {
  from: string  // ISO YYYY-MM-DD
  to: string    // ISO YYYY-MM-DD
}

interface DateRangeCtx {
  range: DateRange
  setRange: (r: DateRange) => void
}

// ── Context ──────────────────────────────────────────────────────────────────

function defaultRange(): DateRange {
  const to = new Date()
  const from = new Date()
  from.setDate(from.getDate() - 6)
  return { from: toISO(from), to: toISO(to) }
}

function toISO(d: Date) {
  return d.toISOString().split('T')[0]
}

function parseISO(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function fmt(iso: string): string {
  const d = parseISO(iso)
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`
}

const DateRangeContext = createContext<DateRangeCtx>({
  range: defaultRange(),
  setRange: () => {},
})

export function DateRangeProvider({ children }: { children: React.ReactNode }) {
  const [range, setRangeState] = useState<DateRange>(() => {
    if (typeof window === 'undefined') return defaultRange()
    try {
      const saved = localStorage.getItem('dashDateRange')
      if (saved) return JSON.parse(saved) as DateRange
    } catch {}
    return defaultRange()
  })

  const setRange = useCallback((r: DateRange) => {
    setRangeState(r)
    try { localStorage.setItem('dashDateRange', JSON.stringify(r)) } catch {}
  }, [])

  return (
    <DateRangeContext.Provider value={{ range, setRange }}>
      {children}
    </DateRangeContext.Provider>
  )
}

export function useDateRange() {
  return useContext(DateRangeContext)
}

// ── Quick presets ─────────────────────────────────────────────────────────────

const PRESETS = [
  {
    label: '7 дней',
    get(): DateRange {
      const to = new Date()
      const from = new Date(); from.setDate(from.getDate() - 6)
      return { from: toISO(from), to: toISO(to) }
    },
  },
  {
    label: '30 дней',
    get(): DateRange {
      const to = new Date()
      const from = new Date(); from.setDate(from.getDate() - 29)
      return { from: toISO(from), to: toISO(to) }
    },
  },
  {
    label: 'Этот месяц',
    get(): DateRange {
      const now = new Date()
      const from = new Date(now.getFullYear(), now.getMonth(), 1)
      const to = new Date(now.getFullYear(), now.getMonth() + 1, 0)
      return { from: toISO(from), to: toISO(to) }
    },
  },
  {
    label: 'Прошлый месяц',
    get(): DateRange {
      const now = new Date()
      const from = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const to = new Date(now.getFullYear(), now.getMonth(), 0)
      return { from: toISO(from), to: toISO(to) }
    },
  },
]

const MONTHS_RU = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь']
const DAYS_RU = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс']

// ── Calendar grid ─────────────────────────────────────────────────────────────

function calendarDays(year: number, month: number): (Date | null)[] {
  const first = new Date(year, month, 1)
  const last = new Date(year, month + 1, 0)
  // week starts Monday: 0=Mon..6=Sun
  const startDow = (first.getDay() + 6) % 7
  const days: (Date | null)[] = Array(startDow).fill(null)
  for (let d = 1; d <= last.getDate(); d++) days.push(new Date(year, month, d))
  while (days.length % 7 !== 0) days.push(null)
  return days
}

// ── Picker UI ─────────────────────────────────────────────────────────────────

export function DateRangePicker() {
  const { range, setRange } = useDateRange()
  const [open, setOpen] = useState(false)
  const [selecting, setSelecting] = useState<string | null>(null) // first click ISO
  const [hovered, setHovered] = useState<string | null>(null)
  const [viewYear, setViewYear] = useState(() => parseISO(range.to).getFullYear())
  const [viewMonth, setViewMonth] = useState(() => parseISO(range.to).getMonth())
  const ref = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1) }
    else setViewMonth(m => m - 1)
  }
  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1) }
    else setViewMonth(m => m + 1)
  }

  const handleDayClick = (iso: string) => {
    if (!selecting) {
      setSelecting(iso)
    } else {
      const [a, b] = [selecting, iso].sort()
      setRange({ from: a, to: b })
      setSelecting(null)
      setOpen(false)
    }
  }

  const applyPreset = (p: typeof PRESETS[0]) => {
    setRange(p.get())
    setSelecting(null)
    setOpen(false)
  }

  const days = calendarDays(viewYear, viewMonth)
  const fromISO = selecting ?? range.from
  const toISO2 = selecting ? (hovered ?? selecting) : range.to
  const [rangeA, rangeB] = [fromISO, toISO2].sort()

  const isSameDay = range.from === range.to

  return (
    <div ref={ref} className="relative">
      {/* Trigger button */}
      <motion.button
        whileHover={{ y: -1, scale: 1.02 }}
        whileTap={{ scale: 0.96 }}
        transition={{ type: 'spring', stiffness: 400, damping: 28 }}
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-medium transition-all"
        style={{
          background: open ? 'var(--accent-glass)' : 'var(--surface)',
          border: '1px solid ' + (open ? 'var(--accent)' : 'var(--border)'),
          color: open ? 'var(--accent)' : 'var(--text-muted)',
          boxShadow: 'var(--shadow-sm)',
          backdropFilter: 'blur(14px)',
        }}
      >
        <CalendarDays size={13} />
        <span>
          {isSameDay ? fmt(range.from) : `${fmt(range.from)} — ${fmt(range.to)}`}
        </span>
      </motion.button>

      {/* Dropdown */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="absolute left-0 z-[200] glass p-4"
            style={{
              top: 'calc(100% + 8px)',
              borderRadius: 'var(--radius-xl)',
              width: 296,
              boxShadow: '0 8px 32px rgba(0,0,0,0.22)',
            }}
          >
            {/* Quick presets */}
            <div className="flex gap-1.5 flex-wrap mb-3">
              {PRESETS.map(p => (
                <button
                  key={p.label}
                  onClick={() => applyPreset(p)}
                  className="px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all"
                  style={{
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    color: 'var(--text-muted)',
                  }}
                  onMouseEnter={e => {
                    const el = e.currentTarget
                    el.style.background = 'var(--accent-glass)'
                    el.style.color = 'var(--accent)'
                    el.style.borderColor = 'var(--accent)'
                  }}
                  onMouseLeave={e => {
                    const el = e.currentTarget
                    el.style.background = 'var(--surface)'
                    el.style.color = 'var(--text-muted)'
                    el.style.borderColor = 'var(--border)'
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* Month nav */}
            <div className="flex items-center justify-between mb-3">
              <button onClick={prevMonth} className="p-1 rounded-lg hover:bg-black/10 transition-colors" style={{ color: 'var(--text-muted)' }}>
                <ChevronLeft size={15} />
              </button>
              <span className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
                {MONTHS_RU[viewMonth]} {viewYear}
              </span>
              <button onClick={nextMonth} className="p-1 rounded-lg hover:bg-black/10 transition-colors" style={{ color: 'var(--text-muted)' }}>
                <ChevronRight size={15} />
              </button>
            </div>

            {/* Day headers */}
            <div className="grid grid-cols-7 mb-1">
              {DAYS_RU.map(d => (
                <div key={d} className="text-center text-[10px] font-medium py-0.5" style={{ color: 'var(--text-muted)' }}>
                  {d}
                </div>
              ))}
            </div>

            {/* Days grid */}
            <div className="grid grid-cols-7 gap-y-0.5">
              {days.map((day, i) => {
                if (!day) return <div key={i} />
                const iso = toISO(day)
                const isFrom = iso === rangeA
                const isTo = iso === rangeB
                const inRange = iso > rangeA && iso < rangeB
                const isToday = iso === toISO(new Date())

                return (
                  <button
                    key={iso}
                    onClick={() => handleDayClick(iso)}
                    onMouseEnter={() => selecting && setHovered(iso)}
                    onMouseLeave={() => setHovered(null)}
                    className="relative h-8 text-xs font-medium transition-all rounded-lg"
                    style={{
                      color: isFrom || isTo
                        ? 'white'
                        : inRange
                          ? 'var(--accent)'
                          : 'var(--text)',
                      background: isFrom || isTo
                        ? 'var(--accent)'
                        : inRange
                          ? 'var(--accent-glass)'
                          : 'transparent',
                      fontWeight: isToday ? 700 : undefined,
                      borderRadius: isFrom ? '8px 0 0 8px' : isTo ? '0 8px 8px 0' : inRange ? 0 : 8,
                    }}
                  >
                    {day.getDate()}
                    {isToday && !isFrom && !isTo && (
                      <span
                        className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full"
                        style={{ background: 'var(--accent)' }}
                      />
                    )}
                  </button>
                )
              })}
            </div>

            {/* Status hint */}
            {selecting && (
              <p className="mt-2 text-center text-[11px]" style={{ color: 'var(--text-muted)' }}>
                Выберите конечную дату
              </p>
            )}

            {/* Clear / close */}
            <div className="mt-3 flex justify-between items-center">
              <button
                onClick={() => { setRange(defaultRange()); setSelecting(null); setOpen(false) }}
                className="text-[11px] flex items-center gap-1 transition-colors"
                style={{ color: 'var(--text-muted)' }}
              >
                <X size={11} /> Сбросить
              </button>
              <button
                onClick={() => setOpen(false)}
                className="text-[11px] px-3 py-1 rounded-lg font-medium"
                style={{ background: 'var(--accent)', color: 'white' }}
              >
                Применить
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
