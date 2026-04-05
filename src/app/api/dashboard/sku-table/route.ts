import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export const maxDuration = 30

export async function GET(req: NextRequest) {
  const supabase = createServiceClient()
  const { searchParams } = new URL(req.url)
  const search = (searchParams.get('search') ?? '').trim()

  const { data: lastUploads } = await supabase
    .from('uploads').select('id, file_type').eq('status', 'ok')
    .order('uploaded_at', { ascending: false }).limit(20)
  const latestByType: Record<string, string> = {}
  if (lastUploads) for (const u of lastUploads) {
    if (!latestByType[u.file_type]) latestByType[u.file_type] = u.id
  }

  const stockId = latestByType['stock']
  const abcId = latestByType['abc']
  const skuReportId = latestByType['sku_report']

  let dimQuery = supabase.from('dim_sku')
    .select('sku_ms, sku_wb, name, brand, supplier, subject_wb, category_wb')
  if (search) dimQuery = dimQuery.or(`name.ilike.%${search}%,sku_ms.ilike.%${search}%,brand.ilike.%${search}%`)
  const { data: dimRows } = await dimQuery.limit(500)
  if (!dimRows?.length) return NextResponse.json({ rows: [] })

  const skuMsList = dimRows.map(r => r.sku_ms)
  const wbList = dimRows.map(r => r.sku_wb).filter((v): v is number => v !== null)

  const [stockRes, abcRes, skuSnapRes] = await Promise.all([
    stockId && wbList.length ? supabase.from('fact_stock_snapshot')
      .select('sku_wb, sku_ms, fbo_wb, fbs_pushkino, fbs_smolensk, total_stock, price, margin_pct, supply_date, supply_qty')
      .eq('upload_id', stockId).in('sku_wb', wbList) : Promise.resolve({ data: null }),
    abcId ? supabase.from('fact_abc')
      .select('sku_ms, abc_class, profitability, chmd, revenue, turnover_days')
      .eq('upload_id', abcId).in('sku_ms', skuMsList) : Promise.resolve({ data: null }),
    skuReportId ? supabase.from('fact_sku_snapshot')
      .select('sku_ms, fbo_wb, fbs_pushkino, fbs_smolensk, margin_rub, price, supply_date, supply_qty, stock_days, novelty_status, manager')
      .eq('upload_id', skuReportId).in('sku_ms', skuMsList) : Promise.resolve({ data: null }),
  ])

  const stockByWb: Record<number, { fbo_wb: number; fbs_pushkino: number; fbs_smolensk: number; total_stock: number; price: number | null; margin_pct: number | null; supply_date: string | null; supply_qty: number | null }> = {}
  if (stockRes.data) for (const r of stockRes.data) stockByWb[r.sku_wb] = r

  const abcByMs: Record<string, { abc_class: string | null; profitability: number | null; chmd: number | null; revenue: number | null; turnover_days: number | null }> = {}
  if (abcRes.data) for (const r of abcRes.data) abcByMs[r.sku_ms] = r

  const snapByMs: Record<string, { fbo_wb: number | null; fbs_pushkino: number | null; fbs_smolensk: number | null; margin_rub: number | null; price: number | null; supply_date: string | null; supply_qty: number | null; stock_days: number | null; novelty_status: string | null; manager: string | null }> = {}
  if (skuSnapRes.data) for (const r of skuSnapRes.data) snapByMs[r.sku_ms] = r

  const rows = dimRows.map(sku => {
    const wb = sku.sku_wb ?? 0
    const stockSnap = stockByWb[wb]
    const skuSnap = snapByMs[sku.sku_ms]
    const abc = abcByMs[sku.sku_ms]

    const fbo = skuSnap?.fbo_wb ?? stockSnap?.fbo_wb ?? 0
    const fbsPushkino = skuSnap?.fbs_pushkino ?? stockSnap?.fbs_pushkino ?? 0
    const fbsSmolensk = skuSnap?.fbs_smolensk ?? stockSnap?.fbs_smolensk ?? 0
    const fbs = fbsPushkino + fbsSmolensk
    const totalStock = (fbo + fbs) || (stockSnap?.total_stock ?? 0)
    const marginPct = stockSnap?.margin_pct ?? null

    let score = 0
    if (marginPct !== null) score += Math.min(30, Math.round(marginPct * 150))
    if (abc?.abc_class === 'A') score += 30
    else if (abc?.abc_class === 'B') score += 20
    else if (abc?.abc_class === 'C') score += 10
    if (totalStock > 0) score += 20
    score = Math.min(100, Math.max(0, score))
    if (totalStock === 0) score = Math.max(0, score - 20)

    const status = totalStock === 0 ? 'oos' : totalStock < 30 ? 'warning' : 'ok'

    const marginPctVal = marginPct ?? 0
    const oos_status: 'critical' | 'warning' | 'ok' | 'none' =
      totalStock === 0 ? 'critical' : totalStock < 30 ? 'warning' : 'ok'
    const margin_status: 'high' | 'medium' | 'low' =
      marginPctVal > 0.20 ? 'high' : marginPctVal > 0.10 ? 'medium' : 'low'

    const stockDays = skuSnap?.stock_days ?? null
    const drr = null as number | null

    return {
      sku: String(wb || sku.sku_ms),
      name: sku.name ?? '',
      manager: skuSnap?.manager ?? '',
      category: sku.category_wb ?? sku.subject_wb ?? '',
      revenue: abc?.revenue ?? 0,
      margin_pct: marginPctVal,
      chmd: abc?.chmd ?? 0,
      drr,
      ctr: null as number | null,
      cr_basket: null as number | null,
      cr_order: null as number | null,
      stock_qty: totalStock,
      stock_days: stockDays ?? 0,
      cpo: null as number | null,
      score,
      oos_status,
      margin_status,
      novelty: skuSnap?.novelty_status === 'new',
    }
  })

  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0)

  return NextResponse.json({
    rows,
    total: rows.length,
    selected_count: rows.length,
    selected_revenue: totalRevenue,
  })
}
