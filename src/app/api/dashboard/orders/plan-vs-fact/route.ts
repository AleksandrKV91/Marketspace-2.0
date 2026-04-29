import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/supabase/fetchAll'

export const maxDuration = 30

const MONTH_RU = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек']

// План vs Факт по месяцам: план — sum(plan_X из последнего fact_china_supply),
// факт — sum(daily_agg_sku.sales_qty) за тот же месяц.
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
    plan_mar: number | null; plan_apr: number | null; plan_may: number | null
    plan_jun: number | null; plan_jul: number | null; plan_aug: number | null
  }
  const planByMonth: Record<string, number> = {  // ISO YYYY-MM → qty
  }

  if (chinaId) {
    const planRows = await fetchAll<Plan>(
      (sb) => sb.from('fact_china_supply')
        .select('plan_mar, plan_apr, plan_may, plan_jun, plan_jul, plan_aug')
        .eq('upload_id', chinaId),
      supabase,
    )
    // Год берём текущий (план обычно на текущий сезон)
    const year = new Date().getFullYear()
    const planFields: Array<[keyof Plan, string]> = [
      ['plan_mar', `${year}-03`], ['plan_apr', `${year}-04`], ['plan_may', `${year}-05`],
      ['plan_jun', `${year}-06`], ['plan_jul', `${year}-07`], ['plan_aug', `${year}-08`],
    ]
    for (const [k, m] of planFields) {
      let total = 0
      for (const r of planRows) total += (r[k] ?? 0) as number
      planByMonth[m] = Math.round(total)
    }
  }

  // Факт: daily_agg_sku.sales_qty за последние 6 месяцев
  const { data: maxRow } = await supabase
    .from('fact_sku_daily')
    .select('metric_date')
    .order('metric_date', { ascending: false })
    .limit(1)
  const maxDate: string | null = maxRow?.[0]?.metric_date ?? null

  const factByMonth: Record<string, number> = {}
  if (maxDate) {
    const fromDate = new Date(maxDate); fromDate.setMonth(fromDate.getMonth() - 5); fromDate.setDate(1)
    const fromIso = fromDate.toISOString().split('T')[0]

    type Row = { metric_date: string; sales_qty: number | null }
    const rows = await fetchAll<Row>(
      (sb) => sb.from('daily_agg_sku')
        .select('metric_date, sales_qty')
        .gte('metric_date', fromIso)
        .lte('metric_date', maxDate!),
      supabase,
    )
    for (const r of rows) {
      const m = r.metric_date.slice(0, 7)  // YYYY-MM
      factByMonth[m] = (factByMonth[m] ?? 0) + (r.sales_qty ?? 0)
    }
  }

  // Объединяем месяцы
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
