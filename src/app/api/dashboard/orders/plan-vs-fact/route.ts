import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/supabase/fetchAll'

export const maxDuration = 30

const MONTH_RU = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек']

// План vs Факт по месяцам:
//   план — sum(plan_X из последнего fact_china_supply) — все 12 месяцев,
//   факт — sum(fact_sku_daily.sales_qty) за тот же месяц.
// Показываем только месяцы, где есть план или факт > 0.
export async function GET() {
  const supabase = createServiceClient()

  // Последний chinaId
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
  }
  const planByMonth: Record<string, number> = {}  // ISO YYYY-MM → qty

  if (chinaId) {
    const planRows = await fetchAll<Plan>(
      (sb) => sb.from('fact_china_supply')
        .select('plan_jan, plan_feb, plan_mar, plan_apr, plan_may, plan_jun, plan_jul, plan_aug, plan_sep, plan_oct, plan_nov, plan_dec')
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
      let total = 0
      for (const r of planRows) total += (r[k] ?? 0) as number
      if (total > 0) planByMonth[m] = Math.round(total)
    }
  }

  // Факт: fact_sku_daily.sales_qty за последние ~9 месяцев (закрываем все плановые месяцы)
  const { data: maxRow } = await supabase
    .from('fact_sku_daily')
    .select('metric_date')
    .order('metric_date', { ascending: false })
    .limit(1)
  const maxDate: string | null = maxRow?.[0]?.metric_date ?? null

  const factByMonth: Record<string, number> = {}
  if (maxDate) {
    // Считаем диапазон от первого месяца с планом или 9 месяцев назад
    const planMonths = Object.keys(planByMonth).sort()
    let fromIso: string
    if (planMonths.length > 0) {
      fromIso = `${planMonths[0]}-01`
    } else {
      const fromDate = new Date(maxDate); fromDate.setMonth(fromDate.getMonth() - 8); fromDate.setDate(1)
      fromIso = fromDate.toISOString().split('T')[0]
    }

    type Row = { metric_date: string; sales_qty: number | null }
    const rows = await fetchAll<Row>(
      (sb) => sb.from('fact_sku_daily')
        .select('metric_date, sales_qty')
        .gte('metric_date', fromIso)
        .lte('metric_date', maxDate!)
        .order('metric_date'),
      supabase,
    )
    for (const r of rows) {
      const m = r.metric_date.slice(0, 7)  // YYYY-MM
      factByMonth[m] = (factByMonth[m] ?? 0) + (r.sales_qty ?? 0)
    }
  }

  // Объединяем месяцы — только те, где есть либо план либо факт > 0
  const allMonths = Array.from(new Set([...Object.keys(planByMonth), ...Object.keys(factByMonth)])).sort()
  const result = allMonths.map(m => {
    const monthNum = parseInt(m.split('-')[1], 10) - 1
    return {
      month: m,
      label: `${MONTH_RU[monthNum]} ${m.split('-')[0].slice(2)}`,
      plan_qty: Math.round(planByMonth[m] ?? 0),
      fact_qty: Math.round(factByMonth[m] ?? 0),
    }
  })

  return NextResponse.json({ rows: result, latest_date: maxDate })
}
