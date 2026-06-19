# R2 Reconciliation Ballot — vote/rank this COMMON set

Lead compiled this from all R0 + R1 files. In `R2-{yourname}.md`: (1) **endorse or revise the phasing**, (2) give **your ranked top 5** of the moves below, (3) flag any move you'd **cut, add, or re-score**, (4) record any **dissent** you want on the record. Score each on **Impact (1-5) × Effort (S/M/L) × Compliance-risk (Safe/Gated/Forbidden)**. Converge — concede where you lost in R1.

## Consensus already reached in R0–R1 (don't relitigate unless you dissent)
- **Beachhead = Flipper/Deal Hunter at launch** (real data today) → **Cashflow = destination** (unlocks when rent model ships). 4-agent convergence.
- **Builder persona = CUT** from launch (no zoning data; `multiplexByRight` hardcoded false; no IDX analytics carve-out).
- **Rope = "open the lobby, gate the vault"** — anonymous-first public *active* terminal; sold/AVM stay gated.
- **North-star magic moment = "Underwrite the whole map"** (per-listing real cash-on-cash, map recolors by your return) — gated, needs rent model.
- **Prod is down (Typesense 502 sustained); stabilize is Task #0.**

## The candidate moves (the ballot)

### Phase 0 — Stop the bleeding (cheap, unblocks everything)
- **A. Stabilize prod** — fix Typesense 502 outage, add sync/health alerting + Supabase circuit-breaker. [perf-arch #0]
- **B. Kill fake numbers now** — stop displaying `ExtrapolatedCapRate` + empty cap/yield (1-file; already falls back to "—"). [product-ux P0]
- **C. Flip `VOW_ENFORCE_TERMS=true` + audit brokerage-display** on every active surface (map popups, compare cells, ledger heart) — §6.3(c) breach vector. [compliance preconditions]

### Phase 1 — De-fake & cache (trust + SEO/scale foundation)
- **D. "De-fake the product"** — build real rent model from VOW leased (`raw_vow_sold` 219,880 + ~24k IDX lease) → light up the ALREADY-WIRED Yield/cashflow fields, AND fix the dead watchlist heart + dead drawer buttons. (product-ux M3 + data-quant M1 ship together — "fake heart and fake cap rate are the same bug class.")
- **E. Listing-page ISR/cache + move `/PropertyRooms` to ETL** — shared dependency for SEO + trust-spine + scale; low-effort (config+cache, no migration). [perf-arch #1]

### Phase 2 — The wedge & the funnel
- **F. "Open the lobby, gate the vault"** — anonymous-first public active terminal; **first tap = persona pick** that reshapes the view; application unlocks the vault. (growth + persona + competitive synthesis)
- **G. Flipper launch wedge** — True DOM + price-drop/distress + Capital Burn badge on the real 214k sold base (all populated today). [competitive M1 + persona]
- **H. "Underwrite the whole map"** — compute per-listing real cash-on-cash at index time; map recolors by your return. Gated; depends on D. [4-way convergence]

### Phase 3 — Differentiation & distribution
- **I. Glass-box condition-aware AVM** — per-feature breakdown + sold-price timeline (full = gated; aggregate/non-numeric teaser = public). HouseSigma admits in writing it can't tell renovated from gut. [competitive M2 + data-quant M2]
- **J. Uncapped count-only aggregate heat layer** beneath the ≤100 pins (active = public; sold = gated, min-N≥5). Beats HS's silently-truncated map. [perf-arch M1]
- **K. Share/referral loop** — double-sided invite codes (Safe, zero data dep) + active-deterministic Deal Card OG exports (AVM/sold numbers stripped). [growth M2 + data-quant]
- **L. Investor-Lens programmatic SEO + weekly report** — ON HOLD: `region_aggregates` 404, needs an active-IDX aggregate built first; templated prose only (no LLM, §6.2(k)). [growth M3 — deferred]
- **M. Mobile responsive floor** — lg-breakpoint Map/List toggle + mobile-readable distress/listing card. Fast-follow, not launch-blocker. [product-ux M1, demoted]

## Open questions R2 MUST resolve
1. **Anon teaser scope:** given "active *analytics* still hit §6.2(f)," what exactly can a logged-out user see on an active listing — raw price + raw DOM + a price-drop *fact*? Or only aggregates? (compliance + growth + competitive)
2. **L (SEO):** cut entirely, or fund building the active-IDX aggregate first? (growth + data-quant)
3. **J (heat layer):** launch or fast-follow? (perf-arch + product-ux)
4. **Is the A→B→C / D+E / F+G+H ordering right**, or does anything jump phases?
5. **Anyone still dissent** on Flipper-first or cutting Builder?
