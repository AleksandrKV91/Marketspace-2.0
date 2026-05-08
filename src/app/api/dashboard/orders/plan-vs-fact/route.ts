import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/supabase/fetchAll'

export const maxDuration = 30

const MONTH_RU = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек']

// План vs Факт по месяцам — всё в рублях:
//   plan_rub = Σ (plan_qty_месяц × avg_price из fact_china_supply)
//   fact_rub = Σ (fact_sku_daily.revenue) за тот же месяц
// Показываем только месяцы, где есть план или факт > 0.
export async function GET() {
  const supabase = createServiceClient()

  const { data: lastUploads } = await supabase
    .from('uploads')
    .select('id, file_type')
    .eq('file_type', 'china')
    .eq('status', 'ok')
    .order('uploaded_at', { ascending: false })
    .limit(1)
  const chinaId = lastUploads?.[0]?.id

  type Plan = {
    plan_jan: number | null; plan_feb: number | null; plan_mar: number | null
    plan_apr: number | null; plan_may: number | null; plan_jun: number | null
    plan_jul: number | null; plan_aug: number | null; plan_sep: number | null
    plan_oct: number | null; plan_nov: number | null; plan_dec: number | null
    avg_price: number | null
  }
  const planRubByMonth: Record<string, number> = {}  // YYYY-MM → ₽

  if (chinaId) {
    const planRows = await fetchAll<Plan>(
      (sb) => sb.from('fact_china_supply')
        .select('plan_jan, plan_feb, plan_mar, plan_apr, plan_may, plan_jun, plan_jul, plan_aug, plan_sep, plan_oct, plan_nov, plan_dec, avg_price')
        .eq('upload_id', chinaId),
      supabase,
    )
    const year = new Date().getFullYear()
    const planFields: Array<[keyof Plan, string]> = [
      ['plan_jan', `${year}-01`], ['plan_feb', `${year}-02`], ['plan_mar', `${year}-03`],
      ['plan_apr', `${year}-04`], ['plan_may', `${year}-05`], ['plan_jun', `${year}-06`],
      ['plan_jul', `${year}-07`], ['plan_aug', `${year}-08`], ['plan_sep', `${year}-09`],
      ['plan_oct', `${year}-10`], ['plan_nov', `${year}-11`], ['plan_dec', `${year}-12`],
    ]
    for (const [k, m] of planFields) {
      let totalRub = 0
      for (const r of planRows) {
        const qty = (r[k] ?? 0) as number
        const price = r.avg_price ?? 0
        totalRub += qty * price
      }
      if (totalRub > 0) planRubByMonth[m] = Math.round(totalRub)
    }
  }

  // Факт: fact_sku_daily.revenue за все плановые месяцы (или последние 9 месяцев)
  const { data: maxRow } = await supabase
    .from('fact_sku_daily')
    .select('metric_date')
    .order('metric_date', { ascending: false })
    .limit(1)
  const maxDate: string | null = maxRow?.[0]?.metric_date ?? null

  const factRubByMonth: Record<string, number> = {}
  if (maxDate) {
    const planMonths = Object.keys(planRubByMonth).sort()
    let fromIso: string
    if (planMonths.length > 0) {
      fromIso = `${planMonths[0]}-01`
    } else {
      const fromDate = new Date(maxDate); fromDate.setMonth(fromDate.getMonth() - 8); fromDate.setDate(1)
      fromIso = fromDate.toISOString().split('T')[0]
    }

    type Row = { metric_date: string; revenue: number | null }
    const rows = await fetchAll<Row>(
      (sb) => sb.from('fact_sku_daily')
        .select('metric_date, revenue')
        .gte('metric_date', fromIso)
        .lte('metric_date', maxDate!)
        .order('metric_date'),
      supabase,
    )
    for (const r of rows) {
      const m = r.metric_date.slice(0, 7)
      factRubByMonth[m] = (factRubByMonth[m] ?? 0) + (r.revenue ?? 0)
    }
  }

  const allMonths = Array.from(new Set([...Object.keys(planRubByMonth), ...Object.keys(factRubByMonth)])).sort()
  const result = allMonths.map(m => {
    const monthNum = parseInt(m.split('-')[1], 10) - 1
    return {
      month: m,
      label: `${MONTH_RU[monthNum]} ${m.split('-')[0].slice(2)}`,
      plan_rub: Math.round(planRubByMonth[m] ?? 0),
      fact_rub: Math.round(factRubByMonth[m] ?? 0),
    }
  })

  return NextResponse.json({ rows: result, latest_date: maxDate })
}
