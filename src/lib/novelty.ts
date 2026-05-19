// Утилиты для работы со статусом «новинка» из колонки I «Отчёта по SKU».
// В файле значение может быть «Новинка», «Новинки», «NEW» — нормализуем сравнение.

export function isNovelty(status: string | null | undefined): boolean {
  if (!status) return false
  const s = String(status).trim().toLowerCase()
  return s.startsWith('новинк') || s === 'new'
}

export function matchesNoveltyFilter(
  status: string | null | undefined,
  filter: string | null | undefined,
): boolean {
  if (!filter) return true
  const isNew = isNovelty(status)
  if (filter === 'Новинки') return isNew
  if (filter === 'Не новинки') return !isNew
  return true
}
