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

export interface ParseSkuReportResult {
  daily: SkuDailyRow[]
  snapshots: SkuSnapshotRow[]
  rows_parsed: number
  rows_skipped: number
  skipped_skus: string[]
  diag_service_rows: string[]
}

/**
 * Структура файла «Лист7» (реальная):
 * Row 0: группы (необязательно)
 * Row 1: заголовки
 *   col 0:  SKU (артикул МС)
 *   col 1:  Категория
 *   col 2:  Предмет
 *   col 3:  Название
 *   col 4:  Бренд
 *   col 5:  Дата появления на полке
 *   col 6:  Менеджер
 *   col 8:  Статус Новинки
 *   col 10: "Затраты за 5 дней" → cols 11-15 = 5 дат → данные затрат
 *   col 16: Остаток на ВБ ФБО
 *   col 17: Остаток FBS Пушкино
 *   col 18: Остаток FBS Смоленск
 *   col 19: остаток комплектов
 *   col 20: остаток, дни
 *   col 21: дней до прихода
 *   col 22: Запас дней до OOS
 *   col 23: Маржа Опер.
 *   col 25: ЧМД за пять дней, руб
 *   col 26: дата
 *   col 27: Затраты план
 *   col 28: ДРР план
 *   col 29: Выручка план
 *   col 30: "Выручка Total за 5 дней" → cols 31-35 = 5 дат → выручка
 *   col 36: "ДРР Total за 5 дней" → cols 37-41 = 5 дат → ДРР total
 *   col 42: "ДРР рекл. за 5 дней" → cols 43-47 = 5 дат → ДРР рекл
 *   col 48: "CTR за 5 дней" → cols 49-53 = 5 дат → CTR
 *   col 54: "CR в корзину за 5 дней" → cols 55-59 = 5 дат → CR корзина
 *   col 60: "CR в заказ за 5 дней" → cols 61-65 = 5 дат → CR заказ
 *   col 66: Цена
 *   col 67: "CPM за 5 дней" → cols 68-72 = 5 дат → CPM
 *   col 73: "CPC за 5 дней" → cols 74-78 = 5 дат → CPC
 *   col 79: "Доля рекламных заказов" → cols 80-84 = 5 дат → ad_order_share
 *
 * Парсим ДИНАМИЧЕСКИ — находим каждый блок по заголовку строки 1,
 * затем берём cols [blockStart+1 .. blockStart+5] как даты/значения
 */
/**
 * skuMap: Map<string WB_art, string MS_art> — передаётся из API route
 * Если не передан — col 0 используется как sku_ms без конвертации
 */
export function parseSkuReport(buffer: ArrayBuffer, skuMap?: Map<string, string>): ParseSkuReportResult {
  const wb = readWorkbook(buffer)
  const sheetName = wb.SheetNames.find(n => norm(n) === 'лист7') ?? 'Лист7'
  const rows = sheetToRows(wb, sheetName)

  if (rows.length < 3) throw new Error('Файл пустой или неправильный формат')

  const headerRow = rows[1]
  const dataRows = rows.slice(2)

  // ── Найти колонку SKU (sku_ms) ─────────────────────────────────────────────
  let skuCol = headerRow.findIndex(h =>
    norm(h) === 'sku' ||
    norm(h).includes('артикул мс') ||
    norm(h).includes('артикул склада') ||
    norm(h) === 'артикул' ||
    norm(h).includes('номенклатура')
  )
  if (skuCol === -1) skuCol = 0

  // ── Фиксированные снапшот-колонки (ищем по заголовку) ─────────────────────
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
  // Колонка Y «Маржа, %» — маржинальность выручки в процентах (17.3 → хранить как 0.173)
  const marginPctCol = fcs(['маржа, %', 'маржа,%', 'маржа %'])
  const chmd5dCol = fcs(['чмд за пять', 'чмд за 5'])
  const spendPlanCol = fcs(['затраты план', 'spend plan'])
  const drrPlanCol = fcs(['дрр план', 'drr план'])
  const revenPlanCol = fcs(['выручка план'])
  const priceCol = fc('цена')
  const supplyDateCol = fcs(['поставка план', 'дата поставки'])
  const supplyQtyCol = fcs(['поступ', 'поставка шт'])

  // ── Найти блоки метрик: (заголовок группы) → (5 дат в следующих cols) ─────
  /**
   * Блок: col с текстом → cols +1..+5 содержат числа-даты
   * Возвращает: { dateOffsets: number[] } относительно начала блока
   */
  function findMetricBlock(queries: string[]): { headerCol: number; dateCols: number[] } | null {
    for (let ci = 10; ci < headerRow.length - 5; ci++) {
      const h = norm(headerRow[ci])
      if (queries.some(q => h.includes(q))) {
        // собираем следующие 5 date-cols
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

  // Основные даты — берём из первого найденного блока (обычно выручка)
  const primaryBlock = revenueBlock ?? adSpendBlock ?? ctrBlock
  if (!primaryBlock) throw new Error('Не найдены датированные блоки метрик в Отчёте по SKU')

  // Все уникальные даты из primaryBlock
  const dateCols = primaryBlock.dateCols

  // Дата снапшота = первая (самая свежая) дата
  const snapDateISO = excelToISO(headerRow[dateCols[0]] as number) ?? ''

  // ── Парсим строки ───────────────────────────────────────────────────────────
  const daily: SkuDailyRow[] = []
  const snapshots: SkuSnapshotRow[] = []
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
    // Конвертируем WB→MS если передан маппинг
    const skuMs = skuMap ? (skuMap.get(rawSku) ?? null) : rawSku
    if (!skuMs) { skipped++; skippedSkus.push(rawSku); continue }

    // Функция получения значения из блока по индексу даты (0..4)
    const getFromBlock = (block: { dateCols: number[] } | null, di: number) => {
      if (!block) return null
      return toNum(row[block.dateCols[di]])
    }

    // Дневные метрики (5 дат)
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

    // Снапшот
    const rawNovelty = noveltyCol >= 0 ? String(row[noveltyCol] ?? '').trim() : null
    // rawSku = WB артикул (колонка A), skuMap мог конвертировать его в sku_ms
    const skuWbNum = skuMap ? (Number(rawSku) || null) : null

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
        // Значение в % (напр. 17.3) → переводим в долю (0.173)
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
    rows_parsed: snapshots.length,
    rows_skipped: skipped,
    skipped_skus: skippedSkus,
    diag_service_rows: skippedService,
  }
}
