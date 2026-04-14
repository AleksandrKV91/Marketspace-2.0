export interface SkuNode {
  sku_ms: string
  sku_wb: number | null
  name: string
  revenue: number
  prev_revenue: number
  delta_pct: number | null
  chmd: number
  margin_pct: number
  drr: number
  stock_rub: number
  stock_qty: number
  stock_days: number | null
  forecast_30d_qty: number | null
  price: number
}

export interface SubjectNode {
  subject: string
  revenue: number
  prev_revenue: number
  delta_pct: number | null
  chmd: number
  margin_pct: number
  drr: number
  skus: SkuNode[]
}

export interface CategoryNode {
  category: string
  revenue: number
  prev_revenue: number
  delta_pct: number | null
  chmd: number
  margin_pct: number
  drr: number
  subjects: SubjectNode[]
}

export interface AnalyticsResponse {
  kpi: {
    revenue: number
    prev_revenue: number
    chmd: number
    prev_chmd: number
    margin_pct: number
    prev_margin_pct: number
    drr: number
    prev_drr: number
    cpo: number | null
    prev_cpo: number | null
    forecast_30d_revenue: number
    sku_count: number
    period_days: number
  }
  hierarchy: CategoryNode[]
  daily_chart: Array<{ date: string; revenue: number; chmd: number; ad_spend: number; drr: number; margin_pct: number }>
  daily_chart_prev: Array<{ day_index: number; date: string; revenue: number }>
  daily_by_sku: Array<{ sku_ms: string; date: string; revenue: number; ad_spend: number }>
  meta: { categories: string[]; managers: string[]; max_date: string | null }
}
