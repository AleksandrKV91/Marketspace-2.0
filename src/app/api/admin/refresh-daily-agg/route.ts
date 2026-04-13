import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/supabase/fetchAll'
import { invalidate } from '@/lib/cache'

export const maxDuration = 60

// POST /api/admin/refresh-daily-agg
// Body (optional): { from?: string; to?: string }  — пересчитать только указанный диапазон дат
// Без body — пересчитывает всю таблицу целиком

export async function POST(req: NextRequest) {
  const supabase = createServiceClient()
  const body = await req.json().catch(() => ({}))
  const fromParam: string | undefined = body.from
  const toParam: string | undefined = body.to

  // 1. Latest SKU report upload ID
  const { data: lastUploads } = await supabase
    .from('uploads').select('id, file_type')
    .eq('status', 'ok').order('uploaded_at', { ascending: false }).limit(20)
  const latestByType: Record<string, string> = {}
  if (lastUploads) for (const u of lastUploads) {
    if (!latestByType[u.file_type]) latestByType[u.file_type] = u.id
  }
  const skuRepId = latestByType['sku_report']
  if (!skuRepId) return NextResponse.json({ error: 'No sku_report upload found' }, { status: 400 })

  // 2. fact_sku_snapshot — margin_pct и price по SKU (из последнего отчёта)
  type SnapRow = { sku_ms: string; margin_pct: number | null; price: number | null }
  const snapRows = await fetchAll<SnapRow>(
    (sb) => sb.from('fact_sku_snapshot')
      .select('sku_ms, margin_pct, price')
      .eq('upload_id', skuRepId),
    supabase,
  )
  const snapMap: Record<string, SnapRow> = {}
  for (const r of snapRows) snapMap[r.sku_ms] = r

  // 3. dim_sku — категории и предметы
  type DimRow = { sku_ms: string; category_wb: string | null; subject_wb: string | null }
  const dimRows = await fetchAll<DimRow>(
    (sb) => sb.from('dim_sku').select('sku_ms, category_wb, subject_wb'),
    supabase,
  )
  const dimMap: Record<string, DimRow> = {}
  for (const r of dimRows) dimMap[r.sku_ms] = r

  // 4. fact_sku_daily — за нужный диапазон
  type DailyRow = {
    sku_ms: string; metric_date: string
    revenue: number | null; ad_spend: number | null
    ctr: number | null; cr_cart: number | null; cr_order: number | null
    cpm: number | null; cpc: number | null; ad_order_share: number | null
  }
  const dailyRows = await fetchAll<DailyRow>(
    (sb) => {
      let q = sb.from('fact_sku_daily')
        .select('sku_ms, metric_date, revenue, ad_spend, ctr, cr_cart, cr_order, cpm, cpc, ad_order_share')
      if (fromParam) q = q.gte('metric_date', fromParam)
      if (toParam) q = q.lte('metric_date', toParam)
      return q
    },
    supabase,
  )

  // 5. Агрегация по (metric_date, category_wb, subject_wb)
  type AggKey = string  // `${date}|${cat}|${subj}`
  type AggBucket = {
    metric_date: string
    category_wb: string
    subject_wb: string
    revenue: number
    ad_spend: number
    margin_rev: number    // Σ(margin_pct × revenue)
    price_rev: number     // Σ(price × revenue)
    ctr_sum: number; ctr_n: number
    cr_cart_sum: number; cr_cart_n: number
    cr_order_sum: number; cr_order_n: number
    cpm_sum: number; cpm_n: number
    cpc_sum: number; cpc_n: number
    ad_share_sum: number; ad_share_n: number
    skus: Set<string>
  }

  const buckets = new Map<AggKey, AggBucket>()

  for (const r of dailyRows) {
    const dim  = dimMap[r.sku_ms]
    const snap = snapMap[r.sku_ms]
    const cat  = dim?.category_wb  ?? ''
    const subj = dim?.subject_wb   ?? ''
    const key: AggKey = `${r.metric_date}|${cat}|${subj}`

    if (!buckets.has(key)) {
      buckets.set(key, {
        metric_date: r.metric_date, category_wb: cat, subject_wb: subj,
        revenue: 0, ad_spend: 0, margin_rev: 0, price_rev: 0,
        ctr_sum: 0, ctr_n: 0,
        cr_cart_sum: 0, cr_cart_n: 0,
        cr_order_sum: 0, cr_order_n: 0,
        cpm_sum: 0, cpm_n: 0,
        cpc_sum: 0, cpc_n: 0,
        ad_share_sum: 0, ad_share_n: 0,
        skus: new Set(),
      })
    }
    const b = buckets.get(key)!
    const rev = r.revenue ?? 0
    const ads = r.ad_spend ?? 0
    const margin = snap?.margin_pct ?? 0
    const price  = snap?.price ?? 0

    b.revenue   += rev
    b.ad_spend  += ads
    b.margin_rev += margin * rev
    b.price_rev  += price * rev
    b.skus.add(r.sku_ms)

    if (r.ctr != null)           { b.ctr_sum += r.ctr; b.ctr_n++ }
    if (r.cr_cart != null)       { b.cr_cart_sum += r.cr_cart; b.cr_cart_n++ }
    if (r.cr_order != null)      { b.cr_order_sum += r.cr_order; b.cr_order_n++ }
    if (r.cpm != null)           { b.cpm_sum += r.cpm; b.cpm_n++ }
    if (r.cpc != null)           { b.cpc_sum += r.cpc; b.cpc_n++ }
    if (r.ad_order_share != null){ b.ad_share_sum += r.ad_order_share; b.ad_share_n++ }
  }

  // 6. Формируем строки для upsert
  type AggRow = {
    metric_date: string; category_wb: string; subject_wb: string
    revenue: number; ad_spend: number; chmd: number
    margin_pct_wgt: number; price_wgt: number; drr: number
    ctr_avg: number | null; cr_cart_avg: number | null; cr_order_avg: number | null
    cpm_avg: number | null; cpc_avg: number | null; ad_order_share: number | null
    cpo: number | null; sku_count: number
  }

  const rows: AggRow[] = []
  for (const b of buckets.values()) {
    const margin_pct_wgt = b.revenue > 0 ? b.margin_rev / b.revenue : 0
    const price_wgt      = b.revenue > 0 ? b.price_rev / b.revenue : 0
    const chmd           = b.revenue * margin_pct_wgt - b.ad_spend
    const drr            = b.revenue > 0 ? b.ad_spend / b.revenue : 0
    const cpo            = price_wgt > 0 && b.ad_spend > 0
      ? b.ad_spend / (b.revenue / price_wgt)
      : null

    rows.push({
      metric_date:    b.metric_date,
      category_wb:    b.category_wb,
      subject_wb:     b.subject_wb,
      revenue:        Math.round(b.revenue),
      ad_spend:       Math.round(b.ad_spend),
      chmd:           Math.round(chmd),
      margin_pct_wgt: +margin_pct_wgt.toFixed(6),
      price_wgt:      +price_wgt.toFixed(2),
      drr:            +drr.toFixed(6),
      ctr_avg:        b.ctr_n > 0 ? +(b.ctr_sum / b.ctr_n).toFixed(6) : null,
      cr_cart_avg:    b.cr_cart_n > 0 ? +(b.cr_cart_sum / b.cr_cart_n).toFixed(6) : null,
      cr_order_avg:   b.cr_order_n > 0 ? +(b.cr_order_sum / b.cr_order_n).toFixed(6) : null,
      cpm_avg:        b.cpm_n > 0 ? +(b.cpm_sum / b.cpm_n).toFixed(2) : null,
      cpc_avg:        b.cpc_n > 0 ? +(b.cpc_sum / b.cpc_n).toFixed(2) : null,
      ad_order_share: b.ad_share_n > 0 ? +(b.ad_share_sum / b.ad_share_n).toFixed(6) : null,
      cpo:            cpo != null ? +cpo.toFixed(2) : null,
      sku_count:      b.skus.size,
    })
  }

  // 7. Если есть диапазон — удаляем старые строки за этот диапазон перед upsert
  if (fromParam && toParam) {
    await supabase.from('fact_daily_agg')
      .delete()
      .gte('metric_date', fromParam)
      .lte('metric_date', toParam)
  } else {
    // Полный пересчёт — очищаем всю таблицу
    await supabase.from('fact_daily_agg').delete().neq('metric_date', '1970-01-01')
  }

  // 8. Upsert батчами по 500
  let upserted = 0
  const errors: string[] = []
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500)
    const { error } = await supabase
      .from('fact_daily_agg')
      .upsert(batch, { onConflict: 'metric_date,category_wb,subject_wb' })
    if (error) errors.push(error.message)
    else upserted += batch.length
  }

  // 9. Инвалидировать кэш после обновления
  invalidate('latest_uploads')

  return NextResponse.json({
    ok: errors.length === 0,
    rows_processed: dailyRows.length,
    agg_rows: rows.length,
    upserted,
    errors: errors.slice(0, 5),
    from: fromParam ?? 'all',
    to: toParam ?? 'all',
  })
}
