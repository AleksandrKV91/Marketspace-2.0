# API Routes — Backend

## Общие принципы

- `export const maxDuration = 60` — на каждом route (Vercel limit)
- Авторизация через Supabase Auth (`supabaseAdmin.auth.getUser(token)`)
- Роли: `admin` и `analyst` — запись; `viewer` — только чтение
- Supabase Admin client (service_role) только на сервере, никогда на клиенте
- Ошибки возвращать как `{ error: string }` с правильным HTTP статусом

```typescript
// Пагинация — для всех больших таблиц
async function fetchAll<T>(table: string, select: string, filter?: (q: any) => any): Promise<T[]> {
  const all: T[] = []
  let offset = 0
  while (true) {
    let q = supabaseAdmin.from(table).select(select).range(offset, offset + 999)
    if (filter) q = filter(q)
    const { data, error } = await q
    if (error) throw new Error(`${table}: ${error.message}`)
    if (!data?.length) break
    all.push(...data as T[])
    if (data.length < 1000) break
    offset += 1000
  }
  return all
}
```

---

## GET `/api/dashboard-data`

Основные данные для всех вкладок (кроме заказов).

### Query параметры
- `from` — ISO дата начала (default: 60 дней назад)
- `to` — ISO дата конца (default: сегодня)

### Логика

```typescript
// 1. Загрузки за период
const uploads = await supabase.from('uploads')
  .select('id, period_start, period_end')
  .gte('period_start', from)
  .order('period_start', { ascending: false })

// 2. Дневные метрики — по upload_id (НЕ .in(sku_ids)!)
const daily = await fetchAll('fact_sku_daily',
  'sku_ms, metric_date, ad_spend, revenue, drr_total, drr_ad, ctr, cr_cart, cr_order, cpm, cpc, ad_order_share, spp',
  q => q.in('upload_id', uploadIds)
)

// 3. Снапшот — только последний (для остатков)
const snapshot = await fetchAll('fact_sku_snapshot',
  'sku_ms, fbo_wb, fbs_pushkino, fbs_smolensk, kits_stock, stock_days, margin_rub, chmd_5d, price, novelty_status, shelf_date, manager, supply_date, supply_qty',
  q => q.eq('upload_id', latestUploadId)
)

// 4. dim_sku — справочник (кешировать на клиенте)
const skus = await fetchAll('dim_sku',
  'sku_ms, sku_wb, name, brand, subject_wb, category_wb, supplier, seasonality, top_month, month_jan, ...'
)
```

### Response

```typescript
{
  days: DayData[],        // массив дней с агрегированными метриками
  skus: SkuData[],        // массив SKU с последними метриками
  last_date: string,
  period: { from, to }
}
```

---

## GET `/api/order-data`

Данные для вкладки "Заказ товаров".

### Логика

```typescript
// 1. stock_sheet1 агрегаты → из fact_sku_snapshot (последний upload)
// 2. Продажи по дням → из fact_stock_daily (последние 60 дней)
// 3. ABC данные → из fact_abc (последний месяц)
// 4. China supply → из fact_china_supply (последняя загрузка)
// 5. dim_sku — справочник

// НЕТ fallback на JSON файл (убрали order_tab_data.json)
// Если данных нет → вернуть пустой массив с понятной ошибкой
```

### Продажи по дням (критично для производительности)

```typescript
// НЕ читать всю таблицу
const salesFrom = new Date()
salesFrom.setDate(salesFrom.getDate() - 90)

const sales = await supabase
  .from('fact_stock_daily')
  .select('sku_ms, sale_date, sales_qty')
  .gte('sale_date', salesFrom.toISOString().split('T')[0])
// Результат: ~2500 SKU × 90 дней = 225k строк — читать через fetchAll
```

---

## POST `/api/upload` — Отчёт по SKU

```typescript
// 1. Auth (admin | analyst)
// 2. Читаем файл (.xlsb / .xlsx)
// 3. parseSkuReport(buffer)
// 4. INSERT uploads
// 5. UPSERT dim_sku (только изменяемые поля: shelf_date, manager, novelty_status)
// 6. UPSERT fact_sku_daily батчами 500
// 7. UPSERT fact_sku_snapshot
// 8. При ошибке → DELETE upload (CASCADE)
```

---

## POST `/api/update/stock` — Таблица остатков

```typescript
// 1. Auth
// 2. parseStock(buffer)
// 3. INSERT uploads
// 4. UPSERT fact_stock_snapshot (остатки, цены, маржа)
// 5. UPSERT fact_price_changes
// 6. UPSERT fact_stock_daily ТОЛЬКО для новых дат:
//    - Найти MAX(sale_date) для каждого sku_wb
//    - Вставить только строки где date > max_date
// 7. При ошибке → DELETE upload
```

---

## POST `/api/update/abc` — АВС анализ

```typescript
// 1. Auth
// 2. parseABC(buffer)
// 3. INSERT uploads
// 4. UPSERT fact_abc по (sku_ms, upload_id)
```

---

## POST `/api/update/china` — Потребность Китай

```typescript
// 1. Auth
// 2. parseChina(buffer)
// 3. INSERT uploads
// 4. UPSERT fact_china_supply по (sku_ms, upload_id)
```

---

## POST `/api/update/catalog` — Свод

```typescript
// 1. Auth (только admin)
// 2. parseCatalog(buffer)
// 3. INSERT uploads
// 4. UPSERT dim_sku по sku_ms
// Это базовая операция — загружать первой при настройке
```

---

## Supabase Realtime

```typescript
// Подписка на изменения uploads → уведомить всех пользователей
// что появились новые данные

// В dashboardStore.ts:
supabase
  .channel('uploads')
  .on('postgres_changes',
    { event: 'INSERT', schema: 'public', table: 'uploads' },
    (payload) => {
      // Показать toast: "Загружены новые данные. Обновить?"
      // При согласии → перезагрузить данные за актуальный период
    }
  )
  .subscribe()
```

---

## Производительность — критичные правила

```typescript
// ❌ НИКОГДА
supabase.from('fact_sku_daily').select('*').in('sku_ms', allSkuIds) // 2500+ → timeout

// ✅ ВСЕГДА по upload_id или диапазону дат
supabase.from('fact_sku_daily').select('*').in('upload_id', uploadIds)
supabase.from('fact_stock_daily').select('*').gte('sale_date', from).lte('sale_date', to)

// ❌ НИКОГДА полный скан fact_stock_daily (~525k строк)
supabase.from('fact_stock_daily').select('*')

// ✅ Всегда с диапазоном дат
supabase.from('fact_stock_daily').select('*').gte('sale_date', from)
```
