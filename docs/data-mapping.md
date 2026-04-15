# Маппинг данных: Excel → Парсер → Supabase → Вкладка

> Обновлено: 2026-04-15. Источник правды — код парсеров, upload route.ts и схема Supabase.

---

## 1. ТАБЛИЦЫ EXCEL И ЧТО ИЗ НИХ БЕРЁТСЯ

### 1.1 Отчёт по SKU - **почему разделен на две таблицы в supabase?**  все артикулы в отчете должны попадать в таблицу fact_sku_daily - неазвисимо от того, есть ли там реклама или нет. от этого и проблемы с ценой. Может нужно объеденить таблицы fact_sku_snapshot и fact_sku_daily

####Затраты план и ДРР план - дублируются в таблицах fact_sku_snapshot и fact_sku_daily


**Upload type:** `sku_report` | **Парсер:** `parseSkuReport.ts` | **Route:** `upload/sku-report/route.ts`

#### Структура листа:
- Row 0 — блоки: «Выручка Total», «ДРР Total», «CTR», «CR корзину», «CR заказ», «CPM», «CPC», «Доля рекл. заказов», «Изменение цены»
- Row 1 — подзаголовки + Excel-даты (числа 45000+)
- Row 2+ — данные SKU (col 0 = WB-артикул)

#### → `fact_sku_snapshot` (один снапшот на загрузку, конфликт: `sku_ms,upload_id`): - **что за конфликт? как решаем?**
| Колонка файла | Поле в БД | Примечание | Комментарий |
|---|---|---|---|
| col 0 (WB арт) | `sku_ms` | через skuMap из dim_sku |
| col 0 | `sku_wb` | bigint |
| «Дата появления на полке» | `shelf_date` | date |
| «Менеджер» | `manager` | text |
| «Статус Новинки» | `novelty_status` | text |
| «Остаток на ВБ ФБО» | `fbo_wb` | integer |
| «Остаток FBS Пушкино» | `fbs_pushkino` | integer |
| «Остаток FBS Смоленск» | `fbs_smolensk` | integer |
| «Остаток, дни» | `stock_days` | numeric — из файла, не расчётный |
| «Дней до прихода» | `days_to_arrival` | numeric |
| «Маржа Опер» | `margin_rub` | numeric, руб | не используется. нужно удалить, чтобы не было путаницы |
| **«Маржа, %»** | **`margin_pct`** | **÷ 100** (17.3 → 0.173) | в supabase уже 0,173 |
| «ЧМД за 5 дней» | `chmd_5d` | numeric |
| **«Цена»** | **`price`** | **цена на дату snap_date** |
| «Поставка план» | `supply_date` | date |
| «Поступления / поставка шт» | `supply_qty` | integer |
| «Затраты план» | `spend_plan` | numeric |
| «ДРР план» | `drr_plan` | numeric |
| snap_date | `snap_date` | первая (новейшая) дата из блоков метрик |
| (нет в БД) | `kits_stock` | integer, нет в парсере | что за значение? |
| (нет в БД) | `ots_reserve_days` | integer, нет в парсере | что за значение? |

#### → `fact_sku_daily` (5 дат × N SKU, конфликт: `sku_ms,metric_date`):
| Блок в Row 0 | Поле | Тип |
|---|---|---|
| «Затраты» | `ad_spend` | numeric |
| «Выручка Total» | `revenue` | numeric |
| «ДРР Total» | `drr_total` | numeric |
| «ДРР Рекламный» | `drr_ad` | numeric |
| «CTR» | `ctr` | numeric |
| «CR в корзину» | `cr_cart` | numeric |
| «CR в заказ» | `cr_order` | numeric |
| «CPM» | `cpm` | numeric |
| «CPC» | `cpc` | numeric |
| «Доля рекл. заказов» | `ad_order_share` | numeric |
| «Затраты план» | `spend_plan` | numeric |
| «ДРР план» | `drr_plan` | numeric |
| (нет в файле) | `spp` | numeric — не заполняется |

