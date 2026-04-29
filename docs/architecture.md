# Marketspace 2.0 — Архитектура дашборда

> **Назначение этого файла:** карта проекта на русском, для быстрого ориентирования. Здесь — _что где лежит_, _какие данные куда текут_, _какие формулы используются_, и _где известные проблемы_.
> **Обновлять при каждом изменении логики БД, парсеров, маршрутов или вкладок.**
>
> Дата создания: 2026-04-27 · Last sync: 2026-04-29 (миграция 013).

---

## ⚠️ Миграция 013 — переработка схемы SKU

С версии `013_redesign_sku_facts.sql` загружается **«Отчёт по SKU с расчётами»** — все ключевые показатели приходят уже посчитанными в Excel. Изменения:

- **Удалены**: `daily_agg_sku`, `fact_daily_agg`, `fact_sku_snapshot`, RPC `refresh_daily_agg*`, endpoints `/api/admin/refresh-daily-agg*`.
- **Создана `fact_sku_period`** — снапшот метаданных и агрегатов на период (PK `(sku_ms, period_start, period_end)`).
- **`fact_sku_daily`** теперь хранит дневные показатели: `revenue, ad_spend, sales_qty, cost_sum, margin_rub, chmd_rub, marginality, chmd_pct, drr_*, ctr, cr_*, cpm, cpc, ad_order_share, price` (PK `(sku_ms, metric_date)`).
- **`fact_price_changes`** расширена: `price_before, ctr_change, cr_change, delta_pct`.
- Парсер `parseSkuReport` использует зашитые column-индексы (формат файла стабилен, 136 колонок).
- API роуты `/api/dashboard/{overview,orders,prices,analytics,sku-table}` читают `fact_sku_daily` + `fact_sku_period` напрямую — никаких материализованных агрегатов.

Старые разделы 4.1, 6.5 и упоминания `daily_agg_sku/fact_daily_agg/fact_sku_snapshot` в документе ниже — **исторические**.

---

## 0. TL;DR — модель потока данных

```
                ┌─────────────────────────────────┐
   Excel-файлы ─┤ парсер (src/lib/parsers/*.ts)   │
                │  ↓                              │
                │ /api/upload/<type>/route.ts     │
                │  ↓ upsert в Supabase            │
                ▼                                 ▼
              dim_sku           fact_sku_daily          fact_abc
              fact_china_supply fact_price_changes      fact_analytics
                │                                 │
                └─────► /api/dashboard/<tab>/route.ts ◄──── React-вкладки
                          ↓                        (src/components/tabs/*)
                       JSON ответ
```

5 вкладок дашборда работают **только** со следующими таблицами:
- `daily_agg_sku` (день × SKU, материализованный агрегат)
- `dim_sku`
- `fact_daily_agg` (день, агрегат по всем SKU)
- `fact_price_changes`
- `fact_sku_daily` (источник истины для дневных метрик и снапшота)

Дополнительно используются:
- `fact_abc` — для вкладки «Анализ ниш и ABC»
- `fact_china_supply` — для вкладки «Логистика и заказы»
- `fact_analytics` — справочный (рейтинг, % выкупа, цены акций)

---

## 1. Структура репозитория

```
New dashboard/
├── docs/
│   ├── architecture.md          ← ЭТОТ ФАЙЛ (карта проекта)
│   └── data-mapping.md          ← старая карта Excel→Supabase, частично устарела
├── supabase/                    ← SQL-миграции (см. раздел 2)
├── src/
│   ├── app/
│   │   ├── dashboard/page.tsx   ← главная страница, навигация по вкладкам
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   └── api/                 ← все backend-эндпоинты
│   │       ├── upload/<type>/route.ts        ← загрузка Excel
│   │       ├── dashboard/<tab>/route.ts      ← данные для вкладок
│   │       ├── admin/refresh-*               ← ручной пересчёт агрегатов
│   │       ├── sku-modal/route.ts            ← данные для модалки SKU
│   │       ├── order-modal/route.ts          ← данные для модалки заказа
│   │       ├── sku-notes/route.ts            ← заметки по SKU
│   │       ├── uploads/history/route.ts      ← журнал загрузок
│   │       └── debug/<*>                     ← диагностические эндпоинты
│   ├── components/
│   │   ├── tabs/                ← один файл = одна вкладка
│   │   │   ├── OverviewTab.tsx       (Свод)
│   │   │   ├── AnalyticsTab.tsx      (Продажи и экономика)
│   │   │   ├── PriceTab.tsx          (Реклама и воронка)
│   │   │   ├── OrderTab.tsx          (Логистика и заказы)
│   │   │   ├── SkuTableTab.tsx       (Аналитика по SKU)
│   │   │   ├── NicheTab.tsx          (Анализ ниш и ABC)
│   │   │   └── UpdateTab.tsx         (Обновление данных)
│   │   └── ui/                  ← переиспользуемые компоненты
│   │       ├── DateRangePicker.tsx     ← глобальный выбор периода
│   │       ├── KPIBar.tsx              ← полоска KPI-карточек
│   │       ├── SkuModal.tsx            ← модалка деталей SKU
│   │       ├── OrderModal.tsx          ← модалка деталей заказа
│   │       ├── GlassCard.tsx           ← карточка с эффектом стекла
│   │       ├── ScoreBadge.tsx
│   │       ├── ThemeProvider.tsx       ← тёмная/светлая тема
│   │       └── …
│   ├── lib/
│   │   ├── parsers/             ← логика чтения Excel
│   │   │   ├── parseSkuReport.ts
│   │   │   ├── parseAnalytics.ts
│   │   │   ├── parseABC.ts
│   │   │   ├── parseCatalog.ts
│   │   │   ├── parseChina.ts
│   │   │   └── utils.ts         ← readWorkbook, sheetToRows, toNum, …
│   │   ├── supabase/
│   │   │   ├── client.ts        ← anon-клиент (для browser)
│   │   │   ├── server.ts        ← service-клиент (server-only)
│   │   │   ├── fetchAll.ts      ← пагинация постранично (>1000 строк)
│   │   │   ├── loadKnownSkus.ts ← Set всех sku_ms из dim_sku
│   │   │   └── downloadFromStorage.ts
│   │   ├── cache.ts             ← in-memory TTL-кэш для роутов
│   │   ├── tabCache.ts          ← in-memory кэш для вкладок (между табами)
│   │   ├── scoring.ts           ← формула SKU Score (см. раздел 6)
│   │   ├── formatters.ts        ← fmtAxis, fmtFull, fmtPct, calcDelta
│   │   └── exportExcel.ts       ← экспорт таблицы во Frosted Excel
│   └── types/analytics.ts       ← общие типы между route и tab
├── package.json                 ← Next.js 16.2.2, supabase-ssr, recharts, xlsx, …
├── next.config.ts               ← serverActions.bodySizeLimit = 50mb
└── tsconfig.json
```

