# Логика расчётов и маппинга — Marketspace 2.0

> Документ составлен 08.04.2026 на основе анализа исходного кода.  
> Статусы: ✅ Реализовано | ⚠️ Частично / упрощённо | ❌ Не реализовано

---

## 1. Логика поиска артикула WB/SKU — как данные из разных таблиц связываются

### Проблема

В Excel-файлах разные таблицы используют разные идентификаторы:
- **Отчёт по SKU** → col 0 = «Артикул МС» (строка типа `NWTPS100N3`) или «Артикул склада»
- **Таблица остатков** → col B = «SKU» (числовой WB артикул типа `123456789`)
- **ABC анализ** → col B = «Артикул склада» = sku_ms (строка)
- **Потребность Китай** → «Артикул склада» = sku_ms (строка)
- **Свод** → col B = «Артикул МС» = sku_ms (строка) + col = «Артикул WB» (число)

### Как это работает (реализовано ✅)

**Главный справочник: `dim_sku`**

```
dim_sku
├── sku_ms    → строка "NWTPS100N3" (Артикул МС / Артикул склада) — ГЛАВНЫЙ КЛЮЧ
├── sku_wb    → число 123456789 (Артикул WB) — внешний ключ для Таблицы остатков
├── name      → название товара
└── ...прочие поля
```

`dim_sku` заполняется при загрузке **Свода** (`/api/upload/catalog` → `parseCatalog`). Свод содержит оба артикула в одной строке — это единственное место, где они явно связаны.

### Маппинг при загрузке Отчёта по SKU

```typescript
// /api/upload/sku-report/route.ts

// Шаг 1: загружаем маппинг из dim_sku
const skuMap = new Map<string, string>()  // "123456789" (строка WB) → "NWTPS100N3" (sku_ms)
const { data } = await supabase.from('dim_sku').select('sku_wb,sku_ms').not('sku_wb','is',null)
for (const row of data) {
  skuMap.set(String(row.sku_wb), row.sku_ms)
}

// Шаг 2: при парсинге каждой строки
const rawSku = String(row[skuCol]).trim()   // читаем col 0 (может быть "123456789" или "NWTPS100N3")
const skuMs = skuMap.get(rawSku) ?? rawSku  // конвертируем WB → MS, если нет в маппинге — используем как есть
```

Парсер ищет колонку SKU по заголовкам: `'sku'`, `'артикул мс'`, `'артикул склада'`, `'артикул'`, `'номенклатура'`. Fallback — col 0.

Если строка не найдена в `skuMap` → SKU записывается в `skipped_skus`, **строка пропускается**.

### Маппинг при загрузке Таблицы остатков

```typescript
// /api/upload/stock/route.ts

// Маппинг числовой → строковый
const skuMap = new Map<number, string>()  // 123456789 → "NWTPS100N3"
const { data } = await supabase.from('dim_sku').select('sku_wb,sku_ms').not('sku_wb','is',null)
for (const row of data) {
  skuMap.set(row.sku_wb, row.sku_ms)      // ключ — число
}

// При парсинге строки
const skuWb = Math.round(toNum(row[skuWbCol]))  // числовой WB артикул
const skuMs = skuMap.get(skuWb) ?? null          // ищем в dim_sku, может быть null
```

Таблица остатков хранит данные **по sku_wb** (ключ = число). sku_ms добавляется как дополнительное поле для JOIN с другими таблицами.

### Маппинг в ABC анализе и Потребности Китай

Оба файла используют **«Артикул склада»** = sku_ms напрямую, без конвертации. Никакого маппинга не требуется — ключ уже в нужном формате.

### JOIN в API-роутах

```
Запрос данных в overview/sku-table/analytics:

1. dim_sku → получаем список sku_ms + sku_wb
2. fact_sku_daily.in('sku_ms', skuMsList)    ← JOIN по sku_ms
3. fact_sku_snapshot.in('sku_ms', skuMsList) ← JOIN по sku_ms
4. fact_stock_snapshot.in('sku_wb', wbList)  ← JOIN по sku_wb
5. fact_abc.in('sku_ms', skuMsList)          ← JOIN по sku_ms
```

