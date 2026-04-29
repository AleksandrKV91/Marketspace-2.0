import { readWorkbook, sheetToRows, toNum, excelToISO, parseDateVal } from './utils'

// ──────────────────────────────────────────────────────────────────
// Парсер «Отчёт по SKU с расчётами» (новый формат, xlsb/xlsx)
//
// Шапка из 3 строк:
//   row1 — название блока (объединённые ячейки)
//   row2 — Total/средневзвешенное по блоку
//   row3 — детализация (Excel-дата для дневных колонок)
// Строки 4+ — данные по SKU.
//
// Все ключевые показатели УЖЕ посчитаны в Excel — парсер ничего не пересчитывает.
//
// Особенности:
//   • колонка A = sku_wb (артикул WB), резолвим sku_ms через skuMap
//   • даты внутри блоков идут в разном порядке (одни — убывают, другие — возрастают);
//     порядок определяется по row3 для каждой колонки индивидуально.
//   • CPM/CPC — без агрегата Total (period_*_wgt считаем = AVG(daily) при необходимости)
//   • CJ-CN — изменение цены %, CP-CT — цена после изменения, CO/CU — средние за период
// ──────────────────────────────────────────────────────────────────

export interface SkuDailyRow {
  sku_ms: string
  metric_date: string
  upload_id?: string
  revenue: number | null
  ad_spend: number | null
  sales_qty: number | null
  cost_sum: number | null
  margin_rub: number | null
  chmd_rub: number | null
  drr_total: number | null
  drr_ad: number | null
  ctr: number | null
  cr_cart: number | null
  cr_order: number | null
  cpm: number | null
  cpc: number | null
  ad_order_share: number | null
  marginality: number | null
  chmd_pct: number | null
  price: number | null
}

export interface SkuPeriodRow {
  sku_ms: string
  period_start: string
  period_end: string
  upload_id?: string

  sku_wb: number | null
  category: string | null
  subject_wb: string | null
  product_name: string | null
  brand: string | null
  manager: string | null
  novelty_status: string | null
  season: string | null
  shelf_date: string | null

  fbo_wb: number | null
  fbs_pushkino: number | null
  fbs_smolensk: number | null
  kits_qty: number | null
  stock_days: number | null
  days_until_arrival: number | null
  oos_buffer_days: number | null

  price: number | null
  cost_unit: number | null

  plan_supply_date: string | null
  plan_supply_qty: number | null

  plan_ad_spend: number | null
  plan_drr: number | null

  period_revenue: number | null
  period_ad_spend: number | null
  period_sales_qty: number | null
  period_cost_sum: number | null
  period_margin_rub: number | null
  period_chmd_rub: number | null
  period_drr_total_wgt: number | null
  period_drr_ad_wgt: number | null
  period_ctr_wgt: number | null
  period_cr_cart_wgt: number | null
  period_cr_order_wgt: number | null
  period_cpm_wgt: number | null
  period_cpc_wgt: number | null
  period_ad_order_share_wgt: number | null
  period_marginality_wgt: number | null
  period_chmd_pct_wgt: number | null
}

export interface SkuPriceChangeRow {
  sku_ms: string | null
  sku_wb: number
  price_date: string
  price: number | null         // цена после изменения
  price_before: number | null
  delta_pct: number | null
  ctr_change: number | null
  cr_change: number | null
}

export interface ParseSkuReportResult {
  daily: SkuDailyRow[]
  period: SkuPeriodRow[]
  priceChanges: SkuPriceChangeRow[]
  rows_parsed: number
  rows_skipped: number
  skipped_skus: string[]
  period_start: string | null
  period_end: string | null
}

// ── Зашитые column-индексы (формат файла стабильный) ─────────────────

