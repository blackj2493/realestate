# R0 — perf-arch (Performance / Architecture)

**Question I own:** Is PureProperty actually *instant*, and will it hold at Realtor.ca-scale traffic?

**Short answer:** The *terminal search path is genuinely fast and well-architected* — but the product has two structural ceilings that will bite the moment it succeeds: (1) the **100-result hard cap makes the map fundamentally less useful than HouseSigma's**, and (2) the **SEO listing pages are `force-dynamic` with an uncached, multi-hop cold path** that will fall over under traffic and tank the very SEO growth depends on. The "instant" claim is true for power-users already inside the terminal; it is false for first-touch (cold listing page) and structurally limited on the map.

---

## Findings (grounded in code)

### A. The terminal search path is good — and queries Typesense from the browser directly
- `src/app/properties/page.tsx:30,156-184` — the terminal imports `searchListings` and calls Typesense **directly from the client** (`"use client"`), no Next API hop. That's the right call for latency: one network round-trip to Typesense Cloud, no serverless cold-start in the hot path. Search RTT is dominated by Typesense + the user's link, not our infra.
- Debounce is 250 ms (`page.tsx:247`) and the comp/active fan-out runs in parallel via `Promise.all` (`page.tsx:210-215`). Histogram bars are batched into a single `multi_search` round-trip (`client.ts:49-66`). This is solid.
- **Risk — the search-only Typesense key is hardcoded as a fallback in shipped client code:** `src/lib/typesense/client.ts:17` (`SEARCH_API_KEY ... || 'BzXkIss7SXH0U1Hb0a1COwdvEACxbhkj'`), same host hardcoded at `:15`. A search-only key is low-blast-radius, but a hardcoded fallback means it ships even when the env var is missing, and it can't be rotated without a redeploy. Lock scope (collection + RPM) at the Typesense layer.

