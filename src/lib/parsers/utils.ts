import * as XLSX from 'xlsx'

// ── Базовые утилиты парсеров ──────────────────────────────────────────────────

export function readWorkbook(buffer: ArrayBuffer) {
  return XLSX.read(buffer, { cellDates: false, raw: true })
}

export function sheetToRows(wb: XLSX.WorkBook, sheetName: string): unknown[][] {
  const ws = wb.Sheets[sheetName]
  if (!ws) throw new Error(`Лист "${sheetName}" не найден`)
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as unknown[][]
}

export function excelToISO(serial: unknown): string {
  if (!serial || typeof serial !== 'number') return ''
  const date = new Date((serial - 25569) * 86400 * 1000)
  return date.toISOString().split('T')[0]
}

export function norm(s: unknown): string {
  return String(s ?? '').trim().toLowerCase()
}

export function toNum(v: unknown): number | null {
  if (v === null || v === '' || v === undefined) return null
  const n = Number(v)
  return isNaN(n) ? null : n
}

export function toBool(v: unknown): boolean | null {
  if (v === null || v === '' || v === undefined) return null
  if (typeof v === 'boolean') return v
  const s = norm(v)
  if (s === 'true' || s === '1' || s === 'да' || s === 'yes') return true
  if (s === 'false' || s === '0' || s === 'нет' || s === 'no') return false
  return null
}

/** Найти индекс колонки по подстроке в заголовке */
export function findCol(headers: unknown[], query: string): number {
  return headers.findIndex(h => norm(h).includes(norm(query)))
}

/** Разбить массив на батчи */
export function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size))
  }
  return result
}
