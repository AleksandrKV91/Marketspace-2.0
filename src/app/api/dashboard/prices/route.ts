import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export const maxDuration = 30

export async function GET(req: NextRequest) {
  const supabase = createServiceClient()
  const { searchParams } = new URL(req.url)
  const search = searchParams.get('search') ?? ''

  // Все изменения цен — соединим с dim_sku для названия
  let query = supabase
    .from('fact_price_changes')
    .select('sku_wb, sku_ms, price_date, price')
    .order('price_date', { ascending: false })
    .limit(2000)

  if (search) {
    query = query.or(`sku_ms.ilike.%${search}%`)
  }

  const { data: priceRows, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // dim_sku для названий
  const skuMsList = [...new Set((priceRows ?? []).map(r => r.sku_ms).filter(Boolean))]
  const nameMap: Record<string, { name: string | null; brand: string | null; subject_wb: string | null }> = {}
  if (skuMsList.length) {
    const { data: dimRows } = await supabase
      .from('dim_sku')
      .select('sku_ms, name, brand, subject_wb')
      .in('sku_ms', skuMsList.slice(0, 1000))
    if (dimRows) {
      for (const r of dimRows) nameMap[r.sku_ms] = r
    }
  }

  // Группируем по sku_wb: список дат + цен → вычислим изменения
  const bySkuWb: Record<number, Array<{ date: string; price: number | null; sku_ms: string | null }>> = {}
  for (const r of priceRows ?? []) {
    if (!r.sku_wb) continue
    if (!bySkuWb[r.sku_wb]) bySkuWb[r.sku_wb] = []
    bySkuWb[r.sku_wb].push({ date: r.price_date, price: r.price, sku_ms: r.sku_ms })
  }

  const changes: Array<{
    sku_wb: number; sku_ms: string | null; name: string | null; brand: string | null; subject_wb: string | null
    price_date: string; price_after: number | null; price_before: number | null; delta_pct: number | null
  }> = []

  for (const [skuWbStr, entries] of Object.entries(bySkuWb)) {
    const skuWb = Number(skuWbStr)
    const sorted = [...entries].sort((a, b) => b.date.localeCompare(a.date))
    const skuMs = sorted[0]?.sku_ms ?? null
    const dim = skuMs ? nameMap[skuMs] : null

    for (let i = 0; i < sorted.length; i++) {
      const cur = sorted[i]
      const prev = sorted[i + 1] ?? null
      const delta = prev?.price && cur.price
        ? (cur.price - prev.price) / prev.price
        : null
      changes.push({
        sku_wb: skuWb,
        sku_ms: skuMs,
        name: dim?.name ?? null,
        brand: dim?.brand ?? null,
        subject_wb: dim?.subject_wb ?? null,
        price_date: cur.date,
        price_after: cur.price,
        price_before: prev?.price ?? null,
        delta_pct: delta,
      })
    }
  }

  // Сортировка по дате убывания
  changes.sort((a, b) => b.price_date.localeCompare(a.price_date))

  return NextResponse.json({ changes: changes.slice(0, 1000) })
}
