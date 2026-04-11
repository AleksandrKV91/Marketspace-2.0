# Метрики дашборда — источники и расчёты

## Источники данных (таблицы Supabase)

| Таблица | Что хранит |
|---|---|
| `fact_sku_daily` | Дневные показатели по SKU с рекламой: выручка, расходы на рекламу, CTR, CR, CPM, CPC |
| `fact_sku_snapshot` | Снимок состояния SKU на дату загрузки: маржа, остатки, цена, stock_days, менеджер, статус новинки |
| `dim_sku` | Справочник SKU: sku_ms (МС-артикул), sku_wb (WB-артикул), название, категория, страна, lead_time |
| `fact_abc` | ABC-аналитика: класс A/B/C, revenue_margin (маржа % из col M отчёта ABC) |
| `fact_stock_daily` | Дневные остатки по WB-артикулу: total_qty, days_with_sales |
| `dim_uploads` | Реестр загрузок: тип файла, дата, upload_id |
| `fact_china` | Данные по китайским поставщикам: lead_time_days |

---

## KPI карточки (вкладка Свод)

### Выручка
- **Источник:** `fact_sku_daily.revenue`
- **Расчёт:** сумма по всем SKU за выбранный период
- **Включает:** SKU с рекламой (из fact_sku_daily) + SKU без рекламы (из fact_sku_snapshot, revenue=0)
- **Дельта:** (текущий − предыдущий) / |предыдущий|, предыдущий период = такой же по длине до начала текущего

### ЧМД (Чистая маржинальная доходность)
- **Расчёт:** `∑(revenue_sku × margin_pct_sku − ad_spend_sku)` по всем SKU
- **Источник маржи:** `fact_sku_snapshot.margin_pct` (col Y отчёта по SKU «Маржа, %», делённая на 100)
- **Дельта:** аналогично выручке, но prevChmd считается с текущим margin_pct (исторических данных маржи нет)

### Маржа %
- **Расчёт:** средневзвешенная по выручке: `∑(margin_pct × revenue) / ∑revenue`
- **Источник:** `fact_sku_snapshot.margin_pct`
- **Дельта:** сравнивается предыдущий период (те же snapshot, но prev revenue как веса)
- **Градация:** <10% — низкая, 10–20% — средняя, ≥20% — хорошая

### ДРР (Доля рекламных расходов)
- **Расчёт:** `totalAdSpend / totalRevenue`
- **Источник:** `fact_sku_daily.ad_spend`, `fact_sku_daily.revenue`
- **Дельта:** сравнение ДРР текущего и предыдущего периода

### Расходы
- **Источник:** `fact_sku_daily.ad_spend`
- **Расчёт:** сумма по периоду

### Себестоимость
- **Расчёт:** `∑(revenue_sku × (1 − margin_pct_sku))`
- **Источник маржи:** `fact_sku_snapshot.margin_pct`

### Потери (OOS losses)
- **Расчёт:** для каждого OOS SKU (`fbo_wb + fbs_pushkino + fbs_smolensk = 0`):
  - `lost_oos = revenue_per_day × lead_time_days` (упущенная выручка пока едет товар)
  - `lost_ads = ad_spend` за период (слитый бюджет на OOS товар)
  - `total_loss = lost_oos + lost_ads`
- **revenue_per_day:** из `fact_stock_daily` (total_qty/days × price) или из периода
- **Клик по карточке:** модал с топ-10 OOS SKU по сумме потерь

---

## Графики

### Динамика выручки и ЧМД
- **Левая ось (₽):** Выручка (синий), ЧМД (зелёный) — Area chart
- **Правая ось (₽):** Расходы (красный пунктир) — Line chart
- **Агрегация:** по дням из `fact_sku_daily`, ЧМД = revenue_day × avgMarginPct − ad_spend_day
- **avgMarginPct** — средневзвешенная за весь период (одно число)

### Unit-экономика по дням
- **Левая ось (%):** ДРР % = `ad_spend_day / revenue_day × 100` (красный)
- **Правая ось (%):** ЧМД % = `chmd_day / revenue_day × 100` (голубой пунктир)
- **Маржа убрана** — она постоянна (одно значение на весь период), не информативна на графике

---

