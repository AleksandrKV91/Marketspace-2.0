import { readWorkbook, sheetToRows, norm, toNum, excelToISO, parseDateVal } from './utils'

/**
 * Объединённая строка: снапшот (статика) + дневные метрики (динамика).
 * snap_date и снапшотные поля одинаковы для всех 5 дат одного SKU.
 * Дневные метрики (ad_spend, revenue и т.д.) — по каждой дате.
 */
export interface SkuDailyRow {
  sku_ms: string
  metric_date: string
  upload_id?: string  // проставляется в route.ts

  // Дневные метрики (из блоков)
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

  // Снапшотные поля (одинаковы для всех дат SKU)
  snap_date: string
  sku_wb: number | null
  fbo_wb: number | null
  fbs_pushkino: number | null
  fbs_smolensk: number | null
  kits_stock: number | null
  stock_days: number | null
  days_to_arrival: number | null
  ots_reserve_days: number | null
  margin_pct: number | null
  chmd_5d: number | null
  price: number | null
  supply_date: string | null
  supply_qty: number | null
  shelf_date: string | null
  manager: string | null
  novelty_status: string | null
}

export interface SkuPriceChangeRow {
  sku_ms: string
  sku_wb: number | null
  price_date: string
  price: number
  delta_pct: number | null  // дельта % из файла (для проверки расчётов)
}

