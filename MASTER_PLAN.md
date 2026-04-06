# MASTER PLAN — Marketspace 2.0
_Создан: 05.04.2026. Обновлять по мере выполнения. Последнее обновление: 06.04.2026_

---

## ТЕКУЩЕЕ СОСТОЯНИЕ БД (Supabase)

### Таблицы с данными:
| Таблица | Строк | Статус |
|---|---|---|
| `fact_stock_daily` | 91 500 | ✅ заполнена |
| `fact_stock_snapshot` | 4 860 | ✅ заполнена |
| `dim_sku` | 2 812 | ✅ заполнена (из Свода) |
| `fact_abc` | 2 586 | ✅ заполнена |
| `fact_china_supply` | 500 | ✅ заполнена |
| `uploads` | 13 | ✅ |
| `fact_sku_daily` | 0 | ❌ ПУСТО — нужна загрузка Отчёта по SKU |
| `fact_sku_snapshot` | 0 | ❌ ПУСТО — нужна загрузка Отчёта по SKU |
| `fact_price_changes` | 0 | ❌ ПУСТО — заполняется из parseStock |
| `sku_notes` | 0 | пусто, ок |

### Ключи связи:
- `dim_sku.sku_ms` ← артикул МС (из Свода) — **главный ключ**
- `dim_sku.sku_wb` ← артикул WB
- `fact_stock_snapshot.sku_wb` → связь через sku_wb
- `fact_sku_daily.sku_ms`, `fact_sku_snapshot.sku_ms` → связь через sku_ms
- `fact_abc.sku_ms`, `fact_china_supply.sku_ms` → связь через sku_ms

---

## БЛОК A — ДАННЫЕ (приоритет #1)

### A1. Критическая проблема: fact_sku_daily и fact_sku_snapshot ПУСТЫЕ

**Причина:** Ни разу не загружался «Отчёт по SKU» (`Таблицы/Отчет по sku.xlsx`).

**Что не работает без этих данных:**
- AnalyticsTab: выручка, ДРР, CTR, CR — всё 0
- PriceTab (воронка): CTR, CR, CPC, CPM — всё 0
- SkuTableTab: drr, ctr, cr_basket, cr_order, cpo — null
- SkuModal: все метрики рекламы и выручки

**Решение:** Загрузить файл `Таблицы/Отчет по sku.xlsx` через UpdateTab → `/api/upload/sku-report`.

### A2. fact_price_changes ПУСТА

**Причина:** `parseStock` заполняет `fact_price_changes` при загрузке Таблицы остатков, но данные не попали.

**Решение:** Проверить route `/api/update/stock` — убедиться что `price_changes` из parseStock сохраняются в `fact_price_changes`.

### A3. Данные которые ЕСТЬ и работают (источники):

| Данные | Откуда | Таблица Supabase | Используется в |
|---|---|---|---|
| Остатки (FBO/FBS/total) | `Таблица остатков.xlsx` → `fact_stock_snapshot` | `fact_stock_snapshot` | OrderTab, SkuTableTab, SkuModal |
| Продажи по дням | `Таблица остатков.xlsx` → `fact_stock_daily` | `fact_stock_daily` | OverviewTab (тренд), OrderTab (расчёт заказа) |
| ABC классы, ЧМД, выручка, рентабельность | `АВС анализ.xlsx` → `fact_abc` | `fact_abc` | OverviewTab KPI, AnalyticsTab, NicheTab, SkuTableTab |
| В пути, в производстве, план по месяцам | `Потребность Китай.xlsx` → `fact_china_supply` | `fact_china_supply` | OrderModal (расчёт заказа) |
| SKU-справочник, сезонность, менеджер | `Свод.xlsb` → `dim_sku` | `dim_sku` | Все вкладки |
| Рекламные метрики (CTR, CR, ДРР, выручка по дням) | `Отчёт по SKU.xlsb` → `fact_sku_daily` | `fact_sku_daily` | ❌ ПУСТО |
| Снапшот (остатки, маржа, поставки) | `Отчёт по SKU.xlsb` → `fact_sku_snapshot` | `fact_sku_snapshot` | ❌ ПУСТО |
| Изменения цен | `Таблица остатков.xlsx` → `fact_price_changes` | `fact_price_changes` | ❌ ПУСТО |

