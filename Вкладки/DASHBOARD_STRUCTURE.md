# Marketspace 2.0 — Детальная структура дашборда

> Документ составлен 08.04.2026 на основе анализа исходного кода.  
> Визуальная проверка на https://marketspace-20.vercel.app/dashboard недоступна через WebFetch (требует авторизацию).

---

## 1. Структура папок и файлов

```
src/
├── app/
│   ├── layout.tsx                    ← HTML shell, подключение шрифтов (Plus Jakarta Sans + Lato), ThemeProvider
│   ├── page.tsx                      ← redirect → /dashboard (или landing)
│   ├── dashboard/
│   │   └── page.tsx                  ← ГЛАВНЫЙ ФАЙЛ: навигация, header, DateRangePicker, роутинг вкладок
│   └── api/
│       ├── dashboard/
│       │   ├── overview/route.ts     ← Вкладка «Свод» — данные
│       │   ├── analytics/route.ts    ← Вкладка «Продажи и экономика» — данные
│       │   ├── prices/route.ts       ← Вкладка «Реклама и воронка» — данные
│       │   ├── orders/route.ts       ← Вкладка «Логистика и заказы» — данные
│       │   ├── sku-table/route.ts    ← Вкладка «Аналитика по SKU» — данные
│       │   └── niches/route.ts       ← Вкладка «Анализ ниш и ABC» — данные
│       ├── sku-modal/route.ts        ← Модальное окно SKU (детали по одному артикулу)
│       ├── order-modal/route.ts      ← Модальное окно заказа (детали по логистике SKU)
│       ├── sku-notes/route.ts        ← Сохранение заметок по SKU (POST)
│       ├── upload/
│       │   ├── sku-report/route.ts   ← Парсинг и загрузка «Отчёт по SKU»
│       │   ├── stock/route.ts        ← Парсинг и загрузка «Таблица остатков»
│       │   ├── abc/route.ts          ← Парсинг и загрузка «ABC анализ»
│       │   ├── china/route.ts        ← Парсинг и загрузка «Потребность Китай»
│       │   ├── catalog/route.ts      ← Парсинг и загрузка «Свод» (справочник SKU)
│       │   └── presign/route.ts      ← Генерация signed URL для Supabase Storage
│       ├── uploads/
│       │   └── history/route.ts      ← История загрузок (журнал)
│       └── debug/
│           ├── data-check/route.ts   ← Debug: проверка данных в БД
│           └── mapping/route.ts      ← Debug: проверка маппинга sku_ms ↔ sku_wb
│
├── components/
│   ├── tabs/
│   │   ├── OverviewTab.tsx           ← Вкладка «Свод»
│   │   ├── AnalyticsTab.tsx          ← Вкладка «Продажи и экономика»
│   │   ├── PriceTab.tsx              ← Вкладка «Реклама и воронка»
│   │   ├── OrderTab.tsx              ← Вкладка «Логистика и заказы»
│   │   ├── SkuTableTab.tsx           ← Вкладка «Аналитика по SKU»
│   │   ├── NicheTab.tsx              ← Вкладка «Анализ ниш и ABC»
│   │   └── UpdateTab.tsx             ← Вкладка «Обновление данных»
│   └── ui/
│       ├── GlassCard.tsx             ← Стеклянная карточка (glass morphism)
│       ├── StatCard.tsx              ← Карточка одного KPI-показателя
│       ├── KPIBar.tsx                ← Горизонтальный ряд KPI карточек
│       ├── AlertBox.tsx              ← Алерт (критический / warning / success)
│       ├── FilterBar.tsx             ← Строка фильтров + поиск + экспорт
│       ├── DateRangePicker.tsx       ← Выбор диапазона дат (Zustand-like Context)
│       ├── SkuModal.tsx              ← Модальное окно: детали SKU
│       ├── OrderModal.tsx            ← Модальное окно: детали логистики SKU
│       ├── ScoreBadge.tsx            ← Значок Score 0-100 (🔥 / 🟢 / ⚠️ / 🟠 / 🔴)
│       ├── PriorityBadge.tsx         ← Статус OOS + Маржа (цветовая маркировка)
│       ├── SeasonalitySparkline.tsx  ← Спарклайн сезонности по месяцам
│       ├── ThemeProvider.tsx         ← CSS переменные тем (light/dark)
│       └── ThemeToggle.tsx           ← Кнопка переключения темы
│
├── lib/
│   ├── scoring.ts                    ← Расчёт SKU Score 0-100
│   ├── exportExcel.ts                ← Экспорт таблиц в Excel (SheetJS)
│   ├── supabase/
│   │   ├── server.ts                 ← createServiceClient() — service role key
│   │   ├── client.ts                 ← createBrowserClient() — anon key
│   │   ├── loadKnownSkus.ts          ← Загрузка dim_sku → Map<wb, ms>
│   │   └── downloadFromStorage.ts    ← Скачивание файла из Supabase Storage
│   └── parsers/
│       ├── parseSkuReport.ts         ← Парсер «Отчёт по SKU» (Лист7)
│       ├── parseStock.ts             ← Парсер «Таблица остатков» (Sheet1)
│       ├── parseABC.ts               ← Парсер «ABC анализ»
│       ├── parseChina.ts             ← Парсер «Потребность Китай»
│       ├── parseCatalog.ts           ← Парсер «Свод» (справочник SKU)
│       └── utils.ts                  ← Общие утилиты: readWorkbook, toNum, excelToISO, norm
│
└── public/
    ├── niches.json                   ← Статика: 473 ниши WB (не менять)
    └── order_tab_data.json           ← Fallback-данные для вкладки заказов (≤11 МБ)
```

