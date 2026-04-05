✅ Решение для Supabase (PostgreSQL)
Поскольку данные уже загружены в Supabase и Power Query недоступен, вся логика будет реализована чисто на SQL. Я подготовил три готовых блока:
1. Проверка, какие данные уже загружены и чего не хватает
2. Решение поиска артикулов через «Свод» (по любому ключу без ошибок)
3. Полная SQL-реализация логики расчёта заказа (из вашего файла)
1. Проверка загруженных данных (аудит)

Выполните этот запрос в Supabase SQL Editor:
-- Аудит всех таблиц: имя, схема, приблизительное количество строк
SELECT 
    n.nspname AS table_schema,
    c.relname AS table_name,
    c.reltuples::bigint AS estimated_row_count,   -- приблизительное количество (очень быстро)
    pg_size_pretty(pg_relation_size(c.oid)) AS table_size
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r'                              -- только обычные таблицы
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
ORDER BY c.reltuples DESC;

сделано - результат:

| table_schema | table_name                 | estimated_row_count | table_size |
| ------------ | -------------------------- | ------------------- | ---------- |
| public       | fact_stock_daily           | 91500 | 9072 kB    |
| public       | fact_stock_snapshot        | 4860  | 624 kB     |
| public       | dim_sku                    | 2812  | 2968 kB    |
| public       | fact_abc                   | 2586  | 584 kB     |
| public       | fact_china_supply          | 500   | 64 kB      |
| auth         | schema_migrations          | 76    | 8192 bytes |
| realtime     | schema_migrations          | 68    | 8192 bytes |
| storage      | migrations                 | 57    | 8192 bytes |
| auth         | sessions                   | -1    | 0 bytes    |
| auth         | users                      | -1    | 0 bytes    |
| auth         | audit_log_entries          | -1    | 0 bytes    |
| auth         | sso_domains                | -1    | 0 bytes    |
| auth         | mfa_amr_claims             | -1    | 0 bytes    |
| auth         | identities                 | -1    | 0 bytes    |
| auth         | one_time_tokens            | -1    | 0 bytes    |
| auth         | sso_providers              | -1    | 0 bytes    |
| auth         | mfa_challenges             | -1    | 0 bytes    |
| auth         | mfa_factors                | -1    | 0 bytes    |
| auth         | flow_state                 | -1    | 0 bytes    |
| auth         | oauth_consents             | -1    | 0 bytes    |
| auth         | oauth_authorizations       | -1    | 0 bytes    |
| auth         | oauth_client_states        | -1    | 0 bytes    |
| auth         | oauth_clients              | -1    | 0 bytes    |
| auth         | custom_oauth_providers     | -1    | 0 bytes    |
| auth         | webauthn_credentials       | -1    | 0 bytes    |
| public       | fact_price_changes         | -1    | 0 bytes    |
| auth         | webauthn_challenges        | -1    | 0 bytes    |
| realtime     | subscription               | -1    | 0 bytes    |
| storage      | objects                    | -1    | 8192 bytes |
| public       | sku_notes                  | -1    | 0 bytes    |
| storage      | s3_multipart_uploads_parts | -1    | 0 bytes    |
| storage      | s3_multipart_uploads       | -1    | 0 bytes    |
| storage      | buckets_vectors            | -1    | 0 bytes    |
| storage      | vector_indexes             | -1    | 0 bytes    |
| storage      | buckets_analytics          | -1    | 0 bytes    |
| auth         | saml_relay_states          | -1    | 0 bytes    |
| storage      | buckets                    | -1    | 8192 bytes |
| auth         | saml_providers             | -1    | 0 bytes    |
| auth         | instances                  | -1    | 0 bytes    |
| public       | uploads                    | -1    | 8192 bytes |
| public       | fact_sku_daily             | -1    | 0 bytes    |
| public       | fact_sku_snapshot          | -1    | 0 bytes    |
| auth         | refresh_tokens             | -1    | 0 bytes    |
| vault        | secrets                    | -1    | 0 bytes    |