### B. The 100-result cap is a compliance rule, but it's been turned into the *whole* data model — and it's the map's ceiling
- `src/app/properties/page.tsx:64` `MAX_LISTINGS = 100`; every layer is sliced to it (`mergeLayers(...).slice(0, MAX_LISTINGS)` `:222`).
- Consequence in the map: `AlphaMap.tsx:262-266` clusters "the whole world bbox" precisely *because* it "only ever has ≤100 listings (compliance cap)." So Supercluster/deck.gl render load is near-zero — **deck.gl is massively over-spec'd for 100 points.** We're paying the WebGL/3D-hexagon complexity budget to render what a canvas layer could.
- The real problem isn't render perf — it's **product perf**: HouseSigma shows *every* active + sold pin in a city and clusters thousands. Our map can never show more than 100 dots. A dense Toronto viewport silently truncates. That is a *visible* loss vs HouseSigma on their core surface. (Note: TRREB caps *listings displayed per query*; aggregate **counts/heat** are not capped — see move #1.)

### C. SEO listing pages are `force-dynamic` over an uncached, fan-out cold path — the #1 scale + SEO liability
- `src/app/(app)/properties/[id]/page.tsx:36` `export const dynamic = "force-dynamic"`, and the API mirror `src/app/api/property/[id]/route.ts:5` is also `force-dynamic`. **No caching whatsoever.**
- Each render of `getListingDetail` (`src/lib/property/getListingDetail.ts:182-216`) does, *per request*:
  1. Supabase `.select("*")` on `listings` — pulls the **entire `full_payload` JSONB** (detoast) for one row (`:186-194`), 10 s timeout.
  2. A **live external ProptX `/PropertyRooms` call** for any listing whose rooms aren't pre-stored (`:154-176,210-211`), 6 s timeout — a third-party hop *inside our SSR render*, against the same TRREB rate limits we're trying to bypass.
  3. Synchronous AVM compute + an extra `avm_sqft_calibration` point-lookup on the bucket path (`:218-240`), plus Deal Score / Value-Add.
- This is the page Google crawls and that any viral/Reddit link lands on. Realtor.ca serves listing pages from cache/CDN; ours recomputes the whole chain for **every crawler hit and every viewer of a hot listing.** Under 10–100× traffic this is the first thing to saturate Supabase (memory: [[supabase-io-budget]], [[supabase-compute-sizing]]) and TRREB rate limits simultaneously. Dynamic SSR also means slow TTFB → worse Core Web Vitals → worse ranking, directly undercutting `growth`'s SEO play.

### D. Supabase is the fragile leg; the architecture *says* "frontend is blind to Supabase" but the listing detail + market routes lean on it hard
- `getServiceRoleClient()` is a process singleton with a 30 s bounded fetch (`src/lib/supabase/client.ts:61-77,24-26`). Good that it fails fast now; bad that the listing page's whole render depends on it with no cache fallback.
- Market routes *do* cache correctly (`unstable_cache` 24 h on region-stats/price-trend; 300 s on bubble stats — grep results). The **listing detail path is the glaring exception.** It is also the highest-traffic server route.
- Compute sizing has already caused outages (NANO → Unhealthy → Cloudflare 522 on authed reads — [[supabase-compute-sizing]]). The current design routes the most traffic-sensitive page straight at that bottleneck.

### E. ETL / freshness is healthy and incremental — not a scale risk, but a single-point-of-failure
- Typesense sync is incremental `import(..., { action: 'upsert' })` (`scripts/worker/sync.ts:558-561`) over 100-doc batches; non-active statuses are filtered out to protect RAM (`:539-546`). No destructive full reindex. Good.
- But the nightly cron is a known fragile chokepoint: silent cursor-advance on failure ([[trreb-feed-tokens]]), a 5th secret that hard-throws at import ([[daily-sync-typesense-key]]), media reconciliation gaps ([[media-reconciliation-gap]]). 24 h freshness is *fine for compliance* but HouseSigma feels near-real-time; a single missed cron = a day-stale terminal with no automated detection/alerting in the hot path.

---

## My 3 boldest moves

### 1. Decouple "what we *render*" from "what we *count*": ship an uncapped aggregate heat/count layer under the 100-pin cap
**The cap limits displayed *listings*, not aggregate statistics.** Run a parallel Typesense aggregation (faceted counts / `multi_search` count-only by geo-cell, the same `per_page:0` trick already in `client.ts:49-66`) to drive an **uncapped density/yield/DOM heatmap for the whole viewport**, while the ≤100 clickable pins ride on top. Today the map *is* the 100 pins (`AlphaMap.tsx:262`); a dense city silently truncates and looks emptier than HouseSigma.
- **Beats HouseSigma:** they show pins; we'd show *deterministic neighborhood-level yield/compression intensity they don't compute* — the "shadow data" thesis made spatial. **Compliance must rule on count-only aggregates** (I believe they're permitted; aggregate ≠ listing display — flag for `compliance`).
- **Persona:** Cashflow Investor + Flipper (where is yield/compression hot, beyond 100 dots).

### 2. Make listing pages static-first: ISR + cache `getListingDetail`, and move the live `/PropertyRooms` call OUT of the render path
Flip `[id]/page.tsx` and `api/property/[id]` from `force-dynamic` to **ISR** (`revalidate` ~ the 24 h sync cadence; data only changes nightly anyway), wrap `getListingDetail` in `unstable_cache` keyed by `listing_key` (the market routes already do this), `select` only the columns the page needs instead of `*` (avoid full JSONB detoast for fields we don't render), and **pre-ingest rooms into `full_payload` at ETL time** so the SSR render never makes a third-party ProptX call (the code already prefers stored rooms — just guarantee they're always stored). VOW-gated fields stay computed at the edge per-auth, but the IDX-class body is cacheable.
- **Beats Realtor.ca:** sub-100 ms cached TTFB on the SEO page → better CWV/ranking on the exact pages `growth` wants indexed. Removes the #1 traffic-saturation and TRREB-rate-limit risk in one move.
- **Persona:** all four (every persona enters via a listing page from search/social); especially Smart Homebuyer (the SEO funnel).

### 3. Put a read-cache + health gate in front of Supabase so a slow/Unhealthy DB degrades gracefully instead of 522-ing
Given the prior NANO outage ([[supabase-compute-sizing]]) and IO-budget cliffs ([[supabase-io-budget]]): add a short-TTL cache (Vercel Data Cache / `unstable_cache`) on the remaining hot Supabase reads, a circuit-breaker that serves last-known-good on timeout, and **synthetic health/freshness checks on the nightly sync** that alert when `records_synced=0` or the cursor advanced on a failed status (the exact silent-failure mode in [[trreb-feed-tokens]]). Right-size compute *before* a launch spike, not after.
- **Beats HouseSigma:** reliability as a feature — a terminal that 522s loses a high-intent user permanently. "Instant" must mean "instant under load," not "instant in the demo."
- **Persona/experience:** all — this is the floor the whole "Bloomberg Terminal" promise stands on.

---

## Biggest thing I'll challenge another camp on
Anything that adds **per-request server compute on the hot path** — especially a *public* AVM/valuation surface or richer per-listing analytics (likely from `data-quant`/`product-ux`). The engineering is feasible, but if it lands as `force-dynamic` SSR like the current listing page, it becomes a scale bomb *and* a compliance bomb at once. My stance: every new data surface must be **either precomputed at ETL/index time or cached at the edge** — never computed live per viewer. I'll press `growth` similarly: an SEO strategy that drives traffic to uncached dynamic pages is self-defeating.