---

## 2. Навигация и layout

**Файл:** [src/app/dashboard/page.tsx](src/app/dashboard/page.tsx)

### Вкладки (порядок в nav)
| ID | Название | Иконка |
|---|---|---|
| `svod` | Свод | LayoutDashboard |
| `analytics` | Продажи и экономика | BarChart2 |
| `price` | Реклама и воронка | TrendingUp |
| `orders` | Логистика и заказы | ShoppingCart |
| `sku` | Аналитика по SKU | Table2 |
| `niche` | Анализ ниш и ABC | Globe |
| `update` | Обновление данных | Upload (кнопка справа) |

### Header
- **Sticky**, z-index: 50
- **Row 1** (h=52px): Лого «M» (градиент красный) + «Marketspace 2.0» | Desktop nav | Кнопка «Загрузить» | ThemeButton
- **Row 2** (h=28px): `DateRangePicker`
- **Mobile**: hamburger меню, дропдаун со всеми вкладками

### DateRangePicker
- По умолчанию: последние 7 дней (today-6 → today)
- Сохраняется в `localStorage` ключ `'dashDateRange'`
- Формат ISO `YYYY-MM-DD`, передаётся как `?from=...&to=...` во все API

### Тема
- Цикл: light → dark → auto
- Сохраняется в `localStorage` ключ `'theme'`
- Управляется через CSS-переменные в `document.documentElement.dataset.theme`

### PendingFilterContext
- Механизм перехода с алерта на вкладку SKU с активным фильтром
- `navigateToSku({ type, label })` → устанавливает фильтр + переключает на вкладку `'sku'`

---

## 3. Дизайн-система

### CSS-переменные (ThemeProvider)
| Переменная | Назначение |
|---|---|
| `--bg` | Фон страницы |
| `--surface` | Фон карточек |
| `--surface-solid` | Фон инпутов |
| `--surface-hover` | Hover строки таблицы |
| `--border` | Граница элементов |
| `--border-subtle` | Тонкая граница |
| `--text` | Основной текст |
| `--text-muted` | Второстепенный текст |
| `--text-subtle` | Заголовки колонок |
| `--accent` | Акцентный цвет `#E63946` / красный |
| `--accent-glass` | Полупрозрачный акцент |
| `--accent-glow` | Свечение акцента |
| `--success` | Зелёный |
| `--success-bg` | Фон зелёного |
| `--warning` | Жёлтый/оранжевый |
| `--warning-bg` | Фон предупреждения |
| `--danger` | Красный |
| `--danger-bg` | Фон ошибки |
| `--info` | Синий |
| `--info-bg` | Фон информации |
| `--radius-xl` | Радиус скругления карточек |
| `--shadow-sm` | Тень карточки |

### Шрифты
- **Plus Jakarta Sans** 400/500/600/700 (Google Fonts) — основной
- **Lato** 400/700 (Google Fonts) — дополнительный

### Светлая тема (по умолчанию)
- Фон: `#FFFFFF` / `#F8F9FA`
- Текст: `#1A1A2E`

### Тёмная тема
- Фон: `#0D1117`
- Карточки: `bg-white/5 border-white/10 backdrop-blur-md`

### Форматирование чисел (`fmt`)
```typescript
n >= 1_000_000  → "X.XМ"   (миллионы)
n >= 1_000      → "XХК"    (тысячи, без десятичных)
иначе           → String(Math.round(n))
```

