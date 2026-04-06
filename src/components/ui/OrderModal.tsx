'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, TrendingUp, TrendingDown } from 'lucide-react'

interface OrderModalData {
  dim: {
    sku_ms: string; sku_wb: number; name: string; brand: string; supplier: string; manager: string
    lead_time_days: number
    month_jan: number | null; month_feb: number | null; month_mar: number | null; month_apr: number | null
    month_may: number | null; month_jun: number | null; month_jul: number | null; month_aug: number | null
    month_sep: number | null; month_oct: number | null; month_nov: number | null; month_dec: number | null
  } | null
  stock: {
    total: number; fbo: number; fbs_pushkino: number; fbs_smolensk: number
    in_transit: number; in_production: number; already_have: number; stock_days: number
  }
  sales: {
    qty7: number; qty14: number; qty31: number
    dpd7: number; dpd14: number; dpd31: number
    oos7: number; oos14: number; oos31: number; cv: number
  }
  china: Record<string, unknown> | null
  abc: { abc_class: string; abc_class2: string; chmd: number; chmd_clean: number; revenue: number; profitability: number; tz: number; turnover_days: number } | null
  order_calc: {
    dpd31: number; lead_time_days: number; horizon: number
    need: number; safety_days: number; safety_qty: number; to_order: number; cost_total: number
  }
}

function fmt(n: number | null | undefined, decimals = 0, suffix = '') {
  if (n == null) return '—'
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M' + suffix
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(decimals) + 'K' + suffix
  return n.toFixed(decimals) + suffix
}
function pct(n: number | null | undefined) {
  if (n == null) return '—'
  return (n * 100).toFixed(1) + '%'
}

function MetricRow({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b last:border-0" style={{ borderColor: 'var(--border)' }}>
      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span className="text-xs font-semibold" style={{ color: accent ? 'var(--accent)' : 'var(--text)' }}>{value}</span>
    </div>
  )
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl p-4 flex flex-col gap-0" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <h3 className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>{title}</h3>
      {children}
    </div>
  )
}

const MONTHS = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек']
const MONTH_KEYS = ['month_jan','month_feb','month_mar','month_apr','month_may','month_jun','month_jul','month_aug','month_sep','month_oct','month_nov','month_dec'] as const

interface Props {
  skuMs: string | null
  onClose: () => void
}

