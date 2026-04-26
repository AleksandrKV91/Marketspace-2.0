'use client'

import { useState, useCallback, useRef } from 'react'

// ── Типы ─────────────────────────────────────────────────────────────────────

type FileType = 'catalog' | 'abc' | 'china' | 'sku-report' | 'analytics'

interface UploadState {
  status: 'idle' | 'uploading' | 'ok' | 'error'
  progress: number
  message: string
  detail?: string
  lastAt?: string
  rowsCount?: number
  rowsSkipped?: number
  skippedSkus?: string[]
}

interface UploadRecord {
  id: string
  file_type: string
  filename: string
  uploaded_at: string
  rows_count: number | null
  status: string
  error_msg: string | null
}

// ── Конфигурация файлов ───────────────────────────────────────────────────────

const FILE_CONFIGS: Array<{
  type: FileType
  label: string
  hint: string
  accept: string
  order: number
}> = [
  { type: 'catalog', label: 'Свод', hint: 'Свод.xlsb — справочник SKU', accept: '.xlsb,.xlsx', order: 1 },
  { type: 'abc', label: 'АВС анализ', hint: 'АВС_анализ_*.xlsx', accept: '.xlsx,.xlsb', order: 2 },
  { type: 'china', label: 'Потребность Китай', hint: 'Потребность_Китай_*.xlsx', accept: '.xlsx,.xlsb', order: 3 },
  { type: 'sku-report', label: 'Отчёт по SKU', hint: 'Отчет_по_SKU_*.xlsb', accept: '.xlsb,.xlsx', order: 4 },
  { type: 'analytics' as FileType, label: 'Аналитика', hint: 'Аналитика_*.xlsx', accept: '.xlsx,.xlsb', order: 5 },
]

// ── Загрузка через Supabase Storage → API parse ───────────────────────────────