### Форматирование процентов (`fmtPct`)
```typescript
(n * 100).toFixed(1) + '%'   // уже как доля 0.xx
```

---

## 4. Supabase таблицы (источники данных)

### Основные таблицы

| Таблица | Тип | Откуда загружается | Описание |
|---|---|---|---|
| `dim_sku` | Справочник | Свод (parseCatalog) | Мастер-справочник: sku_ms, sku_wb, name, brand, category_wb, subject_wb, месяцы сезонности |
| `uploads` | Журнал | Авто | История загрузок: id, file_type, filename, uploaded_at, status, rows_count |
| `fact_sku_daily` | Фактические | Отчёт по SKU (parseSkuReport) | **Главный источник**: метрики по дням — revenue, ad_spend, drr_total, ctr, cr_cart, cr_order, cpm, cpc, ad_order_share |
| `fact_sku_snapshot` | Снапшот | Отчёт по SKU (parseSkuReport) | Снимок: margin_rub, chmd_5d, stock_days, price, manager, novelty_status, fbo_wb, fbs_pushkino, fbs_smolensk |
| `fact_stock_snapshot` | Снапшот | Таблица остатков (parseStock) | Остатки: total_stock(=ADC), fbo_wb, fbs_pushkino, fbs_smolensk, price, margin_pct, supply_date, supply_qty |
| `fact_stock_daily` | Фактические | Таблица остатков (parseStock) | Продажи по дням из остатков: sku_wb, sale_date, sales_qty |
| `fact_price_changes` | История | Таблица остатков (parseStock) | Изменения цены: sku_wb, price_date, price |
| `fact_abc` | Снапшот | ABC анализ (parseABC) | ABC класс, выручка (месячная), chmd, profitability, turnover_days |
| `fact_china_supply` | Снапшот | Потребность Китай (parseChina) | В пути, в производстве, дата прихода |
| `sku_notes` | Заметки | Пользователь | Текстовые заметки по SKU |

### Ключи связи
- `dim_sku.sku_ms` ↔ `fact_sku_daily.sku_ms` — основной JOIN для всех метрик
- `dim_sku.sku_wb` ↔ `fact_stock_snapshot.sku_wb` — для остатков
- `dim_sku.sku_ms` ↔ `fact_sku_snapshot.sku_ms` — для маржи, ЧМД
- `dim_sku.sku_ms` ↔ `fact_abc.sku_ms` — только для ABC-класса
- `uploads.id` = `upload_id` в fact_* таблицах — всегда берётся **последний** по `uploaded_at`

---

## 5. Вкладки — детальное описание

---

### 5.1 Свод (`OverviewTab`)
**Файлы:** [src/components/tabs/OverviewTab.tsx](src/components/tabs/OverviewTab.tsx) + [src/app/api/dashboard/overview/route.ts](src/app/api/dashboard/overview/route.ts)

**API:** `GET /api/dashboard/overview?from=&to=`

#### KPI-бар (6 метрик)
| Метрика | Источник данных | Таблица Supabase | Колонка | Расчёт |
|---|---|---|---|---|
| Выручка | Отчёт по SKU | `fact_sku_daily` | `revenue` | SUM за период |
| ЧМД | Отчёт по SKU | `fact_sku_snapshot` | `chmd_5d` | SUM по всем SKU |
| Маржа % | Отчёт по SKU | `fact_sku_snapshot` | `margin_rub`, `price` | Взвешенная: Σ(margin_rub/price × revenue) / Σrevenue |
| ДРР | Отчёт по SKU | `fact_sku_daily` | `ad_spend`, `revenue` | SUM(ad_spend) / SUM(revenue) |
| SKU в риске | Таблица остатков | `fact_stock_snapshot` | `total_stock` | COUNT где total_stock = 0 |
| Потери | — | — | — | Пока показывает `—` (не рассчитывается) |

#### Графики
1. **Динамика выручки и ЧМД** (AreaChart, 2 оси)
   - X: дата (DD.MM)
   - Y1: Выручка — `fact_sku_daily.revenue` суммированный по датам
   - Y2: ЧМД — `revenue × abcMarginRate` (прокси, если нет прямого ЧМД по дням)
   - Цвет: выручка = `--accent`, ЧМД = `--success`

