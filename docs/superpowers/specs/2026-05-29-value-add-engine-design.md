# Value-Add Engine — Design Spec

- **Date:** 2026-05-29
- **Status:** Approved design → ready for implementation plan
- **Topic:** Per-micro-market renovation value-add / force-appreciation ROI feature
- **Working names:** "Value-Add Engine" (investor surface), "Hidden Equity" (consumer surface), "Value-Add Score" (quotable index)
- **Author context:** PureProperty.ca — "Bloomberg Terminal for Canadian Real Estate"

---

## 1. Context — why we're building this

The AVM already stores, per `(city_region × property_sub_type)`, a **local hedonic model**: for 8 standardized features it keeps `beta` (log-space semi-elasticity), `mean`, `std` (`avm_multiplier_matrix`), plus `R²`, sample size `n`, and `base_price` (`avm_audit_report`). Today this data is used in **one direction only**: features → a single AVM estimate.

But each `beta` also encodes *what a specific neighbourhood pays for* a given attribute. Run the model **backwards** and it answers the single most valuable question a homeowner/investor has: **"What renovation adds the most dollars to *this* home in *this* neighbourhood — and does it pay back?"** No consumer portal (HouseSigma, Realtor.ca) can answer this; they have neither per-micro-market hedonics nor sold-data depth. This directly serves the CLAUDE.md **Flipper** ("force appreciation") and **Smart Homebuyer** ("hidden basement value") personas, and is a consumer-viral hook for owners.

### The critical finding that shapes the design

A validation pass computed real value-adds on three actual cohorts. **The naive `β × Δfeature` math is unsafe to ship** — roughly half the cells were nonsensical:

| Cohort (R², n) | Finish basement | Add bathroom | Add bedroom | +500 sqft |
|---|---|---|---|---|
| Brampton West / Detached (0.70, 117) | +$55k ✅ | +$39k ✅ | +$27k ✅ | +$39k ✅ |
| Erin Mills / Condo (0.91, 70) | $0 stub ❌ | +$94k ❌ | **−$34k** ❌ | +$212k ❌ |
| Churchill Meadows / Townhouse (0.85, 172) | +$30k ✅ | +$39k ✅ | +$94k ❌ | +$58k ✅ |

Well-behaved suburban detached/townhouse cohorts are dead-on and cross-check against real GTA reno costs. Condos and noisy/degenerate features blow up (negative betas, placeholder stubs, runaway dominant betas, tiny-std inflation). **The accuracy/trust layer is therefore the core of the product, not a finishing touch** — it is the moat and the thing that keeps the feature shareable rather than embarrassing.

### Hard constraints

- **Deterministic only, no LLM** in the value path (CLAUDE.md §4). The marginal value is pure arithmetic over precomputed `beta/mean/std`.
- **Reuse the AVM math**, never re-implement it — the reno engine must never drift from the live estimate.
- **VOW/IDX display rules** for any sold/comp context; brokerage display preserved on listing surfaces.

---

## 2. Goals & non-goals

**Goals**
- A shared, pure, deterministic **Value-Add Engine** that turns the per-cohort hedonics into a ranked, costed, calibrated list of renovation moves for any Ontario home.
- A **standalone owner-facing tool** (Phase 1) and an **on-listing wrapper** (Phase 2) over the same engine.
- A **screenshot-ready Value-Add Report** with a headline "Hidden Equity" number, ranked moves (value → cost → payback), and a counterintuitive neighbourhood insight.

**Non-goals**
- No new statistical model / no re-fit in this project (we consume existing matrices; a calibrated regional prior for the dominant condo sqft beta is a clamp, not a refit).
- No lot assembly / severance moves (lot_width is out of scope — requires land assembly).
- No address→property resolution in Phase 1 (manual home description sidesteps it).

---

## 3. Architecture overview

```
                ┌─────────────────────────────────────────────┐
                │  Value-Add Engine (pure, deterministic)      │
 subject home → │  reuses avm/features + avm/calculator math   │ → ValueAddReport
 + cohort data  │  ├─ Move Catalog (named, bundled moves)      │
                │  ├─ marginal/stacked value (exp form)        │
                │  ├─ Trust & Calibration layer (THE spine)    │
                │  └─ Cost/ROI layer (GTA benchmark table)     │
                └─────────────────────────────────────────────┘
                         ▲                         ▲
            Phase 1: Standalone tool      Phase 2: On-listing card
            (neighbourhood + describe)    (/properties/[id], autofilled)
```

