import { readWorkbook, sheetToRows, norm, toNum, toBool } from './utils'

export interface ABCRow {
  sku_ms: string
  period_month: string
  qty_stock_rub: number | null
  cost: number | null
  revenue: number | null
  chmd: number | null
  ad_spend: number | null
  storage: number | null
  transport: number | null
  chmd_clean: number | null
  profitability: number | null
  revenue_margin: number | null
  tz: number | null
  turnover_days: number | null
  chmd_share: number | null
  abc_class: string | null
  abc_class2: string | null
  novelty_flag: boolean | null
  stock_status: string | null
}

export interface ParseABCResult {
  rows: ABCRow[]
  period_month: string
  rows_parsed: number
  rows_skipped: number
}

const MONTH_MAP: Record<string, string> = {
  'январь': '01', 'февраль': '02', 'март': '03', 'апрель': '04',
  'май': '05', 'июнь': '06', 'июль': '07', 'август': '08',
  'сентябрь': '09', 'октябрь': '10', 'ноябрь': '11', 'декабрь': '12',
}

function detectPeriodMonth(filename: string): string {
  const lower = filename.toLowerCase()
  for (const [ru, num] of Object.entries(MONTH_MAP)) {
    if (lower.includes(ru)) {
      const year = new Date().getFullYear()
      return `${year}-${num}-01`
    }
  }
  // fallback: первое число текущего месяца
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
}

const COL_QUERIES: Array<{ key: keyof ABCRow; queries: string[] }> = [
  { key: 'sku_ms', queries: ['артикул'] },
  { key: 'qty_stock_rub', queries: ['количество'] },
  { key: 'cost', queries: ['себестоимость без ндс'] },
  { key: 'revenue', queries: ['выручка без ндс', 'выручка'] },
  { key: 'chmd', queries: ['чистый маржинальный доход', 'чмд'] },
  { key: 'ad_spend', queries: ['реклама, без ндс', 'реклама без ндс', 'реклама'] },
  { key: 'storage', queries: ['хранение, без ндс', 'хранение без ндс', 'хранение'] },
  { key: 'transport', queries: ['тран расходы', 'транспорт'] },
  { key: 'chmd_clean', queries: ['чмд за минусом', 'чмд чистый'] },
  { key: 'profitability', queries: ['рен-сть чистого чмд', 'рентабельность чистого', 'рентабельность чмд'] },
  { key: 'revenue_margin', queries: ['рен-сть выручки', 'рентабельность выручки'] },
  { key: 'tz', queries: ['тз'] },
  { key: 'turnover_days', queries: ['об тз, дн', 'оборачиваемость'] },
  { key: 'chmd_share', queries: ['доля по чмд'] },
  { key: 'abc_class', queries: ['итоговый класс'] },
  { key: 'abc_class2', queries: ['итоговый класс2', 'класс2'] },
  { key: 'novelty_flag', queries: ['флаг новинки', 'новинка'] },
  { key: 'stock_status', queries: ['статус остатка'] },
]

export function parseABC(buffer: ArrayBuffer, filename = ''): ParseABCResult {
  const wb = readWorkbook(buffer)
  const sheetName = wb.SheetNames.find(n =>
    norm(n).includes('авс расшифровка') ||
    norm(n).includes('abc расшифровка') ||
    norm(n).includes('авс') ||
    norm(n).includes('abc')
  ) ?? wb.SheetNames[0]
  const rows = sheetToRows(wb, sheetName)

  if (rows.length < 2) throw new Error('Файл пустой или неправильный формат')

  const headerRow = rows[0]
  const periodMonth = detectPeriodMonth(filename)

  // Найти колонки
  const colIdx: Partial<Record<keyof ABCRow, number>> = {}
  for (const { key, queries } of COL_QUERIES) {
    for (const q of queries) {
      const idx = headerRow.findIndex(h => norm(h).includes(q))
      if (idx !== -1) { colIdx[key] = idx; break }
    }
  }

  // abc_class2 может называться "Итоговый класс" дважды — берём второе вхождение
  const allClassCols: number[] = []
  headerRow.forEach((h, i) => {
    if (norm(h).includes('итоговый класс')) allClassCols.push(i)
  })
  if (allClassCols.length >= 2) {
    colIdx['abc_class'] = allClassCols[0]
    colIdx['abc_class2'] = allClassCols[1]
  }

  const result: ABCRow[] = []
  let skipped = 0

  for (let ri = 1; ri < rows.length; ri++) {
    const row = rows[ri]
    const skuMsIdx = colIdx['sku_ms'] ?? 0
    const skuMs = String(row[skuMsIdx] ?? '').trim()
    if (!skuMs || skuMs.toLowerCase() === 'итого') { skipped++; continue }

    const get = (key: keyof ABCRow) => {
      const idx = colIdx[key]
      return idx !== undefined ? row[idx] : null
    }

    const noveltyRaw = get('novelty_flag')
    const abcClass2Raw = get('abc_class2')

    result.push({
      sku_ms: skuMs,
      period_month: periodMonth,
      qty_stock_rub: toNum(get('qty_stock_rub')),
      cost: toNum(get('cost')),
      revenue: toNum(get('revenue')),
      chmd: toNum(get('chmd')),
      ad_spend: toNum(get('ad_spend')),
      storage: toNum(get('storage')),
      transport: toNum(get('transport')),
      chmd_clean: toNum(get('chmd_clean')),
      profitability: toNum(get('profitability')),
      revenue_margin: toNum(get('revenue_margin')),
      tz: toNum(get('tz')),
      turnover_days: toNum(get('turnover_days')),
      chmd_share: toNum(get('chmd_share')),
      abc_class: get('abc_class') != null ? String(get('abc_class')).trim() : null,
      abc_class2: abcClass2Raw != null ? String(abcClass2Raw).trim() : null,
      novelty_flag: toBool(noveltyRaw),
      stock_status: get('stock_status') != null ? String(get('stock_status')).trim() : null,
    })
  }

  return { rows: result, period_month: periodMonth, rows_parsed: result.length, rows_skipped: skipped }
}
