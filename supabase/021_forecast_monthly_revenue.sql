-- ============================================================
-- 021_forecast_monthly_revenue.sql
-- Месячная агрегация fact_sku_daily для ForecastChart (8 месяцев = 4 назад + 4 вперёд).
-- Раньше график строился по неделям и тянул только 30 дней — теперь 4 прошлых
-- месяца требуют ~120 дней истории. Через PostgREST это 500К+ строк, поэтому
-- агрегируем в Postgres.
-- ============================================================

CREATE OR REPLACE FUNCTION forecast_monthly_revenue(
  p_from date,
  p_to   date
)
RETURNS TABLE (
  ym         text,        -- формат 'YYYY-MM'
  revenue    numeric,
  sales_qty  numeric
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    to_char(metric_date, 'YYYY-MM') AS ym,
    COALESCE(SUM(revenue),   0)::numeric AS revenue,
    COALESCE(SUM(sales_qty), 0)::numeric AS sales_qty
  FROM fact_sku_daily
  WHERE metric_date BETWEEN p_from AND p_to
  GROUP BY to_char(metric_date, 'YYYY-MM')
$$;

GRANT EXECUTE ON FUNCTION forecast_monthly_revenue(date, date) TO anon, authenticated, service_role;
