'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Filter, X, Search, Download } from 'lucide-react'

export interface FilterGroup {
  label: string
  key: string
  options: { value: string; label: string }[]
  color?: string /* var(--danger), var(--warning) etc */
}

interface FilterBarProps {
  search?: string
  onSearch?: (v: string) => void
  searchPlaceholder?: string
  filters: FilterGroup[]
  values: Record<string, string>
  onChange: (key: string, value: string) => void
  onReset: () => void
  hasActive: boolean
  onExport?: () => void
  extraLeft?: React.ReactNode
  summary?: React.ReactNode
}

export function FilterBar({
  search, onSearch, searchPlaceholder = 'Поиск...',
  filters, values, onChange, onReset, hasActive,
  onExport, extraLeft, summary,
}: FilterBarProps) {
  const [open, setOpen] = useState(false)

  return (
    <div className="space-y-2">
      {/* Top row */}
      <div className="flex flex-wrap gap-2 items-center">
        {/* Search */}
        {onSearch !== undefined && (
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
            <input
              value={search ?? ''}
              onChange={e => onSearch(e.target.value)}
              placeholder={searchPlaceholder}
              className="w-full pl-8 pr-3 py-2 text-sm rounded-xl outline-none"
              style={{ background: 'var(--surface-solid)', border: '1px solid var(--border)', color: 'var(--text)' }}
            />
          </div>
        )}

        {extraLeft}

        <div className="ml-auto flex items-center gap-2">
          {summary}

          {hasActive && (
            <button
              onClick={onReset}
              className="flex items-center gap-1 text-xs px-2 py-1.5 rounded-lg"
              style={{ color: 'var(--accent)', background: 'var(--accent-glow)' }}
            >
              <X size={11} /> Сбросить
            </button>
          )}

          {/* Filters toggle */}
          <button
            onClick={() => setOpen(v => !v)}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl font-medium transition-all"
            style={{
              background: open || hasActive ? 'var(--accent-glow)' : 'var(--surface-solid)',
              color: open || hasActive ? 'var(--accent)' : 'var(--text-muted)',
              border: '1px solid var(--border)',
            }}
          >
            <Filter size={12} />
            Фильтры
            {hasActive && (
              <span
                className="ml-0.5 w-1.5 h-1.5 rounded-full"
                style={{ background: 'var(--accent)', display: 'inline-block' }}
              />
            )}
          </button>

          {/* Export */}
          {onExport && (
            <button
              onClick={onExport}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl font-medium"
              style={{ background: 'var(--surface-solid)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
            >
              <Download size={12} /> Excel
            </button>
          )}
        </div>
      </div>

      {/* Filter panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="glass px-4 py-3 flex flex-wrap gap-5"
          >
            {filters.map(group => (
              <div key={group.key} className="space-y-1.5">
                <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: 'var(--text-subtle)' }}>
                  {group.label}
                </p>
                <div className="flex gap-1 flex-wrap">
                  {group.options.map(opt => {
                    const active = values[group.key] === opt.value
                    return (
                      <button
                        key={opt.value}
                        onClick={() => onChange(group.key, opt.value)}
                        className="text-xs px-2.5 py-1 rounded-lg font-medium transition-all"
                        style={{
                          background: active
                            ? (group.color ? group.color.replace(')', ', 0.15)').replace('var(', 'color-mix(in srgb, ') : 'var(--accent-glow)')
                            : 'var(--surface-solid)',
                          color: active ? (group.color ?? 'var(--accent)') : 'var(--text-muted)',
                          border: '1px solid ' + (active ? (group.color ?? 'var(--accent)') : 'var(--border)'),
                        }}
                      >
                        {opt.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