### A4. Что взять из каких колонок (по инструкции)

#### Вкладка «Свод» (OverviewTab):
| Показатель | Источник | Таблица | Колонка |
|---|---|---|---|
| Выручка | АВС анализ | `fact_abc` | `revenue` |
| ЧМД | АВС анализ | `fact_abc` | `chmd` |
| Маржа % | АВС анализ | `fact_abc` | `revenue_margin` или `chmd/revenue` |
| Рекламные расходы | АВС анализ | `fact_abc` | `ad_spend` |
| ДРР | АВС анализ | `fact_abc` | `ad_spend/revenue` |
| Остатки | Таблица остатков | `fact_stock_snapshot` | `fbo_wb + fbs_pushkino + fbs_smolensk` |
| Продажи по дням (тренд) | Таблица остатков | `fact_stock_daily` | `sales_qty` по `sale_date` |
| ABC разбивка | АВС анализ | `fact_abc` | `abc_class` |

#### Вкладка «Продажи и экономика» (AnalyticsTab):
| Показатель | Источник | Таблица | Колонка |
|---|---|---|---|
| Выручка по дням | Отчёт по SKU | `fact_sku_daily` | `revenue` |
| Расходы по дням | Отчёт по SKU | `fact_sku_daily` | `ad_spend` |
| ЧМД | АВС анализ | `fact_abc` | `chmd` |
| Маржа % | АВС анализ | `fact_abc` | `revenue_margin` |
| ДРР | Отчёт по SKU | `fact_sku_daily` | `drr_total` или `ad_spend/revenue` |
| По категориям | dim_sku + fact_abc | JOIN | `category_wb` |

#### Вкладка «Реклама и воронка» (PriceTab):
| Показатель | Источник | Таблица | Колонка |
|---|---|---|---|
| CTR | Отчёт по SKU | `fact_sku_daily` | `ctr` |
| CR корзина | Отчёт по SKU | `fact_sku_daily` | `cr_cart` |
| CR заказ | Отчёт по SKU | `fact_sku_daily` | `cr_order` |
| CPC | Отчёт по SKU | `fact_sku_daily` | `cpc` |
| CPM | Отчёт по SKU | `fact_sku_daily` | `cpm` |
| Доля рекл. заказов | Отчёт по SKU | `fact_sku_daily` | `ad_order_share` |
| Изменения цен | Таблица остатков | `fact_price_changes` | `price`, `price_date` |
| Δ CTR/CR после изменения цены | JOIN fact_price_changes + fact_sku_daily | по дате |

#### Вкладка «Логистика и заказы» (OrderTab):
| Показатель | Источник | Таблица | Колонка |
|---|---|---|---|
| Остатки FBO/FBS/MC | Таблица остатков | `fact_stock_snapshot` | `fbo_wb`, `fbs_pushkino`, `fbs_smolensk` |
| В пути | Потребность Китай | `fact_china_supply` | `in_transit` |
| В производстве | Потребность Китай | `fact_china_supply` | `in_production` |
| Продажи 7/14/31д | Таблица остатков | `fact_stock_daily` | `sales_qty` |
| Себестоимость | Потребность Китай | `fact_china_supply` | `cost_plan` |
| Ближайшая дата поставки | Потребность Китай | `fact_china_supply` | `nearest_date` |
| Лог. плечо | Свод (dim_sku) | `dim_sku` | нужно добавить колонку `lead_time_days` |
| ABC класс | АВС анализ | `fact_abc` | `abc_class` |
| Рентабельность (маржа%) | АВС анализ | `fact_abc` | `profitability` |
| GMROI | АВС анализ | `fact_abc` | вычислить: `chmd_clean/tz` |
| План продаж по месяцам | Потребность Китай | `fact_china_supply` | `plan_mar..plan_aug` |

