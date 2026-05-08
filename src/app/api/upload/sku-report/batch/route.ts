import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export const maxDuration = 60

// Шаг 2 chunked-upload: принимает порцию строк и делает upsert в нужную таблицу.
// Параметры:
//   ?upload_id=UUID   — ID upload-записи (из /init)
//   ?part=daily|period|price_changes|dim — какая таблица
// Body: { rows: [...] } — массив до ~1000 строк (≤ 4MB JSON для Vercel).
export async function POST(req: NextRequest) {
  const supabase = createServiceClient()
  const url = new URL(req.url)
  const uploadId = url.searchParams.get('upload_id')
  const part = url.searchParams.get('part')

  if (!uploadId) return NextResponse.json({ error: 'upload_id обязателен' }, { status: 400 })
  if (!part) return NextResponse.json({ error: 'part обязателен' }, { status: 400 })

  let body: { rows?: Record<string, unknown>[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Невалидный JSON' }, { status: 400 })
  }
  const rows = body.rows ?? []
  if (rows.length === 0) return NextResponse.json({ ok: true, count: 0 })

  let table: string
  let onConflict: string
  let withUploadId = true

  switch (part) {
    case 'daily':
      table = 'fact_sku_daily'; onConflict = 'sku_ms,metric_date'; break
    case 'period':
      table = 'fact_sku_period'; onConflict = 'sku_ms,period_start,period_end'; break
    case 'price_changes':
      table = 'fact_price_changes'; onConflict = 'sku_wb,price_date'; break
    case 'dim':
      table = 'dim_sku'; onConflict = 'sku_ms'; withUploadId = false; break
    default:
      return NextResponse.json({ error: `Неизвестный part: ${part}` }, { status: 400 })
  }

  const payload = withUploadId
    ? rows.map(r => ({ ...r, upload_id: uploadId }))
    : rows

  const { error } = await supabase.from(table).upsert(payload, { onConflict })
  if (error) {
    // Помечаем upload как ошибочный, чтобы UI не показывал «pending» вечно
    await supabase.from('uploads').update({ status: 'error', error_msg: `${part}: ${error.message}` }).eq('id', uploadId)
    return NextResponse.json({ error: `${part}: ${error.message}` }, { status: 500 })
  }

  return NextResponse.json({ ok: true, count: rows.length })
}
