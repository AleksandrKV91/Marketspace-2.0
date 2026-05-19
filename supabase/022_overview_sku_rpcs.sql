-- ============================================================
-- 022_overview_sku_rpcs.sql
-- Серверная агрегация для дашбордов «Свод» и «Аналитика по SKU».
--
-- ПРОБЛЕМА:
--   /api/dashboard/overview и /api/dashboard/sku-table тянули
--   fact_sku_daily построчно через fetchAll. На периодах 30+ дней
--   при N_SKU × N_DAYS = сотни тысяч строк это упиралось в
--   maxDuration=60 Vercel — клиент ловил «TypeError: Failed to fetch».
--
-- РЕШЕНИЕ:
--   Две RPC, считающие агрегаты в Postgres:
--     • sku_period_full_agg — per-SKU суммы и средние за текущий и
--       предыдущий периоды (revenue, ad_spend, chmd, margin, ctr, cr).
--     • sku_daily_full_agg — per-date суммы и средние за текущий
--       период (для трендового графика «Свода»).
--
-- ВЫПОЛНИТЬ В Supabase Studio → SQL Editor.
-- ============================================================

-- ── 1. Per-SKU агрегаты за период (curr + prev) ─────────────────────────────
CREATE OR REPLACE FUNCTION sku_period_full_agg(
  p_from      date,
  p_to        date,
  p_prev_from date,
  p_prev_to   date
)
RETURNS TABLE (
  sku_ms             text,
  curr_revenue       numeric,
  curr_ad_spend      numeric,
  curr_chmd_rub      numeric,
  curr_margin_rub    numeric,
  curr_ctr_avg       numeric,
  curr_cr_cart_avg   numeric,
  curr_cr_order_avg  numeric,
  curr_cpm_avg       numeric,
  curr_cpc_avg       numeric,
  curr_days          int,
  prev_revenue       numeric,
  prev_ad_spend      numeric,
  prev_chmd_rub      numeric,
  prev_margin_rub    numeric
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
    AVG(ctr)      FILTER (WHERE metric_date BETWEEN p_from AND p_to AND ctr      IS NOT NULL)::numeric AS curr_ctr_avg,
    AVG(cr_cart)  FILTER (WHERE metric_date BETWEEN p_from AND p_to AND cr_cart  IS NOT NULL)::numeric AS curr_cr_cart_avg,
    AVG(cr_order) FILTER (WHERE metric_date BETWEEN p_from AND p_to AND cr_order IS NOT NULL)::numeric AS curr_cr_order_avg,
    AVG(cpm)      FILTER (WHERE metric_date BETWEEN p_from AND p_to AND cpm      IS NOT NULL)::numeric AS curr_cpm_avg,
    AVG(cpc)      FILTER (WHERE metric_date BETWEEN p_from AND p_to AND cpc      IS NOT NULL)::numeric AS curr_cpc_avg,
    COUNT(*) FILTER (WHERE metric_date BETWEEN p_from AND p_to)::int AS curr_days,
    COALESCE(SUM(revenue)    FILTER (WHERE metric_date BETWEEN p_prev_from AND p_prev_to), 0)::numeric AS prev_revenue,
    COALESCE(SUM(ad_spend)   FILTER (WHERE metric_date BETWEEN p_prev_from AND p_prev_to), 0)::numeric AS prev_ad_spend,
    COALESCE(SUM(chmd_rub)   FILTER (WHERE metric_date BETWEEN p_prev_from AND p_prev_to), 0)::numeric AS prev_chmd_rub,
    COALESCE(SUM(margin_rub) FILTER (WHERE metric_date BETWEEN p_prev_from AND p_prev_to), 0)::numeric AS prev_margin_rub
  FROM fact_sku_daily
  WHERE sku_ms IS NOT NULL
    AND (
      (metric_date BETWEEN p_from      AND p_to)
      OR (metric_date BETWEEN p_prev_from AND p_prev_to)
    )
  GROUP BY sku_ms
$$;

-- ── 2. Per-date агрегаты за период (для trend графика) ─────────────────────
CREATE OR REPLACE FUNCTION sku_daily_full_agg(
  p_from date,
  p_to   date
)
RETURNS TABLE (
  metric_date date,
  revenue     numeric,
  ad_spend    numeric,
  chmd_rub    numeric,
  margin_rub  numeric,
  ctr_avg     numeric,
  cr_order_avg numeric
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    metric_date,
    COALESCE(SUM(revenue),    0)::numeric AS revenue,
    COALESCE(SUM(ad_spend),   0)::numeric AS ad_spend,
    COALESCE(SUM(chmd_rub),   0)::numeric AS chmd_rub,
    COALESCE(SUM(margin_rub), 0)::numeric AS margin_rub,
    AVG(ctr)      FILTER (WHERE ctr      IS NOT NULL)::numeric AS ctr_avg,
    AVG(cr_order) FILTER (WHERE cr_order IS NOT NULL)::numeric AS cr_order_avg
  FROM fact_sku_daily
  WHERE metric_date BETWEEN p_from AND p_to
  GROUP BY metric_date
$$;

-- ── 3. Per-date агрегаты воронки (для PriceTab daily графика) ──────────────
CREATE OR REPLACE FUNCTION prices_daily_funnel_agg(
  p_from date,
  p_to   date
)
RETURNS TABLE (
  metric_date     date,
  revenue         numeric,
  ad_spend        numeric,
  ctr_avg         numeric,
  cr_cart_avg     numeric,
  cr_order_avg    numeric,
  cpm_avg         numeric,
  cpc_avg         numeric,
  ad_order_share_avg numeric,
  price_wgt       numeric,
  price_weight    numeric
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    metric_date,
    COALESCE(SUM(revenue),  0)::numeric AS revenue,
    COALESCE(SUM(ad_spend), 0)::numeric AS ad_spend,
    AVG(ctr)            FILTER (WHERE ctr            IS NOT NULL)::numeric,
    AVG(cr_cart)        FILTER (WHERE cr_cart        IS NOT NULL)::numeric,
    AVG(cr_order)       FILTER (WHERE cr_order       IS NOT NULL)::numeric,
    AVG(cpm)            FILTER (WHERE cpm            IS NOT NULL)::numeric,
    AVG(cpc)            FILTER (WHERE cpc            IS NOT NULL)::numeric,
    AVG(ad_order_share) FILTER (WHERE ad_order_share IS NOT NULL)::numeric,
    COALESCE(SUM(price * revenue) FILTER (WHERE price IS NOT NULL AND revenue > 0), 0)::numeric AS price_wgt,
    COALESCE(SUM(revenue)         FILTER (WHERE price IS NOT NULL AND revenue > 0), 0)::numeric AS price_weight
  FROM fact_sku_daily
  WHERE metric_date BETWEEN p_from AND p_to
  GROUP BY metric_date
$$;

-- ── 4. KPI воронки за период (для PriceTab KPI) ────────────────────────────
CREATE OR REPLACE FUNCTION prices_funnel_period_agg(
  p_from      date,
  p_to        date,
  p_prev_from date,
  p_prev_to   date
)
RETURNS TABLE (
  is_current      boolean,
  total_revenue   numeric,
  total_ad_spend  numeric,
  ctr_avg         numeric,
  cr_cart_avg     numeric,
  cr_order_avg    numeric,
  cpm_avg         numeric,
  cpc_avg         numeric,
  ad_order_share_avg numeric
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    (metric_date BETWEEN p_from AND p_to) AS is_current,
    COALESCE(SUM(revenue),  0)::numeric,
    COALESCE(SUM(ad_spend), 0)::numeric,
    AVG(ctr)            FILTER (WHERE ctr            IS NOT NULL)::numeric,
    AVG(cr_cart)        FILTER (WHERE cr_cart        IS NOT NULL)::numeric,
    AVG(cr_order)       FILTER (WHERE cr_order       IS NOT NULL)::numeric,
    AVG(cpm)            FILTER (WHERE cpm            IS NOT NULL)::numeric,
    AVG(cpc)            FILTER (WHERE cpc            IS NOT NULL)::numeric,
    AVG(ad_order_share) FILTER (WHERE ad_order_share IS NOT NULL)::numeric
  FROM fact_sku_daily
  WHERE (metric_date BETWEEN p_from      AND p_to)
     OR (metric_date BETWEEN p_prev_from AND p_prev_to)
  GROUP BY (metric_date BETWEEN p_from AND p_to)
$$;

GRANT EXECUTE ON FUNCTION sku_period_full_agg(date, date, date, date)        TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION sku_daily_full_agg(date, date)                     TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION prices_daily_funnel_agg(date, date)                TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION prices_funnel_period_agg(date, date, date, date)   TO anon, authenticated, service_role;