**⚠️ Важно:** `fact_sku_daily` содержит только SKU с активной рекламой. Органические продажи без рекламы — не попадают.

#### → `fact_price_changes` (конфликт: `sku_wb,price_date`):
- Блок «Изменение цены» (cols CJ-CN) — дельты % → пересчитываются в абсолютные цены назад от snap_date
- Дополнительно: snap_date + price из снапшота (если не было этой даты)

#### → `fact_daily_agg` (через SQL-функцию):
- Вызывается `refresh_daily_agg(from_date, to_date)` после загрузки

---

####Добавить колонки в звгрузку

Колонка файла | Поле в БД | Примечание | Комментарий |
|---|---|---|---|
|остаток комплектов|  | integer | для расчета общего остатка |
|Запас дней до Out to Stock |  |  |  включить в загрузку |
|Изменение цены |  |  |  Включтить в загрузку. в колонках процент изменения цены. загружать сразу со всеми данными и пересчитывать в отдельной таблице цену. Row 0 — блоки: «Изменение цены», Row 1 — подзаголовки + Excel-даты |

---

### 1.2 Таблица остатков (Stock) - практически не используется. данные есть в других таблицах. Удалить из supabase. Удалить парсер. удалить кнопку загрузки в дашборде для данной таблицы.
**Upload type:** `stock` | **Парсер:** `parseStock.ts` | **Route:** `upload/stock/route.ts`

#### Структура листа (Sheet1):
- Rows 0-4 — пустые
- Row 5 — заголовки
- Row 6+ — данные (col B = WB-артикул)

#### → `fact_stock_snapshot` (конфликт: `sku_wb,upload_id`):
| Колонка файла | Поле в БД | Примечание |
|---|---|---|
| col B (WB арт) | `sku_wb` | bigint |
| через skuMap | `sku_ms` | text |
| «Остаток на ВБ ФБО» | `fbo_wb` | integer |
| «FBS Пушкино» | `fbs_pushkino` | integer |
| «FBS Смоленск» | `fbs_smolensk` | integer |
| «Всего» / «Итого остат» | `total_stock` | integer, или сумма трёх |
| **«Цена утром» / «Цена»** | **`price`** | **абсолютная цена** |
| **«Маржа»** (без «руб») | **`margin_pct`** | **⚠️ НЕ делится на 100!** (17.3 → 17.3) |
| «Кол-во в поставке» | `supply_qty` | integer |
| «Дата прихода» | `supply_date` | date |
| последняя дата из cols | `snap_date` | берётся из priceChangeCols или salesCols |

**Пропускается если:** все остатки = 0 (файл без данных об остатках). В этом случае `snapshot_skipped: true`.

#### → `fact_stock_daily` (конфликт: `sku_wb,sale_date`, ignoreDuplicates):
| Колонки файла | Поле | Примечание |
|---|---|---|
| cols 340+ с датами | `sale_date` | из Excel-числа |
| значение ячейки | `sales_qty` | numeric |
| через skuMap | `sku_ms` | text |

**Логика дат:** cols 340-end, берётся последнее вхождение дублирующихся дат.

#### → `fact_price_changes` (конфликт: `sku_wb,price_date`):
- cols 16-340 с датированными заголовками → абсолютные цены (не дельты!)

---

### 1.3 ABC-анализ
**Upload type:** `abc` | **Парсер:** `parseABC.ts` | **Route:** `upload/abc/route.ts`

**Лист:** «АВС расшифровка» / «ABC расшифровка» (первое вхождение)
**Период:** из имени файла (месяц на русском) → `period_month` = YYYY-MM-01
**Фильтр:** только SKU из `dim_sku` (через `loadKnownSkus`)

