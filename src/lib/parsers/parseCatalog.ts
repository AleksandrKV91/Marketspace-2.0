import { readWorkbook, sheetToRows, norm, toNum } from './utils'

export interface CatalogRow {
  sku_ms: string
  sku_wb: number | null
  name: string | null           // Краткое внутреннее название (колонка «Название» в Своде)
  full_name: string | null      // Полное название для WB карточки (колонка «Номенклатура»)
  brand: string | null
  supplier: string | null
  country: string | null
  subject_wb: string | null
  category_wb: string | null
  nds_pct: number | null
  market_share: number | null
  niche_appeal: number | null
  availability: string | null
  buyout_pct: number | null
  avg_rating: number | null
  seasonality: string | null
  season_start: string | null
  season_length: number | null
  top_month: string | null
  top_phrase: string | null
  month_jan: number | null
  month_feb: number | null
  month_mar: number | null
  month_apr: number | null
  month_may: number | null
  month_jun: number | null
  month_jul: number | null
  month_aug: number | null
  month_sep: number | null
  month_oct: number | null
  month_nov: number | null
  month_dec: number | null
}

export interface ParseCatalogResult {
  rows: CatalogRow[]
  rows_parsed: number
  rows_skipped: number
}

const MONTH_KEYS = [
  'month_jan', 'month_feb', 'month_mar', 'month_apr',
  'month_may', 'month_jun', 'month_jul', 'month_aug',
  'month_sep', 'month_oct', 'month_nov', 'month_dec',
] as const

const MONTH_NAMES = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
]

// Колонки с единственным маппингом (первый найденный побеждает)
const COL_MAP: Record<string, keyof CatalogRow> = {
  'артикул wb': 'sku_wb',
  'артикул мс': 'sku_ms',       // Артикул МС — ключ для метрик
  'артикул mc': 'sku_ms',       // латинская c
  'артикул склада': 'sku_ms',   // синоним (поддержка старых файлов)
  'название': 'name',           // Краткое название для дашборда
  'номенклатура': 'full_name',  // Полное название для WB карточки
  'бренд': 'brand',
  'поставщик': 'supplier',
  'страна': 'country',
  'предмет wb': 'subject_wb',
  'категория wb': 'category_wb',
  'ндс, %': 'nds_pct',
  'доля рынка': 'market_share',
  'привлекательность ниши': 'niche_appeal',
  'доступность': 'availability',
  'процент выкупа': 'buyout_pct',
  'средний рейтинг': 'avg_rating',
  'сезонность': 'seasonality',
  'старт сезона': 'season_start',
  'длина сезона': 'season_length',
  'топ месяц': 'top_month',
  'топ-фраза по объёму': 'top_phrase',
  'топ-фраза': 'top_phrase',
}

export function parseCatalog(buffer: ArrayBuffer): ParseCatalogResult {
  const wb = readWorkbook(buffer)
  const sheetName = wb.SheetNames.find(n => norm(n).includes('свод')) ?? wb.SheetNames[0]
  const rows = sheetToRows(wb, sheetName)

  if (rows.length < 2) throw new Error('Файл пустой или неправильный формат')

  const headerRow = rows[0]
  const colIdx: Record<string, number> = {}

  for (const [colName, field] of Object.entries(COL_MAP)) {
    if (colIdx[field] !== undefined) continue  // первый найденный побеждает
    const idx = headerRow.findIndex(h => norm(h) === colName)
    if (idx !== -1) colIdx[field] = idx
  }

  const monthColIdx: Record<string, number> = {}
  headerRow.forEach((h, i) => {
    const n = norm(h)
    const mIdx = MONTH_NAMES.indexOf(n)
    if (mIdx !== -1) monthColIdx[MONTH_KEYS[mIdx]] = i
  })

  const result: CatalogRow[] = []
  let skipped = 0

  for (let ri = 1; ri < rows.length; ri++) {
    const row = rows[ri]
    const skuMs = String(row[colIdx['sku_ms']] ?? '').trim()
    if (!skuMs) { skipped++; continue }

    const str = (field: string) => {
      const v = row[colIdx[field]]
      return v != null ? String(v).trim() || null : null
    }

    const entry: CatalogRow = {
      sku_ms: skuMs,
      sku_wb: toNum(row[colIdx['sku_wb']]) || null,
      name: str('name'),
      full_name: str('full_name'),
      brand: str('brand'),
      supplier: str('supplier'),
      country: str('country'),
      subject_wb: str('subject_wb'),
      category_wb: str('category_wb'),
      nds_pct: toNum(row[colIdx['nds_pct']]) || null,
      market_share: toNum(row[colIdx['market_share']]) || null,
      niche_appeal: toNum(row[colIdx['niche_appeal']]) || null,
      availability: str('availability'),
      buyout_pct: toNum(row[colIdx['buyout_pct']]) || null,
      avg_rating: toNum(row[colIdx['avg_rating']]) || null,
      seasonality: str('seasonality'),
      season_start: str('season_start'),
      season_length: toNum(row[colIdx['season_length']]) || null,
      top_month: str('top_month'),
      top_phrase: str('top_phrase'),
      month_jan: null, month_feb: null, month_mar: null, month_apr: null,
      month_may: null, month_jun: null, month_jul: null, month_aug: null,
      month_sep: null, month_oct: null, month_nov: null, month_dec: null,
    }

    for (const key of MONTH_KEYS) {
      if (monthColIdx[key] !== undefined) {
        entry[key] = toNum(row[monthColIdx[key]]) || null
      }
    }

    result.push(entry)
  }

  return { rows: result, rows_parsed: result.length, rows_skipped: skipped }
}
