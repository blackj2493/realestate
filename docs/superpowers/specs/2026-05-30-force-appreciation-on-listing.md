# Force-Appreciation On-Listing Card — Design Spec

**Date:** 2026-05-30
**Phase:** Value-Add Engine, Phase 2a (first user-visible surface)
**Depends on:** Phase 1 core engine (`src/lib/avm/valueAdd/`), shipped 2026-05-29.

---

## 1. Objective

Make the Value-Add Engine visible for the first time: a server-rendered **"Force-Appreciation"** card in the listing page's sticky right rail (directly under the "PureProperty Estimate" card) that prices the renovation moves the engine can confidently model for *this* home — showing value, cost, and payback — and is honest about the moves it cannot price.

This is the on-listing wrapper. The standalone "Hidden Equity" consumer tool, the OG share card, and SEO neighbourhood pages are later Phase-2 sub-projects and are **out of scope** here.

## 2. Why this is worth shipping (§10 bar)

HouseSigma/Realtor.ca show an estimate; neither shows *what a specific renovation is worth in this micro-market, net of cost, with a payback ratio* — and neither is honest about what it can't price. This card exposes ROI math competitors hide and pairs it with a deterministic "why not these" trust signal. Measurably more insight, on a property they're already looking at.

## 3. Naming

The on-listing card is **"Force-Appreciation"** (a CLAUDE.md §1 term). We deliberately do **not** call it "Value-Add" on this page: a *"Value-Add" persona search-filter set* already exists in `CommandCenterSidebar.tsx`, and reusing the label would conflate a search filter with a renovation-ROI feature. The name "Hidden Equity" is reserved for the future consumer standalone tool.

## 4. Non-goals

- No interactive sliders / what-if controls (that is the standalone tool + the existing `UnderwritingSandbox`).
- No new client-side data fetching; no client JavaScript for the data path.
- No changes to the AVM math, the move catalog, the calibration trust layer, or any sold/VOW data path.
- No LLM anywhere (CLAUDE.md §4) — the only prose is the engine's existing deterministic template string.

## 5. Architecture & data flow

The listing page (`src/app/(app)/properties/[id]/page.tsx`) is a server component fed by `getListingDetail(id)`, which already:
- builds the canonical `AVMInput` via `mapListingToAVMInput(payload, { rooms, bucketCalibration })`, and
- computes the displayed estimate via `calculateAVM(supabase, avmInput)` → `detail.estimate` (`AVMResult`).

We extend this **server-side, best-effort** (identical try/catch pattern to `estimate`/`feeStability`/`dealScore` — a failure degrades to `null`, never blocks the page):

1. In `getListingDetail`, after `estimate` is computed: **only if** `estimate?.estimatedValue > 0`, call the engine for a report, reusing the same `avmInput` and **anchoring on the already-displayed estimate**:
   ```ts
   valueAdd = await fetchValueAddReport(supabase, avmInput, {
     subjectEstimate: estimate.estimatedValue,
     predSD: estimate.predictiveSD,
   });
   ```
   Otherwise `valueAdd = null`.
2. Add `valueAdd: ValueAddReport | null` to the `ListingDetail` interface.
3. In `page.tsx`, render `<ForceAppreciationCard report={detail.valueAdd} />` in the sticky rail immediately after `<ListingEstimateCard>`. The component returns `null` when the report should not render, so it is always safe to include.

### 5.1 P0 consistency (correctness guarantee)

The card must never contradict the estimate shown directly above it. The engine's `buildValueAddReport` currently derives P0 by recomputing `estimateFromMarketData(input, market)`, which can differ from the displayed `calculateAVM` result for outlier homes priced on the peer/floor basis. We therefore thread an **optional P0 override** so the on-listing card anchors on `detail.estimate.estimatedValue`. Because every move value is `P0 · (exp(Δ) − 1)`, overriding P0 scales the whole report linearly — exact and clean.

### 5.2 IO budget (avoid a second comps query)

