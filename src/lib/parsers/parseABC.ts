import { readWorkbook, sheetToRows, norm, toNum, toBool, parseDateVal, excelToISO } from './utils'

export interface ABCRow {
  sku_ms: string
  period_month: string
  product_name: string | null
  niche: string | null
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
  cumulative_chmd: number | null
  chmd_class: string | null
  revenue_class: string | null
  final_class_1: string | null
  profitability_class: string | null
  turnover_class: string | null
  final_class_2: string | null
  created_date: string | null
  time_since_creation: number | null
  qty_cur_month: number | null
  qty_prev_month: number | null
  novelty_flag: boolean | null
  stock_status: string | null
}

export interface ParseABCResult {
  rows: ABCRow[]
  period_month: string
  rows_parsed: number
  rows_skipped: number
  unknown_skus: string[]
}

const MONTH_MAP: Record<string, string> = {
  'январь': '01', 'февраль': '02', 'март': '03', 'апрель': '04',
  'май': '05', 'июнь': '06', 'июль': '07', 'август': '08',
  'сентябрь': '09', 'октябрь': '10', 'ноябрь': '11', 'декабрь': '12',
}

function excelSerialToYearMonth(serial: number): string {
  const date = new Date((serial - 25569) * 86400 * 1000)
  let y = date.getUTCFullYear()
  let m = date.getUTCMonth() + 1  // 1-12
  // Russian ABC reports label qty columns as the 1st of the NEXT month —
  // "количество за январь" → column header date = Feb 1. Step back by one month.
  if (date.getUTCDate() === 1) {
    m--
    if (m === 0) { m = 12; y-- }
  }
  return `${y}-${String(m).padStart(2, '0')}-01`
}

function isExcelDateSerial(v: unknown): v is number {
  return typeof v === 'number' && v >= 40000 && v <= 50000
}

function detectPeriodMonthFromHeaders(headerRow: unknown[]): string | null {
  const dateSerials: number[] = []
  for (let i = 23; i < headerRow.length; i++) {
    if (isExcelDateSerial(headerRow[i])) {
      dateSerials.push(headerRow[i] as number)
    }
  }
  if (dateSerials.length === 0) return null
  const latest = Math.max(...dateSerials)
  return excelSerialToYearMonth(latest)
}

function detectPeriodMonthFromFilename(filename: string): string | null {
  const lower = filename.toLowerCase()
  for (const [ru, num] of Object.entries(MONTH_MAP)) {
    if (lower.includes(ru)) {
      const year = new Date().getFullYear()
      return `${year}-${num}-01`
    }
  }
  const m = lower.match(/(\d{2})\.(\d{2})\.(\d{4})/)
  if (m) return `${m[3]}-${m[2]}-01`
  return null
}

function currentMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
}

function normalizeAbcClass(raw: string): string | null {
  const s = raw.trim()
  if (!s) return null
  if (/^[AaBbCc]{1,2}$/.test(s)) return s.toUpperCase()
  if (s.includes('|')) {
    const parts = s.split('|').map(p => p.trim())
    const left = parts[0].toLowerCase()
    const right = parts[1]?.toLowerCase() ?? ''
    if (left === 'убыток' || left === 'убыт') {
      const cls = right.charAt(0).toUpperCase()
      if ('ABC'.includes(cls)) return `убыток|${cls}`
      return 'убыток'
    }
    const cls = left.charAt(0).toUpperCase()
    if ('ABC'.includes(cls)) return cls
  }
  const first = s.charAt(0).toUpperCase()
  if ('ABC'.includes(first)) return first
  return s
}

type ColKey = keyof ABCRow

