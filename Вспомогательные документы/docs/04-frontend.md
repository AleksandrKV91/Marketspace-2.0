# Frontend — Архитектура и компоненты

## Стек

- Next.js 16 (App Router + Turbopack)
- TypeScript
- Tailwind CSS 4
- Framer Motion — анимации
- Zustand — глобальный стейт
- Recharts — графики
- Lucide React — иконки
- React Hook Form + Zod — формы
- react-window — виртуализация таблиц

---

## Дизайн-система

### Цвета (CSS variables в globals.css)

```css
:root {
  --bg: #FFFFFF;
  --bg-secondary: #F8F9FA;
  --surface: #FFFFFF;
  --border: #E5E7EB;
  --text: #1A1A2E;
  --text-muted: #6B7280;
  --accent: #E63946;       /* красный — основной акцент */
  --accent-hover: #CC2F3C;
  --success: #10B981;
  --warning: #F59E0B;
  --info: #3B82F6;
}

[data-theme="dark"] {
  --bg: #0D1117;
  --bg-secondary: #161B22;
  --surface: rgba(255,255,255,0.04);
  --border: rgba(255,255,255,0.08);
  --text: #E6EDF3;
  --text-muted: #8B949E;
}
```

### Шрифт

```typescript
// app/layout.tsx
import { Lato } from 'next/font/google'
const lato = Lato({ weight: ['400','700'], subsets: ['latin','cyrillic'] })
```

### Компоненты UI (src/components/ui/)

**GlassCard** — базовая карточка:
```tsx
// Светлая: bg-white border border-gray-100 shadow-sm rounded-xl p-4
// Тёмная: bg-white/4 border border-white/8 backdrop-blur-md rounded-xl p-4
```

**StatCard** — KPI карточка:
- Иконка (Lucide) + заголовок + значение + дельта (↑↓ с цветом)
- Анимация при появлении (Framer Motion)

**AlertBox** — кликабельный алерт:
- Цвет по severity (red/yellow/blue/green)
- Кликабельный → устанавливает фильтр в таблице SKU через Zustand

---

## Zustand Stores

### `dashboardStore.ts`

```typescript
interface DashboardStore {
  // Данные
  days: DayData[]           // массив дней с агрегированными метриками
  skus: SkuData[]           // SKU с последними метриками + score
  dimSkus: DimSku[]         // справочник из dim_sku

  // Состояние загрузки
  loading: boolean
  historyLoading: boolean
  loadedFrom: string        // 'YYYY-MM-DD' — до какой даты загружено
  lastError: string | null

  // Выбранный период
  dateFrom: number | null   // индекс в days[]
  dateTo: number | null

  // Действия
  loadData: (from: string, to?: string) => Promise<void>
  loadHistory: (from: string) => Promise<void>  // идемпотентна
  setDateRange: (from: number, to: number) => void
}
```

### `uiStore.ts`

```typescript
interface UIStore {
  theme: 'light' | 'dark'
  activeTab: string
  openModalSkuMs: string | null   // открытый SKU modal
  skuTableFilter: {               // фильтры таблицы SKU
    search: string
    category: string
    alertType: string | null      // null | 'oos' | 'drr' | 'low_stock' etc
    abcClass: string
    isNovelty: boolean | null
  }
  toggleTheme: () => void
  setActiveTab: (tab: string) => void
  openSku: (skuMs: string) => void
  closeSku: () => void
  setSkuFilter: (filter: Partial<UIStore['skuTableFilter']>) => void
}
// persist: theme сохраняется в localStorage
```

---

## Структура файлов

```
src/
  app/
    layout.tsx              ← шрифт, ThemeProvider, Zustand init
    dashboard/
      layout.tsx            ← Sidebar (desktop) + BottomNav (mobile)
      page.tsx              ← tab routing по activeTab из uiStore
  components/
    tabs/
      OverviewTab.tsx
      SkuTableTab.tsx
      PriceTab.tsx
      AnalyticsTab.tsx
      NicheTab.tsx
      OrderTab.tsx
      UpdateTab.tsx
    ui/
      GlassCard.tsx
      StatCard.tsx
      AlertBox.tsx
      SkuModal.tsx          ← модал SKU (используется из всех вкладок)
      OrderModal.tsx        ← расширенный модал для заказов
      Calendar.tsx
      ThemeToggle.tsx
      Sidebar.tsx
      BottomNav.tsx         ← только мобиль (2 пункта)
    charts/
      RevenueChart.tsx      ← выручка + расходы (двойная ось)
      FunnelChart.tsx       ← CTR/CR по дням
      SparklineChart.tsx    ← мини-график 7 дней
  store/
    dashboardStore.ts
    uiStore.ts
  lib/
    scoring.ts
    utils.ts
  types/
    index.ts                ← все TypeScript типы
```

---

## Вкладки

### Обзор (OverviewTab)

Блоки сверху вниз:
1. **Фильтры**: Категория | Новинки | Период (Calendar)
2. **KPI карточки** (5 штук): Выручка | ЧМД | Расходы реклама | Средняя маржа% | ДРР
3. **Алерты** (кликабельные → `setSkuFilter({ alertType })`):
   - 🚨 STOP ADS | 🚨 OOS с потерями | ⚠️ LOW STOCK | 💸 DRR>Маржа | 🚀 Потенциал
4. **Графики**: RevenueChart (двойная ось) + FunnelChart
5. **Сравнение периодов**: таблица текущий vs предыдущий + дельты
6. **По менеджерам**: таблица с выручкой (кликабельная → фильтрует SKU таблицу)

