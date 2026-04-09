# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Команды разработки

```bash
npm run dev      # локальный сервер (Turbopack, http://localhost:3000)
npm run build    # ОБЯЗАТЕЛЬНО перед push — Turbopack ломает сборку незаметно
npm run lint     # ESLint
git add . && git commit -m "feat: ..." && git push origin main  # → Vercel auto-deploy
```

---

## Стек

Next.js 16 (App Router + Turbopack) · TypeScript · Tailwind CSS 4 · Framer Motion · Zustand · Recharts · Lucide React · React Hook Form + Zod · react-window · SheetJS (xlsx) · pptxgenjs · Supabase · Vercel free tier

```bash
npm install framer-motion zustand react-hook-form zod lucide-react react-window recharts xlsx pptxgenjs @supabase/supabase-js @supabase/ssr
npm install -D @types/react-window
```

---

## Инфраструктура (бесплатно)

- **Vercel**: функция макс 60 сек (`export const maxDuration = 60`), `/public` до 50 МБ
- **Supabase**: строк в запросе по умолчанию 1000 → пагинировать через `fetchAll`; `.in()` с 2800+ значениями = timeout → использовать `.limit(5000)` без фильтра; `stock_daily_sales` (525k строк) никогда не читать целиком — только по диапазону дат

---

## Архитектура

```
src/
  app/
    dashboard/page.tsx      ← только tab routing (тонкий)
    dashboard/layout.tsx    ← Sidebar (desktop) + BottomNav (mobile)
    api/
      dashboard-data/       ← основные метрики SKU
      order-data/           ← данные вкладки заказов
      upload/               ← Отчёт по SKU
      update/stock|abc|china|catalog/
  components/
    tabs/                   ← OverviewTab, SkuTableTab, PriceTab, AnalyticsTab, NicheTab, OrderTab, UpdateTab
    ui/                     ← GlassCard, StatCard, AlertBox, SkuModal, OrderModal, Calendar, ThemeToggle, BottomNav, Sidebar
    charts/                 ← RevenueChart (двойная ось), FunnelChart, SparklineChart
  store/
    dashboardStore.ts       ← Zustand: DAYS[], dateRange, SKU data, filters, loadedFrom
    uiStore.ts              ← Zustand + persist: activeTab, openModal, theme ('light'|'dark')
  lib/
    parser.ts               ← парсер Отчёта по SKU (Лист7)
    stockParser.ts          ← парсер Таблицы остатков (sheet1)
    scoring.ts              ← SKU Score 0–100
    utils.ts                ← excelToISO(), fmt, cn
public/
  niches.json               ← 473 ниши WB (статика, не менять)
  order_tab_data.json       ← fallback для order-data (≤11 МБ)
```

Детальная спецификация вкладок → [`docs/tabs-spec.md`](docs/tabs-spec.md)

---

## Дизайн-система

**Светлая тема** (по умолчанию): фон `#FFFFFF`/`#F8F9FA`, акцент `#E63946`, текст `#1A1A2E`
**Тёмная тема**: фон `#0D1117`, карточки `bg-white/5 border-white/10 backdrop-blur-md`
**Шрифт**: Lato 400/500/600/700 (Google Fonts)
**Переключение темы**: кнопка в хедере/сайдбаре, сохраняется в localStorage через Zustand persist

**Мобиль**: только Обзор + Таблица SKU адаптированы. Таблица → карточки (<768px). BottomNav с 2 пунктами. Touch-цели ≥44px, font-size в инпутах ≥16px.

---

## Turbopack — критичные ограничения (нарушение = ошибка сборки)

```typescript
// ❌ → ✅ cast в JSX
{([...] as Type[]).map(...)}  →  const items = [...] as Type[]; items.map(...)

// ❌ → ✅ JSX комментарии между элементами — убирать

// ❌ → ✅ Unicode символ Δ перед выражением
{Δ value}  →  {`Δ ${value}`}

// ❌ → ✅ деление в JSX
{a}/{b}  →  {a + '/' + b}

// ❌ → ✅ хуки внутри IIFE в JSX — выносить в компонент
```

---

## Парсеры Excel

```typescript
// ВСЕГДА
XLSX.read(buffer, { cellDates: false, raw: true })
// Даты = serial integer → конвертировать: excelToISO(serial) = new Date((s-25569)*86400*1000)
```

**Отчёт по SKU** (`Лист7`): смещение `pos` = позиция заголовка "Затраты план" (ищем cols 27–40) минус 32. Если не найден → `pos = 0`. `POS_LATEST = pos < 0 ? 26 : 29`. **Никогда** не использовать `hasPositionCols` — сломается при смещении.