### Что происходит если нет совпадения

- Если `sku_ms` есть в `dim_sku`, но нет в `fact_sku_daily` → revenue=0, drr=null
- Если `sku_wb` есть в `dim_sku`, но нет в `fact_stock_snapshot` → stock=0
- Если `sku_ms` есть в Отчёте, но нет в `dim_sku` → строка **пропускается** при загрузке

### Схема маппинга

```
Свод (Catalog)
    ↓ parseCatalog()
dim_sku
    sku_ms ←→ sku_wb           ← справочник-мост

Отчёт по SKU                   Таблица остатков
col 0: WB арт (строка)        col B: WB арт (число)
    ↓ skuMap[wb_str] → ms          ↓ skuMap[wb_int] → ms
fact_sku_daily.sku_ms          fact_stock_snapshot.sku_wb
fact_sku_snapshot.sku_ms            + sku_ms (nullable)

ABC анализ                     Потребность Китай
col B: Артикул склада = ms     col: Артикул склада = ms
    ↓ напрямую                     ↓ напрямую
fact_abc.sku_ms                fact_china_supply.sku_ms
```

---

## 2. Логика расчёта всех показателей, которых нет в исходных таблицах

### 2.1 OOS Статус (oos_status) ✅

```typescript
// sku-table/route.ts
const oos_status =
  totalStock === 0 ? 'critical' :
  totalStock < 30  ? 'warning' :
  'ok'
```

**Проблема**: порог 30 шт — жёсткий константой. Не учитывает скорость продаж, логистическое плечо.  
**Как должно быть**: `totalStock < lead_time_days × DPD → warning`, `totalStock = 0 → critical`.

### 2.2 Статус маржи (margin_status) ✅

```typescript
const margin_status =
  marginPct > 0.20 ? 'high' :
  marginPct > 0.10 ? 'medium' :
  'low'
```

### 2.3 ДРР ✅

```typescript
// Если есть выручка — считаем из суммарных данных (точнее, чем AVG)
const drr = revenue > 0
  ? adSpend / revenue
  : avg(daily?.drr ?? [])   // fallback: среднее из daily.drr_total
```

> Формула: `ad_spend ÷ revenue`. Это ДРР от всей выручки (total), не от рекламной.

### 2.4 CPO (стоимость заказа) ⚠️

```typescript
// sku-table/route.ts
const cpo = daily && daily.days > 0 && adSpend > 0
  ? adSpend / daily.days
  : null
```

**Проблема**: это НЕ стоимость заказа. Это `ad_spend / дней` — просто дневной рекламный бюджет.  
**Правильная формула**: `CPO = ad_spend / orders_count`  
Количество заказов (`orders_count`) в базе данных **отсутствует** — не загружается из отчёта.  
**Данные для правильного CPO**: нужны заказы из `fact_sku_daily` или отдельная колонка.

### 2.5 Маржа % ✅

```typescript
// Берём margin_rub (=Маржа Опер., col X в Excel) и price (col 66)
// из fact_sku_snapshot (Отчёт по SKU)
const marginPct = margin_rub != null && price > 0
  ? margin_rub / price              // % маржи = операционная маржа ₽ / цена ₽
  : stockSnap?.margin_pct ?? 0     // fallback: из Таблицы остатков (если есть)
```

> `margin_rub` = Маржа Операционная в рублях на единицу (col X Отчёта по SKU).

### 2.6 ЧМД (Чистый Маржинальный Доход) ✅ (частично)

```typescript
// sku-table/route.ts
const chmd = skuSnap?.chmd_5d ?? 0
```

`chmd_5d` = ЧМД за 5 дней в рублях — **снапшот**, не динамика.  
В `analytics/route.ts` ЧМД по дням считается как `revenue × abcMarginRate` — **прокси**, не точный расчёт.

**Правильный ЧМД по дням** требует чистые данные из ABC за конкретную дату. Пока не реализован.

### 2.7 Потери ❌

