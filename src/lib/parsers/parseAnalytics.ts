import { readWorkbook, sheetToRows, norm, toNum, toBool, parseDateVal } from './utils'

export interface AnalyticsRow {
  sku_ms: string
  name: string | null
  sku_wb: number | null
  brand: string | null
  category: string | null
  cost_updated_at: string | null
  status: string | null
  comment: string | null
  supplier: string | null
  country: string | null
  currency: string | null
  target_margin: number | null
  rating: number | null
  reviews_count: number | null
  reviews_last10: string | null
  commission_offer_fbo: number | null
  abc_month: string | null
  abc_daily: string | null
  available_wb: boolean | null
  stock_fbo: number | null
  stock_fbs: number | null
  avg_daily_sales: number | null
  volume_storage: number | null
  cost_price: number | null
  base_logistics: number | null
  volume_l: number | null
  buyout_pct: number | null
  profit_correction: number | null
  commission_fbo: number | null
  commission_fbs: number | null
  defect_pct: number | null
  base_price: number | null
  set_discount_pct: number | null
  price_wb: number | null
  spp: number | null
  price_with_spp: number | null
  rrp: number | null
  promo: string | null
  calc_margin: number | null
  promo_active: boolean | null
  // promo slots 1–7: 5 fields each
  promo_price_1: number | null
  margin_drop_1: number | null
  penalty_1: number | null
  promo_profit_1: number | null
  promo_margin_1: number | null
  promo_price_2: number | null
  margin_drop_2: number | null
  penalty_2: number | null
  promo_profit_2: number | null
  promo_margin_2: number | null
  promo_price_3: number | null
  margin_drop_3: number | null
  penalty_3: number | null
  promo_profit_3: number | null
  promo_margin_3: number | null
  promo_price_4: number | null
  margin_drop_4: number | null
  penalty_4: number | null
  promo_profit_4: number | null
  promo_margin_4: number | null
  promo_price_5: number | null
  margin_drop_5: number | null
  penalty_5: number | null
  promo_profit_5: number | null
  promo_margin_5: number | null
  promo_price_6: number | null
  margin_drop_6: number | null
  penalty_6: number | null
  promo_profit_6: number | null
  promo_margin_6: number | null
  promo_price_7: number | null
  margin_drop_7: number | null
  penalty_7: number | null
  promo_profit_7: number | null
  promo_margin_7: number | null
  desired_margin_fbs: number | null
  new_price: number | null
  new_margin: number | null
  promo_now: boolean | null
  new_discount: number | null
  exact_discounted_price: number | null
  new_base: number | null
  price_change: number | null
  offer_margin: number | null
  unknown_skus: string[]
}

export interface ParseAnalyticsResult {
  rows: AnalyticsRow[]
  rows_parsed: number
  rows_skipped: number
}

// Fixed column indices as specified — the sheet layout is well-known
// We still do header detection for robustness, falling back to positional indices.

const FIXED_COL: Record<keyof Omit<AnalyticsRow, 'unknown_skus'>, number> = {
  name: 0,
  sku_wb: 1,
  brand: 2,
  category: 3,
  sku_ms: 4,
  cost_updated_at: 5,
  status: 6,
  comment: 7,
  supplier: 8,
  country: 9,
  currency: 10,
  target_margin: 11,
  rating: 12,
  reviews_count: 13,
  reviews_last10: 14,
  commission_offer_fbo: 15,
  abc_month: 16,
  abc_daily: 17,
  available_wb: 18,
  stock_fbo: 19,
  stock_fbs: 20,
  avg_daily_sales: 21,
  volume_storage: 22,
  cost_price: 23,
  base_logistics: 24,
  volume_l: 25,
  buyout_pct: 26,
  profit_correction: 27,
  commission_fbo: 28,
  commission_fbs: 29,
  defect_pct: 30,
  base_price: 31,
  set_discount_pct: 32,
  price_wb: 33,
  spp: 34,
  price_with_spp: 35,
  rrp: 36,
  promo: 37,
  calc_margin: 38,
  promo_active: 39,
  // slot 1: 40–44
  promo_price_1: 40,
  margin_drop_1: 41,
  penalty_1: 42,
  promo_profit_1: 43,
  promo_margin_1: 44,
  // slot 2: 45–49
  promo_price_2: 45,
  margin_drop_2: 46,
  penalty_2: 47,
  promo_profit_2: 48,
  promo_margin_2: 49,
  // slot 3: 50–54
  promo_price_3: 50,
  margin_drop_3: 51,
  penalty_3: 52,
  promo_profit_3: 53,
  promo_margin_3: 54,
  // slot 4: 55–59
  promo_price_4: 55,
  margin_drop_4: 56,
  penalty_4: 57,
  promo_profit_4: 58,
  promo_margin_4: 59,
  // slot 5: 60–64
  promo_price_5: 60,
  margin_drop_5: 61,
  penalty_5: 62,
  promo_profit_5: 63,
  promo_margin_5: 64,
  // slot 6: 65–69
  promo_price_6: 65,
  margin_drop_6: 66,
  penalty_6: 67,
  promo_profit_6: 68,
  promo_margin_6: 69,
  // slot 7: 70–74
  promo_price_7: 70,
  margin_drop_7: 71,
  penalty_7: 72,
  promo_profit_7: 73,
  promo_margin_7: 74,
  desired_margin_fbs: 75,
  new_price: 76,
  new_margin: 77,
  promo_now: 78,
  new_discount: 79,
  exact_discounted_price: 80,
  new_base: 81,
  price_change: 82,
  offer_margin: 83,
}

