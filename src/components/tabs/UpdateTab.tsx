'use client'

import { useState, useCallback, useRef } from 'react'
import { clearAllTabCaches } from '@/lib/tabCache'
import { parseSkuReport, type ParseSkuReportResult } from '@/lib/parsers/parseSkuReport'
import { parseABC } from '@/lib/parsers/parseABC'
import { parseChina } from '@/lib/parsers/parseChina'
import { parseCatalog } from '@/lib/parsers/parseCatalog'
import { parseAnalytics } from '@/lib/parsers/parseAnalytics'

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
  variantsAggregated?: number
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

// ── Парсинг на frontend → JSON POST → backend upsert ──────────────────────────
//
// Раньше: FE → presign → Supabase Storage PUT → backend download (egress!) → parse → upsert.
// Сейчас: FE парсит файл локально через xlsx.js → шлёт готовый JSON → backend upsert.
// Преимущества:
//   • Storage не используется → НИКАКОГО egress на загрузку
//   • Легче debugging — ошибка либо в parse (frontend), либо в upsert (backend)
//
// Для маленьких типов (catalog/abc/china/analytics) — один POST с {parsed}.
// Для sku-report (~12МБ JSON, не влезает в Vercel 4.5MB limit) — chunked upload:
// init → batches × N → finalize.

type UploadResult = {
  ok: boolean
  rows_parsed?: number
  rows_skipped?: number
  skipped_variants?: number
  skipped_skus?: string[]
  unknown_skus?: string[]
  error?: string
}