```typescript
// overview/route.ts
// В ответе: lost_revenue: data.kpi.lost_revenue — всегда undefined/null
// Нигде не рассчитывается
```

**Как должно быть**:
```
Потери = SUM по OOS SKU: DPD × days_oos × price × margin_pct
DPD (продажи в день) = sales_31d / 31
days_oos = количество дней без стока за период
```

Данные для расчёта есть (`fact_stock_daily.sales_qty`, `fact_stock_snapshot.total_stock`), но логика **не реализована**.

### 2.8 Алерты «Скоро OOS» и «ДРР > Маржа» ❌

```typescript
// overview/route.ts
// AlertBox count={0} — жёстко прописано ноль
<AlertBox title="Скоро OOS" count={0} />
<AlertBox title="ДРР > Маржа" count={0} />
```

**Как должно быть**:
```
Скоро OOS = COUNT SKU где stock_days < lead_time_days
ДРР > Маржа = COUNT SKU где drr > margin_pct
```

Данные есть, логика **не реализована** в overview/route.ts.

### 2.9 SKU Score 0-100 ✅

Реализован в `src/lib/scoring.ts`:

```typescript
score = marginScore(30) + drrScore(20) + growthScore(15) + crScore(15) + stockScore(20)

marginScore = MIN(margin_pct / 0.30, 1) × 30     // 100% балл при марже 30%+
drrScore    = drr ≤ 0 → 20 | MAX(0, 1-drr/0.30) × 20  // 100% балл при ДРР 0%
growthScore = MIN(MAX((growth+0.2)/0.4, 0), 1) × 15    // всегда 0 (growth=0)
crScore     = MIN(cr_order / 0.05, 1) × 15        // 100% балл при CR заказ ≥ 5%
stockScore  = stock_days≥30 → 20 | (stock_days/30)×20

Штрафы: -20 (OOS), -15 (drr>margin), -10 (новинка < 30д, низкая выручка)
```

**Не работает**: `growthScore` (нет данных предыдущего периода), `is_novelty_low` (всегда false).

### 2.10 Δ Выручки (delta_revenue_pct) ❌

```typescript
// analytics/route.ts
summary = {
  revenue_prev: 0,     // всегда 0
  delta_revenue_pct: null,  // всегда null → показывает «—»
}
```

**Как должно быть**: сравнение с аналогичным предыдущим периодом.
```
Если выбран период from→to (N дней):
  prev_from = from - N дней
  prev_to   = to - N дней
  delta = (revenue_cur - revenue_prev) / revenue_prev
```

Данные в `fact_sku_daily` есть (если загружены исторические отчёты). Логика **не реализована**.

### 2.11 Прогноз 60 дней ✅ (упрощённо)

```typescript
// analytics/route.ts
forecast_60d = Math.round(totalRevenue / daysCount * 60)
// daysCount = количество уникальных дат в периоде
```

Простая линейная экстраполяция: `(выручка за период / дней) × 60`.  
**Не учитывает**: сезонность, тренд, OOS дни.

---

## 3. Логика расчёта GMROI

### Текущее состояние ❌

**GMROI в проекте не реализован.** Нигде не рассчитывается и не отображается.

### Что такое GMROI

**GMROI** (Gross Margin Return On Inventory) = валовая маржа / среднюю стоимость запаса.

Показывает: сколько рублей маржи приносит каждый рубль, вложенный в товарный запас.

> Если GMROI = 2.5 → каждый рубль в запасах генерирует 2.5 руб. маржи. Норма для WB: > 2.0

### Формула

```
GMROI = ЧМД_чистый / ТЗ_средний

Где:
  ЧМД_чистый = чистый маржинальный доход (чмд_clean из ABC)
  ТЗ_средний = средний товарный запас в рублях за период
             = AVG(остаток_шт × себестоимость) за каждый день периода
```

### Данные в базе

| Что нужно | Таблица | Колонка | Статус |
|---|---|---|---|
| ЧМД чистый | `fact_abc` | `chmd_clean` | ✅ загружается |
| Товарный запас (ТЗ) | `fact_abc` | `tz` | ✅ загружается |
| Оборачиваемость дни | `fact_abc` | `turnover_days` | ✅ загружается |