2. **Критические алерты** (кликабельные → переход в SKU с фильтром):
   - 🚨 STOP реклама — количество OOS SKU
   - ⚠️ Скоро OOS — всегда 0 (не рассчитывается)
   - ⚠️ ДРР > Маржа — всегда 0 (не рассчитывается)
   - 🚀 Потенциал роста — = количество SKU класса A из fact_abc

#### Таблицы
- **По менеджерам**: менеджер, SKU count, выручка, маржа % — из `fact_sku_snapshot.manager` + `fact_sku_daily`
- **ABC распределение**: A/B/C count из `fact_abc.abc_class`
- **ТОП-15 SKU**: по выручке из `fact_sku_daily`, маржа из `fact_sku_snapshot`, ABC из `fact_abc`
  - Кнопка «Excel» — экспорт ТОП-15 в .xlsx

---

### 5.2 Продажи и экономика (`AnalyticsTab`)
**Файлы:** [src/components/tabs/AnalyticsTab.tsx](src/components/tabs/AnalyticsTab.tsx) + [src/app/api/dashboard/analytics/route.ts](src/app/api/dashboard/analytics/route.ts)

**API:** `GET /api/dashboard/analytics?from=&to=`

#### KPI-бар (7 метрик)
| Метрика | Источник | Таблица | Колонка | Расчёт |
|---|---|---|---|---|
| Выручка | Отчёт по SKU | `fact_sku_daily` | `revenue` | SUM за период |
| ЧМД | Отчёт по SKU + ABC | `fact_sku_daily` × `fact_abc` | `chmd` | Пропорция ABC.chmd по доле выручки периода |
| Маржа % | — | — | — | ЧМД / Выручка |
| ДРР | Отчёт по SKU | `fact_sku_daily` | `ad_spend`, `revenue` | SUM(ad_spend)/SUM(revenue) |
| CPO | — | — | — | Всегда `—` (не рассчитывается) |
| Δ Выручки | — | — | — | Всегда `—` (нет данных предыдущего периода) |
| Прогноз 60д | — | — | — | `totalRevenue / daysCount * 60` (линейная экстраполяция) |

#### Графики
1. **Выручка и расходы по дням** (AreaChart)
   - Выручка (`--accent`), ЧМД (`--success`), Расходы (`--danger`, пунктир) — из `fact_sku_daily` по датам
2. **Маржа % vs ДРР % по дням** (LineChart)
   - Маржа% (`--success`), ДРР% (`--accent`) — из тех же данных
   - **Проблема**: Маржа % — прокси через ABC, не точная по дням

#### Таблица по категориям
Данные: `fact_sku_daily` (выручка, ДРР) + `fact_abc` (ЧМД как прокси) + `dim_sku` (категория)

| Колонка | Источник | Расчёт |
|---|---|---|
| Категория | `dim_sku.category_wb` или `subject_wb` | — |
| SKU | `dim_sku` | COUNT из справочника |
| Выручка | `fact_sku_daily.revenue` | SUM по category |
| Δ% | — | Всегда `—` (нет предыдущего периода) |
| ЧМД | `fact_abc.chmd` | Пропорция по доле выручки |
| Маржа | — | ЧМД / Выручка |
| ДРР | `fact_sku_daily.ad_spend / revenue` | По category |
| Остаток | — | Всегда 0 (не рассчитывается) |

**Фильтры таблицы:** Маржа (<15% / 15-25% / >25%), ДРР vs Маржа, Мин. выручка (>100К / >500К / >1М)
**Сортировка:** по любой колонке (клик на заголовок)
**Экспорт:** кнопка → .xlsx

---

### 5.3 Реклама и воронка (`PriceTab`)
**Файлы:** [src/components/tabs/PriceTab.tsx](src/components/tabs/PriceTab.tsx) + [src/app/api/dashboard/prices/route.ts](src/app/api/dashboard/prices/route.ts)

**API:** `GET /api/dashboard/prices?from=&to=`

> Внимание: вкладка называется «Реклама и воронка», но роут и компонент называются `price/PriceTab`

#### KPI-бар (6 метрик)
| Метрика | Excel колонки | Таблица Supabase | Колонка | Расчёт |
|---|---|---|---|---|
| CTR | AX-BB | `fact_sku_daily` | `ctr` | AVG за период |
| CR в корзину | BD-BH | `fact_sku_daily` | `cr_cart` | AVG за период |
| CR в заказ | BJ-BN | `fact_sku_daily` | `cr_order` | AVG за период |
| CPC | BW-CA | `fact_sku_daily` | `cpc` | AVG за период |
| CPM | BQ-BU | `fact_sku_daily` | `cpm` | AVG за период |
| Доля рекл. заказов | CC-CG | `fact_sku_daily` | `ad_order_share` | AVG за период |

