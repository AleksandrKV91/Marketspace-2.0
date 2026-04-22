-- ============================================================
-- 008: Добавить новые колонки в fact_daily_agg +
--      Обновить функцию refresh_daily_agg — читать из daily_agg_sku
--
-- Production-таблица: одна строка на дату (PK = metric_date),
-- старые колонки: revenue_sum, ad_spend_sum, chmd_sum, price_avg, drr_total…
-- Добавляем новые колонки с именами которые ожидает приложение,
-- и заполняем их теми же вычисленными значениями.
-- Старые колонки тоже обновляются для консистентности.
-- ============================================================

-- 1. Новые колонки (добавляем если ещё нет)
ALTER TABLE fact_daily_agg
  ADD COLUMN IF NOT EXISTS revenue         numeric,
  ADD COLUMN IF NOT EXISTS ad_spend        numeric,
  ADD COLUMN IF NOT EXISTS chmd            numeric,
  ADD COLUMN IF NOT EXISTS margin_pct_wgt  numeric,
  ADD COLUMN IF NOT EXISTS price_wgt       numeric,
  ADD COLUMN IF NOT EXISTS drr             numeric,
  ADD COLUMN IF NOT EXISTS sales_qty       numeric,
  ADD COLUMN IF NOT EXISTS chmd_pct_wgt    numeric,
  ADD COLUMN IF NOT EXISTS marginality_wgt numeric,
  ADD COLUMN IF NOT EXISTS cpo             numeric;

