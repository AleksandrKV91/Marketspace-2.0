'use client'

import { useState, lazy, Suspense } from 'react'
import { LayoutDashboard, Table2, TrendingUp, BarChart2, Globe, ShoppingCart, Upload, Menu, X } from 'lucide-react'
import { ThemeToggle } from '@/components/ui/ThemeToggle'

const OverviewTab   = lazy(() => import('@/components/tabs/OverviewTab'))
const SkuTableTab   = lazy(() => import('@/components/tabs/SkuTableTab'))
const PriceTab      = lazy(() => import('@/components/tabs/PriceTab'))
const AnalyticsTab  = lazy(() => import('@/components/tabs/AnalyticsTab'))
const NicheTab      = lazy(() => import('@/components/tabs/NicheTab'))
const OrderTab      = lazy(() => import('@/components/tabs/OrderTab'))
const UpdateTab     = lazy(() => import('@/components/tabs/UpdateTab'))

type Tab = 'overview' | 'sku' | 'price' | 'analytics' | 'niche' | 'orders' | 'update'

const TABS = [
  { id: 'overview'   as Tab, label: 'Обзор',        icon: LayoutDashboard },
  { id: 'sku'        as Tab, label: 'Таблица SKU',  icon: Table2 },
  { id: 'price'      as Tab, label: 'Цены',         icon: TrendingUp },
  { id: 'analytics'  as Tab, label: 'Аналитика',    icon: BarChart2 },
  { id: 'niche'      as Tab, label: 'Ниши',         icon: Globe },
  { id: 'orders'     as Tab, label: 'Заказы',       icon: ShoppingCart },
  { id: 'update'     as Tab, label: 'Обновление',   icon: Upload },
]

function TabLoader() {
  return (
    <div className="flex items-center justify-center py-32" style={{ color: 'var(--text-muted)' }}>
      <div className="animate-spin w-6 h-6 border-2 rounded-full mr-3" style={{ borderColor: 'var(--border)', borderTopColor: 'var(--accent)' }} />
      Загрузка...
    </div>
  )
}

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState<Tab>('overview')
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const NavItems = () => (
    <>
      {TABS.map(tab => {
        const Icon = tab.icon
        const active = activeTab === tab.id
        return (
          <button
            key={tab.id}
            onClick={() => { setActiveTab(tab.id); setSidebarOpen(false) }}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all text-left"
            style={{
              background: active ? 'var(--accent)' : 'transparent',
              color: active ? 'white' : 'var(--text-muted)',
            }}
            onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'var(--surface-hover)' }}
            onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
          >
            <Icon size={17} />
            <span>{tab.label}</span>
          </button>
        )
      })}
    </>
  )

  return (
    <div className="flex min-h-screen" style={{ background: 'var(--bg)' }}>
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex flex-col w-56 shrink-0 h-screen sticky top-0 border-r" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>
        <div className="p-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-xs font-bold" style={{ background: 'var(--accent)' }}>M</div>
            <span className="font-bold text-sm" style={{ color: 'var(--text)' }}>Marketspace 2.0</span>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          <NavItems />
        </nav>
        <div className="p-3 border-t" style={{ borderColor: 'var(--border)' }}>
          <ThemeToggle />
        </div>
      </aside>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSidebarOpen(false)} />
          <aside className="absolute left-0 top-0 bottom-0 w-64 flex flex-col" style={{ background: 'var(--bg-secondary)', borderRight: '1px solid var(--border)' }}>
            <div className="p-4 flex items-center justify-between border-b" style={{ borderColor: 'var(--border)' }}>
              <span className="font-bold text-sm" style={{ color: 'var(--text)' }}>Marketspace 2.0</span>
              <button onClick={() => setSidebarOpen(false)} style={{ color: 'var(--text-muted)' }}><X size={18} /></button>
            </div>
            <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
              <NavItems />
            </nav>
            <div className="p-3 border-t" style={{ borderColor: 'var(--border)' }}>
              <ThemeToggle />
            </div>
          </aside>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile header */}
        <header className="lg:hidden flex items-center gap-3 px-4 py-3 border-b sticky top-0 z-40" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>
          <button onClick={() => setSidebarOpen(true)} style={{ color: 'var(--text-muted)' }}><Menu size={20} /></button>
          <span className="font-bold text-sm flex-1" style={{ color: 'var(--text)' }}>
            {TABS.find(t => t.id === activeTab)?.label}
          </span>
          <ThemeToggle />
        </header>

        {/* Desktop page header */}
        <div className="hidden lg:flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <h1 className="text-lg font-bold" style={{ color: 'var(--text)' }}>
            {TABS.find(t => t.id === activeTab)?.label}
          </h1>
        </div>

        {/* Tab content */}
        <main className="flex-1 py-6 overflow-x-hidden">
          <Suspense fallback={<TabLoader />}>
            {activeTab === 'overview'  && <OverviewTab />}
            {activeTab === 'sku'       && <SkuTableTab />}
            {activeTab === 'price'     && <PriceTab />}
            {activeTab === 'analytics' && <AnalyticsTab />}
            {activeTab === 'niche'     && <NicheTab />}
            {activeTab === 'orders'    && <OrderTab />}
            {activeTab === 'update'    && <UpdateTab />}
          </Suspense>
        </main>

        {/* Mobile bottom nav */}
        <nav className="lg:hidden fixed bottom-0 left-0 right-0 border-t flex" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
          {[TABS[0], TABS[1]].map(tab => {
            const Icon = tab.icon
            const active = activeTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className="flex-1 flex flex-col items-center gap-1 py-3 text-xs font-medium transition-colors"
                style={{ color: active ? 'var(--accent)' : 'var(--text-muted)' }}
              >
                <Icon size={20} />
                <span>{tab.label}</span>
              </button>
            )
          })}
        </nav>
      </div>
    </div>
  )
}