async function uploadViaStorage(
  type: FileType,
  file: File,
  onProgress: (pct: number) => void
): Promise<{ ok: boolean; rows_parsed?: number; rows_skipped?: number; skipped_skus?: string[]; unknown_skus?: string[]; error?: string }> {
  onProgress(20)
  const form = new FormData()
  form.append('file', file, file.name)
  try {
    const res = await fetch(`/api/upload/${type}`, { method: 'POST', body: form })
    onProgress(90)
    const json = await res.json()
    if (res.ok && json.ok) {
      return {
        ok: true,
        rows_parsed: json.rows_parsed,
        rows_skipped: json.rows_skipped,
        skipped_skus: json.diag_skipped_skus,
        unknown_skus: json.unknown_skus,
      }
    }
    return { ok: false, error: json.error ?? 'Ошибка парсинга' }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

// ── Компонент одной карточки загрузки ─────────────────────────────────────────

function UploadCard({
  config,
  state,
  onFile,
}: {
  config: typeof FILE_CONFIGS[0]
  state: UploadState
  onFile: (file: File) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) onFile(file)
  }, [onFile])

  const statusColor = {
    idle: 'text-gray-400',
    uploading: 'text-blue-500',
    ok: 'text-green-500',
    error: 'text-red-500',
  }[state.status]

  const statusIcon = {
    idle: '○',
    uploading: '◌',
    ok: '✓',
    error: '✗',
  }[state.status]

  return (
    <div className="rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-gray-400 dark:text-gray-500">
            {config.order}.
          </span>
          <span className="font-semibold text-[#1A1A2E] dark:text-white">
            {config.label}
          </span>
        </div>
        <span className={`text-sm font-medium ${statusColor}`}>
          {statusIcon} {state.message}
        </span>
      </div>

      <div
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={`
          relative cursor-pointer rounded-lg border-2 border-dashed px-4 py-5 text-center transition-colors
          ${dragging
            ? 'border-[#E63946] bg-red-50 dark:bg-red-900/10'
            : 'border-gray-200 dark:border-white/10 hover:border-[#E63946] hover:bg-gray-50 dark:hover:bg-white/5'
          }
        `}
      >
        <input
          ref={inputRef}
          type="file"
          accept={config.accept}
          className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = '' }}
        />
        <p className="text-sm text-gray-400 dark:text-gray-500">
          Перетащите файл или{' '}
          <span className="text-[#E63946] font-medium">выберите</span>
        </p>
        <p className="text-xs text-gray-300 dark:text-gray-600 mt-1">{config.hint}</p>
      </div>

      {state.status === 'uploading' && (
        <div className="mt-3 h-1.5 rounded-full bg-gray-100 dark:bg-white/10 overflow-hidden">
          <div
            className="h-full bg-[#E63946] rounded-full transition-all duration-300"
            style={{ width: `${state.progress}%` }}
          />
        </div>
      )}

      {(state.status === 'ok' || state.status === 'error') && (
        <div className="mt-3 space-y-1.5">
          <div className="text-xs text-gray-400 dark:text-gray-500 flex gap-4">
            {state.lastAt && <span>{state.lastAt}</span>}
            {state.rowsCount !== undefined && <span>{state.rowsCount} строк</span>}
            {state.rowsSkipped !== undefined && state.rowsSkipped > 0 && (
              <span className="text-amber-500">{state.rowsSkipped} пропущено</span>
            )}
            {state.detail && (
              <span
                className="text-red-400 truncate max-w-xs cursor-help"
                title={state.detail}
              >
                {state.detail}
              </span>
            )}
          </div>
          {state.skippedSkus && state.skippedSkus.length > 0 && (
            <div className="mt-3 p-3 rounded-xl border" style={{ borderColor: 'var(--warning)', background: 'rgba(245,158,11,0.08)' }}>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold" style={{ color: 'var(--warning)' }}>
                  Артикулы, добавленные как заглушки ({state.skippedSkus.length})
                </p>
                <button
                  onClick={() => navigator.clipboard.writeText(state.skippedSkus!.join('\n'))}
                  className="text-xs px-2 py-1 rounded-lg"
                  style={{ background: 'var(--border)', color: 'var(--text-muted)' }}
                >
                  Скопировать список
                </button>
              </div>
              <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
                Эти артикулы отсутствовали в Своде — созданы автоматически. Добавьте их в Свод для полных данных.
              </p>
              <div className="max-h-40 overflow-y-auto space-y-0.5">
                {state.skippedSkus.map(sku => (
                  <p key={sku} className="font-mono text-[11px]" style={{ color: 'var(--text-subtle)' }}>{sku}</p>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Основной компонент ────────────────────────────────────────────────────────

export default function UpdateTab() {
  const [states, setStates] = useState<Record<FileType, UploadState>>({
    catalog: { status: 'idle', progress: 0, message: 'Не загружен' },
    abc: { status: 'idle', progress: 0, message: 'Не загружен' },
    china: { status: 'idle', progress: 0, message: 'Не загружен' },
    'sku-report': { status: 'idle', progress: 0, message: 'Не загружен' },
    analytics: { status: 'idle', progress: 0, message: 'Не загружен' },
  })

  const [history, setHistory] = useState<UploadRecord[]>([])
  const [historyLoaded, setHistoryLoaded] = useState(false)

  const loadHistory = async () => {
    try {
      const res = await fetch('/api/uploads/history')
      if (res.ok) {
        const data = await res.json()
        setHistory(data.uploads ?? [])
      }
    } catch { /* ignore */ }
    setHistoryLoaded(true)
  }

  const patchState = (type: FileType, patch: Partial<UploadState>) => {
    setStates(prev => ({ ...prev, [type]: { ...prev[type], ...patch } }))
  }

  const handleFile = async (type: FileType, file: File) => {
    patchState(type, { status: 'uploading', progress: 10, message: 'Загрузка...', detail: undefined })

    const result = await uploadViaStorage(type, file, pct => {
      patchState(type, { progress: pct })
    })

    if (result.ok) {
      const now = new Date().toLocaleString('ru-RU', {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
      })
      patchState(type, {
        status: 'ok',
        progress: 100,
        message: 'Загружено',
        lastAt: now,
        rowsCount: result.rows_parsed,
        rowsSkipped: result.rows_skipped,
        skippedSkus: result.unknown_skus ?? result.skipped_skus ?? [],
        detail: undefined,
      })
      if (historyLoaded) loadHistory()
    } else {
      patchState(type, {
        status: 'error',
        progress: 0,
        message: 'Ошибка',
        detail: result.error,
      })
    }
  }

  const FILE_TYPE_LABELS: Record<string, string> = {
    catalog: 'Свод',
    abc: 'АВС анализ',
    china: 'Потребность Китай',
    sku_report: 'Отчёт по SKU',
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-[#1A1A2E] dark:text-white mb-1">
          Обновление данных
        </h2>
        <p className="text-sm text-gray-400 dark:text-gray-500">
          Загружайте файлы в указанном порядке — Свод должен быть загружен первым.
        </p>
      </div>

      <div className="space-y-3">
        {FILE_CONFIGS.map(config => (
          <UploadCard
            key={config.type}
            config={config}
            state={states[config.type]}
            onFile={file => handleFile(config.type, file)}
          />
        ))}
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-[#1A1A2E] dark:text-white">
            История загрузок
          </h3>
          <button
            onClick={loadHistory}
            className="text-xs text-[#E63946] hover:underline"
          >
            Обновить
          </button>
        </div>

        {!historyLoaded ? (
          <button
            onClick={loadHistory}
            className="w-full rounded-lg border border-dashed border-gray-200 dark:border-white/10 py-4 text-sm text-gray-400 hover:text-[#E63946] hover:border-[#E63946] transition-colors"
          >
            Загрузить историю
          </button>
        ) : history.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-500 py-4 text-center">
            История пуста
          </p>
        ) : (
          <div className="rounded-xl border border-gray-100 dark:border-white/10 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-white/10 bg-gray-50 dark:bg-white/5">
                  <th className="text-left px-4 py-2 text-xs font-semibold text-gray-400">Дата</th>
                  <th className="text-left px-4 py-2 text-xs font-semibold text-gray-400">Файл</th>
                  <th className="text-left px-4 py-2 text-xs font-semibold text-gray-400">Тип</th>
                  <th className="text-right px-4 py-2 text-xs font-semibold text-gray-400">Строк</th>
                  <th className="text-right px-4 py-2 text-xs font-semibold text-gray-400">Статус</th>
                </tr>
              </thead>
              <tbody>
                {history.map(rec => (
                  <tr key={rec.id} className="border-b border-gray-50 dark:border-white/5 last:border-0">
                    <td className="px-4 py-2 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      {new Date(rec.uploaded_at).toLocaleString('ru-RU', {
                        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                      })}
                    </td>
                    <td className="px-4 py-2 text-gray-700 dark:text-gray-300 max-w-[160px] truncate" title={rec.filename}>
                      {rec.filename}
                    </td>
                    <td className="px-4 py-2 text-gray-500 dark:text-gray-400">
                      {FILE_TYPE_LABELS[rec.file_type] ?? rec.file_type}
                    </td>
                    <td className="px-4 py-2 text-right text-gray-500 dark:text-gray-400">
                      {rec.rows_count ?? '—'}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {rec.status === 'ok' ? (
                        <span className="text-green-500 font-medium">✓</span>
                      ) : (
                        <span className="text-red-400 font-medium cursor-help" title={rec.error_msg ?? ''}>
                          ✗
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