---

## 2. Supabase — схема БД

Миграции лежат в `supabase/*.sql` и выполняются вручную в SQL Editor.

### 2.1 Таблицы

| Таблица | PK | Назначение | Обновляется через |
|---|---|---|---|
| `uploads` | `id` (uuid) | журнал загрузок (file_type, period_start, status) | каждый upload route |
| `dim_sku` | `sku_ms` | справочник SKU (название, бренд, категория, сезонность) | upload `catalog`, заглушки от других uploads |
| `fact_sku_daily` | `(sku_ms, metric_date)` | **главный факт** — дневные метрики и снапшот в одной таблице | upload `sku-report` |
| `fact_sku_snapshot` | `(sku_ms, upload_id)` | **устарела** — поля переехали в `fact_sku_daily` (по `snap_date`) | (не используется новыми uploads) |
| `fact_stock_daily` | `(sku_wb, sale_date)` | дневные продажи из «Таблицы остатков» | (вкл. в схеме, но не используется в текущих uploads) |
| `fact_stock_snapshot` | `(sku_wb, upload_id)` | снапшот остатков (резерв) | (не используется) |
| `fact_price_changes` | `(sku_wb, price_date)` | история цен с `delta_pct` | upload `sku-report` (производный) |
| `fact_abc` | `(sku_ms, upload_id)` | ABC-анализ (revenue, chmd, классы по периодам) | upload `abc` |
| `fact_china_supply` | `(sku_ms, upload_id)` | потребность Китай (планы, в пути, lead_time_days) | upload `china` |
| `fact_analytics` | `sku_ms` | срез из «Аналитика_*.xlsx» (рейтинг, выкуп, цены акций) | upload `analytics` |
| `sku_notes` | `id` | заметки оператора по конкретному SKU | модалка SKU |
| `fact_daily_agg` | `metric_date` | материализованный агрегат за день, **одна строка на дату** | RPC `refresh_daily_agg` |
| `daily_agg_sku` | `(metric_date, sku_wb)` | материализованный агрегат день × SKU (последовательный расчёт остатков) | endpoint `/api/admin/refresh-daily-agg-sku` |

### 2.2 Ключевые поля `fact_sku_daily`

`fact_sku_daily` — самая важная таблица. Содержит **ДВА типа строк**, различаемых по дате:
- **Дневные метрики** (`metric_date` = 5 рабочих дней из «Отчёт по SKU», `snap_date` = NULL для них в исходном виде, но на практике snap_date проставляется одинаковый для всех 5 дат SKU)
- **Снапшот** (`snap_date` = самая новая дата файла)

Поля:
- _Дневные:_ `metric_date`, `revenue`, `ad_spend`, `drr_total`, `drr_ad`, `ctr`, `cr_cart`, `cr_order`, `cpm`, `cpc`, `ad_order_share`, `spend_plan`, `drr_plan`
- _Снапшот:_ `snap_date`, `sku_wb`, `fbo_wb`, `fbs_pushkino`, `fbs_smolensk`, `kits_stock`, `stock_days`, `days_to_arrival`, `ots_reserve_days`, `margin_pct` (хранится как доля 0..1, **не процент**), `chmd_5d`, `price`, `manager`, `novelty_status`, `supply_date`, `supply_qty`, `shelf_date`

> **Правило для дашборда:** `sku_wb`, остатки, `margin_pct`, `price`, `manager`, `novelty_status` — всегда брать **из строки с самой свежей `snap_date`**, а `revenue`/`ad_spend` и метрики воронки — из строк за `metric_date` в выбранном периоде.

### 2.3 SQL-функции

| Функция | Что делает | Когда вызывается |
|---|---|---|
| `refresh_daily_agg(from_date, to_date)` | Пересобирает `fact_daily_agg` из `daily_agg_sku` (взвешенные средние, суммы, ЧМД). | После завершения `refresh_daily_agg_sku`. |
| `refresh_daily_agg_sku` (SQL) | Тонкая версия пересчёта `daily_agg_sku` напрямую SQL'ом из `fact_sku_daily` (не используется в продакшне). | — |
| `get_sku_period_agg(p_from, p_to)` | Возвращает суммированные `revenue`/`ad_spend` по SKU за период. Быстрее, чем `fetchAll` построчно. | Может использоваться в роутах для оптимизации. |

