# Проблема ключа SKU — текущее состояние и что нужно изменить

> Документ изменен 08.04.2026 

---

## Суть проблемы

Договорились: **главный ключ = Артикул WB (sku_wb, число)**. 

В реальности в коде главным ключом является **sku_ms (строка, Артикул МС / Артикул склада)**.

Это расхождение. Объясняю почему так получилось и что это ломает.

---

## Как сейчас устроено (фактически) - это не верно

### dim_sku — конфликт по sku_ms

```typescript
// upload/catalog/route.ts
supabase.from('dim_sku').upsert(batch, { onConflict: 'sku_ms' })
//                                                    ^^^^^^^^
//                                     UPSERT по sku_ms, не по sku_wb
```

`dim_sku` — главный справочник. Его PRIMARY KEY / уникальный ключ = **sku_ms**.  
`sku_wb` в нём просто поле, может быть null.

### fact_sku_daily — ключ sku_ms

```typescript
// upload/sku-report/route.ts
supabase.from('fact_sku_daily').upsert(batch, { onConflict: 'sku_ms,metric_date' })
//                                                           ^^^^^^^^^^^^^^^^^^^^^^
//                                             Первичный ключ: sku_ms + дата
```

Записи в `fact_sku_daily` идентифицируются по `sku_ms`. Если завтра поменяется sku_wb — ничего не сломается. Если поменяется sku_ms — будет дубль.

### fact_sku_snapshot — ключ sku_ms

```typescript
supabase.from('fact_sku_snapshot').upsert(batch, { onConflict: 'sku_ms,upload_id' })
```

### fact_stock_snapshot и fact_stock_daily — ключ sku_wb ✅

```typescript
supabase.from('fact_stock_snapshot').upsert(batch, { onConflict: 'sku_wb,upload_id' })
supabase.from('fact_stock_daily').upsert(batch, { onConflict: 'sku_wb,sale_date' })
supabase.from('fact_price_changes').upsert(batch, { onConflict: 'sku_wb,price_date' })
```

Таблица остатков уже использует sku_wb как ключ — это правильно.

### fact_abc — ключ sku_ms

```typescript
supabase.from('fact_abc').upsert(batch, { onConflict: 'sku_ms,upload_id' })
```

---

## Почему всё завязано на sku_ms

### Причина 1: Отчёт по SKU содержит sku_ms, а не sku_wb

В файле «Отчёт по SKU» (Лист7) col 0 = «Артикул МС» (строка типа `NWTPS100N3`). - ты не верно интерпртировал данные. в файле отчет по sku col 0 - артикул WB (просто называется по другому -sku) 
**Артикула WB там есть** - отдельная колонка. колонка A или первая или 0, как тебе удобней

Парсер конвертирует: читает col 0 как строку → ищет в Map `{wb_string → ms}` → если находит, берёт ms; если нет — использует как есть. - это неверно

Но смотри внимательно:
```typescript
// parseSkuReport.ts строка 199
const skuMs = skuMap ? (skuMap.get(rawSku) ?? null) : rawSku
//                                 ^^^^^^
//             skuMap: Map<"123456789" (строка), "NWTPS100N3">
//             То есть если col 0 = WB артикул → конвертируем в sku_ms
//             Если col 0 = sku_ms напрямую → используем как есть (skuMap не даёт результата)
```

Итог: данные сохраняются с ключом sku_ms. WB артикул **теряется** при сохранении в `fact_sku_daily`.

### Причина 2: ABC анализ не содержит sku_wb вообще - это верно

В ABC файле есть только «Артикул склада» (= sku_ms), найти можно в таблице свод - колонка B Артикул МС и сопоставить с артикулом WB - колонка A

### Причина 3: Потребность Китай — тоже только sku_ms - верно. сопостовляем так же (артикул мс ищем в свод - колонка B и сопоставляем с колонкой A в таблице свод - артикул WB

---

## Что именно это ломает сейчас

### Проблема A: JOIN между fact_sku_daily и fact_stock_snapshot

```
fact_sku_daily       →  sku_ms = "NWTPS100N3"
fact_stock_snapshot  →  sku_wb = 123456789

Чтобы соединить — нужен dim_sku как мост:
  dim_sku: sku_ms="NWTPS100N3", sku_wb=123456789
```

В API-роутах именно так и делается — сначала тянут dim_sku, строят два списка (skuMsList и wbList), делают два отдельных запроса. Это работает, но:

**Если в dim_sku нет строки с нужным sku_ms → данные не попадут в дашборд вообще.** - так быть не должно. Нужно подтягивать только те данные, которые есть. А я уже потом буду разбираться почему данных не хватает. обнулять артикул посностью и не отображать его это не правильно.

### Проблема B: SKU из Отчёта по SKU без Свода = невидимки. тоже не верно - нужно переделать. Таблица свод - как рекомендация к посику потерявшихся артикулов. если добавляется новый в таблицу sku, нужно проинформировать и дабавить его в свод

