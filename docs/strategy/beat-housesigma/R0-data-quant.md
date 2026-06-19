# R0 — data-quant (Data/Quant & AVM)

**Verdict in one line:** We have one genuinely defensible moat (a real hedonic AVM + 214k-row sold-price-history vault) wrapped in a *façade* of investor metrics — the cashflow-investor's headline numbers (cap rate, yield, cashflow) are **structurally empty in prod** because the tables that feed them do not exist. We are shipping a Bloomberg Terminal with the price feed unplugged.

---

## A. What I read (grounded)

- AVM engine: `src/lib/avm/calculator.ts`, `anchorService.ts`, `features.ts`, `matrixService.ts`, `types.ts`
- Value-Add / Force-Appreciation: `src/lib/avm/valueAdd/engine.ts`, `calibration.ts`, `moveCatalog.ts`
- Cap rate / yield / cashflow: `scripts/worker/services/financialMetrics.ts`, `rentAVM.ts`, `trueValueCalculator.ts`; `src/lib/typesense/ExtrapolatedCapRateEngine.ts`
- True DOM / sale history: `src/lib/typesense/TemporalDistressEngine.ts`; `property_sale_history` table
- Deal Score: `src/lib/dealScore/computeDealScore.ts`
- Wiring: `scripts/worker/transformer.ts:854-1019`
- **Live prod verified via Supabase REST + Typesense REST** (read-only counts, this session).

---

## B. Findings — REAL vs HOLLOW (with cites + live counts)

### REAL and populated — this is the actual edge

1. **The hedonic AVM is genuinely good and defensible.** Anchor-and-adjust over a standardized RidgeCV fit: `estimate = anchor · exp(clamp(Σβ·z))` (`calculator.ts:184-252`). It is **deterministic at request time** (constants from `avm_multiplier_matrix`), so it is **§4-clean** — no LLM touches listing data.
   - Live: `avm_multiplier_matrix` = **7,760 coeff rows**; `avm_audit_report` = **969 cohorts, every one ≥30 sales**.
   - Coefficient engine fires only when R² ≥ 0.5 (`types.ts:96`): **479/969 cohorts (49%)** clear it; **171 (18%)** clear the HIGH-confidence gate R²≥0.7. The other ~51% fall back to a real recency-weighted local **anchor** (still a genuine level, just no feature adjustment) — honest, not hollow.
   - It refuses to publish when the band is too wide (`calculator.ts:288-294`, suppress > BAND_LOW 0.25). Backtest on record: ~11.4% median |%err|, ~0 bias.
   - **This is the moat. HouseSigma's "HouseSigma value" is a black box; ours has a per-feature breakdown (`AVMAdjustmentBreakdown`) we can show.**

2. **`property_sale_history` is real shadow data — 214,516 rows.** Each row is a `property_hash` + a `sale_events[]` JSONB chain (`list_price`, `close_price`, `contract_date`, `close_date`). This is the raw material for True DOM *and* for the sold-price-history timeline that HouseSigma is famous for. **We own it; it is deterministic; it is populated.**

3. **`extrapolated_cap_rate` is populated ~100%** — `131,222 / 131,223` listings in the `listings` table carry a non-zero value (`transformer.ts:902`, `:1003`).

4. **Value-Add / Force-Appreciation engine is well-built and trust-gated.** `valueAdd/engine.ts:74-136` runs a real "trust gauntlet" (R² gate, thin-cohort gate, per-feature beta-sign/at-ceiling/null-baseline gates) and prices renovation deltas off the *same* hedonic coefficients. Deterministic, §4-clean. Genuinely unique vs HouseSigma.

5. **Deal Score** (`computeDealScore.ts`) is a clean 0–100 with renormalized weights so missing data never tanks it, and a transparent component breakdown. Good behavioral hook.

### HOLLOW — the known issue, **root cause located**

6. **`gross_yield_est`, `cap_rate_est`, `net_monthly_cashflow`, `tax_burden_ratio` are structurally empty/garbage in prod.** They are computed by `financialMetrics.ts`, which depends entirely on three Supabase tables — and **all three return HTTP 404 (they do not exist):**
   - `rental_market_index` → **404** (feeds `fetchRentAVM`, `rentAVM.ts:33`)
   - `city_region_avg_price` → **404** (feeds `fetchTrueValue`)
   - `municipal_mill_rates` → **404** (feeds `fetchMillRate`)
   
   Consequence chain: `fetchRentAVM` always returns `has_data:false` → `annual_rent = 0` (`rentAVM.ts:64-66`) → `gross_yield_est = 0` and `cap_rate_est = (−opex)/price` i.e. **negative** (`financialMetrics.ts:71-118`). The **#1 persona — Cashflow Investor — has no working yield, cap rate, or cashflow.** This is not a display bug; the data layer is absent.

