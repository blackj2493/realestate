# R1 — perf-arch (Cross-examination)

I read all six peer R0s. Three things changed my position; one thing I'm escalating; two camps I'm challenging by name.

---

## 0. VERDICT THE LEAD ASKED FOR: prod is NOT healthy → "stabilize + health-alerting" is TASK #0, before any feature

In R0 I said "search is genuinely fast." I have to **partially retract the framing.** Two facts force it:

- `data-quant` R0 §B(9): **Typesense — the terminal's *exclusive* backend — returned HTTP 502 "Application failed to respond" on EVERY call this session.**
- `data-quant` R0 §B(6): the three feeder tables (`rental_market_index`, `city_region_avg_price`, `municipal_mill_rates`) **all 404 — they do not exist.**

**Reconciliation (this is the important nuance):** my R0 finding stands at the *architecture* level — the design (browser → Typesense Cloud direct, no API hop, debounced, parallel fan-out) is genuinely low-latency *when the backend is up*. But "the architecture is fast" and "the product is fast right now" are different claims, and I conflated them. **A sub-50ms design that 502s is 0ms of value.** The mission's headline promise ("instant," "Bloomberg Terminal") is currently *false in prod*, not merely capped.

Likely causes, ranked (all consistent with prior outages in memory):
1. **Typesense Cloud cluster down / OOM / cold** — the RAM-policy comments all over `typesenseSchema.ts:23-28` exist *because* this cluster has hit memory pressure before; a 502 "Application failed to respond" is the cluster process, not a 4xx auth/query error.
2. **Supabase compute Unhealthy again** — exact prior failure mode: NANO → Cloudflare 522 on authed reads ([[supabase-compute-sizing]]), and IO-budget exhaustion → uniform multi-second latency ([[supabase-io-budget]]). The 404s are a *different* class (tables never created), but a flapping instance would compound it.

**My verdict:** Yes — **infra stabilization + health-alerting is Task #0.** No growth dollar, no new metric, no mobile sprint matters if the only backend is intermittently a 502. This *is* my R0 Move #3, and data-quant's independent observation just promoted it from "important" to "blocking." Concretely Task #0 =
(a) confirm/right-size the Typesense cluster + Supabase compute *before* any launch traffic;
(b) **synthetic uptime + freshness alerting** on both (the nightly sync already silently advances its cursor on failure — [[trreb-feed-tokens]] — so "it's quiet" ≠ "it's healthy");
(c) a **circuit-breaker / last-known-good** so a 502 degrades to stale-but-rendered instead of a blank terminal.

This is unglamorous and I'll own it being unglamorous. It is still #0.

---

## 1. CHALLENGE → `compliance`: pin the aggregate-layer ruling (my R0 Move #1 depends on it)

You already gave me **most** of a yes, and I want to lock it. Your R0 §2 SAFE list:
> "**Aggregate COUNTS and histograms over the index** ... A count/distribution is **not** 'viewing/retrieving Listings,' so it is outside the §6.3(b) 100-cap."

My R0 Move #1 is exactly this, made spatial: an **uncapped Typesense count-only heat layer** (per geo-cell `found` counts via the `per_page:0` trick already in `client.ts:49-66`) rendering neighborhood-level **density / mean-yield / mean-True-DOM intensity**, with the ≤100 clickable pins riding on top. Today the map *is* the 100 pins (`AlphaMap.tsx:262`) and a dense Toronto viewport silently truncates — a visible loss vs HouseSigma on their core surface.

**Three precise questions so I can build inside the box (please rule in R1):**

