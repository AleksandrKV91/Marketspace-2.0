-- ============================================================
-- 017_orders_daily_agg_smart_window.sql
-- Замена функции orders_daily_agg (016) — smart WHERE.
--
-- ПРОБЛЕМА: при month-фильтре «выручка за апрель» (например):
--   p_period_from = 2025-04-01
--   p_prev_from   = 2024-04-01
--   p_max_date    = 2026-05-08
-- Старый WHERE: metric_date >= LEAST(p_max_date - 89d, p_prev_from)
--   → metric_date >= 2024-04-01 → читает 2 ГОДА данных (~1.5М строк)
--   → "canceling statement due to statement timeout"
--
-- РЕШЕНИЕ: WHERE с OR — читаем ТОЛЬКО три нужных окна:
--   • последние 90 дней (для velocity, sigma, oos_days, data_days)
--   • период [p_period_from..p_period_to] (для period_revenue)
--   • период [p_prev_from..p_prev_to]     (для prev_period_revenue)
-- Итого ~120-180 дней вместо 2 лет → ~10× меньше строк.
--
-- ВЫПОЛНИТЬ В Supabase Studio → SQL Editor.
-- ============================================================

CREATE OR REPLACE FUNCTION orders_daily_agg(
  p_max_date    date,
  p_period_from date,
  p_period_to   date,
  p_prev_from   date,
  p_prev_to     date
)
RETURNS TABLE (
  sku_ms              text,
  sales_qty_7d        numeric,
  sales_qty_14d       numeric,
  sales_qty_31d       numeric,
  sales_qty_90d       numeric,
  sigma_31d           numeric,
  oos_days_31         int,
  non_zero_days_31    int,
  data_days_total     int,
  period_revenue      numeric,
  prev_period_revenue numeric
)
LANGUAGE sql
STABLE
AS $$
  WITH d AS (
    SELECT
      sku_ms,
      metric_date,
      COALESCE(sales_qty, 0)::numeric AS qty,
      COALESCE(revenue, 0)::numeric   AS rev
    FROM fact_sku_daily
    WHERE sku_ms IS NOT NULL
      AND (
        -- Окно 1: последние 90 дней — для velocity/sigma/oos/data_days
        metric_date >= p_max_date - INTERVAL '89 days'
        -- Окно 2: текущий period_revenue (когда month-фильтр выбран,
        -- может быть месяц другого года — далеко от p_max_date)
        OR (metric_date >= p_period_from AND metric_date <= p_period_to)
        -- Окно 3: предыдущий период (для дельты выручки)
        OR (metric_date >= p_prev_from   AND metric_date <= p_prev_to)
      )
      AND metric_date <= GREATEST(p_max_date, p_period_to)
  )
  SELECT
    sku_ms,
    COALESCE(SUM(qty) FILTER (WHERE metric_date > p_max_date - INTERVAL '7 days'),  0) AS sales_qty_7d,
    COALESCE(SUM(qty) FILTER (WHERE metric_date > p_max_date - INTERVAL '14 days'), 0) AS sales_qty_14d,
    COALESCE(SUM(qty) FILTER (WHERE metric_date > p_max_date - INTERVAL '31 days'), 0) AS sales_qty_31d,
    COALESCE(SUM(qty) FILTER (WHERE metric_date > p_max_date - INTERVAL '90 days'), 0) AS sales_qty_90d,
    COALESCE(STDDEV_SAMP(qty) FILTER (WHERE metric_date > p_max_date - INTERVAL '31 days'), 0) AS sigma_31d,
    COALESCE(COUNT(*) FILTER (WHERE metric_date > p_max_date - INTERVAL '31 days' AND qty = 0), 0)::int AS oos_days_31,
    COALESCE(COUNT(*) FILTER (WHERE metric_date > p_max_date - INTERVAL '31 days' AND qty > 0), 0)::int AS non_zero_days_31,
    COUNT(DISTINCT metric_date) FILTER (WHERE metric_date >= p_max_date - INTERVAL '89 days')::int AS data_days_total,
    COALESCE(SUM(rev) FILTER (WHERE metric_date >= p_period_from AND metric_date <= p_period_to), 0) AS period_revenue,
    COALESCE(SUM(rev) FILTER (WHERE metric_date >= p_prev_from   AND metric_date <= p_prev_to),   0) AS prev_period_revenue
  FROM d
  GROUP BY sku_ms
$$;

GRANT EXECUTE ON FUNCTION orders_daily_agg(date, date, date, date, date) TO anon, authenticated, service_role;