/**
 * Resolve column indices from the actual header row.
 * Falls back to FIXED_COL positional indices when a header can't be matched.
 */
function resolveColumns(headerRow: unknown[]): Record<keyof Omit<AnalyticsRow, 'unknown_skus'>, number> {
  const h = headerRow.map(c => norm(c))

  const find = (queries: string[]): number => {
    for (const q of queries) {
      const idx = h.findIndex(cell => cell.includes(q))
      if (idx !== -1) return idx
    }
    return -1
  }

  // Helper: use detected index if found, otherwise fall through to fixed
  const col = (fixed: number, queries: string[]): number => {
    const detected = find(queries)
    return detected !== -1 ? detected : fixed
  }

  return {
    name:                 col(0,  ['название']),
    sku_wb:               col(1,  ['sku', 'артикул wb', 'баркод']),
    brand:                col(2,  ['бренд']),
    category:             col(3,  ['категория']),
    sku_ms:               col(4,  ['артикул']),
    cost_updated_at:      col(5,  ['дата последнего обновления']),
    status:               col(6,  ['статус']),
    comment:              col(7,  ['комментарий']),
    supplier:             col(8,  ['поставщик']),
    country:              col(9,  ['страна']),
    currency:             col(10, ['валюта']),
    target_margin:        col(11, ['ориент. маржа', 'ориент.маржа', 'ориент маржа']),
    rating:               col(12, ['рейтинг']),
    reviews_count:        col(13, ['количество отзывов']),
    reviews_last10:       col(14, ['последние 10']),
    commission_offer_fbo: col(15, ['комиссия оферты']),
    abc_month:            col(16, ['авс за месяц', 'abc за месяц']),
    abc_daily:            col(17, ['авс ежеднев', 'abc ежеднев']),
    available_wb:         col(18, ['наличие на вб']),
    stock_fbo:            col(19, ['остаток fbo']),
    stock_fbs:            col(20, ['остаток fbs']),
    avg_daily_sales:      col(21, ['среднедневные продажи']),
    volume_storage:       col(22, ['объем с отчета']),
    cost_price:           col(23, ['себестоимость']),
    base_logistics:       col(24, ['логистика базовая']),
    volume_l:             col(25, ['объем, л']),
    buyout_pct:           col(26, ['% выкупа']),
    profit_correction:    col(27, ['корректировка прибыли']),
    commission_fbo:       col(28, ['комиссия fbo']),
    commission_fbs:       col(29, ['комиссия fbs']),
    defect_pct:           col(30, ['% брака']),
    base_price:           col(31, ['базовая цена']),
    set_discount_pct:     col(32, ['установленная скидка']),
    price_wb:             col(33, ['цена на вб']),
    spp:                  col(34, ['спп', 'spp']),
    price_with_spp:       col(35, ['цена с спп']),
    rrp:                  col(36, ['ррц', 'rrц', 'рекоменд']),
    promo:                col(37, ['акция']),
    calc_margin:          col(38, ['расчетная маржа']),
    promo_active:         col(39, ['акционность сейчас']),
    promo_price_1:        col(40, []),
    margin_drop_1:        col(41, []),
    penalty_1:            col(42, []),
    promo_profit_1:       col(43, []),
    promo_margin_1:       col(44, []),
    promo_price_2:        col(45, []),
    margin_drop_2:        col(46, []),
    penalty_2:            col(47, []),
    promo_profit_2:       col(48, []),
    promo_margin_2:       col(49, []),
    promo_price_3:        col(50, []),
    margin_drop_3:        col(51, []),
    penalty_3:            col(52, []),
    promo_profit_3:       col(53, []),
    promo_margin_3:       col(54, []),
    promo_price_4:        col(55, []),
    margin_drop_4:        col(56, []),
    penalty_4:            col(57, []),
    promo_profit_4:       col(58, []),
    promo_margin_4:       col(59, []),
    promo_price_5:        col(60, []),
    margin_drop_5:        col(61, []),
    penalty_5:            col(62, []),
    promo_profit_5:       col(63, []),
    promo_margin_5:       col(64, []),
    promo_price_6:        col(65, []),
    margin_drop_6:        col(66, []),
    penalty_6:            col(67, []),
    promo_profit_6:       col(68, []),
    promo_margin_6:       col(69, []),
    promo_price_7:        col(70, []),
    margin_drop_7:        col(71, []),
    penalty_7:            col(72, []),
    promo_profit_7:       col(73, []),
    promo_margin_7:       col(74, []),
    desired_margin_fbs:   col(75, ['желаемая маржа']),
    new_price:            col(76, ['новая цена']),
    new_margin:           col(77, ['маржа новая']),
    promo_now:            col(78, ['акционность']),
    new_discount:         col(79, ['скидка новая']),
    exact_discounted_price: col(80, ['точная цена']),
    new_base:             col(81, ['новая базовая']),
    price_change:         col(82, ['изменение цены']),
    offer_margin:         col(83, ['маржа по офферте', 'маржа по оферте']),
  }
}

