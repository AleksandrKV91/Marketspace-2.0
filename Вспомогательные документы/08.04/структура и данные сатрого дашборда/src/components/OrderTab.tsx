// src/components/OrderTab.tsx
// Вкладка "Заказ товаров" — полная версия с формулой заказа, сезонностью и прозрачностью расчёта
'use client'
import React from 'react'

import { useState, useEffect, useMemo, useCallback, Fragment } from 'react'
import * as XLSX from 'xlsx'

// ─── Цвета (точная копия page.tsx) ───────────────────────────────────────────
const C = {
  bg: '#0f1117', card: '#1a1f2e', border: '#2d3548', cardHover: '#1e2535',
  blue: '#3b82f6', green: '#22c55e', yellow: '#f59e0b', red: '#ef4444',
  purple: '#8b5cf6', teal: '#10b981', orange: '#f97316',
  text: '#f1f5f9', textSec: '#94a3b8', textMute: '#64748b', textDim: '#475569',
}

const MONTHS_RU = ['январь','февраль','март','апрель','май','июнь',
                   'июль','август','сентябрь','октябрь','ноябрь','декабрь']
const PAGE_SIZE = 100

// ─── Types ────────────────────────────────────────────────────────────────────
interface OrderDetail {
  base_dpd: number | null
  coef_cur: number | null
  base_norm: number | null
  arrival: string | null
  need: number | null
  safety_days: number | null
  safety_qty: number | null
  horizon: { m: string; c: number; n: number }[]
  eff_horizon: number
  source: string
  used_ly: boolean
}

interface OrderItem {
  // Идентификаторы
  sku: string
  sku_wb: string
  name: string
  category: string
  pred: string          // предмет = связка с нишами
  brand: string
  supplier: string
  country: string
  // Статус
  status: string
  prev_status: string
  // ABC
  abc_class: string
  abc_class2: string
  gmroi: number | null
  // Остатки (из sheet1 + зеленка)
  fbo_wb: number
  fbs_push: number
  fbs_smol: number
  ms_stock: number
  in_transit: number
  in_prod: number
  total_stock: number
  // Продажи (из sheet1)
  dpd_7: number
  dpd_14: number
  dpd_31: number
  oos_7: number
  oos_14: number
  oos_31: number
  trend_14: number | null
  cv_31: number | null
  dpd_ly: number | null
  // Запас
  days_stock: number | null
  log_pleche: number | null
  // Расчёт заказа
  order_calc: number
  order_detail: OrderDetail | null
  order_mgr: number | null
  order_delta: number | null
  // Финансы
  cost: number | null
  margin_pct: number | null
  revenue: number | null
  profitability: number | null
  turnover: number | null
  // Планы
  plan: Record<string, number> | null
  arrival: string | null
  niche_season: string
  niche_top_month: string
  niche_months: number[] | null
  qty_supply: number | null
  // Новые поля
  sales_w1: number | null
  sales_w2: number | null
  sales_w3: number | null
  sales_w4: number | null
  sales_28d: number | null
  shelf_date: string | null
  daily_sales: Record<string, number> | null
  price: number | null
  gmroi_calc: number | null
  last_data_date: string | null
}

type UrgencyLevel = 'critical' | 'warning' | 'ok' | 'none'
type ActiveAlert = 'critical' | 'warning' | 'oos' | 'order' | null
type SalesPeriod = 7 | 14 | 31

interface Filters {
  search: string
  abc_class: string
  statuses: string[]
  urgency: string
  has_order: boolean
  horizon: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getUrgency(item: OrderItem): UrgencyLevel {
  const d = item.days_stock
  const lp = item.log_pleche ?? 30
  if (d === null) return 'none'
  if (d < lp * 0.5) return 'critical'
  if (d < lp) return 'warning'
  return 'ok'
}

const fmt = (n: number | null | undefined, dec = 0) =>
  n == null ? '—' : n.toLocaleString('ru-RU', { maximumFractionDigits: dec })

const fmtM = (n: number | null | undefined) => {
  if (n == null) return '—'
  const a = Math.abs(n)
  if (a >= 1_000_000) return (n / 1_000_000).toFixed(1) + ' М'
  if (a >= 1_000) return (n / 1_000).toFixed(0) + ' К'
  return fmt(n)
}

const fmtPct = (n: number | null | undefined) =>
  n == null ? '—' : (n * 100).toFixed(1) + '%'

const daysColor = (days: number | null, lp: number | null) => {
  if (days == null) return C.textMute
  const l = lp ?? 30
  if (days < l * 0.5) return C.red
  if (days < l) return C.yellow
  return C.green
}

const ABC_COLORS: Record<string, string> = {
  AA: C.green, AB: C.teal, BA: C.blue, BB: C.blue,
  AC: C.yellow, CA: C.orange, BC: C.yellow, CB: C.orange,
  CC: C.red, AAA: C.green,
}
const abcColor = (cls: string) => ABC_COLORS[cls] ?? C.textMute

// Клиентский пересчёт заказа при изменении горизонта
function recalcOrder(item: OrderItem, horizon: number): {
  order: number; need: number; safety_qty: number; h_details: {m:string;c:number;n:number}[]
} {
  const od = item.order_detail
  if (!od || !od.base_norm) return { order: 0, need: 0, safety_qty: 0, h_details: [] }

  const lp = item.log_pleche ?? 30
  const eff_h = lp <= 14 ? 14 : horizon
  const baseNorm = od.base_norm

  // Коэф. сезонности из ниши (niche_months[0]=янв...[11]=дек)
  const nm = item.niche_months
  const nmAvg = nm ? nm.filter(v => v > 0).reduce((s,v) => s+v, 0) / nm.filter(v => v > 0).length : 1
  const getCoef = (month1: number) => {
    if (nm && nm.length === 12 && nmAvg > 0) return nm[month1 - 1] / nmAvg
    return 1.0
  }

  // Разбиваем горизонт по месяцам от даты прихода
  const arrival = new Date(od.arrival || Date.now())
  const h_details: {m:string;c:number;n:number}[] = []
  let need = 0, cur = new Date(arrival), remaining = eff_h
  const MONTHS_RU = ['январь','февраль','март','апрель','май','июнь',
                     'июль','август','сентябрь','октябрь','ноябрь','декабрь']
  while (remaining > 0) {
    const daysInMonth = new Date(cur.getFullYear(), cur.getMonth() + 1, 0).getDate()
    const take = Math.min(daysInMonth - cur.getDate() + 1, remaining)
    const c = getCoef(cur.getMonth() + 1)
    const n = baseNorm * c * take
    need += n
    h_details.push({ m: MONTHS_RU[cur.getMonth()], c: parseFloat(c.toFixed(3)), n: Math.round(n) })
    remaining -= take
    cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1)
  }

  const safety_qty = od.safety_qty ?? 0
  // in_prod and in_transit are already ordered - subtract them too
  const already_have = item.total_stock + (item.in_transit ?? 0) + (item.in_prod ?? 0)
  const order = Math.max(0, Math.round(need + safety_qty - already_have))
  return { order, need: Math.round(need), safety_qty, h_details }
}

