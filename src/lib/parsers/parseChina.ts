import { readWorkbook, sheetToRows, norm, toNum, excelToISO } from './utils'

export interface ChinaRow {
  sku_ms: string
  plan_jan: number | null
  plan_feb: number | null
  plan_mar: number | null
  plan_apr: number | null
  plan_may: number | null
  plan_jun: number | null
  plan_jul: number | null
  plan_aug: number | null
  plan_sep: number | null
  plan_oct: number | null
  plan_nov: number | null
  plan_dec: number | null
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
  lead_time_days: number | null
}

export interface NomenRow {
  sku_ms: string | null
  sku_wb: number | null
  brand: string | null
  name: string | null
  seasonality: string | null
  country: string | null
}

export interface ParseChinaResult {
  rows: ChinaRow[]
  nomen: NomenRow[]
  rows_parsed: number
  rows_skipped: number
}

const COL_QUERIES: Array<{ key: keyof ChinaRow; queries: string[] }> = [
  { key: 'sku_ms', queries: ['артикул склада'] },
  { key: 'plan_jan', queries: ['январь', 'январ'] },
  { key: 'plan_feb', queries: ['февраль', 'феврал'] },
  { key: 'plan_mar', queries: ['март'] },
  { key: 'plan_apr', queries: ['апрель', 'апрел'] },
  { key: 'plan_may', queries: ['май'] },
  { key: 'plan_jun', queries: ['июнь', 'июн'] },
  { key: 'plan_jul', queries: ['июль', 'июл'] },
  { key: 'plan_aug', queries: ['август'] },
  { key: 'plan_sep', queries: ['сентябрь', 'сентяб'] },
  { key: 'plan_oct', queries: ['октябрь', 'октяб'] },
  { key: 'plan_nov', queries: ['ноябрь', 'нояб'] },
  { key: 'plan_dec', queries: ['декабрь', 'декаб'] },
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

/** Читает лог. плечо из вкладки «Зеленка» — колонка «Лог. плечо, дн», ключ — «Артикул склада».
 * В новом формате SKU находится в колонке «Артикул» (sku_ms — текст вида CLASSMARK_...),
 * а не «Артикул WB» (число). Поэтому ищем точное совпадение, не partial. */
function parseLeadTimes(wb: import('xlsx').WorkBook): Map<string, number> {
  const sheetName = wb.SheetNames.find(n => norm(n).includes('зеленк'))
  if (!sheetName) return new Map()
  const rows = sheetToRows(wb, sheetName)
  if (rows.length < 2) return new Map()

  let headerIdx = 0
  for (let i = 0; i < Math.min(5, rows.length); i++) {
    if (rows[i].some(h => norm(h).includes('артикул'))) { headerIdx = i; break }
  }
  const header = rows[headerIdx]
  // Приоритет: 'артикул склада' (точное), затем 'артикул' (точное, без 'wb'/'китай'/etc).
  // Старый partial-include подхватывал 'Артикул WB' (sku_wb число) — это баг.
  let skuCol = header.findIndex(h => norm(h) === 'артикул склада')
  if (skuCol === -1) skuCol = header.findIndex(h => norm(h) === 'артикул')
  const leadCol = header.findIndex(h => norm(h).includes('лог') && norm(h).includes('плечо'))
  if (skuCol === -1 || leadCol === -1) return new Map()

  const result = new Map<string, number>()
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i]
    const sku = String(row[skuCol] ?? '').trim()
    const lt = toNum(row[leadCol])
    if (sku && lt != null && lt > 0) result.set(sku, lt)
  }
  return result
}

/** Парсит лист «номен» — мастер-справочник SKU */
function parseNomenSheet(wb: import('xlsx').WorkBook): NomenRow[] {
  const sheetName = wb.SheetNames.find(n => norm(n) === 'номен')
  if (!sheetName) return []
  const rows = sheetToRows(wb, sheetName)
  if (rows.length < 2) return []

  // Find header row (first row containing 'артикул')
  let headerIdx = 0
  for (let i = 0; i < Math.min(5, rows.length); i++) {
    if (rows[i].some(h => norm(h).includes('артикул'))) { headerIdx = i; break }
  }
  const header = rows[headerIdx]

  const fc = (q: string) => header.findIndex(h => norm(String(h ?? '')).includes(q))
  const skuMsCol    = fc('артикул мс')
  const skuWbCol    = fc('артикул wb')
  const brandCol    = fc('бренд')
  const nameCol     = (() => {
    // Try specific names first, then fall back to generic 'наименование'
    const idx = fc('наименование русское')
    return idx !== -1 ? idx : fc('наименование')
  })()
  const seasonCol   = fc('сезонность')
  const countryCol  = fc('страна происхождения')

  if (skuMsCol === -1) return []

  return rows.slice(headerIdx + 1)
    .map(row => ({
      sku_ms:      skuMsCol  !== -1 ? (String(row[skuMsCol]  ?? '').trim() || null) : null,
      sku_wb:      skuWbCol  !== -1 ? toNum(row[skuWbCol])  : null,
      brand:       brandCol  !== -1 ? (String(row[brandCol]  ?? '').trim() || null) : null,
      name:        nameCol   !== -1 ? (String(row[nameCol]   ?? '').trim() || null) : null,
      seasonality: seasonCol !== -1 ? (String(row[seasonCol] ?? '').trim() || null) : null,
      country:     countryCol !== -1 ? (String(row[countryCol] ?? '').trim() || null) : null,
    }))
    .filter(r => r.sku_ms)
}

