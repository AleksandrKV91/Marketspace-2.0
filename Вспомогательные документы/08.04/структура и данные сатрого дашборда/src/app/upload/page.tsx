'use client'

/**
 * src/app/upload/page.tsx
 * Страница загрузки Excel — тёмная тема, полоса прогресса с этапами
 */

import { useState, useRef } from 'react'
import { createBrowserClient } from '@supabase/ssr'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const C = {
  bg: '#0f1117', card: '#1a1f2e', border: '#2d3548', cardHover: '#1e2535',
  blue: '#3b82f6', green: '#22c55e', yellow: '#f59e0b', red: '#ef4444',
  purple: '#8b5cf6', teal: '#10b981',
  text: '#f1f5f9', textSec: '#94a3b8', textMute: '#64748b', textDim: '#475569',
}

type Status = 'idle' | 'loading' | 'ok' | 'error'

interface UploadResult {
  upload_id: string
  rows_count: number
  period_start: string
  period_end: string
  sheet_name: string
}

const STAGES = [
  { label: 'Авторизация',          pct: 5   },
  { label: 'Отправка файла',       pct: 20  },
  { label: 'Парсинг Excel',        pct: 50  },
  { label: 'Запись в базу',        pct: 85  },
  { label: 'Завершение',           pct: 100 },
]

