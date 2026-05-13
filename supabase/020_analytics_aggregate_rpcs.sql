-- ============================================================
-- 020_analytics_aggregate_rpcs.sql
-- Серверная агрегация для дашборда «Аналитика по SKU» (>14 дней падал по timeout'у).
--
-- ПРОБЛЕМА:
--   /api/dashboard/analytics через fetchAll тянул ВСЕ строки fact_sku_daily за период
--   (2 диапазона × 30+ дней × тысячи SKU = 300К+ строк). На периодах >14 дней
--   функция в Vercel ловила 60-секундный timeout.
--
-- РЕШЕНИЕ:
--   Две RPC, агрегирующие в Postgres. Возвращают N_skus + N_days строк вместо N×D.
--     • analytics_period_agg — по каждому SKU суммирует выручку/расход/чмд/маржу
--       за текущий и предыдущий период.
--     • analytics_daily_agg — по каждой дате (текущей и пред.) суммирует те же метрики
--       + margin_sum = Σ revenue × margin_pct (из последнего fact_sku_period снапшота).
--
-- ВЫПОЛНИТЬ В Supabase Studio → SQL Editor.
-- ============================================================

CREATE OR REPLACE FUNCTION analytics_period_agg(
  p_from      date,
  p_to        date,
  p_prev_from date,
  p_prev_to   date
)
RETURNS TABLE (
  sku_ms          text,
  curr_revenue    numeric,
  curr_ad_spend   numeric,
  curr_chmd_rub   numeric,
  curr_margin_rub numeric,
  prev_revenue    numeric
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    sku_ms,
    COALESCE(SUM(revenue)    FILTER (WHERE metric_date BETWEEN p_from AND p_to), 0)::numeric AS curr_revenue,
    COALESCE(SUM(ad_spend)   FILTER (WHERE metric_date BETWEEN p_from AND p_to), 0)::numeric AS curr_ad_spend,
    COALESCE(SUM(chmd_rub)   FILTER (WHERE metric_date BETWEEN p_from AND p_to), 0)::numeric AS curr_chmd_rub,
    COALESCE(SUM(margin_rub) FILTER (WHERE metric_date BETWEEN p_from AND p_to), 0)::numeric AS curr_margin_rub,
    COALESCE(SUM(revenue)    FILTER (WHERE metric_date BETWEEN p_prev_from AND p_prev_to), 0)::numeric AS prev_revenue
  FROM fact_sku_daily
  WHERE sku_ms IS NOT NULL
    AND (
      (metric_date BETWEEN p_from      AND p_to)
      OR (metric_date BETWEEN p_prev_from AND p_prev_to)
    )
  GROUP BY sku_ms
$$;

CREATE OR REPLACE FUNCTION analytics_daily_agg(
  p_from         date,
  p_to           date,
  p_prev_from    date,
  p_prev_to      date,
  p_snap_period  date  -- последний period_end из fact_sku_period — для margin_pct
)
RETURNS TABLE (
  metric_date date,
  is_current  boolean,
  revenue     numeric,
  ad_spend    numeric,
  chmd_rub    numeric,
  margin_sum  numeric  -- Σ revenue × margin_pct
)
LANGUAGE sql
STABLE
AS $$
  WITH snap AS (
    SELECT sku_ms, COALESCE(period_marginality_wgt, 0)::numeric AS m_pct
    FROM fact_sku_period
    WHERE period_end = p_snap_period
  ),
  d AS (
    SELECT
      f.metric_date,
      (f.metric_date BETWEEN p_from AND p_to) AS is_curr,
      COALESCE(f.revenue, 0)::numeric  AS rev,
      COALESCE(f.ad_spend, 0)::numeric AS spend,
      COALESCE(f.chmd_rub, 0)::numeric AS chmd,
      COALESCE(f.revenue, 0)::numeric * COALESCE(s.m_pct, 0) AS margin_sum
    FROM fact_sku_daily f
    LEFT JOIN snap s ON s.sku_ms = f.sku_ms
    WHERE (f.metric_date BETWEEN p_from      AND p_to)
       OR (f.metric_date BETWEEN p_prev_from AND p_prev_to)
  )
  SELECT
    metric_date,
    is_curr,
    SUM(rev),
    SUM(spend),
    SUM(chmd),
    SUM(margin_sum)
  FROM d
  GROUP BY metric_date, is_curr
$$;

GRANT EXECUTE ON FUNCTION analytics_period_agg(date, date, date, date) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION analytics_daily_agg(date, date, date, date, date) TO anon, authenticated, service_role;
