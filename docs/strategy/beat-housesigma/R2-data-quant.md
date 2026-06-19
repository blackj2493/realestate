# R2 — data-quant (Reconciliation)

I endorse the ballot's phasing. The council converged hard: `growth` conceded the sequencing outright ("you win... I will not market fake numbers") and made my rent model **the #1 growth dependency**; `compliance` blessed the architecture with one binding sourcing constraint I resolve below; `perf-arch` and I are the same fix from two ends. This file (1) sizes **D** for real, (2) resolves **Open Q#2** (the SEO aggregate + a compliance-driven two-surface split), (3) confirms **H ⟂ D**, (4) retires fake `ExtrapolatedCapRate` under **B**, (5) ranks my top-5, (6) concedes.

---

## 1. Phasing — ENDORSED (A→B→C / D+E / F+G+H / I–M)
The A→B→C / D+E ordering is correct. One precision I'm putting on the record: **Phase 0 is operational, not a build quarter** — A (stabilize Typesense), B (one-file kill of fake numbers), C (flip `VOW_ENFORCE_TERMS` + brokerage audit) are hours-to-days each and gate everything. They should not consume "feature roadmap" budget; they're the cost of the lights being on. (Typesense is *still* 502 this round — I tried again in R2 and got "Application failed to respond." A is genuinely blocking.)

---

## 2. Move D — real effort sizing (the lead's ask)

