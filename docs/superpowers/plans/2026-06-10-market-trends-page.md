# Market Trends page — close the HouseSigma/Zolo analytics gap

**Date:** 2026-06-10 · **Branch:** `feat/market-trends` · **Mode:** autonomous (user away, pre-approved changes)

## Competitive gap analysis (HouseSigma + Zolo vs PureProperty)

Researched 2026-06-10 (HouseSigma market-trends pages, Zolo trends/home-value pages) against a
full codebase feature inventory.

| Competitor feature | They have | We have | Verdict |
| --- | --- | --- | --- |
| **Market trends page** (median price, volume, DOM, absorption per city/community) | HS flagship surface; Zolo per-city reports | `/analytics` is **hardcoded fake data** | **BIGGEST GAP — build now** |
| Sold history + price trends per property | Yes | Shipped (PR #18 history band) | parity |
| AI home valuation | Yes (public) | AVM shipped, auth-gated (VOW/BoR constraint) | parity (gating is a compliance call) |
| School scores | Yes | Shipped (nearby schools + filter) | parity |
| Rental yield / investor metrics | Basic | Cap rate/yield engine, personas, heatmaps | we lead |
| Listing alerts (status change, sold) | Yes (granular) | Price-drop digest only | gap — later (worker-side) |
| Buyer competition (tour counts) | Yes (proprietary app telemetry) | — | not replicable |
| Demographics / census | Partial | — | gap — later (external data) |
| Neighborhood SEO landing pages | Yes (their growth engine) | — | gap — later (needs public-data-only design) |

**Decision:** rebuild `/analytics` as a real, VOW-gated **Market Trends** terminal. Every input
already exists server-side: `/api/market/price-trend` (24-mo median sold price, $/sqft, sales,
sold-to-list %, % over asking, velocity) and `/api/market/region-stats` (active count, cap rates,
stale count). The page beats HouseSigma's equivalent on: % over asking, months-of-inventory with
explicit temperature, stale-inventory share, and cap-rate aggregates (they have none).

## Phases

1. **Data layer refactor (pure, testable).** Extract `assembleRegionScore(region, trend, stats)`
   from `fetchRegionScore` in `src/lib/dashboard/marketAggregates.ts`; export response types.
   No behavior change to dashboard. Add vitest coverage (locked propagation, months-of-supply,
   temperature, null-safety).
2. **LocationSearch callback mode.** Add optional `onPlace(label)` prop so the trends page can
   capture a city/neighbourhood selection without store mutation or navigation (listing/MLS
   selections still navigate).
3. **Page rebuild.** `src/app/(app)/analytics/page.tsx` becomes a server gate (getCurrentUser +
   hasAcceptedTerms, dashboard pattern) rendering `AnalyticsClient.tsx`:
   region picker + property-type chips (PROPERTY_TYPE_OPTIONS) + URL-synced state →
   2 fetches → KPI grid (median price/YoY, $/sqft/YoY, sold-to-list + over-ask,
   months of inventory + temperature, active + stale %, monthly sales) + 24-mo ComposedChart
   (price | $/sqft | sales toggles). Delete all fake data. Keep §6.3(i)/(k) notice.
4. **Nav.** Add "Market Trends" to NAV_ITEMS (`/analytics`).
5. **Verify + ship.** typecheck, lint, vitest, build → commit → PR to main.

## Compliance notes

- Page is server-auth-gated AND both APIs independently return `locked` for anon (defense in depth).
- All stats are deterministic aggregates (no LLM, §4); statistics not listing rows, so the
  100-listing display cap (§6.3b) does not apply; §6.3(i)/(k) consumer notice retained.
- IO budget: no new scans — reuses the two existing 24h-cached endpoints (one scan/region/day).
