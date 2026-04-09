// src/components/UpdateTab.tsx
// Вкладка «Обновление данных» — 4 кнопки загрузки файлов
'use client'

import { useState, useRef } from 'react'

const C = {
  bg: '#0f1117', card: '#1a1f2e', border: '#2d3548', cardHover: '#1e2535',
  blue: '#3b82f6', green: '#22c55e', yellow: '#f59e0b', red: '#ef4444',
  purple: '#8b5cf6', teal: '#10b981', orange: '#f97316',
  text: '#f1f5f9', textSec: '#94a3b8', textMute: '#64748b', textDim: '#475569',
}

type UploadStatus = 'idle' | 'uploading' | 'success' | 'error'

interface UploadResult {
  rows?: number
  skus?: number
  message?: string
  [key: string]: unknown
}

interface DataSource {
  id:       string
  icon:     string
  title:    string
  desc:     string
  accepts:  string   // файловые расширения
  hint:     string   // подсказка какой именно файл
  endpoint: string   // API endpoint
  color:    string
  freq:     string   // частота обновления
}

const SOURCES: DataSource[] = [
  {
    id:       'stock',
    icon:     '📦',
    title:    'Таблица остатков',
    desc:     'Остатки WB, продажи по дням, маржа, статусы товаров',
    hint:     'Таблица_Остатков_*.xlsx — лист sheet1',
    accepts:  '.xlsx,.xlsb',
    endpoint: '/api/update/stock',
    color:    C.blue,
    freq:     'Раз в неделю',
  },
  {
    id:       'china',
    icon:     '🚢',
    title:    'Потребность Китай',
    desc:     'Лог. плечо, себестоимость, заказ менеджера, план продаж по месяцам',
    hint:     'МС_Потребность_Китай_*.xlsx — листы зеленка + СВОД',
    accepts:  '.xlsx,.xlsb',
    endpoint: '/api/update/china',
    color:    C.purple,
    freq:     'Раз в месяц',
  },
  {
    id:       'abc',
    icon:     '📊',
    title:    'ABC анализ',
    desc:     'ABC классы, GMROI, рентабельность, оборачиваемость, выручка',
    hint:     'АВС_анализ_МС_*.xlsx — листы АВС расшифровка + Sheet2',
    accepts:  '.xlsx,.xlsb',
    endpoint: '/api/update/abc',
    color:    C.teal,
    freq:     'Раз в месяц',
  },
  {
    id:       'sku',
    icon:     '📈',
    title:    'Отчёт по SKU',
    desc:     'Метрики рекламы: CTR, CR, ДРР, выручка, CPM, CPC по дням',
    hint:     'Отчет_по_SKU_*.xlsb — лист Лист7',
    accepts:  '.xlsx,.xlsb',
    endpoint: '/api/upload',   // существующий endpoint
    color:    C.orange,
    freq:     'Каждые 3–5 дней',
  },
]

interface CardState {
  status:  UploadStatus
  result:  UploadResult | null
  error:   string | null
  progress: number
  filename: string | null
}

const initCard = (): CardState => ({
  status: 'idle', result: null, error: null, progress: 0, filename: null,
})

