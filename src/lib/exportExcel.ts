import * as XLSX from 'xlsx'

export function exportToExcel(
  data: Record<string, unknown>[],
  filename: string,
  sheetName = 'Данные'
) {
  const ws = XLSX.utils.json_to_sheet(data)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  XLSX.writeFile(wb, filename + '.xlsx')
}

export function exportToExcelMultiSheet(
  sheets: Array<{ data: Record<string, unknown>[]; name: string }>,
  filename: string
) {
  const wb = XLSX.utils.book_new()
  for (const sheet of sheets) {
    const ws = XLSX.utils.json_to_sheet(sheet.data)
    XLSX.utils.book_append_sheet(wb, ws, sheet.name)
  }
  XLSX.writeFile(wb, filename + '.xlsx')
}