#### → `fact_abc` (конфликт: `sku_ms,upload_id`):
| Колонка файла | Поле в БД | Тип |
|---|---|---|
| «Артикул склада» / «Артикул МС» | `sku_ms` | text (PK) |
| из filename | `period_month` | date |
| «Количество» | `qty_stock_rub` | numeric — ТЗ в руб |
| «Себестоимость без НДС» | `cost` | numeric |
| «Выручка без НДС» | `revenue` | numeric |
| «Чистый маржинальный доход» / «ЧМД» | `chmd` | numeric |
| «Реклама, без НДС» | `ad_spend` | numeric |
| «Хранение, без НДС» | `storage` | numeric |
| «Тран расходы» / «Транспорт» | `transport` | numeric |
| «ЧМД за минусом» / «ЧМД чистый» | `chmd_clean` | numeric |
| «Рен-сть чистого ЧМД» | `profitability` | numeric (0..1 или %) |
| «Рен-сть выручки» | `revenue_margin` | numeric |
| «ТЗ» | `tz` | numeric — товарный запас ₽ |
| «Об ТЗ, дн» / «Оборачиваемость» | `turnover_days` | numeric |
| «Доля по ЧМД» | `chmd_share` | numeric |
| «Итоговый класс» (1-е вхождение) | `abc_class` | text (A/B/C/убыток) |
| «Итоговый класс» (2-е вхождение) | `abc_class2` | text |
| «Флаг новинки» / «Новинка» | `novelty_flag` | boolean |
| «Статус остатка» | `stock_status` | text |

**GMROI не хранится** — рассчитывается на лету: `chmd_clean / tz`

---

### 1.4 Каталог (Свод)
**Upload type:** `catalog` | **Парсер:** `parseCatalog.ts` | **Route:** `upload/catalog/route.ts`

**Лист:** «Свод» (первое вхождение)
**Конфликт:** `sku_ms` → upsert обновляет dim_sku

#### → `dim_sku`:
| Колонка файла | Поле в БД | Тип |
|---|---|---|
| «Артикул МС» / «Артикул МС» / «Артикул склада» | `sku_ms` | text (PK) |
| «Артикул WB» | `sku_wb` | bigint |
| «Название» | `name` | text — краткое для дашборда |
| «Номенклатура» | `full_name` | text — полное для WB карточки |
| «Бренд» | `brand` | text |
| «Поставщик» | `supplier` | text |
| «Страна» | `country` | text |
| «Предмет WB» | `subject_wb` | text |
| «Категория WB» | `category_wb` | text |
| «НДС, %» | `nds_pct` | numeric |
| «Доля рынка» | `market_share` | numeric |
| «Привлекательность ниши» | `niche_appeal` | numeric |
| «Доступность» | `availability` | text |
| «Процент выкупа» | `buyout_pct` | numeric |
| «Средний рейтинг» | `avg_rating` | numeric |
| «Сезонность» | `seasonality` | text |
| «Старт сезона» | `season_start` | text |
| «Длина сезона» | `season_length` | integer |
| «Топ месяц» | `top_month` | text |
| «Топ-фраза по объёму» / «Топ-фраза» | `top_phrase` | text |
| «Январь»..«Декабрь» | `month_jan`..`month_dec` | numeric — сезонные коэффициенты |

**Не в каталоге (только в схеме):** `updated_at` (auto)

---

### 1.5 Таблица Китай
**Upload type:** `china` | **Парсер:** `parseChina.ts` | **Route:** `upload/china/route.ts`

**Лист:** «Свод» | **Блок:** до второго вхождения колонки «Март» (WB-блок)
**Дополнительный лист:** «Зеленка» — читается лог. плечо (`lead_time_days`)
**Фильтр:** только SKU из `dim_sku`

