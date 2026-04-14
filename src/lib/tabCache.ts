// Shared module-level caches for dashboard tabs.
// Module singletons survive tab switches within a session.

import type { AnalyticsResponse } from '@/types/analytics'

// We can't import PriceData or OverviewData here without circular deps,
// so we type them as unknown and cast at the usage site.
export const analyticsTabCache = new Map<string, AnalyticsResponse>()
export const priceTabCache = new Map<string, unknown>()
export const overviewTabCache = new Map<string, unknown>()
