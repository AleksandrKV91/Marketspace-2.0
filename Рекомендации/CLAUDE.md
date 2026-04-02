# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Команды разработки

```bash
npm install          # установить зависимости
npm run dev          # локальный сервер (Turbopack, http://localhost:3000)
npm run build        # production сборка (проверить перед push)
npm run lint         # ESLint
git add . && git commit -m "описание" && git push origin main  # деплой (Vercel auto)
```

**Важно**: всегда запускать `npm run build` локально перед push — Turbopack имеет ограничения (см. раздел ниже).

---

## Стек технологий

| Слой | Технология | Версия |
|---|---|---|
| Фронтенд | Next.js (App Router) + Turbopack | 16.x |
| Язык | TypeScript | 5.x |
| Стили | Tailwind CSS | 4.x |
| Анимации | Framer Motion | latest |
| Состояние | Zustand | latest |
| Графики | Recharts | latest |
| Иконки | Lucide React | latest |
| Формы | React Hook Form + Zod | latest |
| Excel | SheetJS (xlsx) | 0.18.x |
| Экспорт | xlsx (XLSX) + pptxgenjs (PPTX) | latest |
| Виртуализация | react-window | latest |
| База данных | Supabase (PostgreSQL) | — |
| Деплой | Vercel (free tier) | — |

```bash
# Установка всех зависимостей
npm install framer-motion zustand react-hook-form zod lucide-react react-window recharts xlsx pptxgenjs @supabase/supabase-js @supabase/ssr
npm install -D @types/react-window
```

---

## Инфраструктура (бесплатные тиры)

### Vercel Free Tier
- Функция (serverless): **60 сек** максимум — `export const maxDuration = 60`
- RAM функции: ~1 ГБ
- Статические файлы `/public`: до **50 МБ** суммарно
- Bandwidth: 100 ГБ/месяц
- Деплой: автоматически при `git push origin main`

### Supabase Free Tier
- БД: 500 МБ
- Строк в запросе: по умолчанию **1000** — всегда пагинировать через `fetchAll`
- `.in()` с 2800+ значениями → timeout — использовать `.limit(5000)` без фильтра по массиву
- Storage: 1 ГБ (для хранения файлов если нужно)
- Realtime: 200 одновременных соединений

---

## Архитектура проекта

```
src/
  app/
    dashboard/
      page.tsx              ← routing по вкладкам (тонкий, только layout)
      layout.tsx            ← Sidebar + BottomNav (мобиль)
    api/
      dashboard-data/       ← основные данные SKU (daily_metrics + snapshot)
      order-data/           ← данные вкладки заказов
      upload/               ← загрузка Отчёта по SKU
      update/
        stock/              ← загрузка Таблицы остатков
        abc/                ← загрузка АВС анализа
        china/              ← загрузка Потребность Китай
        catalog/            ← загрузка Свода (один раз)
  components/
    tabs/
      OverviewTab.tsx       ← Главная: KPI, алерты, графики, менеджеры
      SkuTableTab.tsx       ← Таблица SKU: Score, фильтры, виртуализация
      PriceTab.tsx          ← Изменения цен
      AnalyticsTab.tsx      ← Аналитика drill-down
      NicheTab.tsx          ← Анализ ниш
      OrderTab.tsx          ← Заказ товаров
      UpdateTab.tsx         ← Обновление данных
    ui/
      GlassCard.tsx         ← базовая карточка (светлая + тёмная тема)
      StatCard.tsx          ← KPI карточка с иконкой и дельтой
      AlertBox.tsx          ← кликабельный алерт → фильтрует SKU таблицу
      SkuModal.tsx          ← модальное окно SKU (используется во всех вкладках)
      OrderModal.tsx        ← расширенная карточка для вкладки заказов
      Calendar.tsx          ← выбор периода (всегда активен)
      ThemeToggle.tsx       ← переключатель светлой/тёмной темы
      BottomNav.tsx         ← нижняя навигация на мобиле (только 2 пункта)
      Sidebar.tsx           ← боковое меню (только десктоп)
    charts/
      RevenueChart.tsx      ← выручка + расходы (двойная ось)
      FunnelChart.tsx       ← воронка CTR/CR по дням
      SparklineChart.tsx    ← мини-график для карточек
  store/
    dashboardStore.ts       ← Zustand: данные SKU, DAYS, dateRange, filters
    uiStore.ts              ← Zustand: activeTab, openModal, theme
  lib/
    parser.ts               ← парсер Отчёта по SKU (Лист7)
    stockParser.ts          ← парсер Таблицы остатков (sheet1)
    abcParser.ts            ← парсер АВС анализа
    chinaParser.ts          ← парсер Потребность Китай
    scoring.ts              ← расчёт SKU Score 0–100
    utils.ts                ← excelToISO, fmt, cn, etc.
public/
  niches.json               ← 473 ниши WB с сезонностью (статика)
  order_tab_data.json       ← fallback для order-data API (≤ 11 МБ)
```

