# SQL запросы для Supabase

> Создан 08.04.2026

---

## ДИАГНОСТИКА — выполни сначала

Перед исправлением запусти эти запросы в Supabase → SQL Editor, чтобы понять текущее состояние.

```sql
-- 1. Сколько строк в каждой таблице
SELECT 
  'dim_sku' as tbl, count(*) from dim_sku
UNION ALL SELECT 'fact_sku_daily', count(*) from fact_sku_daily
UNION ALL SELECT 'fact_sku_snapshot', count(*) from fact_sku_snapshot
UNION ALL SELECT 'fact_stock_snapshot', count(*) from fact_stock_snapshot
UNION ALL SELECT 'fact_abc', count(*) from fact_abc
UNION ALL SELECT 'fact_china_supply', count(*) from fact_china_supply;


| tbl                 | count  |
| ------------------- | ------ |
| dim_sku             | 2812   |
| fact_sku_daily      | 176256 |
| fact_sku_snapshot   | 49585  |
| fact_stock_snapshot | 2446   |
| fact_abc            | 2586   |
| fact_china_supply   | 500    |
```

```sql
-- 2. Форматы sku_ms в dim_sku vs fact_sku_daily — КЛЮЧЕВОЙ ЗАПРОС
-- Если форматы не совпадают — JOIN не работает
SELECT 
  'dim_sku' as source,
  sku_ms,
  length(sku_ms) as len
FROM dim_sku LIMIT 10;

Error: Failed to run sql query: ERROR: 42601: syntax error at or near "ELECT" LINE 1: ELECT ^



SELECT 
  'fact_sku_daily' as source,
  sku_ms,
  length(sku_ms) as len
FROM fact_sku_daily LIMIT 10;

| source         | sku_ms     | len |
| -------------- | ---------- | --- |
| fact_sku_daily | NWTPS100N3 | 10  |
| fact_sku_daily | NWTPS100N3 | 10  |
| fact_sku_daily | NWTPS100N3 | 10  |
| fact_sku_daily | NWTPS100N3 | 10  |
| fact_sku_daily | NWTPS100N3 | 10  |
| fact_sku_daily | SMSPL      | 5   |
| fact_sku_daily | SMSPL      | 5   |
| fact_sku_daily | SMSPL      | 5   |
| fact_sku_daily | SMSPL      | 5   |
| fact_sku_daily | SMSPL      | 5   |
```

```sql
-- 3. Пересечение: сколько sku_ms из fact_sku_daily есть в dim_sku
SELECT count(distinct d.sku_ms) as matched
FROM fact_sku_daily d
JOIN dim_sku s ON d.sku_ms = s.sku_ms;
-- Если = 0 → форматы не совпадают → JOIN не работает

| matched |
| ------- |
| 2763    |
```

```sql
-- 4. Пример: показать 5 строк из fact_sku_daily с данными
SELECT sku_ms, metric_date, revenue, ad_spend, ctr
FROM fact_sku_daily
ORDER BY metric_date DESC
LIMIT 5;

Error: Failed to run sql query: ERROR: 42601: syntax error at or near "ELECT" LINE 1: ELECT sku_ms, metric_date, revenue, ad_spend, ctr ^


```

```sql
-- 5. Дата диапазон данных
SELECT 
  min(metric_date) as earliest,
  max(metric_date) as latest,
  count(distinct sku_ms) as unique_skus,
  count(*) as total_rows
FROM fact_sku_daily;

| earliest   | latest     | unique_skus | total_rows |
| ---------- | ---------- | ----------- | ---------- |
| 2026-02-01 | 2026-04-05 | 2763        | 176256     |
```

```sql
-- 6. dim_sku — есть ли sku_wb?
SELECT 
  count(*) as total,
  count(sku_wb) as with_wb,
  count(*) - count(sku_wb) as without_wb
FROM dim_sku;

| total | with_wb | without_wb |
| ----- | ------- | ---------- |
| 2812  | 2812    | 0          |
```

---

## ПРОБЛЕМА A: dim_sku.sku_ms не совпадает с fact_sku_daily.sku_ms

**Симптом:** дашборд показывает 0 артикулов (или только те что совпали)
**Причина:** Свод загружен с неправильными значениями в колонке sku_ms

### Решение: Обновить dim_sku из fact_sku_daily

Если в Своде нет колонки «Артикул МС» / «Артикул склада» с короткими кодами — нужно перестроить dim_sku из данных которые уже есть.

```sql
-- ШАГ 1: Посмотреть что сейчас в dim_sku
-- (выполни диагностику выше сначала)

-- ШАГ 2: Добавить в dim_sku все уникальные sku_ms из fact_sku_daily
-- которых ещё нет в dim_sku (INSERT на новые)
INSERT INTO dim_sku (sku_ms)
SELECT DISTINCT sku_ms
FROM fact_sku_daily
WHERE sku_ms NOT IN (SELECT sku_ms FROM dim_sku)
ON CONFLICT (sku_ms) DO NOTHING;
```

```sql
-- ШАГ 3: Проверить результат
SELECT count(*) FROM dim_sku;
-- Должно стать ~2800-3000 строк
```

---

## ПРОБЛЕМА B: fact_sku_snapshot пустой

Снапшоты должны писаться при каждой загрузке Отчёта по SKU.

```sql
-- Диагностика
SELECT count(*), min(snap_date), max(snap_date) 
FROM fact_sku_snapshot;

-- Если пустой — значит при загрузке была ошибка или sku_ms не совпал
-- После исправления dim_sku нужно перезагрузить Отчёты
```

---

## ПРОБЛЕМА C: dim_sku не имеет имён для новых SKU

После добавления sku_ms из fact_sku_daily они будут без имён (name=null).
Имена появятся когда пользователь перезагрузит Свод с правильными колонками.

