// SKU Score 0–100
// 5 компонентов: margin(30) + drr(20) + growth(15) + cr(15) + stock(20)
// Penalties variant 2: OOS→return 0; DRR>Margin→×0.5; novelty_low→−10

export interface ScoreParams {
  margin_pct:     number   // доля, напр. 0.18 = 18%
  drr:            number   // доля, напр. 0.12 = 12%
  revenue_growth: number   // доля к пред. периоду, напр. 0.25 = +25%
  cr_order:       number   // коэф. конверсии, напр. 0.03 = 3%
  median_cr?:     number   // медианный CR по аккаунту (для нормировки)
  stock_days:     number   // дней остатка
  lead_time_days?: number  // логистическое плечо (дней)
  is_oos:         boolean
  drr_over_margin: boolean // drr > margin_pct
  is_novelty_low:  boolean // новинка + выручка < 10 000 ₽
}

export function computeScore(p: ScoreParams): number {
  // ── Penalty 1: OOS → 0 ────────────────────────────────────────────────────
  if (p.is_oos) return 0

  // ── Margin score ──────────────────────────────────────────────────────────
  // < 0 или 0–10% → 0; 10–15% → линейно 0→0.5; ≥ 15% → 1.0
  let marginNorm: number
  if (p.margin_pct < 0.10) {
    marginNorm = 0
  } else if (p.margin_pct < 0.15) {
    marginNorm = (p.margin_pct - 0.10) / 0.05 * 0.5   // 0 → 0.5
  } else {
    marginNorm = Math.min(1.0, 0.5 + (p.margin_pct - 0.15) / 0.15 * 0.5) // 0.5 → 1.0
  }
  const marginScore = marginNorm * 30

  // ── DRR score ─────────────────────────────────────────────────────────────
  // drr_score = clamp(1 − DRR / Margin%, 0, 1) × 20
  // Нет рекламы (drr=0) → 1.0 (максимум)
  let drrNorm: number
  if (p.margin_pct <= 0) {
    drrNorm = 0
  } else if (p.drr <= 0) {
    drrNorm = 1.0
  } else {
    drrNorm = Math.max(0, 1 - p.drr / p.margin_pct)
  }
  const drrScore = drrNorm * 20

  // ── Growth score ──────────────────────────────────────────────────────────
  // sigmoid(growth): neutral=7.5 при growth=0; +30%→≈12; −30%→≈3
  // Используем sigmoid с k=4: f(x) = 1/(1+e^(−k×x)) — диапазон (0,1)
  // При growth=0: f=0.5 → ×15 = 7.5 (нейтральный)
  const growthNorm = 1 / (1 + Math.exp(-4 * p.revenue_growth))
  const growthScore = growthNorm * 15

  // ── CR score ─────────────────────────────────────────────────────────────
  // Нормируем на median_cr аккаунта или на 0.05 (5%) если нет медианы
  // cr_score = min(cr / ref_cr, 1) × 15
  const refCr = (p.median_cr && p.median_cr > 0) ? p.median_cr : 0.05
  const crNorm = Math.min(p.cr_order / refCr, 1)
  const crScore = crNorm * 15

  // ── Stock score ───────────────────────────────────────────────────────────
  // OOS → 0 (уже отработано выше)
  // = lead_time → 0.5 × 20 = 10; ≥ 2 × lead_time → 1.0 × 20 = 20
  const lt = (p.lead_time_days && p.lead_time_days > 0) ? p.lead_time_days : 30
  let stockNorm: number
  if (p.stock_days <= 0) {
    stockNorm = 0
  } else if (p.stock_days < lt) {
    stockNorm = (p.stock_days / lt) * 0.5   // 0 → 0.5
  } else if (p.stock_days < 2 * lt) {
    stockNorm = 0.5 + ((p.stock_days - lt) / lt) * 0.5  // 0.5 → 1.0
  } else {
    stockNorm = 1.0
  }
  const stockScore = stockNorm * 20

  // ── Итоговый балл ─────────────────────────────────────────────────────────
  let score = marginScore + drrScore + growthScore + crScore + stockScore

  // ── Penalty 2: DRR > Margin → ×0.5 ──────────────────────────────────────
  if (p.drr_over_margin) score *= 0.5

  // ── Penalty 3: Новинка с низкой выручкой → −10 ───────────────────────────
  if (p.is_novelty_low) score -= 10

  return Math.round(Math.max(0, Math.min(100, score)))
}
