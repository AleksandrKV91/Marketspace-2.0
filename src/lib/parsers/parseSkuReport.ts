import { readWorkbook, sheetToRows, norm, toNum, excelToISO, parseDateVal } from './utils'

export interface SkuDailyRow {
  sku_ms: string
  metric_date: string
  ad_spend: number | null
  revenue: number | null
  drr_total: number | null
  drr_ad: number | null
  ctr: number | null
  cr_cart: number | null
  cr_order: number | null
  cpm: number | null
  cpc: number | null
  ad_order_share: number | null
  spp: number | null
  spend_plan: number | null
  drr_plan: number | null
}

export interface SkuSnapshotRow {
  sku_ms: string
  sku_wb: number | null          // артикул WB (колонка A отчёта по SKU)
  snap_date: string
  fbo_wb: number | null
  fbs_pushkino: number | null
  fbs_smolensk: number | null
  kits_stock: number | null
  stock_days: number | null
  days_to_arrival: number | null
  ots_reserve_days: number | null
  margin_rub: number | null
  margin_pct: number | null   // колонка Y «Маржа, %» → делённая на 100 (17.3 → 0.173)
  chmd_5d: number | null
  spend_plan: number | null
  drr_plan: number | null
  supply_date: string | null
  supply_qty: number | null
  price: number | null
  shelf_date: string | null
  manager: string | null
  novelty_status: string | null
}

export interface SkuPriceChangeRow {
  sku_ms: string
  sku_wb: number | null
  price_date: string
  price: number
}

export interface ParseSkuReportResult {
  daily: SkuDailyRow[]
  snapshots: SkuSnapshotRow[]
  priceChanges: SkuPriceChangeRow[]
  rows_parsed: number
  rows_skipped: number
  skipped_skus: string[]
  diag_service_rows: string[]
}

/**
 * Структура файла «Лист7» (реальная для xlsb):
 * Row 0: группы — "Характеристики SKU"(A), "Выручка Total за 5 дней"(AE/30),
 *         "ДРР Total"(AK/36), "ДРР Рекламный"(AQ/42), "CTR за 5 дней"(AW/48),
 *         "CR в корзину"(BC/54), "CR в заказ"(BI/60), "CPM"(BP/67),
 *         "CPC"(BV/73), "Доля рекламных заказов"(CB/79), "Изменение цены"(CJ/87)
 * Row 1: подзаголовки + Excel-даты
 *   col 0 (A): SKU WB (числовой артикул WB, напр. 15747552)
 *   col 1 (B): Категория
 *   col 2 (C): Предмет
 *   col 3 (D): Название
 *   col 4 (E): Бренд
 *   col 5 (F): Дата появления на полке
 *   col 6 (G): Менеджер
 *   col 8 (I): Статус Новинки
 *   col 10 (K): "Затраты за 5 дней" (в row0 - это «Характеристики SKU» продолжение)
 *   col 11-15: 5 дат → данные затрат
 *   col 16: Остаток на ВБ ФБО
 *   ...
 *   col 30 (AE): дата-заголовки Выручки (в row0: "Выручка Total за 5 дней")
 *   col 66 (BO): Цена
 *   col 87 (CJ): "Изменение цены" (в row0), col 88-91 = даты, данные = абс. цена
 *
 * findMetricBlock ищет сначала в row0 (группы), затем в row1 (подзаголовки),
 * и для каждого найденного заголовка собирает следующие 5 Excel-дат из row1.
 */