The engine is one module; both surfaces are thin callers. Public SEO neighbourhood pages ("where finishing a basement pays back most") fall out of the same per-cohort computation.

---

## 4. Core engine spec

**Location:** new `src/lib/avm/valueAdd/` (`engine.ts`, `moveCatalog.ts`, `costTable.ts`, `calibration.ts`, `types.ts`).

**Inputs:** the subject's 8-feature vector (`AVMInput`) + the cohort's market data (`anchor`, `coefficients`, `audit{r2, basePrice, n}`) — fetched via the **existing** `fetchAnchor` / `fetchCoefficients` / `fetchAuditInfo` so cohort lookup, the prefixed-`city_region` candidate resolution, and gating all match the AVM exactly.

**Per-move marginal value (exact, multiplicative):**
```
P0 = subject's own AVM point estimate (estimateFromMarketData)   // NOT cohort base_price
z0 = clamp((x0 − mean)/std, ±Z_CLAMP)      // current value
z1 = clamp((x1 − mean)/std, ±Z_CLAMP)      // post-reno target
marginalValue = P0 × (exp(β·(z1 − z0)) − 1)
```
- **Exp form, not linearized** `β·(z1−z0)` — the model is multiplicative (`estimate = anchor·exp(Σβz)`); the linear form (which the existing display `breakdown` uses) materially understates large renos and must NOT be reused as the marginal value.
- **Anchor on `P0` (subject estimate), not `base_price`** — base_price is a cohort intercept and mis-scales any home far from it (empirical red flag).

**Stacking multiple moves (no double-counting):** one **joint re-evaluation difference**, never a sum of move cards:
```
Δ$ = anchor × ( exp(clamp(Σβ·z_after, ±ADJ_CLAMP)) − exp(clamp(Σβ·z_before, ±ADJ_CLAMP)) )
```
applied to a single post-state vector with all selected moves (incl. collinear bundle deltas). For per-move attribution within a stack, use an order-averaged (Shapley) split of that same re-evaluation — not standalone move values.

