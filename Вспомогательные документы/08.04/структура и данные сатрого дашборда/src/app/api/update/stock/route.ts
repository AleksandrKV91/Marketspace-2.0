/**
 * src/app/api/update/stock/route.ts
 * Парсит sheet1 таблицы остатков (xlsx/xlsb) и сохраняет в Supabase:
 *   - stock_daily_sales: продажи по дням (накопительно, upsert по article+date)
 *   - stock_sheet1: агрегаты + остатки
 *
 * Особенности формата:
 *   - Дата-колонки могут дублироваться (одна дата = несколько столбцов).
 *     При дублировании берём последнее вхождение.
 *   - Позиции колонок остатков (FBO WB, FBS и т.д.) определяются
 *     по заголовкам, а не по фиксированным индексам.
 *   - Один артикул — одна строка данных (дубликатов нет).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'

export const maxDuration = 60

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Fixed column indices (0-based) — stable across versions
const COL_FIXED = {
  CATEGORY:     0,
  PRED:         1,
  SKU_WB:       2,
  BRAND:        3,
  ARTICLE:      4,
  STATUS:       8,
  DATE_SHELF:   9,
  PREV_STATUS:  10,
  SUPPLIER:     13,
  COUNTRY:      14,
  MARGIN_PCT:   38,
  QTY_SUPPLY:   28,
  ARRIVAL_DATE: 29,
}

// Headers to search for stock columns (may shift between versions)
const STOCK_HEADERS: Record<string, string> = {
  'Остаток на ВБ ФБО':    'fbo_wb',
  'Остаток FBS Пушкино':  'fbs_push',
  'Остаток FBS Смоленск': 'fbs_smol',
  'Остаток всего':        'total_stock',
}

const sf = (v: unknown) => { const n = parseFloat(String(v)); return isNaN(n)||!isFinite(n)?null:n }
const si = (v: unknown) => { const n = sf(v); return n!==null?Math.round(n):null }
const ss = (v: unknown) => { const s = String(v??'').trim(); return ['nan','undefined','null'].includes(s)?'':s }
const toISO = (v: unknown): string|null => {
  if (v == null) return null
  // Excel serial number (e.g. shelf_date stored as integer)
  if (typeof v === 'number' && v > 40000 && v < 60000) return excelToISO(v)
  const s = String(v).trim()
  if (!s || s === 'nan' || s === 'null') return null
  // DD.MM.YYYY (Russian format from arrival_date)
  if (s.length === 10 && s[2] === '.' && s[5] === '.') {
    const [dd, mm, yyyy] = s.split('.')
    if (yyyy && mm && dd) return `${yyyy}-${mm.padStart(2,'0')}-${dd.padStart(2,'0')}`
  }
  // ISO YYYY-MM-DD
  if (s.length >= 10 && s[4] === '-') return s.slice(0,10)
  return null
}
const excelToISO = (n: number): string|null => {
  if (n<40000||n>60000) return null
  const d = new Date((n-25569)*86400000)
  // Use UTC to avoid timezone shift
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`
}

export async function POST(req: NextRequest) {
  // Auth
  const token = req.headers.get('authorization')?.replace('Bearer ','').trim()
  if (!token) return NextResponse.json({error:'Нет токена'},{status:401})
  const {data:{user},error:ae} = await supabaseAdmin.auth.getUser(token)
  if (ae||!user) return NextResponse.json({error:'Не авторизован'},{status:401})
  const {data:profile} = await supabaseAdmin.from('users').select('role').eq('id',user.id).single()
  if (!['admin','analyst'].includes(profile?.role??''))
    return NextResponse.json({error:'Недостаточно прав'},{status:403})

  // Parse file
  const form = await req.formData()
  const file = form.get('file') as File|null
  if (!file) return NextResponse.json({error:'Файл не прикреплён'},{status:400})

  const buf = Buffer.from(await file.arrayBuffer())
  const wb  = XLSX.read(buf, { type:'buffer', cellDates:false, raw:true })
  const sn  = wb.SheetNames.find(s => s.toLowerCase()==='sheet1' || s==='Лист1')
  if (!sn) return NextResponse.json({error:`sheet1 не найден. Листы: ${wb.SheetNames.join(', ')}`},{status:422})

  const ws  = wb.Sheets[sn]
  const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, {header:1, defval:null, raw:true})
  if (raw.length < 8) return NextResponse.json({error:'Файл слишком короткий'},{status:422})

  const hdrs = raw[5] as unknown[]  // строка 6 (0-based: 5) = заголовки

  // 1. Find date columns — deduplicate by date (last occurrence wins)
  const dateColMap = new Map<string, number>()  // iso_date -> col_index
  for (let ci = 0; ci < hdrs.length; ci++) {
    const h = hdrs[ci]
    if (h == null) continue
    let iso: string|null = null
    if (typeof h === 'number' && h > 40000 && h < 60000) {
      iso = excelToISO(h)
    } else if (h instanceof Date) {
      iso = h.toISOString().slice(0,10)
    } else if (typeof h === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(h)) {
      iso = h
    }
    if (iso) dateColMap.set(iso, ci)  // overwrites duplicate dates — last wins
  }

  const dateCols = [...dateColMap.entries()].map(([date,ci]) => ({date,ci}))
  dateCols.sort((a,b) => a.date.localeCompare(b.date))
  const lastDate = dateCols.at(-1)?.date ?? ''

  if (dateCols.length < 5)
    return NextResponse.json({error:`Найдено только ${dateCols.length} дат. Проверьте файл.`},{status:422})

  // 2. Find stock columns by header name (resilient to column shifts)
  const stockColIdx: Record<string,number> = {}
  for (let ci = 0; ci < hdrs.length; ci++) {
    const h = ss(hdrs[ci])
    const field = STOCK_HEADERS[h]
    if (field) stockColIdx[field] = ci
  }
  // Fallback to old fixed positions if headers not found
  if (!stockColIdx['fbo_wb'])    stockColIdx['fbo_wb']    = 781
  if (!stockColIdx['fbs_push'])  stockColIdx['fbs_push']  = 782
  if (!stockColIdx['fbs_smol'])  stockColIdx['fbs_smol']  = 783
  if (!stockColIdx['total_stock']) stockColIdx['total_stock'] = 784

  // 3. Process rows
  // Deduplicate by article within file (sum sales if duplicate articles)
  const articleDailyMap = new Map<string, Map<string, number>>()
  const articleMeta = new Map<string, any>()

  for (let ri = 6; ri < raw.length; ri++) {
    const row = raw[ri] as unknown[]
    const article = ss(row[COL_FIXED.ARTICLE])
    if (!article) continue

    // Accumulate daily sales per article (handles duplicate rows)
    if (!articleDailyMap.has(article)) {
      articleDailyMap.set(article, new Map())
      articleMeta.set(article, row)
    }
    const dayMap = articleDailyMap.get(article)!

    for (const {ci, date} of dateCols) {
      const qty = sf(row[ci])
      if (qty !== null && qty !== 0) {
        dayMap.set(date, (dayMap.get(date) ?? 0) + qty)
      }
    }
  }

  // 4. Build rows for Supabase
  const stockRows: object[] = []
  const dailyRows: object[] = []

  for (const [article, dayMap] of articleDailyMap) {
    const row = articleMeta.get(article) as unknown[]

    // daily sales rows (unique article+date guaranteed)
    for (const [date, qty] of dayMap) {
      dailyRows.push({article, sale_date: date, qty: +qty.toFixed(2)})
    }

    // aggregates
    const vals = [...dayMap.entries()].map(([date,qty]) => ({date,qty}))
    vals.sort((a,b) => a.date.localeCompare(b.date))

    const mk = (days: number) => {
      const d = new Date(lastDate); d.setDate(d.getDate()-days); return d
    }
    const c7=mk(7), c14=mk(14), c28=mk(28), c31=mk(31)
    const inR = (v:{date:string}, cutoff:Date) => new Date(v.date) > cutoff
    const mean = (a:number[]) => a.length ? a.reduce((s,x)=>s+x,0)/a.length : 0
    const sum  = (a:number[]) => a.reduce((s,x)=>s+x,0)

    const v7  = vals.filter(v=>inR(v,c7)).map(v=>v.qty)
    const v14 = vals.filter(v=>inR(v,c14)).map(v=>v.qty)
    const v31 = vals.filter(v=>inR(v,c31)).map(v=>v.qty)

    const dpd7=mean(v7), dpd14=mean(v14), dpd31=mean(v31)
    const oos7=v7.filter(x=>x===0).length
    const oos14=v14.filter(x=>x===0).length
    const oos31=v31.filter(x=>x===0).length

    const vPrev14 = vals.filter(v=>new Date(v.date)>mk(28)&&!inR(v,c14)).map(v=>v.qty)
    const trend14 = mean(vPrev14)>0 ? (dpd14-mean(vPrev14))/mean(vPrev14) : null
    const cv31    = dpd31>0&&v31.length>2
      ? Math.sqrt(v31.reduce((s,v)=>s+(v-dpd31)**2,0)/(v31.length-1))/dpd31 : null

    const lyDate = new Date(lastDate); lyDate.setFullYear(lyDate.getFullYear()-1)
    const lyM = lyDate.toISOString().slice(0,7)
    const lyVals = vals.filter(v=>v.date.startsWith(lyM)).map(v=>v.qty)
    const dpdLy = lyVals.length ? mean(lyVals) : null

    const wk = (dt:number, df:number) => Math.round(sum(
      vals.filter(v=>new Date(v.date)>mk(dt)&&new Date(v.date)<=mk(df)).map(v=>v.qty)
    ))
    const sales_w1=wk(7,0), sales_w2=wk(14,7), sales_w3=wk(21,14), sales_w4=wk(28,21)

    const fbo_wb  = si(row[stockColIdx['fbo_wb']]) ?? 0
    const fbs_push= si(row[stockColIdx['fbs_push']]) ?? 0
    const fbs_smol= si(row[stockColIdx['fbs_smol']]) ?? 0
    const totalStock = fbo_wb + fbs_push + fbs_smol

    stockRows.push({
      article, sku_wb:si(row[COL_FIXED.SKU_WB]),
      category:ss(row[COL_FIXED.CATEGORY]), pred:ss(row[COL_FIXED.PRED]),
      brand:ss(row[COL_FIXED.BRAND]), status:ss(row[COL_FIXED.STATUS]),
      prev_status:ss(row[COL_FIXED.PREV_STATUS]),
      shelf_date:toISO(row[COL_FIXED.DATE_SHELF]),
      supplier:ss(row[COL_FIXED.SUPPLIER]), country:ss(row[COL_FIXED.COUNTRY]),
      margin_pct:sf(row[COL_FIXED.MARGIN_PCT]),
      qty_supply:si(row[COL_FIXED.QTY_SUPPLY]),
      arrival_date:toISO(row[COL_FIXED.ARRIVAL_DATE])||ss(row[COL_FIXED.ARRIVAL_DATE])||null,
      fbo_wb, fbs_push, fbs_smol, total_stock:totalStock,
      dpd_7:+dpd7.toFixed(2), dpd_14:+dpd14.toFixed(2), dpd_31:+dpd31.toFixed(2),
      oos_7:oos7, oos_14:oos14, oos_31:oos31,
      trend_14:trend14!==null?+trend14.toFixed(4):null,
      cv_31:cv31!==null?+cv31.toFixed(4):null,
      dpd_ly:dpdLy!==null?+dpdLy.toFixed(2):null,
      sales_w1, sales_w2, sales_w3, sales_w4, sales_28d:sales_w1+sales_w2+sales_w3+sales_w4,
      last_data_date:lastDate, updated_at:new Date().toISOString(),
    })
  }

  if (!stockRows.length) return NextResponse.json({error:'Нет данных'},{status:422})

  // 5. Upsert — deduplicate dailyRows by article+date before upserting
  const dailyDedup = new Map<string, object>()
  for (const r of dailyRows as any[]) {
    dailyDedup.set(`${r.article}__${r.sale_date}`, r)
  }
  const dailyUniq = [...dailyDedup.values()]

  const BATCH = 500
  let dailySaved = 0
  for (let i=0; i<dailyUniq.length; i+=BATCH) {
    const {error} = await supabaseAdmin.from('stock_daily_sales')
      .upsert(dailyUniq.slice(i,i+BATCH), {onConflict:'article,sale_date'})
    if (error) return NextResponse.json({error:`stock_daily_sales: ${error.message}`},{status:500})
    dailySaved += Math.min(BATCH, dailyUniq.length-i)
  }

  let stockSaved = 0
  for (let i=0; i<stockRows.length; i+=BATCH) {
    const {error} = await supabaseAdmin.from('stock_sheet1')
      .upsert(stockRows.slice(i,i+BATCH), {onConflict:'article'})
    if (error) return NextResponse.json({error:`stock_sheet1: ${error.message}`},{status:500})
    stockSaved += Math.min(BATCH, stockRows.length-i)
  }

  return NextResponse.json({
    message:`Обновлено ${stockSaved} SKU, ${dailySaved} строк продаж (по ${lastDate})`,
    skus:stockSaved, daily:dailySaved, dates:dateCols.length, last_date:lastDate,
    stock_cols: stockColIdx,
  })
}
