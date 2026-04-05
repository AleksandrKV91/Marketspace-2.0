'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  LayoutDashboard, Table2, TrendingUp, BarChart2,
  Globe, ShoppingCart, Upload, Moon, Sun, Monitor
} from 'lucide-react'
import { DateRangeProvider, DateRangePicker } from '@/components/ui/DateRangePicker'
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
    <motion.button
      whileHover={{ y: -2, scale: 1.05 }}
      whileTap={{ scale: 0.94 }}
      transition={{ type: 'spring', stiffness: 400, damping: 28 }}
      onClick={cycle}
      className="btn-glass w-8 h-8 rounded-[27%] flex items-center justify-center"
      style={{ color: 'var(--text-muted)' }}
      title={`Тема: ${theme}`}
    >
      <Icon size={14} />
    </motion.button>
  )
}

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState<Tab>('svod')
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  return (
    <DateRangeProvider>
    <div className="min-h-screen relative" style={{ background: 'var(--bg)' }}>

      {/* ── Liquid Glass sticky header ── */}
      <header
        className="top-nav sticky top-0 z-50 h-[68px] flex items-center px-4 lg:px-6 gap-4"
      >
        {/* Logo — squircle */}
        <motion.div
          className="flex items-center gap-2.5 shrink-0"
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 28, delay: 0.05 }}
        >
          <div
            className="icon-squircle w-8 h-8 text-white text-sm font-black shrink-0"
            style={{
              background: 'linear-gradient(135deg, #FF6B81 0%, #FF3B5C 55%, #C0142E 100%)',
            }}
          >
            <span className="relative z-10 text-xs font-black">M</span>
          </div>
          <span className="font-bold text-sm hidden sm:block" style={{ color: 'var(--text)' }}>
            Marketspace 2.0
          </span>
        </motion.div>

        {/* Desktop nav */}
        <nav className="hidden lg:flex items-center gap-0.5 flex-1 overflow-x-auto">
          {NAV_TABS.map((tab, i) => {
            const Icon = tab.icon
            const active = activeTab === tab.id
            return (
              <motion.button
                key={tab.id}
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: 'spring', stiffness: 400, damping: 28, delay: 0.06 + i * 0.04 }}
                whileHover={active ? {} : { y: -1 }}
                whileTap={{ scale: 0.96 }}
                onClick={() => setActiveTab(tab.id)}
                className="relative flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition-colors whitespace-nowrap"
                style={{ color: active ? 'var(--accent)' : 'var(--text-muted)' }}
              >
                {active && (
                  <motion.span
                    layoutId="nav-pill"
                    className="nav-pill absolute inset-0 -z-10"
                    transition={{ type: 'spring', stiffness: 400, damping: 28 }}
                  />
                )}
                <Icon size={14} />
                <span>{tab.label}</span>
              </motion.button>
            )
          })}
        </nav>

        {/* Right actions */}
        <div className="ml-auto flex items-center gap-2 shrink-0">
          {/* Upload button */}
          <motion.button
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 400, damping: 28 }}
            onClick={() => setActiveTab('update')}
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all"
            style={{
              background: activeTab === 'update'
                ? 'linear-gradient(135deg, #FF6B81 0%, #FF3B5C 100%)'
                : 'var(--surface)',
              color: activeTab === 'update' ? 'white' : 'var(--text-muted)',
              border: '1px solid var(--border)',
              boxShadow: activeTab === 'update'
                ? '0 4px 12px rgba(255,59,92,0.3), inset 0 1px 0 rgba(255,255,255,0.3)'
                : 'var(--shadow-sm)',
              backdropFilter: 'blur(14px)',
            }}
          >
            <Upload size={12} />
            <span>Загрузить</span>
          </motion.button>

          <DateRangePicker />

          <ThemeButton />

          {/* Mobile hamburger */}
          <motion.button
            whileTap={{ scale: 0.92 }}
            className="lg:hidden btn-glass w-8 h-8 rounded-xl flex flex-col items-center justify-center gap-1"
            style={{ color: 'var(--text-muted)' }}
            onClick={() => setMobileMenuOpen(v => !v)}
            aria-label="Меню"
          >
            <span className="block w-4 h-0.5 rounded" style={{ background: 'currentColor' }} />
            <span className="block w-4 h-0.5 rounded" style={{ background: 'currentColor' }} />
            <span className="block w-3 h-0.5 rounded" style={{ background: 'currentColor' }} />
          </motion.button>
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
              style={{ backdropFilter: 'blur(4px)' }}
              onClick={() => setMobileMenuOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, y: -12, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 400, damping: 28 }}
              className="lg:hidden fixed top-[68px] left-3 right-3 z-40 p-2 space-y-1 glass"
              style={{ borderRadius: 'var(--radius-xl)' }}
            >
              {TABS.map(tab => {
                const Icon = tab.icon
                const active = activeTab === tab.id
                return (
                  <motion.button
                    key={tab.id}
                    whileTap={{ scale: 0.97 }}
                    onClick={() => { setActiveTab(tab.id); setMobileMenuOpen(false) }}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-left transition-colors"
                    style={{
                      background: active ? 'var(--accent-glass)' : 'transparent',
                      color: active ? 'var(--accent)' : 'var(--text-muted)',
                    }}
                  >
                    <Icon size={16} />
                    {tab.label}
                  </motion.button>
                )
              })}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Main content */}
      <main className="max-w-[1440px] mx-auto relative z-10">
        {activeTab === 'svod'      && <SvodTab />}
        {activeTab === 'sku'       && <SkuTab />}
        {activeTab === 'price'     && <PriceTab />}
        {activeTab === 'analytics' && <AnalyticsTab />}
        {activeTab === 'niche'     && <NicheTab />}
        {activeTab === 'orders'    && <OrderTab />}
        {activeTab === 'update'    && <UpdateTab />}
      </main>
    </div>
    </DateRangeProvider>
  )
}
