'use client'

import { useState, useCallback, useRef } from 'react'

// ── Типы ─────────────────────────────────────────────────────────────────────

type FileType = 'catalog' | 'abc' | 'china' | 'sku-report'

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
]

// ── Загрузка через сервер (браузер → Next.js API → Supabase Storage → parse) ──
// Файл идёт как FormData в наш API — браузер не обращается к Supabase напрямую.
// Это устраняет проблемы с CORS, VPN и SSL при прямом PUT на supabase.co.

async function uploadViaStorage(
  type: FileType,
  file: File,
  onProgress: (pct: number) => void
): Promise<{ ok: boolean; rows_parsed?: number; rows_skipped?: number; skipped_skus?: string[]; error?: string }> {
  onProgress(10)

  const form = new FormData()
  form.append('file', file, file.name)

  try {
    // Один запрос: сервер сохраняет в Storage и парсит
    const res = await fetch(`/api/upload/${type}`, {
      method: 'POST',
      body: form,
      // Не устанавливаем Content-Type — браузер сам выставит multipart/form-data с boundary
    })
    onProgress(90)
    const json = await res.json()
    if (res.ok && json.ok) {
      return {
        ok: true,
        rows_parsed: json.rows_parsed,
        rows_skipped: json.rows_skipped,
        skipped_skus: json.diag_skipped_skus ?? [],
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
                className="text-red-400 break-all cursor-help"
                title={state.detail}
              >
                {state.detail}
              </span>
            )}
          </div>
          {state.skippedSkus && state.skippedSkus.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-amber-500 hover:text-amber-600 select-none">
                Артикулы не найдены в справочнике ({state.skippedSkus.length})
              </summary>
              <div className="mt-1.5 rounded-lg bg-amber-50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-800/30 px-3 py-2 max-h-32 overflow-y-auto">
                <p className="text-amber-600 dark:text-amber-400 mb-1 text-[11px]">
                  Эти WB-артикулы отсутствуют в Своде — загрузите актуальный Свод и повторите загрузку
                </p>
                <div className="flex flex-wrap gap-1">
                  {state.skippedSkus.map(sku => (
                    <span
                      key={sku}
                      className="inline-block bg-amber-100 dark:bg-amber-800/30 text-amber-700 dark:text-amber-300 rounded px-1.5 py-0.5 font-mono text-[11px]"
                    >
                      {sku}
                    </span>
                  ))}
                </div>
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  )
}

// ── Диагностическая панель ────────────────────────────────────────────────────

interface DiagResult {
  env?: Record<string, string>
  db_connection?: string
  storage_buckets?: string
  signed_url?: string
  dim_sku?: string
  fact_abc?: string
  fact_sku_daily?: string
  error?: string
}

interface DiagState {
  status: 'idle' | 'checking' | 'done' | 'fixing' | 'fixed' | 'error'
  result: DiagResult | null
  setupSteps: string[]
}

function DiagPanel() {
  const [diag, setDiag] = useState<DiagState>({ status: 'idle', result: null, setupSteps: [] })

  const handleCheck = async () => {
    setDiag({ status: 'checking', result: null, setupSteps: [] })
    try {
      const res = await fetch('/api/debug/storage-check')
      const json: DiagResult = await res.json()
      setDiag({ status: 'done', result: json, setupSteps: [] })
    } catch (e) {
      setDiag({ status: 'error', result: { error: String(e) }, setupSteps: [] })
    }
  }

  const handleSetup = async () => {
    setDiag(prev => ({ ...prev, status: 'fixing', setupSteps: [] }))
    try {
      const res = await fetch('/api/debug/storage-setup', { method: 'POST' })
      const json = await res.json()
      setDiag(prev => ({ ...prev, status: 'fixed', setupSteps: json.steps ?? [] }))
      // Перепроверить после настройки
      setTimeout(async () => {
        try {
          const checkRes = await fetch('/api/debug/storage-check')
          const checkJson: DiagResult = await checkRes.json()
          setDiag(prev => ({ ...prev, result: checkJson }))
        } catch { /* ignore */ }
      }, 1000)
    } catch (e) {
      setDiag(prev => ({ ...prev, status: 'error', setupSteps: [String(e)] }))
    }
  }

  const hasBucketError = diag.result &&
    (typeof diag.result.storage_buckets === 'string' && diag.result.storage_buckets.startsWith('❌'))
  const hasAnyError = diag.result &&
    Object.values(diag.result).some(v => typeof v === 'string' && v.startsWith('❌'))

  return (
    <div className="rounded-xl border border-gray-100 dark:border-white/10 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[#1A1A2E] dark:text-white">
          Диагностика хранилища
        </h3>
        <div className="flex items-center gap-2">
          {(hasBucketError || diag.status === 'fixed') && (
            <button
              onClick={handleSetup}
              disabled={diag.status === 'fixing'}
              className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
              style={{
                background: 'rgba(230,57,70,0.08)',
                border: '1px solid #E63946',
                color: '#E63946',
                cursor: diag.status === 'fixing' ? 'not-allowed' : 'pointer',
              }}
            >
              {diag.status === 'fixing' ? '⟳ Настройка...' : '⚙ Настроить хранилище'}
            </button>
          )}
          <button
            onClick={handleCheck}
            disabled={diag.status === 'checking' || diag.status === 'fixing'}
            className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
            style={{
              background: 'var(--accent-glass)',
              border: '1px solid var(--accent)',
              color: 'var(--accent)',
              cursor: (diag.status === 'checking' || diag.status === 'fixing') ? 'not-allowed' : 'pointer',
            }}
          >
            {diag.status === 'checking' ? '⟳ Проверка...' : '⟳ Проверить'}
          </button>
        </div>
      </div>

      {diag.status === 'idle' && (
        <p className="text-xs text-gray-400 dark:text-gray-500">
          Если загрузка файлов не работает — нажмите «Проверить» для диагностики подключения к Supabase Storage.
        </p>
      )}

      {diag.setupSteps.length > 0 && (
        <div className="rounded-lg bg-gray-50 dark:bg-white/5 p-3 space-y-1">
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">Настройка хранилища:</p>
          {diag.setupSteps.map((step, i) => (
            <p key={i} className="text-xs font-mono text-gray-700 dark:text-gray-300">{step}</p>
          ))}
        </div>
      )}

      {diag.result && (
        <div className="rounded-lg bg-gray-50 dark:bg-white/5 p-3 space-y-1.5">
          {[
            ['Переменные окружения', diag.result.env
              ? Object.entries(diag.result.env).map(([k, v]) => `${k}: ${v}`).join(' | ')
              : undefined],
            ['База данных', diag.result.db_connection],
            ['Хранилище (бакеты)', diag.result.storage_buckets],
            ['Signed URL', diag.result.signed_url],
            ['dim_sku', diag.result.dim_sku],
            ['fact_abc', diag.result.fact_abc],
            ['fact_sku_daily', diag.result.fact_sku_daily],
          ]
            .filter(([, v]) => v !== undefined)
            .map(([label, value]) => {
              const isOk = typeof value === 'string' && value.startsWith('✅')
              const isWarn = typeof value === 'string' && value.startsWith('⚠️')
              const isErr = typeof value === 'string' && value.startsWith('❌')
              return (
                <div key={label as string} className="flex gap-2 text-xs">
                  <span className="shrink-0 text-gray-400 dark:text-gray-500 w-36">{label as string}</span>
                  <span
                    className="break-all"
                    style={{
                      color: isErr ? '#ef4444' : isWarn ? '#f59e0b' : isOk ? '#22c55e' : 'inherit',
                    }}
                  >
                    {value as string}
                  </span>
                </div>
              )
            })}
          {diag.result.error && (
            <p className="text-xs text-red-400">{diag.result.error}</p>
          )}
          {!hasAnyError && (
            <p className="text-xs text-green-500 font-medium pt-1">
              ✅ Все системы работают корректно. Если загрузка всё равно не работает — проверьте консоль браузера.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ── Основной компонент ────────────────────────────────────────────────────────

type RefreshState = 'idle' | 'running' | 'ok' | 'error'

export default function UpdateTab() {
  const [states, setStates] = useState<Record<FileType, UploadState>>({
    catalog: { status: 'idle', progress: 0, message: 'Не загружен' },
    abc: { status: 'idle', progress: 0, message: 'Не загружен' },
    china: { status: 'idle', progress: 0, message: 'Не загружен' },
    'sku-report': { status: 'idle', progress: 0, message: 'Не загружен' },
  })

  const [history, setHistory] = useState<UploadRecord[]>([])
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [refreshState, setRefreshState] = useState<RefreshState>('idle')
  const [refreshResult, setRefreshResult] = useState<string | null>(null)

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
        skippedSkus: result.skipped_skus,
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

  const handleRefreshAgg = async () => {
    setRefreshState('running')
    setRefreshResult(null)
    try {
      const res = await fetch('/api/admin/refresh-daily-agg', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const json = await res.json()
      if (res.ok && json.ok) {
        setRefreshState('ok')
        setRefreshResult(`Готово: обработано ${json.rows_processed?.toLocaleString('ru-RU') ?? '?'} строк → ${json.agg_rows?.toLocaleString('ru-RU') ?? '?'} агрегатов`)
      } else {
        setRefreshState('error')
        setRefreshResult(json.errors?.[0] ?? json.error ?? 'Неизвестная ошибка')
      }
    } catch (e) {
      setRefreshState('error')
      setRefreshResult(String(e))
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

      {/* Служебные операции */}
      <div className="rounded-xl border border-gray-100 dark:border-white/10 p-4 space-y-3">
        <h3 className="text-sm font-semibold text-[#1A1A2E] dark:text-white">
          Служебные операции
        </h3>
        <div className="flex items-center gap-4">
          <button
            onClick={handleRefreshAgg}
            disabled={refreshState === 'running'}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
            style={{
              background: refreshState === 'running' ? 'var(--surface)' : 'var(--accent-glass)',
              border: '1px solid var(--accent)',
              color: 'var(--accent)',
              cursor: refreshState === 'running' ? 'not-allowed' : 'pointer',
            }}
          >
            {refreshState === 'running' ? '⟳ Пересчёт...' : '⟳ Пересчитать агрегаты'}
          </button>
          {refreshResult && (
            <span className="text-xs" style={{ color: refreshState === 'ok' ? 'var(--success)' : 'var(--danger)' }}>
              {refreshState === 'ok' ? '✓ ' : '✗ '}{refreshResult}
            </span>
          )}
        </div>
        <p className="text-xs text-gray-400 dark:text-gray-500">
          Пересчитывает агрегаты KPI и графиков по всей истории. Нужно запустить один раз после первого деплоя, затем данные обновляются автоматически при каждой загрузке отчёта по SKU.
        </p>
      </div>

      <DiagPanel />

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