#### → `fact_china_supply` (конфликт: `sku_ms,upload_id`):
| Колонка файла | Поле в БД | Тип |
|---|---|---|
| «Артикул склада» / «Артикул» | `sku_ms` | text |
| «Март»..«Август» (WB-блок) | `plan_mar`..`plan_aug` | integer |
| «Запас 15» | `reserve_15d` | integer |
| «% выкупа на ВБ» | `buyout_pct_wb` | numeric |
| «% маркетинга» | `marketing_pct` | numeric |
| «Себа план» / «Себестоимость план» | `cost_plan` | numeric |
| «%изм себы» | `cost_change_pct` | numeric |
| «Ср цена» / «Средняя цена» | `avg_price` | numeric |
| «В пути» | `in_transit` | integer |
| «В произв» / «В производстве» | `in_production` | integer |
| «Ближайшая дата» | `nearest_date` | date |
| «Кол-во к заказу» | `order_qty` | integer |
| «Сумма в себах» / «Сумма заказа» | `order_sum_cost` | numeric |
| «Рейтинг» | `rating` | numeric |
| Лист «Зеленка», «Лог. плечо, дн» | `lead_time_days` | integer |

---

## 2. СХЕМА SUPABASE — ВСЕ ПОЛЯ И ИСТОЧНИКИ

### uploads
Создаётся каждым upload-route при загрузке файла.

| Поле | Тип | Кто заполняет |
|---|---|---|
| `id` | uuid | auto |
| `file_type` | text | route: `sku_report` / `stock` / `abc` / `catalog` / `china` |
| `filename` | text | route |
| `uploaded_at` | timestamp | auto |
| `period_start` | date | sku_report (первая дата), abc (period_month), остальные null |
| `period_end` | date | sku_report (последняя дата), остальные null |
| `rows_count` | integer | парсер |
| `status` | text | `ok` / `error` |
| `error_msg` | text | при ошибке |

### dim_sku - нужно наладить схему добавления sku в данную таблицу. При появлении новых SKU в отчете по sku - они не загружаются в дашборд, если отсутствуют в dim_sku
Заполняется из каталога. Служит мастер-таблицей SKU.
- PK: `sku_ms`
- Поля: все из каталога (см. 1.4) + `updated_at`
- **Критически важна:** все остальные таблицы связываются через `sku_ms` или `sku_wb`

### fact_sku_snapshot
Один снапшот на загрузку SKU-отчёта. Конфликт: `sku_ms,upload_id`.
- Источник: `sku_report` только
- `margin_pct` = **дробное число** (0.173), т.к. парсер делит на 100
- `price` = цена на `snap_date` (последний день отчётного периода) - **неверно! цена должна быть на первый день отчетного периода**
- НЕ содержит: `total_stock` (есть fbo+fbs, но нет суммы), `kits_stock`, `ots_reserve_days` пустые - **добавить колонку "остаток комплектов" и считать total_stock сразу при загрузке отчета по sku как сумму («Остаток на ВБ ФБО» + «Остаток FBS Пушкино» + «Остаток FBS Смоленск» + «Остаток комплектов»**)

### fact_sku_daily
Ежедневные метрики из SKU-отчёта. Конфликт: `sku_ms,metric_date`.
- Источник: `sku_report` только
- Только SKU с рекламой (без органики)
- 5 дней за отчёт. При перегрузке — upsert обновляет

### fact_stock_snapshot - удалить
Снапшот остатков из таблицы остатков. Конфликт: `sku_wb,upload_id`.
- Источник: `stock` только
- `margin_pct` = **число как есть** (17.3), т.к. парсер НЕ делит на 100 ← **БАГ П1**
- `price` = абсолютная цена (прямо из файла, не дельта)
- `snap_date` = последняя дата из заголовков файла

### fact_stock_daily - удалить
Продажи по дням из таблицы остатков. Конфликт: `sku_wb,sale_date` (ignoreDuplicates).
- Источник: `stock` только
- Содержит все SKU (не только рекламные)
- Используется в `OrderTab` для расчёта скорости продаж

### fact_price_changes 
Изменения цен. Конфликт: `sku_wb,price_date`.
- **Два источника записи:**
  1. `sku_report`: дельты % → пересчёт в абсолютные назад от snap_date
  2. `stock`: абсолютные цены напрямую из файла