**D = two independent halves that ship in parallel.** They're paired in the ballot because they're the same *bug class* (UI promises what the backend doesn't deliver), not because they share code.

**D-half-1 (mine): the rent model. Effort = M.** Concretely, what must be built:
- **A new ETL aggregation job** (`scripts/worker/` — pattern: the existing `ingest-matrices.ts` / `backfill020.ts` batched-cursor jobs) that computes median + p10 rent by `city_region × property_sub_type × bedrooms × washrooms`, writing the **`rental_market_index`** table that `rentAVM.ts:33-53` already queries. **This table currently 404s — it has never been created.** Source: `raw_vow_sold` leased records (219,880-row base) + IDX for-rent feed (~24k).
- **Two sibling tables `fetchTrueValue`/`fetchMillRate` also expect and that also 404:** `city_region_avg_price` and `municipal_mill_rates`. `city_region_avg_price` is a trivial GROUP-BY over sold (cheap). `municipal_mill_rates` is a small static seed table (~50 GTA municipalities, public data) — S, basically a one-time insert.
- **Zero new engine code.** `financialMetrics.ts` (cap/yield/cashflow/tax-burden) is written and already called in the transformer (`transformer.ts:856-871, 1009-1015`). It produces 0/garbage *only* because `has_data:false`. Populate the table → it lights up on the next delta sync.
- **Schema:** add the yield/cashflow fields to Typesense as `facet:false, sort:true, optional:true` (per `perf-arch` + verified `typesenseSchema.ts:23-28,34` — never facet numerics, RAM policy). `optional:true` allows in-place backfill exactly like `BedroomsAboveGrade`/`TransactionType` were (`:41,46`).
- **Backfill is OPTIONAL, not a forced full re-index.** The daily delta `action:'upsert'` (`sync.ts:558-561`) backfills touched docs organically — de-risking `perf-arch`'s OOM concern on a fragile cluster. A one-shot 131k backfill is an accelerant, run only after A.

> Why M not L: the hard parts (the engine, the UI bindings, the histograms, the transformer wiring) already exist. The work is one aggregation job + two small tables + a schema add. **The effort is data-plumbing, not modeling.**

**D-half-2 (product-ux's): wire the dead watchlist heart (`LedgerRow.tsx:107,159-167`) + dead drawer buttons (`ListingTerminal.tsx:527-532`) to the real `useWatchlistStore`; remove dead `highlightNLPFlags`; label bucket sqft as "~est." Effort = S.** I defer to product-ux on this half; flagging only that removing `highlightNLPFlags` is also a §4 hygiene win (it's an NLP-shaped function sitting in the listing renderer).

**Net D effort: M** (S + M, parallelizable). **Impact 5** (it's the spine of the #1 persona AND the gate on growth's whole yield loop). **Compliance: Gated** — see §3, the rent-source split decides which surfaces the output can touch.

---

## 3. OPEN Q#2 — the SEO aggregate, and the compliance split I must resolve

**Can I build the active-IDX aggregate that unblocks growth's SEO (L)? Yes. Is it cheap enough to matter? Yes — it's the SAME job as D, partitioned. L is NOT a cut; it's a near-free rider on D + J.**

Here's the resolution to `compliance`'s binding challenge to me (R1: *"rent from IDX for-rent = IDX-class; rent from VOW-leased = VOW-class; a materially-VOW-derived public yield number is FORBIDDEN"*). The answer is **two rent cohorts, two surfaces, one engine:**

| Rent cohort | Source | Class | Surface it may feed |
|---|---|---|---|
| **Public rent index** | **IDX for-rent feed ONLY** (~24k active rentals) | IDX-class | ✅ **PUBLIC** aggregate yield on Investor-Lens SEO pages (L) + the public heat layer (J, active tier) |
| **Gated rent index** | IDX for-rent **+ VOW-leased** blend (deeper) | VOW-class | 🔒 **GATED ONLY** — "Underwrite the whole map" (H), per-listing AVM yield, gated terminal |

This is clean: the same `rental_market_index` job emits two columns (`rent_idx_public`, `rent_blended_gated`), and surfaces pick the lawful one. **Public yield pages and Deal Cards read the IDX-only column; the terminal/AVM read the blend.** Compliance's qualifier is satisfied by construction.

**Two caveats I'm putting on the record for L:**
1. **Min-N suppression is mandatory** (mirror compliance's heat-layer N≥5 rule). 24k IDX rentals across hundreds of `city_region × subtype × beds` cohorts **will be thin in many cells** — a public "Hamilton 2-bed cap rate" off 3 rentals is both statistically junk and a near-identification risk. Suppress/blur any public cohort below a floor (I'd set N≥8 for a published yield, given rent variance).
2. **`region_aggregates` still 404s in prod** (re-verified R2). Growth's L assumed it exists; it does not. So L's *non-yield* aggregates (inventory counts, True-DOM distribution, price-cut %) need an active-IDX aggregate table built too — but that's `multi_search` count-only over the live index (the `per_page:0` trick already in `client.ts:49-66`), i.e. **shares J's machinery.** So L = (J's public count layer) + (D's IDX-only rent column). **No standalone L build; it's the intersection of two things already on the board.** That makes L **cheap (S–M on top of D+J), not the L the ballot feared.**

---

## 4. H ("Underwrite the whole map") — CONFIRMED purely downstream of D
H is `persona`'s Move 1 and mine, fused. It computes per-listing real cash-on-cash at index time and recolors the map by the user's return. **It cannot render a single honest pixel until D's gated (blended) rent index exists** — `coc_at_20pct`/`cashflow_at_20pct` are derived from modeled rent. H is **Gated** (it's VOW-blended-rent-derived → behind `requireConsumer`). Sequence is hard: **D → H, no exceptions.** H is the destination magic moment; D is the road. Don't schedule H before D lands or it ships as the same fiction we're killing in B.

---

## 5. B — RETIRE the fake `ExtrapolatedCapRate` (confirming, with nuance)
**Confirmed: stop displaying `ExtrapolatedCapRate` as a per-listing "cap rate."** It's `f(ListPrice)` with a static $5,500 rent for every property (`ExtrapolatedCapRateEngine.ts:61-92`) — a $400k condo and a $400k bungalow get the same "cap rate." Two precise actions:
- **Remove it from the listing card / Yield column / Deal Score "Yield" input** (`computeDealScore.ts:230` — that 20% of the score is currently noise). Until D lands, Deal Score renormalizes over its other 3 components (the engine already handles missing components gracefully, `computeDealScore.ts:244-248`).
- **Nuance — don't delete the engine, relabel its other outputs.** `calculateProForma` also emits `capital_burn_rate_monthly` and `total_capital_basis`, which ARE honest (carry cost off list price + tax + HOA is a legitimate per-listing display computation, and compliance R1 Ruling 5 confirms active-listing carry-cost display is SAFE). **Keep Capital Burn (it's part of the Flipper wedge G); kill only the cap-rate number.** When D lands, the real `cap_rate_est`/`gross_yield_est` from `financialMetrics.ts` replace the fake field in the same UI slot.