export default function UploadPage() {
  const [status,   setStatus]   = useState<Status>('idle')
  const [message,  setMessage]  = useState('')
  const [stage,    setStage]    = useState(0)
  const [progress, setProgress] = useState(0)
  const [result,   setResult]   = useState<UploadResult | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const inputRef  = useRef<HTMLInputElement>(null)
  const timerRef  = useRef<ReturnType<typeof setInterval> | null>(null)

  function animateTo(target: number, stageIdx: number) {
    setStage(stageIdx)
    setMessage(STAGES[stageIdx].label + '...')
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = setInterval(() => {
      setProgress(prev => {
        if (prev >= target - 1) { clearInterval(timerRef.current!); return target }
        return prev + 1
      })
    }, 30)
  }

  async function handleFile(file: File) {
    if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xlsb')) {
      setStatus('error'); setMessage('Ожидается .xlsx или .xlsb файл'); return
    }
    setStatus('loading'); setResult(null); setProgress(0); setStage(0)

    animateTo(STAGES[0].pct, 0)
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { setStatus('error'); setMessage('Вы не авторизованы. Войдите в систему.'); return }

    animateTo(STAGES[1].pct, 1)
    const form = new FormData()
    form.append('file', file)

    let res: Response
    try {
      const fetchPromise = fetch('/api/upload', {
        method: 'POST',
        headers: { authorization: `Bearer ${session.access_token}` },
        body: form,
      })
      setTimeout(() => animateTo(STAGES[2].pct, 2), 400)
      setTimeout(() => animateTo(STAGES[3].pct, 3), 2200)
      res = await fetchPromise
    } catch {
      setStatus('error'); setMessage('Сетевая ошибка. Проверьте соединение.'); return
    }

    animateTo(STAGES[4].pct, 4)
    const json = await res.json()
    setTimeout(() => {
      if (res.ok) {
        setStatus('ok'); setResult(json); setMessage(''); setProgress(100)
        if (inputRef.current) inputRef.current.value = ''
      } else {
        setStatus('error'); setMessage(json.error ?? 'Неизвестная ошибка')
      }
    }, 400)
  }

  const isLoading = status === 'loading'

  return (
    <main style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: "'Segoe UI',system-ui,sans-serif" }}>
      <div style={{ width: '100%', maxWidth: 540 }}>

        <div style={{ marginBottom: 24, textAlign: 'center' }}>
          <div style={{ fontSize: 36, marginBottom: 10 }}>⬆️</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: C.text, marginBottom: 6 }}>Загрузка данных WB</div>
          <div style={{ fontSize: 13, color: C.textMute, lineHeight: 1.6 }}>
            Загрузите Excel-файл с листом «Лист6» или «Лист7».<br />
            Данные автоматически попадут в базу.
          </div>
        </div>

        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 28 }}>

          {/* Dropzone */}
          <label
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) handleFile(f) }}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
              padding: '32px 24px', border: `2px dashed ${dragOver ? C.blue : C.border}`,
              borderRadius: 10, cursor: isLoading ? 'not-allowed' : 'pointer',
              background: dragOver ? C.blue + '10' : C.cardHover, transition: 'all .2s',
              marginBottom: 20, opacity: isLoading ? 0.6 : 1,
            }}
          >
            <input ref={inputRef} type="file" accept=".xlsx,.xlsb"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
              disabled={isLoading} style={{ display: 'none' }} />
            <span style={{ fontSize: 32 }}>{isLoading ? '⏳' : '📂'}</span>
            <span style={{ fontSize: 14, color: isLoading ? C.textMute : C.textSec, fontWeight: 500 }}>
              {isLoading ? 'Обработка файла...' : 'Нажмите или перетащите .xlsx файл'}
            </span>
            {!isLoading && <span style={{ fontSize: 12, color: C.textDim }}>Поддерживается .xlsx и .xlsb</span>}
          </label>

          {/* ── Progress ── */}
          {isLoading && (
            <div style={{ marginBottom: 20 }}>
              {/* Bar */}
              <div style={{ width: '100%', height: 6, background: C.border, borderRadius: 6, overflow: 'hidden', marginBottom: 10 }}>
                <div style={{
                  height: '100%', borderRadius: 6, transition: 'width 0.3s ease',
                  background: `linear-gradient(90deg, ${C.blue}, ${C.purple})`,
                  width: `${progress}%`, boxShadow: `0 0 8px ${C.blue}60`,
                }} />
              </div>
              {/* % + label */}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
                <span style={{ fontSize: 12, color: C.blue, fontWeight: 700 }}>{progress}%</span>
                <span style={{ fontSize: 12, color: C.textSec }}>{message}</span>
              </div>
              {/* Stage dots */}
              <div style={{ display: 'flex', gap: 6 }}>
                {STAGES.map((s, i) => (
                  <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                    <div style={{
                      width: 10, height: 10, borderRadius: '50%', transition: 'all .3s',
                      background: i < stage ? C.green : i === stage ? C.blue : C.border,
                      boxShadow: i === stage ? `0 0 6px ${C.blue}` : 'none',
                    }} />
                    <div style={{ fontSize: 9, color: i <= stage ? C.textSec : C.textDim, textAlign: 'center', lineHeight: 1.3 }}>{s.label}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Error ── */}
          {status === 'error' && (
            <div style={{ background: C.red + '15', border: `1px solid ${C.red}40`, borderRadius: 8, padding: '14px 16px', marginBottom: 16 }}>
              <div style={{ color: C.red, fontWeight: 700, marginBottom: 4 }}>⚠️ Ошибка загрузки</div>
              <div style={{ color: C.textSec, fontSize: 13, lineHeight: 1.5 }}>{message}</div>
              <button onClick={() => { setStatus('idle'); setProgress(0) }}
                style={{ marginTop: 10, background: 'transparent', border: `1px solid ${C.border}`, color: C.textMute, borderRadius: 6, padding: '5px 12px', cursor: 'pointer', fontSize: 12 }}>
                Попробовать снова
              </button>
            </div>
          )}

          {/* ── Success ── */}
          {status === 'ok' && result && (
            <div style={{ background: C.green + '15', border: `1px solid ${C.green}40`, borderRadius: 8, padding: '16px 18px' }}>
              <div style={{ color: C.green, fontWeight: 700, fontSize: 15, marginBottom: 12 }}>✓ Успешно загружено</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
                {([['SKU', result.rows_count], ['Лист', result.sheet_name], ['Начало периода', result.period_start], ['Конец периода', result.period_end]] as [string, string | number][]).map(([l, v]) => (
                  <div key={l} style={{ background: C.cardHover, borderRadius: 6, padding: '8px 10px' }}>
                    <div style={{ fontSize: 10, color: C.textDim, marginBottom: 3 }}>{l}</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{v}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <a href="/dashboard" style={{ background: C.blue, color: '#fff', borderRadius: 7, padding: '8px 18px', textDecoration: 'none', fontSize: 13, fontWeight: 600 }}>
                  → Открыть дашборд
                </a>
                <button onClick={() => { setStatus('idle'); setProgress(0); setResult(null) }}
                  style={{ background: 'transparent', border: `1px solid ${C.border}`, color: C.textMute, borderRadius: 7, padding: '8px 14px', cursor: 'pointer', fontSize: 13 }}>
                  Загрузить ещё
                </button>
              </div>
            </div>
          )}

          {status === 'idle' && (
            <div style={{ textAlign: 'center', marginTop: 8 }}>
              <a href="/dashboard" style={{ color: C.textDim, fontSize: 12, textDecoration: 'none' }}>← Вернуться на дашборд</a>
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