Если SKU есть в Отчёте по SKU, но нет в Своде → парсер его пропустит (строка 200):
```typescript
if (!skuMs) { skipped++; skippedSkus.push(rawSku); continue }
```

Это значит: новый товар, который добавили в отчёт, но не обновили Свод → **в дашборде его нет**. - переделать

### Проблема C: sku_ms может не соответствовать sku_wb однозначно - верно. он и не должен соответствовать. Это разные артикулы. основоной sku wb

В dim_sku могут быть строки с `sku_wb = null` (товар без WB артикула). Тогда запрос `fact_stock_snapshot.in('sku_wb', wbList)` его не найдёт — остатки = 0.

---

## Что нужно изменить, чтобы главным ключом стал sku_wb

### Шаг 1: dim_sku — добавить UNIQUE constraint на sku_wb

```sql
-- В Supabase выполнить:
ALTER TABLE dim_sku ADD CONSTRAINT dim_sku_sku_wb_unique UNIQUE (sku_wb);
``` - ошибка Error: Failed to run sql query: ERROR: 23505: could not create unique index "dim_sku_sku_wb_unique" DETAIL: Key (sku_wb)=(174502899) is duplicated.

И в upload/catalog:
```typescript
// Сейчас:
supabase.from('dim_sku').upsert(batch, { onConflict: 'sku_ms' })
// Станет:
supabase.from('dim_sku').upsert(batch, { onConflict: 'sku_wb' })
// или по обоим полям если хотим поддерживать оба:
supabase.from('dim_sku').upsert(batch, { onConflict: 'sku_wb,sku_ms' })
``` - поясни что нужно сделать детально

### Шаг 2: fact_sku_daily — добавить sku_wb, сменить ключ

Сейчас `fact_sku_daily` хранит только sku_ms. Нужно добавить поле sku_wb и изменить ключ:

```sql
ALTER TABLE fact_sku_daily ADD COLUMN sku_wb INTEGER;
-- Поменять UNIQUE/PRIMARY KEY с (sku_ms, metric_date) на (sku_wb, metric_date)
``` - не делал, так как на предыдущем запросе - ошибка

В parseSkuReport → нужно добавить sku_wb в каждую строку. Для этого парсер должен получать обратный маппинг `sku_ms → sku_wb`.

### Шаг 3: fact_sku_snapshot — то же самое

```sql
ALTER TABLE fact_sku_snapshot ADD COLUMN sku_wb INTEGER;
```

### Шаг 4: fact_abc — добавить sku_wb

ABC содержит только sku_ms. При загрузке — обогащать sku_wb из dim_sku:
```typescript
// upload/abc/route.ts
const wbMap = new Map<string, number>()  // sku_ms → sku_wb
// загрузить из dim_sku
// при сохранении добавить sku_wb в каждую строку
```

---

## Честная оценка: стоит ли переделывать сейчас?

### Аргументы ЗА переход на sku_wb
- Все таблицы остатков уже работают по sku_wb — согласованность
- WB артикул стабилен: товар не переименуешь, не смени номенклатуру
- Проще JOIN без посредника dim_sku

### Аргументы ПРОТИВ переделки прямо сейчас
- ABC и Потребность Китай физически не содержат sku_wb — там только sku_ms
- Переделка требует миграции БД (ALTER TABLE) + изменения 5+ парсеров + API роутов
- Текущая схема через dim_sku как мост **работает**, просто добавляет один лишний JOIN
- Риск потерять данные при миграции

### Практический вывод

**Текущая архитектура: dim_sku = мост между двумя мирами**

```
Мир sku_ms:              Мир sku_wb:
  fact_sku_daily           fact_stock_snapshot
  fact_sku_snapshot        fact_stock_daily
  fact_abc                 fact_price_changes
  fact_china_supply
          ↑                        ↑
          └────── dim_sku ─────────┘
              sku_ms ↔ sku_wb
```

Это не ошибка — это вынужденная архитектура из-за того, что разные исходные файлы используют разные ключи. ABC и Потребность Китай никогда не будут содержать sku_wb — их структура не меняется.

**Что реально нужно исправить** (не меняя архитектуру):

1. Убедиться что в dim_sku для каждого sku_ms есть корректный sku_wb
2. Отчёт по SKU — в col 0 должен быть артикул, который есть в Своде
3. При загрузке Отчёта — логировать skipped_skus и показывать пользователю
4. Добавить в dim_sku поле `sku_wb` в качестве UNIQUE и проверять при загрузке Свода

---

## Итог — текущая схема одной строкой

> **sku_wb — ключ для данных об остатках и ценах.  
> sku_ms — ключ для данных о метриках, марже, рекламе.  
> dim_sku — единственный мост между ними.  
> Свод (Catalog) должен загружаться ПЕРВЫМ и содержать ОБА артикула для каждого товара.**

---
