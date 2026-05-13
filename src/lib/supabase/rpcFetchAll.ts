import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Постраничный фетчер для RPC-функций, возвращающих TABLE.
 *
 * Supabase managed PostgREST имеет серверный `max-rows = 1000` который режет любой
 * одноразовый .range(0, 199999). Этот хелпер обходит лимит — повторно вызывает RPC
 * с .range(from, from + pageSize - 1), пока возвращаются данные.
 *
 * ВАЖНО: GROUP BY в RPC выполняется заново на каждой странице (Postgres LIMIT/OFFSET
 * после агрегации). Для функций до ~10К строк это приемлемо (3 страницы × 200мс).
 */
export async function rpcFetchAll<T>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpcBuilder: () => any,
  pageSize = 1000,
): Promise<{ data: T[]; error: { message?: string } | null }> {
  const all: T[] = []
  let from = 0
  while (true) {
    try {
      const res = await rpcBuilder().range(from, from + pageSize - 1)
      if (res.error) return { data: all, error: res.error }
      const page = (res.data ?? []) as T[]
      if (page.length === 0) break
      all.push(...page)
      if (page.length < pageSize) break
      from += pageSize
      if (from > 100_000) break  // safety stop
    } catch (e: unknown) {
      return { data: all, error: { message: e instanceof Error ? e.message : String(e) } }
    }
  }
  return { data: all, error: null }
}

/** Универсально не-RPC версия — для будущих не-табличных RPC. */
export type RpcResult<T> = { data: T[] | null; error: { message?: string } | null }