#### Вкладка «Аналитика по SKU» (SkuTableTab):
| Показатель | Источник | Таблица | Колонка |
|---|---|---|---|
| CTR, CR, CPO, ДРР | Отчёт по SKU | `fact_sku_daily` | `ctr`, `cr_order`, `ad_spend/orders`, `drr_total` |
| Выручка | АВС анализ или fact_sku_daily | aggregate |
| Маржа % | АВС анализ | `fact_abc` | `revenue_margin` |
| ЧМД | АВС анализ | `fact_abc` | `chmd` |
| Score | Рассчитать клиентом | из всех данных |

### A5. Что нужно добавить в dim_sku:
- `lead_time_days` (лог. плечо, дней) — сейчас хардкод 60 в orders/route.ts
- `mc_stock` (остаток МС склада) — нет в fact_stock_snapshot
- `manager` — уже есть в fact_sku_snapshot, нужно синхронизировать с dim_sku

### A6. Что нужно добавить в fact_stock_snapshot:
- `mc_stock` — остаток на МС складе (MC склад из Таблицы остатков)
- `oos_days_31` — дней OOS за 31 дней (вычислить при загрузке)
- `dpd_7`, `dpd_14`, `dpd_31` — продажи/день за периоды

### A7. Что нужно добавить в fact_abc:
- Сейчас есть: `sku_ms`, `abc_class`, `revenue`, `chmd`, `profitability`, `turnover_days`, `upload_id`
- Нужно добавить: `abc_class2` (второй класс), `tz` (ТЗ), `chmd_clean`, `ad_spend`, `cost`

### A8. Расчёт заказа (финальная формула)
```
1. dpd_base = fact_stock_daily.sales_qty за 31д / 31
2. коэф_текущий = dim_sku.month_[текущий] / avg(month_jan..dec)
3. база_норм = dpd_base / коэф_текущий
4. месяцы_горизонта = месяцы от (сегодня + lead_time_days) на горизонт 60/90д
5. коэф_целевой = avg(month_[горизонт]) / avg(month_jan..dec)
6. потребность = база_норм × коэф_целевой × горизонт_дней
7. CV = stddev(продажи 31д по дням) / dpd_base
8. страховой_дни = sqrt(lead_time_days) × CV
9. страховой_шт = база_норм × коэф_целевой × страховой_дни
10. в_наличии = FBO + FBS + МС + in_transit + in_production
11. к_заказу = max(0, потребность + страховой_шт - в_наличии)
```

### A9. SQL для materialized view (unified_sku)
Создать в Supabase для быстрых запросов модального окна:
```sql
CREATE MATERIALIZED VIEW unified_sku AS
SELECT
  d.sku_ms, d.sku_wb, d.name, d.brand, d.supplier, d.manager,
  d.subject_wb, d.category_wb,
  d.month_jan..d.month_dec,
  ss.fbo_wb, ss.fbs_pushkino, ss.fbs_smolensk, ss.total_stock,
  ss.price, ss.margin_pct, ss.supply_date, ss.supply_qty,
  ch.in_transit, ch.in_production, ch.nearest_date, ch.cost_plan,
  ch.plan_mar..ch.plan_aug,
  ab.abc_class, ab.abc_class2, ab.chmd, ab.revenue, ab.profitability,
  ab.tz, ab.turnover_days, ab.chmd_clean, ab.ad_spend
FROM dim_sku d
LEFT JOIN fact_stock_snapshot ss ON ss.sku_wb = d.sku_wb
  AND ss.upload_id = (SELECT id FROM uploads WHERE file_type='stock' AND status='ok' ORDER BY uploaded_at DESC LIMIT 1)
LEFT JOIN fact_china_supply ch ON ch.sku_ms = d.sku_ms
  AND ch.upload_id = (SELECT id FROM uploads WHERE file_type='china' AND status='ok' ORDER BY uploaded_at DESC LIMIT 1)
LEFT JOIN fact_abc ab ON ab.sku_ms = d.sku_ms
  AND ab.upload_id = (SELECT id FROM uploads WHERE file_type='abc' AND status='ok' ORDER BY uploaded_at DESC LIMIT 1);
```

---

