// Module-level in-memory cache for Next.js API routes (Node.js process-level)
// Lives across requests within the same server instance

interface CacheEntry<T> {
  data: T
  ts: number
}

const cache = new Map<string, CacheEntry<unknown>>()

export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const now = Date.now()
  const entry = cache.get(key) as CacheEntry<T> | undefined
  if (entry && now - entry.ts < ttlMs) return entry.data
  const data = await fn()
  cache.set(key, { data, ts: now })
  return data
}

export function invalidate(key: string) {
  cache.delete(key)
}

export function invalidatePrefix(prefix: string) {
  for (const k of cache.keys()) {
    if (k.startsWith(prefix)) cache.delete(k)
  }
}
