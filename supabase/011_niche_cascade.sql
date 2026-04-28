-- Cascade seasonality/month coefficients to SKUs that share the same subject_wb.
-- Only fills NULL fields — never overwrites existing data.
-- Call after any upload that sets subject_wb on new SKUs.
CREATE OR REPLACE FUNCTION refresh_dim_sku_niche_cascade()
RETURNS void AS $$
BEGIN
  UPDATE dim_sku t
  SET
    seasonality   = COALESCE(t.seasonality,   src.seasonality),
    season_start  = COALESCE(t.season_start,  src.season_start),
    season_length = COALESCE(t.season_length, src.season_length),
    top_month     = COALESCE(t.top_month,     src.top_month),
    top_phrase    = COALESCE(t.top_phrase,    src.top_phrase),
    market_share  = COALESCE(t.market_share,  src.market_share),
    niche_appeal  = COALESCE(t.niche_appeal,  src.niche_appeal),
    availability  = COALESCE(t.availability,  src.availability),
    month_jan     = COALESCE(t.month_jan,  src.month_jan),
    month_feb     = COALESCE(t.month_feb,  src.month_feb),
    month_mar     = COALESCE(t.month_mar,  src.month_mar),
    month_apr     = COALESCE(t.month_apr,  src.month_apr),
    month_may     = COALESCE(t.month_may,  src.month_may),
    month_jun     = COALESCE(t.month_jun,  src.month_jun),
    month_jul     = COALESCE(t.month_jul,  src.month_jul),
    month_aug     = COALESCE(t.month_aug,  src.month_aug),
    month_sep     = COALESCE(t.month_sep,  src.month_sep),
    month_oct     = COALESCE(t.month_oct,  src.month_oct),
    month_nov     = COALESCE(t.month_nov,  src.month_nov),
    month_dec     = COALESCE(t.month_dec,  src.month_dec)
  FROM (
    SELECT DISTINCT ON (subject_wb)
      subject_wb, seasonality, season_start, season_length, top_month, top_phrase,
      market_share, niche_appeal, availability,
      month_jan, month_feb, month_mar, month_apr, month_may, month_jun,
      month_jul, month_aug, month_sep, month_oct, month_nov, month_dec
    FROM dim_sku
    WHERE subject_wb IS NOT NULL AND seasonality IS NOT NULL
    ORDER BY subject_wb, updated_at DESC NULLS LAST
  ) src
  WHERE t.subject_wb = src.subject_wb;
END;
$$ LANGUAGE plpgsql;
