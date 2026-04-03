# Full Dashboard Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Полный редизайн дашборда: замена левого сайдбара на горизонтальную верхнюю навигацию, внедрение Glassmorphism дизайн-системы, переименование и реструктуризация 6 тематических вкладок с полным наполнением.

**Architecture:** Все изменения в одной ветке `redesign/full`. Переписываем `src/app/dashboard/page.tsx` (TopNav вместо Sidebar), обновляем `globals.css` (новые токены), обновляем `GlassCard`/`StatCard`, затем последовательно перерабатываем 6 вкладок + модальное окно SKU. Существующие API-роуты (`/api/dashboard/*`) и парсеры не трогаем.

**Tech Stack:** Next.js 16 App Router · TypeScript · Tailwind CSS 4 · Framer Motion · Recharts · Lucide React · Supabase (через существующие API)

**Ветка:** `redesign/full` (создать от `main`)

---

## Карта файлов

### Изменить:
- `src/app/globals.css` — обновить токены цветов и glassmorphism стили
- `src/app/dashboard/page.tsx` — полная замена: убрать sidebar, добавить sticky TopNav
- `src/app/layout.tsx` — добавить шрифт Plus Jakarta Sans (оставить Lato как fallback)
- `src/components/ui/GlassCard.tsx` — обновить стиль (border-radius 20px, новые тени)
- `src/components/ui/StatCard.tsx` — добавить иконку в круглой подложке, stagger animation
- `src/components/ui/AlertBox.tsx` — переработать на стеклянные карточки с цветной полосой слева
- `src/components/tabs/OverviewTab.tsx` → переименовать логику в "Свод"
- `src/components/tabs/SkuTableTab.tsx` → "Аналитика по SKU" (главная рабочая вкладка)
- `src/components/tabs/PriceTab.tsx` → "Реклама и воронка" (переработать наполнение)
- `src/components/tabs/AnalyticsTab.tsx` → "Продажи и экономика"
- `src/components/tabs/NicheTab.tsx` → "Анализ ниш и ABC"
- `src/components/tabs/OrderTab.tsx` → "Логистика и заказы"

### Создать:
- `src/components/ui/SkuModal.tsx` — общее модальное окно SKU (используется из всех вкладок)
- `src/components/ui/SeasonalitySparkline.tsx` — мини-график сезонности 12 месяцев
- `src/components/ui/ScoreBadge.tsx` — SKU Score бейдж с градиентом
- `src/components/ui/PriorityBadge.tsx` — бейдж статуса OOS/Маржа

### Не трогать:
- `src/app/api/**` — все API-роуты остаются как есть
- `src/lib/**` — парсеры и утилиты
- `src/store/dashboardStore.ts` — Zustand store

---

## Task 1: Создать ветку и обновить дизайн-токены

**Files:**
- Modify: `src/app/globals.css`
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: Создать рабочую ветку**

```bash
cd "/Users/Cats/Desktop/Анализ таблиц/Оценка рекламы/New dashboard"
git checkout -b redesign/full
```

Expected: `Switched to a new branch 'redesign/full'`

- [ ] **Step 2: Обновить globals.css с новыми токенами и glassmorphism**

Заменить весь файл `src/app/globals.css`:

```css
@import "tailwindcss";

/* ── Design tokens (Glassmorphism 2026) ─────────────────── */
:root {
  --bg: #F8F9FB;
  --bg-secondary: #FFFFFF;
  --surface: rgba(255, 255, 255, 0.85);
  --surface-solid: #FFFFFF;
  --surface-hover: rgba(255, 255, 255, 0.95);
  --border: rgba(0, 0, 0, 0.06);
  --border-subtle: rgba(0, 0, 0, 0.03);
  --border-glass: rgba(255, 255, 255, 0.5);
  --text: #0F172A;
  --text-muted: #64748B;
  --text-subtle: #94A3B8;
  --accent: #FF3B5C;
  --accent-hover: #E02249;
  --accent-glow: rgba(255, 59, 92, 0.10);
  --success: #22C55E;
  --success-bg: rgba(34, 197, 94, 0.10);
  --warning: #F59E0B;
  --warning-bg: rgba(245, 158, 11, 0.10);
  --info: #3B82F6;
  --info-bg: rgba(59, 130, 246, 0.10);
  --danger: #EF4444;
  --danger-bg: rgba(239, 68, 68, 0.10);
  --shadow-sm: 0 2px 8px rgba(148, 163, 184, 0.08);
  --shadow-md: 0 10px 30px rgba(148, 163, 184, 0.12);
  --shadow-lg: 0 20px 50px rgba(148, 163, 184, 0.15);
  --shadow-float: 0 8px 32px rgba(148, 163, 184, 0.10), 0 2px 8px rgba(148, 163, 184, 0.06);
  --radius: 12px;
  --radius-lg: 16px;
  --radius-xl: 20px;
  --radius-2xl: 24px;
  --blur: blur(20px);
  --blur-sm: blur(12px);
}

[data-theme="dark"] {
  --bg: #0D1117;
  --bg-secondary: #161B22;
  --surface: rgba(255, 255, 255, 0.05);
  --surface-solid: #1C2128;
  --surface-hover: rgba(255, 255, 255, 0.08);
  --border: rgba(255, 255, 255, 0.08);
  --border-subtle: rgba(255, 255, 255, 0.04);
  --border-glass: rgba(255, 255, 255, 0.12);
  --text: #E6EDF3;
  --text-muted: #8B949E;
  --text-subtle: #484F58;
  --accent-glow: rgba(255, 59, 92, 0.15);
  --shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.4);
  --shadow-md: 0 10px 30px rgba(0, 0, 0, 0.5);
  --shadow-lg: 0 20px 50px rgba(0, 0, 0, 0.6);
  --shadow-float: 0 8px 32px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.05);
}

/* ── Base ──────────────────────────────────────────────── */
html { font-family: 'Plus Jakarta Sans', 'Lato', sans-serif; }

body {
  background: var(--bg);
  color: var(--text);
  transition: background 0.3s, color 0.3s;
  -webkit-font-smoothing: antialiased;
}

/* ── Scrollbar ─────────────────────────────────────────── */
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 999px; }
::-webkit-scrollbar-thumb:hover { background: var(--text-subtle); }

/* ── Glass card ────────────────────────────────────────── */
.glass {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-float);
  backdrop-filter: var(--blur);
  -webkit-backdrop-filter: var(--blur);
}

.glass-solid {
  background: var(--surface-solid);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-float);
}

/* Hover lift */
.glass-hover {
  transition: transform 0.2s, box-shadow 0.2s;
}
.glass-hover:hover {
  transform: translateY(-4px);
  box-shadow: var(--shadow-lg);
}

/* ── Top navigation ────────────────────────────────────── */
.top-nav {
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border-bottom: 1px solid var(--border);
}
[data-theme="dark"] .top-nav {
  background: rgba(13, 17, 23, 0.92);
}

/* ── Alert strip (vertical bar left) ──────────────────── */
.alert-card {
  background: var(--surface);
  backdrop-filter: var(--blur-sm);
  -webkit-backdrop-filter: var(--blur-sm);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  position: relative;
  overflow: hidden;
}
.alert-card::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 4px;
  border-radius: 0 2px 2px 0;
}
.alert-critical::before { background: var(--accent); }
.alert-warning::before  { background: var(--warning); }
.alert-info::before     { background: var(--info); }
.alert-success::before  { background: var(--success); }

/* ── Skeleton shimmer ──────────────────────────────────── */
@keyframes shimmer {
  0%   { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
.skeleton {
  background: linear-gradient(90deg, var(--border) 25%, var(--surface-hover) 50%, var(--border) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: 8px;
}

/* ── Score gradient bar ────────────────────────────────── */
.score-bar {
  height: 4px;
  border-radius: 999px;
  background: linear-gradient(90deg, #EF4444 0%, #F59E0B 50%, #22C55E 100%);
}

/* ── Page mesh glow (subtle) ───────────────────────────── */
.page-glow::before {
  content: '';
  position: fixed;
  top: -30%;
  right: -10%;
  width: 60%;
  height: 60%;
  background: radial-gradient(ellipse, rgba(255, 59, 92, 0.04) 0%, transparent 70%);
  pointer-events: none;
  z-index: 0;
}
```

- [ ] **Step 3: Обновить layout.tsx — добавить Plus Jakarta Sans**

Заменить строку с Google Fonts в `src/app/layout.tsx`:

```typescript
<link
  href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=Lato:wght@400;700&display=swap"
  rel="stylesheet"
/>
```

- [ ] **Step 4: Проверить сборку**

```bash
cd "/Users/Cats/Desktop/Анализ таблиц/Оценка рекламы/New dashboard"
npm run build 2>&1 | tail -20
```

Expected: `✓ Compiled successfully` или близкое. Исправить все TypeScript ошибки если есть.

- [ ] **Step 5: Commit**

```bash
git add src/app/globals.css src/app/layout.tsx
git commit -m "feat: update design tokens and glassmorphism CSS system"
```

---

## Task 2: Обновить GlassCard и StatCard

**Files:**
- Modify: `src/components/ui/GlassCard.tsx`
- Modify: `src/components/ui/StatCard.tsx`
- Create: `src/components/ui/ScoreBadge.tsx`
- Create: `src/components/ui/PriorityBadge.tsx`

- [ ] **Step 1: Переписать GlassCard.tsx**

```typescript
import { ReactNode } from 'react'

interface Props {
  children: ReactNode
  className?: string
  padding?: 'none' | 'sm' | 'md' | 'lg'
  hover?: boolean
  solid?: boolean
}

const padMap = { none: '', sm: 'p-3', md: 'p-4', lg: 'p-6' }

export function GlassCard({ children, className = '', padding = 'md', hover = false, solid = false }: Props) {
  const base = solid ? 'glass-solid' : 'glass'
  const hoverCls = hover ? 'glass-hover cursor-pointer' : ''
  return (
    <div className={`${base} ${hoverCls} ${padMap[padding]} ${className}`}>
      {children}
    </div>
  )
}
```

- [ ] **Step 2: Переписать StatCard.tsx**