const COL = {
  sku_wb: 0,         // A
  category: 1,       // B
  subject_wb: 2,     // C
  product_name: 3,   // D
  brand: 4,          // E
  shelf_date: 5,     // F
  manager: 6,        // G
  novelty_status: 8, // I
  season: 9,         // J

  // Period totals (row2 значения берутся из заголовка)
  period_ad_spend: 10,         // K row2
  period_revenue: 30,          // AE row2
  period_drr_total_wgt: 36,    // AK row2
  period_drr_ad_wgt: 42,       // AQ row2
  period_ctr_wgt: 48,          // AW row2
  period_cr_cart_wgt: 54,      // BC row2
  period_cr_order_wgt: 60,     // BI row2
  period_ad_order_share_wgt: 79, // CB row2
  period_sales_qty: 99,        // CV row2
  period_cost_sum: 105,        // DB row2
  cost_unit: 106,              // DC (себестоимость единицы — берём из строки данных)
  period_margin_rub: 112,      // DI row2
  period_chmd_rub: 118,        // DO row2
  period_marginality_wgt: 124, // DU row2
  period_chmd_pct_wgt: 130,    // EA row2

  // Snapshot (берётся из строки данных)
  fbo_wb: 16,            // Q
  fbs_pushkino: 17,      // R
  fbs_smolensk: 18,      // S
  kits_qty: 19,          // T
  stock_days: 20,        // U
  days_until_arrival: 21, // V
  oos_buffer_days: 22,   // W
  // X=23, Y=24, Z=25 — не используем (по плану)
  // AA=26 — СПП, не используем
  plan_ad_spend: 27,     // AB
  plan_drr: 28,          // AC
  // AD=29 — не используем

  price: 66,             // BO
  plan_supply_date: 85,  // CH (excel date в row4)
  plan_supply_qty: 86,   // CI

  // Daily 5-day blocks — индексы колонок 5 дней (порядок дат — из row3)
  daily_ad_spend: [11, 12, 13, 14, 15],          // L-P
  daily_revenue: [31, 32, 33, 34, 35],           // AF-AJ
  daily_drr_total: [37, 38, 39, 40, 41],
  daily_drr_ad: [43, 44, 45, 46, 47],
  daily_ctr: [49, 50, 51, 52, 53],
  daily_cr_cart: [55, 56, 57, 58, 59],
  daily_cr_order: [61, 62, 63, 64, 65],
  daily_cpm: [68, 69, 70, 71, 72],               // BQ-BU
  daily_cpc: [74, 75, 76, 77, 78],               // BW-CA
  daily_ad_order_share: [80, 81, 82, 83, 84],    // CC-CG
  daily_price_change_pct: [87, 88, 89, 90, 91],  // CJ-CN
  daily_price_after: [93, 94, 95, 96, 97],       // CP-CT
  daily_sales_qty: [100, 101, 102, 103, 104],    // CW-DA
  daily_cost_sum: [107, 108, 109, 110, 111],     // DD-DH
  daily_margin_rub: [113, 114, 115, 116, 117],   // DJ-DN
  daily_chmd_rub: [119, 120, 121, 122, 123],     // DP-DT
  daily_marginality: [125, 126, 127, 128, 129],  // DV-DZ
  daily_chmd_pct: [131, 132, 133, 134, 135],     // EB-EF
}

const HEADER_ROWS = 3 // три строки шапки

function readDateMap(headerRow3: unknown[], cols: number[]): (string | null)[] {
  return cols.map(c => excelToISO(headerRow3[c]) || null)
}

function strOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

