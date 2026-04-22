-- ============================================================
-- 007: daily_agg_sku — подённые расчёты на уровне артикула
-- Заполняется из TypeScript (refresh-daily-agg-sku endpoint)
-- Порядок: от начала периода, последовательно по дням.
-- ============================================================

CREATE TABLE IF NOT EXISTS daily_agg_sku (
  metric_date   date    NOT NULL,
  sku_wb        bigint  NOT NULL,
  sku_ms        text    REFERENCES dim_sku(sku_ms) ON DELETE CASCADE,
  -- остатки
  stock_qty     numeric,  -- шт; день 0 = сумма складов; день N = stock_{N-1} - sales_qty_{N-1}
  stock_rub     numeric,  -- руб = stock_qty * cost_unit
  -- цена (перенос с учётом дельты из отчёта)
  price         numeric,  -- день 0 = из fact_price_changes; день N = price_{N-1}*(1+delta/100)
  -- продажи
  sales_qty     numeric,  -- = revenue / price
  -- себестоимость
  cost_sum      numeric,  -- = revenue * (1 - margin_pct/100)
  cost_unit     numeric,  -- = cost_sum / sales_qty
  -- маржа
  margin_rub    numeric,  -- = revenue - cost_sum
  -- ЧМД
  chmd_rub      numeric,  -- = margin_rub - ad_spend
  -- проценты (доли, не %)
  marginality   numeric,  -- = margin_rub / revenue
  chmd_pct      numeric,  -- = chmd_rub / revenue
  PRIMARY KEY (metric_date, sku_wb)
);

CREATE INDEX IF NOT EXISTS idx_daily_agg_sku_date ON daily_agg_sku(metric_date DESC);
CREATE INDEX IF NOT EXISTS idx_daily_agg_sku_ms   ON daily_agg_sku(sku_ms);
CREATE INDEX IF NOT EXISTS idx_daily_agg_sku_wb   ON daily_agg_sku(sku_wb);
