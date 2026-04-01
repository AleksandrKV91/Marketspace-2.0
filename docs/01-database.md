# БД — Структура Supabase

## Принципы

1. **Идемпотентность** — повторная загрузка не ломает данные (UPSERT везде)
2. **Трассируемость** — каждая строка знает из какого файла пришла (`upload_id`)
3. **Whitelist** — парсер берёт только нужные поля, игнорирует остальные
4. **Свод = главный справочник** — все артикулы и названия берутся из него

---

## Таблицы

### `uploads` — история загрузок
```sql
id          uuid PK
file_type   text  -- 'sku_report' | 'stock' | 'abc' | 'china' | 'catalog'
filename    text
uploaded_by uuid → auth.users
uploaded_at timestamptz
period_start date
period_end  date
rows_count  int
status      text  -- 'ok' | 'error'
error_msg   text
```

---

### `dim_sku` — справочник SKU (из Свода, загружается редко)
```sql
sku_ms        text PK   -- Артикул МС (главный ключ связи)
sku_wb        bigint     -- Артикул WB
sku_warehouse text       -- Артикул склада
sku_china     text       -- Артикул Китай
name          text       -- Название
brand         text
supplier      text
country       text
subject_wb    text       -- Предмет WB
category_wb   text       -- Категория WB
nds_pct       numeric    -- НДС %
market_share  numeric    -- Доля рынка (статика)
niche_appeal  numeric    -- Привлекательность ниши (статика)
availability  text       -- Доступность (статика)
buyout_pct    numeric    -- % выкупа по нише (статика, не наш товар)
avg_rating    numeric    -- Средний рейтинг по нише (статика)
seasonality   text       -- тип сезонности
season_start  text       -- старт сезона (месяц)
season_length int        -- длина сезона (мес)
top_month     text       -- пиковый месяц
month_jan     numeric    -- коэффициент января (0-2)
month_feb     numeric
month_mar     numeric
month_apr     numeric
month_may     numeric
month_jun     numeric
month_jul     numeric
month_aug     numeric
month_sep     numeric
month_oct     numeric
month_nov     numeric
month_dec     numeric
top_phrase    text       -- топ-фраза WB
updated_at    timestamptz
```

---

### `fact_sku_daily` — дневные метрики из Отчёта по SKU (основная таблица)
Уникальный ключ: `(sku_ms, metric_date)`

```sql
sku_ms           text → dim_sku
metric_date      date
upload_id        uuid → uploads

-- реклама
ad_spend         numeric    -- затраты
revenue          numeric    -- выручка
drr_total        numeric    -- ДРР общий
drr_ad           numeric    -- ДРР рекламный
ctr              numeric
cr_cart          numeric
cr_order         numeric
cpm              numeric
cpc              numeric
ad_order_share   numeric    -- доля рекл. заказов
spp              numeric    -- СПП (цена после скидки)

-- планирование (только для последней даты периода)
spend_plan       numeric
drr_plan         numeric
```

---

### `fact_sku_snapshot` — снапшот на дату загрузки Отчёта по SKU
Уникальный ключ: `(sku_ms, upload_id)`

```sql
sku_ms              text → dim_sku
upload_id           uuid → uploads
snap_date           date       -- дата последней строки в файле

-- остатки (актуальны только если файл свежий)
fbo_wb              int
fbs_pushkino        int
fbs_smolensk        int
kits_stock          int
stock_days          numeric
days_to_arrival     numeric
ots_reserve_days    numeric

-- финансы за 5 дней
margin_rub          numeric    -- Маржа опер. руб
chmd_5d             numeric    -- ЧМД за вычетом рекламы

-- планирование
spend_plan          numeric
drr_plan            numeric

-- поставка
supply_date         date
supply_qty          int

-- цена
price               numeric

-- характеристики товара (из отчёта, могут обновляться)
shelf_date          date
manager             text
novelty_status      text
```

---

### `fact_stock_daily` — продажи по дням из Таблицы остатков
Уникальный ключ: `(sku_wb, sale_date)`
**Загружается один раз** (колонки LK-ABE). При повторной загрузке — только новые даты.

```sql
sku_wb      bigint     -- SKU WB (ключ в этой таблице)
sku_ms      text       -- Артикул МС (для джойна)
sale_date   date
sales_qty   numeric    -- продажи штук за день
upload_id   uuid → uploads
```

**Также из Таблицы остатков** (таблица `fact_stock_snapshot`, ключ `(sku_wb, upload_id)`):
```sql
sku_wb          bigint
upload_id       uuid
snap_date       date
fbo_wb          int
fbs_pushkino    int
fbs_smolensk    int
total_stock     int
price           numeric    -- цена утром (на последнюю дату)
margin_pct      numeric
supply_qty      int
supply_date     date
-- изменения цен по датам (отдельная таблица)
```

