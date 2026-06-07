# AVM Untrained-Cohort Estimate — Phase A Design

**Date:** 2026-06-06
**Status:** Approved — decisions locked 2026-06-06; ready for implementation planning
**Scope:** Phase A only. Phase B (city/region-grain model fitting) is scoped as a fast-follow, not built here.

---

## 1. Problem & evidence

The AVM ("PureProperty Estimate") badly over-valued **35 Pine Hill Crescent, Aurora** (listing `N13229524`): est **$1,725,502** vs a defensible ~$1.4M.

Root cause (confirmed by a live trace, not inferred):
- The home's community, **"Aurora Estates," has no trained coefficient model**. With no `avm_multiplier_matrix` row (R² ≥ 0.50), the engine runs **`ANCHOR_ONLY`** — a trend-adjusted *blind average* of the 13 in-community detached comps, with **0.00% feature adjustment**.
- Those comps are luxury-skewed (median sale $1.95M, median size 2,750 sqft, up to 4,250); the subject is ~2,226 sqft / 3-bath. A 4,250-sqft home and a 2,226-sqft home are averaged **as equals**.
- The size-aware **peer comp-grid** that *would* have corrected this never fired: its gate (`worthComparableCheck`) requires beds≥5 OR baths≥4 OR sqft≥2,500 OR lot≥6,000, and the subject sits **just under all four**.
- It was then labeled **"HIGH CONFIDENCE ±6.3%."**

This is not an isolated anecdote. The current backtest (10k leakage-safe sample, matches committed baseline) is **11.4% median |%err|, ~0 bias**, but accuracy is concentrated in the mid-market and **degrades sharply at the tails — worst in luxury** ($1.5M–2M: 17.0%, $2M+: 21.3%). The luxury tail is exactly where thin cohorts are untrained or noisy. Phase A targets that measured weak spot.

Bedrooms are **not** the cause (the "5 BEDS" display was a separate, already-fixed issue). The AVM only ever used 4 above-grade beds; size is its strongest feature (β present in 100% of cohorts) but is a coarse 500-sqft bucket midpoint — a resolution ceiling that is data-blocked (TRREB does not publish measured sqft for houses) and **out of scope here**.

## 2. Goals / Non-goals / Success criteria

**Goals (Phase A)**
1. Untrained cohorts estimate off **feature/size-matched comps**, never a blind cohort average.
2. Untrained cohorts **borrow a trained sibling cohort's coefficients** (same city + property type) to feature-adjust those matched comps — size β included.
3. Untrained estimates are **labeled honestly** and **never claim HIGH confidence**.
4. Close the **sale-price floor** gap so leases can't leak into the anchor comp set.

**Non-goals (deferred)**
- Phase B: fitting real city/region-grain models (the principled version of borrowing).
- Temporal train/test split for an honest gating R² (low urgency; backtest already gives true accuracy).
- Finer size resolution (data-blocked).
- Any change to the **trained-cohort** estimate path.

