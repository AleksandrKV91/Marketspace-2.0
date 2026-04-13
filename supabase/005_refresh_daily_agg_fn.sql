-- Функция для пересчёта fact_daily_agg прямо в PostgreSQL (без JS)
-- Вызывается через supabase.rpc('refresh_daily_agg', { from_date, to_date })

CREATE OR REPLACE FUNCTION refresh_daily_agg(
  from_date date DEFAULT NULL,
  to_date   date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_from date;
  v_to   date;
  v_rows int;
BEGIN
  -- Определяем диапазон
  SELECT
    COALESCE(from_date, MIN(metric_date)),
    COALESCE(to_date,   MAX(metric_date))
  INTO v_from, v_to
  FROM fact_sku_daily;

  IF v_from IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'agg_rows', 0, 'message', 'No data');
  END IF;

  -- Удаляем старые агрегаты за диапазон
  DELETE FROM fact_daily_agg
  WHERE metric_date BETWEEN v_from AND v_to;

  -- Вставляем новые агрегаты одним INSERT
  INSERT INTO fact_daily_agg (
    metric_date, category_wb, subject_wb,
    revenue, ad_spend, chmd,
    margin_pct_wgt, price_wgt, drr,
    ctr_avg, cr_cart_avg, cr_order_avg,
    cpm_avg, cpc_avg, ad_order_share,
    cpo, sku_count
  )
  SELECT
    d.metric_date,
    COALESCE(dim.category_wb, '')  AS category_wb,
    COALESCE(dim.subject_wb,  '')  AS subject_wb,

    -- Суммы
    SUM(COALESCE(d.revenue,  0))   AS revenue,
    SUM(COALESCE(d.ad_spend, 0))   AS ad_spend,

    -- ЧМД = Σ(revenue × margin_pct) − Σad_spend
    SUM(COALESCE(d.revenue, 0) * COALESCE(s.margin_pct, 0)) - SUM(COALESCE(d.ad_spend, 0)) AS chmd,

    -- Средневзвешенная маржа: Σ(margin_pct × revenue) / Σrevenue
    CASE WHEN SUM(COALESCE(d.revenue, 0)) > 0
      THEN SUM(COALESCE(d.revenue, 0) * COALESCE(s.margin_pct, 0)) / SUM(COALESCE(d.revenue, 0))
      ELSE 0 END                   AS margin_pct_wgt,

    -- Средневзвешенная цена: Σ(price × revenue) / Σrevenue
    CASE WHEN SUM(COALESCE(d.revenue, 0)) > 0
      THEN SUM(COALESCE(d.revenue, 0) * COALESCE(s.price, 0)) / SUM(COALESCE(d.revenue, 0))
      ELSE 0 END                   AS price_wgt,

    -- ДРР
    CASE WHEN SUM(COALESCE(d.revenue, 0)) > 0
      THEN SUM(COALESCE(d.ad_spend, 0)) / SUM(COALESCE(d.revenue, 0))
      ELSE 0 END                   AS drr,

    -- Средние по ненулевым
    AVG(NULLIF(d.ctr, 0))          AS ctr_avg,
    AVG(NULLIF(d.cr_cart, 0))      AS cr_cart_avg,
    AVG(NULLIF(d.cr_order, 0))     AS cr_order_avg,
    AVG(NULLIF(d.cpm, 0))          AS cpm_avg,
    AVG(NULLIF(d.cpc, 0))          AS cpc_avg,
    AVG(NULLIF(d.ad_order_share, 0)) AS ad_order_share,

    -- CPO = ad_spend / (revenue / price_wgt)
    CASE
      WHEN SUM(COALESCE(d.revenue, 0)) > 0
       AND SUM(COALESCE(d.revenue, 0) * COALESCE(s.price, 0)) / SUM(COALESCE(d.revenue, 0)) > 0
      THEN SUM(COALESCE(d.ad_spend, 0))
           / (SUM(COALESCE(d.revenue, 0))
              / (SUM(COALESCE(d.revenue, 0) * COALESCE(s.price, 0)) / SUM(COALESCE(d.revenue, 0))))
      ELSE NULL
    END                            AS cpo,

    COUNT(DISTINCT d.sku_ms)       AS sku_count

  FROM fact_sku_daily d
  LEFT JOIN (
    -- Берём margin_pct и price из последнего снапшота для каждого SKU
    SELECT DISTINCT ON (sku_ms)
      sku_ms, margin_pct, price
    FROM fact_sku_snapshot
    ORDER BY sku_ms, upload_id DESC
  ) s ON s.sku_ms = d.sku_ms
  LEFT JOIN dim_sku dim ON dim.sku_ms = d.sku_ms
  WHERE d.metric_date BETWEEN v_from AND v_to
  GROUP BY d.metric_date, COALESCE(dim.category_wb, ''), COALESCE(dim.subject_wb, '');

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok',        true,
    'agg_rows',  v_rows,
    'from',      v_from,
    'to',        v_to
  );
END;
$$;
