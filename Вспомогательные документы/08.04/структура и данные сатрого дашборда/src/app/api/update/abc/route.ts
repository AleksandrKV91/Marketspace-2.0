/**
 * src/app/api/update/abc/route.ts
 *
 * POST /api/update/abc
 * Парсит файл «АВС анализ МС» (листы АВС расшифровка + Sheet2) и сохраняет в Supabase:
 *   - abc_analysis: классы, рентабельность, GMROI, выручка, оборачиваемость
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'

export const maxDuration = 30

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function sf(v: unknown): number | null {
  const n = parseFloat(String(v))
  return isNaN(n) || !isFinite(n) ? null : n
}
function si(v: unknown): number | null {
  const n = sf(v); return n !== null ? Math.round(n) : null
}
function ss(v: unknown): string {
  const s = String(v ?? '').trim()
  return s === 'nan' || s === 'undefined' || s === 'null' ? '' : s
}

export async function POST(req: NextRequest) {
  // ── Auth ────────────────────────────────────────────────────
  const token = req.headers.get('authorization')?.replace('Bearer ', '').trim()
  if (!token) return NextResponse.json({ error: 'Нет токена' }, { status: 401 })

  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  const { data: profile } = await supabaseAdmin
    .from('users').select('role').eq('id', user.id).single()
  if (!['admin', 'analyst'].includes(profile?.role ?? ''))
    return NextResponse.json({ error: 'Недостаточно прав' }, { status: 403 })

  // ── Parse file ──────────────────────────────────────────────
  const form = await req.formData()
  const file = form.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'Файл не прикреплён' }, { status: 400 })

  const buffer   = Buffer.from(await file.arrayBuffer())
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false })

  // Найдём листы
  const rashSheet = workbook.SheetNames.find(s =>
    s.toLowerCase().includes('расшифровк') || s.toLowerCase().includes('расшифр')
  )
  const s2Sheet = workbook.SheetNames.find(s =>
    s.toLowerCase() === 'sheet2' || s.toLowerCase() === 'лист2'
  )

  if (!rashSheet)
    return NextResponse.json({
      error: `Лист «АВС расшифровка» не найден. Листы: ${workbook.SheetNames.join(', ')}`
    }, { status: 422 })

  // ── Парсим АВС расшифровка ───────────────────────────────────
  const rRaw = XLSX.utils.sheet_to_json<Record<string, unknown>[]>(
    workbook.Sheets[rashSheet], { header: 1, defval: null }
  ) as unknown[][]

  // Строка 0 = заголовки
  const rHeaders = rRaw[0] as unknown[]
  const rIdx: Record<string, number> = {}
  const rCols = [
    'Номенклатура', 'Артикул', 'Ставка НДС', 'Количество',
    'Себестоимость без НДС, руб.', 'Выручка без НДС',
    'Чистый маржинальный доход (ЧМД)', 'Реклама, без НДС',
    'Хранение, без НДС', 'Тран расходы, без НДС',
    'ЧМД за минусом Рекламы, хранения, транспорта',
    'Рен-сть чистого чмд, %', 'Рен-сть выручки, %',
    'ТЗ', 'ОБ ТЗ, дн',
    'Класс по ЧМД', 'Класс по Выручке',
    'Итоговый класс', 'Класс по Рен-сти ЧМД', 'Класс по Об тз',
    'Итоговый класс2', 'Флаг новинки', 'Статус остатка',
  ]
  for (const col of rCols) {
    const idx = rHeaders.findIndex(h => ss(h) === col)
    if (idx >= 0) rIdx[col] = idx
  }

  const abcMap: Record<string, Record<string, unknown>> = {}
  for (let ri = 1; ri < rRaw.length; ri++) {
    const row = rRaw[ri]
    const article = ss(row[rIdx['Артикул'] ?? 1])
    if (!article) continue

    const costTotal = sf(row[rIdx['Себестоимость без НДС, руб.'] ?? 4])
    const qty       = si(row[rIdx['Количество'] ?? 3])
    const costUnit  = costTotal && qty && qty > 0 ? parseFloat((costTotal / qty).toFixed(2)) : null

    abcMap[article] = {
      article,
      name_abc:       ss(row[rIdx['Номенклатура'] ?? 0]),
      qty:            qty,
      cost_total:     costTotal,
      cost_unit:      costUnit,
      revenue:        sf(row[rIdx['Выручка без НДС'] ?? 5]),
      chmd:           sf(row[rIdx['Чистый маржинальный доход (ЧМД)'] ?? 6]),
      ads_cost:       sf(row[rIdx['Реклама, без НДС'] ?? 7]),
      storage_cost:   sf(row[rIdx['Хранение, без НДС'] ?? 8]),
      transport_cost: sf(row[rIdx['Тран расходы, без НДС'] ?? 9]),
      chmd_net:       sf(row[rIdx['ЧМД за минусом Рекламы, хранения, транспорта'] ?? 10]),
      profitability:  sf(row[rIdx['Рен-сть чистого чмд, %'] ?? 11]),
      rev_profitability: sf(row[rIdx['Рен-сть выручки, %'] ?? 12]),
      tz:             sf(row[rIdx['ТЗ'] ?? 13]),
      turnover:       sf(row[rIdx['ОБ ТЗ, дн'] ?? 14]),
      abc_chmd:       ss(row[rIdx['Класс по ЧМД'] ?? 15]),
      abc_rev:        ss(row[rIdx['Класс по Выручке'] ?? 16]),
      abc_class:      ss(row[rIdx['Итоговый класс'] ?? 17]),
      abc_profitability: ss(row[rIdx['Класс по Рен-сти ЧМД'] ?? 18]),
      abc_turnover:   ss(row[rIdx['Класс по Об тз'] ?? 19]),
      abc_class2:     ss(row[rIdx['Итоговый класс2'] ?? 20]),
      novelty_flag:   ss(row[rIdx['Флаг новинки'] ?? 21]),
      stock_status:   ss(row[rIdx['Статус остатка'] ?? 22]),
      gmroi:          null as number | null,
    }
  }

  // ── Парсим Sheet2 (GMROI) ────────────────────────────────────
  if (s2Sheet) {
    const s2Raw = XLSX.utils.sheet_to_json<unknown[][]>(
      workbook.Sheets[s2Sheet], { header: 1, defval: null }
    ) as unknown[][]

    const s2Headers = s2Raw[0] as unknown[]
    const nameIdx   = s2Headers.findIndex(h => ss(h).includes('номенклатура') || ss(h).includes('Номенклатура'))
    const gmroiIdx  = s2Headers.findIndex(h => ss(h).includes('GMROI'))

    if (nameIdx >= 0 && gmroiIdx >= 0) {
      // Строим карту имя → GMROI
      const nameToGmroi: Record<string, number> = {}
      for (let ri = 1; ri < s2Raw.length; ri++) {
        const row = s2Raw[ri]
        const name  = ss(row[nameIdx])
        const gmroi = sf(row[gmroiIdx])
        if (name && gmroi !== null) nameToGmroi[name] = gmroi
      }
      // Присваиваем GMROI по названию
      for (const data of Object.values(abcMap)) {
        const name = ss(data['name_abc'])
        if (name && nameToGmroi[name] !== undefined) {
          data['gmroi'] = nameToGmroi[name]
        }
      }
    }
  }

  const rows = Object.values(abcMap).map(d => ({
    ...d,
    updated_at: new Date().toISOString(),
  }))

  if (rows.length === 0)
    return NextResponse.json({ error: 'Нет данных для сохранения' }, { status: 422 })

  // ── Upsert ───────────────────────────────────────────────────
  const BATCH = 300
  let saved = 0
  for (let i = 0; i < rows.length; i += BATCH) {
    const { error } = await supabaseAdmin
      .from('abc_analysis')
      .upsert(rows.slice(i, i + BATCH), { onConflict: 'article' })
    if (error) {
      return NextResponse.json({
        error: `Ошибка сохранения: ${error.message}. Проверьте что таблица abc_analysis создана через SQL Editor.`
      }, { status: 500 })
    }
    saved += BATCH
  }

  const withGmroi = (rows as any[]).filter((r: any) => r.gmroi !== null).length

  return NextResponse.json({
    rows:      rows.length,
    skus:      saved,
    with_gmroi: withGmroi,
    message:   `Обновлено ${rows.length} SKU, GMROI заполнен для ${withGmroi} товаров`,
  })
}