**Success criteria**
- *35 Pine Hill* (`N13229524`) estimates materially below $1.73M, toward the same-size-comp range (~$1.4M), at confidence ≤ MEDIUM, with a basis string that says it was comped/borrowed.
- Re-running the backtest harness: the **$1.5M+ tiers improve** (or at minimum don't regress); overall median |%err| ≤ current 11.4%.
- **Trained-cohort path unchanged** — golden-master green (with the one deliberate exception in §6).

## 3. The estimation ladder (Phase A)

| Cohort state | Comps | Adjustment | Basis | Max confidence |
|---|---|---|---|---|
| **Trained** community (R²≥0.50) | full cohort | native β (today) | `local` / `peer` (today) | unchanged |
| **Untrained**, trained sibling exists | **matched** | **borrowed sibling β** | `borrowed` (new) | **MEDIUM** |
| **Untrained**, no sibling | **matched** | none (matching only) | `peer` | **MEDIUM** |
| Too few comps anywhere | — | — | `floor` / `none` (today) | as today |

The trained row is **frozen** (save the one documented kernel exception in §6). All new behavior lives in the two untrained rows.

## 4. Component changes (with insertion points from recon)

### 4.1 — Matched-comp default for untrained cohorts (change "1")
The peer/matched-comp path already produces a recency × similarity-weighted, Huber-robust average and **works with zero coefficients** (`peerLevelFromComps`, `anchorService.ts:431`). Three gates currently keep it from firing for ordinary untrained homes; all must open together for untrained cohorts only:
- `shouldEvaluatePeers` / `worthComparableCheck` (`calculator.ts:95–114`): the **untrained branch** (`coefficients.length === 0`) returns `true` unconditionally. **Trained branch (`isFeatureOutlier`) untouched.**
- `fetchPeerAnchor` atypicality self-gate (`anchorService.ts:539, 575–577`): for the always-on untrained path, do not early-return `undefined` on low `cohortOutlierScore`.
- `estimateFromMarketData` `outlierGuard` (`calculator.ts:165–167`): already `true` for untrained — confirm it stays.

### 4.2 — Sqft in the similarity kernel
The match kernel (`similarityWeight` `anchorService.ts:410–420`, `lotSimLog` `:390–406`) weights on beds, baths, log-lot — **not size**. Add a Gaussian term on `log1p(sqft)`:
- **Subject** sqft = `resolveLivingArea` (room-sum of above-grade room dims when trustworthy, else the bucket) — already computed today (Aurora = 2,226).
- **Comp** sqft = `building_area_total`, the 500-sqft **bucket midpoint**, populated on ~82% of comps; missing → neutral factor 1 (no penalty, consistent with the existing kernel).

This is deliberately **asymmetric** — accurate room-sum on the subject vs. coarse buckets on the comps — but the distance still cleanly separates a mid-size home from a mansion (2,226 is unambiguously nearer the 2,250-bucket comps than the 4,250 ones), which is the differentiator the Aurora case needs. Comps **cannot** be room-summed here: `raw_vow_sold` has no room-dimension column, JSONB scans across ~217k rows time out, and the table is schema-frozen. **Applies wherever the matched-comp kernel runs** (all untrained cohorts + the trained-outlier subset) — see §6.

> *Phase B candidate:* precompute a comp-side room-sum GLA into a side table so the comp axis stops being bucket-limited.

### 4.3 — Sibling-coefficient borrow (change "2-Borrow")
On a community miss, `fetchCoefficients` (`matrixService.ts:20–53`) and `fetchAuditInfo` (`auditService.ts:26–57`) currently return empty/null. Add a **sibling fallback** to both (they must move together — the engine gates on `audit.r2` at `calculator.ts:188`):
- Resolve the subject's **city** (`AVMInput` carries `City`; comps/`raw_vow_sold` carry `city`).
- Find trained sibling cohorts: same city, same normalized `property_sub_type`, `model_accuracy_score ≥ 0.50` AND `total_sales_analyzed ≥ 30`.
- **Selection policy:** pick **max `total_sales_analyzed`**, tie-break **max R²**. (Most-data sibling = most stable elasticities.)
- Return that sibling's β/mean/std + R²/n, **plus a `matchedGrain` marker** (`'community' | 'sibling'`) so the calculator can set basis + cap confidence.
- City→city_region resolution: Phase A uses a small runtime query against `raw_vow_sold` (distinct `city_region` for the subject's `city` + sub-type) intersected with trained audit cohorts. (Phase B replaces this with true city-grain rows.)

The borrowed coefficients then flow through the **existing** matched-comp path (`adjustedLogPrice` neutralizes each matched comp toward the subject's features using the borrowed β), so no new estimation math is introduced — only a new coefficient *source*.

### 4.4 — Confidence & basis labeling (change "honesty")
- Add **`'borrowed'`** to the `AnchorBasis` union (`types.ts:37–44`). (`'parent'` is already taken with a different meaning — do not overload.)
- **Cap confidence for both untrained rows at MEDIUM** (mirror the floor-demotion at `calculator.ts:172–177`): an untrained estimate — borrowed or matched-only — may never be HIGH. This directly fixes the "community average labeled HIGH CONFIDENCE" defect.
- User-facing strings: add a `basisCopy` case for `'borrowed'` in `ListingEstimateCard.tsx:124–150` (e.g. *"Comped against N size-matched sales, adjusted with the {City} {Type} model"*) and ensure the matched-only `'peer'` string reads honestly for untrained. Optionally surface in `AVMResultDisplay.tsx` (labels `engineMode` only today).

### 4.5 — Sale-price floor (data hygiene)
`fetchAnchor`'s comp pull (`anchorService.ts:125`) filters only `close_price > 0` — no minimum-sale floor — so leases (monthly rent as `close_price`) can leak in (the trace found a $3,250/mo row). Apply the **existing shared `MIN_SALE_PRICE` constant** (already used on the other comp reads — see memory `avm-lease-pollution`) to this pull. Small, isolated, correct regardless of the rest.

## 5. Data flow (subject → estimate)

`getListingDetail` → `mapListingToAVMInput` (adds `City`, resolved sqft) → `calculateAVM`:
1. `fetchCoefficients` + `fetchAuditInfo`: community hit → trained path (unchanged). Community miss → **sibling borrow** (§4.3) → returns borrowed β + `matchedGrain='sibling'`, or empty if no sibling.
2. `fetchAnchor` / `fetchPeerAnchor`: untrained → always pull **matched comps** (§4.1), size-weighted (§4.2), price-floored (§4.5); neutralize with borrowed β if present.
3. `estimateFromMarketData`: emit estimate with basis `'borrowed'` (β present) or `'peer'` (matched-only), confidence capped at MEDIUM (§4.4).

## 6. Do-not-disturb invariants

- The **trained, non-outlier** path must remain byte-identical. `calculator.goldenmaster.test.ts` and `calculator.peer.test.ts` are the guardrail.
- **One deliberate exception (decided):** the normal trained path uses the coefficient engine and **never touches the matched-comp kernel**, so it is unaffected. The sqft term (§4.2) *does* change the **trained-outlier** subset (the only trained case that pulls comps) — size-matching is an improvement there, so we **rebaseline those specific peer expectations on purpose** and document the diff. The full backtest re-run is the guardrail that trained accuracy doesn't regress.
- Shared consumers to keep green: `api/avm/route.ts`, `api/avm/hidden-equity/route.ts`, `valueAdd/engine.ts:251–252` (calls the same `fetchCoefficients`/`fetchAuditInfo` — signature changes ripple here), `scripts/admin/refresh-property-estimates.ts` (nightly precompute).

## 7. Open decisions (with recommended defaults)

1. **Sibling selection:** max `total_sales_analyzed`, tie-break max R², gated R²≥0.50 & n≥30. *(Recommended; simple and stable.)*
2. **Sqft kernel reach — RESOLVED (2026-06-06):** applies wherever the matched-comp kernel runs (untrained + trained-outliers); rebaseline the trained-outlier peer test deliberately. The normal trained path doesn't use the kernel, so it stays byte-identical; the backtest re-run guards regression.
3. **Sqft bandwidth `BW_SQFT`:** start at log-space ~0.20, tune against the Aurora case + backtest.
4. **Borrowed standardization:** borrow the sibling's mean/std as-is (elasticity transfer). Capped confidence accounts for the approximation. *(Recommended; revisit in Phase B.)*

## 8. Testing plan

- **Unit (vitest, node-env — pure logic only):**
  - sibling-borrow lookup: finds best sibling, respects R²/n gate, returns `'sibling'` grain; returns empty when no sibling.
  - untrained-always-peers gate opens; trained gate unchanged.
  - sqft similarity weighting (closer sqft → higher weight; missing → neutral).
  - sale-price floor drops sub-floor (lease) comps.
  - confidence cap: untrained never HIGH; basis `'borrowed'` vs `'peer'`.
- **Golden master:** trained non-outlier frozen; trained-outlier peer cases rebaselined intentionally (§6).
- **Integration / backtest:** re-run `.claude/worktrees/avm-backtest/scripts/admin/avm-backtest.ts` (sampled), compare the $1.5M+ tiers and overall median |%err| before/after.
- **Named regression:** `N13229524` (Aurora) estimates < $1.73M toward ~$1.4M, confidence ≤ MEDIUM, basis `'borrowed'`.

## 9. Out of scope (explicit)

- Phase B city/region-grain model fitting (extend the Colab trainer; version it into the repo).
- Temporal split for honest gating R²; finer size resolution; any new model feature (e.g. below-grade bedroom count).
- The display fix (already shipped: `bedsLabel` SSOT, detail page shows "4+1").

## 10. Phase B (preview, not built here)

Extend the offline RidgeCV trainer to emit `city`- and `region`-grain matrices; add a `grain` column to `avm_multiplier_matrix` / `avm_audit_report`; the §4.3 ladder then finds real parent matrices instead of siblings. This is the principled pooling fix for thin/luxury cohorts and the highest-leverage accuracy improvement available without new data.
