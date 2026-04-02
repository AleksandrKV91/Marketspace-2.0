'use client'
import { createContext, useContext, useEffect, useState, ReactNode } from 'react'

type ThemeMode = 'light' | 'dark' | 'auto'

interface ThemeCtx {
  mode: ThemeMode
  setMode: (m: ThemeMode) => void
}

const Ctx = createContext<ThemeCtx>({ mode: 'auto', setMode: () => {} })

function getAutoTheme(): 'light' | 'dark' {
  const h = new Date().getHours()
  return h >= 18 || h < 8 ? 'dark' : 'light'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>('auto')
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const saved = (localStorage.getItem('ms-theme') as ThemeMode) ?? 'auto'
    setModeState(saved)
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!mounted) return
    const apply = () => {
      const resolved = mode === 'auto' ? getAutoTheme() : mode
      document.documentElement.setAttribute('data-theme', resolved)
    }
    apply()
    if (mode === 'auto') {
      const interval = setInterval(apply, 60000)
      return () => clearInterval(interval)
    }
  }, [mode, mounted])

  const setMode = (m: ThemeMode) => {
    setModeState(m)
    localStorage.setItem('ms-theme', m)
  }

  if (!mounted) return <>{children}</>
  return <Ctx.Provider value={{ mode, setMode }}>{children}</Ctx.Provider>
}

export const useTheme = () => useContext(Ctx)
