import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function getUserName(req: NextRequest) {
  try {
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cookieStore.getAll() } }
    )
    const { data: { user } } = await supabase.auth.getUser()
    return user?.email ?? user?.id ?? 'unknown'
  } catch { return 'unknown' }
}

// GET /api/notes?sku_id=123
export async function GET(req: NextRequest) {
  const sku_id = req.nextUrl.searchParams.get('sku_id')
  if (!sku_id) return NextResponse.json({ error: 'sku_id required' }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('sku_notes')
    .select('note, user_name, updated_at')
    .eq('sku_id', sku_id)
    .single()

  if (error && error.code !== 'PGRST116') {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({
    note: data?.note ?? '',
    user_name: data?.user_name ?? '',
    updated_at: data?.updated_at ?? null
  })
}

// POST /api/notes  body: { sku_id, note }
export async function POST(req: NextRequest) {
  const { sku_id, note } = await req.json()
  if (!sku_id) return NextResponse.json({ error: 'sku_id required' }, { status: 400 })

  const user_name = await getUserName(req)

  const { error } = await supabaseAdmin
    .from('sku_notes')
    .upsert(
      { sku_id, note, user_name, updated_at: new Date().toISOString() },
      { onConflict: 'sku_id' }
    )

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
