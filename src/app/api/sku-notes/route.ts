import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  const { sku_ms, note } = await req.json()
  if (!sku_ms) return NextResponse.json({ error: 'sku_ms required' }, { status: 400 })
  const supabase = createServiceClient()
  const { error } = await supabase.from('sku_notes').upsert({ sku_ms, note }, { onConflict: 'sku_ms' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