```sql
-- Сколько dim_sku записей без имени
SELECT count(*) FROM dim_sku WHERE name IS NULL OR name = '';
```

---

## ОБЯЗАТЕЛЬНЫЕ ИНДЕКСЫ

Если этих индексов нет — запросы будут медленными (seq scan по 176k+ строк).

```sql
-- fact_sku_daily — основной запрос: by metric_date range + sku_ms
CREATE INDEX IF NOT EXISTS idx_fact_sku_daily_date 
ON fact_sku_daily(metric_date);

CREATE INDEX IF NOT EXISTS idx_fact_sku_daily_sku_ms 
ON fact_sku_daily(sku_ms);

-- Составной индекс для запросов с обоими фильтрами
CREATE INDEX IF NOT EXISTS idx_fact_sku_daily_sku_date 
ON fact_sku_daily(sku_ms, metric_date);

-- fact_sku_snapshot
CREATE INDEX IF NOT EXISTS idx_fact_sku_snapshot_upload 
ON fact_sku_snapshot(upload_id);

CREATE INDEX IF NOT EXISTS idx_fact_sku_snapshot_sku_ms 
ON fact_sku_snapshot(sku_ms);

-- fact_stock_snapshot
CREATE INDEX IF NOT EXISTS idx_fact_stock_snapshot_upload 
ON fact_stock_snapshot(upload_id);

-- fact_abc
CREATE INDEX IF NOT EXISTS idx_fact_abc_upload 
ON fact_abc(upload_id);

-- uploads — для быстрого поиска последних по типу
CREATE INDEX IF NOT EXISTS idx_uploads_type_date 
ON uploads(file_type, uploaded_at DESC);
```

---

## ДЕДУПЛИКАЦИЯ: перекрывающиеся периоды

При загрузке 17 файлов с перекрывающимися датами (например 01.04-05.04 и 27.03-31.03 перекрываются по 27-31 марта) в fact_sku_daily может быть несколько записей за одну дату для одного SKU. Текущий код использует `upsert onConflict(sku_ms, metric_date)` — это значит **более поздняя загрузка перезаписывает более раннюю** для одной и той же даты. Это правильное поведение.

```sql
-- Проверить нет ли дублей (должно быть 0)
SELECT sku_ms, metric_date, count(*) 
FROM fact_sku_daily 
GROUP BY sku_ms, metric_date 
HAVING count(*) > 1
LIMIT 10;
```

---

## ПРОВЕРКА ОГРАНИЧЕНИЙ (UNIQUE constraints)

```sql
-- Какие unique constraints есть на dim_sku?
SELECT constraint_name, constraint_type
FROM information_schema.table_constraints
WHERE table_name = 'dim_sku';

-- Какие unique constraints на fact_sku_daily?
SELECT constraint_name, constraint_type
FROM information_schema.table_constraints
WHERE table_name = 'fact_sku_daily';
```

---

## ИТОГОВЫЕ ЗАПРОСЫ ДЛЯ ПРОВЕРКИ ДАННЫХ

После всех исправлений — запускаешь эти запросы чтобы убедиться что всё работает:

```sql
-- 1. Сколько SKU с данными за последние 7 дней
SELECT count(distinct sku_ms) as skus_with_recent_data
FROM fact_sku_daily
WHERE metric_date >= current_date - 7;

-- 2. Топ-10 SKU по выручке за апрель
SELECT 
  d.sku_ms,
  s.name,
  s.sku_wb,
  sum(d.revenue) as total_revenue
FROM fact_sku_daily d
LEFT JOIN dim_sku s ON d.sku_ms = s.sku_ms
WHERE d.metric_date >= '2026-04-01'
GROUP BY d.sku_ms, s.name, s.sku_wb
ORDER BY total_revenue DESC
LIMIT 10;

-- 3. Проверка маппинга: SKU из fact_sku_daily без dim_sku записи
SELECT count(distinct sku_ms) as unmatched_skus
FROM fact_sku_daily
WHERE sku_ms NOT IN (SELECT sku_ms FROM dim_sku);
-- Цель: 0

-- 4. Проверка полноты данных по датам
SELECT 
  metric_date,
  count(distinct sku_ms) as sku_count,
  sum(revenue) as total_revenue
FROM fact_sku_daily
WHERE metric_date >= '2026-04-01'
GROUP BY metric_date
ORDER BY metric_date;
```

---

## НЕМЕДЛЕННОЕ ИСПРАВЛЕНИЕ (если dim_sku.sku_ms не совпадает)

Если диагностический запрос #3 показал 0 совпадений — это критично. Выполни:

```sql
-- Очистить dim_sku от длинных имён (которые не являются sku_ms)
-- ОСТОРОЖНО: сначала убедись что это точно проблема через диагностику!

-- Вариант 1 (безопасный): добавить новые записи без удаления старых
INSERT INTO dim_sku (sku_ms)
SELECT DISTINCT f.sku_ms
FROM fact_sku_daily f
WHERE NOT EXISTS (SELECT 1 FROM dim_sku d WHERE d.sku_ms = f.sku_ms)
ON CONFLICT (sku_ms) DO NOTHING;

-- Вариант 2 (если нужно перезаписать): сначала сохрани бэкап
-- CREATE TABLE dim_sku_backup AS SELECT * FROM dim_sku;
-- После этого можно чистить и перезагружать Свод
```

---

## СТРУКТУРА ТАБЛИЦ (справка)

```sql
-- Посмотреть колонки dim_sku
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'dim_sku'
ORDER BY ordinal_position;

-- Посмотреть колонки fact_sku_daily  
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'fact_sku_daily'
ORDER BY ordinal_position;
```
