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

  // 8. Проверка dim_sku.sku_wb — есть ли маппинг для sku-report
  const { count: dimWbCount } = await supabase
    .from('dim_sku')
    .select('sku_wb', { count: 'exact', head: true })
    .not('sku_wb', 'is', null)

  // 9. Последние ошибки загрузок
  const { data: errorUploads } = await supabase
    .from('uploads')
    .select('file_type, filename, status, error_msg, uploaded_at, rows_count')
    .eq('status', 'error')
    .order('uploaded_at', { ascending: false })
    .limit(5)

  // 10. ABC классы — примеры
  const { data: abcSample } = await supabase
    .from('fact_abc')
    .select('sku_ms, abc_class, abc_class2, revenue')
    .not('abc_class', 'is', null)
    .limit(5)

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
      dim_sku_with_wb_count: dimWbCount,
      intersection_count: intersection.length,
      intersection_sample: intersection.slice(0, 5),
    },
    error_uploads: errorUploads,
    abc_sample: abcSample,
  })
}
