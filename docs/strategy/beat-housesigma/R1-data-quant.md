# R1 — data-quant (Cross-examination)

My R0 bombshell (404 feeder tables → empty yield/cashflow; fake `ExtrapolatedCapRate`; real AVM + 214k sold chains) turns out to be the **load-bearing fact of the whole council**: `growth`, `persona`, and `product-ux` independently hit the same wall. This round I hold every camp to that reality, settle the ORDER fight, and concede where I was wrong.

---

## A. New prod evidence gathered this round (read-only)

1. **`region_aggregates` does NOT exist in prod — HTTP 404.** I queried it three ways (`region_aggregates`, `region_aggregate`, plus the `region_metrics` variants from R0). All 404. This directly contradicts `growth` R0:51 ("we already have `region_aggregates`, migration 020") and the project memory. **`growth`'s programmatic-SEO Move 3 has no aggregate data table to render from today.** The migration may exist on disk, but the asset is not live/queryable. Flagging so we don't build a roadmap line on a phantom dependency.
2. **Typesense is still 502 — entire session, ~10 calls, exponential backoff.** This is not a cold-start blip; it's a sustained outage of *the frontend's exclusive data source*. Strongly corroborates `perf-arch` §D/E. **Right now, the terminal does not load.** This reframes the order question (below).
3. **Rent-model feed exists at scale:** `raw_vow_sold` = **219,880 rows** (includes leased records per memory `avm-lease-pollution`), plus the IDX lease split (~24k, memory `typesense-no-transactiontype`). My Move 1 has real raw material. (The `full_payload->>TransactionType` REST filter 500'd — JSONB detoast timeout, exactly the [[supabase-io-budget]] cliff `perf-arch` warns about. Aggregation must be a batched ETL job, not a live query.)

---

## B. Settling the ORDER fight (the lead's core ask)

### vs `product-ux` — "distribution of existing edge > more metrics." **I concede the framing, and reframe my own work.**
`product-ux` R0:66 says adding a 6th derived metric while the watchlist heart doesn't save is "polishing the basement while the front door is broken." **They are right** — and my Move 1 is **not a 6th metric**. The Yield column (`personaConfig.ts:276`), the cashflow fields, and the `RangeHistogram` that *self-hides because the field is empty* (`product-ux` R0:11) are **already wired into the shipped UI**. The engine (`financialMetrics.ts`), the bindings, the histograms all exist. Only the feeder table is missing.

So a fake watchlist heart (`LedgerRow.tsx:107`) and a fake cap rate (static $5,500 `ExtrapolatedCapRate`) are **the same bug class**: the UI promises something the backend doesn't deliver. They belong in **one phase** — *"stop shipping fake."* I am NOT in the "more engines" camp `product-ux` fears; I'm in their own trust-spine camp. The rent model is the *backend half* of the same de-faking they want on the *frontend half*.

**Verdict on order:** product-ux's trust-spine fixes (M3) and my rent model (M1) ship **together** as Phase 1 "De-fake the product." Neither is "new edge."

### vs `perf-arch` — is "stabilize prod" task #0? **Yes — and the live 502 proves it.**
`perf-arch` is correct that nothing matters if the foundation 522s/502s. The terminal's only backend is down *right now*. **Phase 0 = restart/right-size Typesense + the Supabase health gate + sync-freshness alerting** (`perf-arch` M3). This is operational stabilization (hours–days), not a roadmap quarter — it *gates* everything but doesn't *compete* for feature slots. I fully endorse `perf-arch` M2 (ISR/cache the `force-dynamic` listing page) as a Phase-0/1 must: it's the page every SEO and social link lands on, and `getListingDetail`'s live ProptX `/PropertyRooms` call inside SSR (`perf-arch` R0:25) is a latent compliance+scale double-fault.

**One caution to `perf-arch`:** when you cache/precompute the listing page, the VOW-derived fields (AVM, Value-Add, sold history) must stay **per-auth at the edge**, never baked into the public ISR HTML — or we leak gated data to crawlers (compliance §2 ⛔). Your R0:48 says this; I'm underscoring it as a hard contract.

### vs `growth` — sequence is non-negotiable. **Loops come AFTER de-fake, and one feeder is missing.**
`growth` themselves conceded the dependency (R0:67): "if the marquee cashflow fields are empty... my Deal Card and SEO yield pages have nothing to render." **Confirmed — and worse:** `region_aggregates` is also absent (§A.1). So **two** of growth's three moves are downstream of data work that doesn't exist yet. The Deal Card and Investor-Lens SEO are good loops *on real numbers*; on today's data they'd broadcast `$5,500-rent` fiction to BiggerPockets — the fastest way to lose the analytical audience permanently. **Build the rent model + region aggregates first; point growth dollars second.**

---

## C. Veto / green-light on each revenue/growth idea (per lead's ask)

| Idea | Runs on HONEST data TODAY? | Ruling |
|---|---|---|
| **Open Terminal / Locked Vault** (growth M1) | Yes — active IDX + *deterministic active metrics* only (True DOM, price-vs-list, carry cost). NOT cap-rate-on-list (that's the fake field). | 🟢 **GREEN, with one redline:** drop "cap-rate-on-list" from the anon teaser until the rent model lands; it's the hollow number. Otherwise compliant (compliance R0 agrees anon active terminal is shipped state). |
| **Deal Card share** (growth M2) | Only if it shows **active-listing deterministic** metrics (True DOM, price drop, carry). NOT AVM/yield. | 🟡 **CONDITIONAL.** Active-metric card today; AVM/yield card is BOTH compliance-gated (compliance R0 ⛔ public VOW-derived) AND data-blocked (fake until M1). Run the loop on True DOM / Capital Burn now — that's still a HouseSigma-beater (competitive M1). |
| **Investor-Lens programmatic SEO** (growth M3) | **No.** Needs `region_aggregates` (absent, §A.1) AND a real rent model. | 🔴 **HOLD** until both data assets exist. The SEO surface is right; the data under it is vapor today. |
| **Weekly "Sigma-Killer" report** (growth M3) | Partially — True DOM / inventory / price-compression aggregates are honest; yield/cap-rate sections are not. | 🟡 **CONDITIONAL.** Ship the distress/inventory edition now; add the yield edition post-M1. |
| **Referral invites** (growth M2.1) | Yes — no data dependency at all. | 🟢 **GREEN.** Pure growth mechanic; ship anytime. The one move with zero data risk. |

---

## D. Where I strengthen peers

- **`persona` M1 ≈ my M1 — strongest alliance in the room.** Persona R0:54 ("run `computeUnderwriting` at index time against a rent model, store `coc_at_20pct`/`cashflow_at_20pct` as *real* Typesense fields") is the **exact same build** as my "rent model lights up `financialMetrics.ts`." We arrived independently. This convergence should make it the council's #1 data move. I additionally endorse `persona`'s **cut the Builder persona** — I verified the same: `BuilderAnalyticsEngine.js` has `multiplexByRight=false` hardcoded and `price_per_sqft` mislabeled. Shipping a fake developer tool to developers is a §10 violation; cut it from launch.
- **`competitive` M1 (True DOM badge) + `persona` M2 (Distress Wire):** both ride `TemporalDistressEngine` — which IS real and populated (`property_sale_history` 214k). This is the move that needs **no new data**, beats HouseSigma's blind spot, and serves the Flipper. **It should lead the launch** while the rent model is built behind it.

## E. Where I CONCEDE
- To `product-ux`: I drop any "ship more engines" posture. The rent model is de-faking, not expansion; I'll frame it that way in R2.
- To `perf-arch`: stabilize-prod is genuinely #0, ahead of all my data work. My rent model is worthless if Typesense is 502.
- On repeat-sale linkage: my R0 "fix property_hash stitching" (M3) is real but **lower priority** than persona/competitor agree — the True DOM badge already works on the 214k base; hash-fix only *widens* it. Demote to fast-follow.

---

## F. My direct challenge (sent to `growth`)
Growth's plan is good but **front-runs its own data**. I'm challenging the implicit assumption that the data is "mostly there, just needs surfacing." It is not: yield/cashflow = 404 tables, `region_aggregates` = 404, Typesense = 502. The honest sequence is **Phase 0 stabilize → Phase 1 de-fake (rent model + trust spine) → Phase 2 growth loops**. The ONE loop growth can ship in Phase 1 with zero data risk is **referral invites**; the ONE content edge they can ship honestly now is **True-DOM / distress**, not yield. Lead with what's real.