`calculateAVM` already runs the expensive anchor/comps query to produce `detail.estimate`. The engine only needs the anchor for **one** scalar — `predSD` (the move band half-width) — which `AVMResult` already exposes as `predictiveSD`. So the on-listing call passes `predSD` and the P0 override, letting `fetchValueAddReport` **skip `fetchAnchor` entirely**. The only added work per page is two cheap indexed point-lookups (`fetchCoefficients`, `fetchAuditInfo`). (A later optimization could thread `calculateAVM`'s already-fetched market data through to remove even those; explicitly a fast-follow, not in scope.)

## 6. Engine changes (`src/lib/avm/valueAdd/engine.ts`)

Two additive, backward-compatible changes. All existing call sites and tests keep working when the new options are omitted.

### 6.1 `buildValueAddReport(input, market, opts?)`

```ts
interface BuildOpts { subjectEstimate?: number }

export function buildValueAddReport(
  input: AVMInput, market: AVMMarketData, opts?: BuildOpts
): ValueAddReport {
  const P0 = opts?.subjectEstimate && opts.subjectEstimate > 0
    ? opts.subjectEstimate
    : estimateFromMarketData(input, market).estimatedValue;
  if (P0 <= 0) return unavailableReport(input, market);
  // ...unchanged: evaluate moves on P0, greedy non-overlapping selection, joint re-eval...
}
```

Add one field to `ValueAddReport`: **`headlineUpsideGross: number`** = `Math.round(jointValue)` (the capped joint gross value, before costs). `headlineUpside` stays NET. This gives the card both a gross "unlockable" number and a net number without re-deriving from the score.

### 6.2 `fetchValueAddReport(supabase, input, opts?)`

```ts
interface FetchOpts { subjectEstimate?: number; predSD?: number }
```
- Always fetch `coefficients` + `audit` (cheap point-lookups).
- If `opts.predSD` is a finite number, build a minimal anchor (`predSD` set; other fields zeroed) and **skip `fetchAnchor`**. Otherwise fetch the anchor as today.
- Forward `{ subjectEstimate: opts?.subjectEstimate }` into `buildValueAddReport`.

(`evaluateMove` already reads only `market.anchor.predSD`, falling back to `0.1` when non-finite, so a minimal anchor is sufficient.)

## 7. View-model (`src/components/Property/forceAppreciationView.ts`) — pure, tested

The component renders a view-model; all decision/format logic is here so it can be unit-tested in the node-env (no jsdom).

```ts
export interface LedgerRow {
  key: string; label: string;
  valueTyp: number; costTyp: number; payback: number; // payback = paybackRatio
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
}
export interface SuppressedRow { key: string; label: string; reason: string } // reason = human copy
export interface ForceAppreciationView {
  score: number;            // valueAddScore 0–100
  headlineGross: number;    // headlineUpsideGross
  headlineNet: number;      // headlineUpside
  insight: string;          // report.neighbourhoodInsight
  basis: string;            // report.basis + " · modeled, not appraised"
  topRows: LedgerRow[];     // top 3 priced moves by net gain
  moreRows: LedgerRow[];    // remaining priced moves (disclosure)
  suppressed: SuppressedRow[]; // suppressed moves with copy (disclosure)
}

export function shouldRender(report: ValueAddReport | null): report is ValueAddReport;
export function buildView(report: ValueAddReport): ForceAppreciationView;
export function suppressReasonCopy(reason: SuppressReason): string;
```

- **`shouldRender`**: `report != null && report.subjectEstimate > 0 && report.moves.some(m => m.status === 'priced')`.
- **Ordering**: `report.moves` already arrive sorted by `netGainTyp` desc. `topRows` = first 3 priced; `moreRows` = priced beyond the first 3; `suppressed` = `status === 'suppressed'` (preserve order).
- **`suppressReasonCopy`** mapping:
  | reason | copy |
  |---|---|
  | `negative_beta` | "the local market doesn't pay extra for this" |
  | `placeholder` | "not enough local signal to price this" |
  | `low_r2` | "too few comparable sales to model this area" |
  | `thin_cohort` | "too few comparable sales to model this area" |
  | `at_ceiling` | "this home is already top-of-market on this" |
  | `null_baseline` | "this home is missing the data needed" |
  | `already_present` | "already present in this home" |
  | `no_estimate` | "no estimate available for this home" |

## 8. Component (`src/components/Property/ForceAppreciationCard.tsx`) — server, zero client JS

- Server component. `if (!shouldRender(report)) return null;` then `const v = buildView(report)`.
- Wrapped in the same `Card`/`CardHeader`/`CardTitle`/`CardContent` primitives as `ListingEstimateCard`, matching the dark rail aesthetic.
- Header: title **"Force-Appreciation"** + a score chip `{v.score}/100`.
- Headline line: `up to {formatPrice(v.headlineGross)} unlockable · best net {formatPrice(v.headlineNet)}`.
- Insight line (`v.insight`), muted, when non-empty.
- Ledger: `v.topRows` each as `label · +{valueTyp} · −{costTyp} · {payback}× ` with a small payback bar (CSS width = `min(payback, 3) / 3`, no JS).
- Disclosure via native **`<details>`** (`<summary>`: "Why not the others?"): renders `v.moreRows` (as ledger rows) then `v.suppressed` (label + reason copy). Fully SSR'd, crawlable, no hydration.
- Footer: `v.basis`.
- Visible to anonymous **and** signed-in users (IDX-derived; no VOW sold prices), consistent with anonymous-first.

## 9. Compliance (CLAUDE.md §4)

- Deterministic end to end; reuses the Phase-1 engine. No raw IDX/VOW listing data is transformed by any LLM.
- No VOW sold prices/dates rendered; the card uses the active `listings` payload + precomputed coefficients only.
- Brokerage display and all existing cards are untouched.
- ≤100-listing display limits and data-freshness rules are unaffected (single-listing page).

## 10. Testing (vitest, node-env — no jsdom, per project constraint)

Pure-logic only; UI verified by typecheck + lint + build + manual (the established pattern).

1. **Engine — P0 override** (`engine.*.test.ts`): with `opts.subjectEstimate = K`, `report.subjectEstimate === K` and each priced move's `valueAddTyp` equals the no-override value scaled by `K / P0_default` (within rounding). With override omitted, output is byte-for-byte unchanged from today.
2. **Engine — `headlineUpsideGross`**: equals the capped joint gross; `headlineUpsideGross >= headlineUpside`; both `0` in the unavailable report.
3. **Engine — predSD path** (`fetchValueAddReport`): when `opts.predSD` is supplied, `fetchAnchor` is **not** called (spy) and the report still prices moves; when omitted, `fetchAnchor` is called (existing behaviour).
4. **View-model** (`forceAppreciationView.test.ts`): `shouldRender` truth table (null / `subjectEstimate=0` / all-suppressed → false; ≥1 priced → true); `buildView` top-3 selection + ordering, `moreRows`/`suppressed` partition, headline/score/basis wiring, `suppressReasonCopy` covers every `SuppressReason`.

## 11. Files

| Action | Path | Responsibility |
|---|---|---|
| Modify | `src/lib/avm/valueAdd/types.ts` | add `headlineUpsideGross` to `ValueAddReport` |
| Modify | `src/lib/avm/valueAdd/engine.ts` | P0 override, `headlineUpsideGross`, predSD-skip fetch option |
| Modify | `src/lib/property/getListingDetail.ts` | compute best-effort `valueAdd`; add to `ListingDetail` |
| Modify | `src/app/(app)/properties/[id]/page.tsx` | render `<ForceAppreciationCard>` in the rail |
| Create | `src/components/Property/forceAppreciationView.ts` | pure view-model + reason copy |
| Create | `src/components/Property/forceAppreciationView.test.ts` | view-model unit tests |
| Create | `src/components/Property/ForceAppreciationCard.tsx` | server card, native `<details>` |

## 12. Edge cases

- **Condo / lease / thin cohort**: most/all moves suppress → `shouldRender` false → no card. No dead weight.
- **Estimate unavailable**: `estimate` null or `≤ 0` → `valueAdd` not computed → no card.
- **Engine throws**: caught in `getListingDetail`; `valueAdd = null`; page renders normally.
- **Priced but zero positive-payback moves**: card still renders the ledger (honest), `headlineNet` may be `0` while `score > 0` — copy handles `0` gracefully.

## 13. Rollout

Single branch, behind no flag (server-rendered, degrades to nothing). Verified by the test suite + `tsc` + `lint` + `build`, then a manual spot-check on a Brampton detached listing (rich cohort) and a condo (expect no card).
