import { SupabaseClient } from '@supabase/supabase-js'

/** Загружает все sku_ms из dim_sku в Set */
export async function loadKnownSkus(supabase: SupabaseClient): Promise<Set<string>> {
  const known = new Set<string>()
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from('dim_sku')
      .select('sku_ms')
      .range(from, from + 999)
    if (error || !data?.length) break
    for (const r of data) known.add(r.sku_ms)
    if (data.length < 1000) break
    from += 1000
  }
  return known
}