const TEXT_COL_QUERIES: Array<{ key: ColKey; queries: string[] }> = [
  { key: 'sku_ms', queries: ['артикул склада', 'артикул мс', 'артикул mc', 'артикул'] },
  { key: 'product_name', queries: ['номенклатура'] },
  { key: 'niche', queries: ['ниша', 'предмет', 'subject'] },
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
  { key: 'turnover_days', queries: ['об тз, дн', 'об тз', 'оборачиваемость'] },
  { key: 'chmd_share', queries: ['доля по чмд'] },
  { key: 'cumulative_chmd', queries: ['кумулятив по чмд'] },
  { key: 'chmd_class', queries: ['класс по чмд'] },
  { key: 'revenue_class', queries: ['класс по выручке'] },
  { key: 'profitability_class', queries: ['класс по рен-сти', 'класс по рентабельности'] },
  { key: 'turnover_class', queries: ['класс по об тз', 'класс по оборачиваемости'] },
  { key: 'created_date', queries: ['дата создания'] },
  { key: 'time_since_creation', queries: ['время с создания'] },
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
  const allRows = sheetToRows(wb, sheetName)

  if (allRows.length < 2) throw new Error('Файл пустой или неправильный формат')

  // Find header row by scanning first 6 rows
  let headerRowIdx = 0
  for (let i = 0; i < Math.min(6, allRows.length); i++) {
    if (allRows[i].some(cell => {
      const s = norm(cell)
      return s.includes('артикул') || s.includes('номенклатура')
    })) {
      headerRowIdx = i
      break
    }
  }

  const headerRow = allRows[headerRowIdx]
  const dataRows = allRows.slice(headerRowIdx + 1)

  // Detect period_month: first try column headers (Excel date serials in col 26/27 relative to header)
  const periodMonth =
    detectPeriodMonthFromHeaders(headerRow) ??
    detectPeriodMonthFromFilename(filename) ??
    currentMonth()

  // Map text-based columns
  const colIdx: Partial<Record<ColKey, number>> = {}
  for (const { key, queries } of TEXT_COL_QUERIES) {
    for (const q of queries) {
      const idx = headerRow.findIndex(h => norm(h).includes(q))
      if (idx !== -1) { colIdx[key] = idx; break }
    }
  }

  // Handle "Итоговый класс" appearing twice (final_class_1 at first occurrence, final_class_2 at second)
  const finalClassCols: number[] = []
  headerRow.forEach((h, i) => {
    if (norm(h).includes('итоговый класс')) finalClassCols.push(i)
  })
  if (finalClassCols.length >= 1) colIdx['final_class_1'] = finalClassCols[0]
  if (finalClassCols.length >= 2) colIdx['final_class_2'] = finalClassCols[1]

  // Detect qty_cur_month and qty_prev_month: first two Excel date serial headers after position 23
  const dateSerialCols: number[] = []
  for (let i = 23; i < headerRow.length; i++) {
    if (isExcelDateSerial(headerRow[i])) dateSerialCols.push(i)
  }
  // Sort descending by serial value so index 0 = later (cur), index 1 = earlier (prev)
  dateSerialCols.sort((a, b) => (headerRow[b] as number) - (headerRow[a] as number))
  if (dateSerialCols.length >= 1) colIdx['qty_cur_month'] = dateSerialCols[0]
  if (dateSerialCols.length >= 2) colIdx['qty_prev_month'] = dateSerialCols[1]

  const result: ABCRow[] = []
  let skipped = 0

  for (const row of dataRows) {
    const skuMsIdx = colIdx['sku_ms'] ?? 1
    const skuMs = String(row[skuMsIdx] ?? '').trim()
    if (!skuMs || skuMs.toLowerCase() === 'итого') { skipped++; continue }

    const get = (key: ColKey) => {
      const idx = colIdx[key]
      return idx !== undefined ? row[idx] : null
    }

    const createdRaw = get('created_date')
    const chmdClassRaw = get('chmd_class')
    const revenueClassRaw = get('revenue_class')
    const final1Raw = get('final_class_1')
    const profClassRaw = get('profitability_class')
    const turnoverClassRaw = get('turnover_class')
    const final2Raw = get('final_class_2')

    result.push({
      sku_ms: skuMs,
      period_month: periodMonth,
      product_name: get('product_name') != null ? String(get('product_name')).trim() || null : null,
      niche: get('niche') != null ? String(get('niche')).trim() || null : null,
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
      cumulative_chmd: toNum(get('cumulative_chmd')),
      chmd_class: chmdClassRaw != null ? normalizeAbcClass(String(chmdClassRaw)) : null,
      revenue_class: revenueClassRaw != null ? normalizeAbcClass(String(revenueClassRaw)) : null,
      final_class_1: final1Raw != null ? normalizeAbcClass(String(final1Raw)) : null,
      profitability_class: profClassRaw != null ? normalizeAbcClass(String(profClassRaw)) : null,
      turnover_class: turnoverClassRaw != null ? normalizeAbcClass(String(turnoverClassRaw)) : null,
      final_class_2: final2Raw != null ? normalizeAbcClass(String(final2Raw)) : null,
      created_date: parseDateVal(createdRaw),
      time_since_creation: toNum(get('time_since_creation')),
      qty_cur_month: toNum(get('qty_cur_month')),
      qty_prev_month: toNum(get('qty_prev_month')),
      novelty_flag: toBool(get('novelty_flag')),
      stock_status: get('stock_status') != null ? String(get('stock_status')).trim() || null : null,
    })
  }

  return { rows: result, period_month: periodMonth, rows_parsed: result.length, rows_skipped: skipped, unknown_skus: [] }
}