-- 2. Обновлённая функция
CREATE OR REPLACE FUNCTION refresh_daily_agg(
  from_date date DEFAULT NULL,
  to_date   date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
DECLARE
  v_from date;
  v_to   date;
  v_rows bigint;
BEGIN
  SELECT
    COALESCE(from_date, (SELECT MIN(metric_date) FROM daily_agg_sku)),
    COALESCE(to_date,   (SELECT MAX(metric_date) FROM daily_agg_sku))
  INTO v_from, v_to;

  IF v_from IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'agg_rows', 0, 'note', 'daily_agg_sku is empty');
  END IF;

  -- UPSERT: одна строка на дату (агрегат по всем SKU)
  WITH
  sku_fin AS (
    SELECT
      s.metric_date,
      SUM(COALESCE(d.revenue,  0))   AS revenue,
      SUM(COALESCE(d.ad_spend, 0))   AS ad_spend,
      SUM(COALESCE(s.chmd_rub, 0))   AS chmd,
      SUM(COALESCE(s.sales_qty, 0))  AS sales_qty,
      CASE WHEN SUM(COALESCE(d.revenue, 0)) > 0
        THEN SUM(COALESCE(d.revenue,0) * COALESCE(d.margin_pct,0))
             / SUM(COALESCE(d.revenue, 0))
        ELSE 0 END AS margin_pct_wgt,
      CASE WHEN SUM(COALESCE(d.revenue, 0)) > 0
        THEN SUM(COALESCE(s.price,0) * COALESCE(d.revenue,0))
             / SUM(COALESCE(d.revenue, 0))
        ELSE 0 END AS price_wgt,
      CASE WHEN SUM(COALESCE(d.revenue, 0)) > 0
        THEN SUM(COALESCE(d.ad_spend, 0)) / SUM(COALESCE(d.revenue, 0))
        ELSE 0 END AS drr,
      CASE WHEN SUM(COALESCE(d.revenue, 0)) > 0
        THEN SUM(COALESCE(s.marginality,0) * COALESCE(d.revenue,0))
             / SUM(COALESCE(d.revenue, 0))
        ELSE NULL END AS marginality_wgt,
      CASE WHEN SUM(COALESCE(d.revenue, 0)) > 0
        THEN SUM(COALESCE(s.chmd_pct,0) * COALESCE(d.revenue,0))
             / SUM(COALESCE(d.revenue, 0))
        ELSE NULL END AS chmd_pct_wgt,
      COUNT(DISTINCT s.sku_wb) AS sku_count
    FROM daily_agg_sku s
    LEFT JOIN fact_sku_daily d
          ON d.sku_ms = s.sku_ms AND d.metric_date = s.metric_date
    WHERE s.metric_date BETWEEN v_from AND v_to
    GROUP BY s.metric_date
  ),
  sku_ad AS (
    SELECT
      d.metric_date,
      AVG(NULLIF(d.ctr,           0)) AS ctr_avg,
      AVG(NULLIF(d.cr_cart,       0)) AS cr_cart_avg,
      AVG(NULLIF(d.cr_order,      0)) AS cr_order_avg,
      AVG(NULLIF(d.cpm,           0)) AS cpm_avg,
      AVG(NULLIF(d.cpc,           0)) AS cpc_avg,
      AVG(NULLIF(d.ad_order_share,0)) AS ad_order_share
    FROM fact_sku_daily d
    WHERE d.metric_date BETWEEN v_from AND v_to
    GROUP BY d.metric_date
  ),
  agg AS (
    SELECT
      f.metric_date,
      f.revenue,
      f.ad_spend,
      f.chmd,
      f.sales_qty,
      f.margin_pct_wgt,
      f.price_wgt,
      f.drr,
      f.marginality_wgt,
      f.chmd_pct_wgt,
      f.sku_count,
      a.ctr_avg,
      a.cr_cart_avg,
      a.cr_order_avg,
      a.cpm_avg,
      a.cpc_avg,
      COALESCE(a.ad_order_share, 0) AS ad_order_share,
      CASE WHEN COALESCE(f.sales_qty, 0) > 0
        THEN f.ad_spend / f.sales_qty ELSE NULL END AS cpo,
      -- Старые колонки (обновляем те же значения для консистентности)
      f.revenue                                         AS revenue_sum,
      f.ad_spend                                        AS ad_spend_sum,
      f.chmd                                            AS chmd_sum,
      f.price_wgt                                       AS price_avg,
      f.drr                                             AS drr_total,
      f.drr                                             AS drr_ad,
      f.revenue * f.margin_pct_wgt                      AS margin_sum,
      f.marginality_wgt                                 AS marginality,
      f.chmd_pct_wgt                                    AS chmd_pct,
      CASE WHEN COALESCE(f.sales_qty, 0) > 0
        THEN f.revenue*(1-f.margin_pct_wgt)/f.sales_qty
        ELSE 0 END                                      AS cost_per_unit_avg,
      f.revenue*(1-f.margin_pct_wgt)                    AS cost_sum
    FROM sku_fin f
    LEFT JOIN sku_ad a USING (metric_date)
  )
  INSERT INTO fact_daily_agg (
    metric_date, category_wb, subject_wb,
    -- новые колонки
    revenue, ad_spend, chmd, sales_qty,
    margin_pct_wgt, price_wgt, drr,
    marginality_wgt, chmd_pct_wgt, cpo, sku_count,
    ctr_avg, cr_cart_avg, cr_order_avg,
    cpm_avg, cpc_avg, ad_order_share,
    -- старые колонки (синхронизируем)
    revenue_sum, ad_spend_sum, chmd_sum,
    price_avg, drr_total, drr_ad, drr_plan,
    margin_sum, marginality, chmd_pct,
    cost_per_unit_avg, cost_sum, stock_sum_rub
  )
  SELECT
    metric_date, '', '',
    revenue, ad_spend, chmd, sales_qty,
    margin_pct_wgt, price_wgt, drr,
    marginality_wgt, chmd_pct_wgt, cpo, sku_count,
    ctr_avg, cr_cart_avg, cr_order_avg,
    cpm_avg, cpc_avg, ad_order_share,
    revenue_sum, ad_spend_sum, chmd_sum,
    price_avg, drr_total, drr_ad, 0,
    margin_sum, marginality, chmd_pct,
    cost_per_unit_avg, cost_sum, 0
  FROM agg
  ON CONFLICT (metric_date) DO UPDATE SET
    -- новые колонки
    revenue         = EXCLUDED.revenue,
    ad_spend        = EXCLUDED.ad_spend,
    chmd            = EXCLUDED.chmd,
    sales_qty       = EXCLUDED.sales_qty,
    margin_pct_wgt  = EXCLUDED.margin_pct_wgt,
    price_wgt       = EXCLUDED.price_wgt,
    drr             = EXCLUDED.drr,
    marginality_wgt = EXCLUDED.marginality_wgt,
    chmd_pct_wgt    = EXCLUDED.chmd_pct_wgt,
    cpo             = EXCLUDED.cpo,
    sku_count       = EXCLUDED.sku_count,
    ctr_avg         = EXCLUDED.ctr_avg,
    cr_cart_avg     = EXCLUDED.cr_cart_avg,
    cr_order_avg    = EXCLUDED.cr_order_avg,
    cpm_avg         = EXCLUDED.cpm_avg,
    cpc_avg         = EXCLUDED.cpc_avg,
    ad_order_share  = EXCLUDED.ad_order_share,
    -- старые колонки
    revenue_sum     = EXCLUDED.revenue_sum,
    ad_spend_sum    = EXCLUDED.ad_spend_sum,
    chmd_sum        = EXCLUDED.chmd_sum,
    price_avg       = EXCLUDED.price_avg,
    drr_total       = EXCLUDED.drr_total,
    drr_ad          = EXCLUDED.drr_ad,
    margin_sum      = EXCLUDED.margin_sum,
    marginality     = EXCLUDED.marginality,
    chmd_pct        = EXCLUDED.chmd_pct,
    cost_per_unit_avg = EXCLUDED.cost_per_unit_avg,
    cost_sum        = EXCLUDED.cost_sum;

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok',    true,
    'agg_rows', v_rows,
    'from',  v_from,
    'to',    v_to
  );
END;
$func$;