Если хотите точное количество строк (медленнее, но точно):
SELECT 
    table_schema,
    table_name,
    (xpath('/row/cnt/text()', 
        query_to_xml(
            format('SELECT COUNT(*) AS cnt FROM %I.%I', table_schema, table_name),
            false, true, ''
        )
    ))[1]::text::bigint AS exact_row_count
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_type = 'BASE TABLE'
ORDER BY exact_row_count DESC;

сделано - результат:

| table_schema | table_name          | exact_row_count |
| ------------ | ------------------- | --------------- |
| public       | fact_stock_daily    | 91500           |
| public       | fact_stock_snapshot | 4860            |
| public       | dim_sku             | 2812            |
| public       | fact_abc            | 2586            |
| public       | fact_china_supply   | 500             |
| public       | uploads             | 13              |
| public       | sku_notes           | 0               |
| public       | fact_price_changes  | 0               |
| public       | fact_sku_daily      | 0               |
| public       | fact_sku_snapshot   | 0               |


2. Проверка ключевых колонок в таблице «Свод»
Замените svod на реальное имя вашей таблицы Свода:
SELECT 
    COUNT(*) AS total_rows,
    COUNT(DISTINCT sku) AS unique_sku,
    COUNT(DISTINCT "Артикул WB") AS unique_art_wb,
    COUNT(DISTINCT "Артикул склада") AS unique_art_sklad,
    COUNT(DISTINCT nomer) AS unique_nomenklatura,     -- замените на реальное имя колонки номенклатуры
    SUM(CASE WHEN sku IS NULL THEN 1 ELSE 0 END) AS null_sku,
    SUM(CASE WHEN "Артикул склада" IS NULL THEN 1 ELSE 0 END) AS null_art_sklad,
    SUM(CASE WHEN "Артикул WB" IS NULL THEN 1 ELSE 0 END) AS null_art_wb
FROM svod;   -- ← замените на ваше имя таблицы (в нашем случае - dim_sku - ?)

сделано - результат:

Error: Failed to run sql query: ERROR: 42703: column "sku" does not exist LINE 3: COUNT(DISTINCT sku) AS unique_sku, ^

-- 3. Проверка связанности (сколько строк из других таблиц имеют соответствие в Свод)
SELECT 
    'Остатки' AS source_table,
    COUNT(*) AS total_rows,
    COUNT(CASE WHEN s.id IS NOT NULL THEN 1 END) AS matched_in_svod,
    ROUND(100.0 * COUNT(CASE WHEN s.id IS NOT NULL THEN 1 END) / NULLIF(COUNT(*), 0), 2) AS match_percent
FROM ostatki o
LEFT JOIN svod s 
    ON o."Артикул склада" = s."Артикул склада" 
    OR o.sku = s.sku 
    OR o."Артикул WB" = s."Артикул WB"

UNION ALL

SELECT 
    'Отчет по SKU', 
    COUNT(*), 
    COUNT(CASE WHEN s.id IS NOT NULL THEN 1 END),
    ROUND(100.0 * COUNT(CASE WHEN s.id IS NOT NULL THEN 1 END) / NULLIF(COUNT(*), 0), 2)
FROM otchet_po_sku r
LEFT JOIN svod s ON r.sku = s.sku

Не сделано

-- добавьте аналогично остальные таблицы
;


Что делать с результатами:
* Если matched_in_svod сильно меньше total → есть несоответствия.
* Если много NULL в ключах → нужно очистить/заполнить данные перед созданием view.
2. Решение поиска артикулов через «Свод» (Unified View)
Создайте один материализованный view, который будет единой точкой правды:
CREATE MATERIALIZED VIEW IF NOT EXISTS unified_sku AS
SELECT 
    s.*,
    -- все нужные колонки из остальных таблиц
    o."Остаток на ВБ ФБО",
    o."Остаток FBS Пушкино",
    o."Остаток FBS Смоленск",
    o."Остаток всего",
    o."кол-во дней ФБО",
    o."Дней до прихода",
    r."Выручка Total за 5 дней",
    r."ЧМД за пять дней, руб",
    r."Маржа Опер.",
    r."ДРР Total за 5 дней",
    -- добавьте остальные нужные колонки
    abc."Итоговый класс",
    kitay."Кол-во к заказу",
    kitay."Себа план"