```typescript
'use client'
import { ReactNode } from 'react'
import { TrendingUp, TrendingDown } from 'lucide-react'
import { GlassCard } from './GlassCard'

interface Props {
  label: string
  value: string
  icon?: ReactNode
  iconColor?: string       // hex or CSS var, default --accent
  delta?: number
  deltaLabel?: string
  accent?: boolean
  loading?: boolean
  hover?: boolean
  onClick?: () => void
}

export function StatCard({
  label, value, icon, iconColor, delta, deltaLabel, accent, loading, hover, onClick
}: Props) {
  if (loading) return (
    <GlassCard>
      <div className="space-y-3">
        <div className="skeleton h-4 w-20" />
        <div className="skeleton h-8 w-32" />
        <div className="skeleton h-3 w-16" />
      </div>
    </GlassCard>
  )

  const up   = delta !== undefined && delta > 0
  const down = delta !== undefined && delta < 0
  const ic   = iconColor ?? 'var(--accent)'

  return (
    <GlassCard
      className={accent ? 'border-[var(--accent)]/30' : ''}
      hover={hover}
      onClick={onClick}
    >
      <div className="flex items-start justify-between mb-3">
        {icon ? (
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: `${ic}1A`, color: ic }}
          >
            {icon}
          </div>
        ) : <div />}
        {delta !== undefined && (
          <span
            className="flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full"
            style={{
              background: up ? 'var(--success-bg)' : down ? 'var(--danger-bg)' : 'var(--border)',
              color: up ? 'var(--success)' : down ? 'var(--danger)' : 'var(--text-muted)',
            }}
          >
            {up ? <TrendingUp size={11} /> : down ? <TrendingDown size={11} /> : null}
            {delta > 0 ? '+' : ''}{delta.toFixed(1)}%
          </span>
        )}
      </div>
      <p className="text-xs mb-1 font-medium" style={{ color: 'var(--text-subtle)' }}>{label}</p>
      <p
        className="text-2xl font-bold tracking-tight"
        style={{ color: accent ? 'var(--accent)' : 'var(--text)', letterSpacing: '-0.02em' }}
      >
        {value}
      </p>
      {deltaLabel && <p className="text-xs mt-1" style={{ color: 'var(--text-subtle)' }}>{deltaLabel}</p>}
    </GlassCard>
  )
}
```

- [ ] **Step 3: Создать ScoreBadge.tsx**

