/**
 * Shared number formatting utilities used across all dashboard tabs.
 *
 * Rules:
 *  - Axis ticks  → fmtAxis  (abbreviated: 41.7М / 180К)
 *  - KPI cards / tooltips → fmtFull (full: 41 706 916)
 *  - Percentages → fmtPct
 */

/** For chart axis ticks: compact abbreviation */
export function fmtAxis(n: number | null | undefined): string {
  if (n == null) return ''
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'М'
  if (abs >= 1_000)     return (n / 1_000).toFixed(0) + 'К'
  return String(Math.round(n))
}

/** For KPI cards and tooltips: full locale number */
export function fmtFull(n: number | null | undefined): string {
  if (n == null) return '—'
  return Math.round(n).toLocaleString('ru-RU')
}

/** For percentages: fixed decimals + '%' */
export function fmtPct(n: number | null | undefined, decimals = 1): string {
  if (n == null) return '—'
  return Number(n).toFixed(decimals) + '%'
}

/** Returns 'н/д' for null/undefined/NaN/empty values; otherwise String(v). */
export function fmtOrNA(v: unknown): string {
  if (v === null || v === undefined || v === '') return 'н/д'
  if (typeof v === 'number' && isNaN(v)) return 'н/д'
  return String(v)
}

/**
 * Delta formula: (curr - prev) / curr × 100, capped at ±100%.
 * Returns null when either value is null/undefined.
 * When curr === 0 and prev !== 0 → returns -100.
 * When prev === 0 and curr !== 0 → returns +100.
 */
export function calcDelta(
  curr: number | null | undefined,
  prev: number | null | undefined,
): number | null {
  if (curr == null || prev == null) return null
  if (curr === 0 && prev === 0) return null
  if (curr === 0) return -100
  if (prev === 0) return 100
  const raw = ((curr - prev) / Math.abs(curr)) * 100
  return Math.max(-100, Math.min(100, raw))
}
