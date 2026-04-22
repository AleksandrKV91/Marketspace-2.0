-- ============================================================
-- 008: Добавить новые колонки в fact_daily_agg +
--      Обновить функцию refresh_daily_agg — читать из daily_agg_sku
-- ============================================================

-- Новые колонки (добавляем если ещё нет)
ALTER TABLE fact_daily_agg
  ADD COLUMN IF NOT EXISTS sales_qty       numeric,        -- продажи штук (Σ из daily_agg_sku)
  ADD COLUMN IF NOT EXISTS chmd_pct_wgt    numeric,        -- средневзв. ЧМД% (Σ(chmd_pct*rev)/Σrev)
  ADD COLUMN IF NOT EXISTS marginality_wgt numeric;        -- средневзв. маржинальность

-- Обновлённая функция: читает из daily_agg_sku (корректные штуки, цены, ЧМД)
-- + из fact_sku_daily (рекламные метрики: ctr, cr, cpm, cpc)
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
      COALESCE(from_date, (SELECT MIN(metric_date) FROM daily_agg_sku)) AS v_from,
      COALESCE(to_date,   (SELECT MAX(metric_date) FROM daily_agg_sku)) AS v_to
  ),
  -- Агрегируем из daily_agg_sku (финансовые показатели)
  sku_fin AS (
    SELECT
      s.metric_date,
      COALESCE(dim.category_wb, '') AS category_wb,
      COALESCE(dim.subject_wb,  '') AS subject_wb,
      -- Суммы
      SUM(COALESCE(d.revenue, 0))    AS revenue,
      SUM(COALESCE(d.ad_spend, 0))   AS ad_spend,
      SUM(COALESCE(s.chmd_rub, 0))   AS chmd,
      SUM(COALESCE(s.sales_qty, 0))  AS sales_qty,
      -- Средневзвешенные по выручке
      CASE WHEN SUM(COALESCE(d.revenue, 0)) > 0
        THEN SUM(COALESCE(d.revenue, 0) * COALESCE(d.margin_pct, 0))
             / SUM(COALESCE(d.revenue, 0))
        ELSE 0 END AS margin_pct_wgt,
      CASE WHEN SUM(COALESCE(d.revenue, 0)) > 0
        THEN SUM(COALESCE(s.price, 0) * COALESCE(d.revenue, 0))
             / SUM(COALESCE(d.revenue, 0))
        ELSE 0 END AS price_wgt,
      -- ДРР = Σad_spend / Σrevenue
      CASE WHEN SUM(COALESCE(d.revenue, 0)) > 0
        THEN SUM(COALESCE(d.ad_spend, 0)) / SUM(COALESCE(d.revenue, 0))
        ELSE 0 END AS drr,
      -- Средневзв. маржинальность
      CASE WHEN SUM(COALESCE(d.revenue, 0)) > 0
        THEN SUM(COALESCE(s.marginality, 0) * COALESCE(d.revenue, 0))
             / SUM(COALESCE(d.revenue, 0))
        ELSE NULL END AS marginality_wgt,
      -- Средневзв. ЧМД%
      CASE WHEN SUM(COALESCE(d.revenue, 0)) > 0
        THEN SUM(COALESCE(s.chmd_pct, 0) * COALESCE(d.revenue, 0))
             / SUM(COALESCE(d.revenue, 0))
        ELSE NULL END AS chmd_pct_wgt,
      COUNT(DISTINCT s.sku_wb) AS sku_count
    FROM daily_agg_sku s
    LEFT JOIN fact_sku_daily d
          ON d.sku_ms = s.sku_ms AND d.metric_date = s.metric_date
    LEFT JOIN dim_sku dim ON dim.sku_ms = s.sku_ms
    WHERE s.metric_date BETWEEN (SELECT v_from FROM bounds) AND (SELECT v_to FROM bounds)
    GROUP BY s.metric_date, COALESCE(dim.category_wb,''), COALESCE(dim.subject_wb,'')
  ),
  -- Рекламные метрики (CTR, CR, CPM, CPC) — из fact_sku_daily, простое среднее ненулевых
  sku_ad AS (
    SELECT
      d.metric_date,
      COALESCE(dim.category_wb, '') AS category_wb,
      COALESCE(dim.subject_wb,  '') AS subject_wb,
      AVG(NULLIF(d.ctr, 0))            AS ctr_avg,
      AVG(NULLIF(d.cr_cart, 0))        AS cr_cart_avg,
      AVG(NULLIF(d.cr_order, 0))       AS cr_order_avg,
      AVG(NULLIF(d.cpm, 0))            AS cpm_avg,
      AVG(NULLIF(d.cpc, 0))            AS cpc_avg,
      AVG(NULLIF(d.ad_order_share, 0)) AS ad_order_share
    FROM fact_sku_daily d
    LEFT JOIN dim_sku dim ON dim.sku_ms = d.sku_ms
    WHERE d.metric_date BETWEEN (SELECT v_from FROM bounds) AND (SELECT v_to FROM bounds)
    GROUP BY d.metric_date, COALESCE(dim.category_wb,''), COALESCE(dim.subject_wb,'')
  ),
  -- Объединяем
  agg AS (
    SELECT
      f.metric_date,
      f.category_wb,
      f.subject_wb,
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
      a.ad_order_share,
      -- CPO = ad_spend / sales_qty
      CASE WHEN COALESCE(f.sales_qty, 0) > 0
        THEN f.ad_spend / f.sales_qty
        ELSE NULL END AS cpo
    FROM sku_fin f
    LEFT JOIN sku_ad a USING (metric_date, category_wb, subject_wb)
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
      sales_qty, margin_pct_wgt, price_wgt, drr,
      marginality_wgt, chmd_pct_wgt,
      ctr_avg, cr_cart_avg, cr_order_avg,
      cpm_avg, cpc_avg, ad_order_share,
      cpo, sku_count
    )
    SELECT
      metric_date, category_wb, subject_wb,
      revenue, ad_spend, chmd,
      sales_qty, margin_pct_wgt, price_wgt, drr,
      marginality_wgt, chmd_pct_wgt,
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