В `fact_abc` хранится `tz` (товарный запас ₽) и `chmd_clean` (чистый ЧМД) из ABC анализа.

### Как рассчитать (предложение)

```typescript
// Для каждого SKU:
const gmroi = abc.tz > 0
  ? abc.chmd_clean / abc.tz
  : null

// Для категории (взвешенный):
const categoryGmroi = totalChmdClean / totalTz
```

**Ограничение**: `tz` и `chmd_clean` из ABC — месячные данные. Для точного GMROI по выбранному периоду нужны ежедневные данные об остатках в рублях, которые не загружаются.

**Быстрое решение** (достаточно точно):
```
GMROI = ABC.chmd_clean / ABC.tz
```
Вывести на вкладке «Аналитика» или «Свод» как KPI.

---

## 4. Логика расчёта количества штук к заказу

### Текущее состояние ✅ (базовая версия реализована)

```typescript
// orders/route.ts

// Данные:
const totalStock = fact_stock_snapshot.total_stock     // текущий остаток (ADC)
const inTransit  = fact_china_supply.in_transit        // в пути
const inProd     = fact_china_supply.in_production     // в производстве
const alreadyHave = totalStock + inTransit + inProd    // уже есть или едет

// DPD (продажи в день):
const dpd31 = SUM(fact_stock_daily.sales_qty за 31 день)
const daysWithStock = COUNT(дней где sales_qty > 0)    // только дни со стоком
const dpd = daysWithStock > 0 ? dpd31 / daysWithStock : 0

// Горизонт планирования = параметр horizon (60/90/30 дней):
const logPleche = horizon   // дни

// Расчётный заказ:
const calc_order = MAX(0, ROUND(dpd × logPleche - alreadyHave))
```

### Пример

```
Остаток: 50 шт
В пути: 30 шт
В производстве: 0 шт
Продажи за 31 день: 124 шт, из них 20 дней со стоком
DPD = 124 / 20 = 6.2 шт/день
Горизонт = 60 дней
Нужно = 6.2 × 60 = 372 шт
Уже есть = 50 + 30 + 0 = 80 шт
К заказу = MAX(0, 372 - 80) = 292 шт
```

### Что НЕ реализовано ❌

| Элемент | Статус | Описание |
|---|---|---|
| Заказ менеджера | ❌ | `manager_order` всегда 0. В `fact_china_supply` есть поле `order_qty` — не подтягивается |
| Лог. плечо из Зеленки | ⚠️ | `lead_time_days` из parseChina читается из вкладки «Зеленка», но в `orders/route.ts` используется `horizon` из URL-параметра, игнорируя реальное плечо из БД |
| Запас дней (от плеча) | ⚠️ | Сравнивает `daysStock < horizon`, а не `daysStock < lead_time_days` |
| Резерв 15 дней | ❌ | `reserve_15d` из Потребности Китай загружается, но не используется в расчёте |

### Как должно быть (полная формула)

```
DPD = sales_31d / days_with_stock       (очищенный от OOS дней)
stock_days = totalStock / DPD           (дней текущего остатка)
lead_time = fact_china_supply.lead_time_days  (реальное плечо из Зеленки)

К заказу = MAX(0, DPD × (lead_time + reserve) - alreadyHave)
  reserve = 15-30 дней страхового запаса

Статусы:
  critical = stock_days < lead_time × 0.5
  warning  = stock_days < lead_time
  ok       = stock_days ≥ lead_time
```

---

## 5. Логика расчёта прогноза продаж на 30/60/90 дней

### Текущее состояние ⚠️ (упрощённо)

#### В Analytics (вкладка «Продажи и экономика»)

```typescript
// analytics/route.ts + AnalyticsTab.tsx
const forecast_60d = Math.round(totalRevenue / daysCount * 60)
// totalRevenue = выручка за выбранный период
// daysCount = количество дней в периоде
// Просто линейная экстраполяция: выручка_в_день × 60
```

