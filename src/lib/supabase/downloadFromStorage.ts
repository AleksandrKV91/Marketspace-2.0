import { SupabaseClient } from '@supabase/supabase-js'

/** Скачать файл из Storage и вернуть ArrayBuffer. Удалить после скачивания. */
export async function downloadFromStorage(
  supabase: SupabaseClient,
  storageKey: string
): Promise<ArrayBuffer> {
  const { data, error } = await supabase.storage
    .from('uploads')
    .download(storageKey)

  if (error) throw new Error(`Storage download: ${error.message}`)

  // Удалить файл из Storage (он нам больше не нужен)
  await supabase.storage.from('uploads').remove([storageKey])

  return data.arrayBuffer()
}
