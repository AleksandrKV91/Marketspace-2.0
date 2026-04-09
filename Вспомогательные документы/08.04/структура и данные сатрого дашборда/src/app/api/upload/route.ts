/**
 * src/app/api/upload/route.ts
 *
 * POST /api/upload
 * Content-Type: multipart/form-data
 * Authorization: Bearer <supabase_access_token>
 * Body: file=<.xlsx>
 *
 * Что делает:
 * 1. Проверяет авторизацию (только admin и analyst)
 * 2. Парсит Excel через parseWBExcel()
 * 3. Создаёт запись в uploads
 * 4. Upsert products
 * 5. Upsert snapshot_metrics
 * 6. Upsert daily_metrics батчами (500 строк)
 * 7. Upsert price_history
 * 8. Upsert supply_plan
 */

import { NextRequest, NextResponse } from 'next/server'
export const maxDuration = 60;
import { createClient } from '@supabase/supabase-js'
import { parseWBExcel } from '@/lib/parser'

// Используем service_role для записи — он обходит RLS
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  // ── 1. Авторизация ───────────────────────────────────────────
  const authHeader = req.headers.get('authorization') ?? ''
  const token = authHeader.replace('Bearer ', '').trim()
  if (!token) {
    return NextResponse.json({ error: 'Нет токена авторизации' }, { status: 401 })
  }

  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !user) {
    return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })
  }

  // Проверяем роль
  const { data: profile } = await supabaseAdmin
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || !['admin', 'analyst'].includes(profile.role)) {
    return NextResponse.json(
      { error: 'Недостаточно прав. Нужна роль admin или analyst.' },
      { status: 403 }
    )
  }

  // ── 2. Читаем файл ───────────────────────────────────────────
  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Не удалось прочитать форму' }, { status: 400 })
  }

  const file = formData.get('file') as File | null
  if (!file) {
    return NextResponse.json({ error: 'Файл не передан (поле "file")' }, { status: 400 })
  }
  if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xlsb')) {
    return NextResponse.json({ error: 'Ожидается .xlsx или .xlsb файл' }, { status: 400 })
  }

  // ── 3. Парсим Excel ──────────────────────────────────────────
  let parsed
  try {
    const buffer = await file.arrayBuffer()
    parsed = parseWBExcel(buffer)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: `Ошибка парсинга: ${msg}` }, { status: 422 })
  }

  const { rows, sheet_name, period_start, period_end } = parsed
  if (!rows.length) {
    return NextResponse.json({ error: 'Файл не содержит строк с данными' }, { status: 422 })
  }

  // ── 4. Создаём запись загрузки ───────────────────────────────
  const { data: upload, error: uploadError } = await supabaseAdmin
    .from('uploads')
    .insert({
      uploaded_by:  user.id,
      period_start,
      period_end,
      source_sheet: sheet_name,
      filename:     file.name,
      rows_count:   rows.length,
    })
    .select()
    .single()

  if (uploadError || !upload) {
    return NextResponse.json(
      { error: `Не удалось создать запись загрузки: ${uploadError?.message}` },
      { status: 500 }
    )
  }

  const upload_id = upload.id

  try {
    // ── 5. Upsert products ───────────────────────────────────────
    // ИСПРАВЛЕНО: novelty_status НЕ перезаписывается если новое значение пустое.
    // Это предотвращает потерю статуса "Новинки" при загрузке таблицы
    // где тот же SKU не помечен как новинка.
    // Дополнительно сохраняем last_novelty_date — дату последнего появления
    // статуса "Новинки" (для логики 60 дней).

    const productsWithNovelty = rows.filter(r => {
      const ns = (r.novelty_status ?? '').toString().trim().toLowerCase()
      return ns === 'новинки' || ns === 'новинка'
    })
    const productsWithoutNovelty = rows.filter(r => {
      const ns = (r.novelty_status ?? '').toString().trim().toLowerCase()
      return ns !== 'новинки' && ns !== 'новинка'
    })

    // Группа 1: SKU с novelty_status = "Новинки" → обновляем статус + дату
    if (productsWithNovelty.length) {
      const batch1 = productsWithNovelty.map(r => ({
        sku_id:         r.sku_id,
        category:       r.category,
        subject:        r.subject,
        name:           r.name,
        brand:          r.brand,
        shelf_date:     r.shelf_date,
        manager:        r.manager,
        manager_ng:     r.manager_ng,
        novelty_status: r.novelty_status,
        season:         r.season,
        updated_at:     new Date().toISOString(),
      }))
      const { error: prodError1 } = await supabaseAdmin
        .from('products')
        .upsert(batch1, { onConflict: 'sku_id' })
      if (prodError1) throw new Error(`products (novelty): ${prodError1.message}`)
    }

    // Группа 2: SKU без novelty_status → обновляем всё КРОМЕ novelty_status
    if (productsWithoutNovelty.length) {
      const batch2 = productsWithoutNovelty.map(r => ({
        sku_id:         r.sku_id,
        category:       r.category,
        subject:        r.subject,
        name:           r.name,
        brand:          r.brand,
        shelf_date:     r.shelf_date,
        manager:        r.manager,
        manager_ng:     r.manager_ng,
        // novelty_status НЕ включаем — чтобы не перезаписать "Новинки" на пустое
        season:         r.season,
        updated_at:     new Date().toISOString(),
      }))
      const { error: prodError2 } = await supabaseAdmin
        .from('products')
        .upsert(batch2, {
          onConflict: 'sku_id',
          ignoreDuplicates: false,
        })
      if (prodError2) throw new Error(`products (non-novelty): ${prodError2.message}`)
    }

    // ── 6. Upsert snapshot_metrics ───────────────────────────────
    const snapshots = rows.map(r => ({
      sku_id:             r.sku_id,
      upload_id,
      stock_fbo:          r.stock_fbo,
      stock_fbs_pushkino: r.stock_fbs_pushkino,
      stock_fbs_smolensk: r.stock_fbs_smolensk,
      stock_kits:         r.stock_kits,
      stock_days:         r.stock_days,
      days_to_arrival:    r.days_to_arrival,
      ots_reserve_days:   r.ots_reserve_days,
      margin_rub:         r.margin_rub,
      margin_pct:         r.margin_pct,
      chmd_5d:            r.chmd_5d,
      spend_plan:         r.spend_plan,
      drr_plan:           r.drr_plan,
      revenue_plan:       r.revenue_plan,
      ad_spend_5d:        r.spend_5d,
      revenue_5d:         r.revenue_5d,
      drr_total_5d:       r.drr_total_5d,
      drr_ad_5d:          r.drr_ad_5d,
      ctr_5d:             r.ctr_5d,
      cr_cart_5d:         r.cr_cart_5d,
      cr_order_5d:        r.cr_order_5d,
      cpm_5d:             r.cpm_5d,
      cpc_5d:             r.cpc_5d,
      ad_order_share_5d:  r.ad_order_share_5d,
      wb_rating:          r.wb_rating || null,
      buyout_pct:         r.buyout_pct || null,
    }))

    const { error: snapError } = await supabaseAdmin
      .from('snapshot_metrics')
      .upsert(snapshots, { onConflict: 'sku_id,upload_id' })

    if (snapError) throw new Error(`snapshot_metrics: ${snapError.message}`)

    // ── 7. Upsert daily_metrics (батчами по 500) ──────────────────
    const dailyAll = rows.flatMap(r =>
      r.daily.map(d => ({
        sku_id:          r.sku_id,
        upload_id,
        metric_date:     d.date,
        ad_spend:        d.ad_spend,
        revenue:         d.revenue,
        drr_total:       d.drr_total,
        drr_ad:          d.drr_ad,
        ctr:             d.ctr,
        cr_cart:         d.cr_cart,
        cr_order:        d.cr_order,
        cpm:             d.cpm,
        cpc:             d.cpc,
        ad_order_share:  d.ad_order_share,
        price:           r.price,      // цена одна на период
        spp:             d.spp,
        position_median: d.position_median,
      }))
    )

    for (let i = 0; i < dailyAll.length; i += 500) {
      const { error: dailyError } = await supabaseAdmin
        .from('daily_metrics')
        .upsert(dailyAll.slice(i, i + 500), {
          onConflict: 'sku_id,metric_date,upload_id',
        })
      if (dailyError) throw new Error(`daily_metrics batch ${i}: ${dailyError.message}`)
    }

    // ── 8. Upsert price_history ───────────────────────────────────
    // Дедупликация: одна дата может встречаться и в факт (cols 93-97)
    // и в план (cols 99-129). Оставляем последнее значение по sku+date.
    const pricesRaw = rows.flatMap(r =>
      r.price_changes.map(p => ({
        sku_id:     r.sku_id,
        upload_id,
        price_date: p.date,
        price:      p.change_pct,
        note:       p.note,
      }))
    )
    const pricesMap = new Map<string, typeof pricesRaw[0]>()
    for (const p of pricesRaw) {
      pricesMap.set(`${p.sku_id}__${p.price_date}`, p)
    }
    const prices = [...pricesMap.values()]

    if (prices.length) {
      const { error: priceError } = await supabaseAdmin
        .from('price_history')
        .upsert(prices, { onConflict: 'sku_id,price_date,upload_id' })
      if (priceError) throw new Error(`price_history: ${priceError.message}`)
    }

    // ── 9. Upsert supply_plan ─────────────────────────────────────
    const supplies = rows.flatMap(r =>
      r.supply.map(s => ({
        sku_id:      r.sku_id,
        upload_id,
        supply_date: s.supply_date,
        qty_plan:    Math.round(s.qty_plan),
      }))
    )

    if (supplies.length) {
      const { error: supplyError } = await supabaseAdmin
        .from('supply_plan')
        .upsert(supplies, { onConflict: 'sku_id,upload_id,supply_date' })
      if (supplyError) throw new Error(`supply_plan: ${supplyError.message}`)
    }

  } catch (e: unknown) {
    // Если что-то упало — удаляем запись загрузки (каскад удалит все метрики)
    await supabaseAdmin.from('uploads').delete().eq('id', upload_id)
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: `Ошибка записи в БД: ${msg}` }, { status: 500 })
  }

  // Диагностика: первый SKU для проверки парсера
  const firstRow = rows[0]
  const diagFirst = firstRow ? {
    sku_id: firstRow.sku_id,
    daily_count: firstRow.daily.length,
    daily_dates: firstRow.daily.map(d => d.date),
    revenue_5d: firstRow.revenue_5d,
    margin_pct: firstRow.margin_pct,
    price: firstRow.price,
  } : null

  return NextResponse.json({
    ok: true,
    upload_id,
    rows_count:   rows.length,
    period_start,
    period_end,
    sheet_name,
    diag: diagFirst,
  })
}