### 2.4 Storage bucket

`uploads` — приватный, лимит 50 МБ, поддерживает .xlsx, .xlsb, .xls, .octet-stream. Сейчас не используется (загрузки идут через FormData → /api/upload/*).

---

## 3. Парсеры (Excel → структурированные строки)

Все парсеры в `src/lib/parsers/`. Общие утилиты — `utils.ts`:
- `readWorkbook(buf)` — XLSX.read с `cellDates: false, raw: true`.
- `sheetToRows(wb, name)` — array of arrays, indexed by column.
- `toNum(v)` / `toBool(v)` / `parseDateVal(v)` — безопасные конвертеры.
- `excelToISO(serial)` — Excel-серийные даты в YYYY-MM-DD.
- `chunk(arr, size)` — батч для upsert.

### 3.1 `parseSkuReport.ts` → таблицы `fact_sku_daily` + `fact_price_changes`

Источник: «Отчёт по SKU» (`Лист7`).
- Row 0 — группы блоков («Выручка Total», «ДРР Total», «CTR», «CR корзина», «CR заказ», «CPM», «CPC», «Доля рекл. заказов», «Изменение цены»).
- Row 1 — подзаголовки + Excel-даты (5 рабочих дней).
- Row 2+ — данные SKU (`col 0` = WB-артикул).

Снапшотные поля (одинаковые для всех 5 дат SKU): `shelf_date`, `manager`, `novelty_status`, `fbo_wb`, `fbs_pushkino`, `fbs_smolensk`, `kits_stock`, `stock_days`, `days_to_arrival`, `margin_pct` (**делится на 100** при парсинге → хранится как доля), `chmd_5d`, `price`, `supply_date`, `supply_qty`, `spend_plan`, `drr_plan`. Всё это записывается в каждую из 5 daily-строк.

`snap_date` = первая (самая свежая) дата блоков метрик.

Цены: парсер реконструирует историю цен из блока «Изменение цены» — пишет «цену на начало периода» + цены после каждой дельты.
- Колонка «Цена» = цена на снапшот (конец периода).
- Дельты в блоке «Изменение цены» = % изменения. Парсер прокатывает цену вперёд:
  `priceAfter = priceBefore × (1 + delta/100)`.

WB↔MS маппинг: парсер принимает `skuMap` (Map<sku_wb_string, sku_ms>). Если для SKU нет маппинга в `dim_sku` — строка пропускается (`skipped_skus`).

### 3.2 `parseAnalytics.ts` → таблица `fact_analytics`

Источник: «Аналитика_*.xlsx», 1 лист.

**Фиксированный layout** (84 колонки): индексы прибиты к `FIXED_COL`, и параллельно есть мягкое определение через заголовок (`resolveColumns`). При несовпадении — fallback на `FIXED_COL`.

Ключевые колонки по индексам (0-based):
| Колонка Excel | Поле БД | Пользовательский смысл |
|---|---|---|
| **A (0)** | `name` | Название |
| **B (1)** | `sku_wb` | SKU WB |
| C (2) | `brand` | Бренд |
| D (3) | `category` | Категория |
| **E (4)** | **`sku_ms`** ← ключ | Артикул МС |
| F (5) | `cost_updated_at` | Дата обновления себестоимости |
| L (11) | `target_margin` | Ориент. маржа |
| **M (12)** | **`rating`** | Рейтинг |
| N (13) | `reviews_count` | Кол-во отзывов |
| **AA (26)** | **`buyout_pct`** | % выкупа |
| AB (27)…AE (30) | `profit_correction`, `commission_fbo`, `commission_fbs`, `defect_pct` | … |
| AF (31)…AT (45) | `base_price`, `price_wb`, `spp`, `price_with_spp`, `rrp`, `promo`, `calc_margin`, `promo_active`, … | цены и акции |
| 40–74 | 7 промо-блоков (5 полей: `promo_price_N`, `margin_drop_N`, `penalty_N`, `promo_profit_N`, `promo_margin_N`) | альтернативные цены акций |
| 75–83 | `desired_margin_fbs`, `new_price`, `new_margin`, `promo_now`, `new_discount`, `exact_discounted_price`, `new_base`, `price_change`, `offer_margin` | финальные расчёты |

> **По заявке пользователя 27.04**: для дашборда из этой таблицы критичны только **E (sku_ms), M (rating), AA (buyout_pct)**. Остальное хранится «про запас» и читается по необходимости.

Дедупликация: по `sku_ms` (последняя строка побеждает).
Если SKU нет в `dim_sku` — создаётся заглушка перед upsert в `fact_analytics`.

### 3.3 `parseABC.ts` → таблица `fact_abc`

Источник: «АВС_анализ_*.xlsx», 1 лист (`Лист1`).

Колонки (как в файле, март 2026):
- A `Номенклатура`, **B `Артикул`** ← ключ, C `Ставка НДС`, D `Количество`,
- E `Себестоимость без НДС`, F `Выручка без НДС`, G `Чистый маржинальный доход (ЧМД)`,
- H `Реклама`, I `Хранение`, J `Тран расходы`, K `Складская обработка`,
- L `ЧМД за минусом …` → `chmd_clean`,
- M `Рен-сть чистого ЧМД, %` → `profitability`,
- N `Рен-сть выручки, %` → `revenue_margin`,
- O `ТЗ`, P `ОБ ТЗ, дн`, Q `Доля по ЧМД`,
- S `Класс по ЧМД`, T `Класс по Выручке`, **U `Итоговый класс` → `final_class_1`**,
- V `Класс по Рен-сти ЧМД`, W `Класс по Об тз`, **X `Итоговый класс2` → `final_class_2`**,
- Y `Дата первого поступления`,
- AB/AC = серийные даты (qty за тек. месяц / qty за пред. месяц),
- AE `Флаг новинки`, AF `Статус остатка`.

`period_month` определяется:
1. По серийным датам в заголовке (последняя из 2-х) — приоритет.
2. По имени файла (`январь` → `2026-01-01`).
3. Иначе — текущий месяц.

**Важная особенность ABC-файла:** один и тот же `sku_ms` встречается **2–3 раза** (разные размеры/варианты — S, M, L). В файле март 2026: 5677 строк → 4540 уникальных `sku_ms` → раньше терялось ~1100 строк.

**Текущая логика** (`/api/upload/abc/route.ts`, функция `aggregateBySkuMs`):
- Финансы суммируются: `qty_stock_rub`, `cost`, `revenue`, `chmd`, `ad_spend`, `storage`, `transport`, `chmd_clean`, `tz`, `qty_cur_month`, `qty_prev_month`.
- Доминирующий вариант (с максимальной выручкой) даёт: `final_class_1`, `final_class_2`, `chmd_class`, `revenue_class`, `profitability_class`, `turnover_class`, `product_name`, `created_date`, `novelty_flag`, `stock_status`.
- Соотношения пересчитываются из агрегата: `profitability = chmd_clean / revenue`, `revenue_margin = chmd / revenue`.
- `chmd_share` зануляется (теряет смысл после агрегации).

### 3.4 `parseCatalog.ts` → таблица `dim_sku`

Источник: «Свод.xlsb» (лист со словом «свод» в названии).
- `sku_ms` — обязателен (ключ); строки без него пропускаются.
- Сезонность: 12 колонок «январь…декабрь» (числа — коэффициенты).
- Прочее: `sku_wb`, `name`, `full_name` (`Номенклатура`), `brand`, `supplier`, `country`, `subject_wb`, `category_wb`, `nds_pct`, `market_share`, `niche_appeal`, `availability`, `buyout_pct`, `avg_rating`, `seasonality`, `season_start`, `season_length`, `top_month`, `top_phrase`.

Upsert: `onConflict: 'sku_ms'` — справочник полностью перезаписывается.

### 3.5 `parseChina.ts` → таблица `fact_china_supply`

Источник: «Потребность_Китай_*.xlsx», лист `свод`.
Структура: row 0 пустая, row 1 пустая, **row 2 = заголовки**, row 3+ = данные. Парсер ищет колонки только до второго вхождения «март» (отделяет блок WB от блока «Озон»).

Поля: `plan_mar..aug`, `reserve_15d`, `buyout_pct_wb`, `marketing_pct`, `cost_plan`, `cost_change_pct`, `avg_price`, `in_transit`, `in_production`, `nearest_date`, `order_qty`, `order_sum_cost`, `rating`.

Дополнительно: лист «Зеленка» → колонка `Лог. плечо, дн` → `lead_time_days`. Только ~1700 SKU имеют значение, остальные NULL.

Фильтрация: SKU без записи в `dim_sku` пропускаются (нужно сначала загрузить «Свод»).

---

## 4. Upload-маршруты (POST /api/upload/*)

Все принимают `multipart/form-data` с полем `file`, лимит 50 МБ задан в `next.config.ts` (`serverActions.bodySizeLimit`). Для маршрутов App Router этого может быть **недостаточно** — на больших файлах возможен 413; клиент в `UpdateTab.tsx` обрабатывает не-JSON ответ как «Файл слишком большой».

| Route | Парсер | Куда пишет | Конфликт-ключ | Особенности |
|---|---|---|---|---|
| `/api/upload/catalog` | `parseCatalog` | `dim_sku` | `sku_ms` | Просто перезаписывает справочник. |
| `/api/upload/abc` | `parseABC` + `aggregateBySkuMs` | `fact_abc` (+ заглушки в `dim_sku`) | `(sku_ms, upload_id)` | Агрегирует размеры по `sku_ms`. Период из файла → `uploads.period_start`. |
| `/api/upload/china` | `parseChina` | `fact_china_supply` | `(sku_ms, upload_id)` | Фильтрует SKU не из `dim_sku`. |
| `/api/upload/sku-report` | `parseSkuReport` | `fact_sku_daily` + `fact_price_changes` | `(sku_ms, metric_date)` / `(sku_wb, price_date)` | Загружает WB↔MS маппинг из `dim_sku`. После успеха **fire-and-forget** запускает `/api/admin/refresh-daily-agg-sku`, который перестраивает `daily_agg_sku` и `fact_daily_agg`. |
| `/api/upload/analytics` | `parseAnalytics` | `fact_analytics` (+ заглушки в `dim_sku`) | `sku_ms` | Полный layout 84 колонки. |

### 4.1 `/api/admin/refresh-daily-agg-sku` (POST)

Перестраивает `daily_agg_sku` — день × SKU с последовательным переносом остатков:
1. Берёт все строки `fact_sku_daily` за период.
2. Для каждой даты получает цену из `fact_price_changes` (последняя ≤ даты).
3. Считает per-day: `sales_qty = revenue / price`, `cost_sum = revenue × (1 − margin_pct)`, `margin_rub = revenue − cost_sum`, `chmd_rub = margin_rub − ad_spend`.
4. Прокатывает остатки: `stock_qty[t] = max(0, stock_qty[t-1] − sales_qty[t-1])`, начальный — сумма складов из снапшота.
5. Upsert батчами по 500 в `daily_agg_sku`.
6. Вызывает RPC `refresh_daily_agg(from, to)` → перестраивает `fact_daily_agg`.
7. Сбрасывает кэш `overview|*`.

> **Важно:** этот эндпоинт критичен для согласованности. Если упал silent — данные в Своде могут быть устаревшими.

---

## 5. Dashboard-маршруты (GET /api/dashboard/*)

Каждый возвращает JSON для одной вкладки. Шаблон расчётов:
1. Найти `latest snap_date` в `fact_sku_daily` → загрузить снапшотные поля.
2. Загрузить `dim_sku` через `fetchAll` (кэш 10 мин).
3. Загрузить дневные строки `fact_sku_daily` за выбранный период (`metric_date BETWEEN from AND to`).
4. Если запрошен — загрузить «предыдущий период» (сдвиг назад на длину диапазона).
5. Агрегировать → отдать.

### 5.1 `/api/dashboard/overview/route.ts` (вкладка «Свод», ~600 строк)

Универсальный KPI-бар, алерты, фокус-листы, тренд, топ-15.

**KPI:**
- `revenue` = Σ daily.revenue
- `ad_spend` = Σ daily.ad_spend
- `chmd` = Σ_SKU (revenue_sku × margin_pct_sku − ad_spend_sku)  ← `margin_pct` берётся из снапшота
- `avg_margin_pct` = chmd_total / revenue_total (взвешенный)
- `drr` = ad_spend / revenue
- `cost_of_goods` = Σ revenue × (1 − margin_pct)
- `oos_count` = SKU с `total_stock = 0` в снапшоте
- `lost_revenue` = упущенная выручка (формула в коде, ~OOS-логика)

**Алерты** (счётчики и фокус-списки SKU):
- **Стоп реклама** — `total_stock = 0 AND ad_spend > 0`
- **Скоро OOS** — `stock_days < lead_time` или зашит порог
- **Убыточная реклама** — `drr > margin_pct`
- **Высокий CTR / низкий CR** — отклонение от медианы аккаунта
- **Высокий CPO** — drr > 35%
- **Можно масштабировать** — drr < 50% маржи + CTR/CR ≥ медианы
- **Новинки под риском** — `novelty_status = 'Новинки' AND revenue < 10 000`

**Тренд:** дневные точки с `revenue`, `chmd`, `ad_spend`, `margin_pct`, `drr_pct`, `chmd_pct`.

**Топ-15:** по revenue. SKU карточкой со score.

### 5.2 `/api/dashboard/analytics/route.ts` (вкладка «Продажи и экономика»)

Иерархическая таблица **Категория → Предмет → SKU** + KPI + дневной чарт. Источник истины — `fact_sku_daily` (читаем дневные `revenue`, `ad_spend`, `margin_pct` берём из снапшота).

**Формулы:**
- `totalRevenue` = Σ revenue
- `totalAdSpend` = Σ ad_spend
- `totalMarginSum` = Σ revenue × margin_pct (где margin_pct — из снапа)
- `totalChmd = totalMarginSum − totalAdSpend`
- `marginPct = totalMarginSum / totalRevenue` (взвешенный)
- `drr = totalAdSpend / totalRevenue`
- `cpo = totalAdSpend / estimatedUnits`, где `estimatedUnits = Σ revenue / price_snap`
- Δ vs предыдущий период — те же формулы по `prevDailyRows`.

**Известный нюанс (был фикс 27.04):** ранее `fact_sku_daily` дневные строки фильтровались по `dimByMs[sku_ms]` (если SKU не в `dim_sku` — пропускались), что вело к расхождению `chmd` со «Сводом». Сейчас фильтр убран — оба маршрута видят одинаковый набор SKU.

### 5.3 `/api/dashboard/prices/route.ts` (вкладка «Реклама и воронка»)

KPI воронки + таблица изменений цен с дельтами CTR/CR/CPM/CPC до/после изменения (окно ±7 дней).

**KPI:**
- `ctr`, `cr_basket`, `cr_order`, `cpc`, `cpm`, `ad_order_share` — простое среднее по строкам с не-null значениями.
- `drr` = total_ad_spend / total_revenue.
- `cpo = avg_cpc / avg_cr_order`.

**Изменения цен:** для каждого `sku_wb` из `fact_price_changes` ищет реальные изменения внутри периода (соседние записи с разной ценой). Для каждого изменения считает Δ воронки за окно WINDOW=7 дней до/после.

**Manager table:** агрегация по полю `manager` из снапа (CTR, CR заказ, доля рекл., выручка, кол-во SKU).

### 5.4 `/api/dashboard/orders/route.ts` (вкладка «Логистика и заказы»)

Расчёт «сколько заказать»:
1. **Скорость продаж** dpd = revenue_31d / 31 / price.
2. **Сезонная коррекция** — берёт коэффициенты из `dim_sku.month_*`.
3. **Потребность за горизонт** = baseNorm × (targetCoeff / avgYearCoeff) × horizon.
4. **Уже есть** = total_stock + in_transit + in_production.
5. **calc_order** = max(0, demandSeasonal − alreadyHave).

**Статусы:** `oos` (totalStock=0), `critical` (days_stock < lead_time × 0.5), `warning` (< lead_time), `ok`.

> **⚠ Известная проблема:** этот роут пытается селектить `abc_class` из `fact_abc` (строки 132–139), но миграция 010 **дропнула** колонку `abc_class`. Supabase либо вернёт ошибку, либо `abc_class` будет null. **Нужно поправить:** вместо `abc_class` извлечь из `final_class_1` (как в `niches/route.ts`).

### 5.5 `/api/dashboard/sku-table/route.ts` (вкладка «Аналитика по SKU»)

Плоская таблица по SKU с метриками за период.

Источники:
- `dim_sku` (через `fetchAll`) — name, brand, subject_wb, category_wb.
- `fact_sku_daily` snap (последняя `snap_date`) — `sku_wb`, склады, `margin_pct`, `price`, `manager`, `novelty_status`.
- `fact_sku_daily` daily — `revenue`, `ad_spend`, `ctr`, `cr_*`, `cpm` за период; «предыдущий период» для `delta_revenue_pct`.

**Универсум SKU:** `Set([...skuAgg keys, ...snapByMs keys])` — показывает SKU из снапшота + те, у кого есть дневные метрики.

**Поля таблицы:**
- `sku` (предпочитает `sku_wb`, fallback `sku_ms`)
- `name`, `manager`, `category`
- `revenue`, `margin_pct`, `chmd = revenue × margin_pct − ad_spend`
- `drr = ad_spend / revenue` (или среднее `drr_total` по daily, если revenue=0)
- `ctr`, `cr_basket`, `cr_order` — простое среднее
- `stock_qty` (сумма ФБО + ФБС + комплекты), `stock_days`, `price`
- `cpo = ad_spend / days` (грубая оценка)
- `forecast_30d = revenue / days × 30`
- `delta_revenue_pct = (curr − prev) / prev`
- `score` — формула `computeScore` (см. раздел 6)
- `oos_status` (`critical|warning|ok`), `margin_status` (`high|medium|low`), `novelty`

### 5.6 `/api/dashboard/niches/route.ts` (вкладка «Анализ ниш и ABC»)

Группирует SKU из `fact_abc` по `subject_wb` (ниша) с агрегацией финансов и взвешенными KPI.

**Логика:**
- Берёт все периоды (`uploads.period_start`) — это даёт фильтр периодов в UI.
- На выбранный период ищет последний `upload_id` ABC.
- Объединяет с `dim_sku` (имя, категория, niche_appeal, buyout_pct, market_share, month_*).
- Группирует по `subject_wb`:
  - `revenue`, `chmd`, `chmd_clean`, `tz` — суммы.
  - `profitability` (взвешенно): Σ chmd_clean / Σ revenue × 100.
  - `revenue_margin` (взвешенно): Σ chmd / Σ revenue × 100.
  - `gmroi` = chmd_clean / tz.
  - `final_class_1`, `final_class_2`, `abc_class` — доминирующее значение по частоте.
  - `attractiveness` — берётся из `dim_sku.niche_appeal` (среднее), либо считается эвристикой (revenue × класс × сезонность × кол-во SKU).
  - `season_*` — выявление сезонности по 12 коэффициентам (месяц > avg × 1.2 — сезонный, > avg × 1.5 + ≥2 месяцев → пометка «сезонная»).
- Внутри ниши — список SKU с per-SKU `profitability`, `revenue_margin`, `gmroi`.

**Periods filter:** список из distinct `uploads.period_start` для file_type='abc'. _Если в БД остались записи со «сдвинутым» периодом (баг старого парсера), исправит только ре-загрузка ABC-файлов с актуальной версией парсера._

---

## 6. Расчётные формулы (важно!)

### 6.1 ЧМД (чистый маржинальный доход)

**Везде в дашборде**: `chmd_sku = revenue_sku × margin_pct_sku − ad_spend_sku`, где:
- `revenue_sku`, `ad_spend_sku` — суммы за период из `fact_sku_daily` (`metric_date IN [from..to]`).
- `margin_pct_sku` — берётся из строки **снапшота** (`snap_date = MAX`), **в долях** (0.18, не 18).

**Итог:** `totalChmd = Σ chmd_sku`. Это формула из «Свода» и «Аналитики», после фикса 27.04 они согласованы.

### 6.2 ДРР

`drr = ad_spend / revenue`. Если `revenue = 0` → 0. Если только этот SKU в выборке без выручки — берём среднее `drr_total` из daily.

### 6.3 Маржа %

Взвешенная: `marginPct = Σ(revenue × margin_pct) / Σ revenue`. Используется в KPI «Маржа %».

### 6.4 SKU Score (0–100)

`src/lib/scoring.ts`. 5 компонентов:
1. **Margin score** (макс 30): <10% → 0; 10–15% линейно 0→0.5; ≥15% → 0.5→1.0.
2. **DRR score** (макс 20): `clamp(1 − DRR/Margin, 0, 1)` × 20. Без рекламы → 1.0.
3. **Growth score** (макс 15): `sigmoid(4×growth)` × 15.
4. **CR score** (макс 15): `min(cr / refCr, 1)` × 15, refCr = медиана аккаунта или 0.05.
5. **Stock score** (макс 20): OOS=0; <lead_time = (sd/lt) × 0.5; ≥2×lt = 1.0.

**Штрафы:**
- OOS → 0 (хард).
- DRR > Margin → ×0.5.
- Новинка с выручкой < 10 000 → −10.

### 6.5 daily_agg_sku — последовательный расчёт остатков

В `refresh-daily-agg-sku`:
- `salesQty = revenue / price` (цена на дату из `fact_price_changes`).
- `costSum = revenue × (1 − margin_pct/100)` ← _Внимание: здесь делится на 100, потому что в `fact_sku_daily` margin_pct хранится уже как доля (0.18)._
   _ВНИМАНИЕ: это потенциальный баг — двойное деление. Нужно проверить на реальных данных._
- `marginRub = revenue − costSum`, `chmdRub = marginRub − adSpend`.
- `stockQty[t] = max(0, stockQty[t-1] − salesQty[t-1])`, начало = `fbo + fbs_pushkino + fbs_smolensk`.

> **Расхождение с разделом 6.1**: `daily_agg_sku.chmd` использует `margin_pct/100`, что некорректно, если `fact_sku_daily.margin_pct` хранится как доля. Это надо проверить — либо парсер `parseSkuReport` зря делит на 100, либо `refresh-daily-agg-sku` зря делит ещё раз.

---

## 7. Вкладки UI (`src/components/tabs/*.tsx`)

| Файл | Tab id | Заголовок | KPI-бар | Главный контент |
|---|---|---|---|---|
| `OverviewTab.tsx` | `svod` | Свод | Выручка, ЧМД, Маржа %, ДРР, Расходы, Себестоимость, Потери | Алерт-карточки (Стоп реклама / Срочный заказ / Убыточная реклама / Масштабировать / Новинки), тренд revenue+chmd+ad_spend, unit-экономика по дням, топ-15 SKU |
| `AnalyticsTab.tsx` | `analytics` | Продажи и экономика | Выручка, ЧМД, Маржа %, ДРР, CPO, Прогноз 30д | Иерархическая таблица Категория → Предмет → SKU, дневной chart |
| `PriceTab.tsx` | `price` | Реклама и воронка | CTR, CR в корзину, CR в заказ, Доля рекл. заказов, CPO | Таблица менеджеров → SKU drill-down, таблица изменений цен с дельтами воронки |
| `OrderTab.tsx` | `orders` | Логистика и заказы | Остаток (руб), Дней до OOS, К заказу (шт), Сумма к заказу, SKU крит., Прогноз 60д | Таблица SKU с расчётом заказа, статусы (Критич/Внимание/Норма) |
| `SkuTableTab.tsx` | `sku` | Аналитика по SKU | Tweets «Показано / В риске SKU» + кнопки фильтров (OOS, ДРР > Маржа, Маржа < 15%, Только с рекламой, Без продаж) | Плоская таблица всех SKU. **27.04: SKU + Название объединены в один столбец, две строки.** Sticky-шапка через `overflow-x: clip`. |
| `NicheTab.tsx` | `niche` | Анализ ниш и ABC | Ср. привлекательность, % выкупа, Сезонных/несезон., Ср. рент. ЧМД, Рент. выручки | 3 графика (heatmap сезонности + 2 ABC-бара) → таблица ниш → SKU drill-down. **Selector периода (последний / по uploads.period_start).** |
| `UpdateTab.tsx` | `update` | Обновление данных | — | 5 карточек загрузки: Свод, АВС, Потребность Китай, Отчёт по SKU, Аналитика |

### 7.1 Глобальные элементы (`src/app/dashboard/page.tsx`)

- **Шапка `header.top-nav`** — sticky, `top-0 z-50`. Содержит: лого → нав-кнопки (7 вкладок) → кнопка «Загрузить» / тема / hamburger.
- **Row 2 (под шапкой)** — DateRangePicker + быстрые периоды (7д/14д/30д/60д) + 3 фильтра (Категория, Новинка, Менеджер). На вкладках «Анализ ниш» и «Обновление» row 2 скрыт.
- **DateRangeProvider** — хранит `{from, to}` в `localStorage.dashDateRange`. Валидация формата ISO; невалидные данные удаляются.
- **GlobalFiltersContext** — `{ category, manager, novelty }`. Меняется в шапке, читается каждой вкладкой через `useGlobalFilters()`.
- **PendingFilterContext** — для перехода с алерта Свода в SKU-таблицу с предзаполненным фильтром (`navigateToSku({ type, label })`).
- **TabErrorBoundary** — оборачивает каждую вкладку. На ошибке показывает stack-trace (20 строк) и кнопку «Скопировать стек».
- **BackgroundPrefetcher** — после `requestIdleCallback` (или 2.5 с) предзагружает данные analytics/prices/overview/sku-table в `tabCache`, чтобы переключение вкладок было мгновенным.

### 7.2 Sticky-шапка таблиц — общая модель

Во вкладках с таблицами шапка приклеивается через `position: sticky` с динамически измеряемым `top`:
1. На каждый sticky-блок (KPI / Summary / Filter / `<thead>`) — `useRef`.
2. В `useEffect` после рендера: `getBoundingClientRect().height` для каждого блока + `header.top-nav`.
3. Сохраняется `stickyTop = { kpi: navH, summary: navH+kpiH, filter: navH+kpiH+summaryH, thead: navH+kpiH+summaryH+filterH }`.
4. Каждый блок получает `style={{ top: stickyTop.X }}`.
5. **Контейнер таблицы должен быть `overflow-x: clip`** (не `auto`!): `overflow-x: auto` создаёт двусторонний scroll-контейнер и ломает sticky по вертикали. Образец — `AnalyticsTab.tsx:934`, `SkuTableTab.tsx:613`. После фикса 27.04 это исправлено и в `NicheTab.tsx:863`.
6. На GlassCard, оборачивающем таблицу — `style={{ isolation: 'auto' }}`, чтобы перебить `.glass { isolation: isolate }` в `globals.css`.

### 7.3 Модальные окна

- **`SkuModal.tsx`** — открывается клик по строке SKU в любой таблице. Загружает `/api/sku-modal?sku_ms=<…>`:
  - dim, snap, abc, daily (30 строк), price_changes (10), note, agregates.
  - Графики: revenue/ad_spend/chmd за 30 дней, история цен.
  - Поле заметки → POST `/api/sku-notes`.
- **`OrderModal.tsx`** — открывается из вкладки «Логистика и заказы». Загружает `/api/order-modal?sku_ms=<…>`:
  - dim, snap, china, abc, sales 31д.
  - Расчёт заказа с ползунком сезонности.

---

## 8. Известные проблемы и точки риска

| Где | Проблема | Серьёзность |
|---|---|---|
| `orders/route.ts:135` | Селектит `abc_class` из `fact_abc`, но колонка дропнута в migration 010. | **средняя** — UI покажет «—» вместо ABC-класса. Нужно перейти на `final_class_1`. |
| `refresh-daily-agg-sku:150` | `cost_sum = revenue × (1 − margin_pct/100)` — потенциальное двойное деление, т.к. парсер уже делит на 100. | **высокая** — если `daily_agg_sku.chmd` неверный, то `fact_daily_agg.chmd` тоже неверный (Свод показывает завышенные цифры). _Проверить вручную сравнением с результатом analytics-роута._ |
| `niches/route.ts` периоды | Берутся из `uploads.period_start`, который заполнялся старым парсером со сдвигом +1 месяц (баг detectPeriodMonthFromHeaders с днём=1). Старые записи остаются неверными до ре-загрузки. | **низкая** — лечится перезагрузкой ABC-файлов в UpdateTab. |
| `parseSkuReport` margin_pct | Делит значение на 100. Если файл уже содержит долю (а не процент) — получим 0.0017 вместо 0.17. | **низкая** (формат файла стабилен), но стоит покрыть тестом. |
| Лимит body 50MB | Задан в `next.config.ts` через `serverActions.bodySizeLimit`, но это касается серверных экшенов, **не route handlers**. Для App Router `/api/upload/abc` лимит может быть 4 MB по умолчанию, что приводит к 413 на больших файлах. | **средняя** — клиент в `UpdateTab` уже выводит понятную ошибку, но фактически некоторые файлы могут не загружаться. |
| Sticky-шапка | Любая обёртка с `overflow-x: auto` в DOM-предке таблицы ломает sticky. Регрессия легко проникает при добавлении карточек. | **средняя** — лечить переходом на `overflow-x: clip` + `isolation: auto`. |
| Дубль `fact_sku_snapshot` vs `fact_sku_daily` snap | Старая таблица `fact_sku_snapshot` присутствует в схеме, но новые uploads пишут в `fact_sku_daily`. Часть документации (`data-mapping.md`) ссылается на старое поведение. | **низкая** — не используется, можно дропнуть после ревизии. |

---

## 9. Чек-лист загрузки данных (порядок!)

Когда пользователь обновляет данные, должен быть **этот порядок** (важно — иначе получим заглушки и пропуски):

1. **Свод** (`catalog`) → `dim_sku` (база справочника).
2. **АВС анализ** (`abc`) → `fact_abc`. Можно загружать несколько месяцев.
3. **Потребность Китай** (`china`) → `fact_china_supply` (фильтрует SKU не из dim_sku, поэтому после п.1).
4. **Отчёт по SKU** (`sku-report`) → `fact_sku_daily` + `fact_price_changes` + автоматический `refresh-daily-agg-sku`.
5. **Аналитика** (`analytics`) → `fact_analytics`.

---

## 10. Команды для разработки

```bash
# Запуск dev-сервера
npm run dev

# Build + типы
npm run build
npx tsc --noEmit

# Lint
npm run lint
```

Основные переменные окружения (`.env.local`):
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_SITE_URL` (для fire-and-forget вызова `/api/admin/refresh-daily-agg-sku`)

---

## 11. Шпаргалка: где что трогать

| Хочу изменить… | Файл/файлы |
|---|---|
| Колонку в Excel-парсере | `src/lib/parsers/parse<Type>.ts` |
| Поле в БД | `supabase/<NN>_*.sql` (создать новую миграцию) + `src/lib/parsers/*.ts` + `src/app/api/upload/<type>/route.ts` |
| Что показывается в KPI «Свод» | `src/app/api/dashboard/overview/route.ts` (расчёт) + `src/components/tabs/OverviewTab.tsx` (рендер) |
| Колонку в таблице SKU | `src/app/api/dashboard/sku-table/route.ts` (поле в response) + `src/components/tabs/SkuTableTab.tsx` (рендер) |
| Новый алерт на «Своде» | `src/app/api/dashboard/overview/route.ts` (счётчик + фокус-список) + `src/components/tabs/OverviewTab.tsx` (карточка) |
| Формулу score | `src/lib/scoring.ts` |
| Тему (светлая/тёмная) | `src/components/ui/ThemeProvider.tsx`, `src/app/globals.css` |
| Глобальный фильтр (категория/менеджер/новинка) | `src/app/dashboard/page.tsx` (FilterDropdown) + каждый dashboard-роут (читает `searchParams.category` и т.д.) |
| Поведение модалки SKU | `src/components/ui/SkuModal.tsx` + `src/app/api/sku-modal/route.ts` |

---

## 12. Что добавить позже

- [ ] Покрыть парсеры юнит-тестами (особенно margin_pct: процент vs доля).
- [ ] Поправить orders/route.ts: `abc_class` → derive из `final_class_1`.
- [ ] Проверить и исправить двойное деление `margin_pct/100` в `refresh-daily-agg-sku`.
- [ ] Добавить per-route export `maxRequestBodySize` для upload-эндпоинтов.
- [ ] Удалить устаревшую `fact_sku_snapshot` из схемы и кода.
- [ ] Добавить feature flags / migration history к этому документу.
