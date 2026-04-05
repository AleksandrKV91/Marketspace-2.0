import { readWorkbook, sheetToRows, norm, toNum, excelToISO, parseDateVal } from './utils'

export interface StockSnapshotRow {
  sku_wb: number
  sku_ms: string | null
  snap_date: string
  fbo_wb: number | null
  fbs_pushkino: number | null
  fbs_smolensk: number | null
  total_stock: number | null
  price: number | null
  margin_pct: number | null
  supply_qty: number | null
  supply_date: string | null
}

export interface StockDailyRow {
  sku_wb: number
  sku_ms: string | null
  sale_date: string
  sales_qty: number | null
}

export interface PriceChangeRow {
  sku_wb: number
  sku_ms: string | null
  price_date: string
  price: number | null
}

export interface ParseStockResult {
  snapshots: StockSnapshotRow[]
  daily: StockDailyRow[]
  price_changes: PriceChangeRow[]
  rows_parsed: number
  rows_skipped: number
}

export function parseStock(
  buffer: ArrayBuffer,
  skuMap: Map<number, string>  // sku_wb → sku_ms из dim_sku
): ParseStockResult {
  const wb = readWorkbook(buffer)
  const sheetName = wb.SheetNames.find(n => norm(n) === 'sheet1') ?? wb.SheetNames[0]
  const rows = sheetToRows(wb, sheetName)

  // Структура: строки 0-4 пустые, строка 5 = заголовки, строка 6+ = данные
  const HEADER_ROW = 5
  const DATA_START = 6

  if (rows.length <= DATA_START) throw new Error('Файл пустой или неправильный формат')

  const headerRow = rows[HEADER_ROW]

  // Найти колонки по заголовку
  // col B (index 1) = SKU (WB артикул числовой)
  const skuWbCol = (() => {
    const idx = headerRow.findIndex(h => norm(h) === 'sku' || norm(h).includes('артикул wb') || norm(h).includes('артикул вб'))
    return idx !== -1 ? idx : 1 // fallback: col B (index 1)
  })()
  const supplyQtyCol = headerRow.findIndex(h => norm(h).includes('кол-во в поставке') || norm(h).includes('поставк') && norm(h).includes('кол'))
  const supplyDateCol = headerRow.findIndex(h => norm(h).includes('дата прихода') || norm(h).includes('приход'))
  const priceCol = headerRow.findIndex(h => norm(h).includes('цена утром') || (norm(h) === 'цена'))
  const marginCol = headerRow.findIndex(h => norm(h).includes('маржа') && !norm(h).includes('руб'))
  const fboWbCol = headerRow.findIndex(h => norm(h).includes('остаток на вб фбо') || (norm(h).includes('фбо') && norm(h).includes('остаток')))
  const fbsPushkinoCol = headerRow.findIndex(h => norm(h).includes('fbs пушкино') || norm(h).includes('пушкино'))
  const fbsSmolenskCol = headerRow.findIndex(h => norm(h).includes('fbs смоленск') || norm(h).includes('смоленск'))
  const totalStockCol = headerRow.findIndex(h => norm(h).includes('всего') || norm(h).includes('итого остат'))

  // Колонки изменений цен (cols ~16-26): ищем датированные заголовки до col 340
  const priceChangeCols: Array<{ col: number; date: string }> = []
  const seenPriceDates = new Set<string>()
  for (let ci = 16; ci < Math.min(340, headerRow.length); ci++) {
    const v = headerRow[ci]
    if (typeof v === 'number' && v > 40000 && v < 60000) {
      const dateISO = excelToISO(v)
      if (dateISO && !seenPriceDates.has(dateISO)) {
        seenPriceDates.add(dateISO)
        priceChangeCols.push({ col: ci, date: dateISO })
      }
    } else if (typeof v === 'string') {
      const dateISO = parseDateVal(v)
      if (dateISO && !seenPriceDates.has(dateISO)) {
        seenPriceDates.add(dateISO)
        priceChangeCols.push({ col: ci, date: dateISO })
      }
    }
  }

  // Колонки продаж по дням (LK-ABE, ~col 350+)
  const salesCols: Array<{ col: number; date: string }> = []
  const seenSalesDates = new Map<string, number>() // date → last col index

  // Первый проход: собрать все даты продаж, брать последнее вхождение
  for (let ci = 340; ci < headerRow.length; ci++) {
    const v = headerRow[ci]
    if (typeof v === 'number' && v > 44000 && v < 60000) {
      const dateISO = excelToISO(v)
      if (dateISO) seenSalesDates.set(dateISO, ci)
    }
  }
  for (const [date, col] of seenSalesDates) {
    salesCols.push({ col, date })
  }
  salesCols.sort((a, b) => a.col - b.col)

  // Определить snap_date = последняя дата из priceChangeCols или salesCols
  // Фильтруем только ISO даты (YYYY-MM-DD) чтобы не передать DD.MM.YYYY в Supabase
  const allDates = [...priceChangeCols.map(p => p.date), ...salesCols.map(s => s.date)]
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort()
  const snapDate = allDates.length ? allDates[allDates.length - 1] : new Date().toISOString().split('T')[0]

  // ── Парсим строки ─────────────────────────────────────────────────────────
  const snapshots: StockSnapshotRow[] = []
  const daily: StockDailyRow[] = []
  const priceChanges: PriceChangeRow[] = []
  let skipped = 0

  for (let ri = DATA_START; ri < rows.length; ri++) {
    const row = rows[ri]
    const skuWbRaw = toNum(row[skuWbCol])
    if (!skuWbRaw) { skipped++; continue }
    const skuWb = Math.round(skuWbRaw)
    const skuMs = skuMap.get(skuWb) ?? null

    const fbo = toNum(row[fboWbCol >= 0 ? fboWbCol : -1])
    const fps = toNum(row[fbsPushkinoCol >= 0 ? fbsPushkinoCol : -1])
    const fsm = toNum(row[fbsSmolenskCol >= 0 ? fbsSmolenskCol : -1])
    const totalStock = totalStockCol >= 0
      ? toNum(row[totalStockCol])
      : (fbo ?? 0) + (fps ?? 0) + (fsm ?? 0)

    snapshots.push({
      sku_wb: skuWb,
      sku_ms: skuMs,
      snap_date: snapDate,
      fbo_wb: fbo,
      fbs_pushkino: fps,
      fbs_smolensk: fsm,
      total_stock: totalStock,
      price: priceCol >= 0 ? toNum(row[priceCol]) : null,
      margin_pct: marginCol >= 0 ? toNum(row[marginCol]) : null,
      supply_qty: supplyQtyCol >= 0 ? toNum(row[supplyQtyCol]) : null,
      supply_date: supplyDateCol >= 0 ? parseDateVal(row[supplyDateCol]) : null,
    })

    // Изменения цен
    for (const { col, date } of priceChangeCols) {
      const price = toNum(row[col])
      if (price !== null) {
        priceChanges.push({ sku_wb: skuWb, sku_ms: skuMs, price_date: date, price })
      }
    }

    // Продажи по дням
    for (const { col, date } of salesCols) {
      const qty = toNum(row[col])
      if (qty !== null) {
        daily.push({ sku_wb: skuWb, sku_ms: skuMs, sale_date: date, sales_qty: qty })
      }
    }
  }

  return {
    snapshots,
    daily,
    price_changes: priceChanges,
    rows_parsed: snapshots.length,
    rows_skipped: skipped,
  }
}
