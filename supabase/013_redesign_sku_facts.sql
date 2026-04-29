-- ──────────────────────────────────────────────────────────────────
-- 013_redesign_sku_facts.sql
-- Полная переработка таблиц для «Отчёта по SKU с расчётами».
-- Все показатели приходят уже посчитанными из Excel — никаких
-- материализованных агрегатов на стороне БД.
-- ──────────────────────────────────────────────────────────────────

-- 1. Удаляем deprecated деривативы
DROP TABLE IF EXISTS daily_agg_sku CASCADE;
DROP TABLE IF EXISTS fact_daily_agg CASCADE;

DROP FUNCTION IF EXISTS refresh_daily_agg_sku_fn() CASCADE;
DROP FUNCTION IF EXISTS refresh_daily_agg_v2_fn(date, date) CASCADE;
DROP FUNCTION IF EXISTS refresh_daily_agg_fn(date, date) CASCADE;
DROP FUNCTION IF EXISTS get_sku_period_agg(date, date) CASCADE;

-- 2. Wipe старых исторических данных fact_sku_daily / fact_price_changes
TRUNCATE TABLE fact_sku_daily CASCADE;
TRUNCATE TABLE fact_price_changes CASCADE;

-- 3. Переписываем fact_sku_daily — только дневные метрики
ALTER TABLE fact_sku_daily DROP COLUMN IF EXISTS spp;
ALTER TABLE fact_sku_daily DROP COLUMN IF EXISTS spend_plan;
ALTER TABLE fact_sku_daily DROP COLUMN IF EXISTS drr_plan;

ALTER TABLE fact_sku_daily ADD COLUMN IF NOT EXISTS sales_qty numeric;
ALTER TABLE fact_sku_daily ADD COLUMN IF NOT EXISTS cost_sum numeric;
ALTER TABLE fact_sku_daily ADD COLUMN IF NOT EXISTS margin_rub numeric;
ALTER TABLE fact_sku_daily ADD COLUMN IF NOT EXISTS chmd_rub numeric;
ALTER TABLE fact_sku_daily ADD COLUMN IF NOT EXISTS marginality numeric;
ALTER TABLE fact_sku_daily ADD COLUMN IF NOT EXISTS chmd_pct numeric;
ALTER TABLE fact_sku_daily ADD COLUMN IF NOT EXISTS price numeric;

-- 4. Удаляем старый fact_sku_snapshot и создаём fact_sku_period
DROP TABLE IF EXISTS fact_sku_snapshot CASCADE;

CREATE TABLE IF NOT EXISTS fact_sku_period (
  sku_ms          text NOT NULL REFERENCES dim_sku(sku_ms) ON DELETE CASCADE,
  period_start    date NOT NULL,
  period_end      date NOT NULL,
  upload_id       uuid REFERENCES uploads(id),

  -- идентификация (снапшот метаданных на момент отчёта)
  sku_wb          bigint,
  category        text,
  subject_wb      text,
  product_name    text,
  brand           text,
  manager         text,
  novelty_status  text,
  season          text,
  shelf_date      date,

  -- остатки (Q-W)
  fbo_wb              int,
  fbs_pushkino        int,
  fbs_smolensk        int,
  kits_qty            int,
  stock_days          numeric,
  days_until_arrival  numeric,
  oos_buffer_days     numeric,

  -- цена и себестоимость единицы (BO, DC)
  price        numeric,
  cost_unit    numeric,

  -- поставка (CH, CI)
  plan_supply_date  date,
  plan_supply_qty   numeric,

  -- план рекламы (AB, AC)
  plan_ad_spend  numeric,
  plan_drr       numeric,

  -- агрегаты периода (Total из строки 2 шапки)
  period_revenue              numeric,
  period_ad_spend             numeric,
  period_sales_qty            numeric,
  period_cost_sum             numeric,
  period_margin_rub           numeric,
  period_chmd_rub             numeric,
  period_drr_total_wgt        numeric,
  period_drr_ad_wgt           numeric,
  period_ctr_wgt              numeric,
  period_cr_cart_wgt          numeric,
  period_cr_order_wgt         numeric,
  period_cpm_wgt              numeric,
  period_cpc_wgt              numeric,
  period_ad_order_share_wgt   numeric,
  period_marginality_wgt      numeric,
  period_chmd_pct_wgt         numeric,

  created_at  timestamptz DEFAULT now(),

  PRIMARY KEY (sku_ms, period_start, period_end)
);

CREATE INDEX IF NOT EXISTS idx_fact_sku_period_end
  ON fact_sku_period(period_end DESC);
CREATE INDEX IF NOT EXISTS idx_fact_sku_period_upload
  ON fact_sku_period(upload_id);
CREATE INDEX IF NOT EXISTS idx_fact_sku_period_sku_wb
  ON fact_sku_period(sku_wb);

-- 5. Расширяем fact_price_changes
ALTER TABLE fact_price_changes ADD COLUMN IF NOT EXISTS price_before numeric;
ALTER TABLE fact_price_changes ADD COLUMN IF NOT EXISTS delta_pct numeric;
ALTER TABLE fact_price_changes ADD COLUMN IF NOT EXISTS ctr_change numeric;
ALTER TABLE fact_price_changes ADD COLUMN IF NOT EXISTS cr_change numeric;
