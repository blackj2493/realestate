# AVM Untrained-Cohort Estimate — Phase A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the AVM from over-valuing homes in *untrained* cohorts by routing them through feature/size-matched comps, optionally adjusted by a borrowed sibling-cohort model, with honest (≤ MEDIUM) confidence.

**Architecture:** All changes live in the AVM module (`src/lib/avm/`) plus one label in `ListingEstimateCard.tsx`. The trained, non-outlier path (coefficient engine on the full cohort) is untouched. The matched-comp "peer" path already works with zero coefficients; we (a) make it the default for untrained cohorts, (b) feed it borrowed sibling coefficients when available, (c) add sqft to its similarity kernel, (d) cap its confidence and label it honestly, and (e) floor the comp pulls against lease contamination.

**Tech stack:** TypeScript, Supabase JS (REST), Vitest (node-env — pure-logic tests only; DB-integrated behavior is verified by the backtest harness in `.claude/worktrees/avm-backtest/`).

**Spec:** `docs/superpowers/specs/2026-06-06-avm-untrained-cohort-estimate-design.md`

---

## File structure

| File | Responsibility | Change |
|---|---|---|
| `src/lib/avm/types.ts` | Constants + types | Add `MIN_SALE_PRICE`, `BW_SQFT`; add `'borrowed'` to `AnchorBasis` |
| `src/lib/avm/anchorService.ts` | Comp pulls, kernel, peer estimate | Sale-price floor on all 3 comp pulls; sqft term in `similarityWeight`; relax untrained gate in `fetchPeerAnchor` |
| `src/lib/avm/siblingModel.ts` | **NEW** — find a trained sibling cohort's coefficients for an untrained subject | Create |
| `src/lib/avm/calculator.ts` | Orchestration, confidence/basis | Wire sibling-borrow into `calculateAVM`; honest untrained fallback in `estimateFromMarketData`; MEDIUM cap in `finish` |
| `src/components/Property/ListingEstimateCard.tsx` | UI label | Add `'borrowed'` case to `basisCopy` |
| `src/lib/avm/*.test.ts` | Tests | New + rebaselined unit tests |

**Commit discipline:** one commit per task. All work on a dedicated branch off `main` (created in Task 0).

---

## Task 0: Branch setup

- [ ] **Step 1: Verify branch + create isolation branch off main**

Run:
```bash
git status --short
git fetch origin
git switch -c feat/avm-untrained-cohort origin/main
```
Expected: new branch `feat/avm-untrained-cohort` created from `origin/main`. If the working tree has the already-done `bedsLabel` display fix + the spec, they carry over; commit them first as their own commit:
```bash
git add src/lib/listings/bedsLabel.ts src/lib/listings/bedsLabel.test.ts src/components/CommandCenter/ListingCardBody.tsx src/components/CommandCenter/ListingTerminal.tsx "src/app/(app)/properties/[id]/page.tsx"
git commit -m "fix(listing): show 4+1 bed split on detail page via shared bedsLabel"
git add docs/superpowers/specs/2026-06-06-avm-untrained-cohort-estimate-design.md docs/superpowers/plans/2026-06-06-avm-untrained-cohort-phase-a.md
git commit -m "docs(avm): Phase A untrained-cohort spec + plan"
```
> NOTE: do NOT `git add -A` — the working tree also has unrelated pre-existing changes (`src/app/apply/page.tsx`, `scripts/admin/_*.cjs`, `docs/strategy/`). Add only the files listed.

---

## Task 1: Sale-price floor on comp pulls (lease hygiene)

**Files:**
- Modify: `src/lib/avm/types.ts` (add constant)
- Modify: `src/lib/avm/anchorService.ts:125` (fetchAnchor), `:567` and `:590` (fetchPeerAnchor rungs)
- Test: `src/lib/avm/types.test.ts` (new, trivial guard)

- [ ] **Step 1: Add the constant** in `types.ts` (after `OUTLIER_Z`, ~line 156):

