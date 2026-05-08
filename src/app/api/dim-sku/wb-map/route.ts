import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export const maxDuration = 30

// Маленький endpoint: возвращает map { sku_wb: sku_ms } для frontend-парсинга sku-report.
// Размер ответа: ~2K SKU × ~30 bytes = 60KB JSON, после gzip ~15KB.
// Используется только UpdateTab — обходит backend storage download (огромный egress).
export async function GET() {
  const supabase = createServiceClient()
  const map: Record<string, string> = {}

  // Пагинированно тащим все sku_wb→sku_ms из dim_sku
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from('dim_sku')
      .select('sku_wb, sku_ms')
      .not('sku_wb', 'is', null)
      .range(from, from + 999)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data?.length) break
    for (const row of data) {
      if (row.sku_wb != null) map[String(row.sku_wb)] = row.sku_ms
    }
    if (data.length < 1000) break
    from += 1000
  }

  return NextResponse.json({ map }, {
    headers: {
      // Кэшируем на 60 секунд — обновится при следующем запросе после загрузки Свода
      'Cache-Control': 'private, max-age=60',
    },
  })
}
