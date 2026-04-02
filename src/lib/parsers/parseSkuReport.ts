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
  snap_date: string
  fbo_wb: number | null
  fbs_pushkino: number | null
  fbs_smolensk: number | null
  kits_stock: number | null
  stock_days: number | null
  days_to_arrival: number | null
  ots_reserve_days: number | null
  margin_rub: number | null
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
}

export function parseSkuReport(buffer: ArrayBuffer): ParseSkuReportResult {
  const wb = readWorkbook(buffer)
  const sheetName = wb.SheetNames.find(n => norm(n) === 'лист7') ?? 'Лист7'
  const rows = sheetToRows(wb, sheetName)

  if (rows.length < 3) throw new Error('Файл пустой или неправильный формат')

  const groupRow = rows[0]  // строка 0: группы
  const headerRow = rows[1] // строка 1: заголовки
  const dataRows = rows.slice(2)

  // ── Определяем смещение pos ───────────────────────────────────────────────
  let pos = 0
  for (let ci = 27; ci < 45; ci++) {
    if (norm(headerRow[ci]).includes('затраты план') ||
        norm(headerRow[ci]).includes('spend plan')) {
      pos = ci - 32
      break
    }
  }
  if (pos === 0) {
    for (let ci = 27; ci < 45; ci++) {
      if (norm(groupRow[ci]).includes('планирован')) {
        pos = ci - 32
        break
      }
    }
  }

  const POS_LATEST = pos < 0 ? 26 : 29

  // ── Определяем 5 дат ─────────────────────────────────────────────────────
  const dateCols: number[] = []
  for (let ci = 10; ci < 40; ci++) {
    const v = headerRow[ci]
    if (typeof v === 'number' && v > 40000 && v < 60000) {
      dateCols.push(ci)
      if (dateCols.length === 5) break
    }
  }

  if (dateCols.length === 0) throw new Error('Не найдены датированные колонки в Отчёте по SKU')

  // Дата снапшота = первая (самая свежая) дата
  const snapDateISO = excelToISO(headerRow[dateCols[0]] as number)

  // ── Характеристики SKU (фиксированные колонки) ────────────────────────────
  // По spec: Артикул МС ~ col 0-1, Менеджер, Дата полки, Статус новинки
  // Ищем по заголовку
  const shelfDateCol = headerRow.findIndex(h => norm(h).includes('дата появления') || norm(h).includes('дата полки') || norm(h).includes('появления на полке'))
  const managerCol = headerRow.findIndex(h => norm(h) === 'менеджер')
  const noveltyCol = headerRow.findIndex(h => norm(h).includes('статус новинки') || norm(h).includes('новинка'))
  let skuMsCol = headerRow.findIndex(h =>
    norm(h).includes('артикул мс') ||
    norm(h) === 'артикул' ||
    norm(h).includes('номенклатура') ||
    norm(h).includes('артикул склада') ||
    norm(h) === 'sku'
  )
  if (skuMsCol === -1) skuMsCol = 1 // fallback: второй столбец

  // Колонки снапшота (по заголовкам)
  const fboWbCol = headerRow.findIndex(h => norm(h).includes('остаток на вб фбо') || (norm(h).includes('остаток') && norm(h).includes('фбо')))
  const fbsPushkinoCol = headerRow.findIndex(h => norm(h).includes('fbs пушкино') || norm(h).includes('фбс пушкино'))
  const fbsSmolenskCol = headerRow.findIndex(h => norm(h).includes('fbs смоленск') || norm(h).includes('фбс смоленск'))
  const kitsStockCol = headerRow.findIndex(h => norm(h).includes('остаток комплект'))
  const stockDaysCol = headerRow.findIndex(h => norm(h).includes('остаток, дни') || (norm(h).includes('остаток') && norm(h).includes('дни')))
  const daysArrivalCol = headerRow.findIndex(h => norm(h).includes('дней до прихода'))
  const otsReserveCol = headerRow.findIndex(h => norm(h).includes('запас дней до oos') || norm(h).includes('запас дней'))
  const marginRubCol = headerRow.findIndex(h => norm(h).includes('маржа опер') || (norm(h).includes('маржа') && norm(h).includes('руб')))
  const chmd5dCol = headerRow.findIndex(h => norm(h).includes('чмд за пять') || norm(h).includes('чмд за 5'))
  const spendPlanCol = 32 + pos
  const drrPlanCol = headerRow.findIndex((h, i) => i > spendPlanCol && (norm(h).includes('дрр план') || norm(h).includes('drr план')))
  const supplyDateCol = headerRow.findIndex(h => norm(h).includes('поставка план') || norm(h).includes('дата поставки'))
  const supplyQtyCol = headerRow.findIndex(h => norm(h).includes('поступ') || norm(h).includes('поставка шт'))
  const priceCol = headerRow.findIndex(h => norm(h) === 'цена')

  // Метрики по дням: для каждой из 5 дат → смещение от dateCols[i]
  // По spec: строка метрик идёт последовательно в колонках
  // Порядок метрик в строке (начиная с dateCols[0]):
  // ad_spend, revenue, drr_total, drr_ad, ctr, cr_cart, cr_order, cpm, cpc, ad_order_share, spp
  // При этом каждая группа начинается с dateCols[i]
  // Нужно найти относительные смещения для каждой метрики
  // Ищем по заголовку строки 1 для первой даты
  const firstDateCol = dateCols[0]
  const metricOffsets: Record<string, number> = {}

  const metricSearchMap: Array<{ key: string; queries: string[] }> = [
    { key: 'ad_spend', queries: ['затраты', 'расходы на рекламу'] },
    { key: 'revenue', queries: ['выручка total', 'выручка тотал', 'выручка'] },
    { key: 'drr_total', queries: ['дрр total', 'дрр тотал', 'дрр общий'] },
    { key: 'drr_ad', queries: ['дрр рекламный', 'дрр рекл'] },
    { key: 'ctr', queries: ['ctr'] },
    { key: 'cr_cart', queries: ['cr в корзину', 'cr корзину'] },
    { key: 'cr_order', queries: ['cr в заказ', 'cr заказ'] },
    { key: 'cpm', queries: ['cpm'] },
    { key: 'cpc', queries: ['cpc'] },
    { key: 'ad_order_share', queries: ['доля рекламных заказов', 'доля рекл'] },
    { key: 'spp', queries: ['спп', 'spp', 'цена после скидки'] },
  ]

  for (const { key, queries } of metricSearchMap) {
    for (let offset = 0; offset < 20; offset++) {
      const ci = firstDateCol + offset
      if (ci >= headerRow.length) break
      const h = norm(headerRow[ci])
      if (queries.some(q => h.includes(q))) {
        metricOffsets[key] = offset
        break
      }
    }
  }

  // ── Парсим строки данных ──────────────────────────────────────────────────
  const daily: SkuDailyRow[] = []
  const snapshots: SkuSnapshotRow[] = []
  const skippedSkus: string[] = []
  let skipped = 0

  for (const row of dataRows) {
    const skuMs = String(row[skuMsCol !== -1 ? skuMsCol : 0] ?? '').trim()
    if (!skuMs || skuMs.toLowerCase() === 'итого') { skipped++; continue }

    // Дневные метрики (5 дат)
    for (let di = 0; di < dateCols.length; di++) {
      const dateCol = dateCols[di]
      const dateISO = excelToISO(headerRow[dateCol] as number)
      if (!dateISO) continue

      const getMetric = (key: string) => {
        const offset = metricOffsets[key]
        if (offset === undefined) return null
        return toNum(row[dateCol + offset])
      }

      daily.push({
        sku_ms: skuMs,
        metric_date: dateISO,
        ad_spend: getMetric('ad_spend'),
        revenue: getMetric('revenue'),
        drr_total: getMetric('drr_total'),
        drr_ad: getMetric('drr_ad'),
        ctr: getMetric('ctr'),
        cr_cart: getMetric('cr_cart'),
        cr_order: getMetric('cr_order'),
        cpm: getMetric('cpm'),
        cpc: getMetric('cpc'),
        ad_order_share: getMetric('ad_order_share'),
        spp: getMetric('spp'),
        spend_plan: di === 0 && spendPlanCol >= 0 ? toNum(row[spendPlanCol]) : null,
        drr_plan: di === 0 && drrPlanCol >= 0 ? toNum(row[drrPlanCol]) : null,
      })
    }

    // Снапшот (только одна запись на SKU)
    const rawNovelty = noveltyCol >= 0 ? String(row[noveltyCol] ?? '').trim() : null
    snapshots.push({
      sku_ms: skuMs,
      snap_date: snapDateISO,
      fbo_wb: fboWbCol >= 0 ? toNum(row[fboWbCol]) : null,
      fbs_pushkino: fbsPushkinoCol >= 0 ? toNum(row[fbsPushkinoCol]) : null,
      fbs_smolensk: fbsSmolenskCol >= 0 ? toNum(row[fbsSmolenskCol]) : null,
      kits_stock: kitsStockCol >= 0 ? toNum(row[kitsStockCol]) : null,
      stock_days: stockDaysCol >= 0 ? toNum(row[stockDaysCol]) : null,
      days_to_arrival: daysArrivalCol >= 0 ? toNum(row[daysArrivalCol]) : null,
      ots_reserve_days: otsReserveCol >= 0 ? toNum(row[otsReserveCol]) : null,
      margin_rub: marginRubCol >= 0 ? toNum(row[marginRubCol]) : null,
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
  }
}