---

## Supabase таблицы

| Таблица | Описание | Обновляется |
|---|---|---|
| `uploads` | История загрузок | при каждой загрузке |
| `products` | SKU master-data (из Отчёта SKU) | при загрузке Отчёта |
| `snapshot_metrics` | Снапшот метрик на дату загрузки | при загрузке Отчёта |
| `daily_metrics` | Дневные метрики (CTR, CR, ДРР, выручка, цена) | при загрузке Отчёта |
| `price_history` | История изменений цен | при загрузке Отчёта |
| `supply_plan` | Планы поставок | при загрузке Отчёта |
| `stock_sheet1` | Агрегаты из Таблицы остатков (dpd, oos, stock) | при загрузке Остатков |
| `stock_daily_sales` | Продажи по дням (~525k строк) | при загрузке Остатков |
| `abc_analysis` | АВС классы, GMROI, ЧМД, ТЗ | раз в месяц |
| `china_supply` | План продаж, себестоимость (Потребность Китай) | редко |
| `products_catalog` | Справочник Свод (2862 SKU) | раз в сезон |
| `sku_notes` | Заметки к товарам с автором | в реальном времени |

### Важные ограничения запросов
```typescript
// ✅ Правильно — пагинация через fetchAll
async function fetchAll<T>(table: string, select: string): Promise<T[]> {
  const all: T[] = []
  let offset = 0
  while (true) {
    const { data } = await supabase.from(table).select(select).range(offset, offset + 999)
    if (!data?.length) break
    all.push(...data as T[])
    if (data.length < 1000) break
    offset += 1000
  }
  return all
}

// ❌ Никогда — .in() с 2800+ значениями вызывает timeout
supabase.from('daily_metrics').select('*').in('sku_id', allSkuIds) // TIMEOUT

// ✅ Вместо этого
supabase.from('daily_metrics').select('*').limit(5000)

// ❌ Никогда — полный скан stock_daily_sales (525k строк)
supabase.from('stock_daily_sales').select('*') // TIMEOUT

// ✅ Только нужный диапазон дат
supabase.from('stock_daily_sales').select('*').gte('sale_date', fromDate).lte('sale_date', toDate)
```

---

## Вкладки дашборда

### 1. Обзор (Overview)
**Фильтры**: Категория | Статус новинки | Календарь (период)

**KPI карточки**: Выручка | ЧМД | Расходы на рекламу | Средняя маржа | ДРР

**Алерты** (кликабельные → фильтруют таблицу SKU):
- 🚨 STOP ADS — OOS + активная реклама = прямые потери
- 🚨 OOS с потерями — нет остатков, но есть спрос
- ⚠️ LOW STOCK — остатков < логистического плеча
- 💸 DRR > Маржа — реклама убыточна
- 🚀 Потенциал роста — высокий CTR + низкий CR (проблема контента/цены)

**Графики**:
- Выручка + Расходы по дням (двойная ось Y)
- Воронка конверсии по дням (CTR → CR корзины → CR заказа)
- Маржа% vs ДРР% (unit economics)

**Разбивка по менеджерам** (таблица, кликабельная → фильтрует SKU)

**Сравнение периодов**: текущий vs предыдущий (Выручка/ЧМД/Расходы/ДРР + дельты)

---

### 2. Таблица SKU
**Мобильная версия**: карточки вместо таблицы (до 768px)

**Фильтры**: Поиск | Категория | Период | Новинка | OOS | ДРР>Маржа | Диапазон маржи | ABC класс

**Колонки** (сортируемые): OOS статус | Маржа | SKU | Название | **Score 0–100** | Менеджер | Категория | Выручка | Маржа% | ЧМД | ДРР | CTR | CR корзины | CR заказа | Остаток | Дней остатка | CPO

**Виртуализация**: react-window для строк (2500+ SKU без лага)

---

### 3. Изменения цен
9 фильтров + таблица с дельтами метрик, XLSX экспорт

---

### 4. Аналитика
Drill-down Категория → Предмет → SKU, XLSX + PPTX экспорт

---