export interface ParseSkuReportResult {
  daily: SkuDailyRow[]
  priceChanges: SkuPriceChangeRow[]
  rows_parsed: number
  rows_skipped: number
  skipped_skus: string[]
  diag_service_rows: string[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  diag_blocks: Record<string, any>
}

/**
 * Структура файла «Лист7»:
 * Row 0: группы — "Характеристики SKU", "Выручка Total за 5 дней", "ДРР Total",
 *         "ДРР Рекламный", "CTR за 5 дней", "CR в корзину", "CR в заказ",
 *         "CPM", "CPC", "Доля рекламных заказов", "Изменение цены"
 * Row 1: подзаголовки + Excel-даты
 * Row 2+: данные SKU (col 0 = WB-артикул)
 *
 * price_date: блок «Изменение цены» содержит дельты % за конкретные даты.
 * Цена на начало периода (самая старая дата блока) = базовая цена «до всех изменений».
 * Цена на snap_date (конец периода) = price из колонки «Цена».
 */
export function parseSkuReport(buffer: ArrayBuffer, skuMap?: Map<string, string>): ParseSkuReportResult {
  const wb = readWorkbook(buffer)
  const sheetName = wb.SheetNames.find(n => norm(n) === 'лист7') ?? 'Лист7'
  const rows = sheetToRows(wb, sheetName)

  if (rows.length < 3) throw new Error('Файл пустой или неправильный формат')

  const groupRow = rows[0]   // строка 0: имена групп блоков
  const headerRow = rows[1]  // строка 1: подзаголовки + даты
  const dataRows = rows.slice(2)

  // ── Фиксированные снапшот-колонки ──────────────────────────────────────────
  const fc = (q: string) => headerRow.findIndex(h => norm(h).includes(q))
  const fcs = (qs: string[]) => {
    for (const q of qs) { const idx = fc(q); if (idx !== -1) return idx }
    return -1
  }

  const shelfDateCol    = fcs(['дата появления', 'дата полки', 'появления на полке'])
  const managerCol      = fc('менеджер')
  const noveltyCol      = fcs(['статус новинки', 'статус  новинки'])
  const fboWbCol        = fcs(['остаток на вб фбо', 'остаток на вб'])
  const fbsPushkinoCol  = fcs(['остаток fbs пушкино', 'fbs пушкино', 'фбс пушкино'])
  const fbsSmolenskCol  = fcs(['остаток fbs смоленск', 'fbs смоленск', 'фбс смоленск'])
  const kitsStockCol    = fcs(['остаток комплект'])
  const stockDaysCol    = fcs(['остаток, дни', 'остаток,дни'])
  const daysArrivalCol  = fc('дней до прихода')
  const otsReserveCol   = fcs(['запас дней до out to stock', 'запас дней до oos', 'запас дней'])
  const marginPctCol    = fcs(['маржа, %', 'маржа,%', 'маржа %'])
  const chmd5dCol       = fcs(['чмд за пять', 'чмд за 5'])
  const spendPlanCol    = fcs(['затраты план', 'spend plan'])
  const drrPlanCol      = fcs(['дрр план', 'drr план'])
  const priceCol        = fc('цена')
  const supplyDateCol   = fcs(['поставка план', 'дата поставки'])
  const supplyQtyCol    = fcs(['поступ', 'поставка шт'])

  // ── Найти блок метрик ───────────────────────────────────────────────────────
  function findMetricBlock(queries: string[]): { headerCol: number; dateCols: number[] } | null {
    for (let ci = 10; ci < groupRow.length - 2; ci++) {
      const h = norm(groupRow[ci])
      if (queries.some(q => h.includes(q))) {
        const dateCols: number[] = []
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
    // Fallback: row1
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

  const adSpendBlock  = findMetricBlock(['затраты за 5', 'затраты рекл'])
  const revenueBlock  = findMetricBlock(['выручка total за 5', 'выручка тотал за 5', 'выручка за 5'])
  const drrTotalBlock = findMetricBlock(['дрр total за 5', 'дрр тотал за 5', 'дрр total'])
  const drrAdBlock    = findMetricBlock(['дрр рекл', 'дрр рекламный'])
  const ctrBlock      = findMetricBlock(['ctr за 5', 'ctr'])
  const crCartBlock   = findMetricBlock(['cr в корзину', 'cr корзину'])
  const crOrderBlock  = findMetricBlock(['cr в заказ', 'cr заказ'])
  const cpmBlock      = findMetricBlock(['cpm за 5', 'cpm'])
  const cpcBlock      = findMetricBlock(['cpc за 5', 'cpc'])
  const adShareBlock  = findMetricBlock(['доля рекламных заказов', 'доля рекл'])
  const priceChangeBlock = findMetricBlock(['изменение цены', 'изменение цен'])

  const primaryBlock = revenueBlock ?? adSpendBlock ?? ctrBlock
  if (!primaryBlock) throw new Error('Не найдены датированные блоки метрик в Отчёте по SKU')

  const dateCols = primaryBlock.dateCols

  // snap_date = самая НОВАЯ дата (первая в блоке — отчёт идёт от новой к старой)
  const snapDateISO = excelToISO(headerRow[dateCols[0]] as number) ?? ''

  // ── Парсим строки ───────────────────────────────────────────────────────────
  const daily: SkuDailyRow[] = []
  const priceChanges: SkuPriceChangeRow[] = []
  let skipped = 0
  const skippedSkus: string[] = []
  const skippedService: string[] = []

  for (const row of dataRows) {
    const rawSku = String(row[0] ?? '').trim()
    if (!rawSku || rawSku.toLowerCase() === 'итого' || rawSku === 'SKU') {
      skipped++
      if (rawSku) skippedService.push(rawSku)
      continue
    }
    const skuMs = skuMap ? (skuMap.get(rawSku) ?? null) : rawSku
    if (!skuMs) { skipped++; skippedSkus.push(rawSku); continue }

    const skuWbNum = Number(rawSku) || null

    const getFromBlock = (block: { dateCols: number[] } | null, di: number) =>
      block ? toNum(row[block.dateCols[di]]) : null

    // Снапшотные поля (одинаковы для SKU — вычисляем один раз)
    const marginPct = (() => {
      if (marginPctCol < 0) return null
      const v = toNum(row[marginPctCol])
      return v == null ? null : v / 100
    })()

    const snapFields = {
      snap_date: snapDateISO,
      sku_wb: skuWbNum,
      fbo_wb: fboWbCol >= 0 ? toNum(row[fboWbCol]) : null,
      fbs_pushkino: fbsPushkinoCol >= 0 ? toNum(row[fbsPushkinoCol]) : null,
      fbs_smolensk: fbsSmolenskCol >= 0 ? toNum(row[fbsSmolenskCol]) : null,
      kits_stock: kitsStockCol >= 0 ? toNum(row[kitsStockCol]) : null,
      stock_days: stockDaysCol >= 0 ? toNum(row[stockDaysCol]) : null,
      days_to_arrival: daysArrivalCol >= 0 ? toNum(row[daysArrivalCol]) : null,
      ots_reserve_days: otsReserveCol >= 0 ? toNum(row[otsReserveCol]) : null,
      margin_pct: marginPct,
      chmd_5d: chmd5dCol >= 0 ? toNum(row[chmd5dCol]) : null,
      price: priceCol >= 0 ? toNum(row[priceCol]) : null,
      supply_date: supplyDateCol >= 0 ? parseDateVal(row[supplyDateCol]) : null,
      supply_qty: supplyQtyCol >= 0 ? toNum(row[supplyQtyCol]) : null,
      shelf_date: shelfDateCol >= 0 ? parseDateVal(row[shelfDateCol]) : null,
      manager: managerCol >= 0 ? String(row[managerCol] ?? '').trim() || null : null,
      novelty_status: noveltyCol >= 0 ? String(row[noveltyCol] ?? '').trim() || null : null,
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
        ...snapFields,
      })
    }

    // ── Изменения цен ────────────────────────────────────────────────────────
    // Блок «Изменение цены» содержит дельты % за конкретные даты.
    // price (col «Цена») = цена на snap_date (конец периода).
    // Цена на начало (самую старую дату) = откат всех дельт назад от snap_date.
    // price_date = дата начала действия цены (т.е. дата ДО которой цена была другой).
    if (priceChangeBlock && skuWbNum) {
      const basePrice = priceCol >= 0 ? toNum(row[priceCol]) : null
      if (basePrice != null && basePrice > 0) {
        // Собираем даты и дельты, сортируем от старой к новой
        const priceDates = priceChangeBlock.dateCols.map(c => ({
          col: c,
          iso: excelToISO(headerRow[c] as number),
          delta: toNum(row[c]) ?? 0,
        })).filter(x => x.iso).sort((a, b) => a.iso!.localeCompare(b.iso!))

        // Только даты с ненулевой дельтой
        const withDelta = priceDates.filter(d => d.delta !== 0)

        if (withDelta.length > 0) {
          // Откатываем от basePrice (snap_date) назад — находим цену до каждого изменения
          // Идём от новейшего к старейшему, делим на (1 + delta/100)
          const reversed = [...withDelta].reverse()
          const priceStack: number[] = [basePrice]
          for (const { delta } of reversed) {
            priceStack.push(priceStack[priceStack.length - 1] / (1 + delta / 100))
          }
          // priceStack[0] = snap_date цена, priceStack[N] = цена до всех изменений

          // Строим записи: price_date = дата начала действия новой цены (после изменения)
          // Самая старая запись: price_date = withDelta[0].iso, price = цена ПОСЛЕ первой дельты
          // т.е. цена до первой дельты была priceStack[last], после = priceStack[last] * (1 + delta/100)
          for (let i = 0; i < withDelta.length; i++) {
            const { iso, delta } = withDelta[i]
            // Цена ДО этого изменения (начальная для этой даты)
            const priceBefore = priceStack[withDelta.length - i]
            // Цена ПОСЛЕ (= priceBefore * (1 + delta/100))
            const priceAfter = Math.round(priceBefore * (1 + delta / 100))
            priceChanges.push({
              sku_ms: skuMs,
              sku_wb: skuWbNum,
              price_date: iso!,
              price: priceAfter,
              delta_pct: delta,
            })
          }

          // Также записываем цену на snap_date (конец периода)
          const snapKey = snapDateISO
          const alreadyHasSnap = priceChanges.some(
            p => p.sku_wb === skuWbNum && p.price_date === snapKey
          )
          if (!alreadyHasSnap) {
            priceChanges.push({
              sku_ms: skuMs,
              sku_wb: skuWbNum,
              price_date: snapDateISO,
              price: basePrice,
              delta_pct: null,
            })
          }
        } else {
          // Нет изменений — записываем только snap_date цену
          priceChanges.push({
            sku_ms: skuMs,
            sku_wb: skuWbNum,
            price_date: snapDateISO,
            price: basePrice,
            delta_pct: null,
          })
        }
      }
    }
  }

  const blockDiag = (b: { headerCol: number; dateCols: number[] } | null) =>
    b ? { headerCol: b.headerCol, dateCols: b.dateCols, dates: b.dateCols.map(c => excelToISO(headerRow[c] as number) ?? String(headerRow[c])) } : null

  return {
    daily,
    priceChanges,
    rows_parsed: daily.length / Math.max(dateCols.length, 1),
    rows_skipped: skipped,
    skipped_skus: skippedSkus,
    diag_service_rows: skippedService,
    diag_blocks: {
      priceCol,
      priceChangeBlock: blockDiag(priceChangeBlock),
      revenueBlock: blockDiag(revenueBlock),
      ctrBlock: blockDiag(ctrBlock),
      adSpendBlock: blockDiag(adSpendBlock),
      snapDateISO,
      row0_sample: groupRow.slice(80, 95).map((v, i) => ({ col: 80 + i, val: v })),
      row1_sample: headerRow.slice(80, 95).map((v, i) => ({ col: 80 + i, val: v })),
    },
  }
}
