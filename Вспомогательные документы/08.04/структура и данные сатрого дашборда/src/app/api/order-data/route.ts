/**
 * src/app/api/order-data/route.ts
 * Быстрая версия: читает только агрегаты из Supabase (без daily_sales)
 * daily_sales берётся из order_tab_data.json (статика)
 * Timeout: stock_daily_sales слишком большая для одного запроса
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { join } from 'path'

export const maxDuration = 60

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function fetchAll<T>(table: string, select: string, filter?: (q: any) => any): Promise<T[]> {
  const all: T[] = []
  let offset = 0
  while (true) {
    let q = supabaseAdmin.from(table).select(select).range(offset, offset + 999)
    if (filter) q = filter(q)
    const { data, error } = await q
    if (error) throw new Error(`${table}: ${error.message}`)
    if (!data?.length) break
    all.push(...(data as T[]))
    if (data.length < 1000) break
    offset += 1000
  }
  return all
}

// Load static JSON once
function loadStaticJSON(): Map<string, any> {
  try {
    const p = join(process.cwd(), 'public', 'order_tab_data.json')
    const arr: any[] = JSON.parse(readFileSync(p, 'utf-8'))
    return new Map(arr.map(r => [r.sku, r]))
  } catch {
    return new Map()
  }
}

export async function GET(req: NextRequest) {
  // Auth - fallback to JSON if no token
  const token = req.headers.get('authorization')?.replace('Bearer ', '').trim()
  if (!token) return serveFallback()

  const { data: { user }, error: ae } = await supabaseAdmin.auth.getUser(token)
  if (ae || !user) return serveFallback()

  try {
    const t0 = Date.now()
    // Load static JSON for fallback fields (daily_sales, plan, order_detail etc)
    const staticMap = loadStaticJSON()
    console.log(`[order-data] staticMap loaded: ${Date.now()-t0}ms`)

    // 1. stock_sheet1 - aggregated stats (~2500 rows, fast)
    const stock = await fetchAll<any>('stock_sheet1',
      'article,sku_wb,category,pred,brand,supplier,country,status,prev_status,' +
      'shelf_date,margin_pct,fbo_wb,fbs_push,fbs_smol,total_stock,' +
      'dpd_7,dpd_14,dpd_31,oos_7,oos_14,oos_31,trend_14,cv_31,dpd_ly,' +
      'sales_w1,sales_w2,sales_w3,sales_w4,sales_28d,last_data_date'
    )

    console.log(`[order-data] stock_sheet1: ${stock.length} rows, ${Date.now()-t0}ms`)
    if (!stock.length) return serveFallback()

    // 2. abc_analysis (~2500 rows, fast)
    const abc = await fetchAll<any>('abc_analysis',
      'article,abc_class,abc_class2,gmroi,cost,revenue,profitability,turnover,tz,chmd_clean'
    ).catch(() => [] as any[])
    console.log(`[order-data] abc_analysis: ${abc.length} rows, ${Date.now()-t0}ms`)
    const abcMap = new Map(abc.map((r: any) => [r.article, r]))

    // 3. products_catalog (~2800 rows, fast)
    const catalog = await fetchAll<any>('products_catalog',
      'sku_wb,name_full,subject_wb,category_wb'
    ).catch(() => [] as any[])
    console.log(`[order-data] products_catalog: ${catalog.length} rows, ${Date.now()-t0}ms`)
    const catalogMap = new Map(catalog.map((r: any) => [Number(r.sku_wb), r]))

    // 4. sku_notes (small)
    const notes = await fetchAll<any>('sku_notes',
      'sku_id,note,user_name,updated_at'
    ).catch(() => [] as any[])
    console.log(`[order-data] sku_notes: ${notes.length} rows, ${Date.now()-t0}ms`)
    const notesMap = new Map(notes.map((r: any) => [String(r.sku_id), r]))

    // 4b. Цена WB из последнего snapshot (быстро — не сканирует daily_metrics)
    const priceMap = new Map<string, number>()
    try {
      // Находим последнюю загрузку
      const { data: lastUpload } = await supabaseAdmin
        .from('uploads')
        .select('id')
        .order('period_end', { ascending: false })
        .limit(1)
        .single()
      if (lastUpload) {
        // Берём price из daily_metrics только для последней загрузки (маленький скан)
        const { data: priceRows } = await supabaseAdmin
          .from('daily_metrics')
          .select('sku_id, price')
          .eq('upload_id', lastUpload.id)
          .not('price', 'is', null)
          .limit(5000)
        if (priceRows?.length) {
          for (const row of priceRows) {
            const key = String(row.sku_id)
            if (!priceMap.has(key) && row.price != null) {
              priceMap.set(key, row.price)
            }
          }
        }
      }
    } catch { /* optional */ }
    console.log(`[order-data] priceMap: ${priceMap.size} entries, ${Date.now()-t0}ms`)

    // 5. niches from static file
    let nicheMap = new Map<string, any>()
    try {
      const niches: any[] = JSON.parse(readFileSync(join(process.cwd(), 'public', 'niches.json'), 'utf-8'))
      nicheMap = new Map(niches.map((n: any) => [n.pred?.toLowerCase().trim(), n]))
    } catch { /* optional */ }

    const lastDate = stock.find((r: any) => r.last_data_date)?.last_data_date ?? ''

    const result = stock.map((s: any) => {
      const art   = s.article
      const ab    = abcMap.get(art) ?? {}
      const cat   = catalogMap.get(Number(s.sku_wb)) ?? {}
      const note  = notesMap.get(String(s.sku_wb)) ?? {}
      const st    = staticMap.get(art) ?? {}  // fallback from JSON
      const pred  = (s.pred || cat.subject_wb || '').toLowerCase().trim()
      const niche = nicheMap.get(pred) ?? null

      const dpd = s.dpd_31 || 0
      const total_stock = s.total_stock ?? 0
      const days_stock = dpd > 0 ? Math.round(total_stock / dpd) : (total_stock > 0 ? 999 : 0)

      const gmroi_calc = (ab.chmd_clean != null && ab.tz && ab.tz > 0)
        ? +(ab.chmd_clean / ab.tz).toFixed(4) : null

      const price_wb = priceMap.get(art) ?? st.price ?? null

      return {
        sku:           art,
        sku_wb:        String(s.sku_wb ?? ''),
        name:          cat.name_full || st.name || art,
        category:      s.category || cat.category_wb || '',
        pred:          s.pred || cat.subject_wb || '',
        brand:         s.brand || '',
        supplier:      s.supplier || '',
        country:       s.country || '',
        status:        s.status || '',
        prev_status:   s.prev_status || '',
        abc_class:     ab.abc_class  || st.abc_class  || '',
        abc_class2:    ab.abc_class2 || st.abc_class2 || '',
        gmroi:         ab.gmroi  ?? st.gmroi  ?? null,
        gmroi_calc:    gmroi_calc ?? st.gmroi_calc ?? null,
        fbo_wb:        s.fbo_wb  ?? 0,
        fbs_push:      s.fbs_push ?? 0,
        fbs_smol:      s.fbs_smol ?? 0,
        ms_stock:      st.ms_stock  ?? 0,
        in_transit:    st.in_transit ?? 0,
        in_prod:       st.in_prod   ?? 0,
        total_stock,
        shelf_date:    s.shelf_date ?? null,
        dpd_7:         s.dpd_7  ?? 0,
        dpd_14:        s.dpd_14 ?? 0,
        dpd_31:        s.dpd_31 ?? 0,
        oos_7:         s.oos_7  ?? 0,
        oos_14:        s.oos_14 ?? 0,
        oos_31:        s.oos_31 ?? 0,
        trend_14:      s.trend_14 ?? null,
        cv_31:         s.cv_31    ?? null,
        dpd_ly:        s.dpd_ly   ?? null,
        sales_w1:      s.sales_w1  ?? st.sales_w1  ?? 0,
        sales_w2:      s.sales_w2  ?? st.sales_w2  ?? 0,
        sales_w3:      s.sales_w3  ?? st.sales_w3  ?? 0,
        sales_w4:      s.sales_w4  ?? st.sales_w4  ?? 0,
        sales_28d:     s.sales_28d ?? st.sales_28d ?? 0,
        daily_sales:   st.daily_sales ?? {},   // from JSON (too large for API)
        last_data_date: lastDate || st.last_data_date || '',
        days_stock,
        log_pleche:    st.log_pleche ?? 30,
        cost:          ab.cost ?? st.cost ?? null,
        cost_per_unit: ab.cost ?? st.cost ?? null,
        margin_pct:    s.margin_pct ?? null,
        revenue:       ab.revenue ?? null,
        profitability: ab.profitability ?? null,
        turnover:      ab.turnover ?? null,
        tz:            ab.tz ?? null,
        chmd_clean:    ab.chmd_clean ?? null,
        price:         price_wb,
        order_mgr:     st.order_mgr   ?? null,
        order_delta:   null,
        order_calc:    st.order_calc  ?? 0,
        order_detail:  st.order_detail ?? null,
        plan:          st.plan ?? null,
        arrival_date:  st.arrival_date ?? null,
        qty_supply:    st.qty_supply  ?? null,
        niche_season:    niche?.seasonality  ?? st.niche_season    ?? '',
        niche_top_month: niche?.top_month    ?? st.niche_top_month ?? '',
        niche_months:    niche?.months       ?? st.niche_months    ?? null,
        note:      note.note      ?? '',
        note_user: note.user_name ?? '',
      }
    })

    console.log(`[order-data] DONE: ${result.length} items, ${Date.now()-t0}ms total`)
    return NextResponse.json({ data: result, last_date: lastDate, total: result.length })

  } catch (err: any) {
    console.error('order-data error:', err.message)
    return serveFallback()
  }
}

function serveFallback() {
  try {
    const p = join(process.cwd(), 'public', 'order_tab_data.json')
    const arr = JSON.parse(readFileSync(p, 'utf-8'))
    return NextResponse.json({ data: arr, last_date: '', total: arr.length })
  } catch {
    return NextResponse.json({ data: [], last_date: '', total: 0 })
  }
}