function str(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null
  return String(v).trim() || null
}

function intOrNull(v: unknown): number | null {
  const n = toNum(v)
  return n === null ? null : Math.round(n)
}

export function parseAnalytics(buffer: ArrayBuffer, filename?: string): ParseAnalyticsResult {
  const wb = readWorkbook(buffer)
  const sheetName = wb.SheetNames.find(n =>
    norm(n).includes('аналитика') || norm(n).includes('analytics')
  ) ?? wb.SheetNames[0]

  const rows = sheetToRows(wb, sheetName)
  if (rows.length < 2) throw new Error('Файл пустой или неправильный формат')

  const headerRow = rows[0]
  const colIdx = resolveColumns(headerRow)

  const get = (row: unknown[], key: keyof Omit<AnalyticsRow, 'unknown_skus'>): unknown => {
    const idx = colIdx[key]
    return idx !== undefined && idx >= 0 ? row[idx] : null
  }

  const result: AnalyticsRow[] = []
  let skipped = 0

  for (let ri = 1; ri < rows.length; ri++) {
    const row = rows[ri]
    const skuMs = str(get(row, 'sku_ms'))
    if (!skuMs) { skipped++; continue }

    result.push({
      sku_ms:               skuMs,
      name:                 str(get(row, 'name')),
      sku_wb:               intOrNull(get(row, 'sku_wb')),
      brand:                str(get(row, 'brand')),
      category:             str(get(row, 'category')),
      cost_updated_at:      parseDateVal(get(row, 'cost_updated_at')),
      status:               str(get(row, 'status')),
      comment:              str(get(row, 'comment')),
      supplier:             str(get(row, 'supplier')),
      country:              str(get(row, 'country')),
      currency:             str(get(row, 'currency')),
      target_margin:        toNum(get(row, 'target_margin')),
      rating:               toNum(get(row, 'rating')),
      reviews_count:        intOrNull(get(row, 'reviews_count')),
      reviews_last10:       str(get(row, 'reviews_last10')),
      commission_offer_fbo: toNum(get(row, 'commission_offer_fbo')),
      abc_month:            str(get(row, 'abc_month')),
      abc_daily:            str(get(row, 'abc_daily')),
      available_wb:         toBool(get(row, 'available_wb')),
      stock_fbo:            toNum(get(row, 'stock_fbo')),
      stock_fbs:            toNum(get(row, 'stock_fbs')),
      avg_daily_sales:      toNum(get(row, 'avg_daily_sales')),
      volume_storage:       toNum(get(row, 'volume_storage')),
      cost_price:           toNum(get(row, 'cost_price')),
      base_logistics:       toNum(get(row, 'base_logistics')),
      volume_l:             toNum(get(row, 'volume_l')),
      buyout_pct:           toNum(get(row, 'buyout_pct')),
      profit_correction:    toNum(get(row, 'profit_correction')),
      commission_fbo:       toNum(get(row, 'commission_fbo')),
      commission_fbs:       toNum(get(row, 'commission_fbs')),
      defect_pct:           toNum(get(row, 'defect_pct')),
      base_price:           toNum(get(row, 'base_price')),
      set_discount_pct:     toNum(get(row, 'set_discount_pct')),
      price_wb:             toNum(get(row, 'price_wb')),
      spp:                  toNum(get(row, 'spp')),
      price_with_spp:       toNum(get(row, 'price_with_spp')),
      rrp:                  toNum(get(row, 'rrp')),
      promo:                str(get(row, 'promo')),
      calc_margin:          toNum(get(row, 'calc_margin')),
      promo_active:         toBool(get(row, 'promo_active')),
      promo_price_1:        toNum(get(row, 'promo_price_1')),
      margin_drop_1:        toNum(get(row, 'margin_drop_1')),
      penalty_1:            toNum(get(row, 'penalty_1')),
      promo_profit_1:       toNum(get(row, 'promo_profit_1')),
      promo_margin_1:       toNum(get(row, 'promo_margin_1')),
      promo_price_2:        toNum(get(row, 'promo_price_2')),
      margin_drop_2:        toNum(get(row, 'margin_drop_2')),
      penalty_2:            toNum(get(row, 'penalty_2')),
      promo_profit_2:       toNum(get(row, 'promo_profit_2')),
      promo_margin_2:       toNum(get(row, 'promo_margin_2')),
      promo_price_3:        toNum(get(row, 'promo_price_3')),
      margin_drop_3:        toNum(get(row, 'margin_drop_3')),
      penalty_3:            toNum(get(row, 'penalty_3')),
      promo_profit_3:       toNum(get(row, 'promo_profit_3')),
      promo_margin_3:       toNum(get(row, 'promo_margin_3')),
      promo_price_4:        toNum(get(row, 'promo_price_4')),
      margin_drop_4:        toNum(get(row, 'margin_drop_4')),
      penalty_4:            toNum(get(row, 'penalty_4')),
      promo_profit_4:       toNum(get(row, 'promo_profit_4')),
      promo_margin_4:       toNum(get(row, 'promo_margin_4')),
      promo_price_5:        toNum(get(row, 'promo_price_5')),
      margin_drop_5:        toNum(get(row, 'margin_drop_5')),
      penalty_5:            toNum(get(row, 'penalty_5')),
      promo_profit_5:       toNum(get(row, 'promo_profit_5')),
      promo_margin_5:       toNum(get(row, 'promo_margin_5')),
      promo_price_6:        toNum(get(row, 'promo_price_6')),
      margin_drop_6:        toNum(get(row, 'margin_drop_6')),
      penalty_6:            toNum(get(row, 'penalty_6')),
      promo_profit_6:       toNum(get(row, 'promo_profit_6')),
      promo_margin_6:       toNum(get(row, 'promo_margin_6')),
      promo_price_7:        toNum(get(row, 'promo_price_7')),
      margin_drop_7:        toNum(get(row, 'margin_drop_7')),
      penalty_7:            toNum(get(row, 'penalty_7')),
      promo_profit_7:       toNum(get(row, 'promo_profit_7')),
      promo_margin_7:       toNum(get(row, 'promo_margin_7')),
      desired_margin_fbs:   toNum(get(row, 'desired_margin_fbs')),
      new_price:            toNum(get(row, 'new_price')),
      new_margin:           toNum(get(row, 'new_margin')),
      promo_now:            toBool(get(row, 'promo_now')),
      new_discount:         toNum(get(row, 'new_discount')),
      exact_discounted_price: toNum(get(row, 'exact_discounted_price')),
      new_base:             toNum(get(row, 'new_base')),
      price_change:         toNum(get(row, 'price_change')),
      offer_margin:         toNum(get(row, 'offer_margin')),
      unknown_skus:         [],
    })
  }

  return { rows: result, rows_parsed: result.length, rows_skipped: skipped }
}