export function OrderModal({ skuMs, onClose }: Props) {
  const [data, setData] = useState<OrderModalData | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!skuMs) return
    setLoading(true)
    setData(null)
    fetch(`/api/order-modal?sku_ms=${encodeURIComponent(skuMs)}`)
      .then(r => r.json())
      .then(d => setData(d))
      .finally(() => setLoading(false))
  }, [skuMs])

  const monthValues = data?.dim ? MONTH_KEYS.map(k => data.dim![k] ?? 0) : []
  const maxMonth = monthValues.length ? Math.max(...monthValues, 1) : 1

  return (
    <AnimatePresence>
      {skuMs && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[300] bg-black/40"
            style={{ backdropFilter: 'blur(6px)' }}
            onClick={onClose}
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="fixed inset-4 md:inset-8 lg:inset-12 z-[301] flex flex-col overflow-hidden glass"
            style={{ borderRadius: 'var(--radius-xl)', maxWidth: 860, margin: 'auto' }}
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
              <div className="flex-1 min-w-0">
                {loading ? (
                  <div className="h-5 w-48 rounded animate-pulse" style={{ background: 'var(--border)' }} />
                ) : (
                  <>
                    <div className="font-bold text-base" style={{ color: 'var(--text)' }}>{data?.dim?.name ?? skuMs}</div>
                    <div className="flex gap-3 mt-0.5">
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>SKU: {data?.dim?.sku_wb ?? skuMs}</span>
                      {data?.dim?.supplier && <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{data.dim.supplier}</span>}
                      {data?.dim?.manager && <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{data.dim.manager}</span>}
                    </div>
                  </>
                )}
              </div>
              <button onClick={onClose} className="p-1.5 rounded-lg ml-3" style={{ color: 'var(--text-muted)' }}>
                <X size={18} />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {loading && (
                <div className="flex items-center justify-center h-40">
                  <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: 'var(--accent)' }} />
                </div>
              )}

              {!loading && data && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

                  {/* Block 1: Остатки */}
                  <Block title="Остатки">
                    <MetricRow label="FBO WB" value={String(data.stock.fbo)} />
                    <MetricRow label="FBS Пушкино" value={String(data.stock.fbs_pushkino)} />
                    <MetricRow label="FBS Смоленск" value={String(data.stock.fbs_smolensk)} />
                    <MetricRow label="В пути (Китай)" value={String(data.stock.in_transit)} />
                    <MetricRow label="В производстве" value={String(data.stock.in_production)} />
                    <div className="mt-2 pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
                      <MetricRow label="Итого в наличии" value={String(data.stock.total) + ' шт'} accent />
                      <MetricRow label="Всего (с учётом заказов)" value={String(data.stock.already_have) + ' шт'} accent />
                      <MetricRow label="Запас дней" value={data.stock.stock_days === 999 ? 'нет продаж' : data.stock.stock_days + ' дн'} />
                    </div>
                  </Block>

                  {/* Block 2: Продажи */}
                  <Block title="Продажи (факт)">
                    <div className="grid grid-cols-4 gap-1 mb-2">
                      {(['Период', '7 дн', '14 дн', '31 дн'] as string[]).map(h => (
                        <span key={h} className="text-[10px] font-medium text-center" style={{ color: 'var(--text-muted)' }}>{h}</span>
                      ))}
                      {(['Штук', String(data.sales.qty7), String(data.sales.qty14), String(data.sales.qty31)] as string[]).map((v, i) => (
                        <span key={i} className="text-xs font-semibold text-center" style={{ color: i === 0 ? 'var(--text-muted)' : 'var(--text)' }}>{v}</span>
                      ))}
                      {(['ДПД', data.sales.dpd7.toFixed(1), data.sales.dpd14.toFixed(1), data.sales.dpd31.toFixed(1)] as string[]).map((v, i) => (
                        <span key={i} className="text-xs text-center" style={{ color: i === 0 ? 'var(--text-muted)' : 'var(--text)' }}>{v}</span>
                      ))}
                      {(['OOS дн', String(data.sales.oos7), String(data.sales.oos14), String(data.sales.oos31)] as string[]).map((v, i) => (
                        <span key={i} className="text-xs text-center" style={{ color: i === 0 ? 'var(--text-muted)' : (parseInt(v) > 0 ? '#EF4444' : 'var(--text)') }}>{v}</span>
                      ))}
                    </div>
                    <div className="mt-1 pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
                      <MetricRow label="CV (вариация спроса)" value={pct(data.sales.cv)} />
                    </div>
                  </Block>

                  {/* Block 3: Расчёт заказа */}
                  <Block title="Расчёт заказа">
                    <MetricRow label="ДПД (31 дн)" value={data.order_calc.dpd31.toFixed(2)} />
                    <MetricRow label="Лог. плечо" value={data.order_calc.lead_time_days + ' дн'} />
                    <MetricRow label="Горизонт заказа" value={data.order_calc.horizon + ' дн'} />
                    <MetricRow label="Потребность" value={data.order_calc.need + ' шт'} />
                    <MetricRow label="Страховой запас (дн)" value={data.order_calc.safety_days + ' дн'} />
                    <MetricRow label="Страховой запас (шт)" value={data.order_calc.safety_qty + ' шт'} />
                    <div className="mt-2 pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
                      <MetricRow label="Уже есть (all)" value={String(data.stock.already_have) + ' шт'} />
                      <div className="flex items-center justify-between py-2">
                        <span className="text-sm font-bold" style={{ color: 'var(--text)' }}>К заказу</span>
                        <span className="text-lg font-black" style={{ color: data.order_calc.to_order > 0 ? 'var(--accent)' : '#10B981' }}>
                          {data.order_calc.to_order > 0 ? data.order_calc.to_order + ' шт' : 'Нет необходимости'}
                        </span>
                      </div>
                      {data.order_calc.cost_total > 0 && (
                        <MetricRow label="Стоимость заказа" value={fmt(data.order_calc.cost_total, 0, ' ₽')} accent />
                      )}
                    </div>
                    <div className="mt-2 p-2 rounded-lg text-[10px]" style={{ background: 'var(--bg)', color: 'var(--text-muted)' }}>
                      Формула: (ДПД × горизонт) + страховой запас − уже есть
                    </div>
                  </Block>

                  {/* Block 4: ABC + Сезонность */}
                  <Block title="ABC и сезонность">
                    {data.abc && (
                      <div className="mb-3">
                        <div className="flex gap-2 mb-2">
                          <span className="px-2 py-0.5 rounded-full text-xs font-bold" style={{ background: 'var(--accent-glass)', color: 'var(--accent)' }}>
                            {data.abc.abc_class}
                          </span>
                          {data.abc.abc_class2 && (
                            <span className="px-2 py-0.5 rounded-full text-xs font-medium" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                              {data.abc.abc_class2}
                            </span>
                          )}
                        </div>
                        <MetricRow label="ЧМД чистый" value={fmt(data.abc.chmd_clean, 0, ' ₽')} />
                        <MetricRow label="Рентабельность" value={pct(data.abc.profitability)} />
                        <MetricRow label="ТЗ" value={fmt(data.abc.tz, 0, ' ₽')} />
                        <MetricRow label="Оборачиваемость" value={Math.round(data.abc.turnover_days) + ' дн'} />
                      </div>
                    )}
                    {/* Сезонность */}
                    {monthValues.some(v => v > 0) && (
                      <div>
                        <div className="text-[10px] font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Сезонность (план продаж / мес)</div>
                        <div className="flex items-end gap-1 h-16">
                          {monthValues.map((v, i) => (
                            <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                              <div
                                className="w-full rounded-sm"
                                style={{
                                  height: Math.max(2, Math.round((v / maxMonth) * 48)),
                                  background: v > 0 ? 'var(--accent)' : 'var(--border)',
                                  opacity: v > 0 ? 0.7 : 0.3,
                                }}
                              />
                              <span className="text-[8px]" style={{ color: 'var(--text-muted)' }}>{MONTHS[i]}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </Block>

                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