- Последний загруженный файл побеждает (upsert). Если один и тот же `sku_wb,price_date` был в обоих — победит тот, что загружен позже ← **БАГ П2**
- **БАГ П3:** нет записи цены до первого изменения → `price_before` может быть null

### fact_abc
Данные ABC-анализа. Конфликт: `sku_ms,upload_id`.
- Источник: `abc` только
- `profitability` = рентабельность чистого ЧМД (может быть как 0..1, так и 0..100 — зависит от файла)
- `tz` = товарный запас в руб. (нужен для GMROI)
- **GMROI** не хранится: рассчитывается как `chmd_clean / tz`

### fact_china_supply
Данные по поставкам из Китая. Конфликт: `sku_ms,upload_id`.
- Источник: `china` только
- `nearest_date` = ближайшая дата поступления

### fact_daily_agg
Агрегированные данные по дням и нишам. Заполняется SQL-функцией.
- Источник: `refresh_daily_agg()` вызывается после загрузки `sku_report`
- Содержит: revenue, ad_spend, chmd, ctr_avg, cr_cart_avg, cr_order_avg, cpm_avg, cpc_avg
- Группировка: `metric_date, category_wb, subject_wb`

### sku_notes
Заметки к SKU. Заполняется через интерфейс дашборда.

---

## 3. МАППИНГ ВКЛАДКА → ИСТОЧНИК ДАННЫХ

| Вкладка | API-роут | Таблицы Supabase |
|---|---|---|
| Обзор (Overview) | `/api/dashboard/overview` | `fact_daily_agg`, `fact_sku_snapshot` |
| Реклама (Analytics) | `/api/dashboard/analytics` | `fact_sku_daily`, `fact_sku_snapshot`, `fact_price_changes` |
| Цены (Prices) | `/api/dashboard/prices` | `fact_price_changes`, `fact_sku_snapshot`, `fact_sku_daily` |
| Логистика и заказы (Orders) | `/api/dashboard/orders` | `fact_stock_snapshot`, `fact_stock_daily`, `fact_china_supply`, `fact_abc`, `dim_sku` |
| Аналитика SKU (SkuTable) | `/api/dashboard/sku-table` | `fact_sku_daily`, `fact_sku_snapshot`, `fact_abc`, `dim_sku` |
| Анализ ниш и ABC (Niche) | `/api/dashboard/niches` | `dim_sku`, `fact_abc`, `fact_sku_snapshot` |

---

## 4. ИЗВЕСТНЫЕ БАГИ

### П1: margin_pct в fact_stock_snapshot — неправильный масштаб
- **Файл:** `src/lib/parsers/parseStock.ts`, строка 143
- **Проблема:** `margin_pct: marginCol >= 0 ? toNum(row[marginCol]) : null` — значение 17.3 записывается как 17.3
- **В fact_sku_snapshot:** парсер SKU-отчёта делает `/ 100` → хранит 0.173
- **Следствие:** `OrderTab` показывает `margin_pct` в 100x завышенном виде
- **Фикс:** добавить `/ 100` в `parseStock.ts:143`

### П2: Конфликт двух источников в fact_price_changes
- **Проблема:** `sku_report` и `stock` оба пишут в `fact_price_changes` с конфликтом `sku_wb,price_date` - **stock удаляем - конфликт решается автоматически?**
- `sku_report` хранит пересчитанные из дельт цены (менее точные)
- `stock` хранит прямые абсолютные цены (точнее)
- Последний загруженный файл перезаписывает предыдущий - **так быть не должно**
- **Риск:** если загрузить `sku_report` после `stock` — точные цены из stock затрутся приближёнными

### П3: Отсутствие «Цены до» для первого изменения
- **Проблема:** `price_before` вычисляется как предыдущая запись в `fact_price_changes`
- Если у SKU одно изменение цены — предыдущего нет → `price_before = snap_date price`
- Если snap_date < period start — вкладка «Цены» покажет snap цену как «было»
- **Частичный фикс в коде:** `prices/route.ts` использует расширенный диапазон from−14д

