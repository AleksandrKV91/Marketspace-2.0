'use client'

import { useState } from 'react'
import UpdateTab from '@/components/tabs/UpdateTab'
import OverviewTab from '@/components/tabs/OverviewTab'
import SkuTableTab from '@/components/tabs/SkuTableTab'
import PriceTab from '@/components/tabs/PriceTab'
import AnalyticsTab from '@/components/tabs/AnalyticsTab'
import NicheTab from '@/components/tabs/NicheTab'
import OrderTab from '@/components/tabs/OrderTab'

type Tab = 'overview' | 'sku' | 'price' | 'analytics' | 'niche' | 'orders' | 'update'

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'overview', label: 'Обзор' },
  { id: 'sku', label: 'Таблица SKU' },
  { id: 'price', label: 'Цены' },
  { id: 'analytics', label: 'Аналитика' },
  { id: 'niche', label: 'Ниши' },
  { id: 'orders', label: 'Заказы' },
  { id: 'update', label: 'Обновление' },
]

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState<Tab>('overview')

  return (
    <div className="min-h-screen bg-[#F8F9FA] dark:bg-[#0D1117]">
      {/* Header */}
      <header className="bg-white dark:bg-[#161B22] border-b border-gray-200 dark:border-white/10 px-6 py-3 flex items-center justify-between">
        <span className="font-bold text-[#1A1A2E] dark:text-white text-lg tracking-tight">
          Marketspace 2.0
        </span>
        <nav className="flex gap-1">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`
                px-3 py-1.5 rounded-lg text-sm font-medium transition-colors
                ${activeTab === tab.id
                  ? 'bg-[#E63946] text-white'
                  : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/5'
                }
              `}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </header>

      {/* Content */}
      <main className="py-6">
        {activeTab === 'overview' && <OverviewTab />}
        {activeTab === 'sku' && <SkuTableTab />}
        {activeTab === 'price' && <PriceTab />}
        {activeTab === 'analytics' && <AnalyticsTab />}
        {activeTab === 'niche' && <NicheTab />}
        {activeTab === 'orders' && <OrderTab />}
        {activeTab === 'update' && <UpdateTab />}
      </main>
    </div>
  )
}