### Таблица SKU (SkuTableTab)

**Мобиль (<768px)**: карточки с мини-спарклайном
**Десктоп**: виртуализированная таблица (react-window)

Колонки: OOS | Score | SKU | Название | Менеджер | Категория | Выручка | Маржа% | ЧМД | ДРР | CTR | CR корзины | CR заказа | Остаток | Дней | CPO

### SKU Modal (SkuModal)

Открывается из любой вкладки через `uiStore.openSku(skuMs)`.

Блоки:
1. Статусы (OOS/Маржа) + базовая инфо
2. Метрики за период + сравнение
3. Воронка (CTR/CR) + CPM/CPC/CPO
4. Остатки по складам + дней до OOS
5. **Score 0-100** с расшифровкой компонентов
6. График выручки + расходов
7. Изменения цен (таблица)
8. Заметка

---

## SKU Score — `src/lib/scoring.ts`

```typescript
export function calcSkuScore(sku: SkuData): {
  score: number
  class: '🔥' | '🟢' | '⚠️' | '🟠' | '🔴'
  components: ScoreComponents
} {
  // Нормализация компонентов (0-1)
  const margin_s = clamp(sku.margin_pct / 40, 0, 1)         // 40% = максимум
  const drr_s    = clamp(1 - sku.drr_total / 100, 0, 1)     // 0% ДРР = 1.0
  const growth_s = sigmoid(sku.trend_14 ?? 0)                // тренд 14 дней
  const cr_s     = clamp(sku.cr_order / 5, 0, 1)            // 5% CR = максимум
  const stock_s  = clamp(sku.days_stock / (sku.log_pleche ?? 30), 0, 1)

  let score = Math.round(
    margin_s * 30 +
    drr_s    * 20 +
    growth_s * 15 +
    cr_s     * 15 +
    stock_s  * 20
  )

  // Штрафы
  if (sku.total_stock === 0) score -= 20
  if (sku.drr_total > (sku.margin_pct ?? 0)) score -= 15
  if (sku.is_novelty && sku.days_since_launch < 30 && (sku.revenue ?? 0) < 5000) score -= 10

  score = clamp(score, 0, 100)

  return {
    score,
    class: score >= 80 ? '🔥' : score >= 60 ? '🟢' : score >= 40 ? '⚠️' : score >= 20 ? '🟠' : '🔴',
    components: { margin_s, drr_s, growth_s, cr_s, stock_s }
  }
}
```

---

## Алерты — `src/lib/alerts.ts`

```typescript
export function calcAlerts(skus: SkuData[]): AlertSummary {
  return {
    stop_ads:    skus.filter(s => s.total_stock === 0 && s.ad_spend_5d > 0),
    oos_losses:  skus.filter(s => s.total_stock === 0 && s.dpd_7 > 0),
    low_stock:   skus.filter(s => s.days_stock > 0 && s.days_stock < (s.log_pleche ?? 30)),
    drr_over:    skus.filter(s => s.drr_total > (s.margin_pct ?? 100)),
    potential:   skus.filter(s => s.ctr > 3 && s.cr_order < 1),
  }
}
```

---

## Turbopack — критичные ограничения

```typescript
// ❌ → ✅ cast в JSX
{([...] as Type[]).map(...)}  →  const items = [...] as Type[]; return items.map(...)

// ❌ → ✅ Δ символ перед выражением
{Δ value}  →  {`Δ ${value}`}

// ❌ → ✅ деление в JSX
{a}/{b}  →  {a + '/' + b}

// ❌ → ✅ JSX комментарии между элементами — убирать

// ❌ → ✅ хуки внутри IIFE — выносить в компонент
```

---

## Мобильный UI

Адаптированы только **Обзор** и **Таблица SKU**.

```
Desktop (≥1024px): Sidebar (w-64) + полные таблицы
Mobile (<1024px):  BottomNav (2 пункта) + карточки вместо таблиц
```

**Правила**:
- Touch-цели ≥ 44px
- `font-size` в inputs ≥ 16px (иначе iOS зумирует)
- `pb-safe` = `env(safe-area-inset-bottom)` для iPhone
- Горизонтальный скролл для графиков с датами

**BottomNav** (фиксирован снизу, скрыт на lg):
```tsx
<nav className="fixed bottom-0 left-0 right-0 lg:hidden bg-surface border-t border-border
                pb-[env(safe-area-inset-bottom)]">
  <button onClick={() => setActiveTab('overview')}>Главная</button>
  <button onClick={() => setActiveTab('sku')}>Таблица SKU</button>
</nav>
```

---

## Calendar (умный)

- **Всегда активен** — не блокировать UI во время загрузки
- По умолчанию: последние 7 дней из загруженных данных
- При старте: загружаем последние 60 дней
- При выборе более раннего периода → `loadHistory(from)` → идемпотентна
- Подсветка диапазона: сравнение по ISO дате (не по label DD.MM — ломается кросс-год!)
- `loadedFrom` в Zustand — не загружать повторно

---

## Realtime уведомления

```tsx
// В layout.tsx или dashboardStore:
useEffect(() => {
  const channel = supabase
    .channel('uploads-notify')
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'uploads' },
      () => {
        // Toast: "Появились новые данные"
        // Кнопка "Обновить" → loadData(from, to)
      }
    ).subscribe()
  return () => { supabase.removeChannel(channel) }
}, [])
```
