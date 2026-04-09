/**
 * parser.ts — парсер WB-выгрузки (формат «Хотелки по новинкам»)
 *
 * Структура файла (проверено на реальном файле):
 *   Строка 1 — названия групп колонок
 *   Строка 2 — заголовки: текстовые названия или числа (Excel serial dates)
 *   Строки 3+ — данные SKU
 *
 * Временны́е серии идут от НОВЫХ к СТАРЫМ (09→05),
 * кроме изменений цен (93-97): от СТАРЫХ к НОВЫМ (05→09).
 * Плановые цены (99-129) — весь месяц 01-31.
 *
 * ВАЖНО про даты:
 *   Ячейки с датами имеют формат 'd/m' (без года).
 *   xlsx.js с cellDates:true возвращает Date со сдвигом timezone (UTC vs MSK).
 *   Правильное решение: читать без cellDates, получать числовой Excel serial,
 *   конвертировать через excelSerialToISO() — без timezone-сдвига.
 */

import * as XLSX from 'xlsx'

// ─── Типы ────────────────────────────────────────────────────

export interface DayMetric {
  date: string        // ISO 'YYYY-MM-DD'
  ad_spend: number
  revenue: number
  drr_total: number
  drr_ad: number
  ctr: number
  cr_cart: number
  cr_order: number
  cpm: number
  cpc: number
  ad_order_share: number
  spp: number
  position_median: number
}

export interface PriceChange {
  date: string
  change_pct: number  // дробное, 0.05 = +5%
  note: string        // 'выкл рекл' или ''
}

export interface SupplyRow {
  supply_date: string | null
  qty_plan: number
}

export interface ParsedSKU {
  // Характеристики
  sku_id: number
  category: string
  subject: string
  name: string
  brand: string
  shelf_date: string | null
  manager: string
  manager_ng: string
  novelty_status: string
  season: string

  // Срез (snapshot)
  stock_fbo: number
  stock_fbs_pushkino: number
  stock_fbs_smolensk: number
  stock_kits: number
  stock_days: number
  days_to_arrival: number
  ots_reserve_days: number
  margin_rub: number
  margin_pct: number
  chmd_5d: number
  spend_plan: number
  drr_plan: number
  revenue_plan: number
  price: number
  spp: number
  wb_rating: number
  buyout_pct: number

  // 5-дневные агрегаты (из колонок «X за 5 дней»)
  spend_5d: number
  revenue_5d: number
  drr_total_5d: number
  drr_ad_5d: number
  ctr_5d: number
  cr_cart_5d: number
  cr_order_5d: number
  cpm_5d: number
  cpc_5d: number
  ad_order_share_5d: number

  // Временны́е ряды
  daily: DayMetric[]          // 5 дней, отсортированы от старых к новым
  price_changes: PriceChange[] // факт (5 дней) + план (до конца месяца)
  supply: SupplyRow[]
}

export interface ParseResult {
  sheet_name: string
  period_start: string   // ISO дата самого раннего дня в серии
  period_end: string     // ISO дата самого позднего дня
  rows: ParsedSKU[]
}

// ─── Вспомогательные функции ─────────────────────────────────

/**
 * Конвертирует Excel serial number в ISO дату 'YYYY-MM-DD'.
 * Работает без timezone-сдвига — даты хранятся как целые числа,
 * конвертируем через UTC чтобы не зависеть от локального времени машины.
 *
 * Excel epoch: 1 = 1900-01-01 (с историческим багом: 1900 считается високосным).
 * Unix epoch (ms): 0 = 1970-01-01.
 * Разница: 25569 дней.
 */
function excelSerialToISO(serial: number): string {
  const d = new Date(0)
  d.setUTCDate(d.getUTCDate() + serial - 25569)
  return d.toISOString().slice(0, 10)
}

