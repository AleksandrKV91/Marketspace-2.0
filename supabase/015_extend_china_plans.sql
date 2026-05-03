-- 015_extend_china_plans.sql
-- Расширяет fact_china_supply: добавляет недостающие плановые месяцы.
-- Раньше схема покрывала только plan_mar..plan_aug (мар-авг).
-- Новый формат файла «Потребность Китай» — апр-сен.
-- Добавляем все 12 месяцев чтобы быть устойчивыми к будущим сдвигам сезона.

ALTER TABLE fact_china_supply
  ADD COLUMN IF NOT EXISTS plan_jan int,
  ADD COLUMN IF NOT EXISTS plan_feb int,
  ADD COLUMN IF NOT EXISTS plan_sep int,
  ADD COLUMN IF NOT EXISTS plan_oct int,
  ADD COLUMN IF NOT EXISTS plan_nov int,
  ADD COLUMN IF NOT EXISTS plan_dec int;
