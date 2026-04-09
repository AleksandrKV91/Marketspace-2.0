/**
 * src/app/api/update/china/route.ts
 *
 * POST /api/update/china
 * Парсит файл «Потребность Китай» (листы зеленка + СВОД) и сохраняет в Supabase:
 *   - china_supply: лог.плечо, себа, остатки МС, план продаж, заказ менеджера
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'

export const maxDuration = 60

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

// Индексы колонок в зеленке (после парсинга с header=1)
// Row 0 = пусто, Row 1 = заголовки, Row 2 = sub-headers, Row 3+ = данные
const Z = {
  ART_WB:      3,   // D  Артикул WB
  ARTICLE:     8,   // I  Артикул склада
  BRAND:       5,   // F  Бренд
  COST_NDV:    22,  // W  Себа с НДС
  MS_STOCK:    21,  // V  Остатки МС, шт
  MS_ALL:      37,  // AL Остатки МС +площадки, шт
  LOG_PLECHE:  39,  // AN Лог. плечо, дн
  ORDER_CALC:  36,  // AK ЗАКАЗ
  IN_TRANSIT:  33,  // AH Пл. поставок на 90 дн
  IN_PROD:     35,  // AJ Остаток в производстве
  DAYS_MS:     32,  // AG Запас МС, дней
  MISSED_REV:  17,  // R  Упущенная выручка
  DPD_7:       25,  // Z  ср. дневные заказы 7дн
  DPD_14:      26,  // AA ср. дневные заказы 14дн
  DPD_31:      27,  // AB ср. дневные заказы 31дн
}

// Индексы колонок в СВОД
const S = {
  ARTICLE:    1,   // B  Артикул склада
  PLAN_START: 2,   // C  март (первый плановый месяц)
  ORDER_MGR:  61,  // BJ Кол-во к заказу (менеджер)
  COST_SVOD:  36,  // AK Себа план
  SUPPLIER:   55,  // BD Поставщик
  STATUS_SV:  54,  // BC Статус
  PCT_BUYOUT: 33,  // AH % выкупа на ВБ
}

const SVOD_MONTHS = ['март','апрель','май','июнь','июль','август']

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

  // Найдём листы зеленка и СВОД
  const zSheet = workbook.SheetNames.find(s =>
    s.toLowerCase().includes('зеленк') || s.toLowerCase() === 'green'
  )
  const sSheet = workbook.SheetNames.find(s =>
    s.toLowerCase().includes('свод') || s.toLowerCase() === 'summary'
  )

  if (!zSheet)
    return NextResponse.json({
      error: `Лист «зеленка» не найден. Листы: ${workbook.SheetNames.join(', ')}`
    }, { status: 422 })

  // ── Парсим зеленку ──────────────────────────────────────────
  const zRaw = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[zSheet], { header: 1, defval: null })
  // Row 1 = заголовки (0-indexed), данные с Row 3
  const zMap: Record<string, object> = {}

  for (let ri = 3; ri < zRaw.length; ri++) {
    const row = zRaw[ri] as unknown[]
    const article = ss(row[Z.ARTICLE])
    if (!article) continue

    zMap[article] = {
      article,
      art_wb:      ss(row[Z.ART_WB]),
      brand:       ss(row[Z.BRAND]),
      cost_z:      sf(row[Z.COST_NDV]),
      ms_stock:    si(row[Z.MS_STOCK]) ?? 0,
      ms_all:      si(row[Z.MS_ALL]),
      log_pleche:  si(row[Z.LOG_PLECHE]),
      order_calc_z: sf(row[Z.ORDER_CALC]) ?? 0,
      in_transit:  si(row[Z.IN_TRANSIT]) ?? 0,
      in_prod:     si(row[Z.IN_PROD]) ?? 0,
      days_ms:     sf(row[Z.DAYS_MS]),
      missed_rev:  sf(row[Z.MISSED_REV]),
      dpd_z7:      sf(row[Z.DPD_7]),
      dpd_z14:     sf(row[Z.DPD_14]),
      dpd_z31:     sf(row[Z.DPD_31]),
    }
  }

  // ── Парсим СВОД ─────────────────────────────────────────────
  const sMap: Record<string, object> = {}
  if (sSheet) {
    const sRaw = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sSheet], { header: 1, defval: null })

    for (let ri = 3; ri < sRaw.length; ri++) {
      const row = sRaw[ri] as unknown[]
      const article = ss(row[S.ARTICLE])
      if (!article) continue

      const plan: Record<string, number> = {}
      for (let mi = 0; mi < SVOD_MONTHS.length; mi++) {
        const v = si(row[S.PLAN_START + mi])
        if (v && v > 0) plan[SVOD_MONTHS[mi]] = v
      }

      sMap[article] = {
        order_mgr:   si(row[S.ORDER_MGR]),
        cost_svod:   sf(row[S.COST_SVOD]),
        supplier_sv: ss(row[S.SUPPLIER]),
        status_sv:   ss(row[S.STATUS_SV]),
        pct_buyout:  sf(row[S.PCT_BUYOUT]),
        plan_months: Object.keys(plan).length > 0 ? plan : null,
      }
    }
  }

  // ── Merge и сохраняем ───────────────────────────────────────
  const rows: object[] = []
  for (const [article, zd] of Object.entries(zMap)) {
    const sd = sMap[article] as Record<string, unknown> | undefined
    rows.push({
      ...(zd as object),
      ...(sd ? sd : {}),
      article,
      updated_at: new Date().toISOString(),
    })
  }
  // Добавим записи только из СВОД (которых нет в зеленке)
  for (const [article, sd] of Object.entries(sMap)) {
    if (!zMap[article]) {
      rows.push({ article, ...(sd as object), updated_at: new Date().toISOString() })
    }
  }

  if (rows.length === 0)
    return NextResponse.json({ error: 'Нет данных для сохранения' }, { status: 422 })

  const BATCH = 200
  let saved = 0
  for (let i = 0; i < rows.length; i += BATCH) {
    const { error } = await supabaseAdmin
      .from('china_supply')
      .upsert(rows.slice(i, i + BATCH), { onConflict: 'article' })
    if (error) {
      return NextResponse.json({
        error: `Ошибка сохранения: ${error.message}. Проверьте что таблица china_supply создана через SQL Editor.`
      }, { status: 500 })
    }
    saved += BATCH
  }

  return NextResponse.json({
    rows:    rows.length,
    skus:    saved,
    z_skus:  Object.keys(zMap).length,
    s_skus:  Object.keys(sMap).length,
    message: `Зеленка: ${Object.keys(zMap).length} SKU, СВОД: ${Object.keys(sMap).length} SKU`,
  })
}
