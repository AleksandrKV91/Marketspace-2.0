'use client'
import { useTheme } from './ThemeProvider'
import { Sun, Moon, Sparkles } from 'lucide-react'

export function ThemeToggle() {
  const { mode, setMode } = useTheme()
  const options = [
    { v: 'light' as const, icon: Sun, label: 'Светлая' },
    { v: 'dark' as const, icon: Moon, label: 'Тёмная' },
    { v: 'auto' as const, icon: Sparkles, label: 'Авто' },
  ]
  return (
    <div className="flex items-center gap-1 p-1 rounded-xl" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
      {options.map(({ v, icon: Icon, label }) => (
        <button
          key={v}
          onClick={() => setMode(v)}
          title={label}
          className="flex items-center justify-center w-8 h-8 rounded-lg transition-all"
          style={{
            background: mode === v ? 'var(--accent)' : 'transparent',
            color: mode === v ? 'white' : 'var(--text-muted)',
          }}
        >
          <Icon size={14} />
        </button>
      ))}
    </div>
  )
}
