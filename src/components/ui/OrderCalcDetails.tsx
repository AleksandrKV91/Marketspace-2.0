'use client'

import { fmtFull, fmtPct } from '@/lib/formatters'

export interface OrderRowDetails {
  // ШАГ 1
  sales_qty_7d: number; sales_qty_14d: number; sales_qty_31d: number; sales_qty_90d?: number
  base_31d: number; base_90d?: number
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
  // Менеджер vs расчёт
  manager_order?: number; svod_order_qty?: number
  // Ближайший приход
  nearest_arrival?: string | null
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

  const managerQty = row.svod_order_qty ?? row.manager_order ?? 0
  const deltaOrder = row.calc_order - managerQty

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
          {row.sales_qty_90d != null && (
            <Row label="Продажи 90д (шт)" value={fmtInt(row.sales_qty_90d)} muted />
          )}
          <Row label="velocity 31д (шт/день)" value={fmt(row.base_31d, 2)} />
          {row.base_90d != null && (
            <Row label="velocity 90д (шт/день)" value={fmt(row.base_90d, 2)} muted />
          )}
          <Row label="Используется (шт/день)" value={fmt(row.base_31d, 2)} accent />
        </Section>

        <Section step={2} title="Очистка от сезонности" color="var(--info)">
          <Row label="Коэф. текущего месяца" value={fmt(row.cur_coef, 2)} />
          <Row label="Средн. коэф. по году"  value={fmt(row.avg_year_coef, 2)} />
          <Row label={`base_norm = velocity / коэф = ${fmt(row.base_norm * row.cur_coef, 2)} / ${fmt(row.cur_coef, 2)}`} value={fmt(row.base_norm, 2)} accent />
          {row.used_yoy_fallback && row.yoy_base_norm != null && (
            <Row label="YoY base_norm" value={fmt(row.yoy_base_norm, 2)} muted />
          )}
        </Section>

        <Section step={3} title="Потребность на горизонт" color="var(--success)">
          <Row label="Горизонт (дней)" value={String(row.horizon_days)} />
          <div className="py-0.5 text-[10px]" style={{ color: 'var(--text-subtle)' }}>
            <table className="w-full">
              <tbody>
                {row.horizon_months.map(h => (
                  <tr key={h.month}>
                    <td style={{ color: 'var(--text-muted)' }}>{h.month}</td>
                    <td className="text-right font-mono">{h.coef != null ? fmt(h.coef, 2) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Row label="target_coef (отн.)" value={fmt(row.target_coef, 3)} />
          <Row label={`Потребность = ${fmt(row.base_norm, 2)} × ${fmt(row.target_coef, 3)} × ${row.horizon_days}`} value={fmtInt(row.demand_qty)} accent />
        </Section>

        <Section step={4} title="Страховой запас" color="var(--warning)">
          <Row label="σ (станд. откл. 31д)" value={fmt(row.sigma_31d, 2)} />
          <Row label="CV = σ / velocity (вариация спроса)" value={fmt(row.cv, 3)} />
          <Row label={`Лог. плечо (${row.lead_time_days === 45 ? 'фоллбэк 45д' : 'из Зеленка'})`} value={String(row.lead_time_days) + ' дн'} />
          <Row label={`Страх. дни = √${row.lead_time_days} × ${fmt(row.cv, 2)}`} value={fmt(row.safety_days, 1) + ' дн'} />
          <Row label={`Страх. запас = base_norm × coef × страх.дни`} value={fmtInt(row.safety_qty) + ' шт'} accent />
        </Section>

        <Section step={5} title="Что уже есть" color="var(--text-subtle)">
          <Row label="FBO WB" value={fmtInt(row.fbo_wb)} />
          <Row label="FBS Пушкино" value={fmtInt(row.fbs_pushkino)} />
          <Row label="FBS Смоленск" value={fmtInt(row.fbs_smolensk)} />
          <Row label="МС склад (комплекты)" value={fmtInt(row.kits_stock)} />
          <Row label="В пути" value={fmtInt(row.in_transit)} />
          <Row label="В производстве" value={fmtInt(row.in_production)} />
          <Row label="ИТОГО в наличии" value={fmtInt(row.on_hand_total) + ' шт'} accent />
          {row.nearest_arrival && (
            <Row label="Ближайший приход" value={row.nearest_arrival} muted />
          )}
        </Section>

        <Section step={6} title="Итог: к заказу" color="var(--danger)">
          <Row label="Потребность"        value={fmtInt(row.demand_qty) + ' шт'} muted />
          <Row label="+ страх. запас"     value={fmtInt(row.safety_qty) + ' шт'} muted />
          <Row label="− в наличии"        value={fmtInt(row.on_hand_total) + ' шт'} muted />
          <div className="mt-1 py-1 text-[10px]" style={{ color: 'var(--text-subtle)', borderBottom: '1px dashed var(--border-subtle)' }}>
            max(0, {fmtInt(row.demand_qty)} + {fmtInt(row.safety_qty)} − {fmtInt(row.on_hand_total)}) = {fmtInt(row.calc_order)}
          </div>
          <div className="mt-2 pt-2 flex items-center justify-between" style={{ borderTop: '2px solid var(--border)' }}>
            <span className="text-xs font-bold" style={{ color: 'var(--text)' }}>К ЗАКАЗУ (расч.)</span>
            <span className="text-base font-black font-mono" style={{ color: row.calc_order > 0 ? 'var(--danger)' : 'var(--success)' }}>
              {fmtInt(row.calc_order)} шт
            </span>
          </div>
          {managerQty > 0 && (
            <div className="mt-2 pt-2 space-y-1" style={{ borderTop: '1px dashed var(--border-subtle)' }}>
              <Row label="Заказ менеджера (СВОД)" value={fmtInt(managerQty) + ' шт'} />
              <Row
                label={deltaOrder > 0 ? 'Расчёт больше СВОД на' : deltaOrder < 0 ? 'СВОД больше расчёта на' : 'Совпадает'}
                value={deltaOrder !== 0 ? fmtInt(Math.abs(deltaOrder)) + ' шт' : '✓'}
                accent={deltaOrder > 0}
              />
            </div>
          )}
        </Section>
      </div>
    </div>
  )
}

void fmtPct
