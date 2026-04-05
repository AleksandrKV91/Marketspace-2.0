import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  const { storageKey } = await req.json()
  if (!storageKey) return NextResponse.json({ error: 'storageKey required' }, { status: 400 })

  const supabase = createServiceClient()

  const { data, error } = await supabase.storage
    .from('uploads')
    .createSignedUploadUrl(storageKey)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ signedUrl: data.signedUrl, token: data.token, path: data.path })
}