### 5. Анализ ниш
473 ниши WB, сезонность, мини-графики (только десктоп)

---

### 6. Заказ товаров
Расчёт заказа с учётом сезонности, логистического плеча, остатков в пути. Fallback на `order_tab_data.json` если Supabase недоступен.

---

### 7. Обновление данных
Загрузка всех файлов с прогресс-баром и статусом каждой таблицы.

**Порядок загрузки таблиц**:
1. **Свод** (`/api/update/catalog`) — один раз, обновлять при добавлении SKU
2. **АВС анализ** (`/api/update/abc`) — раз в месяц
3. **Потребность Китай** (`/api/update/china`) — при изменении планов
4. **Таблица остатков** (`/api/update/stock`) — хоть каждый день
5. **Отчёт по SKU** (`/api/upload`) — раз в 3–5 дней

---

## SKU Score (0–100)

Реализован в `src/lib/scoring.ts`. Рассчитывается при загрузке данных, сохраняется в `stock_sheet1` или вычисляется на клиенте.

```typescript
// Компоненты Score
score = 0
  + margin_score   * 0.30  // маржа%: 0→0, 20%→0.5, 40%→1.0
  + drr_score      * 0.20  // ДРР: 0%→1.0, 50%→0.5, 100%→0
  + growth_score   * 0.15  // тренд выручки (sigmoid)
  + cr_score       * 0.15  // CR заказа: 0%→0, 5%→1.0
  + stock_score    * 0.20  // дней остатка vs логплечо

// Штрафы
- 20 если OOS (нет остатков)
- 15 если DRR > margin_pct
- 10 если новинка < 30 дней с низкой выручкой

// Классы
80–100: 🔥 Масштаб
60–80:  🟢 Стабильный рост
40–60:  ⚠️ Нужна оптимизация
20–40:  🟠 Риск
0–20:   🔴 Проблема
```

---

## Темы (светлая / тёмная)

Управляется через `uiStore.ts` (Zustand) + `next-themes` или через `data-theme` атрибут на `<html>`.

```typescript
// uiStore.ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface UIStore {
  theme: 'light' | 'dark'
  toggleTheme: () => void
}

export const useUIStore = create<UIStore>()(
  persist(
    (set, get) => ({
      theme: 'light',
      toggleTheme: () => set({ theme: get().theme === 'light' ? 'dark' : 'light' }),
    }),
    { name: 'ui-store' }
  )
)
```

**Цветовая схема** (из референса WebPulse):
- Светлая: фон `#FFFFFF`/`#F8F9FA`, акцент `#E63946` (красный), текст `#1A1A2E`
- Тёмная: фон `#0D1117`/`#161B22`, акцент `#E63946`, текст `#E6EDF3`
- Шрифт: **Lato** (400/500/600/700) — Google Fonts
- Карточки светлой темы: `bg-white border border-gray-100 shadow-sm`
- Карточки тёмной темы: glassmorphism `bg-white/5 border border-white/10 backdrop-blur-md`

---

## Мобильный UI

**Только 2 вкладки адаптированы**: Обзор + Таблица SKU (с модалкой)

```
Десктоп (≥ 1024px): Sidebar слева + полные таблицы
Мобиль (< 1024px):  BottomNav снизу + карточки вместо таблиц
```

**BottomNav** (фиксирован снизу, только на мобиле):
```
Главная | Таблица SKU
```

**Таблица SKU на мобиле**: вертикальные карточки с мини-спарклайном (7 дней)

**Правила мобиля**:
- Минимальный размер touch-цели: 44px
- `font-size` в инпутах ≥ 16px (иначе iOS зумирует)
- `padding-bottom: env(safe-area-inset-bottom)` для iPhone с чёлкой
- Горизонтальный скролл только для графиков с датами

---

## Парсеры Excel

### Общие правила
```typescript
import * as XLSX from 'xlsx'
// ВСЕГДА использовать:
const wb = XLSX.read(buffer, { cellDates: false, raw: true })
// cellDates: false — даты приходят как serial integer, конвертировать через excelToISO()
// raw: true — числа без форматирования
```

### Отчёт по SKU (`src/lib/parser.ts`)
- Файл: `Отчет_по_SKU_*.xlsb`, лист `Лист7`
- **Смещение колонок `pos`**: искать заголовок "Затраты план" в cols 27–40, ожидать в col 32
  - `pos = найденная_col - 32`
  - Если не найден → искать "планирован" в groupRow, иначе `pos = 0`
- `POS_LATEST` = `pos < 0 ? 26 : 29`
- Дневные метрики: cols = базовые + `pos`
- **Никогда не использовать** `hasPositionCols` — этот подход ломается при смещении

