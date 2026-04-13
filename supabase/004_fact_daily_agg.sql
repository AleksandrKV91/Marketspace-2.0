-- Материализованная таблица агрегатов по (metric_date, category_wb, subject_wb)
-- Обновляется после каждой загрузки SKU-отчёта через /api/admin/refresh-daily-agg

CREATE TABLE IF NOT EXISTS fact_daily_agg (
  metric_date      date        NOT NULL,
  category_wb      text        NOT NULL DEFAULT '',
  subject_wb       text        NOT NULL DEFAULT '',
  -- Суммы
  revenue          numeric     NOT NULL DEFAULT 0,
  ad_spend         numeric     NOT NULL DEFAULT 0,
  chmd             numeric     NOT NULL DEFAULT 0,   -- revenue × margin_pct_wgt − ad_spend
  -- Средневзвешенные (по выручке)
  margin_pct_wgt   numeric     NOT NULL DEFAULT 0,   -- Σ(margin_pct × revenue) / Σrevenue
  price_wgt        numeric     NOT NULL DEFAULT 0,   -- Σ(price × revenue) / Σrevenue
  -- Средние по строкам с ненулевыми значениями
  drr              numeric     NOT NULL DEFAULT 0,   -- ad_spend / revenue
  ctr_avg          numeric,
  cr_cart_avg      numeric,
  cr_order_avg     numeric,
  cpm_avg          numeric,
  cpc_avg          numeric,
  ad_order_share   numeric,
  cpo              numeric,                          -- ad_spend / (revenue / price_wgt)
  sku_count        int         NOT NULL DEFAULT 0,
  PRIMARY KEY (metric_date, category_wb, subject_wb)
);

CREATE INDEX IF NOT EXISTS idx_daily_agg_date         ON fact_daily_agg(metric_date DESC);
CREATE INDEX IF NOT EXISTS idx_daily_agg_cat_date     ON fact_daily_agg(category_wb, metric_date DESC);
CREATE INDEX IF NOT EXISTS idx_daily_agg_subj_date    ON fact_daily_agg(subject_wb, metric_date DESC);
