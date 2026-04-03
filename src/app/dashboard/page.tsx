'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  LayoutDashboard, Table2, TrendingUp, BarChart2,
  Globe, ShoppingCart, Upload, Moon, Sun, Monitor
} from 'lucide-react'
import SvodTab      from '@/components/tabs/OverviewTab'
import SkuTab       from '@/components/tabs/SkuTableTab'
import PriceTab     from '@/components/tabs/PriceTab'
import AnalyticsTab from '@/components/tabs/AnalyticsTab'
import NicheTab     from '@/components/tabs/NicheTab'
import OrderTab     from '@/components/tabs/OrderTab'
import UpdateTab    from '@/components/tabs/UpdateTab'

type Tab = 'svod' | 'sku' | 'price' | 'analytics' | 'niche' | 'orders' | 'update'

type TabDef = { id: Tab; label: string; icon: React.ComponentType<{ size?: number }> }

const TABS: TabDef[] = [
  { id: 'svod',      label: 'Свод',                  icon: LayoutDashboard },
  { id: 'analytics', label: 'Продажи и экономика',   icon: BarChart2 },
  { id: 'price',     label: 'Реклама и воронка',     icon: TrendingUp },
  { id: 'orders',    label: 'Логистика и заказы',    icon: ShoppingCart },
  { id: 'sku',       label: 'Аналитика по SKU',      icon: Table2 },
  { id: 'niche',     label: 'Анализ ниш и ABC',      icon: Globe },
  { id: 'update',    label: 'Обновление данных',     icon: Upload },
]

const NAV_TABS = TABS.filter(t => t.id !== 'update')


function ThemeButton() {
  const [theme, setTheme] = useState<'light' | 'dark' | 'auto'>(() => {
    if (typeof window === 'undefined') return 'light'
    return (localStorage.getItem('theme') as 'light' | 'dark' | 'auto') ?? 'light'
  })

  const cycle = () => {
    const next: Record<string, 'light' | 'dark' | 'auto'> = { light: 'dark', dark: 'auto', auto: 'light' }
    const newTheme = next[theme]
    setTheme(newTheme)
    localStorage.setItem('theme', newTheme)
    if (newTheme === 'dark') {
      document.documentElement.dataset.theme = 'dark'
    } else if (newTheme === 'light') {
      document.documentElement.dataset.theme = 'light'
    } else {
      const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      document.documentElement.dataset.theme = isDark ? 'dark' : 'light'
    }
  }

  const Icon = theme === 'dark' ? Moon : theme === 'auto' ? Monitor : Sun
  return (
    <button
      onClick={cycle}
      className="w-8 h-8 rounded-xl flex items-center justify-center transition-all"
      style={{ color: 'var(--text-muted)', background: 'var(--border)' }}
      title={`Тема: ${theme}`}
    >
      <Icon size={15} />
    </button>
  )
}

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState<Tab>('svod')
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)' }}>

      {/* ── Sticky Top Navigation ── */}
      <header className="top-nav sticky top-0 z-50 h-[72px] flex items-center px-4 lg:px-6 gap-4">

        {/* Logo */}
        <div className="flex items-center gap-2.5 shrink-0">
          <div
            className="w-8 h-8 rounded-xl flex items-center justify-center text-white text-sm font-black shrink-0"
            style={{ background: 'var(--accent)' }}
          >
            M
          </div>
          <span className="font-bold text-sm hidden sm:block" style={{ color: 'var(--text)' }}>
            Marketspace 2.0
          </span>
        </div>

        {/* Desktop nav */}
        <nav className="hidden lg:flex items-center gap-0.5 flex-1 overflow-x-auto">
          {NAV_TABS.map(tab => {
            const Icon = tab.icon
            const active = activeTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className="relative flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-colors whitespace-nowrap"
                style={{ color: active ? 'var(--accent)' : 'var(--text-muted)' }}
                onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.color = 'var(--text)' }}
                onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)' }}
              >
                {active && (
                  <motion.span
                    layoutId="nav-pill"
                    className="absolute inset-0 rounded-xl -z-10"
                    style={{ background: 'var(--accent-glow)' }}
                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                  />
                )}
                <Icon size={15} />
                <span>{tab.label}</span>
              </button>
            )
          })}
        </nav>

        {/* Right actions */}
        <div className="ml-auto flex items-center gap-2 shrink-0">
          <button
            onClick={() => setActiveTab('update')}
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all"
            style={{
              background: activeTab === 'update' ? 'var(--accent)' : 'var(--border)',
              color: activeTab === 'update' ? 'white' : 'var(--text-muted)',
            }}
          >
            <Upload size={13} />
            <span>Загрузить</span>
          </button>

          <ThemeButton />

          {/* Mobile hamburger */}
          <button
            className="lg:hidden w-8 h-8 rounded-xl flex flex-col items-center justify-center gap-1"
            style={{ background: 'var(--border)', color: 'var(--text-muted)' }}
            onClick={() => setMobileMenuOpen(v => !v)}
            aria-label="Меню"
          >
            <span className="block w-4 h-0.5 rounded" style={{ background: 'currentColor' }} />
            <span className="block w-4 h-0.5 rounded" style={{ background: 'currentColor' }} />
            <span className="block w-3 h-0.5 rounded" style={{ background: 'currentColor' }} />
          </button>
        </div>
      </header>

      {/* Mobile dropdown */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="lg:hidden fixed inset-0 z-40 bg-black/20"
              onClick={() => setMobileMenuOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.15 }}
              className="lg:hidden fixed top-[72px] left-0 right-0 z-40 p-3 space-y-1"
              style={{
                background: 'var(--bg-secondary)',
                borderBottom: '1px solid var(--border)',
                boxShadow: 'var(--shadow-md)',
              }}
            >
              {TABS.map(tab => {
                const Icon = tab.icon
                const active = activeTab === tab.id
                return (
                  <button
                    key={tab.id}
                    onClick={() => { setActiveTab(tab.id); setMobileMenuOpen(false) }}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-left"
                    style={{
                      background: active ? 'var(--accent-glow)' : 'transparent',
                      color: active ? 'var(--accent)' : 'var(--text-muted)',
                    }}
                  >
                    <Icon size={17} />
                    {tab.label}
                  </button>
                )
              })}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Main content */}
      <main className="max-w-[1440px] mx-auto">
        <div>
          {activeTab === 'svod'      && <SvodTab />}
          {activeTab === 'sku'       && <SkuTab />}
          {activeTab === 'price'     && <PriceTab />}
          {activeTab === 'analytics' && <AnalyticsTab />}
          {activeTab === 'niche'     && <NicheTab />}
          {activeTab === 'orders'    && <OrderTab />}
          {activeTab === 'update'    && <UpdateTab />}
        </div>
      </main>
    </div>
  )
}
