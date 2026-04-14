-- Агрегация revenue и ad_spend по SKU за период
-- Возвращает одну строку на SKU — намного быстрее чем fetchAll построчно
CREATE OR REPLACE FUNCTION get_sku_period_agg(p_from date, p_to date)
RETURNS TABLE(sku_ms text, revenue numeric, ad_spend numeric)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT
    sku_ms,
    SUM(COALESCE(revenue, 0))   AS revenue,
    SUM(COALESCE(ad_spend, 0))  AS ad_spend
  FROM fact_sku_daily
  WHERE metric_date BETWEEN p_from AND p_to
  GROUP BY sku_ms;
$$;
