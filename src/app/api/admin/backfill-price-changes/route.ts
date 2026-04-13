/**
 * POST /api/admin/backfill-price-changes
 * Перебирает все xlsb-файлы из папки (переданной в body как { dir }),
 * парсит блок «Изменение цены» (CJ-CN) и записывает в fact_price_changes.
 *
 * Body: { dir: string }  — абсолютный путь к папке с xlsb-файлами
 * (используется только на сервере, локально или в Vercel с файловой системой)
 *
 * Fallback: если dir не передан или файлы недоступны,
 * заполняет fact_price_changes из fact_sku_snapshot (snap_date + price).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { parseSkuReport } from '@/lib/parsers/parseSkuReport'
import { chunk } from '@/lib/parsers/utils'
import { readFile, readdir } from 'fs/promises'
import path from 'path'

export const maxDuration = 300

export async function POST(req: NextRequest) {
  const supabase = createServiceClient()
  const body = await req.json().catch(() => ({}))
  const dir: string | undefined = body?.dir

  // Загружаем маппинг WB→MS из dim_sku
  const skuMap = new Map<string, string>()
  let from = 0
  while (true) {
    const { data, error } = await supabase.from('dim_sku').select('sku_wb,sku_ms').not('sku_wb', 'is', null).range(from, from + 999)
    if (error || !data?.length) break
    for (const row of data) { if (row.sku_wb) skuMap.set(String(row.sku_wb), row.sku_ms) }
    if (data.length < 1000) break
    from += 1000
  }

  let totalPriceRows = 0
  let totalUpserted = 0
  let totalErrors = 0
  let filesProcessed = 0
  const fileErrors: string[] = []

  if (dir) {
    // Режим: парсим xlsb из локальной папки
    let files: string[] = []
    try {
      const entries = await readdir(dir)
      files = entries.filter(f => f.toLowerCase().endsWith('.xlsb') || f.toLowerCase().endsWith('.xlsx'))
    } catch (e) {
      return NextResponse.json({ error: `Cannot read dir: ${String(e)}` }, { status: 400 })
    }

    for (const file of files) {
      try {
        const filePath = path.join(dir, file)
        const buf = await readFile(filePath)
        const parsed = parseSkuReport(buf.buffer as ArrayBuffer, skuMap.size > 0 ? skuMap : undefined)

        // Дедупликация по (sku_wb, price_date)
        const dedup = new Map<string, { sku_wb: number; sku_ms: string; price_date: string; price: number }>()
        for (const r of parsed.priceChanges) {
          if (r.sku_wb) dedup.set(`${r.sku_wb}|${r.price_date}`, { sku_wb: r.sku_wb, sku_ms: r.sku_ms, price_date: r.price_date, price: r.price })
        }
        // Также snap_date + price из снапшота
        for (const s of parsed.snapshots) {
          if (s.sku_wb && s.price != null && s.snap_date) {
            const key = `${s.sku_wb}|${s.snap_date}`
            if (!dedup.has(key)) dedup.set(key, { sku_wb: s.sku_wb, sku_ms: s.sku_ms, price_date: s.snap_date, price: s.price })
          }
        }

        const rows = [...dedup.values()]
        totalPriceRows += rows.length

        for (const batch of chunk(rows, 500)) {
          const { error } = await supabase.from('fact_price_changes').upsert(batch, { onConflict: 'sku_wb,price_date' })
          if (error) { totalErrors++; console.error(file, error.message) }
          else totalUpserted += batch.length
        }
        filesProcessed++
      } catch (e) {
        fileErrors.push(`${file}: ${String(e)}`)
      }
    }
  } else {
    // Fallback: заполнить из fact_sku_snapshot (snap_date + price)
    type SnapRow = { sku_wb: number | null; sku_ms: string | null; snap_date: string; price: number | null }
    const allSnaps: SnapRow[] = []
    let offset = 0
    while (true) {
      const { data, error } = await supabase
        .from('fact_sku_snapshot')
        .select('sku_wb, sku_ms, snap_date, price')
        .not('sku_wb', 'is', null)
        .not('price', 'is', null)
        .range(offset, offset + 999)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      if (!data?.length) break
      allSnaps.push(...data)
      if (data.length < 1000) break
      offset += 1000
    }

    const dedup = new Map<string, SnapRow>()
    for (const r of allSnaps) {
      if (r.sku_wb && r.snap_date && r.price != null) dedup.set(`${r.sku_wb}|${r.snap_date}`, r)
    }

    const rows = [...dedup.values()].map(r => ({ sku_wb: r.sku_wb!, sku_ms: r.sku_ms, price_date: r.snap_date, price: r.price! }))
    totalPriceRows = rows.length

    for (const batch of chunk(rows, 500)) {
      const { error } = await supabase.from('fact_price_changes').upsert(batch, { onConflict: 'sku_wb,price_date' })
      if (error) { totalErrors++; console.error(error.message) }
      else totalUpserted += batch.length
    }
  }

  return NextResponse.json({
    ok: true,
    mode: dir ? 'xlsb_files' : 'snapshot_fallback',
    files_processed: filesProcessed,
    total_price_rows: totalPriceRows,
    upserted: totalUpserted,
    errors: totalErrors,
    file_errors: fileErrors,
    sku_map_size: skuMap.size,
  })
}