FROM svod s
LEFT JOIN ostatki o 
    ON s."Артикул склада" = o."Артикул склада" 
    OR s.sku = o.sku 
    OR s."Артикул WB" = o."Артикул WB"
LEFT JOIN otchet_po_sku r 
    ON s.sku = r.sku
LEFT JOIN abc_analiz abc 
    ON s."Артикул склада" = abc."Артикул склада"
LEFT JOIN potrebnost_kitay kitay 
    ON s."Артикул склада" = kitay."Артикул склада";

-- Обновление materialized view (выполняйте после каждой загрузки таблиц)
REFRESH MATERIALIZED VIEW unified_sku;
Как использовать в дашборде:
* Все запросы к модальному окну и таблицам теперь идут только к unified_sku.
* Никаких ошибок #N/A или 0 — всегда есть fallback через LEFT JOIN.
3. SQL-реализация логики расчёта заказа (из вашего файла)
Создайте view с полной логикой:
CREATE OR REPLACE VIEW calc_zakaz AS
WITH settings AS (
    SELECT 
        100 as log_plecho_dney,           -- можно вынести в отдельную таблицу настроек
        60 as celevoy_strahovoy_zapas,
        1.0 as coef_rost_conservative,
        1.2 as coef_rost_moderate,
        1.5 as coef_rost_aggressive
),
base AS (
    SELECT 
        u.*,
        -- Базовые продажи в день (с fallback по категории, если 0)
        COALESCE(
            NULLIF(u."Продажи 31д" / 31.0, 0),
            (SELECT AVG("Продажи 31д" / 31.0) 
             FROM unified_sku 
             WHERE category = u.category)
        ) as prodazhi_den_base,
        
        -- Сезонный коэффициент (из Свод)
        COALESCE(u."Сезонный коэффициент текущего месяца", 1.0) as sezon_koef,
        
        -- Скорректированные продажи
        (COALESCE(u."Продажи 31д" / 31.0, 0) * 
         COALESCE(u."Сезонный коэффициент текущего месяца", 1.0)) as prodazhi_den_skor

    FROM unified_sku u
)
SELECT 
    b.*,
    -- Итоговая формула заказа
    GREATEST(0,
        b.prodazhi_den_skor 
        * 1.2                              -- пример: умеренный коэффициент роста (можно параметризовать)
        * (s.log_plecho_dney + s.celevoy_strahovoy_zapas)
        
        - (COALESCE(b."Остаток на ВБ ФБО", 0) 
           + COALESCE(b."Остаток FBS Пушкино", 0) 
           + COALESCE(b."Остаток FBS Смоленск", 0) 
           + COALESCE(b."Остаток всего", 0))
        
        - CASE 
            WHEN b."Дата прихода" > CURRENT_DATE 
            THEN COALESCE(b."В пути", 0) 
            ELSE 0 
          END
    ) as raschetnyy_zakaz,

    -- Пояснение (для отладки)
    CASE 
        WHEN b."Дата прихода" <= CURRENT_DATE AND b."Остаток всего" = 0 
        THEN 'Товар в пути, но уже оприходован' 
        ELSE 'Стандартный расчёт' 
    END as comment

FROM base b
CROSS JOIN settings s;
Как обновлять:
REFRESH MATERIALIZED VIEW unified_sku;   -- сначала обновляем мастер
-- затем можно сделать materialized view и для calc_zakaz
Что делать дальше (рекомендация)
1. Выполните сначала аудит (запросы из раздела 1).
2. Создайте unified_sku (раздел 2).
3. Создайте calc_zakaz (раздел 3).
4. В дашборде все модальные окна и таблицы заказов обращайтесь только к calc_zakaz и unified_sku.




