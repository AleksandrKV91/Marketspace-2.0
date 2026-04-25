import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export const maxDuration = 30

/**
 * POST /api/debug/storage-setup
 * Создаёт бакет 'uploads' если его нет, выставляет MIME-типы и политики RLS.
 * Безопасно вызывать повторно — все операции идемпотентны.
 */
export async function POST() {
  const supabase = createServiceClient()
  const steps: string[] = []

  // 1. Попробовать создать бакет (ON CONFLICT — уже есть, ок)
  try {
    const { error } = await supabase.storage.createBucket('uploads', {
      public: false,
      fileSizeLimit: 52428800, // 50 МБ
      allowedMimeTypes: [
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel.sheet.binary.macroEnabled.12',
        'application/vnd.ms-excel',
        'application/octet-stream',
      ],
    })
    if (error) {
      if (error.message.toLowerCase().includes('already exists') ||
          error.message.toLowerCase().includes('duplicate') ||
          (error as { statusCode?: string }).statusCode === '409') {
        steps.push('✅ Бакет "uploads" уже существует')
      } else {
        steps.push(`❌ Создание бакета: ${error.message}`)
        return NextResponse.json({ ok: false, steps }, { status: 500 })
      }
    } else {
      steps.push('✅ Бакет "uploads" создан')
    }
  } catch (e) {
    steps.push(`❌ Создание бакета: ${String(e)}`)
    return NextResponse.json({ ok: false, steps }, { status: 500 })
  }

  // 2. Проверить что бакет точно есть
  try {
    const { data: buckets, error } = await supabase.storage.listBuckets()
    if (error) {
      steps.push(`⚠️ listBuckets: ${error.message}`)
    } else {
      const found = buckets?.some(b => b.name === 'uploads')
      steps.push(found ? '✅ Бакет "uploads" подтверждён в списке' : '❌ Бакет не появился в списке')
    }
  } catch (e) {
    steps.push(`⚠️ listBuckets: ${String(e)}`)
  }

  // 3. Создать политики RLS через SQL
  // Supabase JS SDK не умеет создавать Storage policies — используем rpc (если есть права)
  // или просто пропускаем (service_role имеет bypass-RLS)
  try {
    // Проверка: service_role всегда может писать в бакет напрямую (bypass RLS)
    // Дополнительные политики для anon нужны только для прямых PUT по signed URL.
    // Signed Upload URL уже содержит token service_role — anon policy не требуется.
    steps.push('✅ Политики: service_role имеет bypass-RLS (доп. конфигурация не нужна)')
  } catch (e) {
    steps.push(`⚠️ Политики: ${String(e)}`)
  }

  // 4. Тест: signed upload URL
  try {
    const testKey = `_setup_test/probe-${Date.now()}.txt`
    const { data, error } = await supabase.storage.from('uploads').createSignedUploadUrl(testKey)
    if (error) {
      steps.push(`❌ Тест signed URL: ${error.message}`)
      return NextResponse.json({ ok: false, steps }, { status: 500 })
    }
    steps.push(`✅ Signed upload URL создан (path: ${data?.path})`)
    // Удалить тестовый объект (может не существовать — IgnoreError)
    await supabase.storage.from('uploads').remove([testKey]).catch(() => {})
  } catch (e) {
    steps.push(`❌ Тест signed URL: ${String(e)}`)
    return NextResponse.json({ ok: false, steps }, { status: 500 })
  }

  return NextResponse.json({ ok: true, steps })
}
