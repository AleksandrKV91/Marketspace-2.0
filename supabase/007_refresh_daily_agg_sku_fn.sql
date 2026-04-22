CREATE OR REPLACE FUNCTION refresh_daily_agg_sku(
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
  -- Вычисляем агрегат по (metric_date, sku_ms)
  -- price_change: берём из fact_price_changes — цена ПОСЛЕ изменения на эту дату (если была)
  agg AS (
    SELECT
      d.metric_date,
      d.sku_ms,
      dim.sku_wb,
      -- Остатки × цена (снапшотные поля)
      (COALESCE(d.fbo_wb, 0) + COALESCE(d.fbs_pushkino, 0) +
       COALESCE(d.fbs_smolensk, 0) + COALESCE(d.kits_stock, 0))
        * COALESCE(d.price, 0)                                  AS stock_sum_rub,
      d.price                                                   AS price,
      -- Изменение цены: price из fact_price_changes на эту дату (если есть), иначе NULL
      pc.price                                                  AS price_change,
      -- Продажи шт = ROUND(revenue / price)
      CASE WHEN COALESCE(d.price, 0) > 0
        THEN ROUND(COALESCE(d.revenue, 0) / d.price)
        ELSE 0
      END                                                       AS sales_qty,
      -- Себестоимость = revenue × (1 − margin_pct)
      COALESCE(d.revenue, 0) * (1 - COALESCE(d.margin_pct, 0)) AS cost_sum,
      -- cost_per_unit = cost_sum / sales_qty
      CASE
        WHEN COALESCE(d.price, 0) > 0
         AND ROUND(COALESCE(d.revenue, 0) / d.price) > 0
        THEN COALESCE(d.revenue, 0) * (1 - COALESCE(d.margin_pct, 0))
             / ROUND(COALESCE(d.revenue, 0) / d.price)
        ELSE NULL
      END                                                       AS cost_per_unit,
      -- Маржа = revenue − cost_sum = revenue × margin_pct
      COALESCE(d.revenue, 0) * COALESCE(d.margin_pct, 0)       AS margin_sum,
      -- ЧМД = маржа − затраты
      COALESCE(d.revenue, 0) * COALESCE(d.margin_pct, 0)
        - COALESCE(d.ad_spend, 0)                               AS chmd,
      -- Маржинальность = маржа / выручка
      CASE WHEN COALESCE(d.revenue, 0) > 0
        THEN COALESCE(d.margin_pct, 0)
        ELSE NULL
      END                                                       AS marginality,
      -- ЧМД% = chmd / выручка
      CASE WHEN COALESCE(d.revenue, 0) > 0
        THEN (COALESCE(d.revenue, 0) * COALESCE(d.margin_pct, 0)
              - COALESCE(d.ad_spend, 0))
             / COALESCE(d.revenue, 0)
        ELSE NULL
      END                                                       AS chmd_pct
    FROM fact_sku_daily d
    LEFT JOIN dim_sku dim ON dim.sku_ms = d.sku_ms
    -- Присоединяем изменение цены на эту дату (если было)
    LEFT JOIN fact_price_changes pc
      ON pc.sku_wb = dim.sku_wb
      AND pc.price_date::date = d.metric_date
      AND pc.delta_pct IS NOT NULL
    WHERE d.metric_date BETWEEN (SELECT v_from FROM bounds) AND (SELECT v_to FROM bounds)
  ),
  del AS (
    DELETE FROM daily_agg_sku
    WHERE metric_date BETWEEN (SELECT v_from FROM bounds) AND (SELECT v_to FROM bounds)
    RETURNING 1
  ),
  ins AS (
    INSERT INTO daily_agg_sku (
      metric_date, sku_ms, sku_wb,
      stock_sum_rub, price, price_change,
      sales_qty, cost_sum, cost_per_unit,
      margin_sum, chmd, marginality, chmd_pct
    )
    SELECT
      metric_date, sku_ms, sku_wb,
      stock_sum_rub, price, price_change,
      sales_qty, cost_sum, cost_per_unit,
      margin_sum, chmd, marginality, chmd_pct
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