## БЛОК B — МОДАЛЬНЫЕ ОКНА (приоритет #2) ✅ ВЫПОЛНЕНО (06.04.2026)

### B1. SkuModal — стандартный (все вкладки кроме OrderTab) ✅

**Файл:** `src/components/ui/SkuModal.tsx`

**Открывается:** клик на строку в SkuTableTab, AnalyticsTab, PriceTab, NicheTab

**Структура:**
```
[Шапка] SKU + название + бейджи OOS/Маржа + [×]
[Ряд 1 — 4 карточки] Цена | Маржа | ЧМД период | Расходы рекл.
[Ряд 2 — 3 карточки] Выручка период | ДРР факт | ДРР рекл + доля рекл.заказов
[Сравнение периодов] текущий vs предыдущий: Выручка/ЧМД/Расходы/ДРР + Δ
[Заметка] textarea → POST /api/sku-notes
[Конверсии — 5 карточек] CTR | CR корзина | CR заказ | CPC·CPM | CPO
[Логистика — 3 ряда]
  Ряд 1: Дата поставки (план) | Объём шт. | Дней до прихода
  Ряд 2: Общий остаток | FBO | FBS | МС склад
  Ряд 3: Запас до OOS (табл.) | Запас до OOS (расч.) | Остаток дней | Продажи шт/день
[Графики — 2 рядом]
  1. Выручка + Расходы по дням (bar+line)
  2. CTR + CR корзина + CR заказ по дням (line)
[Таблица изменений цен — последние 10]
  Дата | Было | Стало | Δ% | Δ CTR | Δ CR корзина | Δ CR заказ
[Нижняя панель] [Excel] [Сохранить заметку]
```

**API:** `GET /api/sku-modal?sku_ms=XXX` — новый route, собирает всё из unified_sku + fact_sku_daily (последние 30д) + fact_price_changes (последние 10)

### B2. OrderModal — вкладка «Логистика и заказы» ✅

**Файл:** `src/components/ui/OrderModal.tsx`

**Структура (1220px, 2×2 сетка):**
```
[Шапка] SKU + название + артикул + поставщик + бейджи OOS/Маржа + [×]

[Блок 1 — ОСТАТКИ (лев.верх)]
  FBO WB | FBS Пушкино | FBS Смоленск | МС склад
  В пути (+зелёный) | В производстве
  Итого наличие | Итого в работе (#22C55E)

[Блок 2 — ПРОДАЖИ ИЗ SHEET1 (прав.верх)]
  7 дней X/день OOS: Y дн
  14 дней X/день OOS: Y дн
  31 день X/день OOS: Y дн
  Тренд 14д Δ% | Год назад X/день
  CV (вариация) X | Дней запаса сейчас X дн

[Блок 3 — РАСЧЁТ ЗАКАЗА (лев.низ, главный)]
  Продажи 31д (база) X/день OOS: X из 31
  Коэф. текущего мес. X (высокий/низкий сезон)
  База (+ коэф.) X/день
  Лог. плечо X дн | Дата прихода YYYY-MM-DD
  Горизонт по месяцам:
    [месяц (коэф.)] X шт
    ...
  Потребность итого X шт
  Страховой запас (X дн) X шт
  Итого нужно X шт | Минус наличие X шт
  [Расч. заказ (60→60д)] 0 шт  ← синяя кнопка
  [Заказ менеджера] 0 шт        ← фиолетовая кнопка
  Себестоимость: X ₽ × X = X млн ₽

[Блок 4 — ABC И ФИНАНСЫ (прав.низ)]
  ABC (ЧМД/выр) | ABC (выр/об) | GMROI
  Маржа % | Рентабельность | Оборачиваемость | Выручка
  Сезонность ниши (бейдж) | Пик: Месяц
  [Мини-график сезонности — цветные квадраты по месяцам]
  ПЛАН ПРОДАЖ WB ПО МЕСЯЦАМ (маленькая таблица 2 ряда)

[Нижняя панель — фиксированная]
  [Excel] [Заметка ................] [Сохранить]
```

**API:** `GET /api/order-modal?sku_ms=XXX` — собирает данные из unified_sku + fact_stock_daily (расчёт CV, продажи по периодам)