1. **Active (IDX) aggregates:** A public, ungated heat layer of **count + mean-of-deterministic-metric per geo-cell, computed from ACTIVE IDX listings only** — SAFE? (Your §2 says counts are safe; I want explicit confirmation that a *mean of a deterministic derived metric* per cell, not just a raw count, is still "aggregate" and not a §6.2(f) IDX-derivative violation — note your R0 §1 consequence #2: IDX has *no* analytics carve-out even behind a login.)
2. **Sold (VOW) aggregates:** Same heat layer but driven by **sold-comp counts/means** (e.g. "median sold-to-list by cell"). I assume this is **GATED** (behind `requireConsumer`), never public — confirm? This decides whether the sold heat layer is an anon teaser or a logged-in-only feature.
3. **The enumeration ceiling (your R0 §3 limit #3):** my heat cells are **aggregate-only, server-computed, and never ship the underlying rows to the client** — the cell carries `{count, mean}`, not a sampled listing set. Does keeping cells coarse enough that a user can't binary-search a single listing's value satisfy your "samples never render as a browsable listing set" line? I'll set a **minimum cell population (e.g. suppress cells with count < k)** as the guardrail. Is a min-count suppression the right control, and what's a defensible `k`?

If #1 is NO for *means* (only raw counts), my layer degrades to a **density-only** heatmap (still beats truncated pins) and the yield/DOM intensity moves behind the gate. I need the ruling to know which.

---

## 2. CHALLENGE → `data-quant`: I'm with you on sequence, but Move 1 (rent model) has a hot-path cost you didn't price

Your R0 Move 1 (build `rental_market_index` from the IDX lease feed + leased `raw_vow_sold`, light up the already-written `financialMetrics.ts`) is **correct and I endorse it** — it's deterministic, ETL-side, §4-clean, and it converts the dead `gross_yield_est`/`cap_rate_est`/`cashflow` fields into real index data. That's the *right* place to compute (index time, not request time), which is my whole architectural thesis.

**My one challenge / add:** make sure the rent model lands as **precomputed, stored Typesense fields**, not as a per-request lookup. Your fix is ETL-side, so we're aligned — but `persona`'s Move 1 ("`coc_at_20pct`, `cashflow_at_20pct` as real Typesense fields, run `computeUnderwriting` at index time") is the part that makes it *fast at scale*, and it implies a **schema migration + full re-index** of ~131k docs. Two perf flags on that:
- A full re-index of 131k docs into a cluster that's **currently 502-ing** (§0) is exactly when OOM happens. **Sequence: stabilize/right-size Typesense (Task #0) → add fields → backfill in batched `import` (the sync already does `action:'upsert'` in 100-doc batches, `sync.ts:558-561`, so reuse that path) → never a destructive recreate.**
- New sortable/filterable fields add RAM. The `typesenseSchema.ts:23-28` RAM policy is explicit that numerics stay `facet:false`. Adding `coc_at_20pct` etc. as `sort:true, facet:false` is fine; do **not** facet them.

Net: your data fix and my perf fix are the **same fix viewed from two ends** — compute the truth at ETL/index time, never per viewer. We're allies, not opponents.

---

## 3. The listing-page ISR/cache fix is the SHARED DEPENDENCY for three camps — rank it ABOVE the rent model and mobile

This is the reconciliation the lead asked for. My R0 finding C (the SEO listing page is `force-dynamic` over an uncached fan-out: Supabase `select("*")` JSONB detoast + a **live external `/PropertyRooms` call** + AVM, per crawler/viewer — `[id]/page.tsx:36`, `getListingDetail.ts:182-216`) is not just *my* problem. It is **load-bearing for three other R0s:**

- **`growth` R0 §2 + Move 3:** the entire SEO play (45k indexable pages, programmatic neighbourhood pages) rides on these pages. `force-dynamic` = slow TTFB = worse Core Web Vitals = worse ranking. **Growth's #1 channel is throttled by my #1 perf bug.**
- **`product-ux` R0 Move 3:** the "trust spine" — pages that *work*, fast, no dead ends. A 2–8s cold listing page that can time out (the route literally 404s on Supabase timeout, `route.ts:59-64`) is a trust leak on the exact page a shared/searched link lands on.
- **`competitive` R0 §3:** the SEO surface is named as a structural advantage over Realtor.ca — but only if it's *cached like Realtor.ca's is.*

**Ranking argument:** The ISR/cache fix is **lower effort and higher fan-out** than both the rent model and mobile.
- It's a *configuration + caching* change (flip `force-dynamic` → ISR keyed to the 24h sync cadence; wrap `getListingDetail` in `unstable_cache` — the market routes already do this pattern; `select` named columns not `*`; move rooms into `full_payload` at ETL so SSR makes **zero** external calls). No new data model, no migration.
- It **unblocks** growth + product-ux + competitive simultaneously, and it's the prerequisite that makes *any* SEO traffic survivable. Mobile (product-ux Move 1) is high-value but serves users *already arriving*; the cache fix protects the *arrival path itself* under load.

So my rank for the shared infrastructure tier:
1. **Task #0 — stabilize Typesense/Supabase + health alerting** (nothing works without it).
2. **Listing-page ISR/cache + rooms-to-ETL** (unblocks SEO trust spine for 3 camps; low effort).
3. **Rent model → real Typesense yield/cashflow fields** (data-quant Move 1 + persona Move 1; the data moat; needs the stabilized cluster from #1).
4. *Then* feature/distribution work (mobile, heat layer, referral) on the now-solid base.

Mobile is critical and I don't dispute `product-ux` — but it ranks **after** the cache fix because a fast mobile terminal pointed at a 502 backend is still a 502.

---

## Concessions (where I move off my R0)

- **I concede to `data-quant`/`persona`:** my R0 implicitly treated the terminal's metric layer as basically working-but-capped. It's worse than that — the headline cashflow fields are *empty* (404 feeders), and `ExtrapolatedCapRate` is `f(ListPrice)` cosplaying as yield. So "make the map instant" is moot for the Cashflow persona until the data is real. Perf is necessary, not sufficient.
- **I concede the framing to `product-ux`:** "the win is distribution of existing edge, not more edge." My deck.gl observation supports this — we pay a 3D-WebGL complexity budget to render ≤100 points. I'm *not* advocating more map tech; the heat layer (Move #1) reuses the *existing* `per_page:0` count machinery and the *existing* deck.gl HexagonLayer (`AlphaMap.tsx:394-425`), no new dependency.
- **I do NOT concede on the cap-as-product-ceiling:** even with perfect data, a map that can only ever show 100 pins is structurally thinner than HouseSigma's. The aggregate heat layer is how we beat them *on their own surface* without breaking the 100-cap — pending the §1 compliance ruling.
