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
