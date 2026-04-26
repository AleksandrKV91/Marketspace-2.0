-- Drop old combined columns (no longer needed — replaced by separate class columns below)
ALTER TABLE fact_abc DROP COLUMN IF EXISTS abc_class;
ALTER TABLE fact_abc DROP COLUMN IF EXISTS abc_class2;

-- Add 6 new class columns
ALTER TABLE fact_abc ADD COLUMN IF NOT EXISTS chmd_class text;       -- Класс по ЧМД
ALTER TABLE fact_abc ADD COLUMN IF NOT EXISTS revenue_class text;    -- Класс по Выручке
ALTER TABLE fact_abc ADD COLUMN IF NOT EXISTS final_class_1 text;    -- Итоговый класс (ЧМД/Выручка)
ALTER TABLE fact_abc ADD COLUMN IF NOT EXISTS profitability_class text; -- Класс по Рен-сти ЧМД
ALTER TABLE fact_abc ADD COLUMN IF NOT EXISTS turnover_class text;   -- Класс по Об тз
ALTER TABLE fact_abc ADD COLUMN IF NOT EXISTS final_class_2 text;    -- Итоговый класс2 (Рент/Об)

-- Add extra columns from ABC sheet
ALTER TABLE fact_abc ADD COLUMN IF NOT EXISTS cumulative_chmd numeric;    -- Кумулятив по ЧМД
ALTER TABLE fact_abc ADD COLUMN IF NOT EXISTS revenue_share numeric;       -- Доля по Выручке
ALTER TABLE fact_abc ADD COLUMN IF NOT EXISTS cumulative_revenue numeric;  -- Кумулятив по Выручке
ALTER TABLE fact_abc ADD COLUMN IF NOT EXISTS product_name text;           -- Номенклатура
ALTER TABLE fact_abc ADD COLUMN IF NOT EXISTS created_date date;           -- Дата создания
ALTER TABLE fact_abc ADD COLUMN IF NOT EXISTS time_since_creation numeric; -- Время с создания карточки
ALTER TABLE fact_abc ADD COLUMN IF NOT EXISTS qty_cur_month numeric;       -- Количество за текущий месяц
ALTER TABLE fact_abc ADD COLUMN IF NOT EXISTS qty_prev_month numeric;      -- Количество за предыдущий месяц