---

### `fact_price_changes` — изменения цены из Таблицы остатков
Уникальный ключ: `(sku_wb, price_date)`

```sql
sku_wb      bigint
sku_ms      text
price_date  date
price       numeric
upload_id   uuid
```

---

### `fact_abc` — АВС анализ (лист "АВС расшифровка")
Уникальный ключ: `(sku_ms, upload_id)` — данные за месяц

```sql
sku_ms           text → dim_sku
upload_id        uuid → uploads
period_month     date    -- первое число месяца (напр. 2026-02-01)

qty_stock_rub    numeric    -- Количество (остаток в рублях)
cost             numeric    -- Себестоимость без НДС
revenue          numeric    -- Выручка без НДС
chmd             numeric    -- ЧМД
ad_spend         numeric    -- Реклама без НДС
storage          numeric    -- Хранение без НДС
transport        numeric    -- Транспорт без НДС
chmd_clean       numeric    -- ЧМД за минусом рекламы/хранения/транспорта
profitability    numeric    -- Рентабельность чистого ЧМД %
revenue_margin   numeric    -- Рентабельность выручки %
tz               numeric    -- ТЗ (товарный запас в руб)
turnover_days    numeric    -- Оборачиваемость ТЗ дн
chmd_share       numeric    -- Доля по ЧМД
abc_class        text       -- Итоговый класс (AA/AB/BA/BB/CA/AC и т.д.)
abc_class2       text       -- Итоговый класс2
novelty_flag     boolean    -- Флаг новинки
stock_status     text       -- Статус остатка
```

---

### `fact_china_supply` — Потребность Китай (лист "СВОД", только WB)
Уникальный ключ: `(sku_ms, upload_id)`

```sql
sku_ms           text → dim_sku
upload_id        uuid → uploads

-- план продаж по месяцам (WB)
plan_mar         int
plan_apr         int
plan_may         int
plan_jun         int
plan_jul         int
plan_aug         int
reserve_15d      int    -- запас 15 дней

-- финансы
buyout_pct_wb    numeric    -- % выкупа на WB
marketing_pct    numeric    -- % маркетинга
cost_plan        numeric    -- себа план
cost_change_pct  numeric    -- % изменения себы
avg_price        numeric    -- ср. цена

-- логистика
in_transit       int        -- в пути
in_production    int        -- в производстве
nearest_date     date       -- ближайшая дата поставки

-- заказ
order_qty        int        -- кол-во к заказу
order_sum_cost   numeric    -- сумма в себах с НДС
rating           numeric    -- рейтинг
```

---

### `sku_notes` — заметки (без изменений)
```sql
id          uuid PK
sku_ms      text
note        text
user_name   text
updated_at  timestamptz
```

---

## Индексы (создать в Supabase SQL Editor)

```sql
-- Критичные для производительности
CREATE INDEX IF NOT EXISTS idx_fact_sku_daily_date
  ON fact_sku_daily(metric_date DESC);

CREATE INDEX IF NOT EXISTS idx_fact_sku_daily_upload
  ON fact_sku_daily(upload_id);

CREATE INDEX IF NOT EXISTS idx_fact_stock_daily_date
  ON fact_stock_daily(sale_date DESC);

CREATE INDEX IF NOT EXISTS idx_fact_stock_daily_sku
  ON fact_stock_daily(sku_ms);

CREATE INDEX IF NOT EXISTS idx_fact_abc_period
  ON fact_abc(period_month DESC);
```

---

## Связь артикулов (важно)

```
dim_sku.sku_ms  ←→  fact_sku_daily.sku_ms       (Отчёт по SKU)
dim_sku.sku_ms  ←→  fact_abc.sku_ms              (АВС анализ)
dim_sku.sku_ms  ←→  fact_china_supply.sku_ms     (Потребность Китай)
dim_sku.sku_wb  ←→  fact_stock_daily.sku_wb      (Таблица остатков)
dim_sku.sku_wb  ←→  fact_stock_snapshot.sku_wb   (Таблица остатков)
```

В Таблице остатков нет `sku_ms`, только `sku_wb` — парсер ищет соответствие через `dim_sku`.

---

## Что НЕ делаем

- ❌ `stg_*` таблицы (сырой слой) — избыточно для нашего масштаба
- ❌ `mart_*` материализованные вьюхи — считаем на клиенте или в API
- ❌ SQL-алерты — считаем в `scoring.ts` на клиенте
- ❌ Хранить все 923 колонки Таблицы остатков — только используемые (LK-ABE = продажи по дням)