#### Графики
1. **Воронка конверсий по дням** (LineChart) — CTR, CR корзина, CR заказ
   - **Проблема**: `data.daily` в PriceTab ожидает `{ctr, cr_basket, cr_order, ad_revenue, organic_revenue}`, но API возвращает `{date, revenue}` — данные по воронке по дням **не отображаются**
2. **Рекламные vs Органические продажи** (BarChart) — нет данных (0)
3. **Цена до/после** (ComposedChart horizontal bars) — из `fact_price_changes`

#### Таблица изменений цен
| Колонка | Источник |
|---|---|
| SKU | `fact_price_changes.sku_wb` |
| Название | `dim_sku.name` |
| Менеджер | `fact_sku_snapshot.manager` |
| Дата | `fact_price_changes.price_date` |
| Было / Стало | `fact_price_changes.price` (предыдущее / текущее) |
| Δ% | (стало - было) / было |
| Δ CTR / Δ CR / CPO / Δ CPM / Δ CPC | Всегда `—` (не рассчитывается — нет данных до/после) |

**Фильтры:** направление цены (рост/снижение), Δ CTR, Δ CR, Δ CPM, CPO
**Поиск:** по названию или SKU
**Экспорт:** .xlsx

---

### 5.4 Логистика и заказы (`OrderTab`)
**Файлы:** [src/components/tabs/OrderTab.tsx](src/components/tabs/OrderTab.tsx) + [src/app/api/dashboard/orders/route.ts](src/app/api/dashboard/orders/route.ts)

**API:** `GET /api/dashboard/orders?from=&to=&horizon=60`

#### KPI-бар (6 метрик)
| Метрика | Источник | Расчёт |
|---|---|---|
| Остаток (руб) | — | Всегда 0 (не рассчитывается — нет цены себестоимости) |
| Среднее дней до OOS | `fact_stock_snapshot.total_stock` / DPD | AVG по всем SKU |
| К заказу (шт) | Расчётный | SUM(calc_order) |
| Сумма к заказу | — | Всегда 0 |
| SKU крит. запас | — | COUNT где status=critical или oos |
| Прогноз продаж 60д | — | Показывает К заказу × 1 (placeholder) |

#### Alert panel (4 блока)
- Критический запас, Требует внимания, OOS с продажами, К заказу

#### Таблица SKU по запасам
| Колонка | Источник | Таблица | Расчёт |
|---|---|---|---|
| SKU WB | `dim_sku.sku_wb` | `dim_sku` | — |
| Название | `dim_sku.name` | `dim_sku` | — |
| Статус | Расчётный | — | oos: stock=0; critical: days < horizon×0.5; warning: days < horizon |
| ABC | `fact_abc.abc_class` | `fact_abc` | — |
| Продажи 31д | `fact_stock_daily.sales_qty` | `fact_stock_daily` | SUM за 31 день от последней даты |
| OOS дней | Расчётный | — | 1 если status=oos, иначе 0 (упрощённо) |
| Наличие | `fact_stock_snapshot.total_stock` | `fact_stock_snapshot` | ADC колонка |
| Остаток дней | Расчётный | — | total_stock / DPD (DPD = продажи/дней со стоком) |
| Лог. плечо | Горизонт из фильтра | — | Параметр `horizon` (60/90/30 дней) |
| Расч. заказ | Расчётный | — | MAX(0, DPD × horizon - already_have), already_have = stock + in_transit + in_prod |
| Заказ менедж. | — | — | Всегда 0 (нет данных из `fact_china_supply.manager_order`) |
| Δ | Расчётный | — | Расч.заказ - Заказ.менедж. |
| Маржа | `fact_abc.profitability` | `fact_abc` | — |

**Горизонт**: 30/60/90 дней (фильтр = лог. плечо для расчёта заказа)
**Фильтры:** Статус (critical/warning/ok), ABC (A/B/C)
**Клик на строку** → открывает `OrderModal` с деталями

---

### 5.5 Аналитика по SKU (`SkuTableTab`)
**Файлы:** [src/components/tabs/SkuTableTab.tsx](src/components/tabs/SkuTableTab.tsx) + [src/app/api/dashboard/sku-table/route.ts](src/app/api/dashboard/sku-table/route.ts)

**API:** `GET /api/dashboard/sku-table?from=&to=&search=&sort=score&dir=desc`

