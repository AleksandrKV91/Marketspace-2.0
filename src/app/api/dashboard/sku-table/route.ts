import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export const maxDuration = 30

export async function GET(req: NextRequest) {
  const supabase = createServiceClient()
  const { searchParams } = new URL(req.url)
  const search = searchParams.get('search') ?? ''

  // Последний upload_id по типам
  const { data: lastUploads } = await supabase
    .from('uploads')
    .select('id, file_type')
    .eq('status', 'ok')
    .order('uploaded_at', { ascending: false })
    .limit(20)

  const latestByType: Record<string, string> = {}
  if (lastUploads) {
    for (const u of lastUploads) {
      if (!latestByType[u.file_type]) latestByType[u.file_type] = u.id
    }
  }

  const skuReportId = latestByType['sku_report']
  const stockId = latestByType['stock']
  const abcId = latestByType['abc']

  // dim_sku — все SKU
  let dimQuery = supabase.from('dim_sku').select('sku_ms, sku_wb, name, brand, supplier, subject_wb')
  if (search) dimQuery = dimQuery.or(`sku_ms.ilike.%${search}%,name.ilike.%${search}%`)
  const { data: dimSkus } = await dimQuery.limit(500)

  if (!dimSkus?.length) return NextResponse.json({ rows: [] })

  const skuList = dimSkus.map(s => s.sku_ms)

  // fact_sku_snapshot (последний)
  const snapshotMap: Record<string, {
    fbo_wb: number; fbs_pushkino: number; fbs_smolensk: number;
    margin_rub: number | null; price: number | null; supply_date: string | null; supply_qty: number | null
  }> = {}
  if (skuReportId) {
    const { data: snapRows } = await supabase
      .from('fact_sku_snapshot')
      .select('sku_ms, fbo_wb, fbs_pushkino, fbs_smolensk, margin_rub, price, supply_date, supply_qty')
      .eq('upload_id', skuReportId)
      .in('sku_ms', skuList)
    if (snapRows) {
      for (const r of snapRows) snapshotMap[r.sku_ms] = r
    }
  }

  // fact_stock_snapshot — цена и маржа из Таблицы остатков (если нет в SKU report)
  const stockSnapMap: Record<string, { price: number | null; margin_pct: number | null; total_stock: number | null }> = {}
  if (stockId) {
    const { data: stockSnaps } = await supabase
      .from('fact_stock_snapshot')
      .select('sku_ms, price, margin_pct, total_stock')
      .eq('upload_id', stockId)
      .not('sku_ms', 'is', null)
    if (stockSnaps) {
      for (const r of stockSnaps) {
        if (r.sku_ms) stockSnapMap[r.sku_ms] = r
      }
    }
  }

  // fact_abc — последний
  const abcMap: Record<string, { abc_class: string | null; profitability: number | null; chmd: number | null; revenue: number | null }> = {}
  if (abcId) {
    const { data: abcRows } = await supabase
      .from('fact_abc')
      .select('sku_ms, abc_class, profitability, chmd, revenue')
      .eq('upload_id', abcId)
      .in('sku_ms', skuList)
    if (abcRows) {
      for (const r of abcRows) abcMap[r.sku_ms] = r
    }
  }

  // fact_sku_daily — последние 5 дней (агрегат)
  const { data: lastDateRow } = await supabase
    .from('fact_sku_daily')
    .select('metric_date')
    .order('metric_date', { ascending: false })
    .limit(1)
  const latestDate = lastDateRow?.[0]?.metric_date

  const dailyMap: Record<string, { ad_spend: number; revenue: number; drr: number }> = {}
  if (latestDate) {
    // Берём последние 5 дат
    const { data: dates5 } = await supabase
      .from('fact_sku_daily')
      .select('metric_date')
      .order('metric_date', { ascending: false })
      .limit(5)
    const dateList = [...new Set((dates5 ?? []).map(d => d.metric_date))]

    const { data: dailyRows } = await supabase
      .from('fact_sku_daily')
      .select('sku_ms, metric_date, ad_spend, revenue')
      .in('metric_date', dateList)
      .in('sku_ms', skuList)

    if (dailyRows) {
      for (const r of dailyRows) {
        if (!dailyMap[r.sku_ms]) dailyMap[r.sku_ms] = { ad_spend: 0, revenue: 0, drr: 0 }
        dailyMap[r.sku_ms].ad_spend += r.ad_spend ?? 0
        dailyMap[r.sku_ms].revenue += r.revenue ?? 0
      }
      for (const sku of Object.keys(dailyMap)) {
        const d = dailyMap[sku]
        d.drr = d.revenue > 0 ? d.ad_spend / d.revenue : 0
      }
    }
  }

  // Сборка строк
  const rows = dimSkus.map(sku => {
    const snap = snapshotMap[sku.sku_ms]
    const stockSnap = stockSnapMap[sku.sku_ms]
    const abc = abcMap[sku.sku_ms]
    const daily = dailyMap[sku.sku_ms]

    const fbo = snap?.fbo_wb ?? 0
    const fbs = (snap?.fbs_pushkino ?? 0) + (snap?.fbs_smolensk ?? 0)
    const totalStock = fbo + fbs || stockSnap?.total_stock ?? 0

    return {
      sku_ms: sku.sku_ms,
      sku_wb: sku.sku_wb,
      name: sku.name,
      brand: sku.brand,
      supplier: sku.supplier,
      subject_wb: sku.subject_wb,
      fbo_wb: fbo,
      fbs: fbs,
      total_stock: totalStock,
      price: snap?.price ?? stockSnap?.price ?? null,
      margin_rub: snap?.margin_rub ?? null,
      margin_pct: stockSnap?.margin_pct ?? null,
      supply_date: snap?.supply_date ?? null,
      supply_qty: snap?.supply_qty ?? null,
      abc_class: abc?.abc_class ?? null,
      profitability: abc?.profitability ?? null,
      revenue_5d: daily?.revenue ?? null,
      ad_spend_5d: daily?.ad_spend ?? null,
      drr_5d: daily?.drr ?? null,
    }
  })

  return NextResponse.json({ rows, latest_date: latestDate })
}