---

## БЛОК C — КЛИК ПО КАРТОЧКАМ (приоритет #3)

### C1. Hover-эффект на все кликабельные карточки
- `KPIBar` ячейки с `onClick` → `cursor: pointer`, `scale(1.02)` при hover
- Алерт-блоки → то же самое

### C2. Логика навигации (через Zustand uiStore)

Добавить в `uiStore.ts`:
```typescript
pendingSkuFilter: SkuFilter | null
setPendingFilter: (f: SkuFilter) => void
clearPendingFilter: () => void
```

| Карточка | Действие | Фильтр в SkuTableTab |
|---|---|---|
| STOP ADS | → вкладка SKU | `oos=true AND ad_spend>0` |
| OOS с потерями | → вкладка SKU | `oos=true AND sales_31d>0` |
| LOW STOCK | → вкладка SKU | `stock_days < lead_time` |
| DRR > Маржа | → вкладка SKU | `drr > margin_pct` |
| Потенциал роста | → вкладка SKU | `ctr > avg_ctr AND cr_order < avg_cr` |
| Критический запас (OrderTab) | фильтр в текущей таблице | `status=critical` |
| Внимание (OrderTab) | фильтр в текущей таблице | `status=warning` |

### C3. SkuTableTab — читает pendingFilter при монтировании
```typescript
useEffect(() => {
  const f = uiStore.pendingFilter
  if (f) { applyFilter(f); uiStore.clearPendingFilter() }
}, [])
```

---

## БЛОК D — СОРТИРОВКА И ФИЛЬТРЫ ТАБЛИЦ (приоритет #4)

### D1. Сортировка по клику на заголовок колонки
Для каждой таблицы добавить:
```typescript
const [sortKey, setSortKey] = useState<string | null>(null)
const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
// Заголовки: <th onClick={() => toggleSort('revenue')}>Выручка {sortIcon}</th>
// Данные: [...rows].sort((a,b) => ...)
```

### D2. Расширенные фильтры в FilterBar (по вкладкам)

**PriceTab («Реклама и воронка»):**
```
Группа «Реклама и воронка»:
  Δ ЦЕНЫ: Рост | Снижение | Все
  Δ CTR: Рост | Падение | Все
  Δ CR КОРЗИНА: Рост | Падение | Все
  Δ CR ЗАКАЗ: Рост | Падение | Все
  CPO: >200₽ | ≤200₽ | Все
  Δ CPM: Рост | Падение | Все
  Δ CPC: Рост | Падение | Все
```

**AnalyticsTab («Продажи и экономика»):**
```
Группа «Продажи и экономика»:
  Δ ВЫРУЧКА: Рост | Падение | Все
  Δ ЧМД: Рост | Падение | Все
  Δ МАРЖА: Рост | Падение | Все
  Δ ДРР: Рост | Падение | Все
  МИН. ВЫРУЧКА: >100K | >500K | >1M | Все
```

**NicheTab («Анализ ниш и ABC»):**
```
Группа «Анализ ниш и ABC»:
  СЕЗОННОСТЬ: Сезонный | Круглый год | Все
  КАТЕГОРИЯ: [выпадающий список]
  СТАРТ СЕЗОНА: [выбор месяца]
  ПИК СЕЗОНА: [выбор месяца]
```

**OrderTab («Логистика и заказы»):**
```
Группа «Логистика и заказы»:
  ПЕРИОД ПРОДАЖ: 7д | 14д | 31д
  ГОРИЗОНТ ЗАКАЗА: 60д | 90д
  СТАТУС: Все | Критический | Внимание | Норма
  ABC КЛАСС: Все | A | B | C
  ТОЛЬКО С ЗАКАЗОМ: [toggle]
```

---

## БЛОК E — ДОРАБОТКА ВКЛАДОК (приоритет #5)

### E1. OverviewTab («Свод»)
- [ ] Главный график: 3 линии — Выручка (синяя), ЧМД (зелёная), Расходы (красная), ось Y в млн ₽
- [ ] ТОП-15 SKU таблица внизу: Score | SKU | Название | Выручка | Маржа% | Остаток дней
- [ ] Кнопка Excel для таблицы ТОП-15