```typescript
/**
 * Minimum close_price for a row to count as a SALE comp. raw_vow_sold mixes sold
 * records with LEASED ones (close_price = monthly rent, e.g. $3,250); there is no
 * scalar transaction_type to filter on. Residential rents never approach this, so
 * the floor cleanly excludes leases without dropping legitimate low-end sales.
 * Tunable. (No prior MIN_SALE_PRICE constant existed on this branch.)
 */
export const MIN_SALE_PRICE = 50_000;
```

- [ ] **Step 2: Write the failing test** `src/lib/avm/types.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { MIN_SALE_PRICE } from "./types";

describe("MIN_SALE_PRICE", () => {
  it("excludes residential leases but keeps low-end sales", () => {
    expect(3250).toBeLessThan(MIN_SALE_PRICE); // a monthly rent
    expect(120000).toBeGreaterThanOrEqual(MIN_SALE_PRICE); // a cheap real sale
  });
});
```

- [ ] **Step 3: Run test to verify it passes** (the constant exists):

Run: `npx vitest run src/lib/avm/types.test.ts`
Expected: PASS (1 test).

- [ ] **Step 4: Apply the floor to all three comp pulls.** In `anchorService.ts`, import the constant (add to the existing `./types` import) and replace each comp-pull predicate:

`fetchAnchor` (~line 125):
```typescript
      .gte('close_price', MIN_SALE_PRICE)
```
`fetchPeerAnchor` rung 1 (~line 567) and rung 2 (~line 590): same replacement of `.gt('close_price', 0)` → `.gte('close_price', MIN_SALE_PRICE)`.

- [ ] **Step 5: Verify nothing broke**

Run: `npm run typecheck && npx vitest run src/lib/avm`
Expected: typecheck clean; existing AVM tests still pass (golden master unaffected — the floor only removes sub-$50k rows, none of which are in the fixtures).

- [ ] **Step 6: Commit**

```bash
git add src/lib/avm/types.ts src/lib/avm/types.test.ts src/lib/avm/anchorService.ts
git commit -m "fix(avm): floor comp pulls at MIN_SALE_PRICE to exclude lease contamination"
```

---

## Task 2: `'borrowed'` basis + label + confidence-cap plumbing

This task is additive — it introduces the new basis, its label, and a confidence-cap option in `finish`, but nothing emits `'borrowed'` yet (Task 5 does). No behavior change.

**Files:**
- Modify: `src/lib/avm/types.ts:37-44` (AnchorBasis)
- Modify: `src/lib/avm/calculator.ts` (`finish` opts — add `capHigh`)
- Modify: `src/components/Property/ListingEstimateCard.tsx:124-150` (basisCopy)
- Test: `src/lib/avm/calculator.cap.test.ts` (new)

- [ ] **Step 1: Add the basis value** in `types.ts`:

```typescript
export type AnchorBasis =
  | 'local'   // recent local comps drove the level (low shrinkage to prior)
  | 'blend'   // local comps + de-staled prior shrunk together
  | 'prior'   // no usable local comps; prior (g(t₀)+δ_c) carried the level
  | 'parent'  // community offset missing; parent city × sub-type level used
  | 'borrowed'// untrained cohort priced via matched comps + a trained SIBLING cohort's coefficients
  | 'peer'    // saturating outlier priced by the peer comp-grid (homes like it)
  | 'floor'   // saturating outlier, too few peers — clamped number as a neighbourhood FLOOR
  | 'none';   // truly nothing — render "estimate unavailable"
```

- [ ] **Step 2: Add a `capHigh` option to `finish`** in `calculator.ts`. Extend the `opts` param (~line 270) and the demotion block (~line 302):

```typescript
  opts?: {
    /** Peer mode: forbid HIGH unless effectivePeers ≥ minPeersForHigh. */
    minPeersForHigh?: number;
    effectivePeers?: number;
    /** Untrained/borrowed: never publish HIGH (a community-borrowed number isn't HIGH). */
    capHigh?: boolean;
  }
```
Then in the `else` branch where confidence is assigned, after the existing `minPeersForHigh` demotion:
```typescript
    if (confidence === CONFIDENCE_HIGH && opts?.capHigh) {
      confidence = CONFIDENCE_MEDIUM;
    }
```