export function parseSkuReport(buffer: ArrayBuffer, skuMap?: Map<string, string>): ParseSkuReportResult {
  const wb = readWorkbook(buffer)
  const sheetName = wb.SheetNames.find(n => norm(n) === 'лист7') ?? 'Лист7'
  const rows = sheetToRows(wb, sheetName)

  if (rows.length < 3) throw new Error('Файл пустой или неправильный формат')

  const groupRow = rows[0]   // строка 0: имена групп блоков
  const headerRow = rows[1]  // строка 1: подзаголовки + даты
  const dataRows = rows.slice(2)

  // ── Найти колонку SKU WB (col 0 = числовой WB-артикул) ────────────────────
  // col 0 всегда WB-артикул. skuMap: WB→MS конвертирует его в MS-артикул.
  const skuCol = 0

  // ── Фиксированные снапшот-колонки (ищем по заголовку в row1) ──────────────
  const fc = (q: string) => headerRow.findIndex(h => norm(h).includes(q))
  const fcs = (qs: string[]) => {
    for (const q of qs) {
      const idx = fc(q)
      if (idx !== -1) return idx
    }
    return -1
  }

  const shelfDateCol = fcs(['дата появления', 'дата полки', 'появления на полке'])
  const managerCol = fc('менеджер')
  const noveltyCol = fcs(['статус новинки', 'статус  новинки'])
  const fboWbCol = fcs(['остаток на вб фбо', 'остаток на вб'])
  const fbsPushkinoCol = fcs(['остаток fbs пушкино', 'fbs пушкино', 'фбс пушкино'])
  const fbsSmolenskCol = fcs(['остаток fbs смоленск', 'fbs смоленск', 'фбс смоленск'])
  const kitsStockCol = fcs(['остаток комплект'])
  const stockDaysCol = fcs(['остаток, дни', 'остаток,дни'])
  const daysArrivalCol = fc('дней до прихода')
  const otsReserveCol = fcs(['запас дней до out to stock', 'запас дней до oos', 'запас дней'])
  const marginRubCol = fcs(['маржа опер', 'маржа, руб', 'маржа руб'])
  const marginPctCol = fcs(['маржа, %', 'маржа,%', 'маржа %'])
  const chmd5dCol = fcs(['чмд за пять', 'чмд за 5'])
  const spendPlanCol = fcs(['затраты план', 'spend plan'])
  const drrPlanCol = fcs(['дрр план', 'drr план'])
  const priceCol = fc('цена')
  const supplyDateCol = fcs(['поставка план', 'дата поставки'])
  const supplyQtyCol = fcs(['поступ', 'поставка шт'])

  // ── Найти блок метрик: ищем в row0 (группы) И row1 (подзаголовки) ─────────
  /**
   * Ищет заголовок блока в row0, затем row1.
   * После нахождения col, ищет до 5 Excel-дат в row1 (cols header+1..header+7).
   */
  function findMetricBlock(queries: string[]): { headerCol: number; dateCols: number[] } | null {
    // Ищем в row0 (группы блоков)
    for (let ci = 10; ci < groupRow.length - 2; ci++) {
      const h = norm(groupRow[ci])
      if (queries.some(q => h.includes(q))) {
        const dateCols: number[] = []
        // Даты могут быть в row1 начиная с ci или ci+1
        for (let di = ci; di < ci + 8 && di < headerRow.length; di++) {
          const v = headerRow[di]
          if (typeof v === 'number' && v > 40000 && v < 60000) {
            dateCols.push(di)
            if (dateCols.length === 5) break
          }
        }
        if (dateCols.length > 0) return { headerCol: ci, dateCols }
      }
    }
    // Fallback: ищем в row1 (подзаголовки) — для обратной совместимости
    for (let ci = 10; ci < headerRow.length - 5; ci++) {
      const h = norm(headerRow[ci])
      if (queries.some(q => h.includes(q))) {
        const dateCols: number[] = []
        for (let di = ci + 1; di < ci + 8 && di < headerRow.length; di++) {
          const v = headerRow[di]
          if (typeof v === 'number' && v > 40000 && v < 60000) {
            dateCols.push(di)
            if (dateCols.length === 5) break
          }
        }
        if (dateCols.length > 0) return { headerCol: ci, dateCols }
      }
    }
    return null
  }

  const adSpendBlock = findMetricBlock(['затраты за 5', 'затраты рекл'])
  const revenueBlock = findMetricBlock(['выручка total за 5', 'выручка тотал за 5', 'выручка за 5'])
  const drrTotalBlock = findMetricBlock(['дрр total за 5', 'дрр тотал за 5', 'дрр total'])
  const drrAdBlock = findMetricBlock(['дрр рекл', 'дрр рекламный'])
  const ctrBlock = findMetricBlock(['ctr за 5', 'ctr'])
  const crCartBlock = findMetricBlock(['cr в корзину', 'cr корзину'])
  const crOrderBlock = findMetricBlock(['cr в заказ', 'cr заказ'])
  const cpmBlock = findMetricBlock(['cpm за 5', 'cpm'])
  const cpcBlock = findMetricBlock(['cpc за 5', 'cpc'])
  const adShareBlock = findMetricBlock(['доля рекламных заказов', 'доля рекл'])

  // ── Блок «Изменение цены» (CJ/col87 в row0) ───────────────────────────────
  // row0 col 87: "Изменение цены", row1 cols 88-91: Excel-даты, данные = абс. цена
  const priceChangeBlock = findMetricBlock(['изменение цены', 'изменение цен'])

  // Основные даты — берём из первого найденного блока
  const primaryBlock = revenueBlock ?? adSpendBlock ?? ctrBlock
  if (!primaryBlock) throw new Error('Не найдены датированные блоки метрик в Отчёте по SKU')

  const dateCols = primaryBlock.dateCols

  // Дата снапшота = первая (самая свежая) дата основного блока
  const snapDateISO = excelToISO(headerRow[dateCols[0]] as number) ?? ''

  // ── Парсим строки ───────────────────────────────────────────────────────────
  const daily: SkuDailyRow[] = []
  const snapshots: SkuSnapshotRow[] = []
  const priceChanges: SkuPriceChangeRow[] = []
  let skipped = 0
  const skippedSkus: string[] = []
  const skippedService: string[] = []

  for (const row of dataRows) {
    const rawSku = String(row[skuCol] ?? '').trim()
    if (!rawSku || rawSku.toLowerCase() === 'итого' || rawSku === 'SKU') {
      skipped++
      if (rawSku) skippedService.push(rawSku)
      continue
    }
    // col 0 = WB-артикул → конвертируем в MS через skuMap
    const skuMs = skuMap ? (skuMap.get(rawSku) ?? null) : rawSku
    if (!skuMs) { skipped++; skippedSkus.push(rawSku); continue }

    const skuWbNum = Number(rawSku) || null

    const getFromBlock = (block: { dateCols: number[] } | null, di: number) => {
      if (!block) return null
      return toNum(row[block.dateCols[di]])
    }

    // Дневные метрики (5 дат основного блока)
    for (let di = 0; di < dateCols.length; di++) {
      const dateISO = excelToISO(headerRow[dateCols[di]] as number)
      if (!dateISO) continue

      daily.push({
        sku_ms: skuMs,
        metric_date: dateISO,
        ad_spend: getFromBlock(adSpendBlock, di),
        revenue: getFromBlock(revenueBlock, di),
        drr_total: getFromBlock(drrTotalBlock, di),
        drr_ad: getFromBlock(drrAdBlock, di),
        ctr: getFromBlock(ctrBlock, di),
        cr_cart: getFromBlock(crCartBlock, di),
        cr_order: getFromBlock(crOrderBlock, di),
        cpm: getFromBlock(cpmBlock, di),
        cpc: getFromBlock(cpcBlock, di),
        ad_order_share: getFromBlock(adShareBlock, di),
        spp: null,
        spend_plan: di === 0 && spendPlanCol >= 0 ? toNum(row[spendPlanCol]) : null,
        drr_plan: di === 0 && drrPlanCol >= 0 ? toNum(row[drrPlanCol]) : null,
      })
    }

    // ── Изменения цен из блока CJ-CN ────────────────────────────────────────
    if (priceChangeBlock && skuWbNum) {
      for (let di = 0; di < priceChangeBlock.dateCols.length; di++) {
        const dateISO = excelToISO(headerRow[priceChangeBlock.dateCols[di]] as number)
        const price = toNum(row[priceChangeBlock.dateCols[di]])
        if (dateISO && price != null && price > 0) {
          priceChanges.push({ sku_ms: skuMs, sku_wb: skuWbNum, price_date: dateISO, price })
        }
      }
    }

    // Снапшот
    const rawNovelty = noveltyCol >= 0 ? String(row[noveltyCol] ?? '').trim() : null

    snapshots.push({
      sku_ms: skuMs,
      sku_wb: skuWbNum,
      snap_date: snapDateISO,
      fbo_wb: fboWbCol >= 0 ? toNum(row[fboWbCol]) : null,
      fbs_pushkino: fbsPushkinoCol >= 0 ? toNum(row[fbsPushkinoCol]) : null,
      fbs_smolensk: fbsSmolenskCol >= 0 ? toNum(row[fbsSmolenskCol]) : null,
      kits_stock: kitsStockCol >= 0 ? toNum(row[kitsStockCol]) : null,
      stock_days: stockDaysCol >= 0 ? toNum(row[stockDaysCol]) : null,
      days_to_arrival: daysArrivalCol >= 0 ? toNum(row[daysArrivalCol]) : null,
      ots_reserve_days: otsReserveCol >= 0 ? toNum(row[otsReserveCol]) : null,
      margin_rub: marginRubCol >= 0 ? toNum(row[marginRubCol]) : null,
      margin_pct: (() => {
        if (marginPctCol < 0) return null
        const v = toNum(row[marginPctCol])
        if (v == null) return null
        return v / 100
      })(),
      chmd_5d: chmd5dCol >= 0 ? toNum(row[chmd5dCol]) : null,
      spend_plan: spendPlanCol >= 0 ? toNum(row[spendPlanCol]) : null,
      drr_plan: drrPlanCol >= 0 ? toNum(row[drrPlanCol]) : null,
      supply_date: supplyDateCol >= 0 ? parseDateVal(row[supplyDateCol]) : null,
      supply_qty: supplyQtyCol >= 0 ? toNum(row[supplyQtyCol]) : null,
      price: priceCol >= 0 ? toNum(row[priceCol]) : null,
      shelf_date: shelfDateCol >= 0 ? parseDateVal(row[shelfDateCol]) : null,
      manager: managerCol >= 0 ? String(row[managerCol] ?? '').trim() || null : null,
      novelty_status: rawNovelty || null,
    })
  }

  return {
    daily,
    snapshots,
    priceChanges,
    rows_parsed: snapshots.length,
    rows_skipped: skipped,
    skipped_skus: skippedSkus,
    diag_service_rows: skippedService,
  }
}