---

## 6. My ranked top-5 (Impact × Effort × Compliance)

1. **A — Stabilize prod.** Impact 5 · Effort S · Safe. *The terminal is 502 right now; 0ms of a sub-50ms design. Nothing else matters until this is green.*
2. **D — De-fake (rent model + trust spine).** Impact 5 · Effort M · Gated (split-sourced per §3). *The spine of the #1 persona and the gate on growth's entire yield loop. Highest-leverage build on the board. Ships with B's honesty fix as its precondition.*
3. **E — Listing-page ISR/cache + rooms→ETL.** Impact 4 · Effort S–M · Safe (auth-partition the cache — compliance R1). *Unblocks 3 camps (SEO CWV, scale, the page every link lands on). Cheap; removes the #1 traffic-saturation + TRREB-rate-limit risk.*
4. **G — Flipper launch wedge (True DOM + price-drop + Capital Burn).** Impact 4 · Effort S · Gated-aggregate-teaser/Gated-full. *The one HouseSigma-beater that needs ZERO new data — `property_sale_history` (214k) is populated today. This is what we launch ON while D is built behind it.*
5. **H — "Underwrite the whole map."** Impact 5 · Effort M · Gated. *The north-star magic moment. Ranked 5th only because it is strictly D-downstream; once D lands it is the single most differentiated thing in the product (HouseSigma structurally won't build a map that recolors by YOUR return — it alienates their agent funnel).*

**Just-below-the-line (endorse, not top-5):** B/C (Phase-0 hygiene, assumed-done preconditions). F (lobby/vault — SAFE, but it's a homepage re-route, more growth/UX than data). K-referral (Safe, zero-data — ship anytime). J (heat layer — see §7). I (glass-box AVM — Phase 3, gated). M (mobile — real growth-blocker per growth, but product-ux/perf-arch own it).

---

## 7. Open-question votes + dissent
- **Q1 (anon teaser scope):** Defer to compliance's Ruling 5 — anon sees active price + active DOM + a price-drop *fact* on the single listing (display computations, SAFE), but **active-dataset ANALYTICS** ("cheaper than 80% of the neighbourhood") must be **aggregate/count (J) or gated** (IDX §6.2(f) no carve-out). Agree fully.
- **Q2 (SEO):** **FUND IT — but as a rider, not a standalone.** L = J's public count layer + D's IDX-only rent column. Not a cut; ~free once D+J exist. (§3.)
- **Q3 (heat layer J):** **Fast-follow, not launch.** It needs the active-aggregate machinery and a min-N suppression layer; valuable but not on the critical path to a Flipper-wedge launch. Launch on G; ship J right after.
- **Q4 (ordering):** Right. Nothing jumps phases. The only thing I'd make explicit: **B must ship in the SAME release as A** (don't stabilize a cluster that's still serving fake cap rates).
- **Q5 (dissent):** **None on Flipper-first or cutting Builder** — I verified both (`BuilderAnalyticsEngine.js` `multiplexByRight=false` hardcoded; True DOM populated on 214k). No dissent to record.

## 8. What I conceded across R1–R2
- To `product-ux`: dropped the "more engines" posture; my rent model is **de-faking, not expansion** — it sits in their trust-spine phase, not a metrics-maximalism phase.
- To `perf-arch`: stabilize-prod is genuinely #0, ahead of my data work.
- On **hash-stitching** (my R0 Move 3): demoted to fast-follow — True DOM already works on the 214k base; the hash fix only *widens* repeat-sale linkage. Off the top-5.
- On the **public AVM/yield**: it's IDX-only-sourced + min-N-suppressed or it's gated — I accept compliance's two-axis test as binding on every surface I propose.
