1. БАЗОВЫЕ ПЕРЕМЕННЫЕ (основа всей логики)
Все расчёты должны опираться на единый слой метрик:
Продажи и экономика
Revenue — выручка
COGS — себестоимость
AdSpend — расходы на рекламу
Profit = Revenue - COGS - AdSpend
Margin% = (Revenue - COGS) / Revenue
DRR = AdSpend / Revenue
CPO = AdSpend / Orders
Воронка
CTR
CR_cart
CR_order
Запасы
Stock
Sales_per_day
Days_of_stock = Stock / Sales_per_day
OOS_days_30d
Динамика
ΔRevenue
ΔProfit
ΔDRR
ΔCTR
ΔCR
2. ЛОГИКА АЛЕРТОВ (с приоритетами)
🚨 2.1. STOP РЕКЛАМА (критический)
Условие:
Stock = 0
AND AdSpend > 0
Сила алерта (score):
Loss = AdSpend за период
Приоритет:
🔴 если Loss > X
🟡 если Loss небольшой
🚨 2.2. OOS С ПОТЕРЕЙ ДЕНЕГ
Stock = 0
AND Sales_per_day > 0
Потеря:
LostRevenue = Sales_per_day × Days_OOS × Price
⚠️ 2.3. СКОРО OOS
Days_of_stock < Logistic_lead_time
Критично:
Days_of_stock < 0.5 × Logistic_lead_time
💸 2.4. ДРР > МАРЖИ (убыточность)
DRR > Margin%
Сила проблемы:
Overburn = DRR - Margin%
💸 2.5. ВЫСОКИЙ CPO
CPO > 0.3 × Price
или лучше:
CPO > Gross_profit_per_unit
🚀 2.6. ПОТЕНЦИАЛ РОСТА
CTR > Median_category_CTR
AND CR_order < Median_category_CR
👉 означает:
кликают хорошо
не покупают → проблема в карточке/цене
📈 2.7. МОЖНО МАСШТАБИРОВАТЬ
Margin% ≥ 20%
AND DRR < 0.5 × Margin%
AND Stock > 20 дней
⚠️ 2.8. НОВИНКА В РИСКЕ
IsNew = TRUE
AND Revenue < threshold
AND Days_since_launch > N
3. НОРМАЛИЗАЦИЯ ВСЕХ ФАКТОРОВ (0–1)
Чтобы сделать скоринг — всё приводим к шкале 0–1.
3.1. Маржа
Margin_score = 
0 если <10%
0.5 если 15%
1 если ≥25%
3.2. ДРР
DRR_score = 1 - (DRR / Margin%)
(если DRR > Margin → отрицательное значение)
3.3. Рост
Growth_score = sigmoid(ΔRevenue)
3.4. Запас
Stock_score =
0 если OOS
0.5 если = лог. плечо
1 если > 2× лог. плечо
3.5. Конверсия
CR_score = CR_order / Median_category_CR
(обрезать до 1)
4. ИТОГОВЫЙ СКОРИНГ SKU (0–100)
Формула:
SKU_score = 
30% × Margin_score +
20% × DRR_score +
15% × Growth_score +
15% × CR_score +
20% × Stock_score
Штрафы (сильнее весов):
if OOS → score = 0

if DRR > Margin → score × 0.5

if AdSpend > 0 AND Stock = 0 → score = 0
5. КЛАССЫ SKU
80–100 → 🔥 Масштабировать
60–80 → 🟢 Стабильный рост
40–60 → ⚠️ Требует оптимизации
20–40 → 🟠 Риск
0–20 → 🔴 Проблемный
6. ПРИОРИТЕТ (самое важное)
Отдельно от score:
PRIORITY SCORE (что делать сейчас)
Priority = Потери + Потенциал
Потери:
Loss_score =
LostRevenue (OOS)
+ Overburn × Revenue
+ AdSpend waste
Потенциал:
Potential =
Revenue × (1 - CR_score)
7. ГОТОВЫЕ РЕШЕНИЯ (автоматически)
Генерация действий:
1. Стоп реклама
IF Stock = 0 AND AdSpend > 0
→ Action: STOP ADS
2. Увеличить рекламу
IF DRR < 0.5 × Margin AND Stock OK
→ Action: SCALE ADS (+20–50%)
3. Улучшить карточку
IF CTR высокий AND CR низкий
→ Action: FIX CONTENT / PRICE
4. Срочный заказ
IF Days_of_stock < lead_time
→ Action: ORDER
5. Поднять цену
IF CR высокий AND DRR низкий
→ Action: INCREASE PRICE
8. ФОКУС ДНЯ (ключевая логика)
Формируем TOP-5 задач:
Sort SKU by Priority DESC
Take top 5
Вывод:
1. SKU A — стоп реклама (потеря 120k)
2. SKU B — заказать (потеря 300k)
3. SKU C — масштабировать (+200k)
9. ЧТО ВАЖНО ПРИ РЕАЛИЗАЦИИ
1. Все пороги — НЕ хардкод
Должны быть:
на уровне категории
или на уровне аккаунта
2. Все расчёты — прозрачные
При клике:
Почему алерт?
→ показать формулу
3. Скоринг ≠ приоритет
Это разные вещи:
Score = здоровье SKU
Priority = что делать сейчас
Итог
Ты получаешь систему уровня:
→ не просто “аналитика”
→ а операционная система бизнеса

Если хочешь следующий шаг:
разложу это в структуру базы данных (таблицы + поля)
или соберу логику под Power BI / SQL / backend (как реально считать)
разложи  это в структуру базы данных (таблицы + поля)
Делаем это как нормальную аналитическую модель уровня BI + операционная логика (чтобы тянуло и дашборд, и алерты, и автоматические действия).
Разобью на 4 слоя:

