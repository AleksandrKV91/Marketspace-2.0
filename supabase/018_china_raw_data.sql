-- 018_china_raw_data.sql
-- Сохраняем ВСЕ колонки файла «Потребность Китай» как JSONB,
-- чтобы в будущем можно было использовать любое поле без миграций парсера/схемы.
-- Типизированные колонки (sku_ms, order_qty, plan_*, in_transit и т.д.) остаются —
-- это backward compat для существующей логики дашборда.

ALTER TABLE fact_china_supply
  ADD COLUMN IF NOT EXISTS raw_data jsonb;

-- GIN индекс для быстрого поиска по произвольным полям raw_data->>'...'
CREATE INDEX IF NOT EXISTS idx_fact_china_supply_raw
  ON fact_china_supply USING gin (raw_data jsonb_path_ops);

COMMENT ON COLUMN fact_china_supply.raw_data IS
  'Снимок всех колонок исходного файла "Потребность Китай" (Свод-лист). Ключи = норм. название колонки (lowercase, trimmed).';