## Таблица ТОП-15 SKU по Score

### SKU Score (0–100)
Формула: `margin(25) + drr(20) + growth(10) + cr(10) + stock(20)`

| Компонент | Вес | Логика |
|---|---|---|
| Маржа | 25 | <10%→0; 10–15%→линейно 0→12.5; ≥15%→до 25 |
| ДРР | 20 | `(1 − ДРР/Маржа) × 20`; нет рекламы→20 |
| Рост выручки | 10 | sigmoid(growth×4)×10; нейтраль (0%)→5 |
| Конверсия | 10 | `min(CR / медиана_CR, 1) × 10` |
| Остаток | 20 | <плечо→0–10; плечо..2×плечо→10–20; OOS→0 |

**Штрафы:**
- OOS → Score = 0
- ДРР > Маржа → Score × 0.5
- Новинка с выручкой < 10 000 ₽ → Score − 10

### Колонки таблицы
| Колонка | Источник | Расчёт |
|---|---|---|
| Score | scoring.ts | см. выше |
| Выручка | fact_sku_daily.revenue | сумма за период |
| ЧМД | — | revenue × margin_pct − ad_spend |
| Расходы | fact_sku_daily.ad_spend | сумма за период |
| Себестоимость | — | revenue × (1 − margin_pct) |
| ДРР | — | ad_spend / revenue |
| Маржа % | fact_sku_snapshot.margin_pct | col Y ÷ 100 |
| Остаток шт. | fact_sku_snapshot: fbo_wb + fbs_pushkino + fbs_smolensk | сумма трёх складов |
| Остаток дн. | fact_sku_snapshot.stock_days | из отчёта; если null — расчёт: остаток_шт / продажи_в_день |

---

## Алерты

| Алерт | Условие | Источник |
|---|---|---|
| STOP реклама | `totalStock = 0 AND ad_spend > 0` | snapshot + daily |
| Скоро OOS | `stock_days < lead_time_days AND stock > 0` | snapshot + dim_sku |
| ДРР > Маржа | `drr > margin_pct AND margin_pct > 0` | daily + snapshot |
| Высокий CTR / низкий CR | `avg_ctr > медиана×1.5 AND avg_cr < медиана×0.5` | daily |
| Высокий CPO | `(ad_spend / orders) > avg_price × margin_pct` | daily + snapshot |
| Новинка без продаж | `novelty_status = 'Новинки' AND revenue < 10 000` | daily + snapshot |
| Можно масштабировать | `drr < margin_pct × 0.5 AND revenue > 0` | daily + snapshot |

---

## Маржинальность SKU (распределение)
- Источник: `fact_sku_snapshot.margin_pct`
- Корзины: <0%, 0–10%, 10–20%, 20–30%, ≥30%
- Считается по всем SKU в выбранном фильтре

## ABC
- Источник: `fact_abc.abc_class`
- Привязка: по sku_ms + период загрузки

## lead_time (логистическое плечо)
- Источник: `dim_sku.country` + `fact_china.lead_time_days`
- Логика: если страна = Китай → берём lead_time из fact_china; иначе дефолт 30 дней
- Используется в: алерт "Скоро OOS", Score компонент "Остаток", расчёт потерь

---

## Парсер отчёта по SKU (parseSkuReport.ts)

| Поле в БД | Колонка Excel | Примечание |
|---|---|---|
| sku_wb | col A | WB-артикул, ищется в dim_sku для маппинга в sku_ms |
| margin_pct | col Y «Маржа, %» | значение типа 17.3 → делим на 100 → 0.173 |
| margin_rub | отдельная колонка | операционная маржа ₽/unit (не %, несмотря на название) |
| fbo_wb | колонка остатков FBO | |
| fbs_pushkino | колонка остатков FBS Пушкино | |
| fbs_smolensk | колонка остатков FBS Смоленск | |
| stock_days | колонка дней остатка | из отчёта напрямую |
| price | колонка цены | |
| chmd_5d | колонка ЧМД за 5 дней | |

**Пропущенные строки:**
- Пустые / "Итого" / "SKU" в колонке артикула — служебные, не являются товарами
- WB-артикул не найден в dim_sku → попадает в `diag_skipped_skus`, показывается в UI после загрузки
