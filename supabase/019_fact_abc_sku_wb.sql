-- 019_fact_abc_sku_wb.sql
-- Добавляем sku_wb в fact_abc для fallback-матчинга с fact_sku_period.
--
-- ПРОБЛЕМА:
--   Парсер ABC до v6 подхватывал колонку «Артикул WB» (число) под видом sku_ms,
--   если в файле не было точной колонки «Артикул склада». В fact_abc.sku_ms попадал
--   мусор ('(blue)toothbrush', '0', '00-67042075' и т.п.), и матчинг с
--   fact_sku_period.sku_ms (CLASSMARK_*, RINREY_* и др.) проваливался у ~40% SKU.
--
-- РЕШЕНИЕ:
--   1) Парсер v7+ читает «Артикул WB» отдельно в sku_wb.
--   2) orders/route.ts получает прямой fallback abcByWb (из fact_abc.sku_wb), без
--      посредничества dim_sku — это даёт +200..300 SKU с ABC/GMROI.

ALTER TABLE fact_abc
  ADD COLUMN IF NOT EXISTS sku_wb bigint;

CREATE INDEX IF NOT EXISTS idx_fact_abc_sku_wb
  ON fact_abc (sku_wb)
  WHERE sku_wb IS NOT NULL;

COMMENT ON COLUMN fact_abc.sku_wb IS
  'Артикул WB (число). Парсим из колонки «Артикул WB» ABC-файла для fallback-матчинга с fact_sku_period.sku_wb когда sku_ms не совпадает.';
