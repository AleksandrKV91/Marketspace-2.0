import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export const maxDuration = 20

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  const result: Record<string, unknown> = {
    env: {
      NEXT_PUBLIC_SUPABASE_URL: url ? `${url.slice(0, 30)}…` : '❌ НЕ ЗАДАНА',
      SUPABASE_SERVICE_ROLE_KEY: key ? `${key.slice(0, 12)}…` : '❌ НЕ ЗАДАНА',
    },
  }

  if (!url || !key) {
    return NextResponse.json({ ...result, error: 'Env vars missing' }, { status: 500 })
  }

  const supabase = createServiceClient()

  // 1. Проверить подключение к БД
  try {
    const { count, error } = await supabase
      .from('uploads')
      .select('id', { count: 'exact', head: true })
    result.db_connection = error
      ? `❌ ${error.message}`
      : `✅ uploads таблица доступна (${count ?? 0} записей)`
  } catch (e) {
    result.db_connection = `❌ ${String(e)}`
  }

  // 2. Проверить Storage — список бакетов
  try {
    const { data: buckets, error } = await supabase.storage.listBuckets()
    if (error) {
      result.storage_buckets = `❌ ${error.message}`
    } else {
      const names = buckets?.map(b => b.name) ?? []
      const hasUploads = names.includes('uploads')
      result.storage_buckets = hasUploads
        ? `✅ Бакет 'uploads' существует (все бакеты: ${names.join(', ')})`
        : `❌ Бакет 'uploads' НЕ НАЙДЕН. Существующие: ${names.join(', ') || 'нет'}`
    }
  } catch (e) {
    result.storage_buckets = `❌ ${String(e)}`
  }

  // 3. Попробовать создать signed upload URL
  try {
    const testKey = `test/diag-${Date.now()}.txt`
    const { data, error } = await supabase.storage
      .from('uploads')
      .createSignedUploadUrl(testKey)
    if (error) {
      result.signed_url = `❌ createSignedUploadUrl: ${error.message}`
    } else {
      result.signed_url = `✅ Signed URL создан успешно (path: ${data?.path})`
      // Сразу удалим тестовый ключ если он вдруг создался
      await supabase.storage.from('uploads').remove([testKey]).catch(() => {})
    }
  } catch (e) {
    result.signed_url = `❌ ${String(e)}`
  }

  // 4. Проверить dim_sku (нужен для маппинга при загрузке)
  try {
    const { count, error } = await supabase
      .from('dim_sku')
      .select('sku_ms', { count: 'exact', head: true })
    result.dim_sku = error
      ? `❌ ${error.message}`
      : `${(count ?? 0) > 0 ? '✅' : '⚠️'} dim_sku: ${count ?? 0} строк ${(count ?? 0) === 0 ? '(каталог не загружен)' : ''}`
  } catch (e) {
    result.dim_sku = `❌ ${String(e)}`
  }

  // 5. Проверить fact_abc
  try {
    const { count, error } = await supabase
      .from('fact_abc')
      .select('sku_ms', { count: 'exact', head: true })
    result.fact_abc = error
      ? `❌ ${error.message}`
      : `${(count ?? 0) > 0 ? '✅' : '⚠️'} fact_abc: ${count ?? 0} строк`
  } catch (e) {
    result.fact_abc = `❌ ${String(e)}`
  }

  // 6. Проверить fact_sku_daily
  try {
    const { count, error } = await supabase
      .from('fact_sku_daily')
      .select('sku_ms', { count: 'exact', head: true })
    result.fact_sku_daily = error
      ? `❌ ${error.message}`
      : `${(count ?? 0) > 0 ? '✅' : '⚠️'} fact_sku_daily: ${count ?? 0} строк`
  } catch (e) {
    result.fact_sku_daily = `❌ ${String(e)}`
  }

  return NextResponse.json(result)
}