Компонент отображает: `fmt(Math.round(s.revenue / 30 * 60))` — то есть умножает выручку на 2.

#### В Orders (вкладка «Логистика»)

```typescript
// orders/route.ts — расчёт DPD для каждого SKU
const dpd = daysWithStock > 0 ? dpd31 / daysWithStock : 0
// dpd = продажи в день (очищенные от дней без стока)

// В KPI баре:
value: fmt(Math.round((s.to_order_count ?? 0) * 1))
// Это просто to_order_count — ЗАГЛУШКА, не прогноз
```

### Что реализовано в разных местах

| Место | Формула | Статус |
|---|---|---|
| Analytics KPI «Прогноз 60д» | `revenue / daysCount × 60` | ✅ есть, упрощённо |
| Orders DPD (для заказа) | `sales_31d / days_with_stock` | ✅ есть |
| Orders прогноз 60д KPI | заглушка = to_order_count | ❌ неверно |
| SKU Modal | нет | ❌ нет |

### Как должно быть (полноценный прогноз)

#### Простой прогноз (без сезонности)

```
DPD = sales_N_days / N   (где N = период без дней OOS)
sales_30d = DPD × 30
sales_60d = DPD × 60
sales_90d = DPD × 90
```

#### С сезонной корректировкой (данные есть!)

В `dim_sku` хранятся сезонные коэффициенты по месяцам:
`month_jan`, `month_feb`, ..., `month_dec` — загружаются из Свода.

```
Сезонный прогноз:
base_sales_per_day = DPD_last_31d

Для прогноза на N дней:
  forecast = Σ (base_sales_per_day × season_coeff[month]) по каждому дню горизонта

Где season_coeff[month] = month_apr / max(month_jan..month_dec)
// нормированный коэффициент: 1.0 = пиковый месяц
```

**Пример:**
```
DPD = 5 шт/день (апрель)
dim_sku.month_apr = 1.2, month_jul = 0.6 (спад летом)

Прогноз апрель (30 дней) = 5 × 1.0 × 30 = 150 шт
Прогноз май-июнь (60 дней) = 5 × 0.9 × 60 = 270 шт (с учётом спада)
```

#### Данные для прогноза в ₽

```
forecast_revenue_30d = DPD_qty × price × 30     (прогноз выручки)
forecast_revenue_60d = DPD_qty × price × 60
forecast_chmd_60d    = DPD_qty × margin_rub × 60 (прогноз маржи)
```

Все данные (`price` из `fact_sku_snapshot`, `margin_rub`, продажи из `fact_stock_daily`) **в базе есть**.

---

## 6. Сводная таблица статусов расчётов

| Показатель | Реализован | Точность | Что нужно для улучшения |
|---|---|---|---|
| ДРР | ✅ | Высокая | — |
| Маржа % | ✅ | Высокая | — |
| ЧМД (снапшот) | ✅ | Средняя | Нужна динамика по дням |
| OOS статус | ✅ | Низкая | Учитывать DPD и lead_time |
| SKU Score | ✅ | Средняя | revenue_growth не работает |
| К заказу (расч.) | ✅ | Средняя | Использовать lead_time из Зеленки |
| Прогноз (линейный) | ✅ | Низкая | Добавить сезонность |
| CPO | ⚠️ | Неверная | Нужны заказы (orders_count) |
| ЧМД по дням | ⚠️ | Низкая | Нет ежедневного ЧМД в отчёте |
| Δ Выручки | ❌ | — | Загрузить исторические данные |
| Потери | ❌ | — | Реализовать: DPD × days_oos × margin |
| GMROI | ❌ | — | Использовать fact_abc.tz + chmd_clean |
| Алерты (Скоро OOS) | ❌ | — | COUNT где stock_days < lead_time |
| Алерты (ДРР>Маржа) | ❌ | — | COUNT где drr > margin_pct |
| Заказ менеджера | ❌ | — | Подтянуть order_qty из fact_china_supply |
| Сезонный прогноз | ❌ | — | Использовать dim_sku.month_* |
| Остаток (руб) | ❌ | — | total_stock × cost (нет себестоимости) |
