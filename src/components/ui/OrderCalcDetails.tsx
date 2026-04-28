'use client'

import { fmtFull, fmtPct } from '@/lib/formatters'

export interface OrderRowDetails {
  // ШАГ 1
  sales_qty_7d: number; sales_qty_14d: number; sales_qty_31d: number
  base_31d: number
  // ШАГ 2
  cur_coef: number; avg_year_coef: number; base_norm: number
  used_yoy_fallback: boolean; yoy_base_norm: number | null
  // ШАГ 3
  horizon_months: Array<{ month: string; coef: number | null }>
  target_coef: number; demand_qty: number
  horizon_days: number
  // ШАГ 4
  sigma_31d: number; cv: number; safety_days: number; safety_qty: number
  lead_time_days: number
  // ШАГ 5
  total_stock: number; fbo_wb: number; fbs_pushkino: number; fbs_smolensk: number; kits_stock: number
  in_transit: number; in_production: number; on_hand_total: number
  // ШАГ 6
  calc_order: number
  // Флаги
  is_new: boolean; low_data: boolean
}

function Row({ label, value, accent, muted }: { label: string; value: string; accent?: boolean; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1 text-xs" style={{ borderBottom: '1px dashed var(--border-subtle)' }}>
      <span style={{ color: muted ? 'var(--text-subtle)' : 'var(--text-muted)' }}>{label}</span>
      <span className="font-mono font-semibold" style={{ color: accent ? 'var(--accent)' : 'var(--text)' }}>{value}</span>
    </div>
  )
}

function Section({ step, title, color, children }: { step: number; title: string; color: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold" style={{ background: color, color: '#fff' }}>ШАГ {step}</span>
        <span className="text-xs font-semibold" style={{ color: 'var(--text)' }}>{title}</span>
      </div>
      <div className="pl-1">{children}</div>
    </div>
  )
}

export function OrderCalcDetails({ row }: { row: OrderRowDetails }) {
  const fmt = (n: number, dec = 2) => Number(n).toFixed(dec).replace(/\.?0+$/, '') || '0'
  const fmtInt = (n: number) => fmtFull(n)

  return (
    <div className="p-4 space-y-3" style={{ background: 'var(--surface-2)', borderRadius: 'var(--radius-md)' }}>
      {(row.is_new || row.low_data || row.used_yoy_fallback) && (
        <div className="flex gap-2 flex-wrap">
          {row.is_new && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ background: 'var(--info-bg)', color: 'var(--info)' }}>
              Новый SKU (&lt;14 дней истории)
            </span>
          )}
          {row.low_data && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ background: 'var(--warning-bg)', color: 'var(--warning)' }}>
              Мало данных (&lt;10 ненулевых дней) → CV=1.0
            </span>
          )}
          {row.used_yoy_fallback && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
              YoY-fallback использован
            </span>
          )}
        </div>
      )}
      <div className="grid grid-cols-3 gap-x-6 gap-y-3">
        <Section step={1} title="Базовые продажи/день" color="var(--accent)">
          <Row label="Продажи 7д (шт)"  value={fmtInt(row.sales_qty_7d)} />
          <Row label="Продажи 14д (шт)" value={fmtInt(row.sales_qty_14d)} />
          <Row label="Продажи 31д (шт)" value={fmtInt(row.sales_qty_31d)} />
          <Row label="base_31d (шт/день)" value={fmt(row.base_31d, 2)} accent />
        </Section>

        <Section step={2} title="Очистка от сезонности" color="var(--info)">
          <Row label="Коэф. текущего месяца" value={fmt(row.cur_coef, 2)} />
          <Row label="Средн. коэф. по году"  value={fmt(row.avg_year_coef, 2)} />
          <Row label="base_norm (нормализ.)" value={fmt(row.base_norm, 2)} accent />
          {row.used_yoy_fallback && row.yoy_base_norm != null && (
            <Row label="YoY base_norm" value={fmt(row.yoy_base_norm, 2)} muted />
          )}
        </Section>

        <Section step={3} title="Потребность на горизонт" color="var(--success)">
          <Row label="Горизонт (дней)" value={String(row.horizon_days)} />
          <Row label="Месяцы горизонта" value={row.horizon_months.map(h => h.month).join(', ')} muted />
          <Row label="target_coef (отн.)" value={fmt(row.target_coef, 3)} />
          <Row label="Потребность (шт)" value={fmtInt(row.demand_qty)} accent />
        </Section>

        <Section step={4} title="Страховой запас" color="var(--warning)">
          <Row label="σ (станд. откл.)" value={fmt(row.sigma_31d, 2)} />
          <Row label="CV (вариация)" value={fmt(row.cv, 3)} />
          <Row label="Лог. плечо (дн)" value={String(row.lead_time_days)} />
          <Row label="Страх. дни = √плечо × CV" value={fmt(row.safety_days, 1)} />
          <Row label="Страх. запас (шт)" value={fmtInt(row.safety_qty)} accent />
        </Section>

        <Section step={5} title="Что уже есть" color="var(--text-subtle)">
          <Row label="FBO WB" value={fmtInt(row.fbo_wb)} />
          <Row label="FBS Пушкино" value={fmtInt(row.fbs_pushkino)} />
          <Row label="FBS Смоленск" value={fmtInt(row.fbs_smolensk)} />
          <Row label="МС склад (комплекты)" value={fmtInt(row.kits_stock)} />
          <Row label="В пути" value={fmtInt(row.in_transit)} />
          <Row label="В производстве" value={fmtInt(row.in_production)} />
          <Row label="ИТОГО в наличии" value={fmtInt(row.on_hand_total)} accent />
        </Section>

        <Section step={6} title="Итог: к заказу" color="var(--danger)">
          <Row label="Потребность"        value={fmtInt(row.demand_qty)} muted />
          <Row label="+ страх. запас"     value={fmtInt(row.safety_qty)} muted />
          <Row label="− в наличии"        value={fmtInt(row.on_hand_total)} muted />
          <div className="mt-2 pt-2 flex items-center justify-between" style={{ borderTop: '2px solid var(--border)' }}>
            <span className="text-xs font-bold" style={{ color: 'var(--text)' }}>К ЗАКАЗУ</span>
            <span className="text-base font-black font-mono" style={{ color: row.calc_order > 0 ? 'var(--danger)' : 'var(--success)' }}>
              {fmtInt(row.calc_order)} шт
            </span>
          </div>
        </Section>
      </div>
    </div>
  )
}

void fmtPct