#### Таблица (16 колонок)
| Колонка | Excel | Supabase таблица | Колонка | Расчёт |
|---|---|---|---|---|
| Статус (OOS) | — | `fact_stock_snapshot` | `total_stock` | critical=0; warning<30; ok≥30 |
| SKU | A | `dim_sku` | `sku_wb` или `sku_ms` | — |
| Название | D | `dim_sku` | `name` | — |
| Менеджер | G | `fact_sku_snapshot` | `manager` | — |
| Категория | M | `dim_sku` | `category_wb` / `subject_wb` | — |
| Score | — | — | — | `computeScore()` 0-100 |
| Выручка | AF-AJ | `fact_sku_daily` | `revenue` | SUM за период |
| Маржа % | X | `fact_sku_snapshot` | `margin_rub` / `price` | `margin_rub / price` |
| ЧМД | Z | `fact_sku_snapshot` | `chmd_5d` | Значение из снапшота |
| ДРР | AL-AP | `fact_sku_daily` | `ad_spend`, `revenue` | SUM(ad_spend)/SUM(revenue) |
| CTR | AX-BB | `fact_sku_daily` | `ctr` | AVG за период |
| CR корз. | BD-BH | `fact_sku_daily` | `cr_cart` | AVG за период |
| CR заказ | BJ-BN | `fact_sku_daily` | `cr_order` | AVG за период |
| Остаток | ADC | `fact_stock_snapshot` | `total_stock` | Значение из снапшота |
| Запас дн. | W | `fact_sku_snapshot` | `stock_days` | Значение из снапшота |
| CPO | — | `fact_sku_daily` | `ad_spend` | ad_spend / days (если >0) |

#### Цветовая логика
- **Маржа%**: `>10%` → зелёный, `<10%` → красный
- **ДРР**: `drr > margin_pct` → красный, иначе серый
- **Запас дн.**: `<14` → красный, `14-30` → жёлтый, `>30` → серый
- **Score**: 🔥 80+ красный, 🟢 60+ зелёный, ⚠️ 40+ жёлтый, 🟠 20+ оранжевый, 🔴 <20 тёмно-красный

#### Фильтры
- **Поиск**: по name, sku_ms, brand (ilike)
- **Новинки**: все / только новинки / без новинок
- **OOS**: все / критично / внимание / норма
- **ДРР**: все / ДРР>Маржа / ДРР<Маржа
- **Маржа**: все / <15% / 15-20% / >20%
- **Доп. фильтры** (боковая панель): OOS крит., ДРР>Маржа, Маржа<15%, Только с рекламой

**Клик на строку** → открывает `SkuModal`
**Сортировка** по любой колонке (default: Score desc)

---

### 5.6 Анализ ниш и ABC (`NicheTab`)
**Файлы:** [src/components/tabs/NicheTab.tsx](src/components/tabs/NicheTab.tsx) + [src/app/api/dashboard/niches/route.ts](src/app/api/dashboard/niches/route.ts)

**API:** `GET /api/dashboard/niches`  
*(не принимает date range — статичные данные)*

#### KPI-бар (4 метрики из summary)
| Метрика | Источник |
|---|---|
| Ср. привлекательность | Расчётный (AVG из ниш) |
| Доля рынка | `fact_abc.profitability` (прокси) |
| Сезонных ниш | COUNT где seasonal=true |
| Средний ABC | Расчётный |

#### Таблица ниш
Данные агрегируются по `dim_sku.subject_wb` (ниша) с данными из `fact_abc`:

| Колонка | Источник |
|---|---|
| Ниша/категория | `dim_sku.subject_wb` |
| Рейтинг | Расчётный (из fact_abc) |
| Привлекательность | `fact_abc.profitability` |
| Выручка | `fact_abc.revenue` |
| Сезонность | `dim_sku.month_jan..month_dec` → SparklineChart |
| Старт/Пик | Расчётный из месяцев |
| Доступность | — |
| ABC | `fact_abc.abc_class` |

---

### 5.7 Обновление данных (`UpdateTab`)
**Файл:** [src/components/tabs/UpdateTab.tsx](src/components/tabs/UpdateTab.tsx)

#### 5 карточек загрузки
| Порядок | Тип | Файл | API роут |
|---|---|---|---|
| 1 | `catalog` | Свод.xlsb | `/api/upload/catalog` |
| 2 | `abc` | ABC_анализ_*.xlsx | `/api/upload/abc` |
| 3 | `china` | Потребность_Китай_*.xlsx | `/api/upload/china` |
| 4 | `stock` | Таблица_Остатков_*.xlsb | `/api/upload/stock` |
| 5 | `sku-report` | Отчет_по_SKU_*.xlsb | `/api/upload/sku-report` |

