import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export const maxDuration = 30

/** Диагностика: проверяет реальное состояние всех таблиц и маппингов */
export async function GET() {
  const supabase = createServiceClient()

  // 1. Все uploads
  const { data: uploads } = await supabase
    .from('uploads')
    .select('id, file_type, filename, uploaded_at, rows_count, status, error_msg')
    .order('uploaded_at', { ascending: false })
    .limit(30)

  type UploadRow = { id: string; file_type: string; filename: string; uploaded_at: string; rows_count: number | null; status: string; error_msg: string | null }
  const latestByType: Record<string, UploadRow> = {}
  if (uploads) for (const u of uploads) {
    if (!latestByType[u.file_type]) latestByType[u.file_type] = u
  }

  // 2. Кол-во строк в каждой таблице
  const [dimCount, stockSnapCount, stockDailyCount, abcCount, chinaCount, skuDailyCount, skuSnapCount, priceCount] = await Promise.all([
    supabase.from('dim_sku').select('sku_ms', { count: 'exact', head: true }),
    supabase.from('fact_stock_snapshot').select('sku_wb', { count: 'exact', head: true }),
    supabase.from('fact_stock_daily').select('sku_wb', { count: 'exact', head: true }),
    supabase.from('fact_abc').select('sku_ms', { count: 'exact', head: true }),
    supabase.from('fact_china_supply').select('sku_ms', { count: 'exact', head: true }),
    supabase.from('fact_sku_daily').select('sku_ms', { count: 'exact', head: true }),
    supabase.from('fact_sku_snapshot').select('sku_ms', { count: 'exact', head: true }),
    supabase.from('fact_price_changes').select('sku_wb', { count: 'exact', head: true }),
  ])

  // 3. Примеры строк из fact_sku_daily (если есть)
  const { data: skuDailySample } = await supabase
    .from('fact_sku_daily')
    .select('sku_ms, metric_date, revenue, ad_spend, ctr, cr_cart, cr_order')
    .order('metric_date', { ascending: false })
    .limit(3)

  // 4. Примеры из dim_sku (проверка sku_ms формата)
  const { data: dimSample } = await supabase
    .from('dim_sku')
    .select('sku_ms, sku_wb, name')
    .limit(5)

  // 5. Пересечение fact_sku_daily.sku_ms с dim_sku.sku_ms
  const { data: skuDailySkus } = await supabase
    .from('fact_sku_daily')
    .select('sku_ms')
    .limit(20)

  const { data: dimSkus } = await supabase
    .from('dim_sku')
    .select('sku_ms, sku_wb')
    .not('sku_wb', 'is', null)
    .limit(10)

  const dimSet = new Set((dimSkus ?? []).map(r => r.sku_ms))
  const skuDailySet = new Set((skuDailySkus ?? []).map(r => r.sku_ms))
  const intersection = [...skuDailySet].filter(s => dimSet.has(s))

  // Диагностика: sku_daily может содержать WB арты как sku_ms (числа)
  // Проверяем — есть ли эти числа в dim_sku.sku_wb
  const numericSkus = [...skuDailySet].filter(s => /^\d+$/.test(s))
  let wbMatchCount = 0
  if (numericSkus.length > 0) {
    const { count } = await supabase
      .from('dim_sku')
      .select('sku_wb', { count: 'exact', head: true })
      .in('sku_wb', numericSkus.slice(0, 10).map(Number))
    wbMatchCount = count ?? 0
  }

  // Диапазон sku_wb в dim_sku
  const { data: wbMin } = await supabase.from('dim_sku').select('sku_wb').not('sku_wb','is',null).order('sku_wb',{ascending:true}).limit(1)
  const { data: wbMax } = await supabase.from('dim_sku').select('sku_wb').not('sku_wb','is',null).order('sku_wb',{ascending:false}).limit(1)

  // 6. Примеры из fact_sku_daily с НЕНУЛЕВЫМИ метриками
  const { data: nonZeroSample } = await supabase
    .from('fact_sku_daily')
    .select('sku_ms, metric_date, revenue, ad_spend, ctr')
    .gt('revenue', 0)
    .limit(3)

  // 7. Уникальные даты в fact_sku_daily
  const { data: skuDailyDates } = await supabase
    .from('fact_sku_daily')
    .select('metric_date')
    .order('metric_date', { ascending: false })
    .limit(10)

  return NextResponse.json({
    tables: {
      dim_sku: dimCount.count,
      fact_stock_snapshot: stockSnapCount.count,
      fact_stock_daily: stockDailyCount.count,
      fact_abc: abcCount.count,
      fact_china_supply: chinaCount.count,
      fact_sku_daily: skuDailyCount.count,
      fact_sku_snapshot: skuSnapCount.count,
      fact_price_changes: priceCount.count,
    },
    latest_uploads: latestByType,
    sku_daily_sample: skuDailySample,
    sku_daily_non_zero: nonZeroSample,
    sku_daily_dates: skuDailyDates,
    dim_sample: dimSample,
    sku_mapping_check: {
      fact_sku_daily_skus_sample: [...skuDailySet].slice(0, 5),
      dim_sku_with_wb_sample: (dimSkus ?? []).slice(0, 5),
      intersection_count: intersection.length,
      intersection_sample: intersection.slice(0, 5),
      numeric_skus_in_daily: numericSkus.slice(0, 5),
      wb_match_count_for_numeric: wbMatchCount,
      dim_sku_wb_range: { min: wbMin?.[0]?.sku_wb, max: wbMax?.[0]?.sku_wb },
    },
  })
}

/**
 * POST /api/debug/data-check
 * action=cleanup_numeric_sku_daily → удаляет строки где sku_ms = числовая строка (старые WB арты)
 */
export async function POST(req: Request) {
  const supabase = createServiceClient()
  const { action } = await req.json()

  if (action === 'cleanup_numeric_sku_daily') {
    // Удаляем строки где sku_ms = только цифры (числовые WB арты)
    // Используем regex filter через PostgREST: sku_ms ~ '^[0-9]+$'
    const { error: e1, count: c1 } = await supabase
      .from('fact_sku_daily')
      .delete({ count: 'exact' })
      .filter('sku_ms', 'match', '^[0-9]+$')
    if (e1) return NextResponse.json({ error: e1.message }, { status: 500 })

    const { error: e2, count: c2 } = await supabase
      .from('fact_sku_snapshot')
      .delete({ count: 'exact' })
      .filter('sku_ms', 'match', '^[0-9]+$')
    if (e2) return NextResponse.json({ error: e2.message }, { status: 500 })

    return NextResponse.json({ ok: true, deleted_daily: c1, deleted_snapshot: c2 })
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}