const STATUS_COLORS: Record<string, string> = {
  'топ': C.green, 'Звезда': C.yellow, 'топ200': C.teal,
  'потенциальный': C.blue, 'бывший топ': C.orange,
  'выводим': C.red, 'неликвид': C.textDim,
}
const statusColor = (s: string) => {
  for (const [k, v] of Object.entries(STATUS_COLORS)) {
    if (s.toLowerCase().includes(k.toLowerCase())) return v
  }
  return C.textSec
}

// ─── XLSX Export ──────────────────────────────────────────────────────────────
function exportOrderXLSX(data: OrderItem[], period: SalesPeriod, horizon: number) {
  const dpd = (item: OrderItem) =>
    period === 7 ? item.dpd_7 : period === 14 ? item.dpd_14 : item.dpd_31
  const oos = (item: OrderItem) =>
    period === 7 ? item.oos_7 : period === 14 ? item.oos_14 : item.oos_31

  const headers = [
    'SKU WB', 'Артикул склада', 'Название', 'Предмет', 'Статус', 'ABC',
    `Продажи ${period}д (шт/день)`, `OOS ${period}д (дней)`, 'Тренд 14д %',
    'FBO WB', 'FBS Push', 'FBS Smol', 'МС склад', 'В пути', 'В произв.',
    'Итого наличие', 'Дней запаса', 'Лог.плечо',
    `Расч. заказ (горизонт ${horizon}д)`, 'Заказ менедж.', 'Δ заказ',
    'Себа ₽', 'Сумма заказа ₽',
    'Коэф. текущего мес.', 'База норм /день', 'Дата прихода',
    'Потребность шт', 'Страховой запас шт', 'CV (вариация)',
    'Маржа %', 'Рентабельность %', 'Оборач. дн', 'Выручка ₽',
    'Цена WB ₽', 'GMROI', 'GMROI расч.',
    'Продажи Нед.1 шт', 'Продажи Нед.2 шт', 'Продажи Нед.3 шт', 'Продажи Нед.4 шт', 'Продажи 28д шт',
    'Дата поступления',
    'Поставщик', 'Страна',
  ]
  const rows = data.map(item => {
    const od = item.order_detail
    const trendPct = item.trend_14 != null ? +(item.trend_14 * 100).toFixed(1) : ''
    return [
      item.sku_wb, item.sku, item.name, item.pred, item.status, item.abc_class,
      dpd(item) || '', oos(item),
      trendPct,
      item.fbo_wb, item.fbs_push, item.fbs_smol, item.ms_stock, item.in_transit, item.in_prod,
      item.total_stock,
      item.days_stock != null ? +item.days_stock.toFixed(1) : '',
      item.log_pleche ?? '',
      item.order_calc || '',
      item.order_mgr ?? '',
      item.order_delta != null ? item.order_delta : '',
      item.cost != null ? +item.cost.toFixed(2) : '',
      item.order_calc && item.cost ? +(item.order_calc * item.cost).toFixed(0) : '',
      od?.coef_cur ?? '', od?.base_norm ?? '', od?.arrival ?? '',
      od?.need ?? '', od?.safety_qty ?? '',
      item.cv_31 ?? '',
      item.margin_pct != null ? +item.margin_pct.toFixed(2) : '',
      item.profitability != null ? +(item.profitability * 100).toFixed(1) : '',
      item.turnover != null ? +item.turnover.toFixed(0) : '',
      item.revenue != null ? +item.revenue.toFixed(0) : '',
      item.price != null ? +item.price.toFixed(0) : '',
      item.gmroi != null ? +(item.gmroi * 100).toFixed(1) : '',
      item.gmroi_calc != null ? +((item.gmroi_calc as number) * 100).toFixed(1) : '',
      item.sales_w1 ?? '', item.sales_w2 ?? '', item.sales_w3 ?? '', item.sales_w4 ?? '', item.sales_28d ?? '',
      item.shelf_date ?? '',
      item.supplier, item.country,
    ]
  })

  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Заказ товаров')
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  const blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `order_${new Date().toISOString().slice(0, 10)}_${period}d_h${horizon}.xlsx`
  document.body.appendChild(a); a.click()
  document.body.removeChild(a); URL.revokeObjectURL(url)
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function AlertCard({ icon, title, value, desc, color, active, onClick }: {
  icon: string; title: string; value: string | number; desc: string
  color: string; active: boolean; onClick: () => void
}) {
  return (
    <div onClick={onClick} style={{
      background: active ? color + '18' : '#111827',
      borderRadius: 10, padding: '12px 14px',
      borderTop:    active ? `1px solid ${color}` : `1px solid ${color}30`,
      borderRight:  active ? `1px solid ${color}` : `1px solid ${color}30`,
      borderBottom: active ? `1px solid ${color}` : `1px solid ${color}30`,
      borderLeft:   `3px solid ${color}`,
      cursor: 'pointer', transition: '.15s', userSelect: 'none',
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.textSec, marginBottom: 3 }}>{icon} {title}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color, marginBottom: 2 }}>{value}</div>
      <div style={{ fontSize: 11, color: C.textMute, lineHeight: 1.4 }}>{desc}</div>
      <span style={{ color: C.blue + '80', fontSize: 10, marginTop: 5, display: 'block' }}>
        {active ? '✕ Сбросить фильтр' : '↗ Показать товары'}
      </span>
    </div>
  )
}