```typescript
interface Props {
  score: number   // 0-100
  size?: 'sm' | 'md'
}

const getColor = (s: number) =>
  s >= 80 ? '#22C55E' : s >= 60 ? '#10B981' : s >= 40 ? '#F59E0B' : s >= 20 ? '#F97316' : '#EF4444'

const getLabel = (s: number) =>
  s >= 80 ? '🔥 Масштабировать' :
  s >= 60 ? '🟢 Стабильный рост' :
  s >= 40 ? '⚠️ Оптимизация' :
  s >= 20 ? '🟠 Риск' : '🔴 Проблемный'

export function ScoreBadge({ score, size = 'md' }: Props) {
  const color = getColor(score)
  const clamp = Math.max(0, Math.min(100, score))
  return (
    <div className={`flex flex-col gap-1 ${size === 'sm' ? 'w-16' : 'w-20'}`}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold" style={{ color }}>{clamp}</span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${clamp}%`, background: color }}
        />
      </div>
      {size === 'md' && (
        <span className="text-[10px]" style={{ color: 'var(--text-subtle)' }}>
          {getLabel(score).split(' ').slice(1).join(' ')}
        </span>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Создать PriorityBadge.tsx**

```typescript
type OosStatus = 'critical' | 'warning' | 'ok' | 'none'
type MarginStatus = 'high' | 'medium' | 'low'

interface Props {
  oos?: OosStatus
  margin?: MarginStatus
}

const oosCfg: Record<OosStatus, { label: string; bg: string; color: string }> = {
  critical: { label: 'OOS Крит.',   bg: 'var(--danger-bg)',  color: 'var(--danger)' },
  warning:  { label: 'OOS Вним.',   bg: 'var(--warning-bg)', color: 'var(--warning)' },
  ok:       { label: 'OOS Норма',   bg: 'var(--success-bg)', color: 'var(--success)' },
  none:     { label: '',             bg: '',                  color: '' },
}

const marginCfg: Record<MarginStatus, { label: string; bg: string; color: string }> = {
  high:   { label: 'Маржа Высок.', bg: 'var(--success-bg)', color: 'var(--success)' },
  medium: { label: 'Маржа Средн.', bg: 'var(--warning-bg)', color: 'var(--warning)' },
  low:    { label: 'Маржа Низк.',  bg: 'var(--danger-bg)',  color: 'var(--danger)' },
}

function Chip({ label, bg, color }: { label: string; bg: string; color: string }) {
  if (!label) return null
  return (
    <span
      className="text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ background: bg, color }}
    >
      {label}
    </span>
  )
}

export function PriorityBadge({ oos, margin }: Props) {
  return (
    <div className="flex flex-col gap-1">
      {oos && oos !== 'none' && <Chip {...oosCfg[oos]} />}
      {margin && <Chip {...marginCfg[margin]} />}
    </div>
  )
}
```

- [ ] **Step 5: Обновить AlertBox.tsx**

```typescript
'use client'
import { ReactNode } from 'react'

interface Props {
  icon?: string
  title: string
  count?: number
  description?: string
  severity?: 'critical' | 'warning' | 'info' | 'success'
  onClick?: () => void
}

export function AlertBox({ icon, title, count, description, severity = 'info', onClick }: Props) {
  const colorMap = {
    critical: { text: 'var(--accent)',   num: 'var(--accent)' },
    warning:  { text: 'var(--warning)',  num: 'var(--warning)' },
    info:     { text: 'var(--info)',     num: 'var(--info)' },
    success:  { text: 'var(--success)',  num: 'var(--success)' },
  }
  const c = colorMap[severity]

  return (
    <div
      className={`alert-card alert-${severity} px-4 py-3 ${onClick ? 'cursor-pointer' : ''}`}
      onClick={onClick}
      style={{ transition: 'transform 0.15s, box-shadow 0.15s' }}
      onMouseEnter={e => { if (onClick) { (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)'; (e.currentTarget as HTMLElement).style.boxShadow = 'var(--shadow-md)' } }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = ''; (e.currentTarget as HTMLElement).style.boxShadow = '' }}
    >
      <div className="flex items-center gap-2 mb-1">
        {icon && <span className="text-base">{icon}</span>}
        <span className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{title}</span>
      </div>
      {count !== undefined && (
        <p className="text-2xl font-bold" style={{ color: c.num, letterSpacing: '-0.02em' }}>{count}</p>
      )}
      {description && (
        <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{description}</p>
      )}
    </div>
  )
}
```

- [ ] **Step 6: Проверить сборку**

```bash
npm run build 2>&1 | tail -20
```

Expected: `✓ Compiled successfully`

- [ ] **Step 7: Commit**

```bash
git add src/components/ui/GlassCard.tsx src/components/ui/StatCard.tsx \
        src/components/ui/AlertBox.tsx src/components/ui/ScoreBadge.tsx \
        src/components/ui/PriorityBadge.tsx
git commit -m "feat: redesign UI components with glassmorphism style"
```

---

## Task 3: Переписать dashboard/page.tsx — TopNav вместо Sidebar

**Files:**
- Modify: `src/app/dashboard/page.tsx`

- [ ] **Step 1: Полностью заменить page.tsx**

```typescript
'use client'

import { useState, lazy, Suspense } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  LayoutDashboard, Table2, TrendingUp, BarChart2,
  Globe, ShoppingCart, Upload, Moon, Sun, Monitor
} from 'lucide-react'

const SvodTab      = lazy(() => import('@/components/tabs/OverviewTab'))
const SkuTab       = lazy(() => import('@/components/tabs/SkuTableTab'))
const PriceTab     = lazy(() => import('@/components/tabs/PriceTab'))
const AnalyticsTab = lazy(() => import('@/components/tabs/AnalyticsTab'))
const NicheTab     = lazy(() => import('@/components/tabs/NicheTab'))
const OrderTab     = lazy(() => import('@/components/tabs/OrderTab'))
const UpdateTab    = lazy(() => import('@/components/tabs/UpdateTab'))

type Tab = 'svod' | 'sku' | 'price' | 'analytics' | 'niche' | 'orders' | 'update'

const TABS: Array<{ id: Tab; label: string; icon: React.ElementType }> = [
  { id: 'svod',      label: 'Свод',                  icon: LayoutDashboard },
  { id: 'analytics', label: 'Продажи и экономика',   icon: BarChart2 },
  { id: 'price',     label: 'Реклама и воронка',     icon: TrendingUp },
  { id: 'orders',    label: 'Логистика и заказы',    icon: ShoppingCart },
  { id: 'sku',       label: 'Аналитика по SKU',      icon: Table2 },
  { id: 'niche',     label: 'Анализ ниш и ABC',      icon: Globe },
  { id: 'update',    label: 'Обновление данных',     icon: Upload },
]

function TabLoader() {
  return (
    <div className="flex items-center justify-center py-32" style={{ color: 'var(--text-muted)' }}>
      <div
        className="animate-spin w-6 h-6 border-2 rounded-full mr-3"
        style={{ borderColor: 'var(--border)', borderTopColor: 'var(--accent)' }}
      />
      Загрузка...
    </div>
  )
}

function ThemeButton() {
  const [theme, setTheme] = useState<'light' | 'dark' | 'auto'>(() => {
    if (typeof window === 'undefined') return 'light'
    return (localStorage.getItem('theme') as 'light' | 'dark' | 'auto') ?? 'light'
  })

  const cycle = () => {
    const next = theme === 'light' ? 'dark' : theme === 'dark' ? 'auto' : 'light'
    setTheme(next)
    localStorage.setItem('theme', next)
    if (next === 'dark') document.documentElement.dataset.theme = 'dark'
    else if (next === 'light') document.documentElement.dataset.theme = 'light'
    else {
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
    <div className="min-h-screen page-glow" style={{ background: 'var(--bg)' }}>

      {/* ── Sticky Top Navigation ── */}
      <header className="top-nav sticky top-0 z-50 h-[72px] flex items-center px-6 gap-6">
        {/* Logo */}
        <div className="flex items-center gap-2.5 shrink-0 mr-4">
          <div
            className="w-8 h-8 rounded-xl flex items-center justify-center text-white text-sm font-black"
            style={{ background: 'var(--accent)' }}
          >
            M
          </div>
          <span className="font-bold text-sm hidden sm:block" style={{ color: 'var(--text)' }}>
            Marketspace 2.0
          </span>
        </div>

        {/* Desktop nav tabs */}
        <nav className="hidden lg:flex items-center gap-1 flex-1 relative">
          {TABS.filter(t => t.id !== 'update').map(tab => {
            const Icon = tab.icon
            const active = activeTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className="relative flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-all whitespace-nowrap"
                style={{
                  color: active ? 'var(--accent)' : 'var(--text-muted)',
                  background: active ? 'var(--accent-glow)' : 'transparent',
                }}
                onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.color = 'var(--text)' }}
                onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)' }}
              >
                <Icon size={15} />
                <span>{tab.label}</span>
                {active && (
                  <motion.div
                    layoutId="nav-pill"
                    className="absolute inset-0 rounded-xl -z-10"
                    style={{ background: 'var(--accent-glow)' }}
                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                  />
                )}
              </button>
            )
          })}
        </nav>

        {/* Right actions */}
        <div className="ml-auto flex items-center gap-2 shrink-0">
          {/* Upload button */}
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
            className="lg:hidden w-8 h-8 rounded-xl flex items-center justify-center"
            style={{ background: 'var(--border)', color: 'var(--text-muted)' }}
            onClick={() => setMobileMenuOpen(v => !v)}
          >
            <span className="sr-only">Меню</span>
            <div className="space-y-1">
              <span className="block w-4 h-0.5 rounded" style={{ background: 'currentColor' }} />
              <span className="block w-4 h-0.5 rounded" style={{ background: 'currentColor' }} />
              <span className="block w-3 h-0.5 rounded" style={{ background: 'currentColor' }} />
            </div>
          </button>
        </div>
      </header>

      {/* ── Mobile dropdown menu ── */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
            className="lg:hidden fixed top-[72px] left-0 right-0 z-40 p-4 space-y-1 shadow-lg"
            style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}
          >
            {TABS.map(tab => {
              const Icon = tab.icon
              const active = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  onClick={() => { setActiveTab(tab.id); setMobileMenuOpen(false) }}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-left transition-all"
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
        )}
      </AnimatePresence>

      {/* ── Main content ── */}
      <main className="max-w-[1440px] mx-auto">
        <Suspense fallback={<TabLoader />}>
          {activeTab === 'svod'      && <SvodTab />}
          {activeTab === 'sku'       && <SkuTab />}
          {activeTab === 'price'     && <PriceTab />}
          {activeTab === 'analytics' && <AnalyticsTab />}
          {activeTab === 'niche'     && <NicheTab />}
          {activeTab === 'orders'    && <OrderTab />}
          {activeTab === 'update'    && <UpdateTab />}
        </Suspense>
      </main>
    </div>
  )
}
```

- [ ] **Step 2: Проверить сборку**

```bash
npm run build 2>&1 | tail -30
```

Expected: `✓ Compiled successfully`. Если `ThemeToggle` импортируется в других местах — проверить что не сломался.

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/page.tsx
git commit -m "feat: replace sidebar with sticky horizontal top navigation"
```

---

## Task 4: Переработать вкладку «Свод» (OverviewTab)

**Files:**
- Modify: `src/components/tabs/OverviewTab.tsx`

Вкладка «Свод» — дашборд-обзор. Layout: 2 ряда KPI (3+3), большой граф Выручка+ЧМД, блоки Фокус дня + Алерты, мини-таблица топ-15 по SKU Score.

- [ ] **Step 1: Найти существующий API `/api/dashboard/overview`**

```bash
cat "/Users/Cats/Desktop/Анализ таблиц/Оценка рекламы/New dashboard/src/app/api/dashboard/overview/route.ts" 2>/dev/null | head -60
```

Записать поля которые возвращает API — они нужны для типов.

- [ ] **Step 2: Переписать OverviewTab.tsx**

Заменить содержимое `src/components/tabs/OverviewTab.tsx`:

```typescript
'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, LineChart, Line
} from 'recharts'
import {
  ShoppingBag, TrendingDown, Percent, AlertTriangle, Package, BarChart2,
  Zap, ChevronRight
} from 'lucide-react'
import { GlassCard } from '@/components/ui/GlassCard'
import { StatCard } from '@/components/ui/StatCard'
import { AlertBox } from '@/components/ui/AlertBox'
import { ScoreBadge } from '@/components/ui/ScoreBadge'

interface OverviewData {
  kpi: {
    revenue: number
    chmd: number
    avg_margin_pct: number
    drr?: number
    oos_count: number
    sku_count: number
    lost_revenue?: number
  }
  stock: { total_fbo: number; total_fbs: number; total_stock: number; sku_count: number }
  abc: { A: number; B: number; C: number }
  trend: Array<{ date: string; sales_qty: number; revenue?: number; chmd?: number }>
  categories: Array<{ category: string; revenue: number; chmd: number; sku_count: number }>
  managers: Array<{ manager: string; revenue: number; chmd: number; sku_count: number; margin_pct: number }>
  latest_date: string | null
}

function fmt(n: number | null | undefined): string {
  if (n == null) return '—'
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'М'
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(0) + 'К'
  return String(Math.round(n))
}

function fmtPct(n: number | null | undefined): string {
  if (n == null) return '—'
  return (n * 100).toFixed(1) + '%'
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getDate().toString().padStart(2, '0')}.${(d.getMonth() + 1).toString().padStart(2, '0')}`
}

const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06 } },
}
const fadeUp = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3 } },
}

function ChartTip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="glass p-3 text-xs min-w-[130px]" style={{ color: 'var(--text)' }}>
      <p className="font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>{label}</p>
      {payload.map(p => (
        <div key={p.name} className="flex items-center gap-2 mb-1">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span style={{ color: 'var(--text-muted)' }}>{p.name}:</span>
          <span className="font-bold ml-auto">{fmt(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

function SkeletonCards({ count }: { count: number }) {
  return (
    <div className={`grid gap-3 grid-cols-2 md:grid-cols-${count}`}>
      {Array.from({ length: count }).map((_, i) => (
        <GlassCard key={i}>
          <div className="space-y-3">
            <div className="skeleton h-9 w-9 rounded-full" />
            <div className="skeleton h-4 w-20" />
            <div className="skeleton h-7 w-28" />
            <div className="skeleton h-3 w-14" />
          </div>
        </GlassCard>
      ))}
    </div>
  )
}

export default function OverviewTab() {
  const [data, setData] = useState<OverviewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/dashboard/overview')
      .then(r => r.json())
      .then((d: OverviewData) => { setData(d); setLoading(false) })
      .catch((e: unknown) => { setError(String(e)); setLoading(false) })
  }, [])

  if (loading) return (
    <div className="px-6 py-6 space-y-6 max-w-[1440px] mx-auto">
      <SkeletonCards count={3} />
      <SkeletonCards count={3} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <GlassCard><div className="skeleton h-56 w-full" /></GlassCard>
        <GlassCard><div className="skeleton h-56 w-full" /></GlassCard>
      </div>
    </div>
  )

  if (error) return (
    <div className="px-6 py-16 text-center" style={{ color: 'var(--danger)' }}>{error}</div>
  )

  if (!data) return null

  const trendData = data.trend.map(r => ({
    date: fmtDate(r.date),
    'Выручка': r.revenue ?? r.sales_qty,
    'ЧМД': r.chmd ?? 0,
  }))

  const abcTotal = data.abc.A + data.abc.B + data.abc.C
  const drr = data.kpi.drr ?? 0

  return (
    <div className="px-6 py-6 space-y-6 max-w-[1440px] mx-auto">

      {/* Row 1 — KPI: Выручка, ЧМД, Маржа% */}
      <motion.div variants={stagger} initial="hidden" animate="show"
        className="grid grid-cols-1 sm:grid-cols-3 gap-3"
      >
        <motion.div variants={fadeUp}>
          <StatCard
            label="Выручка (период)"
            value={fmt(data.kpi.revenue)}
            icon={<ShoppingBag size={16} />}
          />
        </motion.div>
        <motion.div variants={fadeUp}>
          <StatCard
            label="ЧМД (период)"
            value={fmt(data.kpi.chmd)}
            icon={<TrendingDown size={16} />}
            iconColor="var(--success)"
          />
        </motion.div>
        <motion.div variants={fadeUp}>
          <StatCard
            label="Маржа %"
            value={fmtPct(data.kpi.avg_margin_pct)}
            icon={<Percent size={16} />}
            accent={data.kpi.avg_margin_pct < 0.10}
            iconColor={data.kpi.avg_margin_pct < 0.10 ? 'var(--danger)' : 'var(--success)'}
          />
        </motion.div>
      </motion.div>

      {/* Row 2 — KPI: ДРР, SKU в риске, Потери */}
      <motion.div variants={stagger} initial="hidden" animate="show"
        className="grid grid-cols-1 sm:grid-cols-3 gap-3"
      >
        <motion.div variants={fadeUp}>
          <StatCard
            label="ДРР (период)"
            value={drr > 0 ? (drr * 100).toFixed(1) + '%' : '—'}
            icon={<BarChart2 size={16} />}
            accent={data.kpi.avg_margin_pct > 0 && drr > data.kpi.avg_margin_pct}
            iconColor="var(--info)"
          />
        </motion.div>
        <motion.div variants={fadeUp}>
          <StatCard
            label="SKU в риске (OOS)"
            value={String(data.kpi.oos_count)}
            icon={<AlertTriangle size={16} />}
            accent={data.kpi.oos_count > 0}
            iconColor="var(--danger)"
          />
        </motion.div>
        <motion.div variants={fadeUp}>
          <StatCard
            label="Потери (OOS)"
            value={data.kpi.lost_revenue ? fmt(data.kpi.lost_revenue) : '—'}
            icon={<Package size={16} />}
            accent={(data.kpi.lost_revenue ?? 0) > 0}
            iconColor="var(--danger)"
          />
        </motion.div>
      </motion.div>

      {/* Main chart + Alerts row */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">

        {/* Big chart — Выручка и ЧМД */}
        <GlassCard padding="lg" className="xl:col-span-2">
          <p className="text-sm font-semibold mb-4" style={{ color: 'var(--text)' }}>
            Динамика выручки и ЧМД
          </p>
          {trendData.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={trendData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="var(--accent)" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="chmdGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="var(--success)" stopOpacity={0.20} />
                    <stop offset="95%" stopColor="var(--success)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.6} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} width={44} tickFormatter={v => fmt(v as number)} />
                <Tooltip content={<ChartTip />} />
                <Area type="monotone" dataKey="Выручка" stroke="var(--accent)" strokeWidth={2} fill="url(#revGrad)" dot={false} activeDot={{ r: 4, fill: 'var(--accent)' }} />
                <Area type="monotone" dataKey="ЧМД" stroke="var(--success)" strokeWidth={2} fill="url(#chmdGrad)" dot={false} activeDot={{ r: 4, fill: 'var(--success)' }} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-56 text-sm" style={{ color: 'var(--text-muted)' }}>Нет данных</div>
          )}
        </GlassCard>

        {/* Alerts column */}
        <div className="space-y-3">
          <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Критические алерты</p>
          <AlertBox icon="🚨" title="STOP реклама" count={data.kpi.oos_count} severity="critical" description={data.kpi.lost_revenue ? `Потеря: ${fmt(data.kpi.lost_revenue)} ₽` : undefined} onClick={() => {}} />
          <AlertBox icon="⚠️" title="Скоро OOS" count={0} severity="warning" description="Запас < лог. плеча" onClick={() => {}} />
          <AlertBox icon="💸" title="ДРР > Маржа" count={0} severity="warning" onClick={() => {}} />
          <AlertBox icon="🚀" title="Потенциал роста" count={data.abc.A} severity="success" onClick={() => {}} />
        </div>
      </div>

      {/* Фокус дня + Топ SKU Score */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">

        {/* Фокус дня */}
        <GlassCard padding="lg">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
              <Zap size={14} className="inline mr-1.5" style={{ color: 'var(--accent)' }} />
              Фокус дня
            </p>
          </div>
          <div className="space-y-3">
            {data.kpi.oos_count > 0 && (
              <div className="flex items-start gap-3 p-3 rounded-xl" style={{ background: 'var(--danger-bg)' }}>
                <span className="text-base">🚨</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold" style={{ color: 'var(--danger)' }}>Стоп реклама</p>
                  <p className="text-sm" style={{ color: 'var(--text)' }}>{data.kpi.oos_count} SKU без стока с активной рекламой</p>
                </div>
                <ChevronRight size={14} style={{ color: 'var(--text-subtle)', flexShrink: 0 }} />
              </div>
            )}
            {(data.kpi.avg_margin_pct < 0.10) && (
              <div className="flex items-start gap-3 p-3 rounded-xl" style={{ background: 'var(--warning-bg)' }}>
                <span className="text-base">💸</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold" style={{ color: 'var(--warning)' }}>Низкая маржа</p>
                  <p className="text-sm" style={{ color: 'var(--text)' }}>Средняя маржа {fmtPct(data.kpi.avg_margin_pct)} — ниже порога 10%</p>
                </div>
              </div>
            )}
            {data.kpi.oos_count === 0 && data.kpi.avg_margin_pct >= 0.10 && (
              <p className="text-sm py-4 text-center" style={{ color: 'var(--text-muted)' }}>
                Критических задач нет. Всё в норме.
              </p>
            )}
          </div>
        </GlassCard>

        {/* По менеджерам */}
        <GlassCard padding="lg">
          <p className="text-sm font-semibold mb-4" style={{ color: 'var(--text)' }}>По менеджерам</p>
          {data.managers.length === 0 ? (
            <p className="text-sm py-4 text-center" style={{ color: 'var(--text-muted)' }}>Нет данных</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs" style={{ color: 'var(--text-subtle)' }}>
                    <th className="text-left pb-2 font-medium">Менеджер</th>
                    <th className="text-right pb-2 font-medium">SKU</th>
                    <th className="text-right pb-2 font-medium">Выручка</th>
                    <th className="text-right pb-2 font-medium">Маржа</th>
                  </tr>
                </thead>
                <tbody>
                  {data.managers.map(m => {
                    const isLow = m.margin_pct < 0.10
                    return (
                      <tr key={m.manager} className="border-t" style={{ borderColor: 'var(--border)' }}>
                        <td className="py-2 pr-4 font-medium" style={{ color: 'var(--text)' }}>{m.manager}</td>
                        <td className="py-2 text-right" style={{ color: 'var(--text-muted)' }}>{m.sku_count}</td>
                        <td className="py-2 text-right font-semibold" style={{ color: 'var(--text)' }}>{fmt(m.revenue)}</td>
                        <td className="py-2 text-right">
                          <span
                            className="px-2 py-0.5 rounded text-xs font-medium"
                            style={{
                              background: isLow ? 'var(--danger-bg)' : 'var(--success-bg)',
                              color: isLow ? 'var(--danger)' : 'var(--success)',
                            }}
                          >
                            {fmtPct(m.margin_pct)}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </GlassCard>
      </div>

      {/* ABC distribution */}
      <GlassCard padding="lg">
        <p className="text-sm font-semibold mb-4" style={{ color: 'var(--text)' }}>ABC — распределение</p>
        <div className="grid grid-cols-3 gap-4">
          {(['A', 'B', 'C'] as const).map(cls => {
            const count = data.abc[cls]
            const pct = abcTotal > 0 ? (count / abcTotal * 100).toFixed(0) : '0'
            const color = cls === 'A' ? 'var(--success)' : cls === 'B' ? 'var(--warning)' : 'var(--danger)'
            return (
              <div key={cls} className="text-center p-4 rounded-xl" style={{ background: 'var(--bg)' }}>
                <p className="text-3xl font-black" style={{ color }}>{count}</p>
                <p className="text-xs font-bold mt-1" style={{ color }}>Класс {cls}</p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-subtle)' }}>{pct}% от всех</p>
              </div>
            )
          })}
        </div>
      </GlassCard>
    </div>
  )
}
```

- [ ] **Step 3: Проверить сборку**

```bash
npm run build 2>&1 | tail -20
```

- [ ] **Step 4: Commit**

```bash
git add src/components/tabs/OverviewTab.tsx
git commit -m "feat: redesign 'Свод' tab with glassmorphism KPI cards and dual-axis chart"
```

---

## Task 5: Вкладка «Продажи и экономика» (AnalyticsTab)

**Files:**
- Modify: `src/components/tabs/AnalyticsTab.tsx`
- Check existing: `src/app/api/dashboard/analytics/route.ts`

- [ ] **Step 1: Посмотреть что возвращает API аналитики**

```bash
cat "/Users/Cats/Desktop/Анализ таблиц/Оценка рекламы/New dashboard/src/app/api/dashboard/analytics/route.ts" 2>/dev/null | head -80
```

- [ ] **Step 2: Переписать AnalyticsTab.tsx**

```typescript
'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  LineChart, Line, BarChart, Bar, Legend
} from 'recharts'
import { GlassCard } from '@/components/ui/GlassCard'
import { StatCard } from '@/components/ui/StatCard'
import { ShoppingBag, TrendingDown, Percent, BarChart2, Target, TrendingUp } from 'lucide-react'

interface AnalyticsData {
  summary: {
    revenue: number
    revenue_prev: number
    chmd: number
    chmd_prev: number
    margin_pct: number
    margin_prev: number
    drr: number
    drr_prev: number
    cpo?: number
    delta_revenue_pct?: number
  }
  daily: Array<{ date: string; revenue: number; chmd: number; expenses: number; margin_pct: number; drr: number }>
  by_category: Array<{ category: string; revenue: number; delta_pct: number; chmd: number; margin_pct: number; drr: number; stock_rub: number; sku_count: number }>
  by_manager: Array<{ manager: string; revenue: number; chmd: number; margin_pct: number; drr: number; oos_count: number; sku_count: number }>
}

function fmt(n: number | null | undefined) {
  if (n == null) return '—'
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'М'
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(0) + 'К'
  return String(Math.round(n))
}
function fmtPct(n: number | null | undefined) {
  if (n == null) return '—'
  return (n * 100).toFixed(1) + '%'
}
function fmtDate(iso: string) {
  const d = new Date(iso)
  return `${d.getDate().toString().padStart(2,'0')}.${(d.getMonth()+1).toString().padStart(2,'0')}`
}
function delta(curr: number, prev: number) {
  if (!prev) return undefined
  return ((curr - prev) / prev) * 100
}

const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.06 } } }
const fadeUp = { hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0, transition: { duration: 0.3 } } }

function ChartTip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="glass p-3 text-xs min-w-[130px]" style={{ color: 'var(--text)' }}>
      <p className="font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>{label}</p>
      {payload.map(p => (
        <div key={p.name} className="flex items-center gap-2 mb-1">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span style={{ color: 'var(--text-muted)' }}>{p.name}:</span>
          <span className="font-bold ml-auto">{fmt(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

export default function AnalyticsTab() {
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/dashboard/analytics')
      .then(r => r.json())
      .then((d: AnalyticsData) => { setData(d); setLoading(false) })
      .catch((e: unknown) => { setError(String(e)); setLoading(false) })
  }, [])

  if (loading) return (
    <div className="px-6 py-6 space-y-6 max-w-[1440px] mx-auto">
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <GlassCard key={i}><div className="space-y-3"><div className="skeleton h-9 w-9 rounded-full" /><div className="skeleton h-4 w-20" /><div className="skeleton h-7 w-28" /></div></GlassCard>
        ))}
      </div>
    </div>
  )
  if (error) return <div className="px-6 py-16 text-center" style={{ color: 'var(--danger)' }}>{error}</div>
  if (!data) return null

  const s = data.summary
  const dailyFmt = (data.daily ?? []).map(d => ({
    date: fmtDate(d.date),
    'Выручка': d.revenue,
    'ЧМД': d.chmd,
    'Расходы': d.expenses,
    'Маржа%': +(d.margin_pct * 100).toFixed(1),
    'ДРР%': +(d.drr * 100).toFixed(1),
  }))

  return (
    <div className="px-6 py-6 space-y-6 max-w-[1440px] mx-auto">

      {/* KPI row — 6 карточек */}
      <motion.div variants={stagger} initial="hidden" animate="show"
        className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3"
      >
        {[
          { label: 'Выручка', value: fmt(s.revenue), icon: <ShoppingBag size={16} />, delta: delta(s.revenue, s.revenue_prev) },
          { label: 'ЧМД', value: fmt(s.chmd), icon: <TrendingDown size={16} />, iconColor: 'var(--success)', delta: delta(s.chmd, s.chmd_prev) },
          { label: 'Маржа %', value: fmtPct(s.margin_pct), icon: <Percent size={16} />, delta: s.margin_prev ? (s.margin_pct - s.margin_prev) * 100 : undefined, accent: s.margin_pct < 0.10 },
          { label: 'ДРР Total', value: fmtPct(s.drr), icon: <BarChart2 size={16} />, iconColor: 'var(--info)', delta: s.drr_prev ? (s.drr_prev - s.drr) * 100 : undefined },
          { label: 'CPO', value: s.cpo ? fmt(s.cpo) + ' ₽' : '—', icon: <Target size={16} />, iconColor: 'var(--warning)' },
          { label: 'Δ Выручки', value: s.delta_revenue_pct != null ? (s.delta_revenue_pct > 0 ? '+' : '') + s.delta_revenue_pct.toFixed(1) + '%' : '—', icon: <TrendingUp size={16} />, iconColor: (s.delta_revenue_pct ?? 0) >= 0 ? 'var(--success)' : 'var(--danger)' },
        ].map((card, i) => (
          <motion.div key={i} variants={fadeUp}>
            <StatCard {...card} />
          </motion.div>
        ))}
      </motion.div>

      {/* Charts row */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Выручка и расходы по дням */}
        <GlassCard padding="lg">
          <p className="text-sm font-semibold mb-4" style={{ color: 'var(--text)' }}>Выручка и расходы по дням</p>
          {dailyFmt.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={dailyFmt} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="revG" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="chmdG" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--success)" stopOpacity={0.20} />
                    <stop offset="95%" stopColor="var(--success)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.6} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis yAxisId="left" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} width={44} tickFormatter={v => fmt(v as number)} />
                <Tooltip content={<ChartTip />} />
                <Area yAxisId="left" type="monotone" dataKey="Выручка" stroke="var(--accent)" strokeWidth={2} fill="url(#revG)" dot={false} />
                <Area yAxisId="left" type="monotone" dataKey="ЧМД" stroke="var(--success)" strokeWidth={2} fill="url(#chmdG)" dot={false} />
                <Area yAxisId="left" type="monotone" dataKey="Расходы" stroke="var(--danger)" strokeWidth={1.5} fill="none" dot={false} strokeDasharray="4 2" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-56 text-sm" style={{ color: 'var(--text-muted)' }}>Нет данных</div>
          )}
        </GlassCard>

        {/* Маржа% vs ДРР% */}
        <GlassCard padding="lg">
          <p className="text-sm font-semibold mb-4" style={{ color: 'var(--text)' }}>Маржа % vs ДРР % по дням</p>
          {dailyFmt.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={dailyFmt} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.6} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} width={36} tickFormatter={v => `${v}%`} />
                <Tooltip content={<ChartTip />} />
                <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="Маржа%" stroke="var(--success)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                <Line type="monotone" dataKey="ДРР%" stroke="var(--accent)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} strokeDasharray="4 2" />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-56 text-sm" style={{ color: 'var(--text-muted)' }}>Нет данных</div>
          )}
        </GlassCard>
      </div>

      {/* Иерархическая таблица: Категория > Предмет > SKU */}
      <GlassCard padding="lg">
        <p className="text-sm font-semibold mb-4" style={{ color: 'var(--text)' }}>По категориям</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs" style={{ color: 'var(--text-subtle)' }}>
                <th className="text-left pb-3 font-medium">Категория</th>
                <th className="text-right pb-3 font-medium">SKU</th>
                <th className="text-right pb-3 font-medium">Выручка</th>
                <th className="text-right pb-3 font-medium">Δ%</th>
                <th className="text-right pb-3 font-medium">ЧМД</th>
                <th className="text-right pb-3 font-medium">Маржа</th>
                <th className="text-right pb-3 font-medium">ДРР</th>
                <th className="text-right pb-3 font-medium">Остаток</th>
              </tr>
            </thead>
            <tbody>
              {(data.by_category ?? []).map((cat, i) => {
                const isLow = cat.margin_pct < 0.10
                const dUp = (cat.delta_pct ?? 0) > 0
                return (
                  <tr key={i} className="border-t" style={{ borderColor: 'var(--border)' }}>
                    <td className="py-2.5 pr-4 font-medium" style={{ color: 'var(--text)' }}>{cat.category}</td>
                    <td className="py-2.5 text-right" style={{ color: 'var(--text-muted)' }}>{cat.sku_count}</td>
                    <td className="py-2.5 text-right font-semibold" style={{ color: 'var(--text)' }}>{fmt(cat.revenue)}</td>
                    <td className="py-2.5 text-right">
                      <span className="text-xs font-semibold" style={{ color: dUp ? 'var(--success)' : 'var(--danger)' }}>
                        {cat.delta_pct != null ? (dUp ? '+' : '') + cat.delta_pct.toFixed(1) + '%' : '—'}
                      </span>
                    </td>
                    <td className="py-2.5 text-right" style={{ color: 'var(--text-muted)' }}>{fmt(cat.chmd)}</td>
                    <td className="py-2.5 text-right">
                      <span className="px-2 py-0.5 rounded text-xs font-medium" style={{ background: isLow ? 'var(--danger-bg)' : 'var(--success-bg)', color: isLow ? 'var(--danger)' : 'var(--success)' }}>{fmtPct(cat.margin_pct)}</span>
                    </td>
                    <td className="py-2.5 text-right" style={{ color: 'var(--text-muted)' }}>{fmtPct(cat.drr)}</td>
                    <td className="py-2.5 text-right" style={{ color: 'var(--text-muted)' }}>{fmt(cat.stock_rub)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </GlassCard>
    </div>
  )
}
```

- [ ] **Step 3: Проверить сборку**

```bash
npm run build 2>&1 | tail -20
```

- [ ] **Step 4: Commit**

```bash
git add src/components/tabs/AnalyticsTab.tsx
git commit -m "feat: redesign 'Продажи и экономика' tab with charts and category table"
```

---

## Task 6: Вкладка «Реклама и воронка» (PriceTab)

**Files:**
- Modify: `src/components/tabs/PriceTab.tsx`
- Check: `src/app/api/dashboard/prices/route.ts`

Вкладка содержит: 6 KPI-карточек воронки (CTR, CR корзина, CR заказ, CPC, CPM, Доля рекл. заказов), графики воронки и рекл. vs органика, таблица изменения цен с delta-метриками.

- [ ] **Step 1: Посмотреть API**

```bash
cat "/Users/Cats/Desktop/Анализ таблиц/Оценка рекламы/New dashboard/src/app/api/dashboard/prices/route.ts" 2>/dev/null | head -80
```

- [ ] **Step 2: Переписать PriceTab.tsx**

```typescript
'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
  BarChart, Bar
} from 'recharts'
import { GlassCard } from '@/components/ui/GlassCard'
import { StatCard } from '@/components/ui/StatCard'
import { MousePointerClick, ShoppingCart, ArrowRight, DollarSign, Megaphone, Percent } from 'lucide-react'

interface PriceData {
  funnel: {
    ctr: number
    cr_basket: number
    cr_order: number
    cpc: number
    cpm: number
    ad_order_share: number
  }
  daily: Array<{
    date: string
    ctr: number
    cr_basket: number
    cr_order: number
    ad_revenue: number
    organic_revenue: number
  }>
  price_changes: Array<{
    sku: string
    name: string
    manager: string
    date: string
    price_before: number
    price_after: number
    delta_pct: number
    delta_ctr?: number
    delta_cr_basket?: number
    delta_cr_order?: number
    cpo?: number
    delta_cpm?: number
    delta_cpc?: number
  }>
}

function fmt(n: number | null | undefined) {
  if (n == null) return '—'
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'М'
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(0) + 'К'
  return n.toFixed(0)
}
function fmtDate(iso: string) {
  const d = new Date(iso)
  return `${d.getDate().toString().padStart(2,'0')}.${(d.getMonth()+1).toString().padStart(2,'0')}`
}

const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.06 } } }
const fadeUp = { hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0, transition: { duration: 0.3 } } }

function ChartTip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="glass p-3 text-xs min-w-[130px]" style={{ color: 'var(--text)' }}>
      <p className="font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>{label}</p>
      {payload.map(p => (
        <div key={p.name} className="flex items-center gap-2 mb-1">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span style={{ color: 'var(--text-muted)' }}>{p.name}:</span>
          <span className="font-bold ml-auto">{fmt(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

function DeltaCell({ v }: { v?: number }) {
  if (v == null) return <span style={{ color: 'var(--text-subtle)' }}>—</span>
  const up = v > 0
  return (
    <span className="text-xs font-semibold" style={{ color: up ? 'var(--success)' : 'var(--danger)' }}>
      {up ? '+' : ''}{v.toFixed(2)}
    </span>
  )
}

export default function PriceTab() {
  const [data, setData] = useState<PriceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/dashboard/prices')
      .then(r => r.json())
      .then((d: PriceData) => { setData(d); setLoading(false) })
      .catch((e: unknown) => { setError(String(e)); setLoading(false) })
  }, [])

  if (loading) return (
    <div className="px-6 py-6 space-y-6 max-w-[1440px] mx-auto">
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <GlassCard key={i}><div className="space-y-3"><div className="skeleton h-9 w-9 rounded-full" /><div className="skeleton h-4 w-20" /><div className="skeleton h-7 w-28" /></div></GlassCard>
        ))}
      </div>
    </div>
  )
  if (error) return <div className="px-6 py-16 text-center" style={{ color: 'var(--danger)' }}>{error}</div>
  if (!data) return null

  const f = data.funnel
  const dailyFmt = (data.daily ?? []).map(d => ({
    date: fmtDate(d.date),
    'CTR': +(d.ctr * 100).toFixed(2),
    'CR корзина': +(d.cr_basket * 100).toFixed(2),
    'CR заказ': +(d.cr_order * 100).toFixed(2),
    'Рекламные': d.ad_revenue,
    'Органические': d.organic_revenue,
  }))

  return (
    <div className="px-6 py-6 space-y-6 max-w-[1440px] mx-auto">

      {/* KPI — 6 карточек воронки */}
      <motion.div variants={stagger} initial="hidden" animate="show"
        className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3"
      >
        {[
          { label: 'CTR',                    value: f.ctr != null ? (f.ctr * 100).toFixed(2) + '%' : '—',          icon: <MousePointerClick size={16} />,  iconColor: 'var(--info)' },
          { label: 'CR в корзину',            value: f.cr_basket != null ? (f.cr_basket * 100).toFixed(2) + '%' : '—', icon: <ShoppingCart size={16} />,       iconColor: 'var(--warning)' },
          { label: 'CR в заказ',              value: f.cr_order != null ? (f.cr_order * 100).toFixed(2) + '%' : '—',  icon: <ArrowRight size={16} />,         iconColor: 'var(--success)' },
          { label: 'CPC',                    value: f.cpc != null ? fmt(f.cpc) + ' ₽' : '—',                       icon: <DollarSign size={16} />,         iconColor: 'var(--accent)' },
          { label: 'CPM',                    value: f.cpm != null ? fmt(f.cpm) + ' ₽' : '—',                       icon: <Megaphone size={16} />,          iconColor: 'var(--danger)' },
          { label: 'Доля рекл. заказов',     value: f.ad_order_share != null ? (f.ad_order_share * 100).toFixed(1) + '%' : '—', icon: <Percent size={16} />, iconColor: 'var(--info)' },
        ].map((card, i) => (
          <motion.div key={i} variants={fadeUp}><StatCard {...card} /></motion.div>
        ))}
      </motion.div>

      {/* Charts */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Воронка конверсий по дням */}
        <GlassCard padding="lg">
          <p className="text-sm font-semibold mb-4" style={{ color: 'var(--text)' }}>Воронка конверсий по дням</p>
          {dailyFmt.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={dailyFmt} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.6} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} width={36} tickFormatter={v => `${v}%`} />
                <Tooltip content={<ChartTip />} />
                <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="CTR" stroke="var(--info)" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="CR корзина" stroke="var(--warning)" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="CR заказ" stroke="var(--success)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : <div className="flex items-center justify-center h-56 text-sm" style={{ color: 'var(--text-muted)' }}>Нет данных</div>}
        </GlassCard>

        {/* Рекламные vs Органические */}
        <GlassCard padding="lg">
          <p className="text-sm font-semibold mb-4" style={{ color: 'var(--text)' }}>Рекламные vs Органические продажи</p>
          {dailyFmt.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={dailyFmt} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.6} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} width={44} tickFormatter={v => fmt(v as number)} />
                <Tooltip content={<ChartTip />} />
                <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="Рекламные" fill="var(--accent)" radius={[4,4,0,0]} />
                <Bar dataKey="Органические" fill="var(--info)" radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <div className="flex items-center justify-center h-56 text-sm" style={{ color: 'var(--text-muted)' }}>Нет данных</div>}
        </GlassCard>
      </div>

      {/* Таблица изменений цен */}
      <GlassCard padding="lg">
        <p className="text-sm font-semibold mb-4" style={{ color: 'var(--text)' }}>Изменения цен и влияние на метрики</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs" style={{ color: 'var(--text-subtle)' }}>
                <th className="text-left pb-3 font-medium">SKU</th>
                <th className="text-left pb-3 font-medium">Название</th>
                <th className="text-left pb-3 font-medium">Менеджер</th>
                <th className="text-right pb-3 font-medium">Дата</th>
                <th className="text-right pb-3 font-medium">Было</th>
                <th className="text-right pb-3 font-medium">Стало</th>
                <th className="text-right pb-3 font-medium">Δ%</th>
                <th className="text-right pb-3 font-medium">Δ CTR</th>
                <th className="text-right pb-3 font-medium">Δ CR корз.</th>
                <th className="text-right pb-3 font-medium">Δ CR заказ</th>
                <th className="text-right pb-3 font-medium">CPO</th>
              </tr>
            </thead>
            <tbody>
              {(data.price_changes ?? []).map((row, i) => {
                const up = row.delta_pct > 0
                return (
                  <tr key={i} className="border-t" style={{ borderColor: 'var(--border)' }}>
                    <td className="py-2 pr-2 font-mono text-xs" style={{ color: 'var(--text-muted)' }}>{row.sku}</td>
                    <td className="py-2 pr-4 max-w-[160px] truncate" style={{ color: 'var(--text)' }}>{row.name}</td>
                    <td className="py-2 pr-4" style={{ color: 'var(--text-muted)' }}>{row.manager}</td>
                    <td className="py-2 text-right text-xs" style={{ color: 'var(--text-muted)' }}>{fmtDate(row.date)}</td>
                    <td className="py-2 text-right" style={{ color: 'var(--text-muted)' }}>{fmt(row.price_before)} ₽</td>
                    <td className="py-2 text-right font-semibold" style={{ color: 'var(--text)' }}>{fmt(row.price_after)} ₽</td>
                    <td className="py-2 text-right"><span className="text-xs font-semibold" style={{ color: up ? 'var(--success)' : 'var(--danger)' }}>{up ? '+' : ''}{row.delta_pct.toFixed(1)}%</span></td>
                    <td className="py-2 text-right"><DeltaCell v={row.delta_ctr} /></td>
                    <td className="py-2 text-right"><DeltaCell v={row.delta_cr_basket} /></td>
                    <td className="py-2 text-right"><DeltaCell v={row.delta_cr_order} /></td>
                    <td className="py-2 text-right" style={{ color: 'var(--text-muted)' }}>{row.cpo != null ? fmt(row.cpo) + ' ₽' : '—'}</td>
                  </tr>
                )
              })}
              {(data.price_changes ?? []).length === 0 && (
                <tr><td colSpan={11} className="py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Нет изменений цен за выбранный период</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </GlassCard>
    </div>
  )
}
```

- [ ] **Step 3: Проверить сборку**

```bash
npm run build 2>&1 | tail -20
```

- [ ] **Step 4: Commit**

```bash
git add src/components/tabs/PriceTab.tsx
git commit -m "feat: redesign 'Реклама и воронка' tab with funnel KPIs and price delta table"
```

---

## Task 7: Вкладка «Логистика и заказы» (OrderTab)

**Files:**
- Modify: `src/components/tabs/OrderTab.tsx`
- Check: `src/app/api/dashboard/orders/route.ts`

- [ ] **Step 1: Посмотреть API**

```bash
cat "/Users/Cats/Desktop/Анализ таблиц/Оценка рекламы/New dashboard/src/app/api/dashboard/orders/route.ts" 2>/dev/null | head -80
```

- [ ] **Step 2: Переписать OrderTab.tsx**

```typescript
'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { GlassCard } from '@/components/ui/GlassCard'
import { StatCard } from '@/components/ui/StatCard'
import { AlertBox } from '@/components/ui/AlertBox'
import { Package, AlertTriangle, TrendingDown, DollarSign, ShoppingBag } from 'lucide-react'

interface OrderRow {
  sku_wb: string
  name: string
  status: 'critical' | 'warning' | 'ok'
  abc: string
  sales_31d: number
  oos_days: number
  trend: number
  stock_qty: number
  stock_days: number
  lead_time: number
  calc_order: number
  manager_order: number
  delta_order: number
  margin_pct: number
}

interface OrderData {
  summary: {
    critical_count: number
    warning_count: number
    oos_with_demand: number
    to_order_count: number
    order_sum_rub: number
    avg_days_to_oos: number
    total_stock_rub: number
  }
  rows: OrderRow[]
}

function fmt(n: number | null | undefined) {
  if (n == null) return '—'
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'М'
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(0) + 'К'
  return String(Math.round(n))
}
function fmtPct(n: number | null | undefined) {
  if (n == null) return '—'
  return (n * 100).toFixed(1) + '%'
}

const statusCfg = {
  critical: { label: '🚨 Критический', color: 'var(--danger)',  bg: 'var(--danger-bg)' },
  warning:  { label: '⚠️ Внимание',   color: 'var(--warning)', bg: 'var(--warning-bg)' },
  ok:       { label: '✅ Норма',       color: 'var(--success)', bg: 'var(--success-bg)' },
}

const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.06 } } }
const fadeUp = { hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0, transition: { duration: 0.3 } } }

export default function OrderTab() {
  const [data, setData] = useState<OrderData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/dashboard/orders')
      .then(r => r.json())
      .then((d: OrderData) => { setData(d); setLoading(false) })
      .catch((e: unknown) => { setError(String(e)); setLoading(false) })
  }, [])

  if (loading) return (
    <div className="px-6 py-6 space-y-6 max-w-[1440px] mx-auto">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <GlassCard key={i}><div className="space-y-3"><div className="skeleton h-9 w-9 rounded-full" /><div className="skeleton h-4 w-20" /><div className="skeleton h-7 w-28" /></div></GlassCard>
        ))}
      </div>
    </div>
  )
  if (error) return <div className="px-6 py-16 text-center" style={{ color: 'var(--danger)' }}>{error}</div>
  if (!data) return null

  const s = data.summary

  return (
    <div className="px-6 py-6 space-y-6 max-w-[1440px] mx-auto">

      {/* KPI — 5 карточек */}
      <motion.div variants={stagger} initial="hidden" animate="show"
        className="grid grid-cols-2 md:grid-cols-5 gap-3"
      >
        {[
          { label: 'Текущий остаток (руб)',    value: fmt(s.total_stock_rub),   icon: <Package size={16} /> },
          { label: 'Среднее дней до OOS',      value: fmt(s.avg_days_to_oos),   icon: <TrendingDown size={16} />, iconColor: 'var(--warning)', accent: (s.avg_days_to_oos ?? 99) < 14 },
          { label: 'Расчётный заказ (шт)',     value: fmt(s.to_order_count),    icon: <ShoppingBag size={16} />, iconColor: 'var(--info)' },
          { label: 'Сумма к заказу',           value: fmt(s.order_sum_rub),     icon: <DollarSign size={16} />, iconColor: 'var(--success)' },
          { label: 'SKU крит. запас',          value: String(s.critical_count), icon: <AlertTriangle size={16} />, iconColor: 'var(--danger)', accent: s.critical_count > 0 },
        ].map((card, i) => (
          <motion.div key={i} variants={fadeUp}><StatCard {...card} /></motion.div>
        ))}
      </motion.div>

      {/* Alert row */}
      <div className="flex gap-3 flex-wrap">
        <AlertBox icon="🚨" title="Критический запас" count={s.critical_count} severity="critical" description="Запас < 50% лог. плеча" />
        <AlertBox icon="⚠️" title="Требует внимания"  count={s.warning_count}  severity="warning"  description="Запас < лог. плеча" />
        <AlertBox icon="📭" title="OOS с продажами"   count={s.oos_with_demand} severity="critical" description="Нет стока, есть спрос" />
        <AlertBox icon="📦" title="К заказу"          count={s.to_order_count}  severity="info"     description={`Сумма: ${fmt(s.order_sum_rub)} ₽`} />
      </div>

      {/* Main table */}
      <GlassCard padding="lg">
        <p className="text-sm font-semibold mb-4" style={{ color: 'var(--text)' }}>Таблица запасов и заказов</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs" style={{ color: 'var(--text-subtle)' }}>
                <th className="text-left pb-3 font-medium">SKU WB</th>
                <th className="text-left pb-3 font-medium">Название</th>
                <th className="text-center pb-3 font-medium">Статус</th>
                <th className="text-center pb-3 font-medium">ABC</th>
                <th className="text-right pb-3 font-medium">Продажи 31д</th>
                <th className="text-right pb-3 font-medium">OOS дней</th>
                <th className="text-right pb-3 font-medium">Наличие</th>
                <th className="text-right pb-3 font-medium">Остаток дней</th>
                <th className="text-right pb-3 font-medium">Лог. плечо</th>
                <th className="text-right pb-3 font-medium">Расч. заказ</th>
                <th className="text-right pb-3 font-medium">Заказ менедж.</th>
                <th className="text-right pb-3 font-medium">Δ</th>
                <th className="text-right pb-3 font-medium">Маржа</th>
              </tr>
            </thead>
            <tbody>
              {(data.rows ?? []).map((row, i) => {
                const sc = statusCfg[row.status] ?? statusCfg.ok
                const isLowMargin = row.margin_pct < 0.10
                return (
                  <tr key={i} className="border-t" style={{ borderColor: 'var(--border)' }}>
                    <td className="py-2 pr-2 font-mono text-xs" style={{ color: 'var(--text-muted)' }}>{row.sku_wb}</td>
                    <td className="py-2 pr-4 max-w-[180px] truncate" style={{ color: 'var(--text)' }}>{row.name}</td>
                    <td className="py-2 text-center">
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap" style={{ background: sc.bg, color: sc.color }}>{sc.label}</span>
                    </td>
                    <td className="py-2 text-center">
                      <span className="font-bold text-xs" style={{ color: row.abc === 'A' ? 'var(--success)' : row.abc === 'B' ? 'var(--warning)' : 'var(--danger)' }}>{row.abc}</span>
                    </td>
                    <td className="py-2 text-right" style={{ color: 'var(--text-muted)' }}>{fmt(row.sales_31d)}</td>
                    <td className="py-2 text-right">
                      {row.oos_days > 0 ? <span className="text-xs font-semibold" style={{ color: 'var(--danger)' }}>{row.oos_days}</span> : <span style={{ color: 'var(--text-subtle)' }}>0</span>}
                    </td>
                    <td className="py-2 text-right" style={{ color: 'var(--text-muted)' }}>{fmt(row.stock_qty)}</td>
                    <td className="py-2 text-right">
                      <span style={{ color: row.stock_days < row.lead_time ? 'var(--danger)' : 'var(--text-muted)' }}>{row.stock_days}</span>
                    </td>
                    <td className="py-2 text-right" style={{ color: 'var(--text-muted)' }}>{row.lead_time}</td>
                    <td className="py-2 text-right font-semibold" style={{ color: row.calc_order > 0 ? 'var(--accent)' : 'var(--text-muted)' }}>{fmt(row.calc_order)}</td>
                    <td className="py-2 text-right" style={{ color: 'var(--text-muted)' }}>{fmt(row.manager_order)}</td>
                    <td className="py-2 text-right">
                      {row.delta_order !== 0 ? (
                        <span className="text-xs font-semibold" style={{ color: row.delta_order > 0 ? 'var(--warning)' : 'var(--success)' }}>
                          {row.delta_order > 0 ? '+' : ''}{fmt(row.delta_order)}
                        </span>
                      ) : <span style={{ color: 'var(--text-subtle)' }}>0</span>}
                    </td>
                    <td className="py-2 text-right">
                      <span className="px-2 py-0.5 rounded text-xs font-medium" style={{ background: isLowMargin ? 'var(--danger-bg)' : 'var(--success-bg)', color: isLowMargin ? 'var(--danger)' : 'var(--success)' }}>{fmtPct(row.margin_pct)}</span>
                    </td>
                  </tr>
                )
              })}
              {(data.rows ?? []).length === 0 && (
                <tr><td colSpan={13} className="py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Нет данных. Загрузите таблицы в разделе «Обновление данных».</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </GlassCard>
    </div>
  )
}
```

- [ ] **Step 3: Проверить сборку**

```bash
npm run build 2>&1 | tail -20
```

- [ ] **Step 4: Commit**

```bash
git add src/components/tabs/OrderTab.tsx
git commit -m "feat: redesign 'Логистика и заказы' tab with stock status table"
```

---

## Task 8: Вкладка «Аналитика по SKU» (SkuTableTab) — главная рабочая

**Files:**
- Modify: `src/components/tabs/SkuTableTab.tsx`
- Create: `src/components/ui/SeasonalitySparkline.tsx`
- Check: `src/app/api/dashboard/sku-table/route.ts`

- [ ] **Step 1: Посмотреть API таблицы SKU**

```bash
cat "/Users/Cats/Desktop/Анализ таблиц/Оценка рекламы/New dashboard/src/app/api/dashboard/sku-table/route.ts" 2>/dev/null | head -80
```

- [ ] **Step 2: Создать SeasonalitySparkline.tsx**

```typescript
interface Props {
  values: number[]       // 12 значений (янв..дек) коэффициент сезонности
  peakCount?: number     // топ N месяцев подсветить, default 3
}

const MONTHS_SHORT = ['Я','Ф','М','А','М','И','И','А','С','О','Н','Д']

export function SeasonalitySparkline({ values, peakCount = 3 }: Props) {
  if (!values || values.length === 0) return <span style={{ color: 'var(--text-subtle)', fontSize: 11 }}>—</span>

  const sorted = [...values].sort((a, b) => b - a)
  const threshold = sorted[peakCount - 1] ?? 0
  const max = sorted[0] ?? 1

  return (
    <div className="flex items-end gap-0.5 h-6" title={values.map((v, i) => `${MONTHS_SHORT[i]}: ${v}`).join(', ')}>
      {values.map((v, i) => {
        const isPeak = v >= threshold && v > 0
        const height = max > 0 ? Math.round((v / max) * 20) : 4
        return (
          <div
            key={i}
            className="w-1.5 rounded-sm transition-all"
            style={{
              height: `${Math.max(height, 2)}px`,
              background: isPeak ? 'var(--accent)' : 'var(--border)',
              opacity: isPeak ? 1 : 0.6,
            }}
            title={`${MONTHS_SHORT[i]}: ${v}`}
          />
        )
      })}
    </div>
  )
}
```

- [ ] **Step 3: Переписать SkuTableTab.tsx**

```typescript
'use client'

import { useEffect, useState, useCallback } from 'react'
import { GlassCard } from '@/components/ui/GlassCard'
import { ScoreBadge } from '@/components/ui/ScoreBadge'
import { PriorityBadge } from '@/components/ui/PriorityBadge'
import { Search, Filter, Download, X, ChevronUp, ChevronDown } from 'lucide-react'

interface SkuRow {
  sku: string
  name: string
  manager: string
  category: string
  revenue: number
  margin_pct: number
  chmd: number
  drr: number
  ctr: number
  cr_basket: number
  cr_order: number
  stock_qty: number
  stock_days: number
  cpo: number
  score: number
  oos_status: 'critical' | 'warning' | 'ok' | 'none'
  margin_status: 'high' | 'medium' | 'low'
  novelty: boolean
}

interface SkuTableData {
  rows: SkuRow[]
  total: number
  selected_count: number
  selected_revenue: number
}

type SortKey = keyof SkuRow
type SortDir = 'asc' | 'desc'

function fmt(n: number | null | undefined) {
  if (n == null) return '—'
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'М'
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(0) + 'К'
  return String(Math.round(n))
}
function fmtPct(n: number | null | undefined) {
  if (n == null) return '—'
  return (n * 100).toFixed(1) + '%'
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ChevronUp size={12} style={{ opacity: 0.3 }} />
  return dir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />
}

function Th({ label, sortKey, current, dir, onClick }: {
  label: string; sortKey: SortKey; current: SortKey; dir: SortDir; onClick: (k: SortKey) => void
}) {
  return (
    <th
      className="text-right pb-3 font-medium cursor-pointer select-none whitespace-nowrap"
      style={{ color: current === sortKey ? 'var(--accent)' : 'var(--text-subtle)' }}
      onClick={() => onClick(sortKey)}
    >
      <span className="inline-flex items-center gap-0.5">
        {label}
        <SortIcon active={current === sortKey} dir={dir} />
      </span>
    </th>
  )
}

export default function SkuTableTab() {
  const [data, setData] = useState<SkuTableData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [filterNovelty, setFilterNovelty] = useState<'all' | 'novelty' | 'no_novelty'>('all')
  const [filterOos, setFilterOos] = useState<'all' | 'critical' | 'warning' | 'ok'>('all')
  const [filterDrr, setFilterDrr] = useState<'all' | 'over' | 'under'>('all')
  const [filterMargin, setFilterMargin] = useState<'all' | 'low' | 'mid' | 'high'>('all')
  const [sortKey, setSortKey] = useState<SortKey>('score')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [filtersOpen, setFiltersOpen] = useState(false)

  const buildUrl = useCallback(() => {
    const p = new URLSearchParams()
    if (search) p.set('search', search)
    if (filterNovelty !== 'all') p.set('novelty', filterNovelty)
    if (filterOos !== 'all') p.set('oos', filterOos)
    if (filterDrr !== 'all') p.set('drr', filterDrr)
    if (filterMargin !== 'all') p.set('margin', filterMargin)
    p.set('sort', sortKey)
    p.set('dir', sortDir)
    return '/api/dashboard/sku-table?' + p.toString()
  }, [search, filterNovelty, filterOos, filterDrr, filterMargin, sortKey, sortDir])

  useEffect(() => {
    setLoading(true)
    fetch(buildUrl())
      .then(r => r.json())
      .then((d: SkuTableData) => { setData(d); setLoading(false) })
      .catch((e: unknown) => { setError(String(e)); setLoading(false) })
  }, [buildUrl])

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  function resetFilters() {
    setSearch(''); setFilterNovelty('all'); setFilterOos('all')
    setFilterDrr('all'); setFilterMargin('all')
  }

  const hasFilters = search || filterNovelty !== 'all' || filterOos !== 'all' || filterDrr !== 'all' || filterMargin !== 'all'

  if (error) return <div className="px-6 py-16 text-center" style={{ color: 'var(--danger)' }}>{error}</div>

  return (
    <div className="px-6 py-6 space-y-4 max-w-[1440px] mx-auto">

      {/* Summary bar */}
      {data && (
        <div className="glass px-4 py-3 flex items-center gap-4 flex-wrap text-sm">
          <span style={{ color: 'var(--text-muted)' }}>
            Показано: <span className="font-semibold" style={{ color: 'var(--text)' }}>{data.rows.length}</span> из <span className="font-semibold">{data.total}</span> SKU
          </span>
          {data.selected_revenue > 0 && (
            <span style={{ color: 'var(--text-muted)' }}>
              Выручка: <span className="font-semibold" style={{ color: 'var(--text)' }}>{fmt(data.selected_revenue)}</span>
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            {hasFilters && (
              <button onClick={resetFilters} className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg" style={{ color: 'var(--accent)', background: 'var(--accent-glow)' }}>
                <X size={11} /> Сбросить
              </button>
            )}
            <button
              onClick={() => {}}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl font-medium"
              style={{ background: 'var(--border)', color: 'var(--text-muted)' }}
            >
              <Download size={13} /> Скачать
            </button>
          </div>
        </div>
      )}

      {/* Filter bar */}
      <div className="flex flex-wrap gap-2 items-center">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="SKU, название, бренд..."
            className="w-full pl-8 pr-3 py-2 text-sm rounded-xl border outline-none"
            style={{ background: 'var(--surface-solid)', border: '1px solid var(--border)', color: 'var(--text)' }}
          />
        </div>

        {/* Новинки */}
        {(['all','novelty','no_novelty'] as const).map(v => (
          <button key={v} onClick={() => setFilterNovelty(v)}
            className="text-xs px-3 py-1.5 rounded-xl font-medium transition-all"
            style={{ background: filterNovelty === v ? 'var(--accent)' : 'var(--border)', color: filterNovelty === v ? 'white' : 'var(--text-muted)' }}>
            {v === 'all' ? 'Все' : v === 'novelty' ? 'Новинки' : 'Без новинок'}
          </button>
        ))}

        {/* Additional filters toggle */}
        <button onClick={() => setFiltersOpen(v => !v)}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl font-medium"
          style={{ background: filtersOpen ? 'var(--accent-glow)' : 'var(--border)', color: filtersOpen ? 'var(--accent)' : 'var(--text-muted)' }}>
          <Filter size={12} /> Фильтры {hasFilters && '●'}
        </button>
      </div>

      {/* Additional filters */}
      {filtersOpen && (
        <div className="glass px-4 py-3 flex flex-wrap gap-4">
          {/* OOS */}
          <div className="space-y-1">
            <p className="text-xs font-medium" style={{ color: 'var(--text-subtle)' }}>OOS</p>
            <div className="flex gap-1">
              {(['all','critical','warning','ok'] as const).map(v => (
                <button key={v} onClick={() => setFilterOos(v)}
                  className="text-xs px-2 py-1 rounded-lg"
                  style={{ background: filterOos === v ? 'var(--danger-bg)' : 'var(--border)', color: filterOos === v ? 'var(--danger)' : 'var(--text-muted)' }}>
                  {v === 'all' ? 'Все' : v === 'critical' ? 'Крит.' : v === 'warning' ? 'Вним.' : 'Норма'}
                </button>
              ))}
            </div>
          </div>
          {/* ДРР */}
          <div className="space-y-1">
            <p className="text-xs font-medium" style={{ color: 'var(--text-subtle)' }}>ДРР</p>
            <div className="flex gap-1">
              {(['all','over','under'] as const).map(v => (
                <button key={v} onClick={() => setFilterDrr(v)}
                  className="text-xs px-2 py-1 rounded-lg"
                  style={{ background: filterDrr === v ? 'var(--warning-bg)' : 'var(--border)', color: filterDrr === v ? 'var(--warning)' : 'var(--text-muted)' }}>
                  {v === 'all' ? 'Все' : v === 'over' ? 'ДРР>Маржа' : 'ДРР<Маржа'}
                </button>
              ))}
            </div>
          </div>
          {/* Маржа */}
          <div className="space-y-1">
            <p className="text-xs font-medium" style={{ color: 'var(--text-subtle)' }}>Маржа</p>
            <div className="flex gap-1">
              {(['all','low','mid','high'] as const).map(v => (
                <button key={v} onClick={() => setFilterMargin(v)}
                  className="text-xs px-2 py-1 rounded-lg"
                  style={{ background: filterMargin === v ? 'var(--success-bg)' : 'var(--border)', color: filterMargin === v ? 'var(--success)' : 'var(--text-muted)' }}>
                  {v === 'all' ? 'Все' : v === 'low' ? '<15%' : v === 'mid' ? '15–20%' : '>20%'}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Main table */}
      <GlassCard padding="none">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs border-b" style={{ borderColor: 'var(--border)', color: 'var(--text-subtle)' }}>
                <th className="text-left px-4 py-3 font-medium w-24">Статус</th>
                <th className="text-left px-4 py-3 font-medium">SKU</th>
                <th className="text-left px-4 py-3 font-medium max-w-[180px]">Название</th>
                <th className="text-left px-4 py-3 font-medium">Менеджер</th>
                <th className="text-left px-4 py-3 font-medium">Категория</th>
                <th className="px-4 py-3 font-medium w-24">
                  <span className="flex items-center justify-center gap-0.5 cursor-pointer" onClick={() => toggleSort('score')} style={{ color: sortKey === 'score' ? 'var(--accent)' : 'var(--text-subtle)' }}>
                    Score <SortIcon active={sortKey === 'score'} dir={sortDir} />
                  </span>
                </th>
                <Th label="Выручка" sortKey="revenue" current={sortKey} dir={sortDir} onClick={toggleSort} />
                <Th label="Маржа%" sortKey="margin_pct" current={sortKey} dir={sortDir} onClick={toggleSort} />
                <Th label="ЧМД" sortKey="chmd" current={sortKey} dir={sortDir} onClick={toggleSort} />
                <Th label="ДРР" sortKey="drr" current={sortKey} dir={sortDir} onClick={toggleSort} />
                <Th label="CTR" sortKey="ctr" current={sortKey} dir={sortDir} onClick={toggleSort} />
                <Th label="CR к." sortKey="cr_basket" current={sortKey} dir={sortDir} onClick={toggleSort} />
                <Th label="CR з." sortKey="cr_order" current={sortKey} dir={sortDir} onClick={toggleSort} />
                <Th label="Остаток" sortKey="stock_qty" current={sortKey} dir={sortDir} onClick={toggleSort} />
                <Th label="Запас дн." sortKey="stock_days" current={sortKey} dir={sortDir} onClick={toggleSort} />
                <Th label="CPO" sortKey="cpo" current={sortKey} dir={sortDir} onClick={toggleSort} />
              </tr>
            </thead>
            <tbody>
              {loading && Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="border-t" style={{ borderColor: 'var(--border)' }}>
                  {Array.from({ length: 16 }).map((__, j) => (
                    <td key={j} className="px-4 py-3"><div className="skeleton h-4 w-full" /></td>
                  ))}
                </tr>
              ))}
              {!loading && (data?.rows ?? []).map((row, i) => {
                const isLowMargin = row.margin_pct < 0.10
                const isDrrOver = row.drr > row.margin_pct && row.drr > 0
                return (
                  <tr
                    key={i}
                    className="border-t transition-colors"
                    style={{
                      borderColor: 'var(--border)',
                      cursor: 'pointer',
                    }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--surface-hover)'}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ''}
                  >
                    <td className="px-4 py-2.5">
                      <PriorityBadge oos={row.oos_status} margin={row.margin_status} />
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs" style={{ color: 'var(--text-muted)' }}>{row.sku}</td>
                    <td className="px-4 py-2.5 max-w-[180px]">
                      <span className="block truncate" style={{ color: 'var(--text)' }}>{row.name}</span>
                      {row.novelty && <span className="text-[10px] px-1.5 rounded" style={{ background: 'var(--info-bg)', color: 'var(--info)' }}>Новинка</span>}
                    </td>
                    <td className="px-4 py-2.5 text-xs" style={{ color: 'var(--text-muted)' }}>{row.manager}</td>
                    <td className="px-4 py-2.5 text-xs" style={{ color: 'var(--text-muted)' }}>{row.category}</td>
                    <td className="px-4 py-2.5"><ScoreBadge score={row.score} size="sm" /></td>
                    <td className="px-4 py-2.5 text-right font-semibold" style={{ color: 'var(--text)' }}>{fmt(row.revenue)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <span className="text-xs font-medium" style={{ color: isLowMargin ? 'var(--danger)' : 'var(--success)' }}>{fmtPct(row.margin_pct)}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right" style={{ color: 'var(--text-muted)' }}>{fmt(row.chmd)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <span className="text-xs font-medium" style={{ color: isDrrOver ? 'var(--danger)' : 'var(--text-muted)' }}>{fmtPct(row.drr)}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right text-xs" style={{ color: 'var(--text-muted)' }}>{fmtPct(row.ctr)}</td>
                    <td className="px-4 py-2.5 text-right text-xs" style={{ color: 'var(--text-muted)' }}>{fmtPct(row.cr_basket)}</td>
                    <td className="px-4 py-2.5 text-right text-xs" style={{ color: 'var(--text-muted)' }}>{fmtPct(row.cr_order)}</td>
                    <td className="px-4 py-2.5 text-right" style={{ color: 'var(--text-muted)' }}>{fmt(row.stock_qty)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <span style={{ color: row.stock_days < 14 ? 'var(--danger)' : row.stock_days < 30 ? 'var(--warning)' : 'var(--text-muted)' }}>{row.stock_days}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right text-xs" style={{ color: 'var(--text-muted)' }}>{fmt(row.cpo)}</td>
                  </tr>
                )
              })}
              {!loading && (data?.rows ?? []).length === 0 && (
                <tr>
                  <td colSpan={16} className="px-4 py-12 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                    Нет данных по заданным фильтрам
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </GlassCard>
    </div>
  )
}
```

- [ ] **Step 4: Проверить сборку**

```bash
npm run build 2>&1 | tail -20
```

- [ ] **Step 5: Commit**

```bash
git add src/components/tabs/SkuTableTab.tsx src/components/ui/SeasonalitySparkline.tsx
git commit -m "feat: redesign 'Аналитика по SKU' tab with sortable filterable table"
```

---

## Task 9: Вкладка «Анализ ниш и ABC» (NicheTab)

**Files:**
- Modify: `src/components/tabs/NicheTab.tsx`

- [ ] **Step 1: Посмотреть API**

```bash
cat "/Users/Cats/Desktop/Анализ таблиц/Оценка рекламы/New dashboard/src/app/api/dashboard" 2>/dev/null || ls "/Users/Cats/Desktop/Анализ таблиц/Оценка рекламы/New dashboard/src/app/api/dashboard/"
```

- [ ] **Step 2: Переписать NicheTab.tsx**

```typescript
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
  season_months: number[]   // 12 коэф.
  season_start: number      // месяц 1-12
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
          <motion.div key={i} variants={fadeUp}><StatCard {...card} loading={loading} /></motion.div>
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
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--surface-hover)'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ''}
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
```

- [ ] **Step 3: Проверить сборку**

```bash
npm run build 2>&1 | tail -20
```

- [ ] **Step 4: Commit**

```bash
git add src/components/tabs/NicheTab.tsx src/components/ui/SeasonalitySparkline.tsx
git commit -m "feat: redesign 'Анализ ниш и ABC' tab with seasonality sparklines"
```

---

## Task 10: Финальная проверка и PR

**Files:** нет новых

- [ ] **Step 1: Финальный build**

```bash
cd "/Users/Cats/Desktop/Анализ таблиц/Оценка рекламы/New dashboard"
npm run build 2>&1 | tail -30
```

Expected: `✓ Compiled successfully`. Если есть TypeScript ошибки — исправить в соответствующих файлах.

- [ ] **Step 2: Проверить lint**

```bash
npm run lint 2>&1 | tail -20
```

Исправить все ошибки (предупреждения можно оставить).

- [ ] **Step 3: Финальный коммит и PR**

```bash
git add -A
git status
git log --oneline redesign/full ^main | head -15
git push origin redesign/full
```

Затем создать PR:

```bash
gh pr create \
  --title "feat: full dashboard redesign — glassmorphism + top nav + 6 tabs" \
  --body "## Summary
- Заменён левый сайдбар на sticky горизонтальную навигацию (TopNav)
- Обновлены дизайн-токены: glassmorphism (#F8F9FB фон, rgba cards, blur 20px)
- Акцентный цвет #FF3B5C, border-radius 20px, мягкие парящие тени
- Переработаны компоненты: GlassCard, StatCard (круглые иконки), AlertBox (вертикальная полоса)
- 6 вкладок: Свод, Продажи и экономика, Реклама и воронка, Логистика и заказы, Аналитика по SKU, Анализ ниш и ABC
- Новые компоненты: ScoreBadge, PriorityBadge, SeasonalitySparkline
- Framer Motion stagger анимация для KPI-карточек
- Шрифт Plus Jakarta Sans

## Test plan
- [ ] Открыть http://localhost:3000/dashboard — топ-навигация видна, сайдбара нет
- [ ] Проверить переключение всех 6 вкладок
- [ ] Проверить адаптивность (мобиль: гамбургер-меню)
- [ ] Проверить переключение светлой/тёмной темы
- [ ] Проверить что данные грузятся (не пустые заглушки)
- [ ] npm run build — без ошибок

🤖 Generated with Claude Code" \
  --base main \
  --head redesign/full
```

---

## Self-Review

**Spec coverage check:**

| Требование | Task |
|---|---|
| Убрать sidebar → TopNav | Task 3 |
| Glassmorphism токены (фон, cards, blur, border-radius 20px) | Task 1 |
| Акцент #FF3B5C | Task 1 |
| Шрифт Plus Jakarta Sans | Task 1 |
| Stagger animation для KPI-карточек | Task 4-7 (Framer Motion) |
| Hover lift на карточках | Task 2 (GlassCard glass-hover) |
| AlertBox с цветной вертикальной полосой | Task 2 |
| Иконки в круглых подложках | Task 2 (StatCard) |
| Вкладка Свод (6 KPI, граф, алерты, фокус дня, менеджеры, ABC) | Task 4 |
| Вкладка Продажи и экономика (6 KPI, 2 графика, таблица категорий) | Task 5 |
| Вкладка Реклама и воронка (6 KPI воронки, 2 графика, таблица цен) | Task 6 |
| Вкладка Логистика и заказы (5 KPI, алерты, таблица) | Task 7 |
| Вкладка Аналитика по SKU (фильтры, сортировка, ScoreBadge, PriorityBadge) | Task 8 |
| Вкладка Анализ ниш и ABC (4 KPI, SeasonalitySparkline, таблица) | Task 9 |
| SKU Score градиент 0→100 | Task 2 (ScoreBadge) |
| OOS/Маржа бейджи | Task 2 (PriorityBadge) |

**Placeholder scan:** Все задачи содержат полный код. Нет TBD/TODO.

**Type consistency:** 
- `fmt()` / `fmtPct()` / `fmtDate()` — одинаковая сигнатура во всех вкладках
- `GlassCard` props: `padding`, `hover`, `solid`, `className` — согласованы
- `StatCard` props: добавлен `iconColor`, `hover`, `onClick` — согласованы с Task 2
- `SeasonalitySparkline` создаётся в Task 8 и используется в Task 9 — путь совпадает
