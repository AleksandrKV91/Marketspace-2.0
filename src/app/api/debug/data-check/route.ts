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
  const [dimCount, abcCount, chinaCount, skuDailyCount, priceCount] = await Promise.all([
    supabase.from('dim_sku').select('sku_ms', { count: 'exact', head: true }),
    supabase.from('fact_abc').select('sku_ms', { count: 'exact', head: true }),
    supabase.from('fact_china_supply').select('sku_ms', { count: 'exact', head: true }),
    supabase.from('fact_sku_daily').select('sku_ms', { count: 'exact', head: true }),
    supabase.from('fact_price_changes').select('sku_wb', { count: 'exact', head: true }),
  ])

  // 3. Примеры строк из fact_sku_daily
  const { data: skuDailySample } = await supabase
    .from('fact_sku_daily')
    .select('sku_ms, metric_date, snap_date, revenue, ad_spend, ctr, fbo_wb, margin_pct')
    .order('metric_date', { ascending: false })
    .limit(3)

  // 4. Примеры из dim_sku
  const { data: dimSample } = await supabase
    .from('dim_sku')
    .select('sku_ms, sku_wb, name')
    .limit(5)

  // 5. Пересечение
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

  const { data: wbMin } = await supabase.from('dim_sku').select('sku_wb').not('sku_wb','is',null).order('sku_wb',{ascending:true}).limit(1)
  const { data: wbMax } = await supabase.from('dim_sku').select('sku_wb').not('sku_wb','is',null).order('sku_wb',{ascending:false}).limit(1)

  // 6. Примеры с ненулевой выручкой
  const { data: nonZeroSample } = await supabase
    .from('fact_sku_daily')
    .select('sku_ms, metric_date, revenue, ad_spend, ctr')
    .gt('revenue', 0)
    .limit(3)

  // 7. Уникальные даты
  const { data: skuDailyDates } = await supabase
    .from('fact_sku_daily')
    .select('metric_date')
    .order('metric_date', { ascending: false })
    .limit(10)

  // 8. Последняя snap_date
  const { data: maxSnapRow } = await supabase
    .from('fact_sku_daily')
    .select('snap_date')
    .not('snap_date', 'is', null)
    .order('snap_date', { ascending: false })
    .limit(1)

  return NextResponse.json({
    tables: {
      dim_sku: dimCount.count,
      fact_abc: abcCount.count,
      fact_china_supply: chinaCount.count,
      fact_sku_daily: skuDailyCount.count,
      fact_price_changes: priceCount.count,
    },
    latest_uploads: latestByType,
    latest_snap_date: maxSnapRow?.[0]?.snap_date ?? null,
    sku_daily_sample: skuDailySample,
    sku_daily_non_zero: nonZeroSample,
    sku_daily_dates: skuDailyDates,
    dim_sample: dimSample,
    sku_mapping_check: {
      fact_sku_daily_skus_sample: [...skuDailySet].slice(0, 5),
      dim_sku_with_wb_sample: (dimSkus ?? []).slice(0, 5),
      intersection_count: intersection.length,
      intersection_sample: intersection.slice(0, 5),
      dim_sku_wb_range: { min: wbMin?.[0]?.sku_wb, max: wbMax?.[0]?.sku_wb },
    },
  })
}

export async function POST(req: Request) {
  const supabase = createServiceClient()
  const { action } = await req.json()

  if (action === 'cleanup_numeric_sku_daily') {
    const { error: e1, count: c1 } = await supabase
      .from('fact_sku_daily')
      .delete({ count: 'exact' })
      .filter('sku_ms', 'match', '^[0-9]+$')
    if (e1) return NextResponse.json({ error: e1.message }, { status: 500 })
    return NextResponse.json({ ok: true, deleted_daily: c1 })
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}