/** Auto-detect строку заголовков. Поддерживает старый формат (header на row 2) и
 * новый (header на row 0). Ищем строку, где есть «артикул склада» И хотя бы один
 * месяц (январь..декабрь) — это надёжный признак шапки СВОД-листа. */
function findHeaderRow(rows: unknown[][]): number {
  const monthRe = /^(январ|феврал|март|апрел|май|июн|июл|август|сентяб|октяб|нояб|декаб)/
  for (let i = 0; i < Math.min(6, rows.length); i++) {
    const cells = rows[i].map(h => norm(h))
    const hasSku = cells.some(h => h.includes('артикул склада'))
    const hasMonth = cells.some(h => monthRe.test(h))
    if (hasSku && hasMonth) return i
  }
  return -1
}

export function parseChina(buffer: ArrayBuffer): ParseChinaResult {
  const wb = readWorkbook(buffer)
  const sheetName = wb.SheetNames.find(n => norm(n) === 'свод') ?? wb.SheetNames[0]
  const rows = sheetToRows(wb, sheetName)
  const leadTimes = parseLeadTimes(wb)
  const nomen = parseNomenSheet(wb)

  // Auto-detect строку заголовков. Старый формат: header=row2 / data=row3.
  // Новый формат: header=row0 / data=row1.
  const HEADER_ROW = findHeaderRow(rows)
  if (HEADER_ROW < 0) throw new Error('Не найдена шапка с «Артикул склада» и месяцем (январь..декабрь)')
  const DATA_START = HEADER_ROW + 1

  if (rows.length <= DATA_START) throw new Error('Файл пустой или неправильный формат')

  const headerRow = rows[HEADER_ROW]

  // В старом формате колонки месяцев могли дублироваться (WB-блок + ОЗ-блок).
  // Если есть ≥2 одинаковых названий месяцев — берём только первый блок.
  // Эвристика: если 'март' встречается 2+ раз — отрезаем по второму вхождению.
  // В новом формате отрезка нет (месяцы апр-сен уникальны).
  const monthCounts: Record<string, number[]> = {}
  headerRow.forEach((h, i) => {
    const n = norm(h)
    if (!monthCounts[n]) monthCounts[n] = []
    monthCounts[n].push(i)
  })
  let wbBlockEnd = headerRow.length
  for (const m of ['март', 'апрель', 'апрел']) {
    if (monthCounts[m] && monthCounts[m].length >= 2) {
      wbBlockEnd = monthCounts[m][1]
      break
    }
  }

  // Список ключей, которые относятся к плановым месяцам — для них применяем cutoff wbBlockEnd
  // (берём только первый блок месяцев, без дублирующихся OZ/общих).
  const monthKeys = new Set<keyof ChinaRow>([
    'plan_jan','plan_feb','plan_mar','plan_apr','plan_may','plan_jun',
    'plan_jul','plan_aug','plan_sep','plan_oct','plan_nov','plan_dec',
  ])
  const colIdx: Partial<Record<keyof ChinaRow, number>> = {}
  for (const { key, queries } of COL_QUERIES) {
    const isMonthKey = monthKeys.has(key)
    for (const q of queries) {
      // Месяцы: точное совпадение или startsWith ('январ' матчит 'январь', но не наоборот),
      // и cutoff по wbBlockEnd чтобы не подхватить второй блок (OZ).
      // Остальные поля ('себа план', 'кол-во к заказу' и т.п.): partial include по всей строке.
      const idx = headerRow.findIndex((h, i) => {
        if (isMonthKey && i >= wbBlockEnd) return false
        const n = norm(h)
        return isMonthKey ? (n === q || n.startsWith(q)) : n.includes(q)
      })
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
      plan_jan: toNum(get('plan_jan')),
      plan_feb: toNum(get('plan_feb')),
      plan_mar: toNum(get('plan_mar')),
      plan_apr: toNum(get('plan_apr')),
      plan_may: toNum(get('plan_may')),
      plan_jun: toNum(get('plan_jun')),
      plan_jul: toNum(get('plan_jul')),
      plan_aug: toNum(get('plan_aug')),
      plan_sep: toNum(get('plan_sep')),
      plan_oct: toNum(get('plan_oct')),
      plan_nov: toNum(get('plan_nov')),
      plan_dec: toNum(get('plan_dec')),
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
      lead_time_days: leadTimes.get(skuMs) ?? null,
    })
  }

  return { rows: result, nomen, rows_parsed: result.length, rows_skipped: skipped }
}
