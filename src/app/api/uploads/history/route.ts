import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export const maxDuration = 30

export async function GET() {
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('uploads')
    .select('id, file_type, filename, uploaded_at, rows_count, status, error_msg')
    .order('uploaded_at', { ascending: false })
    .limit(50)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ uploads: data })
}
