-- Add variant_name column to fact_abc and change PK to (sku_ms, upload_id, variant_name).
-- This allows storing per-size-variant ABC classes instead of collapsing all sizes into one row.
-- variant_name = product_name from ABC file (e.g. "Артикул S", "Артикул M"); '' for single-variant SKUs.

ALTER TABLE fact_abc ADD COLUMN IF NOT EXISTS variant_name text NOT NULL DEFAULT '';

-- Drop old PK and create new composite PK including variant_name
ALTER TABLE fact_abc DROP CONSTRAINT IF EXISTS fact_abc_pkey;
ALTER TABLE fact_abc ADD PRIMARY KEY (sku_ms, upload_id, variant_name);

CREATE INDEX IF NOT EXISTS idx_fact_abc_sku_ms ON fact_abc (sku_ms);
