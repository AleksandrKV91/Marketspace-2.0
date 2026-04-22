CREATE OR REPLACE FUNCTION refresh_daily_agg(
  from_date date DEFAULT NULL,
  to_date   date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
AS $func$
  WITH
  -- Границы диапазона
  bounds AS (
    SELECT
      COALESCE(from_date, MIN(metric_date)) AS v_from,
      COALESCE(to_date,   MAX(metric_date)) AS v_to
    FROM fact_sku_daily
  ),
  -- Последняя snap_date — для снапшотных полей (остатки, price для stock_sum_rub)
  last_snap AS (
    SELECT MAX(snap_date) AS snap_date
    FROM fact_sku_daily
    WHERE snap_date IS NOT NULL
  ),
  -- Снапшот последних остатков по каждому SKU
  snap AS (
    SELECT DISTINCT ON (d.sku_ms)
      d.sku_ms,
      COALESCE(d.fbo_wb, 0) + COALESCE(d.fbs_pushkino, 0) +
        COALESCE(d.fbs_smolensk, 0) + COALESCE(d.kits_stock, 0) AS total_stock,
      COALESCE(d.price, 0) AS price
    FROM fact_sku_daily d
    JOIN last_snap ls ON d.snap_date = ls.snap_date
    WHERE d.fbo_wb IS NOT NULL
    ORDER BY d.sku_ms, d.snap_date DESC
  ),
  -- Агрегат stock_sum_rub (фиксированный на дату снапшота — одинаков для всего периода)
  stock_total AS (
    SELECT SUM(total_stock * price) AS stock_sum_rub
    FROM snap
  ),
  -- Основной агрегат по дням из fact_sku_daily
  daily_src AS (
    SELECT
      d.metric_date,
      d.sku_ms,
      COALESCE(d.revenue,        0) AS rev,
      COALESCE(d.ad_spend,       0) AS spend,
      COALESCE(d.margin_pct,     0) AS mp,
      COALESCE(d.price,          0) AS price,
      COALESCE(d.drr_plan,       0) AS drr_plan,
      COALESCE(d.drr_total,      0) AS drr_total,
      COALESCE(d.drr_ad,         0) AS drr_ad,
      COALESCE(d.ctr,            0) AS ctr,
      COALESCE(d.cr_cart,        0) AS cr_cart,
      COALESCE(d.cr_order,       0) AS cr_order,
      COALESCE(d.ad_order_share, 0) AS ad_order_share
    FROM fact_sku_daily d
    WHERE d.metric_date BETWEEN (SELECT v_from FROM bounds) AND (SELECT v_to FROM bounds)
  ),
  -- Промежуточные вычисления по SKU×дате
  sku_day AS (
    SELECT
      metric_date,
      sku_ms,
      rev,
      spend,
      mp,
      price,
      drr_plan,
      drr_total,
      drr_ad,
      ctr,
      cr_cart,
      cr_order,
      ad_order_share,
      -- Себестоимость = выручка × (1 − маржа)
      rev * (1 - mp)                                    AS cost_per_sku,
      -- Продажи шт = ROUND(выручка / цена)
      CASE WHEN price > 0 THEN ROUND(rev / price) ELSE 0 END AS qty_per_sku,
      -- cost_per_unit = cost / qty
      CASE WHEN price > 0 AND ROUND(rev / price) > 0
        THEN (rev * (1 - mp)) / ROUND(rev / price) ELSE NULL END AS cost_unit_per_sku
    FROM daily_src
  ),
  -- Агрегат по дате
  agg AS (
    SELECT
      metric_date,
      -- Суммы
      SUM(rev)                                          AS revenue_sum,
      SUM(spend)                                        AS ad_spend_sum,
      SUM(cost_per_sku)                                 AS cost_sum,
      SUM(rev * mp)                                     AS margin_sum,
      SUM(rev * mp) - SUM(spend)                        AS chmd_sum,
      SUM(qty_per_sku)                                  AS sales_qty,
      -- Средневзвешенные по выручке (СУММПРОИЗВ(X; rev) / Σrev)
      CASE WHEN SUM(rev) > 0
        THEN SUM(drr_plan * rev) / SUM(rev)    ELSE NULL END  AS drr_plan,
      CASE WHEN SUM(rev) > 0
        THEN SUM(drr_total * rev) / SUM(rev)   ELSE NULL END  AS drr_total,
      CASE WHEN SUM(rev) > 0
        THEN SUM(drr_ad * rev) / SUM(rev)      ELSE NULL END  AS drr_ad,
      CASE WHEN SUM(rev) > 0
        THEN SUM(ctr * rev) / SUM(rev)         ELSE NULL END  AS ctr_avg,
      CASE WHEN SUM(rev) > 0
        THEN SUM(cr_cart * rev) / SUM(rev)     ELSE NULL END  AS cr_cart_avg,
      CASE WHEN SUM(rev) > 0
        THEN SUM(cr_order * rev) / SUM(rev)    ELSE NULL END  AS cr_order_avg,
      CASE WHEN SUM(rev) > 0
        THEN SUM(ad_order_share * rev) / SUM(rev) ELSE NULL END AS ad_order_share,
      -- Простое среднее цены
      CASE WHEN COUNT(DISTINCT sku_ms) > 0
        THEN SUM(price) / COUNT(DISTINCT sku_ms) ELSE NULL END AS price_avg,
      -- Среднее cost_per_unit по SKU с ненулевыми продажами
      AVG(cost_unit_per_sku)                            AS cost_per_unit_avg,
      -- Маржинальность = margin_sum / revenue_sum
      CASE WHEN SUM(rev) > 0
        THEN SUM(rev * mp) / SUM(rev)          ELSE NULL END  AS marginality,
      -- ЧМД% = chmd_sum / revenue_sum
      CASE WHEN SUM(rev) > 0
        THEN (SUM(rev * mp) - SUM(spend)) / SUM(rev) ELSE NULL END AS chmd_pct,
      COUNT(DISTINCT sku_ms)                            AS sku_count
    FROM sku_day
    GROUP BY metric_date
  ),
  -- Удаляем старые строки диапазона
  del AS (
    DELETE FROM fact_daily_agg
    WHERE metric_date BETWEEN (SELECT v_from FROM bounds) AND (SELECT v_to FROM bounds)
    RETURNING 1
  ),
  -- Вставляем пересчитанные строки
  ins AS (
    INSERT INTO fact_daily_agg (
      metric_date,
      revenue_sum, ad_spend_sum, stock_sum_rub,
      drr_plan, drr_total, drr_ad,
      ctr_avg, cr_cart_avg, cr_order_avg,
      price_avg, ad_order_share,
      sales_qty, cost_sum, cost_per_unit_avg,
      margin_sum, chmd_sum, marginality, chmd_pct,
      sku_count
    )
    SELECT
      a.metric_date,
      a.revenue_sum,
      a.ad_spend_sum,
      -- stock_sum_rub одинаков для всех дат (берём из снапшота)
      COALESCE((SELECT stock_sum_rub FROM stock_total), 0),
      a.drr_plan, a.drr_total, a.drr_ad,
      a.ctr_avg, a.cr_cart_avg, a.cr_order_avg,
      a.price_avg, a.ad_order_share,
      a.sales_qty, a.cost_sum, a.cost_per_unit_avg,
      a.margin_sum, a.chmd_sum, a.marginality, a.chmd_pct,
      a.sku_count
    FROM agg a
    RETURNING 1
  )
  SELECT jsonb_build_object(
    'ok',       true,
    'agg_rows', (SELECT COUNT(*) FROM ins),
    'from',     (SELECT v_from FROM bounds),
    'to',       (SELECT v_to   FROM bounds)
  );
$func$;