function toDate(v: unknown): string | null {
  if (!v) return null
  // Числовой Excel serial (основной случай — читаем без cellDates)
  if (typeof v === 'number' && v > 40000 && v < 60000) {
    return excelSerialToISO(v)
  }
  // На случай если где-то придёт Date объект
  if (v instanceof Date) {
    // Берём UTC-компоненты чтобы избежать timezone-сдвига
    const y = v.getUTCFullYear()
    const m = String(v.getUTCMonth() + 1).padStart(2, '0')
    const d = String(v.getUTCDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  // ISO строка
  if (typeof v === 'string' && v.match(/^\d{4}-\d{2}-\d{2}/)) return v.slice(0, 10)
  return null
}

function toNum(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0
  const n = Number(v)
  return isFinite(n) ? n : 0
}

function toStr(v: unknown): string {
  if (v === null || v === undefined) return ''
  return String(v).trim()
}

/**
 * Читает серию дат и значений из одной строки данных.
 * headerRow[colIdx] — Date объекты.
 * Возвращает Map<'YYYY-MM-DD', number>.
 */
function readDateSeries(
  dataRow: unknown[],
  headerRow: unknown[],
  startCol: number,  // 0-based
  count: number
): Map<string, number> {
  const map = new Map<string, number>()
  for (let i = 0; i < count; i++) {
    const col = startCol + i
    const dateVal = headerRow[col]
    const date = toDate(dateVal)
    if (!date) continue
    map.set(date, toNum(dataRow[col]))
  }
  return map
}

// ─── Основная функция ────────────────────────────────────────

export function parseWBExcel(buffer: ArrayBuffer): ParseResult {
  // Читаем БЕЗ cellDates — даты остаются числовыми Excel serials.
  // Это единственный способ получить правильные даты без timezone-сдвига
  // когда формат ячейки 'd/m' (день/месяц без года).
  const wb = XLSX.read(new Uint8Array(buffer), {
    type: 'array',
    raw: true,       // не парсим типы — берём числа как числа
    cellDates: false, // НЕ конвертируем в Date объекты
  })

  // Берём первый лист типа «Лист6» / «Лист7»
  const sheetName =
    wb.SheetNames.find(n => /Лист\d/.test(n)) ?? wb.SheetNames[0]
  const ws = wb.Sheets[sheetName]

  // Конвертируем в массив массивов (0-based индексы)
  // raw: true — числа остаются числами, строки строками, Excel serials числами
  const rawDates = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    defval: null,
    raw: true,
  })

  // Строка 0 (индекс 0) — группы, строка 1 (индекс 1) — заголовки
  const groupRow  = rawDates[0] as unknown[]
  const headerRow = rawDates[1] as unknown[]

  // ── Точная карта колонок (0-based) ──────────────────────────
  // Проверена на реальном файле 14 марта 2026.
  // При изменении формата WB — обновить эти константы.

  // ── Автодетект формата: определяем сдвиг по реальному положению "Затраты план" ──
  // В базовом формате: col 32 = "Затраты план"
  // Если колонки сдвинулись — ищем по заголовку
  const pos = (() => {
    // Ищем "Затраты план" в строке заголовков (headerRow) в диапазоне 27-40
    for (let ci = 27; ci < 40; ci++) {
      const h = String(headerRow[ci] ?? '').toLowerCase()
      if (h.includes('затраты план') || h.includes('spend plan')) {
        return ci - 32  // сдвиг относительно базового col 32
      }
    }
    // Fallback: ищем в groupRow
    for (let ci = 27; ci < 40; ci++) {
      const g = String(groupRow[ci] ?? '').toLowerCase()
      if (g.includes('планирован')) {
        return ci - 32
      }
    }
    return 0  // базовый формат
  })()

  const C = {
    // Характеристики SKU (0-based = номер колонки Excel − 1)
    SKU:            0,   // col 1
    CATEGORY:       1,
    SUBJECT:        2,
    NAME:           3,
    BRAND:          4,
    SHELF_DATE:     5,
    MANAGER:        6,
    MANAGER_NG:     7,
    NOVELTY_STATUS: 8,
    SEASON:         9,

    // Затраты: col 11 = агрегат, col 12-16 = 5 дней (09→05)
    SPEND_5D_AGG:   10,  // агрегат
    SPEND_DAYS:     11,  // start 0-based, count=5

    // Остатки
    STOCK_FBO:      16,
    STOCK_FBS_P:    17,
    STOCK_FBS_S:    18,
    STOCK_KITS:     19,
    STOCK_DAYS:     20,
    DAYS_TO_ARR:    21,
    OTS_RESERVE:    22,

    // Маржа
    MARGIN_RUB:     23,
    MARGIN_PCT:     24,
    CHMD_5D:        25,

    // СПП: col 27 (дата последнего дня серии — парсер берёт значение, не дату)
    SPP:            26,

    // Рейтинг WB и % выкупа: col 28-29 (AB-AC) — могут быть пустыми
    WB_RATING:      27,
    BUYOUT_PCT:     28,

    // Позиция: ищем динамически — col 27+pos если pos<0, иначе 29
    // (в новом формате позиций нет, возвращаем 0)
    POS_LATEST:     pos < 0 ? 26 : 29,

    // Планирование (сдвиг если нет позиционных колонок)
    SPEND_PLAN:     32 + pos,
    DRR_PLAN:       33 + pos,
    REVENUE_PLAN:   34 + pos,

    // Выручка: агрегат + 5 дней
    REVENUE_5D_AGG: 35 + pos,
    REVENUE_DAYS:   36 + pos,

    // ДРР Total
    DRR_TOTAL_AGG:  41 + pos,
    DRR_TOTAL_DAYS: 42 + pos,

    // ДРР Рекламный
    DRR_AD_AGG:     47 + pos,
    DRR_AD_DAYS:    48 + pos,

    // CTR
    CTR_AGG:        53 + pos,
    CTR_DAYS:       54 + pos,

    // CR корзина
    CR_CART_AGG:    59 + pos,
    CR_CART_DAYS:   60 + pos,

    // CR заказ
    CR_ORDER_AGG:   65 + pos,
    CR_ORDER_DAYS:  66 + pos,

    // Цена
    PRICE:          71 + pos,

    // CPM
    CPM_AGG:        72 + pos,
    CPM_DAYS:       73 + pos,

    // CPC
    CPC_AGG:        78 + pos,
    CPC_DAYS:       79 + pos,

    // Доля рекл заказов
    AD_SHARE_AGG:   84 + pos,
    AD_SHARE_DAYS:  85 + pos,

    // Поставка
    SUPPLY_DATE:    90 + pos,
    SUPPLY_QTY:     91 + pos,

    // Изменения цены факт
    PRICE_CHG_DAYS: 92 + pos,
    PRICE_CHG_AGG:  97 + pos,

    // Плановые изменения цены
    PRICE_PLAN_START: 98 + pos,
  }

  const DAYS_COUNT = 5

  // Находим даты в серии затрат (самые надёжные)
  // Они идут от новых к старым, нам нужны для сортировки
  const seriesDates: string[] = []
  for (let i = 0; i < DAYS_COUNT; i++) {
    const d = toDate(headerRow[C.SPEND_DAYS + i])
    if (d) seriesDates.push(d)
  }
  seriesDates.sort() // ascending

  const period_start = seriesDates[0] ?? ''
  const period_end   = seriesDates[seriesDates.length - 1] ?? ''

  // ── Парсим строки данных ─────────────────────────────────────
  const rows: ParsedSKU[] = []

  for (let r = 2; r < rawDates.length; r++) {
    const row = rawDates[r] as unknown[]
    const skuRaw = row[C.SKU]
    if (!skuRaw || typeof skuRaw !== 'number') continue

    const sku_id = Math.round(skuRaw)

    // Временны́е серии метрик
    const spendSeries   = readDateSeries(row, headerRow, C.SPEND_DAYS,    DAYS_COUNT)
    const revenueSeries = readDateSeries(row, headerRow, C.REVENUE_DAYS,  DAYS_COUNT)
    const drrTotalSeries= readDateSeries(row, headerRow, C.DRR_TOTAL_DAYS,DAYS_COUNT)
    const drrAdSeries   = readDateSeries(row, headerRow, C.DRR_AD_DAYS,   DAYS_COUNT)
    const ctrSeries     = readDateSeries(row, headerRow, C.CTR_DAYS,      DAYS_COUNT)
    const crCartSeries  = readDateSeries(row, headerRow, C.CR_CART_DAYS,  DAYS_COUNT)
    const crOrderSeries = readDateSeries(row, headerRow, C.CR_ORDER_DAYS, DAYS_COUNT)
    const cpmSeries     = readDateSeries(row, headerRow, C.CPM_DAYS,      DAYS_COUNT)
    const cpcSeries     = readDateSeries(row, headerRow, C.CPC_DAYS,      DAYS_COUNT)
    const adShareSeries = readDateSeries(row, headerRow, C.AD_SHARE_DAYS, DAYS_COUNT)

    // Позиции по дням (col 28-32, первая = последний день)
    // col 27=СПП, col 28=позиция_09, col 29=08, col 30=07, col 31=06, col 32=05
    const posSeries = readDateSeries(row, headerRow, C.POS_LATEST, DAYS_COUNT)

    // Собираем daily (сортировка от старых к новым)
    const allDates = new Set([...seriesDates])
    const daily: DayMetric[] = [...allDates].sort().map(date => ({
      date,
      ad_spend:       spendSeries.get(date)    ?? 0,
      revenue:        revenueSeries.get(date)  ?? 0,
      drr_total:      drrTotalSeries.get(date) ?? 0,
      drr_ad:         drrAdSeries.get(date)    ?? 0,
      ctr:            ctrSeries.get(date)      ?? 0,
      cr_cart:        crCartSeries.get(date)   ?? 0,
      cr_order:       crOrderSeries.get(date)  ?? 0,
      cpm:            cpmSeries.get(date)      ?? 0,
      cpc:            cpcSeries.get(date)      ?? 0,
      ad_order_share: adShareSeries.get(date)  ?? 0,
      spp:            toNum(row[C.SPP]),        // одно значение на все дни
      position_median:posSeries.get(date)      ?? 0,
    }))

    // Изменения цены (факт: col 93-97, порядок 05→09)
    const price_changes: PriceChange[] = []

    // Факт (5 дней)
    for (let i = 0; i < DAYS_COUNT; i++) {
      const col = C.PRICE_CHG_DAYS + i
      const date = toDate(headerRow[col])
      const val  = row[col]
      if (!date) continue
      if (val === null || val === undefined || val === '') continue
      if (typeof val === 'string') {
        price_changes.push({ date, change_pct: 0, note: val.trim() })
      } else {
        const n = toNum(val)
        if (n !== 0) price_changes.push({ date, change_pct: n, note: '' })
      }
    }

    // Плановые (до конца месяца, col 99-129)
    for (let i = 0; i < 31; i++) {
      const col = C.PRICE_PLAN_START + i
      if (col >= headerRow.length) break
      const date = toDate(headerRow[col])
      const val  = row[col]
      if (!date) continue
      if (val === null || val === undefined || val === '') continue
      if (typeof val === 'string') {
        price_changes.push({ date, change_pct: 0, note: val.trim() })
      } else {
        const n = toNum(val)
        if (n !== 0) price_changes.push({ date, change_pct: n, note: '' })
      }
    }

    // Поставки
    const supply: SupplyRow[] = []
    const supplyQty = toNum(row[C.SUPPLY_QTY])
    if (supplyQty > 0) {
      supply.push({
        supply_date: toDate(row[C.SUPPLY_DATE]),
        qty_plan: supplyQty,
      })
    }

    rows.push({
      sku_id,
      category:       toStr(row[C.CATEGORY]),
      subject:        toStr(row[C.SUBJECT]),
      name:           toStr(row[C.NAME]),
      brand:          toStr(row[C.BRAND]),
      shelf_date:     toDate(row[C.SHELF_DATE]),
      manager:        toStr(row[C.MANAGER]),
      manager_ng:     toStr(row[C.MANAGER_NG]),
      novelty_status: toStr(row[C.NOVELTY_STATUS]),
      season:         toStr(row[C.SEASON]),

      stock_fbo:          Math.round(toNum(row[C.STOCK_FBO])),
      stock_fbs_pushkino: Math.round(toNum(row[C.STOCK_FBS_P])),
      stock_fbs_smolensk: Math.round(toNum(row[C.STOCK_FBS_S])),
      stock_kits:         Math.round(toNum(row[C.STOCK_KITS])),
      stock_days:         Math.round(toNum(row[C.STOCK_DAYS])),
      days_to_arrival:    Math.round(toNum(row[C.DAYS_TO_ARR])),
      ots_reserve_days:   Math.round(toNum(row[C.OTS_RESERVE])),
      margin_rub:     toNum(row[C.MARGIN_RUB]),
      margin_pct:     toNum(row[C.MARGIN_PCT]),
      chmd_5d:        toNum(row[C.CHMD_5D]),
      spend_plan:     toNum(row[C.SPEND_PLAN]),
      drr_plan:       toNum(row[C.DRR_PLAN]),
      revenue_plan:   toNum(row[C.REVENUE_PLAN]),
      price:          toNum(row[C.PRICE]),
      spp:            toNum(row[C.SPP]),
      wb_rating:      toNum(row[C.WB_RATING]),
      buyout_pct:     toNum(row[C.BUYOUT_PCT]),

      spend_5d:           toNum(row[C.SPEND_5D_AGG]),
      revenue_5d:         toNum(row[C.REVENUE_5D_AGG]),
      drr_total_5d:       toNum(row[C.DRR_TOTAL_AGG]),
      drr_ad_5d:          toNum(row[C.DRR_AD_AGG]),
      ctr_5d:             toNum(row[C.CTR_AGG]),
      cr_cart_5d:         toNum(row[C.CR_CART_AGG]),
      cr_order_5d:        toNum(row[C.CR_ORDER_AGG]),
      cpm_5d:             toNum(row[C.CPM_AGG]),
      cpc_5d:             toNum(row[C.CPC_AGG]),
      ad_order_share_5d:  toNum(row[C.AD_SHARE_AGG]),

      daily,
      price_changes,
      supply,
    })
  }

  return { sheet_name: sheetName, period_start, period_end, rows }
}