// Mini season bar chart component
const MONTHS_SHORT = ['Я','Ф','М','А','М','И','И','А','С','О','Н','Д']
function SeasonChart({ months }: { months: number[] }) {
  const vals = months.filter(v => v > 0)
  const avg  = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 1
  const maxV = Math.max(...months, 1)
  return (
    <div style={{ marginTop: 4 }}>
      <div style={{ fontSize: 9, color: '#64748b', marginBottom: 3 }}>Коэф. по месяцам:</div>
      <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: 28 }}>
        {months.map((v, i) => {
          const coef = avg > 0 ? v / avg : 1
          const h    = Math.max(2, Math.round(v / maxV * 24))
          const bg   = coef > 1.2 ? '#22c55e' : coef < 0.8 ? '#ef4444' : '#3b82f6'
          return (
            <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}
                 title={`${MONTHS_SHORT[i]}: ${coef.toFixed(2)}`}>
              <div style={{ width: '100%', height: `${h}px`, borderRadius: 2, background: bg, opacity: 0.8 }} />
              <div style={{ fontSize: 6, color: '#64748b' }}>{MONTHS_SHORT[i]}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Helper: ABC rows for 4th column
function abcRows(item: OrderItem): [string, React.ReactNode][] {
  return [
    ['ABC (ЧМД/выр)',   item.abc_class  ? <span style={{ color: abcColor(item.abc_class),  fontWeight: 800 }}>{item.abc_class}</span>  : '—'],
    ['ABC (выр/об)',    item.abc_class2 ? <span style={{ color: abcColor(item.abc_class2), fontWeight: 800 }}>{item.abc_class2}</span> : '—'],
    ['Маржа %',         item.margin_pct != null ? <span style={{ color: item.margin_pct < 10 ? C.red : item.margin_pct < 20 ? C.yellow : C.green, fontWeight: 700 }}>{item.margin_pct.toFixed(1)}%</span> : '—'],
    ['Рентабельность',  item.profitability != null ? fmtPct(item.profitability) : '—'],
    ['Оборачиваемость', item.turnover ? fmt(item.turnover, 0) + ' дн' : '—'],
    ['Выручка',         <span style={{ color: C.blue }}>{fmtM(item.revenue)} ₽</span>],
    ['Цена продажи WB', item.price != null ? fmt(item.price, 0) + ' ₽' : '—'],
    ['GMROI расч.',     item.gmroi_calc != null
      ? <span style={{ color: (item.gmroi_calc as number) > 0.5 ? C.green : (item.gmroi_calc as number) > 0 ? C.yellow : C.red, fontWeight: 700 }}>
          {((item.gmroi_calc as number) * 100).toFixed(0)}%
        </span>
      : '—'],
  ]
}

// Note block - saves to Supabase via API
function OrderNoteBlock({ skuId }: { skuId: string }) {
  const [note, setNote] = React.useState('')
  const [author, setAuthor] = React.useState('')
  const [saved, setSaved] = React.useState(false)
  React.useEffect(() => {
    fetch('/api/notes?sku_id=' + skuId)
      .then(r => r.json())
      .then(d => { setNote(d.note || ''); setAuthor(d.user_name || '') })
      .catch(() => {})
  }, [skuId])
  const save = () => {
    fetch('/api/notes', { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sku_id: skuId, note }) })
      .then(() => { setSaved(true); setTimeout(() => setSaved(false), 1500) })
      .catch(() => {})
  }
  return (
    <div style={{ marginTop: 8, padding: '8px 10px', background: C.card, borderRadius: 6 }}>
      <div style={{ fontSize: 9, color: C.textDim, marginBottom: 4 }}>ЗАМЕТКА</div>
      <textarea value={note} onChange={e => setNote(e.target.value)}
        placeholder='Добавьте заметку...'
        style={{ width: '100%', minHeight: 48, background: C.cardHover,
                 border: `1px solid ${C.border}`, borderRadius: 4, padding: '4px 8px',
                 color: C.text, fontSize: 11, resize: 'vertical', outline: 'none',
                 fontFamily: 'inherit', boxSizing: 'border-box' }} />
      {author ? <div style={{ fontSize: 9, color: C.textDim, marginTop: 2 }}>{'Автор: ' + author}</div> : null}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4, alignItems: 'center' }}>
        {saved ? <span style={{ fontSize: 10, color: C.green }}>Сохранено</span> : null}
        <button onClick={save} style={{ background: C.blue, color: '#fff', border: 'none',
          borderRadius: 4, padding: '3px 10px', fontSize: 11, cursor: 'pointer' }}>
          Сохранить
        </button>
      </div>
    </div>
  )
}

