-- ============================================================
-- Marketspace 2.0 — начальная схема БД
-- Запустить в Supabase SQL Editor (один раз)
-- ============================================================

-- ─────────────────────────────────────────
-- 1. uploads — история загрузок
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS uploads (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_type    text NOT NULL,  -- 'sku_report' | 'stock' | 'abc' | 'china' | 'catalog'
  filename     text,
  uploaded_at  timestamptz NOT NULL DEFAULT now(),
  period_start date,
  period_end   date,
  rows_count   int,
  status       text NOT NULL DEFAULT 'ok',  -- 'ok' | 'error'
  error_msg    text
);

-- ─────────────────────────────────────────
-- 2. dim_sku — справочник SKU (из Свода)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dim_sku (
  sku_ms         text PRIMARY KEY,
  sku_wb         bigint,
  sku_warehouse  text,
  sku_china      text,
  name           text,
  brand          text,
  supplier       text,
  country        text,
  subject_wb     text,
  category_wb    text,
  nds_pct        numeric,
  market_share   numeric,
  niche_appeal   numeric,
  availability   text,
  buyout_pct     numeric,
  avg_rating     numeric,
  seasonality    text,
  season_start   text,
  season_length  int,
  top_month      text,
  month_jan      numeric,
  month_feb      numeric,
  month_mar      numeric,
  month_apr      numeric,
  month_may      numeric,
  month_jun      numeric,
  month_jul      numeric,
  month_aug      numeric,
  month_sep      numeric,
  month_oct      numeric,
  month_nov      numeric,
  month_dec      numeric,
  top_phrase     text,
  updated_at     timestamptz DEFAULT now()
);

-- ─────────────────────────────────────────
-- 3. fact_sku_daily — дневные метрики из Отчёта по SKU
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fact_sku_daily (
  sku_ms          text NOT NULL REFERENCES dim_sku(sku_ms) ON DELETE CASCADE,
  metric_date     date NOT NULL,
  upload_id       uuid REFERENCES uploads(id),
  -- реклама
  ad_spend        numeric,
  revenue         numeric,
  drr_total       numeric,
  drr_ad          numeric,
  ctr             numeric,
  cr_cart         numeric,
  cr_order        numeric,
  cpm             numeric,
  cpc             numeric,
  ad_order_share  numeric,
  spp             numeric,
  -- планирование
  spend_plan      numeric,
  drr_plan        numeric,
  PRIMARY KEY (sku_ms, metric_date)
);

-- ─────────────────────────────────────────
-- 4. fact_sku_snapshot — снапшот на дату загрузки
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fact_sku_snapshot (
  sku_ms           text NOT NULL REFERENCES dim_sku(sku_ms) ON DELETE CASCADE,
  upload_id        uuid NOT NULL REFERENCES uploads(id),
  snap_date        date,
  -- остатки
  fbo_wb           int,
  fbs_pushkino     int,
  fbs_smolensk     int,
  kits_stock       int,
  stock_days       numeric,
  days_to_arrival  numeric,
  ots_reserve_days numeric,
  -- финансы за 5 дней
  margin_rub       numeric,
  chmd_5d          numeric,
  -- планирование
  spend_plan       numeric,
  drr_plan         numeric,
  -- поставка
  supply_date      date,
  supply_qty       int,
  -- цена
  price            numeric,
  -- характеристики
  shelf_date       date,
  manager          text,
  novelty_status   text,
  PRIMARY KEY (sku_ms, upload_id)
);

-- ─────────────────────────────────────────
-- 5. fact_stock_daily — продажи по дням из Таблицы остатков
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fact_stock_daily (
  sku_wb     bigint NOT NULL,
  sku_ms     text,
  sale_date  date NOT NULL,
  sales_qty  numeric,
  upload_id  uuid REFERENCES uploads(id),
  PRIMARY KEY (sku_wb, sale_date)
);

-- ─────────────────────────────────────────
-- 6. fact_stock_snapshot — снапшот остатков из Таблицы остатков
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fact_stock_snapshot (
  sku_wb        bigint NOT NULL,
  upload_id     uuid NOT NULL REFERENCES uploads(id),
  snap_date     date,
  fbo_wb        int,
  fbs_pushkino  int,
  fbs_smolensk  int,
  total_stock   int,
  price         numeric,
  margin_pct    numeric,
  supply_qty    int,
  supply_date   date,
  PRIMARY KEY (sku_wb, upload_id)
);

-- ─────────────────────────────────────────
-- 7. fact_price_changes — изменения цены
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fact_price_changes (
  sku_wb     bigint NOT NULL,
  sku_ms     text,
  price_date date NOT NULL,
  price      numeric,
  upload_id  uuid REFERENCES uploads(id),
  PRIMARY KEY (sku_wb, price_date)
);

-- ─────────────────────────────────────────
-- 8. fact_abc — АВС анализ
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fact_abc (
  sku_ms          text NOT NULL REFERENCES dim_sku(sku_ms) ON DELETE CASCADE,
  upload_id       uuid NOT NULL REFERENCES uploads(id),
  period_month    date,
  qty_stock_rub   numeric,
  cost            numeric,
  revenue         numeric,
  chmd            numeric,
  ad_spend        numeric,
  storage         numeric,
  transport       numeric,
  chmd_clean      numeric,
  profitability   numeric,
  revenue_margin  numeric,
  tz              numeric,
  turnover_days   numeric,
  chmd_share      numeric,
  abc_class       text,
  abc_class2      text,
  novelty_flag    boolean,
  stock_status    text,
  PRIMARY KEY (sku_ms, upload_id)
);

-- ─────────────────────────────────────────
-- 9. fact_china_supply — Потребность Китай
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fact_china_supply (
  sku_ms           text NOT NULL REFERENCES dim_sku(sku_ms) ON DELETE CASCADE,
  upload_id        uuid NOT NULL REFERENCES uploads(id),
  plan_mar         int,
  plan_apr         int,
  plan_may         int,
  plan_jun         int,
  plan_jul         int,
  plan_aug         int,
  reserve_15d      int,
  buyout_pct_wb    numeric,
  marketing_pct    numeric,
  cost_plan        numeric,
  cost_change_pct  numeric,
  avg_price        numeric,
  in_transit       int,
  in_production    int,
  nearest_date     date,
  order_qty        int,
  order_sum_cost   numeric,
  rating           numeric,
  PRIMARY KEY (sku_ms, upload_id)
);

-- ─────────────────────────────────────────
-- 10. sku_notes — заметки
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sku_notes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku_ms      text,
  note        text,
  user_name   text,
  updated_at  timestamptz DEFAULT now()
);

-- ─────────────────────────────────────────
-- Индексы
-- ─────────────────────────────────────────
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

CREATE INDEX IF NOT EXISTS idx_dim_sku_wb
  ON dim_sku(sku_wb);
