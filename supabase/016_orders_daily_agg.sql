-- ============================================================
-- 016_orders_daily_agg.sql
-- Серверная агрегация для /api/dashboard/orders
--
-- ПРОБЛЕМА: orders/route.ts тянул ~180K строк (90 дней × ~2K SKU)
-- через fetchAll → 180+ HTTP-запросов к Supabase REST → 30-60+ секунд →
-- "TypeError: Failed to fetch" в браузере.
--
-- РЕШЕНИЕ: одна RPC которая возвращает ~2K строк (одна на SKU)
-- со всеми нужными агрегатами за все окна (7д/14д/31д/90д + period + prev).
-- Один HTTP-запрос вместо 180. Постгрес считает GROUP BY за <1 секунду.
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
      AND metric_date >= LEAST(p_max_date - INTERVAL '89 days', p_prev_from::timestamp)::date
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
    COUNT(DISTINCT metric_date)::int AS data_days_total,
    COALESCE(SUM(rev) FILTER (WHERE metric_date >= p_period_from AND metric_date <= p_period_to), 0) AS period_revenue,
    COALESCE(SUM(rev) FILTER (WHERE metric_date >= p_prev_from   AND metric_date <= p_prev_to),   0) AS prev_period_revenue
  FROM d
  GROUP BY sku_ms
$$;

GRANT EXECUTE ON FUNCTION orders_daily_agg(date, date, date, date, date) TO anon, authenticated, service_role;

-- Индекс который ускорит фильтрацию (если ещё нет)
CREATE INDEX IF NOT EXISTS idx_fact_sku_daily_date_sku
  ON fact_sku_daily(metric_date DESC, sku_ms);