### Таблица остатков (`src/lib/stockParser.ts`)
- Файл: `Таблица_Остатков_*.xlsb`, лист `sheet1`
- Колонки с датами дублируются → брать **последнее** вхождение даты
- Позиции колонок (FBO WB и т.д.) смещаются → определять по **названию заголовка**
- `shelf_date` = Excel serial integer → `excelToISO()`
- `arrival_date` = строка `DD.MM.YYYY` → парсить отдельно

### Конвертация дат
```typescript
// src/lib/utils.ts
export function excelToISO(serial: number): string {
  const date = new Date((serial - 25569) * 86400 * 1000)
  return date.toISOString().split('T')[0]
}
```

---

## Turbopack — критичные ограничения

Нарушение любого из этих правил = **ошибка сборки** (не линт, а build error):

```typescript
// ❌ Type cast в JSX
{([...data] as Item[]).map(item => <Row key={item.id} />)}

// ✅ Выносить в переменную
const items = [...data] as Item[]
return items.map(item => <Row key={item.id} />)

// ❌ JSX комментарий между элементами
<div>
  {/* комментарий */}
  <span />
</div>

// ✅ Убирать комментарии или выносить за JSX

// ❌ Unicode символ Δ перед выражением в JSX
{Δ someValue}

// ✅ Использовать строку
{`Δ ${someValue}`}

// ❌ Деление в JSX
{a}/{b}

// ✅
{a + '/' + b}

// ❌ useState/хуки внутри IIFE в JSX
{(() => { const [x] = useState(0); return x })()}

// ✅ Выносить в отдельный компонент
```

---

## Метрики — определения

| Метрика | Формула | Примечание |
|---|---|---|
| ДРР | `ad_spend / revenue` | Не среднее — взвешенное по периоду |
| Маржа | взвешенная по выручке | Не среднее арифметическое |
| GMROI расч. | `ЧМД_чистый / ТЗ` | Из АВС анализа |
| CPO | `ad_spend / orders` | Стоимость одного заказа |
| Days of Stock | `total_stock / dpd_31` | При dpd=0 и stock>0 → 999 |
| already_have | `total_stock + in_transit + in_prod` | При расчёте заказа |
| Новинки | по `novelty_status`, окно 60 дней | Не по `shelf_date` |

---

## Архитектура данных — поток

```
Excel файлы
  → API routes (upload/update/*)
    → parser.ts / stockParser.ts / etc.
      → Supabase (products, daily_metrics, stock_sheet1, ...)
        → API routes (dashboard-data, order-data)
          → Zustand store (dashboardStore)
            → компоненты вкладок
```

**dashboard-data API**: загружает все данные с `from=YYYY-MM-DD`, дефолт — 60 дней назад. Клиент хранит все дни в `DAYS[]`, показывает последние 7 по умолчанию.

**Lazy loading**: `loadHistory(fromDate)` — идемпотентна, пропускает если `fromDate >= loadedFrom`. Состояние `loadedFrom` в Zustand.

**Подсветка календаря**: сравнение по `label` формата `DD.MM` (не по индексу), т.к. индекс есть только для дат с данными. **Внимание**: `DD.MM` строковое сравнение не работает кросс-год — использовать ISO дату или YYYY.MM.DD.

---

## Claude Code — плагины, хуки, скиллы, агенты

### Что такое и где настраивается

Все настройки Claude Code находятся в:
- **Глобально** (для всех проектов): `~/.claude/settings.json`
- **Для проекта**: `.claude/settings.json` в корне репозитория
- **Команды/скиллы**: `~/.claude/commands/` (глобально) или `.claude/commands/` (в проекте)

### MCP серверы (плагины)

MCP (Model Context Protocol) — плагины, расширяющие возможности Claude Code. Подключаются в `settings.json`:

```json
// .claude/settings.json
{
  "mcpServers": {
    "supabase": {
      "command": "npx",
      "args": ["-y", "@supabase/mcp-server-supabase@latest", "--supabase-url", "YOUR_URL", "--supabase-service-role-key", "YOUR_KEY"]
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "YOUR_TOKEN" }
    }
  }
}
```

**Полезные MCP серверы для этого проекта**:
- `@supabase/mcp-server-supabase` — выполнять SQL-запросы к БД прямо из Claude Code
- `@modelcontextprotocol/server-github` — работать с PR, issues, branches
- `@modelcontextprotocol/server-filesystem` — расширенный доступ к файлам

