# R3 — Merged Consensus Shortlist (sign-off)

Lead-merged from all 7 R2 rankings. Borda across top-5s + logged dissents. In `R3-{yourname}.md`: **ENDORSE** or log a **final one-line DISSENT**. You already ranked; this confirms the merged ordering.

## The plan — "Open the lobby, gate the vault; lead with the wedge"

**Strategic spine:** Win the **Flipper/Deal-Hunter** first (real data today) → **Cashflow** is the destination (unlocks with the rent model). **Builder = cut.** The moat is *exposing* the existing edge through compliant surfaces, not building new engines. Message-lead with the **wedge** (seller desperation / reno-vs-gut truth), not the plumbing.

### PHASE 0 — Stabilize & stop the bleeding (≈week 1) — ships as ONE release
- **A. Stabilize prod.** Triage the sustained Typesense 502 (≤1 day, TRUE BLOCKER — re-indexing into a 502 cluster = data loss) + health-alerting + Supabase circuit-breaker. [#1 for 6/7 agents]
- **B. Kill the fake numbers + flip the default.** Retire fabricated `ExtrapolatedCapRate` (pull from Deal-Score yield input; keep honest `capital_burn_rate`); flip first-run default `smart`→`flippers` (`store:226`) so the public first impression is real-fields-only. ≤1 day. **Redline (data-quant): ships in the SAME release as A.**
- **C. Compliance preconditions.** Flip `VOW_ENFORCE_TERMS=true` ("cheapest win on the board") + finish the brokerage-display audit (map popup + ledger = verified clean; **compare cells = last unverified surface**). **HARD PRECONDITION for every Phase 2–3 gated surface.**

### PHASE 1 — De-fake & cache the foundation
- **D. "De-fake the product"** (M, two parallel halves, same bug class):
  - **D1 rent model** — build the 3 missing feeder tables (`rental_market_index`, `city_region_avg_price`, `municipal_mill_rates`, all 404 now). **Zero new engine code** — `financialMetrics.ts` is wired; returns 0 only because `has_data:false`. Emits **two** rent columns: `rent_idx_public` (IDX-only → public SEO yield, min-N≥8) + `rent_blended_gated` (VOW → gated terminal/AVM). → unlocks Cashflow + L-yield + H.
  - **D2 trust-spine** (S) — wire the dead watchlist heart + dead drawer buttons to the real store. → **Flipper-LAUNCH blocker.**
- **E1. Listing-page ISR/cache** + named-column select (S–M; ~80% of the scale+SEO win; gates F). [E2 rooms→ETL = later, don't let it delay E1.]

### PHASE 2 — The wedge & the funnel (the "instant hit")
- **F. Open the lobby, gate the vault.** Anonymous-first public *active* terminal; **first tap = persona-pick** that reshapes the view. Bundled with G's teaser (persona-pick is only non-lipstick if it reshapes substance). **Dependency chain: B + E1 + M(minimal).**
- **G. The Flipper distress wedge** — gated row-level (True DOM / relist chain / capital burn — all VOW-derived) + **PUBLIC aggregate-VOW teaser** ("7 sold firm/30d · median True-DOM 41d · 3 under ask", min-N≥5). Runs on real data today. **THE wedge — lead all messaging with it.**
- **M(minimal). Responsive Map/List toggle** — elevated from polish to **P0 growth-gate** (mobile = the denominator on every channel; don't open a door you've made unwalkable).

### PHASE 3 — Differentiate, distribute, destination
- **H. "Underwrite the whole map"** — per-listing real cash-on-cash at index time; map recolors by *your* return. Gated. **Hard downstream of D1.** The Cashflow destination magic moment (4-way R0 convergence).
- **I. Glass-box condition-aware AVM** — per-feature breakdown + sold-price timeline (full = gated; aggregate teaser = public). HouseSigma admits in writing it can't tell renovated from gut.
- **J. Uncapped count-only heat layer** beneath the ≤100 pins (active = public; sold = gated, min-N≥5). The **permanent** answer to ">100 results" — no infinite-scroll workaround (§6.3(b)).
- **K. Share/referral loop** — double-sided invite codes (Safe, zero data dep) + active-only Deal-Card OG exports (AVM/sold stripped). **Cheap + safe → can run Phase-1-parallel.**
- **L. Investor-Lens programmatic SEO** — batched aggregate-ETL for honest distress/inventory pages (active count, %price-cut, months-of-supply) now; yield pages after D1. Templated prose, no LLM (§6.2(k)).

## Logged dissents / emphases (non-blocking)
- **product-ux (DISSENT):** do not ship **F before M(minimal)** responsive toggle. F's chain = B + E1 + M.
- **growth (soft):** M under-weighted as fast-follow — tripwire logged; accepted persona's mobile-readable-card compromise.
- **perf-arch (DISSENT):** J must be the *permanent* >100 answer; forbid any future infinite-scroll workaround (§6.3(b)).
- **competitive (emphasis):** launch messaging leads with **G (wedge)**, not F (plumbing).
- **data-quant (redline):** **B ships in the same release as A.**

## Open item routed to compliance (confirm in R3)
Single-listing `OriginalListPrice − ListPrice` (one record's own fields) = **anon-SAFE passthrough** per compliance bright line (no cross-record stitch). Cross-chain price compression = gated. Confirm.
