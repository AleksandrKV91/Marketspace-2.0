CREATE OR REPLACE FUNCTION refresh_daily_agg(
  from_date date DEFAULT NULL,
  to_date   date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
AS $func$
  WITH
  bounds AS (
    SELECT
      COALESCE(from_date, MIN(metric_date)) AS v_from,
      COALESCE(to_date,   MAX(metric_date)) AS v_to
    FROM fact_sku_daily
  ),
  agg AS (
    SELECT
      d.metric_date,
      COALESCE(dim.category_wb, '')  AS category_wb,
      COALESCE(dim.subject_wb,  '')  AS subject_wb,
      SUM(COALESCE(d.revenue,  0))   AS revenue,
      SUM(COALESCE(d.ad_spend, 0))   AS ad_spend,
      -- chmd = Σ(revenue × margin_pct) − Σ(ad_spend)
      SUM(COALESCE(d.revenue, 0) * COALESCE(d.margin_pct, 0))
        - SUM(COALESCE(d.ad_spend, 0))                         AS chmd,
      -- margin_pct средневзвешенная по выручке
      CASE WHEN SUM(COALESCE(d.revenue,0)) > 0
        THEN SUM(COALESCE(d.revenue,0)*COALESCE(d.margin_pct,0))/SUM(COALESCE(d.revenue,0))
        ELSE 0 END                                             AS margin_pct_wgt,
      -- price средневзвешенная по выручке
      CASE WHEN SUM(COALESCE(d.revenue,0)) > 0
        THEN SUM(COALESCE(d.revenue,0)*COALESCE(d.price,0))/SUM(COALESCE(d.revenue,0))
        ELSE 0 END                                             AS price_wgt,
      -- ДРР = Σad_spend / Σrevenue
      CASE WHEN SUM(COALESCE(d.revenue,0)) > 0
        THEN SUM(COALESCE(d.ad_spend,0))/SUM(COALESCE(d.revenue,0))
        ELSE 0 END                                             AS drr,
      AVG(NULLIF(d.ctr,0))            AS ctr_avg,
      AVG(NULLIF(d.cr_cart,0))        AS cr_cart_avg,
      AVG(NULLIF(d.cr_order,0))       AS cr_order_avg,
      AVG(NULLIF(d.cpm,0))            AS cpm_avg,
      AVG(NULLIF(d.cpc,0))            AS cpc_avg,
      AVG(NULLIF(d.ad_order_share,0)) AS ad_order_share,
      -- CPO = ad_spend / qty_sold ≈ ad_spend / (revenue / price_wgt)
      CASE
        WHEN SUM(COALESCE(d.revenue,0)) > 0
         AND SUM(COALESCE(d.revenue,0)*COALESCE(d.price,0)) > 0
        THEN SUM(COALESCE(d.ad_spend,0))
             / (SUM(COALESCE(d.revenue,0))
                / (SUM(COALESCE(d.revenue,0)*COALESCE(d.price,0))/SUM(COALESCE(d.revenue,0))))
        ELSE NULL
      END                             AS cpo,
      COUNT(DISTINCT d.sku_ms)        AS sku_count
    FROM fact_sku_daily d
    LEFT JOIN dim_sku dim ON dim.sku_ms = d.sku_ms
    WHERE d.metric_date BETWEEN (SELECT v_from FROM bounds) AND (SELECT v_to FROM bounds)
    GROUP BY d.metric_date, COALESCE(dim.category_wb,''), COALESCE(dim.subject_wb,'')
  ),
  del AS (
    DELETE FROM fact_daily_agg
    WHERE metric_date BETWEEN (SELECT v_from FROM bounds) AND (SELECT v_to FROM bounds)
    RETURNING 1
  ),
  ins AS (
    INSERT INTO fact_daily_agg (
      metric_date, category_wb, subject_wb,
      revenue, ad_spend, chmd,
      margin_pct_wgt, price_wgt, drr,
      ctr_avg, cr_cart_avg, cr_order_avg,
      cpm_avg, cpc_avg, ad_order_share,
      cpo, sku_count
    )
    SELECT
      metric_date, category_wb, subject_wb,
      revenue, ad_spend, chmd,
      margin_pct_wgt, price_wgt, drr,
      ctr_avg, cr_cart_avg, cr_order_avg,
      cpm_avg, cpc_avg, ad_order_share,
      cpo, sku_count
    FROM agg
    RETURNING 1
  )
  SELECT jsonb_build_object(
    'ok',       true,
    'agg_rows', (SELECT COUNT(*) FROM ins),
    'from',     (SELECT v_from FROM bounds),
    'to',       (SELECT v_to   FROM bounds)
  );
$func$;