### П4: manager_order всегда 0 в OrderTab
- **Файл:** `src/app/api/dashboard/orders/route.ts`, строка 213
- **Проблема:** `manager_order: 0` — hardcoded
- **Фикс:** нужна таблица или поле для хранения ручных заказов менеджера

### П5: Расчёт заказа без сезонности
- **Файл:** `src/app/api/dashboard/orders/route.ts`, строки 145
- **Проблема:** `needed = max(0, round(dpd × horizon - alreadyHave))` — линейный расчёт
- **Нужно:** сезонная коррекция через `dim_sku.month_jan..dec`

### П6: oos_days всегда 0 или 1
- **Файл:** `src/app/api/dashboard/orders/route.ts`, строка 206
- **Проблема:** `oos_days: r.status === 'oos' ? 1 : 0` — фейковое значение
- **Нужно:** считать реальное количество дней без остатка из `fact_stock_daily`

### П7: fact_sku_snapshot не содержит total_stock
- **Проблема:** в схеме есть `kits_stock`, но парсер SKU-отчёта его не заполняет. `total_stock` отсутствует в таблице (есть только в `fact_stock_snapshot`)
- **Следствие:** вкладка Orders использует `fact_stock_snapshot` (из stock-файла), а не из SKU-отчёта
- **Нужно:** считать total_ctock как сумму («Остаток на ВБ ФБО» + «Остаток FBS Пушкино» + «Остаток FBS Смоленск» + «Остаток комплектов»), для этого включить в загрузку колонку «Остаток комплектов»


---

## 5. КОЛОНКИ В БД, КОТОРЫЕ НЕ ЗАПОЛНЯЮТСЯ ПАРСЕРАМИ

| Таблица | Поле | Причина |
|---|---|---|
| `fact_sku_snapshot` | `kits_stock` | нет в парсере SKU-отчёта |
| `fact_sku_snapshot` | `ots_reserve_days` | нет в парсере SKU-отчёта |
| `fact_sku_daily` | `spp` | нет в отчёте по SKU |
| `dim_sku` | `updated_at` | auto (триггер) |

---

## 6. ЗАВИСИМОСТИ ПРИ ЗАГРУЗКЕ (правильный порядок)

1. **Каталог** (`catalog`) — загружается первым. Создаёт `dim_sku`. Без него остальные не знают маппинг WB→MS.
2. **Отчёт по SKU** (`sku_report`) — нужен `dim_sku` для skuMap.
3. **Таблица остатков** (`stock`) — нужен `dim_sku` для skuMap. - не сипользуем больше 
4. **ABC** (`abc`) — нужен `dim_sku` (фильтрует через loadKnownSkus).
5. **Китай** (`china`) — нужен `dim_sku` (фильтрует через loadKnownSkus).

---

## 7. РАСЧЁТНЫЕ ПОЛЯ (вычисляются в API, не хранятся)-для рассчетных показателей может использовать отдельную таблицу в supabase? чтобы рассчитывалось при загрузке отчетов и быстрее подгружалось в дашборд?

| Поле | Формула | Где |
|---|---|---|
| `dpd` | `sales_31d / days_with_stock` | `orders/route.ts` |
| `days_stock` | `total_stock / dpd` | `orders/route.ts` |
| `calc_order` | `max(0, dpd × horizon − already_have)` | `orders/route.ts` |
| `already_have` | `total_stock + in_transit + in_production` | `orders/route.ts` |
| `GMROI` | `chmd_clean / tz` | не реализован, в плане |
| `price_before` | предыдущий `fact_price_changes.price` для этого SKU | `prices/route.ts` |
| `Δ CTR` | avg(ctr 7д после) - avg(ctr 7д до) изменения цены | `prices/route.ts` |
| `forecast_30d` | `база_норм × коэфф_след_30д / avg_year` | в плане |
