import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Fetches all rows from a Supabase query using range-based pagination.
 * Supabase default limit is 1000 rows — this bypasses that.
 */
export async function fetchAll<T>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  buildQuery: (client: SupabaseClient<any>) => any,
  supabase: SupabaseClient,
  pageSize = 1000,
): Promise<T[]> {
  const results: T[] = []
  let from = 0
  while (true) {
    const { data, error } = await buildQuery(supabase).range(from, from + pageSize - 1)
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break
    results.push(...data)
    if (data.length < pageSize) break
    from += pageSize
  }
  return results
}