Установка: `claude mcp add <name>` или через `/mcp` в Claude Code

### Хуки (Hooks)

Хуки — shell-команды, выполняющиеся автоматически при событиях. Настраиваются в `settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [{ "type": "command", "command": "echo 'Running bash command'" }]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Write",
        "hooks": [{ "type": "command", "command": "npm run lint --silent 2>&1 | head -20" }]
      }
    ]
  }
}
```

**Полезные хуки для этого проекта**:
- `PostToolUse` на `Write` → запускать TypeScript проверку изменённого файла
- `PreToolUse` на `Bash` с `git push` → напоминание про `npm run build`

### Скиллы (пользовательские команды)

Скиллы = кастомные slash-команды. Создать файл `.claude/commands/имя.md`:

```
# .claude/commands/deploy.md
Выполни следующие шаги для деплоя:
1. Запусти `npm run build` и проверь что нет ошибок
2. Запусти `git add .`
3. Попроси описание коммита
4. Создай коммит и запушь в main
5. Сообщи ссылку на Vercel деплой
```

Использование: `/deploy` в чате с Claude Code

**Полезные скиллы для этого проекта**:

```
.claude/commands/
  deploy.md         — сборка + коммит + пуш
  new-tab.md        — создать новую вкладку по шаблону
  check-parser.md   — проверить что парсер читает правильные колонки
  add-column.md     — добавить колонку в таблицу SKU (UI + API + тип)
```

### Агенты (subagents)

Агенты запускаются через `Agent` tool внутри разговора. Используются для:
- **Explore** — исследовать кодовую базу без изменений
- **Plan** — составить план реализации перед написанием кода
- **general-purpose** — сложные многошаговые задачи

```
Примеры использования:
"Изучи все файлы в src/components и объясни архитектуру" → Explore agent
"Как лучше реализовать виртуализацию таблицы SKU?" → Plan agent
"Найди все места где используется dayIndexMap" → Explore agent
```

### Рекомендуемая структура `.claude/` в проекте

```
.claude/
  settings.json          ← разрешения инструментов, MCP, хуки
  commands/
    deploy.md            ← /deploy
    add-tab.md           ← /add-tab
    check-types.md       ← /check-types (запустить tsc --noEmit)
```

---

## Файлы данных (исходные Excel)

| Файл | Лист | Частота | API route |
|---|---|---|---|
| `Свод.xlsb` | первый лист | раз в сезон | `/api/update/catalog` |
| `АВС_анализ_*.xlsx` | `АВС расшифровка` | раз в месяц | `/api/update/abc` |
| `Потребность_Китай_*.xlsx` | `СВОД` | редко | `/api/update/china` |
| `Таблица_Остатков_*.xlsb` | `sheet1` | хоть каждый день | `/api/update/stock` |
| `Отчет_по_SKU_*.xlsb` | `Лист7` | раз в 3–5 дней | `/api/upload` |
| `Основные показатели.xlsx` | несколько листов | справочник | только чтение |

---

## Git и деплой

```bash
# Стандартный деплой
npm run build           # проверка перед коммитом
git add .
git commit -m "feat: описание изменений"
git push origin main    # Vercel задеплоит автоматически

# Настройка нового репозитория
gh repo create marketspace-dashboard-v2 --public
git remote add origin https://github.com/ИМЯ/marketspace-dashboard-v2.git
git push -u origin main
```

**Переменные окружения** (в Vercel Dashboard → Settings → Environment Variables):
```
NEXT_PUBLIC_SUPABASE_URL=https://ваш-проект.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
```

Локально: файл `.env.local` (не коммитить в git).

---

## Известные проблемы и решения из прошлой версии

| Проблема | Причина | Решение |
|---|---|---|
| HTTP 504 на `/api/order-data` | Полный скан `daily_metrics` для цен | Фильтровать по `upload_id` последней загрузки |
| Метрики = 0 после загрузки нового файла | `pos = -5` (неверное смещение колонок) | Искать "Затраты план" в headerRow, не в groupRow |
| Повторная загрузка при сужении периода | `loadHistory` вызывалась всегда | Проверять `if (fromDate >= loadedFrom) return true` |
| Подсветка диапазона в календаре не работает | Сравнение по index (null для дат без данных) | Сравнивать по `label` формата `DD.MM` |
| `page.tsx` 2700 строк | Весь UI в одном файле | Разделить на компоненты в `tabs/` и `ui/` |
| Turbopack: `as Type[]` в JSX | Ограничение Turbopack | Выносить cast в переменную |