export default function UpdateTab() {
  const [cards, setCards] = useState<Record<string, CardState>>(
    Object.fromEntries(SOURCES.map(s => [s.id, initCard()]))
  )
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({})

  const setCard = (id: string, patch: Partial<CardState>) =>
    setCards(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }))

  async function handleFile(source: DataSource, file: File) {
    setCard(source.id, {
      status: 'uploading', error: null, result: null,
      progress: 10, filename: file.name,
    })

    // Имитируем прогресс
    const progressTimer = setInterval(() => {
      setCards(prev => {
        const cur = prev[source.id].progress
        if (cur >= 85) { clearInterval(progressTimer); return prev }
        return { ...prev, [source.id]: { ...prev[source.id], progress: cur + 5 } }
      })
    }, 400)

    try {
      // Получаем токен из куки суперябазы
      const { createBrowserClient } = await import('@supabase/ssr')
      const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      )
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Не авторизован. Войдите в систему.')

      const form = new FormData()
      form.append('file', file)
      form.append('source_type', source.id)  // подсказка парсеру

      const res = await fetch(source.endpoint, {
        method: 'POST',
        headers: { authorization: `Bearer ${session.access_token}` },
        body: form,
      })

      clearInterval(progressTimer)
      const json = await res.json()

      if (!res.ok) throw new Error(json.error || 'Ошибка сервера')

      setCard(source.id, { status: 'success', result: json, progress: 100 })
    } catch (e) {
      clearInterval(progressTimer)
      setCard(source.id, { status: 'error', error: String((e as Error).message), progress: 0 })
    }

    // Сбрасываем input
    const inputEl = inputRefs.current[source.id]
    if (inputEl) inputEl.value = ''
  }

  const resetCard = (id: string) => setCard(id, initCard())

  const allIdle = Object.values(cards).every(c => c.status === 'idle')

  return (
    <div style={{ color: C.text }}>

      {/* Заголовок */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>
          🔄 Обновление данных
        </div>
        <div style={{ fontSize: 13, color: C.textSec, lineHeight: 1.6 }}>
          Загрузите Excel-файлы для обновления данных в дашборде.
          После загрузки данные автоматически обновятся в таблице заказов и на других вкладках.
        </div>
      </div>

      {/* Карточки */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
        {SOURCES.map(source => {
          const card = cards[source.id]
          const isUploading = card.status === 'uploading'
          const isSuccess   = card.status === 'success'
          const isError     = card.status === 'error'

          return (
            <div key={source.id} style={{
              background: C.card, borderRadius: 14,
              border: `1px solid ${
                isSuccess ? C.green + '60' :
                isError   ? C.red   + '60' :
                isUploading ? source.color + '40' :
                C.border
              }`,
              padding: 22, position: 'relative', overflow: 'hidden',
              transition: 'border-color .3s',
            }}>

              {/* Фоновый значок */}
              <div style={{ position: 'absolute', top: -4, right: 8, fontSize: 72,
                            opacity: 0.05, pointerEvents: 'none' }}>
                {source.icon}
              </div>

              {/* Заголовок карточки */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
                <div style={{
                  width: 44, height: 44, borderRadius: 12, flexShrink: 0,
                  background: source.color + '20',
                  border: `1px solid ${source.color}40`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22,
                }}>
                  {source.icon}
                </div>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 3 }}>
                    {source.title}
                  </div>
                  <div style={{ fontSize: 12, color: C.textSec, lineHeight: 1.5 }}>
                    {source.desc}
                  </div>
                </div>
              </div>

              {/* Подсказка по файлу */}
              <div style={{
                background: C.cardHover, borderRadius: 8, padding: '8px 12px',
                marginBottom: 14, fontSize: 11, color: C.textMute,
                borderLeft: `3px solid ${source.color}60`,
              }}>
                <span style={{ color: C.textDim }}>📁 Файл: </span>
                {source.hint}
              </div>

              {/* Частота + последняя загрузка */}
              <div style={{ display: 'flex', justifyContent: 'space-between',
                            marginBottom: 14, fontSize: 11 }}>
                <span style={{ color: C.textDim }}>
                  🗓 Обновляется: <span style={{ color: source.color }}>{source.freq}</span>
                </span>
                {isSuccess && card.filename && (
                  <span style={{ color: C.textMute }}>
                    ✓ {card.filename.length > 22 ? card.filename.slice(0,20)+'…' : card.filename}
                  </span>
                )}
              </div>

              {/* Progress bar */}
              {isUploading && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ width: '100%', height: 5, background: C.border,
                                borderRadius: 5, overflow: 'hidden', marginBottom: 6 }}>
                    <div style={{
                      height: '100%', borderRadius: 5,
                      background: `linear-gradient(90deg, ${source.color}, ${source.color}aa)`,
                      width: `${card.progress}%`, transition: 'width .4s ease',
                      boxShadow: `0 0 8px ${source.color}60`,
                    }} />
                  </div>
                  <div style={{ fontSize: 11, color: source.color, textAlign: 'center' }}>
                    {card.progress}% — {
                      card.progress < 20 ? 'Авторизация...' :
                      card.progress < 50 ? 'Загрузка файла...' :
                      card.progress < 80 ? 'Обработка данных...' : 'Сохранение...'
                    }
                  </div>
                </div>
              )}

              {/* Результат успеха */}
              {isSuccess && card.result && (
                <div style={{
                  background: C.green + '15', border: `1px solid ${C.green}40`,
                  borderRadius: 8, padding: '10px 12px', marginBottom: 12, fontSize: 12,
                }}>
                  <div style={{ color: C.green, fontWeight: 700, marginBottom: 4 }}>
                    ✓ Данные успешно обновлены
                  </div>
                  {card.result.rows != null && (
                    <div style={{ color: C.textSec }}>Строк обработано: {card.result.rows}</div>
                  )}
                  {card.result.skus != null && (
                    <div style={{ color: C.textSec }}>SKU обновлено: {card.result.skus}</div>
                  )}
                  {card.result.message && (
                    <div style={{ color: C.textSec }}>{card.result.message}</div>
                  )}
                </div>
              )}

              {/* Ошибка */}
              {isError && card.error && (
                <div style={{
                  background: C.red + '15', border: `1px solid ${C.red}40`,
                  borderRadius: 8, padding: '10px 12px', marginBottom: 12, fontSize: 12,
                }}>
                  <div style={{ color: C.red, fontWeight: 700, marginBottom: 4 }}>⚠️ Ошибка</div>
                  <div style={{ color: C.textSec, lineHeight: 1.5 }}>{card.error}</div>
                </div>
              )}

              {/* Кнопки */}
              <div style={{ display: 'flex', gap: 8 }}>
                {!isSuccess && !isError ? (
                  <label style={{
                    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    gap: 8, padding: '10px 16px', borderRadius: 9, cursor: isUploading ? 'not-allowed' : 'pointer',
                    background: isUploading ? C.cardHover : source.color,
                    color: isUploading ? C.textMute : '#fff',
                    fontWeight: 700, fontSize: 13, border: 'none',
                    opacity: isUploading ? 0.7 : 1, transition: 'all .2s',
                    userSelect: 'none',
                  }}>
                    <input
                      ref={el => { inputRefs.current[source.id] = el }}
                      type="file"
                      accept={source.accepts}
                      disabled={isUploading}
                      onChange={e => {
                        const file = e.target.files?.[0]
                        if (file) handleFile(source, file)
                      }}
                      style={{ display: 'none' }}
                    />
                    {isUploading ? '⏳ Загрузка...' : `⬆️ Загрузить файл`}
                  </label>
                ) : (
                  <>
                    <label style={{
                      flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      gap: 8, padding: '10px 16px', borderRadius: 9, cursor: 'pointer',
                      background: source.color, color: '#fff',
                      fontWeight: 700, fontSize: 13, border: 'none', userSelect: 'none',
                    }}>
                      <input
                        ref={el => { inputRefs.current[source.id] = el }}
                        type="file" accept={source.accepts}
                        onChange={e => {
                          const file = e.target.files?.[0]
                          if (file) handleFile(source, file)
                        }}
                        style={{ display: 'none' }}
                      />
                      ⬆️ Загрузить снова
                    </label>
                    <button
                      onClick={() => resetCard(source.id)}
                      style={{
                        padding: '10px 14px', borderRadius: 9, cursor: 'pointer',
                        background: 'transparent', border: `1px solid ${C.border}`,
                        color: C.textMute, fontSize: 12,
                      }}
                    >
                      ✕
                    </button>
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Нижняя подсказка */}
      <div style={{
        marginTop: 20, padding: '14px 18px', background: C.cardHover,
        borderRadius: 10, border: `1px solid ${C.border}`,
        fontSize: 12, color: C.textMute, lineHeight: 1.7,
      }}>
        <div style={{ fontWeight: 700, color: C.textSec, marginBottom: 6 }}>
          ℹ️ Порядок обновления данных
        </div>
        <div>
          1. Начните с <span style={{ color: C.blue }}>Таблицы остатков</span> — она содержит историю продаж и актуальные остатки.
        </div>
        <div>
          2. При наличии новой версии загрузите <span style={{ color: C.purple }}>Потребность Китай</span> — лог. плечо, себа, план.
        </div>
        <div>
          3. Раз в месяц обновляйте <span style={{ color: C.teal }}>ABC анализ</span> — классы товаров, рентабельность, GMROI.
        </div>
        <div>
          4. <span style={{ color: C.orange }}>Отчёт по SKU</span> обновляйте каждые 3–5 дней для актуальных метрик рекламы.
        </div>
      </div>
    </div>
  )
}