7. **`ExtrapolatedCapRate` (the one cap field that IS populated) is a list-price-only illusion.** It uses **static assumptions: $5,500/mo gross rent, $120k capex, 25% opex, 4-month hold** for *every* property (`ExtrapolatedCapRateEngine.ts:61-92`, `:218-234`). So it is a deterministic monotonic transform of list price — a $400k bungalow and a $400k downtown condo get the *same* "cap rate." It is NOT a yield signal; it is `f(ListPrice)` cosplaying as one. Deal Score's "Yield" component (`computeDealScore.ts:230`) feeds on it, so that 20% of the score is noise dressed as analysis. **An investor who checks the math once will never trust us again** — this is a credibility landmine, not just an empty field.

8. **Repeat-sale linkage is thin.** Only **4,040 / 214,516 (1.9%)** property chains have ≥2 sale events; 79 have ≥3. Real (the data's just sparse over the window), but the `raw_vow_sold.property_hash` mismatch noted in memory (un-hashed address string vs SHA-256) means we are *under-linking* — some repeat sales aren't being stitched. The True-DOM relist-stitching depends on correct hashing.

9. **Operational red flag:** Typesense (the frontend's *exclusive* data source) returned **HTTP 502 "Application failed to respond"** on every call this session. Cold-start or down — but if the terminal's only backend is intermittently unreachable, "sub-50ms" is moot. Flagging for `perf-arch`.

---

## C. My 3 boldest moves

### MOVE 1 — Ship a REAL rent model and turn cap rate / yield / cashflow from vapor into a moat. *(Persona: Cashflow Investor #1)*
Build the missing `rental_market_index` from the data we already own: the **For-Rent listings in the IDX feed** (memory: TransactionType split = 24k lease docs) + leased records in `raw_vow_sold`. Aggregate deterministically in the ETL (median/p10 rent by city_region × subtype × beds × baths), persist the table, and the *already-written* `financialMetrics.ts` pipeline lights up — gross yield, cap rate, net cashflow, tax-burden ratio all become real with **zero new engine code**. Then **retire the static-$5,500 `ExtrapolatedCapRate`** or relabel it honestly ("model assumption, not this property's rent").
> **Beats HouseSigma:** HS shows price, not yield. A *real, per-property* cap rate + monthly-cashflow number on every listing card is a metric they structurally don't compute — and it's the exact number our #1 persona opens the app for. This is the single highest-leverage fix: the engine exists, only the feed table is missing.

### MOVE 2 — Expose the AVM's per-feature breakdown as "Why this estimate" + a sold-price-history timeline. *(Personas: Smart Homebuyer #3, Flipper #2)*
We already compute `AVMAdjustmentBreakdown` (sqft/lot/beds/baths/parking/interior/exterior/basement contributions) and own 214k sold chains. HouseSigma's estimate is an unexplained number. Show the **glass-box**: "Our $X estimate = neighbourhood anchor $Y, +$Z for the extra bath, −$W for the smaller lot," plus the property's own **sold-price timeline** (this house: 2019 $640k → 2023 $880k) from `property_sale_history`. Gate behind the VOW login (compliance — flag for `compliance`/`growth`).
> **Beats HouseSigma:** transparency they can't match without rebuilding their model, and a sold-history feature at parity *plus* the explanation. Trust is the conversion lever for the top-1% analytical user.

### MOVE 3 — Fix property-hash stitching, then ship "True DOM vs Posted DOM" as the flagship distress signal. *(Persona: Flipper / Deal Hunter #2)*
Recompute `raw_vow_sold` hashes with `generatePropertyHash()` (memory note) so relist chains actually link, widening the repeat-sale set beyond today's 1.9%. Then surface the delta we can compute that nobody shows: **"Posted 12 days — actually 96 days across 3 relistings, −$85k since first ask."** That's the cancel-and-relist tactic exposed (`TemporalDistressEngine.ts`), deterministic, and it directly feeds Deal Score's Motivation + Leverage components.
> **Beats HouseSigma:** HS shows the *current* listing's DOM. True-DOM-across-relists is the institutional "shadow data" in our mission statement — and it's the flipper's #1 question: "how desperate is this seller, really?"

---

## D. The thing I'll most challenge another camp on

**I will challenge `growth`/`competitive` if they propose a public, ungated AVM or public cap-rate/yield pages as the acquisition/SEO hook.** Two reasons: (a) **compliance** — VOW-derived valuation output is gated-use-only and risks API revocation (BRIEF §2, memory `vow-public-display-constraint`); (b) **data integrity** — until MOVE 1 lands, our headline investor metrics are *empty or fake* (`ExtrapolatedCapRate`), so leading acquisition with them would burn credibility with the exact analytical audience we're courting. **Sequence is non-negotiable: fix the data (MOVE 1) before we point a single growth dollar at "best cap rates in the GTA."** Equivalent-quality metrics aren't worth shipping (§10); *fake* ones are worse than nothing.