// ─── Детали расчёта ───────────────────────────────────────────────────────────
function OrderCalcPanel({ item, period, horizon, perStart, perEnd }: { item: OrderItem; period: SalesPeriod; horizon: number; perStart: string; perEnd: string }) {
  const od = item.order_detail
  const dpd = period === 7 ? item.dpd_7 : period === 14 ? item.dpd_14 : item.dpd_31
  const oos = period === 7 ? item.oos_7 : period === 14 ? item.oos_14 : item.oos_31
  const recalc = recalcOrder(item, horizon)

  const row = (label: string, value: React.ReactNode, note?: string) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '4px 0', borderBottom: `1px solid ${C.border}40` }}>
      <span style={{ fontSize: 11, color: C.textMute }}>{label}</span>
      <span style={{ fontSize: 11, fontWeight: 600 }}>
        {value}
        {note && <span style={{ fontSize: 10, color: C.textDim, marginLeft: 6 }}>{note}</span>}
      </span>
    </div>
  )

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
                  padding: '14px 16px', marginTop: 10 }}>

      <div style={{ display: 'flex', gap: 16, marginBottom: 12, flexWrap: 'wrap' }}>
        <div>
          <span style={{ fontSize: 10, color: C.textDim }}>SKU WB </span>
          <span style={{ fontSize: 12, color: C.blue, fontWeight: 700 }}>{item.sku_wb || '—'}</span>
        </div>
        <div>
          <span style={{ fontSize: 10, color: C.textDim }}>Артикул </span>
          <span style={{ fontSize: 11, color: C.textSec, fontFamily: 'monospace' }}>{item.sku}</span>
        </div>
        {item.status && (
          <div>
            <span style={{ fontSize: 10, color: C.textDim }}>Статус </span>
            <span style={{ fontSize: 11, fontWeight: 700, color: statusColor(item.status) }}>
              {item.status}
            </span>
          </div>
        )}
        {item.supplier && (
          <div>
            <span style={{ fontSize: 10, color: C.textDim }}>Поставщик </span>
            <span style={{ fontSize: 11, color: C.textSec }}>{item.supplier}</span>
          </div>
        )}
        {item.country && (
          <div>
            <span style={{ fontSize: 10, color: C.textDim }}>Страна </span>
            <span style={{ fontSize: 11, color: C.textSec }}>{item.country}</span>
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.2fr 1fr', gap: 12 }}>

        <div style={{ background: C.cardHover, borderRadius: 8, padding: '10px 12px' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.textDim, textTransform: 'uppercase',
                        letterSpacing: 0.7, marginBottom: 8 }}>📦 Остатки</div>
          {row('FBO WB', <span style={{ color: C.blue }}>{fmt(item.fbo_wb)}</span>)}
          {row('FBS Пушкино', fmt(item.fbs_push))}
          {row('FBS Смоленск', fmt(item.fbs_smol))}
          {row('МС склад', fmt(item.ms_stock))}
          {row('В пути', <span style={{ color: C.teal }}>+{fmt(item.in_transit)}</span>)}
          {row('В производстве', fmt(item.in_prod))}
          {row('Итого наличие', <span style={{ color: C.text, fontWeight: 800 }}>{fmt(item.total_stock)}</span>)}
          {item.shelf_date ? row('Дата поступления', item.shelf_date) : null}
          {(item.in_transit > 0 || item.in_prod > 0) && row(
            'Итого в работе',
            <span style={{ color: C.green, fontWeight: 800 }}>
              {fmt(item.total_stock + (item.in_transit ?? 0) + (item.in_prod ?? 0))}
            </span>,
            'склад + в пути + в произв.'
          )}
        </div>

        <div style={{ background: C.cardHover, borderRadius: 8, padding: '10px 12px' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.textDim, textTransform: 'uppercase',
                        letterSpacing: 0.7, marginBottom: 8 }}>📈 Продажи (из sheet1)</div>
          {row('7 дней', `${fmt(item.dpd_7, 1)}/день`, `OOS: ${item.oos_7} дн`)}
          {row('14 дней', `${fmt(item.dpd_14, 1)}/день`, `OOS: ${item.oos_14} дн`)}
          {row('31 день', <span style={{ color: C.blue, fontWeight: 800 }}>{fmt(item.dpd_31, 1)}/день</span>,
               `OOS: ${item.oos_31} дн`)}
          {row('Тренд 14д',
            item.trend_14 != null
              ? <span style={{ color: item.trend_14 > 0.05 ? C.green : item.trend_14 < -0.05 ? C.red : C.textSec }}>
                  {item.trend_14 > 0 ? '↑ +' : '↓ '}{(item.trend_14 * 100).toFixed(1)}%
                </span>
              : <span style={{ color: C.textDim }}>—</span>
          )}
          {row('Год назад', item.dpd_ly != null ? `${fmt(item.dpd_ly, 1)}/день` : '—')}
          {row('CV (вариация)', item.cv_31 != null ? item.cv_31.toFixed(3) : '—',
               item.cv_31 ? (item.cv_31 < 0.3 ? 'стабильно' : item.cv_31 < 0.6 ? 'умеренно' : 'нестабильно') : undefined)}
          {row('Дней запаса сейчас',
            <span style={{ color: daysColor(item.days_stock, item.log_pleche), fontWeight: 700 }}>
              {fmt(item.days_stock, 0)} дн
            </span>
          )}
          <div style={{ borderTop: `1px solid ${C.border}40`, margin: '6px 0' }} />
          {item.last_data_date ? (
            <div style={{ fontSize: 9, color: C.textDim, marginBottom: 3 }}>
              {'Данные по: '}<span style={{ color: C.yellow }}>{item.last_data_date}</span>
            </div>
          ) : null}
          {(() => {
            const ld = item.last_data_date
            const wRange = (dTo: number, dFrom: number) => {
              if (!ld) return ''
              const to   = new Date(ld); to.setDate(to.getDate() - dFrom)
              const from = new Date(ld); from.setDate(from.getDate() - dTo)
              const fmt2 = (d: Date) => `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}`
              return ` (${fmt2(new Date(from.getTime() + 86400000))}–${fmt2(to)})`
            }
            return (
              <>
                {row('Неделя 1' + wRange(7, 0), item.sales_w1 != null ? `${fmt(item.sales_w1, 0)} шт` : '—')}
                {row('Неделя 2' + wRange(14, 7), item.sales_w2 != null ? `${fmt(item.sales_w2, 0)} шт` : '—')}
                {row('Неделя 3' + wRange(21, 14), item.sales_w3 != null ? `${fmt(item.sales_w3, 0)} шт` : '—')}
                {row('Неделя 4' + wRange(28, 21), item.sales_w4 != null ? `${fmt(item.sales_w4, 0)} шт` : '—')}
              </>
            )
          })()}
          {row('Итого 28 дней', item.sales_28d != null
            ? <span style={{ color: C.blue, fontWeight: 700 }}>{fmt(item.sales_28d, 0)} шт</span>
            : '—'
          )}
          {perStart && perEnd && item.daily_sales ? (() => {
            const ps = perStart, pe = perEnd
            const total = Object.entries(item.daily_sales as Record<string,number>)
              .filter(([d]) => d >= ps && d <= pe)
              .reduce((s, [, v]) => s + v, 0)
            return total > 0 ? (
              <div style={{ borderTop: `1px solid ${C.border}40`, marginTop: 4, paddingTop: 4 }}>
                {row('Период (шт.)',
                  <span style={{ color: C.orange, fontWeight: 700 }}>{fmt(total, 0)} шт</span>,
                  ps + ' — ' + pe
                )}
              </div>
            ) : null
          })() : null}
        </div>

        <div style={{ background: C.cardHover, borderRadius: 8, padding: '10px 12px' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.textDim, textTransform: 'uppercase',
                        letterSpacing: 0.7, marginBottom: 8 }}>🧮 Расчёт заказа</div>
          {row(`Продажи ${period}д (база)`, `${fmt(dpd, 1)}/день`, `OOS: ${oos} дн из ${period}`)}
          {od && row('Коэф. текущего мес.',
            <span style={{ color: od.coef_cur && od.coef_cur < 0.8 ? C.yellow :
                                   od.coef_cur && od.coef_cur > 1.2 ? C.green : C.textSec }}>
              {od.coef_cur?.toFixed(3)}
            </span>, od.coef_cur && od.coef_cur < 0.8 ? 'низкий сезон' :
                       od.coef_cur && od.coef_cur > 1.2 ? 'высокий сезон' : 'норм'
          )}
          {od && row('База (÷ коэф.)', `${fmt(od.base_norm, 1)}/день`,
                     '≈ продажи без влияния сезона')}
          {row('Лог. плечо', `${item.log_pleche} дн`)}
          {od && row('Дата прихода', od.arrival?.slice(0, 10) ?? '—')}
          <div style={{ margin: '6px 0 4px', fontSize: 10, color: C.textDim }}>Горизонт по месяцам:</div>
          {recalc.h_details.map(h => (
            <div key={h.m} style={{ display: 'flex', justifyContent: 'space-between',
                                    fontSize: 10, padding: '2px 0', color: C.textSec }}>
              <span>{h.m} (коэф. {h.c.toFixed(2)})</span>
              <span>{fmt(h.n)} шт</span>
            </div>
          ))}
          {row('Потребность итого', <span style={{ color: C.text }}>{fmt(recalc.need)} шт</span>)}
          {od && row(`Страховой запас (${od.safety_days} дн)`,
            `${fmt(recalc.safety_qty)} шт`, `√(${item.log_pleche})×CV`)}
          <div style={{ margin: '8px 0 4px', height: 1, background: C.border }} />
          {row('Итого нужно',
            <span style={{ color: C.text, fontWeight: 800 }}>
              {fmt(recalc.need + recalc.safety_qty)} шт
            </span>)}
          {row('Минус наличие',
            <span>
              <span style={{ color: C.textSec }}>склад {fmt(item.total_stock)}</span>
              {item.in_transit > 0 && <span style={{ color: C.teal }}> + в пути {fmt(item.in_transit)}</span>}
              {item.in_prod > 0 && <span style={{ color: C.yellow }}> + произв. {fmt(item.in_prod)}</span>}
              <span style={{ color: C.text, fontWeight: 700 }}> = {fmt(item.total_stock + (item.in_transit ?? 0) + (item.in_prod ?? 0))} шт</span>
            </span>
          )}
          <div style={{ marginTop: 8, padding: '8px', background: C.blue + '15',
                        borderRadius: 6, border: `1px solid ${C.blue}40` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: C.blue }}>
                ► Расч. заказ (горизонт {od?.eff_horizon}→{horizon}д)
              </span>
              <span style={{ fontSize: 16, fontWeight: 800, color: C.blue }}>
                {fmt(recalc.order)} шт
              </span>
            </div>
          </div>
          {item.order_mgr != null && (
            <div style={{ marginTop: 6, padding: '6px 8px', background: C.purple + '15',
                          borderRadius: 6, border: `1px solid ${C.purple}40` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11, color: C.purple }}>► Заказ менеджера</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: C.purple }}>
                  {fmt(item.order_mgr)} шт
                </span>
              </div>
              {item.order_delta != null && (
                <div style={{ fontSize: 11, color: Math.abs(item.order_delta) > 100 ? C.yellow : C.textSec,
                              textAlign: 'right', marginTop: 2 }}>
                  {`Δ ${item.order_delta > 0 ? '+' : ''}${fmt(item.order_delta)} шт`}
                </div>
              )}
            </div>
          )}
          {item.cost != null && item.order_calc > 0 && (
            <div style={{ marginTop: 6, fontSize: 11, color: C.textSec, textAlign: 'right' }}>
              Себа {fmt(item.cost, 0)} ₽ × {fmt(item.order_calc)} =
              <span style={{ color: C.yellow, fontWeight: 700, marginLeft: 4 }}>
                {fmtM(item.order_calc * item.cost)} ₽
              </span>
            </div>
          )}
        </div>

        <div style={{ background: C.cardHover, borderRadius: 8, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 5 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.textDim, textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 4 }}>ABC и финансы</div>
          {abcRows(item).map(([label, value], i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: `1px solid ${C.border}30` }}>
              <span style={{ fontSize: 10, color: C.textMute }}>{label as string}</span>
              <span style={{ fontSize: 11, fontWeight: 600 }}>{value as React.ReactNode}</span>
            </div>
          ))}
          {item.niche_season && (
            <div style={{ marginTop: 6, padding: '6px 8px', background: C.card, borderRadius: 6 }}>
              <div style={{ fontSize: 10, color: C.textDim, marginBottom: 3 }}>Сезонность ниши</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: item.niche_season === 'Сезонный' ? C.yellow : C.green }}>{item.niche_season}</div>
              {item.niche_top_month && <div style={{ fontSize: 10, color: C.textSec, marginTop: 2 }}>Пик: <span style={{ color: C.orange, fontWeight: 700 }}>{item.niche_top_month}</span></div>}
            </div>
          )}
          {item.niche_months && item.niche_months.length === 12 && <SeasonChart months={item.niche_months} />}
          <OrderNoteBlock skuId={item.sku} />
          {item.plan && Object.keys(item.plan).length > 0 && (
            <div style={{ marginTop: 8, padding: '8px', background: C.card, borderRadius: 6 }}>
              <div style={{ fontSize: 9, color: C.textDim, marginBottom: 4 }}>ПЛАН ПРОДАЖ WB ПО МЕСЯЦАМ</div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                {Object.entries(item.plan).map(([m, v]) => (
                  <div key={m} style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 9, color: C.textMute }}>{m}</div>
                    <div style={{ fontSize: 12, fontWeight: 800, color: C.blue }}>{fmt(v)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

    </div>
  )
}

function FilterSelect({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div style={{ color: C.textDim, fontSize: 10, fontWeight: 600,
                    textTransform: 'uppercase', letterSpacing: 0.4, paddingLeft: 2 }}>{label}</div>
      <select value={value} onChange={e => onChange(e.target.value)} style={{
        background: C.card, border: `1px solid ${C.border}`, borderRadius: 7,
        padding: '6px 10px', color: C.text, fontSize: 12, outline: 'none',
      }}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function OrderTab() {
  const [data, setData]           = useState<OrderItem[]>([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState<string | null>(null)
  const [period, setPeriod]       = useState<SalesPeriod>(31)
  const [activeAlert, setActiveAlert] = useState<ActiveAlert>(null)
  const [filters, setFilters]     = useState<Filters>({
    search: '', abc_class: '', statuses: [], urgency: 'all',
    has_order: false, horizon: 60,
  })
  const [sortKey, setSortKey]     = useState<string>('dpd_31')
  const [sortDir, setSortDir]     = useState<'asc' | 'desc'>('desc')
  const [offset, setOffset]       = useState(0)
  const [expanded, setExpanded]   = useState<string | null>(null)
  const [perStart, setPerStart]   = useState<string>('')
  const [perEnd, setPerEnd]       = useState<string>('')
  const [perCalOpen, setPerCalOpen] = useState<boolean>(false)

  useEffect(() => {
    // Get auth token - same logic as page.tsx
    let token = ''
    if (typeof window !== 'undefined') {
      token = localStorage.getItem('sb_access_token') ?? ''
      if (!token) {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i)
          if (key && key.startsWith('sb-') && key.endsWith('-auth-token')) {
            try {
              const val = JSON.parse(localStorage.getItem(key) ?? '{}')
              token = val.access_token ?? ''
            } catch { /* ignore */ }
            break
          }
        }
      }
    }
    fetch('/api/order-data', {
      headers: token ? { 'Authorization': 'Bearer ' + token } : {}
    })
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() })
      .then(res => {
        if (res?.error) throw new Error(res.error)
        setData(Array.isArray(res) ? res : (res.data ?? []))
      })
      .catch(e => setError(String(e?.message ?? e)))
      .finally(() => setLoading(false))
  }, [])

  const abcOptions    = useMemo(() => [...new Set(data.map(d => d.abc_class).filter(Boolean))].sort(), [data])
  const statusOptions = useMemo(() => [...new Set(data.map(d => d.status).filter(Boolean))].sort(), [data])

  const setFilter = useCallback((patch: Partial<Filters>) => {
    setFilters(f => ({ ...f, ...patch })); setOffset(0)
  }, [])

  const handleAlertClick = useCallback((key: ActiveAlert) => {
    setActiveAlert(prev => prev === key ? null : key); setOffset(0)
  }, [])

  // Текущий dpd в зависимости от периода
  const getDpd = useCallback((item: OrderItem) =>
    period === 7 ? item.dpd_7 : period === 14 ? item.dpd_14 : item.dpd_31, [period])

  const filtered = useMemo(() => {
    let list = data.slice()

    // Alert filters
    if      (activeAlert === 'critical') list = list.filter(i => getUrgency(i) === 'critical')
    else if (activeAlert === 'warning')  list = list.filter(i => getUrgency(i) === 'warning')
    else if (activeAlert === 'oos')      list = list.filter(i =>
      i.fbo_wb === 0 && i.ms_stock === 0 && getDpd(i) > 0)
    else if (activeAlert === 'order')    list = list.filter(i => i.order_calc > 0)
    else {
      if (filters.urgency !== 'all') list = list.filter(i => getUrgency(i) === filters.urgency)
      if (filters.has_order)         list = list.filter(i => recalcOrder(i, filters.horizon).order > 0 || (i.order_mgr ?? 0) > 0)
    }

    if (filters.search) {
      const q = filters.search.toLowerCase()
      list = list.filter(i =>
        i.sku.toLowerCase().includes(q) || i.sku_wb.includes(q) ||
        i.name.toLowerCase().includes(q) || i.pred.toLowerCase().includes(q))
    }
    if (filters.abc_class) list = list.filter(i => i.abc_class === filters.abc_class)
    if (filters.statuses.length > 0) list = list.filter(i => filters.statuses.includes(i.status) || (filters.statuses.includes('') && !i.status))

    // Sort
    list.sort((a, b) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let av: unknown = (a as any)[sortKey]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let bv: unknown = (b as any)[sortKey]
      // Для dpd используем выбранный период
      if (sortKey === 'dpd') { av = getDpd(a); bv = getDpd(b) }
      const inf = sortDir === 'asc' ? Infinity : -Infinity
      const na = av == null ? inf : av
      const nb = bv == null ? inf : bv
      if (na === nb) return 0
      return (na > nb ? 1 : -1) * (sortDir === 'asc' ? 1 : -1)
    })

    return list
  }, [data, filters, activeAlert, sortKey, sortDir, getDpd])

  const counts = useMemo(() => ({
    critical: data.filter(i => getUrgency(i) === 'critical').length,
    warning:  data.filter(i => getUrgency(i) === 'warning').length,
    oos:      data.filter(i => i.fbo_wb === 0 && i.ms_stock === 0 && getDpd(i) > 0).length,
    order:    data.filter(i => i.order_calc > 0).length,
    cost:     data.reduce((s, i) => s + (i.order_calc && i.cost ? i.order_calc * i.cost : 0), 0),
  }), [data, getDpd])

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const curPage    = Math.floor(offset / PAGE_SIZE) + 1
  const paginated  = useMemo(() => filtered.slice(offset, offset + PAGE_SIZE), [filtered, offset])

  const handleSort = useCallback((col: string) => {
    if (sortKey === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(col); setSortDir('asc') }
    setOffset(0)
  }, [sortKey])

  const sortIcon = (col: string) =>
    sortKey === col ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ' ↕'

  const th = (align: 'left' | 'center' | 'right' = 'center'): React.CSSProperties => ({
    textAlign: align, padding: '7px 8px', color: C.textMute, fontSize: 10,
    fontWeight: 600, borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap',
    cursor: 'pointer', background: C.card,
  })
  const td = (align: 'left' | 'center' | 'right' = 'center'): React.CSSProperties => ({
    padding: '7px 8px', fontSize: 11, textAlign: align, verticalAlign: 'middle',
  })

  if (loading) return (
    <div style={{ textAlign: 'center', padding: 60, color: C.textMute }}>
      <div style={{ marginBottom: 12, fontSize: 14 }}>Загрузка данных заказов...</div>
      <div style={{ width: 200, height: 3, background: C.border, borderRadius: 3,
                    margin: '0 auto', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: '60%', background: C.blue, borderRadius: 3 }} />
      </div>
    </div>
  )

  if (error) return (
    <div style={{ margin: 20, padding: 16, borderRadius: 10,
                  background: C.red + '15', border: `1px solid ${C.red}40` }}>
      <div style={{ color: C.red, fontWeight: 700, marginBottom: 6 }}>Ошибка загрузки данных</div>
      <div style={{ color: C.textSec, fontSize: 12, marginBottom: 4 }}>{error}</div>
      <div style={{ color: C.textMute, fontSize: 12 }}>
        Убедитесь что <code style={{ background: C.card, padding: '1px 4px', borderRadius: 3 }}>
        public/order_tab_data.json</code> и маршрут <code style={{ background: C.card,
        padding: '1px 4px', borderRadius: 3 }}>/api/order-data</code> созданы.
      </div>
    </div>
  )

  return (
    <div style={{ color: C.text }}>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 10, marginBottom: 14 }}>
        <AlertCard icon="🚨" title="Критический запас" value={counts.critical}
          desc="запас < 50% лог. плеча" color={C.red}
          active={activeAlert === 'critical'} onClick={() => handleAlertClick('critical')} />
        <AlertCard icon="⚠️" title="Требует внимания" value={counts.warning}
          desc="запас < лог. плеча" color={C.yellow}
          active={activeAlert === 'warning'} onClick={() => handleAlertClick('warning')} />
        <AlertCard icon="📭" title="OOS с продажами" value={counts.oos}
          desc="нет стока, есть спрос" color={C.purple}
          active={activeAlert === 'oos'} onClick={() => handleAlertClick('oos')} />
        <AlertCard icon="📦" title="К заказу" value={counts.order}
          desc="расч. заказ > 0" color={C.blue}
          active={activeAlert === 'order'} onClick={() => handleAlertClick('order')} />
        <AlertCard icon="💰" title="Сумма заказов"
          value={`${(counts.cost / 1_000_000).toFixed(1)} М₽`}
          desc="расч. заказ × себа" color={C.teal}
          active={false} onClick={() => {}} />
      </div>

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
                    padding: '10px 14px', marginBottom: 12,
                    display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ color: C.textDim, fontSize: 10, fontWeight: 600,
                        textTransform: 'uppercase', letterSpacing: 0.4 }}>🔍 Поиск</div>
          <input type="text" placeholder="SKU, артикул, название, предмет..."
            value={filters.search}
            onChange={e => { setFilter({ search: e.target.value }); setActiveAlert(null) }}
            style={{ background: C.cardHover, border: `1px solid ${C.border}`, borderRadius: 7,
                     padding: '6px 10px', color: C.text, fontSize: 12, outline: 'none', width: 240 }} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ color: C.textDim, fontSize: 10, fontWeight: 600,
                        textTransform: 'uppercase', letterSpacing: 0.4 }}>Период продаж</div>
          <div style={{ display: 'flex', gap: 4 }}>
            {([7, 14, 31] as SalesPeriod[]).map(p => (
              <button key={p} onClick={() => setPeriod(p)}
                style={{ background: period === p ? C.blue : C.cardHover,
                         border: `1px solid ${period === p ? C.blue : C.border}`,
                         color: period === p ? '#fff' : C.textSec,
                         borderRadius: 6, padding: '6px 10px', cursor: 'pointer', fontSize: 12,
                         fontWeight: period === p ? 700 : 400 }}>
                {p}д
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ color: C.textDim, fontSize: 10, fontWeight: 600,
                        textTransform: 'uppercase', letterSpacing: 0.4 }}>Горизонт заказа</div>
          <div style={{ display: 'flex', gap: 4 }}>
            {[60, 90].map(h => (
              <button key={h} onClick={() => setFilter({ horizon: h })}
                style={{ background: filters.horizon === h ? C.purple : C.cardHover,
                         border: `1px solid ${filters.horizon === h ? C.purple : C.border}`,
                         color: filters.horizon === h ? '#fff' : C.textSec,
                         borderRadius: 6, padding: '6px 10px', cursor: 'pointer', fontSize: 12,
                         fontWeight: filters.horizon === h ? 700 : 400 }}>
                {h}д
              </button>
            ))}
          </div>
        </div>

        <FilterSelect label="Статус запаса" value={activeAlert ? '' : filters.urgency}
          onChange={v => { setFilter({ urgency: v }); setActiveAlert(null) }}
          options={[
            { value: 'all', label: 'Все статусы' },
            { value: 'critical', label: '🚨 Критический' },
            { value: 'warning',  label: '⚠️ Предупреждение' },
            { value: 'ok',       label: '✅ Норма' },
          ]} />

        <FilterSelect label="ABC класс" value={filters.abc_class}
          onChange={v => { setFilter({ abc_class: v }); setActiveAlert(null) }}
          options={[{ value: '', label: 'Все ABC' }, ...abcOptions.map(c => ({ value: c, label: c }))]} />

        {/* Multi-select status */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ color: C.textDim, fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Статус товара</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {[{ value: '', label: 'Без статуса' }, ...statusOptions.map(s => ({ value: s, label: s }))].map(opt => {
              const active = opt.value === '' ? filters.statuses.includes('') : filters.statuses.includes(opt.value)
              return (
                <button key={opt.value} onClick={() => {
                  const cur = filters.statuses
                  const next = active ? cur.filter(s => s !== opt.value) : [...cur, opt.value]
                  setFilter({ statuses: next })
                  setActiveAlert(null)
                }} style={{
                  padding: '2px 7px', fontSize: 10, borderRadius: 4, cursor: 'pointer',
                  border: `1px solid ${active ? C.blue : C.border}`,
                  background: active ? C.blue + '33' : 'transparent',
                  color: active ? C.blue : C.textSec, fontWeight: active ? 700 : 400,
                }}>
                  {opt.label}
                </button>
              )
            })}
            {filters.statuses.length > 0 ? (
              <button onClick={() => { setFilter({ statuses: [] }); setActiveAlert(null) }}
                style={{ padding: '2px 7px', fontSize: 10, borderRadius: 4, cursor: 'pointer',
                         border: `1px solid ${C.border}`, background: 'transparent', color: C.textDim }}>
                Сбросить
              </button>
            ) : null}
          </div>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12,
                        color: C.textSec, cursor: 'pointer', alignSelf: 'center', marginTop: 8 }}>
          <input type="checkbox" checked={filters.has_order}
            onChange={e => { setFilter({ has_order: e.target.checked }); setActiveAlert(null) }} />
          Только с заказом
        </label>

        <button onClick={() => { setFilters({ search: '', abc_class: '', statuses: [], urgency: 'all',
                                              has_order: false, horizon: 60 }); setActiveAlert(null); setOffset(0) }}
          style={{ background: 'transparent', border: `1px solid ${C.border}`,
                   color: C.textMute, borderRadius: 7, padding: '6px 12px',
                   cursor: 'pointer', fontSize: 12, alignSelf: 'flex-end' }}>
          ✕ Сбросить
        </button>

        <div style={{ marginLeft: 'auto', alignSelf: 'flex-end', display: 'flex',
                      alignItems: 'center', gap: 10 }}>
          {activeAlert && (
            <span style={{ background: C.blue + '20', border: `1px solid ${C.blue}`,
                           color: C.blue, borderRadius: 6, padding: '3px 10px',
                           fontSize: 11, fontWeight: 600 }}>
              🔔 {activeAlert === 'critical' ? 'Критический' :
                   activeAlert === 'warning'  ? 'Предупреждение' :
                   activeAlert === 'oos'      ? 'OOS' : 'К заказу'}
              <span onClick={() => setActiveAlert(null)} style={{ cursor: 'pointer', marginLeft: 6 }}>✕</span>
            </span>
          )}
          <span style={{ color: C.textMute, fontSize: 12 }}>
            <b style={{ color: C.text }}>{filtered.length}</b> SKU
          </span>
          <button onClick={() => exportOrderXLSX(filtered, period, filters.horizon)}
            style={{ background: C.cardHover, border: `1px solid ${C.green}`,
                     color: C.green, borderRadius: 6, padding: '5px 12px',
                     cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>
            📥 XLSX
          </button>
        </div>
      </div>

      {/* Period selector row */}
      <div style={{ padding: '6px 0 2px', display: 'flex', alignItems: 'center', gap: 8, position: 'relative' }}>
        <span style={{ fontSize: 11, color: C.textDim }}>Период продаж:</span>
        <button onClick={() => setPerCalOpen(!perCalOpen)}
          style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 5,
                   padding: '3px 10px', fontSize: 11,
                   color: perStart ? C.blue : C.textSec, cursor: 'pointer' }}>
          {perStart && perEnd ? perStart + ' — ' + perEnd : 'Выбрать даты'}
        </button>
        {perStart ? (
          <button onClick={() => { setPerStart(''); setPerEnd('') }}
            style={{ background: 'none', border: 'none', color: C.textDim,
                     cursor: 'pointer', fontSize: 11, padding: 0 }}>✕ Сбросить</button>
        ) : null}
        {perCalOpen ? (
          <div style={{ position: 'absolute', top: 32, left: 80, zIndex: 200,
                        background: C.card, border: `1px solid ${C.border}`,
                        borderRadius: 8, padding: 10, display: 'flex', gap: 8,
                        boxShadow: '0 4px 20px rgba(0,0,0,0.5)' }}>
            <div>
              <div style={{ fontSize: 9, color: C.textDim, marginBottom: 3 }}>От</div>
              <input type='date' value={perStart} onChange={e => setPerStart(e.target.value)}
                style={{ background: C.cardHover, border: `1px solid ${C.border}`,
                         borderRadius: 4, padding: '3px 6px', color: C.text, fontSize: 11 }} />
            </div>
            <div>
              <div style={{ fontSize: 9, color: C.textDim, marginBottom: 3 }}>До</div>
              <input type='date' value={perEnd} onChange={e => setPerEnd(e.target.value)}
                style={{ background: C.cardHover, border: `1px solid ${C.border}`,
                         borderRadius: 4, padding: '3px 6px', color: C.text, fontSize: 11 }} />
            </div>
            <button onClick={() => setPerCalOpen(false)}
              style={{ alignSelf: 'flex-end', background: C.blue, color: '#fff',
                       border: 'none', borderRadius: 4, padding: '4px 10px',
                       fontSize: 11, cursor: 'pointer' }}>ОК</button>
          </div>
        ) : null}
      </div>

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 11, padding: 14 }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th onClick={() => handleSort('sku_wb')} style={th('left')}>
                  SKU WB{sortIcon('sku_wb')}</th>
                <th onClick={() => handleSort('name')} style={{ ...th('left'), minWidth: 180 }}>
                  Название{sortIcon('name')}</th>
                <th onClick={() => handleSort('status')} style={th()}>Статус{sortIcon('status')}</th>
                <th onClick={() => handleSort('abc_class')} style={th()}>ABC{sortIcon('abc_class')}</th>
                <th onClick={() => handleSort('dpd')} style={th()}>
                  Прод/{period}д{sortIcon('dpd')}</th>
                <th onClick={() => handleSort(`oos_${period}`)} style={th()}>
                  OOS{sortIcon(`oos_${period}`)}</th>
                <th onClick={() => handleSort('trend_14')} style={th()}>Тренд{sortIcon('trend_14')}</th>
                <th onClick={() => handleSort('total_stock')} style={th()}>Наличие{sortIcon('total_stock')}</th>
                <th onClick={() => handleSort('days_stock')} style={th()}>
                  Дней{sortIcon('days_stock')}</th>
                <th onClick={() => handleSort('log_pleche')} style={th()}>
                  Лог.п.{sortIcon('log_pleche')}</th>
                <th onClick={() => handleSort('order_calc')} style={th()}>
                  Расч.зак{sortIcon('order_calc')}</th>
                <th onClick={() => handleSort('order_mgr')} style={th()}>
                  Менедж.{sortIcon('order_mgr')}</th>
                <th onClick={() => handleSort('order_delta')} style={th()}>
                  Δ{sortIcon('order_delta')}</th>
                <th onClick={() => handleSort('margin_pct')} style={th()}>
                  Маржа{sortIcon('margin_pct')}</th>
              </tr>
            </thead>
            <tbody>
              {paginated.map(item => {
                const urg     = getUrgency(item)
                const isExp   = expanded === item.sku
                const urgCol  = urg === 'critical' ? C.red : urg === 'warning' ? C.yellow : 'transparent'
                const dpd     = getDpd(item)
                const oos     = period === 7 ? item.oos_7 : period === 14 ? item.oos_14 : item.oos_31

                return (
                  <Fragment key={item.sku}>
                    <tr
                      onClick={() => setExpanded(isExp ? null : item.sku)}
                      style={{
                        borderTop: 'none', borderRight: 'none',
                        borderBottom: `1px solid ${C.cardHover}`,
                        borderLeft: urg !== 'ok' && urg !== 'none'
                          ? `3px solid ${urgCol}` : `1px solid transparent`,
                        cursor: 'pointer', background: isExp ? C.cardHover : C.card,
                      }}
                    >
                      {/* SKU WB */}
                      <td style={{ ...td('left'), maxWidth: 110 }}>
                        <div style={{ fontSize: 12, color: C.blue, fontWeight: 700 }}>
                          {item.sku_wb || '—'}
                        </div>
                        <div style={{ fontSize: 9, color: C.textDim, fontFamily: 'monospace',
                                      overflow: 'hidden', textOverflow: 'ellipsis',
                                      whiteSpace: 'nowrap', maxWidth: 110 }} title={item.sku}>
                          {item.sku}
                        </div>
                      </td>

                      {/* Название */}
                      <td style={{ ...td('left'), maxWidth: 200 }}>
                        <div style={{ fontSize: 11, color: C.text, overflow: 'hidden',
                                      textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                      maxWidth: 200 }} title={item.name}>
                          {urg === 'critical' && <span style={{ marginRight: 3 }}>🚨</span>}
                          {urg === 'warning'  && <span style={{ marginRight: 3 }}>⚠️</span>}
                          {item.name || item.sku}
                        </div>
                        {item.pred && (
                          <div style={{ fontSize: 10, color: C.textDim, whiteSpace: 'nowrap',
                                        overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 200 }}>
                            {item.pred}
                          </div>
                        )}
                      </td>

                      {/* Статус */}
                      <td style={td()}>
                        <span style={{ fontSize: 10, fontWeight: 700,
                                       color: statusColor(item.status) }}>
                          {item.status || '—'}
                        </span>
                      </td>

                      {/* ABC */}
                      <td style={td()}>
                        <span style={{ color: abcColor(item.abc_class), fontWeight: 800, fontSize: 12 }}>
                          {item.abc_class || '—'}
                        </span>
                      </td>

                      {/* Продажи */}
                      <td style={td()}>
                        <div style={{ color: C.blue, fontWeight: 700 }}>
                          {fmt(dpd, 1)}
                        </div>
                        {oos > 0 && (
                          <div style={{ fontSize: 10, color: C.red }}>OOS {oos}д</div>
                        )}
                      </td>

                      {/* OOS */}
                      <td style={{ ...td(), color: oos > 7 ? C.red : oos > 3 ? C.yellow : C.green }}>
                        {oos + '/' + period}
                      </td>

                      {/* Тренд */}
                      <td style={td()}>
                        {item.trend_14 != null
                          ? <span style={{ fontSize: 10, fontWeight: 700,
                                           color: item.trend_14 > 0.05 ? C.green :
                                                  item.trend_14 < -0.05 ? C.red : C.textSec }}>
                              {item.trend_14 > 0 ? '↑' : '↓'} {(Math.abs(item.trend_14) * 100).toFixed(0)}%
                            </span>
                          : <span style={{ color: C.textDim }}>—</span>
                        }
                      </td>

                      {/* Наличие */}
                      <td style={td()}>
                        <div style={{ color: C.text, fontWeight: 700 }}>
                          {fmt(item.total_stock)}
                        </div>
                        {item.in_transit > 0 && (
                          <div style={{ fontSize: 10, color: C.teal }}>+{fmt(item.in_transit)}</div>
                        )}
                      </td>

                      {/* Дней запаса */}
                      <td style={{ ...td(), fontWeight: 700,
                                   color: daysColor(item.days_stock, item.log_pleche) }}>
                        {fmt(item.days_stock, 0)}
                      </td>

                      {/* Лог. плечо */}
                      <td style={{ ...td(), color: C.textMute, fontSize: 10 }}>
                        {item.log_pleche ?? '—'}д
                      </td>

                      {/* Расч. заказ — пересчёт при изменении горизонта */}
                      <td style={td()}>
                        {(() => {
                          const r = recalcOrder(item, filters.horizon)
                          return r.order > 0
                            ? <span style={{ color: C.blue, fontWeight: 800, fontSize: 12 }}>
                                {fmt(r.order)}
                              </span>
                            : <span style={{ color: C.textDim }}>—</span>
                        })()}
                      </td>

                      {/* Заказ менеджера */}
                      <td style={td()}>
                        {item.order_mgr != null && item.order_mgr > 0
                          ? <span style={{ color: C.purple, fontWeight: 700 }}>
                              {fmt(item.order_mgr)}
                            </span>
                          : <span style={{ color: C.textDim }}>—</span>
                        }
                      </td>

                      {/* Δ — пересчитываем с учётом нового горизонта */}
                      <td style={td()}>
                        {(() => {
                          const r = recalcOrder(item, filters.horizon)
                          const mgr = item.order_mgr
                          if (r.order > 0 && mgr != null && mgr > 0) {
                            const delta = r.order - mgr
                            return <span style={{ fontWeight: 700, fontSize: 10,
                                                  color: delta > 100 ? C.yellow :
                                                         delta < -100 ? C.red : C.green }}>
                              {delta > 0 ? '+' : ''}{fmt(delta)}
                            </span>
                          }
                          return <span style={{ color: C.textDim }}>—</span>
                        })()}
                      </td>

                      {/* Маржа */}
                      <td style={td()}>
                        {item.margin_pct != null
                          ? <span style={{ fontSize: 11, fontWeight: 600,
                                           color: item.margin_pct < 10 ? C.red :
                                                  item.margin_pct < 20 ? C.yellow : C.green }}>
                              {item.margin_pct.toFixed(1)}%
                            </span>
                          : <span style={{ color: C.textDim }}>—</span>
                        }
                      </td>
                    </tr>

                    {isExp && (
                      <tr>
                        <td colSpan={14} style={{ padding: '0 0 8px 0' }}>
                          <OrderCalcPanel item={item} period={period} horizon={filters.horizon} perStart={perStart} perEnd={perEnd} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}

              {paginated.length === 0 && (
                <tr>
                  <td colSpan={14} style={{ textAlign: 'center', padding: 40, color: C.textMute }}>
                    Нет данных по выбранным фильтрам
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div style={{ textAlign: 'center', padding: '10px 0 4px', color: C.textMute, fontSize: 12 }}>
          {filtered.length > PAGE_SIZE ? (
            <>
              <span style={{ marginRight: 10 }}>Стр. {curPage + '/' + totalPages}</span>
              {offset > 0 && (
                <button onClick={() => setOffset(o => o - PAGE_SIZE)}
                  style={{ background: C.card, border: `1px solid ${C.border}`,
                           color: C.textSec, padding: '4px 11px', borderRadius: 5,
                           cursor: 'pointer', marginRight: 6, fontSize: 12 }}>
                  ← Пред.
                </button>
              )}
              {offset + PAGE_SIZE < filtered.length && (
                <button onClick={() => setOffset(o => o + PAGE_SIZE)}
                  style={{ background: C.card, border: `1px solid ${C.border}`,
                           color: C.textSec, padding: '4px 11px', borderRadius: 5,
                           cursor: 'pointer', fontSize: 12 }}>
                  След. →
                </button>
              )}
            </>
          ) : (
            `Всего: ${filtered.length} SKU`
          )}
        </div>
      </div>
    </div>
  )
}
