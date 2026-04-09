/**
 * src/app/api/dashboard-data/route.ts
 *
 * GET /api/dashboard-data
 * Authorization: Bearer <token>
 *
 * Возвращает { DAYS: ['01.03', ...], RAW: [{sku, ...}, ...] }
 *
 * ИСПРАВЛЕНИЯ:
 * 1. Пересекающиеся даты — данные из БОЛЕЕ ПОЗДНЕЙ загрузки (не среднее)
 * 2. ЧМД — chmd_d[] дневной массив (chmd_5d / кол-во_дней_загрузки)
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const BATCH = 1000

async function fetchAll<T>(
  table: string,
  select: string,
  filters: (q: any) => any
): Promise<T[]> {
  const result: T[] = []
  let from = 0
  while (true) {
    let q = supabaseAdmin.from(table).select(select)
    q = filters(q)
    q = q.range(from, from + BATCH - 1)
    const { data, error } = await q
    if (error || !data?.length) break
    result.push(...(data as T[]))
    if (data.length < BATCH) break
    from += BATCH
  }
  return result
}

function avg(arr: (number | null)[]): number | null {
  const vals = arr.filter(v => v !== null && v !== 0) as number[]
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
}

export async function GET(req: NextRequest) {

  // ── 1. Авторизация ───────────────────────────────────────────
  const token = req.headers.get('authorization')?.replace('Bearer ', '').trim()
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Получаем роль пользователя
  const { data: profile } = await supabaseAdmin
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()
  const userRole = profile?.role ?? 'viewer'

  // ── 2. Все загрузки с 01.02.2026 ────────────────────────────────
  // Параметр from=YYYY-MM-DD — нижняя граница (по умолчанию 2026-02-01).
  const { searchParams } = new URL(req.url)
  const fromDate = searchParams.get('from') ?? '2026-02-01'

  const { data: uploads } = await supabaseAdmin
    .from('uploads')
    .select('id, period_start, period_end')
    .gte('period_start', fromDate)
    .order('period_start', { ascending: false })

  if (!uploads?.length) return NextResponse.json({ DAYS: [], RAW: [] })

  // Восстанавливаем порядок от старых к новым (для корректного приоритета)
  uploads.sort((a, b) => a.period_start.localeCompare(b.period_start))

  const uploadIds = uploads.map(u => u.id)

  // Приоритет: более поздняя загрузка = больший индекс
  const uploadPriority = new Map<string, number>(
    uploads.map((u, i) => [u.id, i])
  )

  // Количество дней в каждой загрузке (для распределения ЧМД)
  const uploadDayCounts = new Map<string, number>()
  for (const u of uploads) {
    const start = new Date(u.period_start)
    const end = new Date(u.period_end)
    const days = Math.round((end.getTime() - start.getTime()) / 86400000) + 1
    uploadDayCounts.set(u.id, Math.max(days, 1))
  }

  // ── 3. Уникальные даты — генерируем из диапазонов period_start/period_end загрузок
  // Не используем daily_metrics — там миллионы строк, запрос медленный
  // Не используем upload_dates — view не существует
  const allDatesSet = new Set<string>()
  for (const u of uploads) {
    const start = new Date(u.period_start)
    const end   = new Date(u.period_end)
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      allDatesSet.add(d.toISOString().slice(0, 10))
    }
  }

  const allDates = [...allDatesSet].sort()
  if (!allDates.length) return NextResponse.json({ DAYS: [], RAW: [] })

  const DAYS = allDates.map(d => {
    const [, mm, dd] = d.split('-')
    return `${dd}.${mm}`
  })

  // ── 4. snapshot_metrics — собираем из ВСЕХ загрузок ──────────
  // Для каждого SKU берём снимок из самой поздней загрузки где он присутствует
  const lastUploadId = uploads[uploads.length - 1].id

  const allSnapshots = await fetchAll<any>(
    'snapshot_metrics',
    'sku_id, upload_id, stock_fbo, stock_fbs_pushkino, stock_fbs_smolensk, stock_kits, stock_days, days_to_arrival, ots_reserve_days, ' +
    'margin_rub, margin_pct, chmd_5d, spend_plan, drr_plan, revenue_plan, ' +
    'ad_spend_5d, revenue_5d, drr_total_5d, drr_ad_5d, ctr_5d, ' +
    'cr_cart_5d, cr_order_5d, cpm_5d, cpc_5d, ad_order_share_5d',
    q => q.in('upload_id', uploadIds)
  )

  if (!allSnapshots.length) return NextResponse.json({ DAYS: [], RAW: [] })

  // Для каждого SKU — снимок из самой поздней загрузки
  const snapshotMap = new Map<number, any>()
  for (const snap of allSnapshots) {
    const existing = snapshotMap.get(snap.sku_id)
    const snapPriority = uploadPriority.get(snap.upload_id) ?? 0
    const existingPriority = existing ? (uploadPriority.get(existing.upload_id) ?? 0) : -1
    if (snapPriority > existingPriority) {
      snapshotMap.set(snap.sku_id, snap)
    }
  }
  const snapshots = Array.from(snapshotMap.values())

  // ── 5. ЧМД по загрузкам ──────────────────────────────────────
  // chmd_5d для каждой загрузки → chmd_daily = chmd_5d / кол-во_дней
  const chmdByUpload = new Map<string, number>() // key: "skuId__uploadId"
  for (const uploadId of uploadIds) {
    const rows = await fetchAll<any>(
      'snapshot_metrics',
      'sku_id, chmd_5d',
      q => q.eq('upload_id', uploadId)
    )
    for (const r of rows) {
      chmdByUpload.set(`${r.sku_id}__${uploadId}`, r.chmd_5d ?? 0)
    }
  }

  // ── 6. products ───────────────────────────────────────────────
  const skuIds = snapshots.map((s: any) => s.sku_id as number)
  const productsAll: any[] = []
  for (let i = 0; i < skuIds.length; i += BATCH) {
    const { data } = await supabaseAdmin
      .from('products')
      .select('sku_id, category, subject, name, brand, manager, shelf_date, novelty_status, season')
      .in('sku_id', skuIds.slice(i, i + BATCH))
    if (data?.length) productsAll.push(...data)
  }
  // Enrich with products_catalog (Свод) data - optional, don't block on failure
  let catalogMap = new Map<number, any>()
  try {
    const { data: catalogData } = await supabaseAdmin
      .from('products_catalog')
      .select('sku_wb, sku_ms, sku_sklad, subject_wb, category_wb, nds_pct')
      .limit(5000)
    if (catalogData?.length) {
      catalogMap = new Map<number, any>(catalogData.map((c: any) => [c.sku_wb, c]))
    }
  } catch (_) { /* catalog is optional */ }

  const productMap = new Map<number, any>(productsAll.map(p => {
    const cat = catalogMap.get(p.sku_id)
    return [p.sku_id, { ...p, sku_ms: cat?.sku_ms, sku_sklad: cat?.sku_sklad, subject_wb: cat?.subject_wb, category_wb: cat?.category_wb, nds_pct: cat?.nds_pct }]
  }))

  // ── 6b. abc_analysis (GMROI расчётный) ────────────────────────
  const abcAll: any[] = []
  for (let i = 0; i < skuIds.length; i += BATCH) {
    const { data } = await supabaseAdmin
      .from('abc_analysis')
      .select('article, chmd_clean, tz')
      .in('article', skuIds.slice(i, i + BATCH))
    if (data?.length) abcAll.push(...data)
  }
  const abcMap = new Map<number, { chmd_clean: number | null; tz: number | null }>(
    abcAll.map((a: any) => [a.article, { chmd_clean: a.chmd_clean, tz: a.tz }])
  )

  // ── 7. daily_metrics — только нужный диапазон дат ───────────
  const minDate = allDates[0] ?? ''
  const maxDate = allDates[allDates.length - 1] ?? ''
  const dailyAll = await fetchAll<any>(
    'daily_metrics',
    'sku_id, upload_id, metric_date, ad_spend, revenue, drr_total, drr_ad, ' +
    'ctr, cr_cart, cr_order, cpm, cpc, ad_order_share, price',
    q => q
      .in('upload_id', uploadIds)
      .gte('metric_date', minDate)
      .lte('metric_date', maxDate)
      .order('metric_date', { ascending: true })
  )

  // ИСПРАВЛЕНО: при дубле дат — берём данные из БОЛЕЕ ПОЗДНЕЙ загрузки
  const dailyMap = new Map<string, any>()
  for (const row of dailyAll) {
    const key = `${row.sku_id}__${row.metric_date}`
    const rowPriority = uploadPriority.get(row.upload_id) ?? 0

    if (!dailyMap.has(key)) {
      dailyMap.set(key, { ...row, _priority: rowPriority })
    } else {
      const existing = dailyMap.get(key)!
      if (rowPriority > existing._priority) {
        // Более поздняя загрузка — перезаписываем
        dailyMap.set(key, { ...row, _priority: rowPriority })
      }
    }
  }

  const dailyBySku = new Map<number, any[]>()
  for (const row of dailyMap.values()) {
    if (!dailyBySku.has(row.sku_id)) dailyBySku.set(row.sku_id, [])
    dailyBySku.get(row.sku_id)!.push(row)
  }

  // ── 8. supply_plan ────────────────────────────────────────────
  const suppliesAll = await fetchAll<any>(
    'supply_plan',
    'sku_id, supply_date, qty_plan',
    q => q.eq('upload_id', lastUploadId)
  )
  const supplyMap = new Map<number, { date: string; qty: number }>()
  for (const s of suppliesAll) {
    if (s.supply_date) {
      const [y, mm, dd] = s.supply_date.split('-')
      supplyMap.set(s.sku_id, { date: `${dd}.${mm}.${y}`, qty: s.qty_plan })
    }
  }

  // ── 9. price_history ──────────────────────────────────────────
  const pricesAll = await fetchAll<any>(
    'price_history',
    'sku_id, price_date, price, note',
    q => q.in('upload_id', uploadIds).order('price_date', { ascending: true })
  )
  const pricesMapDedup = new Map<string, any>()
  for (const p of pricesAll) {
    pricesMapDedup.set(`${p.sku_id}__${p.price_date}`, p)
  }
  const pricesBySku = new Map<number, { date: string; chg: number; note: string }[]>()
  for (const p of pricesMapDedup.values()) {
    if (!pricesBySku.has(p.sku_id)) pricesBySku.set(p.sku_id, [])
    const [, mm, dd] = p.price_date.split('-')
    pricesBySku.get(p.sku_id)!.push({
      date: `${dd}.${mm}`,
      chg:  p.price ?? 0,
      note: p.note ?? '',
    })
  }

  // ── 10. Собираем RAW ─────────────────────────────────────────
  const RAW = snapshots.map((snap: any) => {
    const product      = productMap.get(snap.sku_id)
    const abc          = abcMap.get(snap.sku_id)
    const daily        = dailyBySku.get(snap.sku_id) ?? []
    const supply       = supplyMap.get(snap.sku_id)
    const priceChanges = pricesBySku.get(snap.sku_id) ?? []

    const byDate = (field: string, fallback: null | number = 0) =>
      allDates.map(d => {
        const row = daily.find((r: any) => r.metric_date === d)
        return row ? (row[field] ?? fallback) : fallback
      })

    const rev_d     = byDate('revenue',        0)
    const cost_d    = byDate('ad_spend',       0)
    const drr_d     = byDate('drr_total',      null)
    const drr_adv_d = byDate('drr_ad',         null)
    const ctr_d     = byDate('ctr',            null)
    const cr_cart_d = byDate('cr_cart',        null)
    const cr_d      = byDate('cr_order',       null)
    const cpm_d     = byDate('cpm',            null)
    const cpc_d     = byDate('cpc',            null)
    const adv_d     = byDate('ad_order_share', null)

    const rev_fact    = (rev_d as number[]).reduce((a, b) => a + b, 0)
    const costs_total = (cost_d as number[]).reduce((a, b) => a + b, 0)

    // ── ЧМД по дням ──
    // Для каждого дня: берём upload_id из daily row,
    // находим chmd_5d этой загрузки, делим на кол-во дней = дневной ЧМД
    const chmd_d: (number | null)[] = allDates.map(d => {
      const row = daily.find((r: any) => r.metric_date === d)
      if (!row?.upload_id) return null
      const chmd5d = chmdByUpload.get(`${snap.sku_id}__${row.upload_id}`) ?? 0
      const dayCount = uploadDayCounts.get(row.upload_id) ?? 5
      return chmd5d / dayCount
    })

    // Общий ЧМД = сумма дневных
    const chmd = (chmd_d.filter(v => v !== null) as number[]).reduce((a, b) => a + b, 0)

    // Новинка: статус "Новинки" в products + последняя загрузка с этим SKU
    // была не более 60 дней назад.
    // Сейчас products.novelty_status = последнее значение из Excel.
    // Логика на будущее: если статус был "Новинки" и с тех пор прошло < 60 дней — новинка.
    const noveltyRaw = (product?.novelty_status ?? '').toString().trim().toLowerCase()
    const hasNoveltyStatus = noveltyRaw === 'новинки' || noveltyRaw === 'новинка'

    // Дата конца последней загрузки в которой этот SKU присутствовал
    const skuUploadId = snap.upload_id
    const skuUpload = uploads.find(u => u.id === skuUploadId)
    const lastSeenDate = skuUpload?.period_end ? new Date(skuUpload.period_end) : null
    const daysSinceLastSeen = lastSeenDate ? (Date.now() - lastSeenDate.getTime()) / 86400000 : 999

    const is_new = hasNoveltyStatus && daysSinceLastSeen <= 60

    const pricePcts = priceChanges.filter(p => p.chg !== 0).map(p => p.chg)
    const price_chg_avg = pricePcts.length
      ? pricePcts.reduce((a, b) => a + b, 0) / pricePcts.length
      : null

    // ── Формируем price_changes с дельтами (как в старом HTML) ──
    // chg = процент изменения цены (например -0.03 = -3%)
    // Текущая цена SKU
    const currentPrice = daily.at(-1)?.price ?? 0

    const fullPriceChanges = priceChanges.map(pc => {
      const pct = pc.chg  // процент изменения (из price_history)
      // old_price и new_price вычисляем от текущей цены
      const new_price = currentPrice || null
      const old_price = (currentPrice && pct !== 0) ? Math.round(currentPrice / (1 + pct)) : null

      // Дельты метрик: сравниваем день до и день после изменения цены
      const di = allDates.findIndex(d => {
        const [, mm2, dd2] = d.split('-')
        return `${dd2}.${mm2}` === pc.date
      })

      const deltaCalc = (arr: (number | null)[], idx: number): number | null => {
        if (idx < 0 || idx >= arr.length) return null
        const before = idx > 0 ? arr[idx - 1] : null
        const after = idx < arr.length - 1 ? arr[idx + 1] : arr[idx]
        if (before != null && after != null && before !== 0) {
          return Math.round((after - before) / Math.abs(before) * 10000) / 10000
        }
        return null
      }

      return {
        date:         pc.date,
        pct,
        old_price,
        new_price,
        delta_ctr:      deltaCalc(ctr_d,     di),
        delta_cr_cart:   deltaCalc(cr_cart_d, di),
        delta_cr:        deltaCalc(cr_d,      di),
        delta_cost:      deltaCalc(cost_d,    di),
        delta_cpm:       deltaCalc(cpm_d,     di),
        delta_cpc:       deltaCalc(cpc_d,     di),
      }
    })

    return {
      sku:            snap.sku_id,
      cat:            product?.category    ?? '',
      pred:           product?.subject     ?? '',
      name:           product?.name        ?? '',
      brand:          product?.brand       ?? '',
      mgr:            product?.manager     ?? '',
      is_new,
      appear_date:    product?.shelf_date  ?? null,
      margin_pct:     snap.margin_pct      ?? 0,
      chmd,
      chmd_d,         // дневной массив ЧМД
      drr_plan:       snap.drr_plan        ?? 0,
      drr_fact:       avg(drr_d),
      drr_adv:        avg(drr_adv_d),
      rev_plan:       snap.revenue_plan    ?? 0,
      rev_fact,
      ctr:            avg(ctr_d),
      cr_cart:        avg(cr_cart_d),
      cr:             avg(cr_d),
      cpc:            avg(cpc_d),
      cpm:            avg(cpm_d),
      stock_days:     snap.stock_days      ?? 0,
      oos_days:       snap.ots_reserve_days ?? null,
      stock_wb:       snap.stock_fbo       ?? 0,
      stock_fbs:      (snap.stock_fbs_pushkino ?? 0) + (snap.stock_fbs_smolensk ?? 0),
      stock_kits:     snap.stock_kits      ?? 0,
      stock_total:    (snap.stock_fbo ?? 0) + (snap.stock_fbs_pushkino ?? 0) + (snap.stock_fbs_smolensk ?? 0) + (snap.stock_kits ?? 0),
      days_to_supply: snap.days_to_arrival ?? 0,
      adv_share:      avg(adv_d),
      costs:          costs_total,
      price:          daily.at(-1)?.price  ?? 0,
      // Продажи шт/день (приблизительно): выручка за период / цена / кол-во дней
      sales_per_day:  (() => {
        const p = daily.at(-1)?.price;
        const numDays = allDates.length;
        return (p && p > 0 && numDays > 0) ? rev_fact / p / numDays : null;
      })(),
      // Расчётный запас дней: общий остаток / среднедневные продажи
      oos_days_calc:  (() => {
        const totalStock = (snap.stock_fbo ?? 0) + (snap.stock_fbs_pushkino ?? 0) + (snap.stock_fbs_smolensk ?? 0) + (snap.stock_kits ?? 0);
        const p = daily.at(-1)?.price;
        const numDays = allDates.length;
        const salesPerDay = (p && p > 0 && numDays > 0) ? rev_fact / p / numDays : 0;
        return salesPerDay > 0 ? Math.round(totalStock / salesPerDay) : null;
      })(),
      supply_date:    supply?.date         ?? null,
      supply_qty:     supply?.qty          ?? null,
      price_chg_avg,
      price_changes:  fullPriceChanges,
      rev_d,
      drr_d,
      cost_d,
      drr_adv_d,
      ctr_d,
      cr_cart_d,
      cr_d,
      cpm_d,
      cpc_d,
      // GMROI расчётный = ЧМД_чистый / ТЗ
      gmroi_calc:     (abc?.chmd_clean != null && abc?.tz && abc.tz > 0)
        ? +(abc.chmd_clean / abc.tz).toFixed(4) : null,
    }
  })

  return NextResponse.json({ DAYS, RAW, userRole })
}
