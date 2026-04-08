// SKU Score 0–100
// score = margin*0.30 + drr*0.20 + growth*0.15 + cr*0.15 + stock*0.20
// Penalties: -20 OOS, -15 DRR>margin, -10 novelty<30d with low revenue

interface ScoreParams {
  margin_pct: number
  drr: number
  revenue_growth: number
  cr_order: number
  stock_days: number
  is_oos: boolean
  drr_over_margin: boolean
  is_novelty_low: boolean
}

export function computeScore(p: ScoreParams): number {
  const marginScore = Math.min(p.margin_pct / 0.30, 1) * 30
  const drrScore = p.drr <= 0 ? 20 : Math.max(0, (1 - p.drr / 0.30)) * 20
  const growthScore = Math.min(Math.max((p.revenue_growth + 0.2) / 0.4, 0), 1) * 15
  const crScore = Math.min(p.cr_order / 0.05, 1) * 15
  const stockScore = p.stock_days >= 30 ? 20 : (p.stock_days / 30) * 20

  let score = marginScore + drrScore + growthScore + crScore + stockScore
  if (p.is_oos) score -= 20
  if (p.drr_over_margin) score -= 15
  if (p.is_novelty_low) score -= 10

  return Math.round(Math.max(0, Math.min(100, score)))
}
