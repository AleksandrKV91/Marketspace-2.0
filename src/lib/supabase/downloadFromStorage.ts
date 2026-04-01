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

  // Удалить файл из Storage
  await supabase.storage.from('uploads').remove([storageKey])

  // Blob → Uint8Array → ArrayBuffer (надёжнее на Node.js/Edge)
  const ab = await data.arrayBuffer()
  // Создать новый ArrayBuffer из копии данных (избегаем detached buffer)
  const copy = new Uint8Array(ab.byteLength)
  copy.set(new Uint8Array(ab))
  return copy.buffer
}
