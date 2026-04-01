import { readWorkbook, sheetToRows, norm, toNum, excelToISO } from './utils'

export interface ChinaRow {
  sku_ms: string
  plan_mar: number | null
  plan_apr: number | null
  plan_may: number | null
  plan_jun: number | null
  plan_jul: number | null
  plan_aug: number | null
  reserve_15d: number | null
  buyout_pct_wb: number | null
  marketing_pct: number | null
  cost_plan: number | null
  cost_change_pct: number | null
  avg_price: number | null
  in_transit: number | null
  in_production: number | null
  nearest_date: string | null
  order_qty: number | null
  order_sum_cost: number | null
  rating: number | null
}

export interface ParseChinaResult {
  rows: ChinaRow[]
  rows_parsed: number
  rows_skipped: number
}

const COL_QUERIES: Array<{ key: keyof ChinaRow; queries: string[] }> = [
  { key: 'sku_ms', queries: ['артикул склада', 'артикул'] },
  { key: 'plan_mar', queries: ['март'] },
  { key: 'plan_apr', queries: ['апрель'] },
  { key: 'plan_may', queries: ['май'] },
  { key: 'plan_jun', queries: ['июнь'] },
  { key: 'plan_jul', queries: ['июль'] },
  { key: 'plan_aug', queries: ['август'] },
  { key: 'reserve_15d', queries: ['запас 15'] },
  { key: 'buyout_pct_wb', queries: ['% выкупа на вб', 'выкупа на вб'] },
  { key: 'marketing_pct', queries: ['% маркетинга', 'маркетинга'] },
  { key: 'cost_plan', queries: ['себа план', 'себестоимость план'] },
  { key: 'cost_change_pct', queries: ['%изм себы', '% изм себы', 'изм себы'] },
  { key: 'avg_price', queries: ['ср цена', 'средняя цена'] },
  { key: 'in_transit', queries: ['в пути'] },
  { key: 'in_production', queries: ['в произв', 'в производстве'] },
  { key: 'nearest_date', queries: ['ближайшая дата'] },
  { key: 'order_qty', queries: ['кол-во к заказу', 'количество к заказу'] },
  { key: 'order_sum_cost', queries: ['сумма в себах', 'сумма заказа'] },
  { key: 'rating', queries: ['рейтинг'] },
]

export function parseChina(buffer: ArrayBuffer): ParseChinaResult {
  const wb = readWorkbook(buffer)
  const sheetName = wb.SheetNames.find(n => norm(n) === 'свод') ?? wb.SheetNames[0]
  const rows = sheetToRows(wb, sheetName)

  // Структура: строка 0 пустая, строка 1 пустая, строка 2 = заголовки, строка 3+ = данные
  const HEADER_ROW = 2
  const DATA_START = 3

  if (rows.length <= DATA_START) throw new Error('Файл пустой или неправильный формат')

  const headerRow = rows[HEADER_ROW]

  // Найти первый блок WB (до второго вхождения 'март')
  const martIndices: number[] = []
  headerRow.forEach((h, i) => {
    if (norm(h) === 'март') martIndices.push(i)
  })
  const wbBlockEnd = martIndices.length >= 2 ? martIndices[1] : headerRow.length

  // Найти колонки только в пределах WB блока
  const colIdx: Partial<Record<keyof ChinaRow, number>> = {}
  for (const { key, queries } of COL_QUERIES) {
    for (const q of queries) {
      const idx = headerRow.findIndex((h, i) => i < wbBlockEnd && norm(h).includes(q))
      if (idx !== -1) { colIdx[key] = idx; break }
    }
  }

  const result: ChinaRow[] = []
  let skipped = 0

  for (let ri = DATA_START; ri < rows.length; ri++) {
    const row = rows[ri]
    const skuMsIdx = colIdx['sku_ms'] ?? 0
    const skuMs = String(row[skuMsIdx] ?? '').trim()
    if (!skuMs || skuMs.toLowerCase() === 'итого') { skipped++; continue }

    const get = (key: keyof ChinaRow) => {
      const idx = colIdx[key]
      return idx !== undefined ? row[idx] : null
    }

    const nearestDateRaw = get('nearest_date')
    let nearestDate: string | null = null
    if (nearestDateRaw) {
      if (typeof nearestDateRaw === 'number') {
        nearestDate = excelToISO(nearestDateRaw)
      } else {
        const s = String(nearestDateRaw).trim()
        if (/\d{2}\.\d{2}\.\d{4}/.test(s)) {
          const [d, m, y] = s.split('.')
          nearestDate = `${y}-${m}-${d}`
        } else {
          nearestDate = s || null
        }
      }
    }

    result.push({
      sku_ms: skuMs,
      plan_mar: toNum(get('plan_mar')),
      plan_apr: toNum(get('plan_apr')),
      plan_may: toNum(get('plan_may')),
      plan_jun: toNum(get('plan_jun')),
      plan_jul: toNum(get('plan_jul')),
      plan_aug: toNum(get('plan_aug')),
      reserve_15d: toNum(get('reserve_15d')),
      buyout_pct_wb: toNum(get('buyout_pct_wb')),
      marketing_pct: toNum(get('marketing_pct')),
      cost_plan: toNum(get('cost_plan')),
      cost_change_pct: toNum(get('cost_change_pct')),
      avg_price: toNum(get('avg_price')),
      in_transit: toNum(get('in_transit')),
      in_production: toNum(get('in_production')),
      nearest_date: nearestDate,
      order_qty: toNum(get('order_qty')),
      order_sum_cost: toNum(get('order_sum_cost')),
      rating: toNum(get('rating')),
    })
  }

  return { rows: result, rows_parsed: result.length, rows_skipped: skipped }
}