export function parseSkuReport(buffer: ArrayBuffer, skuMap?: Map<string, string>): ParseSkuReportResult {
  const wb = readWorkbook(buffer)
  const sheetName = wb.SheetNames[0]
  const rows = sheetToRows(wb, sheetName)

  if (rows.length < HEADER_ROWS + 1) {
    return {
      daily: [], period: [], priceChanges: [],
      rows_parsed: 0, rows_skipped: 0, skipped_skus: [],
      period_start: null, period_end: null,
    }
  }

  const row3 = rows[2] // даты

  // Определяем даты для дневных блоков (используем revenue-блок как референс — нумерация дат стабильна для большинства блоков с убывающим порядком)
  const datesAdSpend = readDateMap(row3, COL.daily_ad_spend)
  const datesSales = readDateMap(row3, COL.daily_sales_qty)
  const datesPriceChange = readDateMap(row3, COL.daily_price_change_pct)

  // Период: min/max от всех дат
  const allDates = [...datesAdSpend, ...datesSales, ...datesPriceChange].filter((d): d is string => !!d)
  const periodStart = allDates.length > 0 ? allDates.reduce((a, b) => a < b ? a : b) : null
  const periodEnd = allDates.length > 0 ? allDates.reduce((a, b) => a > b ? a : b) : null

  // Period totals — берутся из row2
  const row2 = rows[1]
  const periodTotals = {
    ad_spend: toNum(row2[COL.period_ad_spend]),
    revenue: toNum(row2[COL.period_revenue]),
    drr_total: toNum(row2[COL.period_drr_total_wgt]),
    drr_ad: toNum(row2[COL.period_drr_ad_wgt]),
    ctr: toNum(row2[COL.period_ctr_wgt]),
    cr_cart: toNum(row2[COL.period_cr_cart_wgt]),
    cr_order: toNum(row2[COL.period_cr_order_wgt]),
    ad_order_share: toNum(row2[COL.period_ad_order_share_wgt]),
    sales_qty: toNum(row2[COL.period_sales_qty]),
    cost_sum: toNum(row2[COL.period_cost_sum]),
    margin_rub: toNum(row2[COL.period_margin_rub]),
    chmd_rub: toNum(row2[COL.period_chmd_rub]),
    marginality: toNum(row2[COL.period_marginality_wgt]),
    chmd_pct: toNum(row2[COL.period_chmd_pct_wgt]),
  }
  // Note: row2 totals — общие по всем SKU, они не нужны per-SKU.
  // Per-SKU period_* поля считаем как SUM(daily_*) в коде ниже.
  void periodTotals

  const daily: SkuDailyRow[] = []
  const period: SkuPeriodRow[] = []
  const priceChanges: SkuPriceChangeRow[] = []
  const skippedSkus: string[] = []

  for (let r = HEADER_ROWS; r < rows.length; r++) {
    const row = rows[r]
    if (!row || row.length === 0) continue

    const skuWb = toNum(row[COL.sku_wb])
    if (!skuWb) continue // пустая или служебная строка

    // Если маппинга нет — используем строку sku_wb как идентификатор.
    // Данные не теряются; для диагностики записываем в skipped_skus.
    const skuMs = skuMap?.get(String(skuWb)) ?? String(skuWb)
    if (skuMap && skuMap.size > 0 && !skuMap.has(String(skuWb))) {
      skippedSkus.push(String(skuWb))
    }

    if (!periodStart || !periodEnd) continue

    // ── PERIOD row ────────────────────────────────────────────────
    // Считаем агрегаты как SUM(daily) — они в файле есть и должны сходиться с row2.
    const sumBlock = (cols: number[]): number | null => {
      let sum = 0
      let any = false
      for (const c of cols) {
        const v = toNum(row[c])
        if (v !== null) { sum += v; any = true }
      }
      return any ? sum : null
    }
    // Для weighted — используем revenue как вес там где есть, иначе просто среднее
    const avgWeighted = (cols: number[], weightCols: number[]): number | null => {
      let num = 0, den = 0
      for (let i = 0; i < cols.length; i++) {
        const v = toNum(row[cols[i]])
        const w = toNum(row[weightCols[i]]) ?? 0
        if (v !== null && w > 0) { num += v * w; den += w }
      }
      return den > 0 ? num / den : null
    }
    const avgSimple = (cols: number[]): number | null => {
      const xs = cols.map(c => toNum(row[c])).filter((x): x is number => x !== null)
      return xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : null
    }

    period.push({
      sku_ms: skuMs,
      period_start: periodStart,
      period_end: periodEnd,
      sku_wb: skuWb,
      category: strOrNull(row[COL.category]),
      subject_wb: strOrNull(row[COL.subject_wb]),
      product_name: strOrNull(row[COL.product_name]),
      brand: strOrNull(row[COL.brand]),
      manager: strOrNull(row[COL.manager]),
      novelty_status: strOrNull(row[COL.novelty_status]),
      season: strOrNull(row[COL.season]),
      shelf_date: parseDateVal(row[COL.shelf_date]),
      fbo_wb: toNum(row[COL.fbo_wb]),
      fbs_pushkino: toNum(row[COL.fbs_pushkino]),
      fbs_smolensk: toNum(row[COL.fbs_smolensk]),
      kits_qty: toNum(row[COL.kits_qty]),
      stock_days: toNum(row[COL.stock_days]),
      days_until_arrival: toNum(row[COL.days_until_arrival]),
      oos_buffer_days: toNum(row[COL.oos_buffer_days]),
      price: toNum(row[COL.price]),
      cost_unit: toNum(row[COL.cost_unit]),
      plan_supply_date: parseDateVal(row[COL.plan_supply_date]),
      plan_supply_qty: toNum(row[COL.plan_supply_qty]),
      plan_ad_spend: toNum(row[COL.plan_ad_spend]),
      plan_drr: toNum(row[COL.plan_drr]),
      period_revenue: sumBlock(COL.daily_revenue),
      period_ad_spend: sumBlock(COL.daily_ad_spend),
      period_sales_qty: sumBlock(COL.daily_sales_qty),
      period_cost_sum: sumBlock(COL.daily_cost_sum),
      period_margin_rub: sumBlock(COL.daily_margin_rub),
      period_chmd_rub: sumBlock(COL.daily_chmd_rub),
      // weighted by revenue
      period_drr_total_wgt: avgWeighted(COL.daily_drr_total, COL.daily_revenue),
      period_drr_ad_wgt: avgWeighted(COL.daily_drr_ad, COL.daily_revenue),
      period_ctr_wgt: avgWeighted(COL.daily_ctr, COL.daily_revenue),
      period_cr_cart_wgt: avgWeighted(COL.daily_cr_cart, COL.daily_revenue),
      period_cr_order_wgt: avgWeighted(COL.daily_cr_order, COL.daily_revenue),
      period_ad_order_share_wgt: avgWeighted(COL.daily_ad_order_share, COL.daily_revenue),
      period_marginality_wgt: avgWeighted(COL.daily_marginality, COL.daily_revenue),
      period_chmd_pct_wgt: avgWeighted(COL.daily_chmd_pct, COL.daily_revenue),
      // CPM/CPC — простое среднее (нет показов)
      period_cpm_wgt: avgSimple(COL.daily_cpm),
      period_cpc_wgt: avgSimple(COL.daily_cpc),
    })

    // ── DAILY rows ───────────────────────────────────────────────
    for (let i = 0; i < 5; i++) {
      const date = datesAdSpend[i]
      if (!date) continue
      // Для каждой колонки в каждом блоке — найдём индекс с этой датой.
      // Это нужно потому что порядок дат разный для разных блоков.
      const findColForDate = (cols: number[], dates: (string | null)[]) => {
        const idx = dates.indexOf(date)
        return idx >= 0 ? cols[idx] : -1
      }

      const colRev = findColForDate(COL.daily_revenue, readDateMap(row3, COL.daily_revenue))
      const colDrrT = findColForDate(COL.daily_drr_total, readDateMap(row3, COL.daily_drr_total))
      const colDrrA = findColForDate(COL.daily_drr_ad, readDateMap(row3, COL.daily_drr_ad))
      const colCtr = findColForDate(COL.daily_ctr, readDateMap(row3, COL.daily_ctr))
      const colCrCart = findColForDate(COL.daily_cr_cart, readDateMap(row3, COL.daily_cr_cart))
      const colCrOrd = findColForDate(COL.daily_cr_order, readDateMap(row3, COL.daily_cr_order))
      const colCpm = findColForDate(COL.daily_cpm, readDateMap(row3, COL.daily_cpm))
      const colCpc = findColForDate(COL.daily_cpc, readDateMap(row3, COL.daily_cpc))
      const colAdOS = findColForDate(COL.daily_ad_order_share, readDateMap(row3, COL.daily_ad_order_share))
      const colSales = findColForDate(COL.daily_sales_qty, readDateMap(row3, COL.daily_sales_qty))
      const colCost = findColForDate(COL.daily_cost_sum, readDateMap(row3, COL.daily_cost_sum))
      const colMargin = findColForDate(COL.daily_margin_rub, readDateMap(row3, COL.daily_margin_rub))
      const colChmd = findColForDate(COL.daily_chmd_rub, readDateMap(row3, COL.daily_chmd_rub))
      const colMargty = findColForDate(COL.daily_marginality, readDateMap(row3, COL.daily_marginality))
      const colChmdPct = findColForDate(COL.daily_chmd_pct, readDateMap(row3, COL.daily_chmd_pct))
      const colPrice = findColForDate(COL.daily_price_after, readDateMap(row3, COL.daily_price_after))

      daily.push({
        sku_ms: skuMs,
        metric_date: date,
        ad_spend: toNum(row[COL.daily_ad_spend[i]]),
        revenue: colRev >= 0 ? toNum(row[colRev]) : null,
        drr_total: colDrrT >= 0 ? toNum(row[colDrrT]) : null,
        drr_ad: colDrrA >= 0 ? toNum(row[colDrrA]) : null,
        ctr: colCtr >= 0 ? toNum(row[colCtr]) : null,
        cr_cart: colCrCart >= 0 ? toNum(row[colCrCart]) : null,
        cr_order: colCrOrd >= 0 ? toNum(row[colCrOrd]) : null,
        cpm: colCpm >= 0 ? toNum(row[colCpm]) : null,
        cpc: colCpc >= 0 ? toNum(row[colCpc]) : null,
        ad_order_share: colAdOS >= 0 ? toNum(row[colAdOS]) : null,
        sales_qty: colSales >= 0 ? toNum(row[colSales]) : null,
        cost_sum: colCost >= 0 ? toNum(row[colCost]) : null,
        margin_rub: colMargin >= 0 ? toNum(row[colMargin]) : null,
        chmd_rub: colChmd >= 0 ? toNum(row[colChmd]) : null,
        marginality: colMargty >= 0 ? toNum(row[colMargty]) : null,
        chmd_pct: colChmdPct >= 0 ? toNum(row[colChmdPct]) : null,
        price: colPrice >= 0 ? toNum(row[colPrice]) : null,
      })
    }

    // ── PRICE CHANGES ───────────────────────────────────────────
    // Блок CJ-CN: дельта % по дням; CP-CT: цена после изменения.
    // Записываем только дни с ненулевой дельтой.
    for (let i = 0; i < 5; i++) {
      const date = datesPriceChange[i]
      if (!date) continue
      const delta = toNum(row[COL.daily_price_change_pct[i]])
      const priceAfter = toNum(row[COL.daily_price_after[i]])
      if (delta === null || delta === 0) continue
      // priceBefore = priceAfter / (1 + delta), при условии что delta — дробь
      const deltaFraction = Math.abs(delta) > 1 ? delta / 100 : delta
      const priceBefore = priceAfter !== null && (1 + deltaFraction) !== 0
        ? priceAfter / (1 + deltaFraction)
        : null
      priceChanges.push({
        sku_ms: skuMs,
        sku_wb: skuWb,
        price_date: date,
        price: priceAfter,
        price_before: priceBefore !== null ? Math.round(priceBefore) : null,
        delta_pct: deltaFraction,
        ctr_change: null, // в файле есть «Изменение CTR»? пока не находим — оставляем null
        cr_change: null,
      })
    }
  }

  return {
    daily, period, priceChanges,
    rows_parsed: period.length,
    rows_skipped: skippedSkus.length,
    skipped_skus: skippedSkus,
    period_start: periodStart,
    period_end: periodEnd,
  }
}