справочники (dimensions)
факты (facts)
агрегаты (mart / витрины)
вычисляемые таблицы (alerts / scoring / actions)
1. СПРАВОЧНИКИ (DIMENSIONS)
1.1. dim_sku
Главная сущность
sku_id (PK)
sku_code (WB/Ozon артикул)
name
brand_id
category_id
subject_id
manager_id
supplier_id
is_new (boolean)
launch_date
price
cost_price
status (active / archived)
created_at
1.2. dim_category
category_id (PK)
category_name
parent_category_id
1.3. dim_manager
manager_id (PK)
manager_name
team
1.4. dim_brand
brand_id (PK)
brand_name
1.5. dim_date
(календарь — обязательно для BI)
date (PK)
day
week
month
year
week_of_year
is_weekend
1.6. dim_seasonality
category_id
month
seasonality_coef
is_peak (boolean)
is_start (boolean)
1.7. dim_thresholds (ВАЖНО)
Настройки логики (не хардкод!)
entity_type (sku/category/global)
entity_id

min_margin
max_drr
critical_stock_days
warning_stock_days

cpo_limit_percent
min_revenue_new

updated_at
2. ФАКТЫ (RAW DATA)
2.1. fact_sales_daily
date
sku_id

revenue
orders
units_sold

cogs
profit (можно считать, но лучше хранить)
2.2. fact_ads_daily
date
sku_id

ad_spend
impressions
clicks
ctr
cpc
cpm

orders_from_ads
revenue_from_ads
2.3. fact_funnel_daily
(можно собрать из ads + аналитики)
date
sku_id

ctr
cr_cart
cr_order
2.4. fact_stock_daily
date
sku_id

stock_total
stock_fbo
stock_fbs

in_transit
in_production

oos_flag (boolean)
2.5. fact_price_history
date
sku_id

price_old
price_new
price_delta_percent
3. ВИТРИНЫ (AGGREGATES / MARTS)
3.1. mart_sku_daily
👉 основной слой, откуда всё считается
date
sku_id

-- деньги
revenue
profit
ad_spend

-- экономика
margin_percent
drr
cpo

-- воронка
ctr
cr_cart
cr_order

-- запасы
stock
sales_per_day
days_of_stock
oos_days_30d

-- динамика (vs prev period)
delta_revenue
delta_profit
delta_drr
delta_ctr
delta_cr
3.2. mart_sku_period
(7д / 14д / 30д)
period_type (7d/14d/30d)
date_to
sku_id

revenue
profit
ad_spend

margin_percent
drr
cpo

ctr
cr_cart
cr_order

sales_per_day
days_of_stock

delta_revenue
delta_profit
delta_drr
3.3. mart_category
date
category_id

revenue
profit
sku_count
share_percent

delta_revenue
4. ALERT ENGINE (ключевая часть)
4.1. alerts
alert_id (PK)
date
sku_id

alert_type
priority (high/medium/low)

value (например потеря)
description

is_active (boolean)
created_at
4.2. Типы алертов (alert_type)
STOP_ADS
OOS_LOSS
LOW_STOCK
CRITICAL_STOCK
DRR_OVER_MARGIN
HIGH_CPO
GROWTH_POTENTIAL
SCALE_OPPORTUNITY
NEW_PRODUCT_RISK
4.3. alert_metrics (расшифровка)
alert_id
metric_name
metric_value
👉 позволяет показать “почему алерт”
5. SCORING
5.1. sku_scoring
date
sku_id

margin_score
drr_score
growth_score
cr_score
stock_score

final_score (0–100)
grade (A/B/C/D)

calculated_at
5.2. sku_priority
(самое важное для бизнеса)
date
sku_id

loss_score
potential_score

priority_score

top_rank (позиция в системе)
6. ACTION ENGINE (рекомендации)
6.1. sku_actions
action_id
date
sku_id

action_type
reason

expected_impact
priority_score

status (new / in_progress / done)

created_at
6.2. Типы действий:
STOP_ADS
INCREASE_ADS
DECREASE_ADS
ORDER_STOCK
INCREASE_PRICE
DECREASE_PRICE
OPTIMIZE_CONTENT
7. ЗАКАЗ ТОВАРОВ
7.1. inventory_planning
date
sku_id

sales_7d
sales_14d
sales_30d

trend_14d
seasonality_coef

lead_time_days

forecast_demand
safety_stock

required_stock
current_stock

recommended_order
manager_order

delta_order
7.2. inventory_finance
sku_id

unit_cost
order_cost
gmroi
turnover
abc_class
xyz_class
8. ЛОГИ И КОММЕНТАРИИ
8.1. sku_notes
note_id
sku_id
user_id

comment
created_at
8.2. action_logs
log_id
action_id

old_value
new_value

changed_by
changed_at
9. СВЯЗИ (КАК ЭТО РАБОТАЕТ)
Логика потока:
RAW DATA (fact_*)
    ↓
mart_sku_daily
    ↓
alerts + scoring + priority
    ↓
sku_actions
    ↓
дашборд
10. КРИТИЧЕСКИЕ РЕШЕНИЯ (архитектура)
10.1. Grain (зерно данных)
все факты → sku_id + date
без этого всё развалится
10.2. Где считать логику
Лучший вариант:
SQL (ClickHouse / BigQuery / Postgres)
dbt слой
10.3. Что не считать на лету
Обязательно предрасчитать:
scoring
alerts
priority
👉 иначе дашборд будет тормозить
11. ЧТО В ИТОГЕ ПОЛУЧАЕШЬ
Эта структура даёт:
✔ масштабируемость
✔ прозрачность логики
✔ быстрые дашборды
✔ возможность автоматизации