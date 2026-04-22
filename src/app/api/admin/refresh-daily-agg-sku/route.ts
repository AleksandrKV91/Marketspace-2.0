import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export const maxDuration = 60

// POST /api/admin/refresh-daily-agg-sku
// Body (optional): { from?: string; to?: string }
// Пересчитывает daily_agg_sku через SQL-функцию refresh_daily_agg_sku()

export async function POST(req: NextRequest) {
  const supabase = createServiceClient()
  const body = await req.json().catch(() => ({}))
  const fromParam: string | null = body.from ?? null
  const toParam: string | null = body.to ?? null

  const { data, error } = await supabase.rpc('refresh_daily_agg_sku', {
    from_date: fromParam,
    to_date:   toParam,
  })

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    ok:       true,
    agg_rows: data?.agg_rows ?? 0,
    from:     data?.from ?? fromParam ?? 'all',
    to:       data?.to ?? toParam ?? 'all',
  })
}
