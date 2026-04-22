-- ══════════════════════════════════════════════════════════════════════════════
-- 006_daily_agg_redesign.sql
-- Выполнить вручную в Supabase SQL Editor
-- ══════════════════════════════════════════════════════════════════════════════

-- 1. Пересоздать fact_daily_agg (агрегат за день, все SKU)
-- Старая таблица имела PK (metric_date, category_wb, subject_wb) — убираем разбивку по категориям.
-- Теперь PK = metric_date (одна строка на дату).

DROP TABLE IF EXISTS fact_daily_agg;

CREATE TABLE fact_daily_agg (
  metric_date        date    PRIMARY KEY,
  revenue_sum        numeric NOT NULL DEFAULT 0,   -- Σ выручка
  ad_spend_sum       numeric NOT NULL DEFAULT 0,   -- Σ затраты рекламы
  stock_sum_rub      numeric NOT NULL DEFAULT 0,   -- Σ (fbo+fbs+kits)×price [снапшот]
  drr_plan           numeric,                      -- СУММПРОИЗВ(drr_plan; rev)/Σrev
  drr_total          numeric,                      -- СУММПРОИЗВ(drr_total; rev)/Σrev
  drr_ad             numeric,                      -- СУММПРОИЗВ(drr_ad; rev)/Σrev
  ctr_avg            numeric,                      -- СУММПРОИЗВ(ctr; rev)/Σrev
  cr_cart_avg        numeric,                      -- СУММПРОИЗВ(cr_cart; rev)/Σrev
  cr_order_avg       numeric,                      -- СУММПРОИЗВ(cr_order; rev)/Σrev
  price_avg          numeric,                      -- Σ price / COUNT(sku) — простое среднее
  ad_order_share     numeric,                      -- СУММПРОИЗВ(ad_order_share; rev)/Σrev
  sales_qty          numeric NOT NULL DEFAULT 0,   -- Σ ROUND(revenue/price)
  cost_sum           numeric NOT NULL DEFAULT 0,   -- Σ revenue×(1−margin_pct)
  cost_per_unit_avg  numeric,                      -- AVG(cost_per_unit) по SKU
  margin_sum         numeric NOT NULL DEFAULT 0,   -- Σ revenue×margin_pct
  chmd_sum           numeric NOT NULL DEFAULT 0,   -- margin_sum − ad_spend_sum
  marginality        numeric,                      -- margin_sum / revenue_sum
  chmd_pct           numeric,                      -- chmd_sum / revenue_sum
  sku_count          int     NOT NULL DEFAULT 0    -- COUNT(DISTINCT sku_ms)
);

CREATE INDEX idx_daily_agg_date ON fact_daily_agg(metric_date DESC);


-- 2. Создать daily_agg_sku (агрегат за день, по артикулу)

CREATE TABLE IF NOT EXISTS daily_agg_sku (
  metric_date    date    NOT NULL,
  sku_ms         text    NOT NULL,
  sku_wb         bigint,
  stock_sum_rub  numeric NOT NULL DEFAULT 0,   -- (fbo+fbs+kits)×price
  price          numeric,                      -- цена из fact_sku_daily на эту дату
  price_change   numeric,                      -- цена после изменения (из fact_price_changes) или NULL
  sales_qty      numeric NOT NULL DEFAULT 0,   -- ROUND(revenue/price)
  cost_sum       numeric NOT NULL DEFAULT 0,   -- revenue×(1−margin_pct)
  cost_per_unit  numeric,                      -- cost_sum/sales_qty
  margin_sum     numeric NOT NULL DEFAULT 0,   -- revenue − cost_sum
  chmd           numeric NOT NULL DEFAULT 0,   -- margin_sum − ad_spend
  marginality    numeric,                      -- margin_sum / revenue
  chmd_pct       numeric,                      -- chmd / revenue
  PRIMARY KEY (metric_date, sku_ms)
);

CREATE INDEX idx_daily_agg_sku_date ON daily_agg_sku(metric_date DESC);
CREATE INDEX idx_daily_agg_sku_sku  ON daily_agg_sku(sku_ms, metric_date DESC);