#### Механизм загрузки
1. Presign URL через `/api/upload/presign` (service role)
2. Прямая загрузка в Supabase Storage
3. POST на `/api/upload/{type}` → скачивает из Storage → парсит → пишет в Supabase → возвращает `rows_parsed`

#### История загрузок
Таблица из `uploads` — тип, имя файла, дата, кол-во строк, статус

---

## 6. Модальные окна

### 6.1 SkuModal
**Открывается**: клик на строку в SkuTableTab или OrderTab  
**API:** `GET /api/sku-modal?sku_ms=...`

#### Содержимое
| Блок | Источник |
|---|---|
| Заголовок: название, бренд, категория, менеджер | `dim_sku` |
| Метрики снапшота: маржа, ЧМД, запас дней, цена | `fact_sku_snapshot` |
| Остатки: FBO, FBS Пушкино, FBS Смоленск | `fact_stock_snapshot` |
| ABC данные: класс, выручка, ЧМД чистый, оборачиваемость | `fact_abc` |
| График выручки + расходов по дням | `fact_sku_daily` (30 дней) |
| Агрегаты: Выручка, ДРР, CTR, CR, CPM, CPC | `fact_sku_daily` AVG/SUM |
| История цен (10 последних) | `fact_price_changes` |
| Заметка (редактируемая) | `sku_notes` |

**Кнопка «Сохранить»** → POST `/api/sku-notes`

### 6.2 OrderModal
**Открывается**: клик на строку в OrderTab  
**API:** `GET /api/order-modal?sku_ms=...`

---

## 7. SKU Score — формула

**Файл:** [src/lib/scoring.ts](src/lib/scoring.ts)

```
score = marginScore(30) + drrScore(20) + growthScore(15) + crScore(15) + stockScore(20)

marginScore = MIN(margin_pct / 0.30, 1) × 30
drrScore    = drr ≤ 0 → 20; иначе MAX(0, 1 - drr/0.30) × 20
growthScore = MIN(MAX((revenue_growth + 0.2) / 0.4, 0), 1) × 15
crScore     = MIN(cr_order / 0.05, 1) × 15
stockScore  = stock_days ≥ 30 → 20; иначе (stock_days/30) × 20

Штрафы:
-20  если OOS (total_stock = 0)
-15  если DRR > margin_pct
-10  если новинка < 30 дней с низкой выручкой

Диапазон: 0-100, округляется
Классы: 🔥 80+ / 🟢 60+ / ⚠️ 40+ / 🟠 20+ / 🔴 <20
```

**Важно**: `revenue_growth` всегда = 0 (нет данных предыдущего периода), `is_novelty_low` всегда false → соответствующие компоненты не работают полностью.

---

## 8. Парсеры Excel

### Отчёт по SKU (`parseSkuReport.ts`)
- **Лист**: `Лист7`
- **Смещение `pos`**: ищет "Затраты план" в cols 27-40 строки 1, `pos = найденная_позиция - 32`
- **Блоки**: каждый блок = 1 заголовок + 5 дат + 5 значений (5 дней)

| Блок | Excel колонки | DB колонка |
|---|---|---|
| Затраты (ad_spend) | 11-15 | `fact_sku_daily.ad_spend` |
| Выручка Total | 31-35 | `fact_sku_daily.revenue` |
| ДРР Total | 37-41 | `fact_sku_daily.drr_total` |
| ДРР рекл. | 43-47 | `fact_sku_daily.drr_ad` |
| CTR | 49-53 | `fact_sku_daily.ctr` |
| CR в корзину | 55-59 | `fact_sku_daily.cr_cart` |
| CR в заказ | 61-65 | `fact_sku_daily.cr_order` |
| CPM | 68-72 | `fact_sku_daily.cpm` |
| CPC | 74-78 | `fact_sku_daily.cpc` |
| Доля рекл. заказов | 80-84 | `fact_sku_daily.ad_order_share` |

Снапшот из строк:
- col 16: FBO WB → `fact_sku_snapshot.fbo_wb`
- col 17: FBS Пушкино → `fact_sku_snapshot.fbs_pushkino`
- col 18: FBS Смоленск → `fact_sku_snapshot.fbs_smolensk`
- col 20: остаток дни → `fact_sku_snapshot.stock_days`
- col 23: Маржа Опер. → `fact_sku_snapshot.margin_rub`
- col 25: ЧМД за 5 дней → `fact_sku_snapshot.chmd_5d`
- col 66: Цена → `fact_sku_snapshot.price`
- col 6: Менеджер → `fact_sku_snapshot.manager`
- col 8: Статус новинки → `fact_sku_snapshot.novelty_status`