### E2. AnalyticsTab («Продажи и экономика»)
- [ ] KPIBar: добавить 7-ю карточку «Прогноз выручки 60д» (#3B82F6)
- [ ] Таблица: добавить столбец «Прогноз 60д (шт)» синим цветом
- [ ] **Иерархическая таблица**: Категория ▼ → при клике разворачивает предметы → при клике на предмет разворачивает SKU
- [ ] Summary bar: «Выбрано: X SKU • Выручка: Y» + [Excel]

### E3. PriceTab → переименовать в «Реклама и воронка»
- [ ] Добавить 3-й график: метрики до/после изменения цены (сравнение bar chart)
- [ ] Таблица: добавить Δ CPM | Δ CPC
- [ ] Воронка (CTR → CR корзина → CR заказ) — загружать из `fact_sku_daily` (avg по периоду)

### E4. OrderTab («Логистика и заказы»)
- [ ] KPIBar: добавить 6-ю карточку «Прогноз продаж 60д» (#3B82F6)
- [ ] 4 графика (2×2):
  - Тренд запасов и OOS
  - План vs Факт
  - Сезонность (heatmap по месяцам)
  - **Прогноз 60д**: синяя линия факт + зелёная прогноз + красный пунктир остаток
- [ ] Таблица: добавить «Прогноз 60д (шт)»
- [ ] Summary bar + [Excel]

### E5. SkuTableTab («Аналитика по SKU»)
- [ ] Summary bar: добавить «Прогноз 60д всего: X шт»
- [ ] Правая боковая панель (280px, glass): доп. фильтры
  - □ OOS критично | □ ДРР > Маржа | □ Маржа < 15% | □ Только с рекламой
  - [Применить] [Сбросить]
- [ ] Таблица: добавить «Прогноз 60д (шт)» (#3B82F6)

### E6. NicheTab («Анализ ниш и ABC»)
- [ ] KPIBar: добавить 5-ю карточку «Средний прогноз 60д»
- [ ] Графики: 1) рейтинг ниш (горизонтальные бары) 2) heatmap сезонности
- [ ] Таблица: добавить «Прогноз 60д (шт)»
- [ ] При клике на нишу → разворачивает список SKU внутри

---

## БЛОК F — STICKY HEADER (приоритет #6)

- [ ] `.top-nav` → `position: sticky; top: 0; z-index: 50`
- [ ] Вкладки-таблицы: `<thead>` → `position: sticky; top: [высота header]`
- [ ] На мобиле проверить что BottomNav не перекрывает контент

---

## БЛОК G — ГЛОБАЛЬНЫЙ КАЛЕНДАРНЫЙ ФИЛЬТР (приоритет #3.5, между C и D) ✅ КОМПОНЕНТ ГОТОВ (06.04.2026)
> ⚠️ Известная проблема: DateRangePicker отображается в хедере, но позиция требует уточнения.
> Нужно: переместить под логотип «M Marketspace 2.0» (вторая строка хедера, слева).
> Статус: компонент работает, от/до выбирается корректно. Подключение к API routes — в очереди.

### G1. Компонент DateRangeFilter (в FilterBar или отдельно)

**Расположение:** В каждой вкладке рядом с FilterBar (справа от кнопки Фильтры)

**Состояния:**
- Закрытый: показывает выбранный диапазон (напр. «01.03 – 05.04» или «05.04»)
- Открытый: полноэкранный/dropdown календарь с выбором периода

**Режимы выбора:**
- Одиночная дата — клик на один день
- Диапазон (по умолчанию) — клик на старт, клик на конец, подсветка диапазона
- Быстрые кнопки: «7 дней», «30 дней», «Этот месяц», «Прошлый месяц»

**Дизайн:**
- Кнопка в закрытом состоянии: `glass`, иконка `CalendarDays`, текст диапазона, `text-xs`
- Dropdown: `GlassCard`, навигация по месяцам (`<` `>`), сетка 7×6 дней
- Выбранные дни: `var(--accent)` фон, диапазон между ними: `var(--accent-glow)` фон
- Анимация: `framer-motion` `AnimatePresence`, spring stiffness:400 damping:30

**Технически:**
```typescript
// В Zustand uiStore или локальный state в каждой вкладке
interface DateRange {
  from: string  // ISO 'YYYY-MM-DD'
  to: string    // ISO 'YYYY-MM-DD'
}
// Передаётся в API как query params: ?from=2026-03-01&to=2026-04-05
```

**Влияние на API:**
- Все dashboard API routes принимают `from` и `to` query params
- Если не переданы → поведение как сейчас (последние данные)
- `fact_sku_daily` фильтруется по `metric_date BETWEEN from AND to`
- `fact_stock_daily` фильтруется по `sale_date BETWEEN from AND to`

### G2. Порядок реализации
1. Компонент `DateRangePicker.tsx` в `src/components/ui/`
2. Добавить `dateRange: DateRange` в `uiStore` (persist)
3. Обновить все API routes для принятия from/to params
4. Подключить в каждую вкладку

---

## ПОРЯДОК ВЫПОЛНЕНИЯ (обновлён 06.04.2026)

```
Шаг 0:  [A0] Починить Supabase Storage bucket ✅ (решено — загрузки работают)
Шаг 1:  [A1] Загрузить Отчёт по SKU → заполнить fact_sku_daily + fact_sku_snapshot — ⏳ данные пусты, файл загружается но парсер не находит нужные колонки
Шаг 2:  [A2] fact_price_changes — route сохраняет ✅, нужна повторная загрузка остатков
Шаг 3:  [A5/A6] mc_stock (fbs_smolensk) ✅ уже есть в fact_stock_snapshot. lead_time_days — нужно парсить из «Потребность Китай» (колонка AN)
Шаг 4:  [A9] Materialized view unified_sku — в очереди
Шаг 5:  [G] DateRangePicker ✅ компонент создан, в хедере. ⚠️ позиция требует правки (под лого слева). Подключение к API — в очереди
Шаг 6:  [B1] SkuModal ✅ создан, подключён в SkuTableTab
Шаг 7:  [B2] OrderModal ✅ создан, подключён в OrderTab
Шаг 8:  [C] Клики по карточкам + pendingFilter — ⏳ СЛЕДУЮЩИЙ
Шаг 9:  [D1] Сортировка по колонкам во всех таблицах — в очереди
Шаг 10: [D2] Расширенные фильтры в FilterBar — в очереди
Шаг 11: [E] Доработка вкладок (по очереди) — в очереди
Шаг 12: [F] Sticky header — в очереди
Шаг 13: [FIX] DateRangePicker — перенести под логотип (вторая строка хедера, слева)
Шаг 14: [FIX] Модалки — проверить и исправить после тестирования
```

---

## ОТВЕТЫ НА ВОПРОСЫ (05.04.2026)

1. **Отчёт по SKU** — Загружался 01.04 в 18:24, 2887 строк, статус ✓, но данные в fact_sku_daily/fact_sku_snapshot = 0. Причина: скорее всего ошибка парсинга (смещение `pos` или другие заголовки). При повторной загрузке — ошибка **"Storage: Load failed"** → Supabase Storage bucket не работает (RLS или bucket не существует). **Приоритет: исправить Storage прежде всего.**
2. **fact_price_changes** — route `/api/upload/stock` УЖЕ сохраняет `price_changes` (строки 74–80). Данные пусты потому что не было успешных загрузок. Дополнительно: цены можно взять из Отчёта по SKU, колонки CJ-CO — те же данные.
3. **МС склад** — в Таблице остатков: «Остаток FBS Смоленск» = колонка ADD. В парсере `parseStock.ts` уже читается как `fbs_smolensk`. В `fact_stock_snapshot` эта колонка уже есть.
4. **lead_time_days** — в файле «Потребность Китай», вкладка «Зеленка», колонка AN «Лог. плечо, дн». Данные ~1700 артикулов. При загрузке: upsert без удаления старых значений (если отсутствует в новом файле — оставлять старое).