**Reuse points (refactor, don't duplicate):**
- Export a `FEATURE_SPECS` table out of `src/lib/avm/features.ts` (the inline 8-feature list, incl. the `interior=6−tier`, `exterior=5−tier`, `basement=10−tier` conversions) and have both `featureContributions` and the engine consume it. Keeps null-skip, `β===0`/`std≤0` guard, and z-clamp identical.
- Reuse exported `clamp`, `fetchCoefficients` (+`cityRegionLookupCandidates`), `fetchAnchor`, and `estimateFromMarketData`.
- `auditService.ts`: **add `total_sales_analyzed` to the select** and thread `n` into `AuditInfo` (currently only `r2`, `basePrice`).

---

## 5. The Move Catalog

Moves are **physical bundles mapped to achievable tier transitions**, not arbitrary single-coefficient bumps. Tier→score is converted *before* standardizing. Costs are 2024–2026 GTA benchmarks (sourced; editable assumptions in UI).

| Move | Feature bundle Δ | Tier/target | Cost low–typ–high (CAD) |
|---|---|---|---|
| Finish basement | `basement_score` → finished (tier 7→~3, score 5→8–9) | achievable finished tier | $32k–52k–80k (~800 sqft) |
| Legal secondary suite | `basement_score` → top + `bathrooms_total` +1 (2nd kitchen noted) | tier→2; suite | $60k–95k–180k (+underpinning ~$50–80k if needed) |
| Add full bathroom | `bathrooms_total_integer` +1 | — | $12k–20k–35k |
| Add legal bedroom | `bedrooms_below_grade` +1 (NOT above-grade for basement) + `basement_score` +1–2 | egress + partition | $4k–9k–16k |
| Interior refresh — Good | `interior_score` +1–2 | tier→good | $60–80–100 /sqft refreshed |
| Interior refresh — Excellent | `interior_score` +2–3 | tier→excellent | $100–150–200 /sqft refreshed |
| Add parking space | `parking_total` +1 (`exterior_score` +0/1) | surface pad | $2.5k–6k–12k |
| Build detached garage | `parking_total` +1–2 (`exterior_score` +0/1) | single/double | $42k–70k–120k |
| Curb-appeal / exterior | `exterior_score` +1–3 | scope-dependent | $5k–20k–80k |

**Feature-mapping rules baked in:** finishing/legalizing a basement moves `basement_score`, **not** `building_area_total` (TRREB BuildingAreaTotal is above-grade GLA); a basement egress bedroom increments **below-grade** beds, not `bedrooms_above_grade`; `lot_width` is never moved by these.

---

## 6. Trust & Calibration layer (the spine)

Every move runs this gauntlet before it earns a dollar figure. Failing a gate → the move is **suppressed** (shown as qualitative guidance or hidden), never shown with a wrong/negative number.

**Cohort gates**
- `R² ≥ 0.50` (`COEFFICIENT_ENGINE_THRESHOLD`) — else anchor-only cohort: no betas → no dollar moves, qualitative only. `R² ≥ 0.70` → firm number; `0.50–0.70` → wider indicative range.
- `n ≥ 30` (`total_sales_analyzed`) — high R² on tiny n is overfit.

**Feature gates**
- `β > 0` — drop/floor negative or ≈0 betas (the −$34k condo bedroom; noisy exterior/interior sign-flips). A value-positive move can never display negative value-add.
- Non-degenerate row — drop placeholder stubs (`β==0`, or `std≤1` with `mean ∈ {0,1}` — e.g. condo `basement_score`/`lot_width`).
- Feature resolved via `fetchCoefficients` candidate list (prefixed-`city_region` safe).
- **Non-null baseline** — only offer a move on a feature the home actually reports; never compute a delta from a mean-imputed (null→z=0) baseline.
- **Ceiling-aware** — if current value ≥ `mean + ~2·std` or post-move `z` pins at `±Z_CLAMP`, suppress and **route to the existing peer comp-grid** ("see comparable high-end homes") instead of quoting a fantasy premium.

**Magnitude calibration**
- **Sanity caps** per move type (absolute + %-of-home): basement $30–150k, bath $10–60k, bedroom $15–50k, sqft via a regional `$/sqft` band. Kills the +$212k sqft and $94k bedroom outliers.
- **Regional prior for dominant betas** — clamp a single cohort's runaway beta (condo `building_area_total` β=0.23) toward a believable cross-cohort `$/sqft`.
- **Tiny-std guard** — down-weight a discrete +1 unit move that exceeds ~1 std (floor the effective std) so one bath/bed isn't scored as a 1.5–2 std swing.

**Clamp handling**
- `Z_CLAMP=±3` on both endpoints — **keep** (legitimate domain bound; same scale betas were fit on). A move whose `z1` is already clamped honestly adds $0 → surface as "no further modeled premium."
- `ADJ_CLAMP=±0.4` — **not** applied to the per-move marginal (it caps the *total* estimate / triggers the peer grid). BUT validate the **post-reno headline price** against it: if the renovated home becomes a feature-space outlier (`isFeatureOutlier`), route the after-value through the peer/floor path — never advertise an `exp(unclamped)` number the AVM itself would refuse to publish.

**Framing**
- Always a **range**, anchored on the model band (`predSD`) and suppressed when `predSD > BAND_LOW`. Ridge shrinkage biases betas low → frame as "typically adds at least…".
- Copy: *"Homes like yours that did this typically sold for ~$X–$Y more"* + "modeled estimate, not an appraisal or guarantee" + basis ("based on N sales through <date>").

---

## 7. Output shape

```ts
interface ValueAddMove {
  key: string;                 // 'finish_basement' | 'add_bathroom' | ...
  label: string;
  status: 'priced' | 'qualitative' | 'suppressed';
  suppressedReason?: string;   // 'negative_beta' | 'placeholder' | 'low_r2' | 'at_ceiling' | 'null_baseline' | 'thin_cohort'
  valueAddLow: number; valueAddTyp: number; valueAddHigh: number;
  costLow: number; costTyp: number; costHigh: number;
  netGainTyp: number;          // valueAddTyp − costTyp
  paybackRatio: number;        // valueAddTyp / costTyp
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
}

interface ValueAddReport {
  cityRegion: string; propertySubType: string;
  subjectEstimate: number;     // P0
  headlineUpside: number;      // jointValueAdd(positive-payback priced moves, one re-eval) − Σ(their typical costs); value-adds are NOT summed, costs are
  valueAddScore: number;       // 0–100 quotable index (see §8)
  moves: ValueAddMove[];       // ranked by netGainTyp desc
  neighbourhoodInsight: string;// deterministic templated, e.g. "This area pays most for a 2nd bathroom; extra bedrooms add little"
  basis: string;               // "Based on 117 Brampton West detached sales through May 2026"
  disclaimer: string;
}
```
`neighbourhoodInsight` is **templated from ranked betas deterministically** (no LLM) — pick top/bottom value drivers and slot into fixed sentence templates.

---

## 8. Surfaces, viral mechanics & Value-Add Score

**Phase 1 — Standalone tool** (`/value-add` or `/equity`): pick neighbourhood + subtype → "describe your home" form (beds, baths, sqft, basement state, condition, parking) → instant **Value-Add Report**. Includes editable cost assumptions and a **shareable card** (OG image: "Hidden Equity in <Neighbourhood>: $X", top-3 moves, Value-Add Score, brand). Public per-neighbourhood SEO pages rank moves across all cohorts ("GTA neighbourhoods where finishing a basement pays back most") — this is the cross-market screener falling out for free.

**Phase 2 — On-listing wrapper** (`/properties/[id]` right rail): a "Force-Appreciation upside on this property: +$Xk" card, prefilled from the listing's real features, linking to the full report. Thin caller over the same engine; sits beside `ListingEstimateCard` / `UnderwritingSandbox`.

**Value-Add Score** (quotable 0–100): a normalized index of unlockable equity, e.g. `min(100, round(k · totalNetUpside / subjectEstimate))` (k tuned so a typical strong opportunity lands ~70–90). Bounded, monotone, shown as the headline badge. Exact `k`/curve tuned in implementation against real cohort distributions.

**Viral hooks:** the personalized $ headline, the *counterintuitive* neighbourhood insight, the branded Score, the share card, and the SEO leaderboards.

---

## 9. Data / infra changes

- `src/lib/avm/auditService.ts`: add `total_sales_analyzed` to select; extend `AuditInfo` with `n`.
- `src/lib/avm/features.ts`: export `FEATURE_SPECS` (shared registry incl. tier→score extractors).
- New `src/lib/avm/valueAdd/*` (engine, moveCatalog, costTable, calibration, types).
- Cost table is a versioned constant (sourced ranges in §5); editable assumptions are client-side overrides.
- Optional precompute: a per-cohort "value-add summary" (ranked drivers + best move) to power SEO pages without recomputing live.

---

## 10. Testing / verification

- **Golden cohort tests** using the three validated cohorts:
  - Brampton West Detached → all four moves priced and within sane bands.
  - Erin Mills Condo → basement **suppressed (placeholder)**, bedroom **suppressed (negative β)**, +500 sqft **capped** by regional prior, bathroom **capped**.
  - Churchill Meadows Townhouse → bedroom **capped**, basement/bath/sqft priced sane.
- **Invariants:** no negative value-add ever displayed; suppressed moves carry a reason; stacked value ≠ sum of cards (joint re-eval); a known prefixed cohort (`'1001 - BR Bronte'`) resolves coefficients; anchor-only (R²<0.5) cohort returns zero priced moves.
- **Engine-vs-AVM reconciliation:** the report's `subjectEstimate` equals `estimateFromMarketData` for the same input.
- **End-to-end:** run the standalone tool for a known neighbourhood; verify the report card and share image render with believable numbers.

---

## 11. Build order (to hand to writing-plans)

1. **Engine foundations** — refactor `FEATURE_SPECS` out of `features.ts`; extend `auditService` with `n`; scaffold `valueAdd/types.ts`.
2. **Core value math** — `marginalFeatureValue` + joint stacking, anchored on `P0`, exp form; unit tests vs hand-computed cohort numbers.
3. **Move Catalog + Cost table** — named bundled moves, tier transitions, GTA cost ranges, payback.
4. **Trust & Calibration layer** — all gates/caps/priors; golden cohort tests (the spine — most of the value lives here).
5. **Report assembly** — `ValueAddReport`, ranked moves, headline upside, Value-Add Score, templated neighbourhood insight, basis/disclaimer.
6. **Phase 1 standalone tool** — route, describe-your-home form, report UI, editable assumptions, shareable OG card.
7. **(Stretch) SEO neighbourhood pages** — per-cohort precompute + leaderboards.
8. **Phase 2 on-listing wrapper** — right-rail card on `/properties/[id]`, prefilled.

---

## 12. Compliance checklist

- [ ] No LLM anywhere in the value path (deterministic arithmetic over stored betas) — §4.
- [ ] "Modeled estimate, not an appraisal/guarantee" disclaimer on every dollar figure.
- [ ] Any sold/comp context obeys VOW display rules; brokerage display preserved on listing surfaces.
- [ ] Matrix reads go through `fetchCoefficients`/candidate resolution (prefixed `city_region` safe); never paginate matrix above the 1000-row cap.