### Таблица остатков (`parseStock.ts`)
- **Лист**: `Sheet1`
- **Строка заголовков**: 5 (0-based), данные с 6
- **Поиск колонок**: по заголовку (norm = нижний регистр)

| Excel заголовок | DB колонка |
|---|---|
| SKU / Артикул WB | `fact_stock_snapshot.sku_wb` |
| ADC (Всего / Итого остат.) | `fact_stock_snapshot.total_stock` |
| Остаток на ВБ ФБО | `fact_stock_snapshot.fbo_wb` |
| FBS Пушкино | `fact_stock_snapshot.fbs_pushkino` |
| FBS Смоленск | `fact_stock_snapshot.fbs_smolensk` |
| Цена утром / Цена | `fact_stock_snapshot.price` / `fact_price_changes.price` |
| Маржа | `fact_stock_snapshot.margin_pct` |
| Датированные колонки 16-340 | `fact_stock_daily.sale_date, sales_qty` + `fact_price_changes` |

---

## 9. Известные проблемы и ограничения

| Проблема | Статус | Описание |
|---|---|---|
| Вкладка «Реклама»: графики по дням пустые | ❌ Баг | API возвращает `{date, revenue}`, компонент ожидает `{ctr, cr_basket, cr_order, ad_revenue, organic_revenue}` |
| Маржа в Analytics: прокси через ABC | ⚠️ Неточно | ЧМД/Маржа по дням = revenue × (totalAbcChmd/totalAbcRevenue) — не точно |
| Δ Выручки, Δ% категорий | ❌ Не работает | Нет данных предыдущего периода — всегда `—` или 0 |
| Потери (Свод KPI) | ❌ Нет данных | Не рассчитывается |
| Скоро OOS / ДРР>Маржа алерты | ❌ Всегда 0 | Не реализован расчёт |
| Заказ менеджера (OrderTab) | ❌ Всегда 0 | Поле `manager_order` не загружается из fact_china_supply |
| Остаток (руб) OrderTab KPI | ❌ Всегда 0 | Нет расчёта stock × price |
| OOS дней (OrderTab) | ⚠️ Упрощённо | Всегда 0 или 1 — не считает кол-во дней без стока |
| Score: revenue_growth | ❌ Всегда 0 | Компонент роста не работает |
| Вкладка Ниш: данные | ⚠️ ABC | Выручка/ЧМД из fact_abc (месячные), не из fact_sku_daily |
| DateRange на NicheTab | ❌ Игнорируется | API `/niches` не принимает from/to |

---

## 10. Переменные окружения

```env
NEXT_PUBLIC_SUPABASE_URL          ← URL Supabase проекта
NEXT_PUBLIC_SUPABASE_ANON_KEY     ← Anon key (фронтенд)
SUPABASE_SERVICE_ROLE_KEY         ← Service role key (API routes, парсеры)
```

---

## 11. Деплой и инфраструктура

- **Платформа**: Vercel free tier
- **Ограничения**: функции макс. 60 сек (`export const maxDuration = 30/60`)
- **Авто-деплой**: `git push origin main` → Vercel
- **Dev**: `npm run dev` (Turbopack, http://localhost:3000)
- **Build**: `npm run build` — ОБЯЗАТЕЛЬНО перед push

---

## 12. Что нужно доделать (приоритеты)

| # | Задача | Важность |
|---|---|---|
| 1 | Загрузить старые Отчёты по SKU за февраль, март, апрель | 🔴 Критично |
| 2 | Исправить daily в prices/route — добавить ctr/cr/ad_revenue по датам | 🔴 Критично |
| 3 | Рассчитать алерты: Скоро OOS, ДРР>Маржа (count в overview/route) | 🟠 Высокое |
| 4 | Рассчитать Потери = OOS SKU × DPD × Маржа | 🟠 Высокое |
| 5 | Загрузить manager_order из fact_china_supply в orders/route | 🟡 Среднее |
| 6 | Рассчитать Остаток (руб) = total_stock × price | 🟡 Среднее |
| 7 | Добавить данные предыдущего периода для Δ Выручки | 🟡 Среднее |
| 8 | Передать DateRange в niches/route | 🟢 Низкое |
