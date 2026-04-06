'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, TrendingUp, TrendingDown, Download, Save, Package, BarChart2 } from 'lucide-react'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts'

// ── Types ────────────────────────────────────────────────────────────────────

interface SkuModalData {
  dim: { sku_ms: string; sku_wb: number; name: string; brand: string; category_wb: string; manager: string } | null
  snap: Record<string, unknown> | null
  stock_snap: { fbo_wb: number; fbs_pushkino: number; fbs_smolensk: number; total_stock: number; supply_date: string; supply_qty: number; price: number; margin_pct: number } | null
  abc: { abc_class: string; abc_class2: string; chmd: number; chmd_clean: number; revenue: number; profitability: number; tz: number; turnover_days: number } | null
  daily: Array<{ metric_date: string; revenue: number; ad_spend: number; drr_total: number; ctr: number; cr_cart: number; cr_order: number; cpm: number; cpc: number }>
  price_changes: Array<{ price_date: string; price: number }>
  note: string
  aggregates: { revenue: number; ad_spend: number; drr: number | null; avg_ctr: number | null; avg_cr_cart: number | null; avg_cr_order: number | null; avg_cpm: number | null; avg_cpc: number | null }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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
function fmtDate(iso: string) {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y}`
}

// ── Metric card ───────────────────────────────────────────────────────────────

function MetricCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl p-3 flex flex-col gap-0.5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <span className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span className="text-base font-bold" style={{ color: 'var(--text)' }}>{value}</span>
      {sub && <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{sub}</span>}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  skuMs: string | null
  onClose: () => void
}

export function SkuModal({ skuMs, onClose }: Props) {
  const [data, setData] = useState<SkuModalData | null>(null)
  const [loading, setLoading] = useState(false)
  const [note, setNote] = useState('')
  const [noteSaving, setNoteSaving] = useState(false)

  useEffect(() => {
    if (!skuMs) return
    setLoading(true)
    setData(null)
    fetch(`/api/sku-modal?sku_ms=${encodeURIComponent(skuMs)}`)
      .then(r => r.json())
      .then(d => { setData(d); setNote(d.note ?? '') })
      .finally(() => setLoading(false))
  }, [skuMs])

  const saveNote = async () => {
    if (!skuMs) return
    setNoteSaving(true)
    await fetch('/api/sku-notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sku_ms: skuMs, note }) })
    setNoteSaving(false)
  }

  const oos = data?.snap ? (data.snap as Record<string, unknown>).stock_days === 0 || (data.stock_snap?.total_stock ?? 0) === 0 : false
  const drrBad = data?.aggregates?.drr != null && data?.abc?.profitability != null && data.aggregates.drr > data.abc.profitability

  return (
    <AnimatePresence>
      {skuMs && (
        <>
          {/* Overlay */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[300] bg-black/40"
            style={{ backdropFilter: 'blur(6px)' }}
            onClick={onClose}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="fixed inset-4 md:inset-8 lg:inset-12 z-[301] flex flex-col overflow-hidden glass"
            style={{ borderRadius: 'var(--radius-xl)', maxWidth: 900, margin: 'auto' }}
            onClick={e => e.stopPropagation()}
          >
            {/* ── Header ── */}
            <div className="flex items-start justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
              <div className="flex-1 min-w-0">
                {loading ? (
                  <div className="h-5 w-48 rounded animate-pulse" style={{ background: 'var(--border)' }} />
                ) : (
                  <>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-base" style={{ color: 'var(--text)' }}>{data?.dim?.name ?? skuMs}</span>
                      {oos && <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-500/20 text-red-400">OOS</span>}
                      {drrBad && <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-orange-500/20 text-orange-400">ДРР &gt; Маржа</span>}
                    </div>
                    <div className="flex gap-3 mt-0.5">
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>SKU: {data?.dim?.sku_wb ?? skuMs}</span>
                      {data?.dim?.category_wb && <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{data.dim.category_wb}</span>}
                      {data?.dim?.manager && <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{data.dim.manager}</span>}
                    </div>
                  </>
                )}
              </div>
              <button onClick={onClose} className="p-1.5 rounded-lg transition-colors ml-3" style={{ color: 'var(--text-muted)' }}>
                <X size={18} />
              </button>
            </div>

            {/* ── Scrollable body ── */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
              {loading && (
                <div className="flex items-center justify-center h-40">
                  <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: 'var(--accent)' }} />
                </div>
              )}

              {!loading && data && (
                <>
                  {/* ── Ряд 1: Цена | Маржа | ЧМД | Расходы ── */}
                  <section>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <MetricCard label="Цена" value={data.stock_snap?.price != null ? fmt(data.stock_snap.price, 0, ' ₽') : '—'} />
                      <MetricCard label="Маржа %" value={data.stock_snap?.margin_pct != null ? pct(data.stock_snap.margin_pct) : data.abc?.profitability != null ? pct(data.abc.profitability) : '—'} />
                      <MetricCard label="ЧМД" value={fmt(data.abc?.chmd_clean ?? data.abc?.chmd, 0, ' ₽')} />
                      <MetricCard label="Расходы рекл." value={fmt(data.aggregates.ad_spend, 0, ' ₽')} />
                    </div>
                  </section>

                  {/* ── Ряд 2: Выручка | ДРР факт | ДРР рекл ── */}
                  <section>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      <MetricCard label="Выручка (период)" value={fmt(data.aggregates.revenue, 0, ' ₽')} />
                      <MetricCard label="ДРР факт" value={pct(data.aggregates.drr)} />
                      <MetricCard label="ABC класс" value={data.abc?.abc_class ?? '—'} sub={data.abc?.abc_class2 ? 'выр/об: ' + data.abc.abc_class2 : undefined} />
                    </div>
                  </section>

                  {/* ── Конверсии ── */}
                  <section>
                    <h3 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--text-muted)' }}>Воронка и реклама</h3>
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                      <MetricCard label="CTR" value={pct(data.aggregates.avg_ctr)} />
                      <MetricCard label="CR корзина" value={pct(data.aggregates.avg_cr_cart)} />
                      <MetricCard label="CR заказ" value={pct(data.aggregates.avg_cr_order)} />
                      <MetricCard label="CPM" value={fmt(data.aggregates.avg_cpm, 0, ' ₽')} />
                      <MetricCard label="CPC" value={fmt(data.aggregates.avg_cpc, 0, ' ₽')} />
                    </div>
                  </section>

                  {/* ── Логистика ── */}
                  <section>
                    <h3 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--text-muted)' }}>Логистика и остатки</h3>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <MetricCard label="Остаток всего" value={String(data.stock_snap?.total_stock ?? '—')} />
                      <MetricCard label="FBO WB" value={String(data.stock_snap?.fbo_wb ?? '—')} />
                      <MetricCard label="FBS Пушкино" value={String(data.stock_snap?.fbs_pushkino ?? '—')} />
                      <MetricCard label="FBS Смоленск" value={String(data.stock_snap?.fbs_smolensk ?? '—')} />
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2">
                      <MetricCard label="Дата поставки" value={fmtDate(data.stock_snap?.supply_date ?? '')} />
                      <MetricCard label="Объём поставки" value={data.stock_snap?.supply_qty != null ? String(data.stock_snap.supply_qty) + ' шт' : '—'} />
                      <MetricCard label="Оборачиваемость" value={data.abc?.turnover_days != null ? String(Math.round(data.abc.turnover_days)) + ' дн' : '—'} />
                    </div>
                  </section>

                  {/* ── График выручки + расходов ── */}
                  {data.daily.length > 0 && (
                    <section>
                      <h3 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--text-muted)' }}>Выручка и расходы (30 дней)</h3>
                      <div style={{ height: 180 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <ComposedChart data={data.daily} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                            <XAxis dataKey="metric_date" tick={{ fontSize: 10 }} tickFormatter={v => v.slice(5)} />
                            <YAxis tick={{ fontSize: 10 }} tickFormatter={v => fmt(v, 0)} width={48} />
                            <Tooltip formatter={(v) => fmt(v as number, 0, ' ₽')} />
                            <Bar dataKey="revenue" name="Выручка" fill="#3B82F6" opacity={0.7} radius={[2, 2, 0, 0]} />
                            <Line dataKey="ad_spend" name="Расходы" stroke="#EF4444" strokeWidth={2} dot={false} />
                          </ComposedChart>
                        </ResponsiveContainer>
                      </div>
                    </section>
                  )}

                  {/* ── График CTR/CR ── */}
                  {data.daily.some(d => d.ctr != null) && (
                    <section>
                      <h3 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--text-muted)' }}>CTR и CR (30 дней)</h3>
                      <div style={{ height: 160 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <ComposedChart data={data.daily} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                            <XAxis dataKey="metric_date" tick={{ fontSize: 10 }} tickFormatter={v => v.slice(5)} />
                            <YAxis tick={{ fontSize: 10 }} tickFormatter={v => (v * 100).toFixed(1) + '%'} width={48} />
                            <Tooltip formatter={(v) => ((v as number) * 100).toFixed(2) + '%'} />
                            <Line dataKey="ctr" name="CTR" stroke="#8B5CF6" strokeWidth={2} dot={false} />
                            <Line dataKey="cr_cart" name="CR корзина" stroke="#10B981" strokeWidth={2} dot={false} />
                            <Line dataKey="cr_order" name="CR заказ" stroke="#F59E0B" strokeWidth={2} dot={false} />
                          </ComposedChart>
                        </ResponsiveContainer>
                      </div>
                    </section>
                  )}

                  {/* ── Изменения цен ── */}
                  {data.price_changes.length > 0 && (
                    <section>
                      <h3 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--text-muted)' }}>Изменения цен</h3>
                      <div className="rounded-xl overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
                        <table className="w-full text-xs">
                          <thead>
                            <tr style={{ background: 'var(--surface)' }}>
                              <th className="px-3 py-2 text-left font-medium" style={{ color: 'var(--text-muted)' }}>Дата</th>
                              <th className="px-3 py-2 text-right font-medium" style={{ color: 'var(--text-muted)' }}>Цена</th>
                              <th className="px-3 py-2 text-right font-medium" style={{ color: 'var(--text-muted)' }}>Δ</th>
                            </tr>
                          </thead>
                          <tbody>
                            {data.price_changes.map((pc, i) => {
                              const prev = data.price_changes[i + 1]
                              const delta = prev ? pc.price - prev.price : null
                              return (
                                <tr key={pc.price_date} style={{ borderTop: '1px solid var(--border)' }}>
                                  <td className="px-3 py-2" style={{ color: 'var(--text)' }}>{fmtDate(pc.price_date)}</td>
                                  <td className="px-3 py-2 text-right font-medium" style={{ color: 'var(--text)' }}>{fmt(pc.price, 0, ' ₽')}</td>
                                  <td className="px-3 py-2 text-right">
                                    {delta != null ? (
                                      <span style={{ color: delta > 0 ? '#10B981' : delta < 0 ? '#EF4444' : 'var(--text-muted)' }}>
                                        {delta > 0 ? '+' : ''}{fmt(delta, 0, ' ₽')}
                                      </span>
                                    ) : '—'}
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  )}

                  {/* ── Заметка ── */}
                  <section>
                    <h3 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--text-muted)' }}>Заметка</h3>
                    <textarea
                      value={note}
                      onChange={e => setNote(e.target.value)}
                      rows={3}
                      placeholder="Введите заметку по SKU..."
                      className="w-full rounded-xl px-3 py-2 text-sm resize-none outline-none"
                      style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)' }}
                    />
                  </section>
                </>
              )}
            </div>

            {/* ── Footer ── */}
            <div className="flex items-center justify-between px-5 py-3 border-t gap-3" style={{ borderColor: 'var(--border)' }}>
              <button
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all"
                style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
              >
                <Download size={13} /> Excel
              </button>
              <button
                onClick={saveNote}
                disabled={noteSaving}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-xs font-semibold"
                style={{ background: 'var(--accent)', color: 'white', opacity: noteSaving ? 0.7 : 1 }}
              >
                <Save size={13} /> {noteSaving ? 'Сохранение...' : 'Сохранить заметку'}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