// ── Chunked upload для sku-report ─────────────────────────────────────────────
async function uploadSkuReportChunked(
  parsed: ParseSkuReportResult,
  filename: string,
  onProgress: (pct: number) => void,
): Promise<UploadResult> {
  // 1. init — создаём upload record (status=pending)
  onProgress(55)
  const initRes = await fetch('/api/upload/sku-report/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename,
      period_start: parsed.period_start,
      period_end: parsed.period_end,
      rows_parsed: parsed.rows_parsed,
    }),
  })
  if (!initRes.ok) {
    const err = await initRes.json().catch(() => ({}))
    return { ok: false, error: (err as { error?: string }).error ?? `init: HTTP ${initRes.status}` }
  }
  const { upload_id } = await initRes.json() as { upload_id: string }

  // Helper: серийная отправка батчей
  async function sendChunks(
    part: 'dim' | 'daily' | 'period' | 'price_changes',
    rows: Record<string, unknown>[],
    chunkSize: number,
    fromPct: number,
    toPct: number,
  ): Promise<string | null> {
    if (rows.length === 0) { onProgress(toPct); return null }
    const total = rows.length
    for (let i = 0; i < total; i += chunkSize) {
      const slice = rows.slice(i, i + chunkSize)
      const res = await fetch(
        `/api/upload/sku-report/batch?upload_id=${encodeURIComponent(upload_id)}&part=${part}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rows: slice }),
        }
      )
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        return (err as { error?: string }).error ?? `${part}: HTTP ${res.status}`
      }
      const done = Math.min(i + chunkSize, total)
      const pct = fromPct + (toPct - fromPct) * (done / total)
      onProgress(Math.round(pct))
    }
    return null
  }

  // 2. dim_sku enrichment — ПЕРВЫМ (FK satisfaction для остальных таблиц)
  const dedupedPeriod = [...new Map(
    parsed.period.map(r => [`${r.sku_ms}|${r.period_start}|${r.period_end}`, r])
  ).values()]
  const dimUpdates = [...new Map(
    dedupedPeriod.map(r => {
      const obj: Record<string, unknown> = { sku_ms: r.sku_ms }
      if (r.sku_wb != null)  obj.sku_wb      = r.sku_wb
      if (r.product_name)    obj.name         = r.product_name
      if (r.brand)           obj.brand        = r.brand
      if (r.category)        obj.category_wb  = r.category
      if (r.subject_wb)      obj.subject_wb   = r.subject_wb
      return [r.sku_ms, obj]
    })
  ).values()]
  let err = await sendChunks('dim', dimUpdates, 500, 55, 65)
  if (err) {
    return { ok: false, error: `dim_sku: ${err}` }
  }

  // 3. fact_sku_daily (самая большая таблица)
  const dedupedDaily = [...new Map(
    parsed.daily.map(r => [`${r.sku_ms}|${r.metric_date}`, r])
  ).values()] as unknown as Record<string, unknown>[]
  err = await sendChunks('daily', dedupedDaily, 500, 65, 85)
  if (err) {
    return { ok: false, error: `fact_sku_daily: ${err}` }
  }

  // 4. fact_sku_period
  err = await sendChunks('period', dedupedPeriod as unknown as Record<string, unknown>[], 500, 85, 90)
  if (err) {
    return { ok: false, error: `fact_sku_period: ${err}` }
  }

  // 5. fact_price_changes
  const priceChangeDedup = new Map<string, typeof parsed.priceChanges[0]>()
  for (const r of parsed.priceChanges) {
    priceChangeDedup.set(`${r.sku_wb}|${r.price_date}`, r)
  }
  const dedupedPriceChanges = [...priceChangeDedup.values()] as unknown as Record<string, unknown>[]
  err = await sendChunks('price_changes', dedupedPriceChanges, 500, 90, 95)
  if (err) {
    // price_changes — некритично, продолжаем (backend сам помечает upload как error)
    console.warn('price_changes upload failed (non-critical):', err)
  }

  // 6. finalize — status=ok + cache invalidation
  const finRes = await fetch(
    `/api/upload/sku-report/finalize?upload_id=${encodeURIComponent(upload_id)}`,
    { method: 'POST' }
  )
  onProgress(98)
  if (!finRes.ok) {
    const e = await finRes.json().catch(() => ({}))
    return { ok: false, error: `finalize: ${(e as { error?: string }).error ?? finRes.status}` }
  }

  return {
    ok: true,
    rows_parsed: parsed.rows_parsed,
    rows_skipped: parsed.skipped_skus.length,
    skipped_skus: parsed.skipped_skus.slice(0, 20),
  }
}

async function uploadDirect(
  type: FileType,
  file: File,
  onProgress: (pct: number) => void
): Promise<UploadResult> {
  // 1. Читаем файл в browser
  onProgress(5)
  let buffer: ArrayBuffer
  try {
    buffer = await file.arrayBuffer()
  } catch (e) {
    return { ok: false, error: `Не удалось прочитать файл: ${String(e)}` }
  }

  // 2. Парсим в browser через xlsx.js
  onProgress(20)
  let parsed: unknown
  try {
    await new Promise(resolve => setTimeout(resolve, 0))
    switch (type) {
      case 'sku-report': {
        // Для sku-report нужен skuMap (wb→ms) — тащим маленький JSON с backend (~30KB)
        let skuMap: Map<string, string> | undefined
        try {
          const mapRes = await fetch('/api/dim-sku/wb-map', { method: 'GET' })
          if (mapRes.ok) {
            const json = await mapRes.json() as { map: Record<string, string> }
            skuMap = new Map(Object.entries(json.map ?? {}))
          }
        } catch { /* ignore */ }
        parsed = parseSkuReport(buffer, skuMap)
        break
      }
      case 'abc':       parsed = parseABC(buffer, file.name); break
      case 'china':     parsed = parseChina(buffer); break
      case 'catalog':   parsed = parseCatalog(buffer); break
      case 'analytics': parsed = parseAnalytics(buffer, file.name); break
      default: return { ok: false, error: `Неизвестный тип: ${type}` }
    }
  } catch (e) {
    return { ok: false, error: `Ошибка парсинга файла: ${String(e)}` }
  }

  // 3a. SKU-report — chunked upload (12+ МБ JSON не влезает в Vercel 4.5MB)
  if (type === 'sku-report') {
    return uploadSkuReportChunked(parsed as ParseSkuReportResult, file.name, onProgress)
  }

  // 3b. Остальные типы — один POST с {parsed} (≤ 1-2 МБ JSON, влезает)
  onProgress(60)
  try {
    const res = await fetch(
      `/api/upload/${type}?filename=${encodeURIComponent(file.name)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parsed }),
      }
    )
    onProgress(90)
    let json: { ok?: boolean; rows_parsed?: number; rows_skipped?: number; skipped_variants?: number; diag_skipped_skus?: string[]; unknown_skus?: string[]; error?: string }
    try {
      json = await res.json()
    } catch {
      return { ok: false, error: `Сервер вернул ошибку ${res.status}` }
    }
    if (res.ok && json.ok) {
      return {
        ok: true,
        rows_parsed: json.rows_parsed,
        rows_skipped: json.rows_skipped,
        skipped_variants: json.skipped_variants,
        skipped_skus: json.diag_skipped_skus,
        unknown_skus: json.unknown_skus,
      }
    }
    return { ok: false, error: json.error ?? 'Ошибка сохранения в БД' }
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
        <div className="mt-3 space-y-2">
          <div className="text-xs text-gray-500 dark:text-gray-400 flex flex-wrap gap-x-3 gap-y-1 items-center">
            {state.lastAt && <span>{state.lastAt}</span>}
            {state.rowsCount !== undefined && (
              <>
                <span className="text-gray-300 dark:text-gray-600">·</span>
                <span>{state.rowsCount} строк</span>
              </>
            )}
            {state.variantsAggregated !== undefined && state.variantsAggregated > 0 && (
              <>
                <span className="text-gray-300 dark:text-gray-600">·</span>
                <span className="text-blue-600 dark:text-blue-400 font-medium">{state.variantsAggregated} вариантов размеров объединено</span>
              </>
            )}
            {state.rowsSkipped !== undefined && state.rowsSkipped > 0 && (
              <>
                <span className="text-gray-300 dark:text-gray-600">·</span>
                <span className="text-amber-600 dark:text-amber-400 font-medium">{state.rowsSkipped} пропущено</span>
              </>
            )}
          </div>
          {state.detail && (
            <div className="text-xs text-red-500 dark:text-red-400 p-2 rounded-lg bg-red-50 dark:bg-red-900/15 break-words whitespace-pre-wrap">
              {state.detail}
            </div>
          )}
          {state.skippedSkus && state.skippedSkus.length > 0 && (
            <div className="mt-3 p-3 rounded-xl border border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-900/15">
              <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
                <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">
                  Артикулы, добавленные как заглушки ({state.skippedSkus.length})
                </p>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => navigator.clipboard.writeText(state.skippedSkus!.join('\n'))}
                    className="text-xs px-2.5 py-1 rounded-lg bg-white dark:bg-white/10 text-gray-700 dark:text-gray-200 border border-amber-200 dark:border-amber-500/30 hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors"
                  >
                    Скопировать ({state.skippedSkus.length})
                  </button>
                  <button
                    onClick={() => {
                      const blob = new Blob([state.skippedSkus!.join('\n')], { type: 'text/plain;charset=utf-8' })
                      const url = URL.createObjectURL(blob)
                      const a = document.createElement('a')
                      a.href = url
                      a.download = `skipped_skus_${new Date().toISOString().slice(0, 10)}.txt`
                      a.click()
                      URL.revokeObjectURL(url)
                    }}
                    className="text-xs px-2.5 py-1 rounded-lg bg-white dark:bg-white/10 text-gray-700 dark:text-gray-200 border border-amber-200 dark:border-amber-500/30 hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors"
                  >
                    Скачать .txt
                  </button>
                </div>
              </div>
              <p className="text-xs mb-2 text-gray-600 dark:text-gray-400">
                Эти артикулы отсутствовали в Своде — созданы автоматически. Добавьте их в Свод для полных данных.
              </p>
              <div className="max-h-72 overflow-y-auto p-2 rounded-lg bg-white/60 dark:bg-black/20 border border-amber-200/50 dark:border-amber-500/20">
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-x-3 gap-y-0.5">
                  {state.skippedSkus.map(sku => (
                    <p key={sku} className="font-mono text-xs text-gray-700 dark:text-gray-300 truncate" title={sku}>{sku}</p>
                  ))}
                </div>
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

    const result = await uploadDirect(type, file, pct => {
      patchState(type, { progress: pct })
    })

    if (result.ok) {
      clearAllTabCaches()
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
        variantsAggregated: result.skipped_variants,
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
    analytics: 'Аналитика',
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
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