**Таблица остатков** (`sheet1`): дублирующиеся даты → брать последнее вхождение; позиции колонок определять по заголовку, не по индексу.

---

## Метрики

| Метрика | Формула |
|---|---|
| ДРР | `ad_spend / revenue` (не среднее) |
| Маржа | взвешенная по выручке |
| GMROI | `ЧМД_чистый / ТЗ` |
| CPO | `ad_spend / orders` |
| Days of Stock | `total_stock / dpd_31` (при dpd=0 и stock>0 → 999) |
| already_have | `total_stock + in_transit + in_prod` |

---

## SKU Score (0–100) — `src/lib/scoring.ts`

`score = margin*0.30 + drr*0.20 + growth*0.15 + cr*0.15 + stock*0.20`
Штрафы: -20 OOS, -15 DRR>margin, -10 новинка<30д с низкой выручкой
Классы: 🔥 80+ / 🟢 60+ / ⚠️ 40+ / 🟠 20+ / 🔴 <20

---

## Умный календарь (Zustand)

- `loadedFrom` в store — `loadHistory(fromDate)` идемпотентна: пропускает если `fromDate >= loadedFrom`
- По умолчанию показываются последние 7 дней, при старте грузятся последние 60
- Подсветка диапазона — сравнение по `label` формата `DD.MM`, **не по index** (null для дат без данных)
- ⚠️ `DD.MM` сравнение строками ломается кросс-год → хранить также ISO дату

---

## Alерты (кликабельные → фильтруют таблицу SKU)

🚨 STOP ADS (OOS + активная реклама) · 🚨 OOS с потерями · ⚠️ LOW STOCK (<логплечо) · 💸 DRR>Маржа · 🚀 Потенциал (высокий CTR + низкий CR)

---

## Claude Code — настройка инструментов

### MCP серверы (плагины)

```json
// .claude/settings.json
{
  "mcpServers": {
    "supabase": {
      "command": "npx",
      "args": ["-y", "@supabase/mcp-server-supabase@latest",
               "--supabase-url", "YOUR_URL",
               "--supabase-service-role-key", "YOUR_KEY"]
    }
  }
}
```

Добавить через CLI: `claude mcp add supabase` или вручную в settings.json.
Полезные серверы: `@supabase/mcp-server-supabase` (SQL к БД) · `@modelcontextprotocol/server-github` (PR/issues)

### Хуки

```json
// .claude/settings.json
{
  "hooks": {
    "PostToolUse": [{
      "matcher": "Write",
      "hooks": [{ "type": "command", "command": "npx tsc --noEmit 2>&1 | head -20" }]
    }]
  }
}
```

### Пользовательские команды (скиллы)

Файлы `.claude/commands/*.md` → вызываются как `/имя-файла` в чате:

```
.claude/commands/deploy.md      → /deploy    (build + commit + push)
.claude/commands/add-tab.md     → /add-tab   (создать новую вкладку по шаблону)
.claude/commands/check-types.md → /check-types (tsc --noEmit)
```

Пример `.claude/commands/deploy.md`:
```
Выполни: 1) npm run build — проверь ошибки. 2) git add . 3) Спроси описание коммита. 4) git commit + push origin main.
```

### Агенты

- **Explore** — исследовать файлы без изменений (`"найди все useEffect с fetchAll"`)
- **Plan** — составить план перед реализацией (`"как лучше разделить page.tsx"`)
- **general-purpose** — сложные многошаговые задачи

---

## Известные проблемы (из v1)

| Проблема | Решение |
|---|---|
| HTTP 504 на `/api/order-data` | Фильтровать `daily_metrics` по `upload_id` последней загрузки |
| Метрики = 0 после загрузки нового файла | Искать "Затраты план" в headerRow (не в groupRow) для вычисления `pos` |
| Turbopack: `as Type[]` в JSX | Выносить cast в переменную |
| `novelty_status` затирается при повторной загрузке | upsert без поля `novelty_status` для SKU без статуса новинки |

---

## Supabase таблицы

`uploads` · `products` · `snapshot_metrics` · `daily_metrics` · `price_history` · `supply_plan` · `stock_sheet1` · `stock_daily_sales` · `abc_analysis` · `china_supply` · `products_catalog` · `sku_notes`

Env vars: `NEXT_PUBLIC_SUPABASE_URL` · `NEXT_PUBLIC_SUPABASE_ANON_KEY` · `SUPABASE_SERVICE_ROLE_KEY`