- [ ] **Step 3: Write the failing test** `src/lib/avm/calculator.cap.test.ts`. `finish` is module-private, so test through `estimateFromMarketData` with a tight-band anchor and a `'borrowed'` basis (Task 5 sets `capHigh` whenever basis is borrowed; here we assert the cap wiring via a crafted market object):

```typescript
import { describe, it, expect } from "vitest";
import { estimateFromMarketData } from "./calculator";
import type { AVMInput } from "./types";

const SUBJECT: AVMInput = {
  cityRegion: "Aurora Estates", city: "Aurora", propertySubType: "Detached",
  rawPropertySubType: "Detached", buildingAreaTotal: 2226, lotWidth: 30, lotDepth: 132,
  bedroomsAboveGrade: 4, bathroomsTotalInteger: 3, parkingTotal: 2,
  interiorTier: 3, exteriorTier: 3, basementTier: 5,
};

it("never labels a borrowed-basis estimate HIGH, even with a tight band", () => {
  const tightAnchor = { anchorLevel: Math.log(1_400_000), predSD: 0.05, nEff: 12, comps: 12, basis: "borrowed" as const };
  const result = estimateFromMarketData(SUBJECT, {
    anchor: tightAnchor, r2: null, basePrice: null, coefficients: [], n: 30, peer: tightAnchor,
  });
  expect(result.basis).toBe("borrowed");
  expect(result.confidence).not.toBe("HIGH");
});
```
> The executor confirms the exact `AVMMarketData` shape and `peerEstimate`/branch that carries `capHigh`; wire `capHigh: anchor.basis === 'borrowed'` into the `peerEstimate` `finish` call so this passes. (Cross-references Task 5.)

- [ ] **Step 4: Run test → fail, then implement, then pass**

Run: `npx vitest run src/lib/avm/calculator.cap.test.ts`
Expected: FAIL first (confidence HIGH), PASS after `capHigh` is honored in the peer/borrowed branch.

- [ ] **Step 5: Add the `basisCopy` case** in `ListingEstimateCard.tsx` (before `case "peer"`):

```tsx
    case "borrowed":
      return `Comped against ${comps} size-matched ${here} sales, adjusted with the ${city ?? "nearby"} model (no local model for ${here} yet)`;
```

- [ ] **Step 6: Verify + commit**

Run: `npm run typecheck && npx vitest run src/lib/avm`
```bash
git add src/lib/avm/types.ts src/lib/avm/calculator.ts src/lib/avm/calculator.cap.test.ts src/components/Property/ListingEstimateCard.tsx
git commit -m "feat(avm): add 'borrowed' basis, label, and confidence cap plumbing"
```

---

## Task 3: Sqft in the similarity kernel

**Files:**
- Modify: `src/lib/avm/types.ts` (add `BW_SQFT`)
- Modify: `src/lib/avm/anchorService.ts:408-420` (`similarityWeight`)
- Test: `src/lib/avm/anchorService.sqft.test.ts` (new) + rebaseline `calculator.peer.test.ts`/`peerGrid.test.ts` if the trained-outlier numbers move.

- [ ] **Step 1: Add the bandwidth** in `types.ts` (next to `BW_LOT`):

```typescript
/** Gaussian bandwidth (log-space) for sqft similarity. Subject sqft is the resolved
 * room-sum; comp sqft is the 500-sqft bucket midpoint, so resolution is coarse —
 * this mainly separates size CLASSES (e.g. ~2,250 vs ~4,250). Tunable. */
export const BW_SQFT = 0.25;
```

- [ ] **Step 2: Write the failing test** `src/lib/avm/anchorService.sqft.test.ts`. `similarityWeight` is module-private; export it for testing (add `export` to the function) and assert a size-similar comp outweighs a much-larger one when beds/baths/lot are equal:

```typescript
import { describe, it, expect } from "vitest";
import { similarityWeight } from "./anchorService";
import type { AVMInput } from "./types";

const S: AVMInput = {
  cityRegion: "Aurora Estates", city: "Aurora", propertySubType: "Detached",
  rawPropertySubType: "Detached", buildingAreaTotal: 2250, lotWidth: 30, lotDepth: 132,
  bedroomsAboveGrade: 4, bathroomsTotalInteger: 4, parkingTotal: 2,
  interiorTier: 3, exteriorTier: 3, basementTier: 5,
};
const comp = (sqft: number | null) => ({
  close_price: 1, purchase_contract_date: "2026-01-01", close_date: null,
  building_area_total: sqft, lot_width: 30, lot_depth: 132,
  bedrooms_above_grade: 4, bathrooms_total_integer: 4, parking_total: 2,
  interior_tier: 3, exterior_tier: 3, basement_tier: 5,
});

it("weights a same-size comp above a much larger one", () => {
  expect(similarityWeight(S, comp(2250) as any)).toBeGreaterThan(similarityWeight(S, comp(4250) as any));
});
it("ignores sqft when the comp lacks it (neutral, no penalty)", () => {
  // Missing sqft must equal the pre-sqft weight for an otherwise-identical comp.
  expect(similarityWeight(S, comp(null) as any)).toBeCloseTo(similarityWeight(S, comp(2250) as any), 5);
});
```
> The second assertion encodes the design rule: a missing comp sqft contributes factor 1. Since the identical comp at 2250 ≈ subject 2250 also contributes ≈1, they match. (If the executor finds the subject/comp sqft differ enough to break the `toBeCloseTo`, set the comp to the subject's exact sqft.)

- [ ] **Step 3: Run → fail** (no sqft term yet, both weights equal):

Run: `npx vitest run src/lib/avm/anchorService.sqft.test.ts`
Expected: FAIL on the first assertion (equal weights).

- [ ] **Step 4: Add the sqft term** to `similarityWeight` (mirror `lotSimLog`'s log-ratio form), before `logw += lotSimLog(...)`:

```typescript
  if (subject.buildingAreaTotal && subject.buildingAreaTotal > 0 && c.building_area_total && c.building_area_total > 0) {
    logw += -0.5 * (Math.log(subject.buildingAreaTotal / c.building_area_total) / BW_SQFT) ** 2;
  }
```
Add `BW_SQFT` to the `./types` import.

- [ ] **Step 5: Run → pass**

Run: `npx vitest run src/lib/avm/anchorService.sqft.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Rebaseline trained-outlier peer expectations (deliberate, per spec §6).**

Run: `npx vitest run src/lib/avm/calculator.peer.test.ts src/lib/avm/peerGrid.test.ts src/lib/avm/calculator.goldenmaster.test.ts`
Expected: golden master PASSES unchanged (normal trained path doesn't touch the kernel). If `peer`/`peerGrid` numbers shifted, inspect the diff, confirm it reflects better size-matching (not a bug), and update the expected values. Document the before/after in the commit body.

- [ ] **Step 7: Commit**

```bash
git add src/lib/avm/types.ts src/lib/avm/anchorService.ts src/lib/avm/anchorService.sqft.test.ts src/lib/avm/calculator.peer.test.ts src/lib/avm/peerGrid.test.ts
git commit -m "feat(avm): add sqft to the comp similarity kernel (subject room-sum vs comp bucket)"
```

---

## Task 4: Untrained cohorts always use matched comps (with an honest thin-comp fallback)

This is the core behavior change. Three loci, plus a relabel so a *typical* untrained home with few comps isn't mislabeled `'floor'`.

**Files:**
- Modify: `src/lib/avm/calculator.ts:95-114` (`worthComparableCheck`/`shouldEvaluatePeers`)
- Modify: `src/lib/avm/anchorService.ts:573-577` (untrained gate in `fetchPeerAnchor`)
- Modify: `src/lib/avm/calculator.ts:165-180` (`estimateFromMarketData` fallback labeling for untrained)
- Test: `src/lib/avm/calculator.untrained.test.ts` (new)

- [ ] **Step 1: Open `shouldEvaluatePeers` for all untrained cohorts.** Replace the untrained branch (`calculator.ts:110-114`):

```typescript
export function shouldEvaluatePeers(input: AVMInput, coefficients: CoefficientRow[]): boolean {
  return coefficients.length > 0
    ? isFeatureOutlier(input, coefficients) // trained: only clamp-saturating outliers
    : true;                                 // untrained: ALWAYS match comps (no blind average)
}
```

- [ ] **Step 2: Relax the untrained atypicality gate** in `fetchPeerAnchor` (`anchorService.ts:573-577`). Remove the early `return undefined` so untrained cohorts always proceed to `peerLevelFromComps`:

```typescript
    // Untrained cohorts always price off matched comps (no blind average). The
    // previous atypicality early-return is removed; thin-comp cases fall through
    // to rung 2 / null, which the caller relabels honestly (not 'floor').
    const peer = peerLevelFromComps(subject, communityComps, coefficients, trend, nowMs);
    if (peer && peer.nEff >= MIN_PEER_NEFF) return peer;
```
> `cohortOutlierScore` and `gateAtypicality` may become unused — delete them if so (typecheck/lint will flag). Keep `gateAtypicality` only if still referenced by the `cands.length === 0` guard at line 560; if that guard now reads `if (cands.length === 0 && !cityKey) return undefined;` adjust accordingly so an untrained home with no community comps still escalates to rung 2.

- [ ] **Step 3: Honest fallback for untrained thin-comp homes.** In `estimateFromMarketData` (`calculator.ts:167-178`), the `market.peer === null` branch currently relabels as `'floor'`. For *untrained* cohorts that is misleading (the home isn't necessarily large/upgraded — there just aren't enough comps). Make the relabel conditional:

```typescript
    if (market.peer) return peerEstimate(market.peer, market.r2);
    // peer === null → too few comps. For UNTRAINED cohorts present the anchor
    // honestly as a neighbourhood baseline (not the 'floor' = "larger than any comp"
    // copy, which only fits saturating outliers). Confidence never HIGH.
    const base = normalEstimate(input, market);
    if (base.estimatedValue <= 0) return base;
    const untrained = market.coefficients.length === 0;
    return {
      ...base,
      basis: untrained ? base.basis : 'floor',
      confidence: base.confidence === CONFIDENCE_HIGH ? CONFIDENCE_MEDIUM : base.confidence,
    };
```
> For untrained cohorts `base.basis` is the anchor's own honest basis (`local`/`blend`/`prior`), and `normalEstimate` is anchor-only (no coefficients) — so this is the same number as today but correctly labeled and capped, only reached when matched comps were too thin.

- [ ] **Step 4: Write the failing test** `src/lib/avm/calculator.untrained.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { shouldEvaluatePeers } from "./calculator";
import type { AVMInput } from "./types";

const subject = (over: Partial<AVMInput> = {}): AVMInput => ({
  cityRegion: "Aurora Estates", city: "Aurora", propertySubType: "Detached",
  rawPropertySubType: "Detached", buildingAreaTotal: 2226, lotWidth: 30, lotDepth: 132,
  bedroomsAboveGrade: 4, bathroomsTotalInteger: 3, parkingTotal: 2,
  interiorTier: 3, exteriorTier: 3, basementTier: 5, ...over,
});

describe("shouldEvaluatePeers", () => {
  it("always evaluates peers for untrained cohorts (no coefficients)", () => {
    expect(shouldEvaluatePeers(subject(), [])).toBe(true); // the Aurora case — under all old thresholds
  });
  it("leaves trained cohorts gated on the Σβz outlier signal", () => {
    const coeffs = [{ featureName: "bedrooms_above_grade", beta: 0.05, mean: 4, std: 1 }];
    // a typical trained home (z≈0) is NOT an outlier → no peer pull
    expect(shouldEvaluatePeers(subject(), coeffs)).toBe(false);
  });
});
```

- [ ] **Step 5: Run → it should pass after Steps 1-3** (write test first conceptually; if implementing strictly TDD, Step 4 before Steps 1-3 and watch the first assertion fail returning `false`).

Run: `npx vitest run src/lib/avm/calculator.untrained.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Full AVM suite + golden master**

Run: `npm run typecheck && npx vitest run src/lib/avm`
Expected: golden master PASS (trained path frozen). Other suites green; investigate any failure before proceeding.

- [ ] **Step 7: Commit**

```bash
git add src/lib/avm/calculator.ts src/lib/avm/anchorService.ts src/lib/avm/calculator.untrained.test.ts
git commit -m "feat(avm): untrained cohorts price off matched comps with honest thin-comp fallback"
```

---

## Task 5: Sibling-cohort coefficient borrow

When the subject's community is untrained, borrow the best trained sibling cohort (same city + property type) and feed its coefficients into the matched-comp path, labeled `'borrowed'`, confidence capped.

**Files:**
- Create: `src/lib/avm/siblingModel.ts`
- Modify: `src/lib/avm/calculator.ts` (`calculateAVM` — borrow when community coefficients empty)
- Test: `src/lib/avm/siblingModel.test.ts` (selection logic, pure) + the `calculator.cap.test.ts` borrowed assertion from Task 2.

- [ ] **Step 1: Create `siblingModel.ts`** with the selection logic separated from I/O so it's unit-testable:

```typescript
/**
 * Sibling-cohort coefficient borrow for UNTRAINED communities.
 *
 * A thin community (e.g. "Aurora Estates") has no trained matrix. Rather than
 * price it with zero feature adjustment, borrow the elasticities of the best
 * trained SIBLING in the same municipality + property type (e.g. "Aurora
 * Highlands" Detached). Deterministic, no AI (CLAUDE.md §4).
 *
 * Grain note: there is no city/region matrix today (see avm-model-pipeline-facts);
 * this borrows a real community model from a neighbouring community. Phase B
 * replaces it with true city-grain models.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchCoefficients, type CoefficientRow } from './matrixService';
import { rawVariantsOf } from './normalizeType';
import { COEFFICIENT_ENGINE_THRESHOLD } from './types';

const SIBLING_MIN_N = 30;

export interface SiblingModel {
  coefficients: CoefficientRow[];
  r2: number;
  n: number;
  siblingCityRegion: string;
}

/** Pure: pick the sibling with the most sales (tie-break highest R²), gated. */
export function pickSibling(
  rows: { city_region: string; model_accuracy_score: number | null; total_sales_analyzed: number | null }[]
): { city_region: string; r2: number; n: number } | null {
  const eligible = rows
    .map((r) => ({ city_region: r.city_region, r2: r.model_accuracy_score ?? 0, n: r.total_sales_analyzed ?? 0 }))
    .filter((r) => r.r2 >= COEFFICIENT_ENGINE_THRESHOLD && r.n >= SIBLING_MIN_N);
  if (eligible.length === 0) return null;
  eligible.sort((a, b) => (b.n - a.n) || (b.r2 - a.r2));
  return eligible[0];
}

/**
 * Find a trained sibling model for an untrained (city, subType). Returns null when
 * the subject has no city, no sibling cohorts, or none clear the R²/n gate.
 */
export async function fetchSiblingModel(
  supabase: SupabaseClient,
  city: string | null,
  propertySubType: string,
  rawPropertySubType: string
): Promise<SiblingModel | null> {
  if (!city) return null;
  const subVariants = rawVariantsOf(propertySubType, rawPropertySubType);
  if (subVariants.length === 0) return null;

  // 1. Which community cohorts live in this municipality? (raw_vow_sold carries both.)
  const regionsRes = await supabase
    .from('raw_vow_sold')
    .select('city_region')
    .ilike('city', city.trim())
    .in('property_sub_type', subVariants)
    .limit(5000);
  const cityRegions = Array.from(
    new Set((regionsRes.data ?? []).map((r: { city_region: string }) => r.city_region).filter(Boolean))
  );
  if (cityRegions.length === 0) return null;

  // 2. Which of those are trained? Pick the best.
  const auditRes = await supabase
    .from('avm_audit_report')
    .select('city_region, model_accuracy_score, total_sales_analyzed')
    .in('city_region', cityRegions)
    .ilike('property_sub_type', propertySubType.toLowerCase().trim());
  const best = pickSibling(auditRes.data ?? []);
  if (!best) return null;

  // 3. Pull the sibling's coefficients.
  const coefficients = await fetchCoefficients(supabase, best.city_region, propertySubType);
  if (coefficients.length === 0) return null;

  return { coefficients, r2: best.r2, n: best.n, siblingCityRegion: best.city_region };
}
```

- [ ] **Step 2: Write the failing test** `src/lib/avm/siblingModel.test.ts` (pure selection):

```typescript
import { describe, it, expect } from "vitest";
import { pickSibling } from "./siblingModel";

describe("pickSibling", () => {
  it("picks the most-sales cohort above the R²/n gate", () => {
    const r = pickSibling([
      { city_region: "Aurora Highlands", model_accuracy_score: 0.62, total_sales_analyzed: 180 },
      { city_region: "Aurora Village", model_accuracy_score: 0.71, total_sales_analyzed: 90 },
    ]);
    expect(r?.city_region).toBe("Aurora Highlands");
  });
  it("rejects cohorts below the gate", () => {
    expect(pickSibling([{ city_region: "Thin", model_accuracy_score: 0.4, total_sales_analyzed: 200 }])).toBeNull();
    expect(pickSibling([{ city_region: "Tiny", model_accuracy_score: 0.9, total_sales_analyzed: 12 }])).toBeNull();
  });
});
```

Run: `npx vitest run src/lib/avm/siblingModel.test.ts` → PASS after Step 1.

- [ ] **Step 3: Wire into `calculateAVM`** (`calculator.ts:116-145`). After the community `fetchCoefficients`/`fetchAuditInfo`, if coefficients are empty, try the sibling:

```typescript
  let [coefficients, audit] = await Promise.all([
    fetchCoefficients(supabase, input.cityRegion, input.propertySubType),
    fetchAuditInfo(supabase, input.cityRegion, input.propertySubType),
  ]);

  let borrowedBasis = false;
  if (coefficients.length === 0) {
    const sibling = await fetchSiblingModel(
      supabase, input.city, input.propertySubType, input.rawPropertySubType
    );
    if (sibling) {
      coefficients = sibling.coefficients;
      audit = { r2: sibling.r2, basePrice: audit.basePrice, n: sibling.n };
      borrowedBasis = true;
    }
  }

  const anchor = await fetchAnchor(supabase, input, coefficients, audit.basePrice);
  // ... peer evaluation unchanged ...
```
> The borrowed coefficients flow through `fetchAnchor`/`fetchPeerAnchor`'s existing `adjustedLogPrice`, so each matched comp gets size/bed/bath neutralized by the sibling's β. Mark the result `'borrowed'`: when `borrowedBasis` is true, set `anchor.basis = 'borrowed'` before `estimateFromMarketData` (or thread a flag through), and ensure the `finish`/`peerEstimate` call passes `capHigh: true`. The executor confirms the cleanest threading (likely: tag `AnchorResult.basis = 'borrowed'` in the peer result when `borrowedBasis`, and `peerEstimate` reads `peer.basis === 'borrowed'` to set `capHigh`).

- [ ] **Step 4: Verify the Task-2 borrowed-cap test now passes end-to-end** + full suite:

Run: `npm run typecheck && npx vitest run src/lib/avm`
Expected: green; golden master unchanged (trained cohorts never enter the `coefficients.length === 0` branch).

- [ ] **Step 5: Commit**

```bash
git add src/lib/avm/siblingModel.ts src/lib/avm/siblingModel.test.ts src/lib/avm/calculator.ts
git commit -m "feat(avm): borrow a trained sibling cohort's coefficients for untrained communities"
```

---

## Task 6: Verification — Aurora regression + backtest

**Files:**
- Test: `src/lib/avm/calculator.aurora.test.ts` (new, documents the target behavior with a mocked market)
- Run: the backtest harness (worktree)

- [ ] **Step 1: Aurora behavior test** `src/lib/avm/calculator.aurora.test.ts` — with a borrowed model + a luxury-skewed comp set, the matched + size-adjusted estimate lands well below the blind mean and is not HIGH:

```typescript
import { describe, it, expect } from "vitest";
import { estimateFromMarketData } from "./calculator";
import type { AVMInput } from "./types";

const AURORA: AVMInput = {
  cityRegion: "Aurora Estates", city: "Aurora", propertySubType: "Detached",
  rawPropertySubType: "Detached", buildingAreaTotal: 2226, lotWidth: 30.18, lotDepth: 132.87,
  bedroomsAboveGrade: 4, bathroomsTotalInteger: 3, parkingTotal: 2,
  interiorTier: 3, exteriorTier: 3, basementTier: 5,
};

it("prices the Aurora subject below the blind cohort mean, not HIGH", () => {
  // A matched/borrowed anchor centered near the same-size comps (~$1.4M), borrowed basis.
  const anchor = { anchorLevel: Math.log(1_420_000), predSD: 0.07, nEff: 9, comps: 13, basis: "borrowed" as const };
  const r = estimateFromMarketData(AURORA, { anchor, r2: 0.6, basePrice: null, coefficients: [], n: 180, peer: anchor });
  expect(r.estimatedValue).toBeLessThan(1_650_000); // well under the $1.73M blind-average miss
  expect(r.confidence).not.toBe("HIGH");
  expect(r.basis).toBe("borrowed");
});
```
Run: `npx vitest run src/lib/avm/calculator.aurora.test.ts` → PASS.

- [ ] **Step 2: Full project gates**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all green (peer/peerGrid reflect the Task-3 rebaseline; golden master unchanged).

- [ ] **Step 3: Re-run the backtest (the real success metric)**

Run (from the worktree, sampled, read-only — mirrors the earlier baseline run):
```bash
cd .claude/worktrees/avm-backtest
NODE_PATH=../../node_modules ../../node_modules/.bin/tsx --env-file=.env scripts/admin/avm-backtest.ts --eval-months 6 --limit 10000
```
Expected/target: overall median |%err| ≤ 11.4% (no regression); the **$1.5M+ tiers improve** vs the recorded baseline (17.0% / 21.3%). Record the before/after in the commit body.
> NOTE: the backtest exercises the live AVM path against historical sales, so it validates the DB-integrated pieces (fetchAnchor floor, fetchPeerAnchor gate, sibling borrow) that node-env unit tests can't.

- [ ] **Step 4: Manual spot-check** — run the app and open `/properties/N13229524` (35 Pine Hill Cres). Confirm the estimate dropped toward ~$1.4M, the badge reads ≤ MEDIUM, and the basis line says it was comped/borrowed (not "HIGH CONFIDENCE").

- [ ] **Step 5: Commit**

```bash
git add src/lib/avm/calculator.aurora.test.ts
git commit -m "test(avm): Aurora untrained-cohort regression + backtest verification"
```

---

## Self-review (completed during authoring)

- **Spec coverage:** (1) matched-comp default → Task 4; sqft kernel → Task 3; (2-Borrow) → Task 5; confidence caps + `'borrowed'` → Tasks 2, 4, 5; sale-price floor → Task 1; verification/backtest → Task 6. All spec §4 components mapped.
- **Trained-path invariant:** golden master asserted unchanged in Tasks 3, 4, 5; only the trained-*outlier* peer fixtures are deliberately rebaselined (Task 3, spec §6).
- **Type consistency:** `MIN_SALE_PRICE`, `BW_SQFT`, `'borrowed'`, `capHigh`, `pickSibling`/`fetchSiblingModel`, `SiblingModel` are defined once and referenced consistently.
- **Known executor confirmations (flagged inline, not placeholders):** exact threading of `capHigh`/`'borrowed'` through `peerEstimate` (Task 2/5 Step 3) and whether `cohortOutlierScore`/`gateAtypicality` become dead code (Task 4 Step 2) — both are "confirm against current code and delete-if-unused" items, with the intended end-state specified.
- **Open risk:** Task 4 changes EVERY untrained cohort's estimate (not just Aurora). The backtest (Task 6) is the guardrail; if a tier regresses, revisit before merge.
