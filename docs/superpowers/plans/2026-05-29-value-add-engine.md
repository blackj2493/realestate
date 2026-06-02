# Value-Add Engine (Plan 1: Core Engine) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure, deterministic Value-Add Engine that turns the existing per-cohort AVM hedonics into a calibrated, ranked, costed `ValueAddReport` for any Ontario home — with a trust layer that suppresses/caps the value-adds the raw math gets wrong.

**Architecture:** A new `src/lib/avm/valueAdd/` module that reuses the AVM's own standardization (`features.ts`) and pure evaluator (`estimateFromMarketData`). For each renovation "move" it computes a marginal dollar value via the multiplicative exp form anchored on the home's own AVM estimate, then runs it through a calibration gauntlet (gates → magnitude caps). Golden tests pin behaviour against three real cohorts where naive math is known to break.

**Tech Stack:** TypeScript, vitest (`npm test` → `vitest run`), Supabase JS (only in the thin async wrapper; all core math is pure and DB-free).

**Spec:** `docs/superpowers/specs/2026-05-29-value-add-engine-design.md`

**Out of scope for this plan (later plans):** the standalone UI tool, the OG share card, SEO neighbourhood pages, and the on-listing wrapper. This plan delivers the engine + tests only.

**Commit convention:** every commit message ends with the trailer:
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## File Structure

**Modify (existing AVM):**
- `src/lib/avm/features.ts` — extract the inline feature list into an exported `FEATURE_SPECS` registry; `featureContributions` consumes it (behaviour-preserving).
- `src/lib/avm/auditService.ts` — add `n` (`total_sales_analyzed`) to `AuditInfo` and the select.
- `src/lib/avm/calculator.ts` — add optional `n?: number | null` to `AVMMarketData` (additive).

**Create (new engine module — one responsibility each):**
- `src/lib/avm/valueAdd/types.ts` — `MoveKey`, `FeatureDelta`, `MoveSpec`, `ValueAddMove`, `ValueAddReport`, status/reason unions.
- `src/lib/avm/valueAdd/moveCatalog.ts` — the named renovation moves + GTA cost ranges + per-move sanity caps.
- `src/lib/avm/valueAdd/calibration.ts` — tuning constants + the gate helpers + magnitude caps.
- `src/lib/avm/valueAdd/engine.ts` — `applyMove`, `rawStackValue`, `evaluateMove`, `buildValueAddReport`, and the async `fetchValueAddReport` wrapper.
- `src/lib/avm/valueAdd/__fixtures__/cohorts.ts` — real cohort coefficient fixtures + builders for tests.

**Tests:**
- `src/lib/avm/valueAdd/engine.math.test.ts` — exact exp-form math (synthetic market).
- `src/lib/avm/valueAdd/engine.calibration.test.ts` — gates/caps against the three real cohorts.
- `src/lib/avm/valueAdd/engine.report.test.ts` — full report assembly.
- `src/lib/avm/features.specs.test.ts` — `FEATURE_SPECS` refactor safety.

---

## Task 1: Extract `FEATURE_SPECS` registry from `features.ts`

**Why:** the engine must read a feature's current value, its matrix name, and its tier→score conversion from the SAME source the AVM uses, so the reno tool can never drift. This refactor is behaviour-preserving; the existing golden-master snapshot is the safety net.

**Files:**
- Modify: `src/lib/avm/features.ts`
- Test: `src/lib/avm/features.specs.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/avm/features.specs.test.ts
import { describe, it, expect } from 'vitest';
import { FEATURE_SPECS, featureContributions } from './features';
import type { AVMInput } from './types';
import type { CoefficientRow } from './matrixService';

const baseInput: AVMInput = {
  cityRegion: 'Test', city: null, propertySubType: 'Detached', rawPropertySubType: 'Detached',
  buildingAreaTotal: 2000, lotWidth: 40, lotDepth: 100,
  bedroomsAboveGrade: 4, bathroomsTotalInteger: 3, parkingTotal: 2,
  interiorTier: 2, exteriorTier: 2, basementTier: 4,
};

describe('FEATURE_SPECS', () => {
  it('exposes all 8 model features with matrix names + breakdown keys', () => {
    const names = FEATURE_SPECS.map((s) => s.name);
    expect(names).toEqual([
      'building_area_total', 'lot_width', 'bedrooms_above_grade',
      'bathrooms_total_integer', 'parking_total', 'basement_score',
      'interior_score', 'exterior_score',
    ]);
  });

  it('valueOf applies the tier→score conversions (6-/5-/10-)', () => {
    const basement = FEATURE_SPECS.find((s) => s.name === 'basement_score')!;
    const interior = FEATURE_SPECS.find((s) => s.name === 'interior_score')!;
    const exterior = FEATURE_SPECS.find((s) => s.name === 'exterior_score')!;
    expect(basement.valueOf(baseInput)).toBe(10 - 4); // 6
    expect(interior.valueOf(baseInput)).toBe(6 - 2);  // 4
    expect(exterior.valueOf(baseInput)).toBe(5 - 2);  // 3
  });

  it('featureContributions still skips nulls and degenerate coeffs', () => {
    const coeff = new Map<string, CoefficientRow>([
      ['bathrooms_total_integer', { featureName: 'bathrooms_total_integer', beta: 0.04, mean: 3, std: 1 }],
      ['lot_width', { featureName: 'lot_width', beta: 0.03, mean: 40, std: 0 }], // std<=0 → skipped
    ]);
    const out = featureContributions({ ...baseInput, bedroomsAboveGrade: null }, coeff);
    expect(out).toHaveLength(1);
    expect(out[0].key).toBe('bathroomsAdjustment');
    expect(out[0].contribution).toBeCloseTo(0.04 * 0, 10); // value==mean → z=0
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/lib/avm/features.specs.test.ts`
Expected: FAIL — `FEATURE_SPECS` is not exported.

- [ ] **Step 3: Refactor `features.ts` to export `FEATURE_SPECS` and consume it**

Replace everything from the first `import` line (line 12) to the end of `src/lib/avm/features.ts` with the following (the lines 1–11 header docblock stays as-is):

```ts
import type { AVMInput, AVMAdjustmentBreakdown } from './types';
import { Z_CLAMP } from './types';
import type { CoefficientRow } from './matrixService';

export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Single registry of the 8 standardized model features. `valueOf` returns the
 * standardized model value from an AVMInput (the SCORE for tier features, via
 * 6−interiorTier / 5−exteriorTier / 10−basementTier), or null when the field is
 * absent. Consumed by featureContributions (AVM) and the valueAdd engine so the
 * two can never disagree on standardization.
 */
export interface FeatureSpec {
  /** AVMInput field a renovation move mutates. */
  inputField: keyof AVMInput;
  /** avm_multiplier_matrix.feature_name. */
  name: string;
  /** AVMAdjustmentBreakdown key. */
  key: keyof AVMAdjustmentBreakdown;
  /** Standardized model value (score for tiers); null = feature absent. */
  valueOf: (input: AVMInput) => number | null;
}

export const FEATURE_SPECS: FeatureSpec[] = [
  { inputField: 'buildingAreaTotal', name: 'building_area_total', key: 'buildingAreaAdjustment', valueOf: (i) => i.buildingAreaTotal },
  { inputField: 'lotWidth', name: 'lot_width', key: 'lotWidthAdjustment', valueOf: (i) => i.lotWidth },
  { inputField: 'bedroomsAboveGrade', name: 'bedrooms_above_grade', key: 'bedroomsAdjustment', valueOf: (i) => i.bedroomsAboveGrade },
  { inputField: 'bathroomsTotalInteger', name: 'bathrooms_total_integer', key: 'bathroomsAdjustment', valueOf: (i) => i.bathroomsTotalInteger },
  { inputField: 'parkingTotal', name: 'parking_total', key: 'parkingAdjustment', valueOf: (i) => i.parkingTotal },
  { inputField: 'basementTier', name: 'basement_score', key: 'basementAdjustment', valueOf: (i) => 10 - i.basementTier },
  { inputField: 'interiorTier', name: 'interior_score', key: 'interiorAdjustment', valueOf: (i) => 6 - i.interiorTier },
  { inputField: 'exteriorTier', name: 'exterior_score', key: 'exteriorAdjustment', valueOf: (i) => 5 - i.exteriorTier },
];

/** Each present feature's standardized contribution β·clamp((x−mean)/std, ±Z_CLAMP). */
export function featureContributions(
  input: AVMInput,
  coeff: Map<string, CoefficientRow>
): { key: keyof AVMAdjustmentBreakdown; contribution: number }[] {
  const out: { key: keyof AVMAdjustmentBreakdown; contribution: number }[] = [];
  for (const spec of FEATURE_SPECS) {
    const value = spec.valueOf(input);
    if (value === null) continue;
    const c = coeff.get(spec.name);
    if (!c || c.beta === 0 || !(c.std > 0)) continue;
    const z = clamp((value - c.mean) / c.std, -Z_CLAMP, Z_CLAMP);
    out.push({ key: spec.key, contribution: c.beta * z });
  }
  return out;
}

/** Subject's total UNCLAMPED log-space adjustment Σ β·clamp(z) over its present features. */
export function subjectAdjustmentTotal(input: AVMInput, coeff: Map<string, CoefficientRow>): number {
  return featureContributions(input, coeff).reduce((a, c) => a + c.contribution, 0);
}
```

- [ ] **Step 4: Run the new test + the full AVM suite to prove no behaviour change**

Run: `npx vitest run src/lib/avm/features.specs.test.ts`
Expected: PASS.

Run: `npx vitest run src/lib/avm`
Expected: PASS — including `calculator.goldenmaster.test.ts` (the snapshot is unchanged because `featureContributions` produces identical output in identical order).

- [ ] **Step 5: Commit**

```bash
git add src/lib/avm/features.ts src/lib/avm/features.specs.test.ts
git commit -m "refactor(avm): extract FEATURE_SPECS registry from features.ts"
```

---

## Task 2: Add cohort sample size `n` to the audit path

**Why:** the trust layer must suppress thin cohorts (high R² on tiny n is overfit). `total_sales_analyzed` already exists in `avm_audit_report`; we just thread it through.

**Files:**
- Modify: `src/lib/avm/auditService.ts`
- Modify: `src/lib/avm/calculator.ts:49-68` (the `AVMMarketData` interface)
- Test: `src/lib/avm/auditService.n.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/avm/auditService.n.test.ts
import { describe, it, expect } from 'vitest';
import type { AuditInfo } from './auditService';

describe('AuditInfo', () => {
  it('carries cohort sample size n', () => {
    const info: AuditInfo = { r2: 0.7, basePrice: 800000, n: 117 };
    expect(info.n).toBe(117);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/lib/avm/auditService.n.test.ts`
Expected: FAIL — `n` is not a property of `AuditInfo`.

- [ ] **Step 3: Add `n` to `AuditInfo`, the select, and the return**

In `src/lib/avm/auditService.ts`:

Replace the `AuditInfo` interface (lines 19-22) with:

```ts
export interface AuditInfo {
  r2: number | null;
  basePrice: number | null;
  /** Cohort sample size (avm_audit_report.total_sales_analyzed); null if unknown. */
  n: number | null;
}
```

Replace the `.select(...)` call (line 35) with:

```ts
    .select('city_region, model_accuracy_score, base_price, total_sales_analyzed')
```

Replace the two early `return { r2: null, basePrice: null }` statements (lines 30 and 42) with:

```ts
    return { r2: null, basePrice: null, n: null };
```

Replace the final return (lines 51-53) with:

```ts
  const basePrice =
    typeof best.base_price === 'number' && best.base_price > 0 ? best.base_price : null;
  const n = typeof best.total_sales_analyzed === 'number' ? best.total_sales_analyzed : null;
  return { r2: best.model_accuracy_score ?? null, basePrice, n };
```

- [ ] **Step 4: Add `n` to `AVMMarketData`**

In `src/lib/avm/calculator.ts`, inside the `AVMMarketData` interface (after `basePrice`, around line 55), add:

```ts
  /** Cohort sample size (avm_audit_report.total_sales_analyzed). Used by the
   * valueAdd engine to suppress thin cohorts; the AVM estimate ignores it. */
  n?: number | null;
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run src/lib/avm/auditService.n.test.ts src/lib/avm`
Expected: PASS (the `AVMMarketData` change is additive/optional, so the AVM suite is unaffected).

- [ ] **Step 6: Commit**

```bash
git add src/lib/avm/auditService.ts src/lib/avm/calculator.ts src/lib/avm/auditService.n.test.ts
git commit -m "feat(avm): thread cohort sample size n through the audit path"
```

---

## Task 3: Value-Add engine types

**Files:**
- Create: `src/lib/avm/valueAdd/types.ts`

- [ ] **Step 1: Create the types file**

```ts
// src/lib/avm/valueAdd/types.ts
import type { AVMInput } from '../types';

export type MoveKey =
  | 'finish_basement'
  | 'legal_suite'
  | 'add_bathroom'
  | 'add_bedroom'
  | 'build_addition'
  | 'interior_excellent'
  | 'add_parking'
  | 'build_garage'
  | 'curb_appeal';

/** AVMInput numeric fields a move may mutate. */
export type MoveField = Extract<
  keyof AVMInput,
  | 'buildingAreaTotal' | 'lotWidth' | 'bedroomsAboveGrade'
  | 'bathroomsTotalInteger' | 'parkingTotal'
  | 'basementTier' | 'interiorTier' | 'exteriorTier'
>;

/** One field change a move applies. 'set' = absolute target (tiers); 'add' = increment. */
export interface FeatureDelta {
  field: MoveField;
  op: 'set' | 'add';
  value: number;
}

export interface MoveSpec {
  key: MoveKey;
  label: string;
  deltas: FeatureDelta[];
  /** matrix feature_name(s) whose beta drives this move's value (used for gating). */
  drivingFeatures: string[];
  costLow: number;
  costTyp: number;
  costHigh: number;
  /** sane absolute value-add ceiling (CAD) for the magnitude cap. */
  capHigh: number;
}

export type MoveStatus = 'priced' | 'suppressed';
export type SuppressReason =
  | 'negative_beta'
  | 'placeholder'
  | 'low_r2'
  | 'thin_cohort'
  | 'at_ceiling'
  | 'null_baseline'
  | 'already_present'
  | 'no_estimate';

export interface ValueAddMove {
  key: MoveKey;
  label: string;
  status: MoveStatus;
  suppressReason?: SuppressReason;
  valueAddLow: number;
  valueAddTyp: number;
  valueAddHigh: number;
  costLow: number;
  costTyp: number;
  costHigh: number;
  netGainTyp: number;
  paybackRatio: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface ValueAddReport {
  cityRegion: string;
  propertySubType: string;
  /** P0 — the home's own AVM estimate (0 when unavailable). */
  subjectEstimate: number;
  /** Joint value-add of the best non-overlapping positive-payback moves − their costs. */
  headlineUpside: number;
  /** Quotable 0–100 index of unlockable equity. */
  valueAddScore: number;
  moves: ValueAddMove[];
  neighbourhoodInsight: string;
  basis: string;
  disclaimer: string;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (no usages yet; file compiles).

- [ ] **Step 3: Commit**

```bash
git add src/lib/avm/valueAdd/types.ts
git commit -m "feat(avm): value-add engine types"
```

---

## Task 4: Move catalog (renovation moves + GTA costs + caps)

**Why:** moves are explicit, achievable tier transitions / bundles mapped to model features, each with sourced GTA 2024–2026 cost ranges (from the cost-research pass) and a sane value-add ceiling.

**Files:**
- Create: `src/lib/avm/valueAdd/moveCatalog.ts`
- Test: `src/lib/avm/valueAdd/moveCatalog.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/avm/valueAdd/moveCatalog.test.ts
import { describe, it, expect } from 'vitest';
import { MOVE_CATALOG } from './moveCatalog';
import { FEATURE_SPECS } from '../features';

describe('MOVE_CATALOG', () => {
  it('every move has costs, a positive cap, and ≥1 delta', () => {
    for (const m of MOVE_CATALOG) {
      expect(m.costTyp).toBeGreaterThan(0);
      expect(m.capHigh).toBeGreaterThan(0);
      expect(m.deltas.length).toBeGreaterThan(0);
    }
  });

  it('every delta field and driving feature is a real model feature', () => {
    const fields = new Set(FEATURE_SPECS.map((s) => s.inputField));
    const names = new Set(FEATURE_SPECS.map((s) => s.name));
    for (const m of MOVE_CATALOG) {
      for (const d of m.deltas) expect(fields.has(d.field)).toBe(true);
      for (const f of m.drivingFeatures) expect(names.has(f)).toBe(true);
    }
  });

  it('finish_basement raises the basement (sets a finished tier)', () => {
    const fb = MOVE_CATALOG.find((m) => m.key === 'finish_basement')!;
    expect(fb.deltas[0]).toEqual({ field: 'basementTier', op: 'set', value: 2 });
    expect(fb.drivingFeatures).toContain('basement_score');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/lib/avm/valueAdd/moveCatalog.test.ts`
Expected: FAIL — `MOVE_CATALOG` not found.

- [ ] **Step 3: Implement the catalog**

```ts
// src/lib/avm/valueAdd/moveCatalog.ts
import type { MoveSpec } from './types';

/**
 * Renovation moves as achievable tier transitions / physical bundles mapped to the
 * 8 model features. Costs are 2024–2026 GTA contractor benchmarks (CAD); capHigh is
 * a sane upper bound for the value-add a single move can plausibly add (the trust
 * layer floors at 0 and applies %-of-home + $/sqft caps on top). Tier targets use
 * the score conventions: lower basement/interior/exterior tier = better.
 */
export const MOVE_CATALOG: MoveSpec[] = [
  {
    key: 'finish_basement',
    label: 'Finish the basement',
    deltas: [{ field: 'basementTier', op: 'set', value: 2 }], // → basement_score 8 (solid finish)
    drivingFeatures: ['basement_score'],
    costLow: 32000, costTyp: 52000, costHigh: 80000,
    capHigh: 150000,
  },
  {
    key: 'legal_suite',
    label: 'Add a legal basement suite',
    deltas: [
      { field: 'basementTier', op: 'set', value: 1 }, // → basement_score 9 (top)
      { field: 'bathroomsTotalInteger', op: 'add', value: 1 },
    ],
    drivingFeatures: ['basement_score', 'bathrooms_total_integer'],
    costLow: 60000, costTyp: 95000, costHigh: 180000,
    capHigh: 220000,
  },
  {
    key: 'add_bathroom',
    label: 'Add a full bathroom',
    deltas: [{ field: 'bathroomsTotalInteger', op: 'add', value: 1 }],
    drivingFeatures: ['bathrooms_total_integer'],
    costLow: 12000, costTyp: 20000, costHigh: 35000,
    capHigh: 60000,
  },
  {
    key: 'add_bedroom',
    label: 'Add a bedroom',
    deltas: [{ field: 'bedroomsAboveGrade', op: 'add', value: 1 }],
    drivingFeatures: ['bedrooms_above_grade'],
    costLow: 8000, costTyp: 18000, costHigh: 35000,
    capHigh: 50000,
  },
  {
    key: 'build_addition',
    label: 'Build an addition (~400 sq ft)',
    deltas: [{ field: 'buildingAreaTotal', op: 'add', value: 400 }],
    drivingFeatures: ['building_area_total'],
    costLow: 80000, costTyp: 140000, costHigh: 240000,
    capHigh: 200000,
  },
  {
    key: 'interior_excellent',
    label: 'Renovate interior to excellent',
    deltas: [{ field: 'interiorTier', op: 'set', value: 1 }], // → interior_score 5 (top)
    drivingFeatures: ['interior_score'],
    costLow: 40000, costTyp: 90000, costHigh: 160000,
    capHigh: 120000,
  },
  {
    key: 'add_parking',
    label: 'Add a parking space',
    deltas: [{ field: 'parkingTotal', op: 'add', value: 1 }],
    drivingFeatures: ['parking_total'],
    costLow: 2500, costTyp: 6000, costHigh: 12000,
    capHigh: 30000,
  },
  {
    key: 'build_garage',
    label: 'Build a detached garage',
    deltas: [{ field: 'parkingTotal', op: 'add', value: 2 }],
    drivingFeatures: ['parking_total'],
    costLow: 42000, costTyp: 70000, costHigh: 120000,
    capHigh: 90000,
  },
  {
    key: 'curb_appeal',
    label: 'Curb-appeal / exterior upgrade',
    deltas: [{ field: 'exteriorTier', op: 'set', value: 2 }], // → exterior_score 3
    drivingFeatures: ['exterior_score'],
    costLow: 5000, costTyp: 20000, costHigh: 80000,
    capHigh: 60000,
  },
];
```

- [ ] **Step 4: Run test**

Run: `npx vitest run src/lib/avm/valueAdd/moveCatalog.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/avm/valueAdd/moveCatalog.ts src/lib/avm/valueAdd/moveCatalog.test.ts
git commit -m "feat(avm): value-add move catalog with GTA cost benchmarks"
```

---

## Task 5: Calibration constants + helpers

**Why:** this is the trust layer's toolbox — the tiny-std floor, the magnitude caps, and the cohort/feature gate predicates. Pure functions, unit-tested in isolation.

**Files:**
- Create: `src/lib/avm/valueAdd/calibration.ts`
- Test: `src/lib/avm/valueAdd/calibration.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/avm/valueAdd/calibration.test.ts
import { describe, it, expect } from 'vitest';
import {
  MIN_COHORT_N, MIN_STD_COUNT, isCountFeature, effectiveStd, featureGate,
} from './calibration';
import type { CoefficientRow } from '../matrixService';

const c = (over: Partial<CoefficientRow>): CoefficientRow =>
  ({ featureName: 'x', beta: 0.05, mean: 3, std: 1, ...over });

describe('calibration helpers', () => {
  it('floors std for discrete count features only', () => {
    expect(isCountFeature('bathrooms_total_integer')).toBe(true);
    expect(isCountFeature('basement_score')).toBe(false);
    expect(effectiveStd('bathrooms_total_integer', 0.5)).toBe(MIN_STD_COUNT);
    expect(effectiveStd('basement_score', 0.5)).toBe(0.5);
  });

  it('featureGate rejects negative, zero, placeholder-stub coeffs', () => {
    expect(featureGate(c({ beta: -0.02 }))).toBe('negative_beta');
    expect(featureGate(c({ beta: 0 }))).toBe('placeholder');
    expect(featureGate(c({ beta: 0.05, std: 1, mean: 1 }))).toBe('placeholder'); // condo stub
    expect(featureGate(undefined)).toBe('placeholder'); // missing row
    expect(featureGate(c({ beta: 0.05, std: 0.9, mean: 3 }))).toBeNull(); // healthy
  });

  it('MIN_COHORT_N is a sane overfit floor', () => {
    expect(MIN_COHORT_N).toBeGreaterThanOrEqual(30);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/lib/avm/valueAdd/calibration.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement calibration helpers**

```ts
// src/lib/avm/valueAdd/calibration.ts
import type { CoefficientRow } from '../matrixService';
import type { MoveSpec, SuppressReason } from './types';

/** Cohort sample-size floor — high R² on tiny n is overfit. */
export const MIN_COHORT_N = 30;
/** A single move never adds more than this fraction of the home's value. */
export const PCT_CAP = 0.12;
/** A non-overlapping stack of moves never adds more than this fraction. */
export const PCT_CAP_STACK = 0.3;
/** Tiny-std floor for discrete counts: keep a +1 unit move near ~1 std, not 1.5–2. */
export const MIN_STD_COUNT = 0.9;
/** A feature whose current value sits ≥ mean + CEILING_STD·std is "at ceiling". */
export const CEILING_STD = 2.0;
/** Regional $/sqft prior cap for additions (overrides a runaway cohort sqft beta). */
export const PPSF_CAP = 300;
/** Value-Add Score scaling: score = min(100, round(jointFraction · SCORE_K)). */
export const SCORE_K = 350;

const COUNT_FEATURES = new Set([
  'bedrooms_above_grade',
  'bathrooms_total_integer',
  'parking_total',
]);

export function isCountFeature(name: string): boolean {
  return COUNT_FEATURES.has(name);
}

/** Floor the std of discrete count features so a single unit isn't over-weighted. */
export function effectiveStd(name: string, std: number): number {
  return isCountFeature(name) ? Math.max(std, MIN_STD_COUNT) : std;
}

/**
 * Reject a feature whose coefficient is untrustworthy for a value-add claim:
 *  - missing row or beta === 0 → 'placeholder'
 *  - beta < 0 → 'negative_beta' (a value-positive reno can never lose value)
 *  - degenerate stub (std ≤ 1 AND mean ≤ 1, e.g. condo basement/lot) → 'placeholder'
 * Returns null when the feature is healthy.
 */
export function featureGate(c: CoefficientRow | undefined): SuppressReason | null {
  if (!c || c.beta === 0) return 'placeholder';
  if (c.beta < 0) return 'negative_beta';
  if (c.std <= 1 && c.mean <= 1) return 'placeholder';
  return null;
}

/** Clamp a raw value-add to the move's absolute cap, the %-of-home cap, and (for
 *  additions) the regional $/sqft cap. Floors at 0. */
export function capValueAdd(
  raw: number,
  move: MoveSpec,
  subjectEstimate: number,
  addedSqft: number
): number {
  let v = Math.max(0, raw);
  v = Math.min(v, move.capHigh);
  v = Math.min(v, PCT_CAP * subjectEstimate);
  if (move.drivingFeatures.includes('building_area_total') && addedSqft > 0) {
    v = Math.min(v, PPSF_CAP * addedSqft);
  }
  return v;
}
```

- [ ] **Step 4: Run test**

Run: `npx vitest run src/lib/avm/valueAdd/calibration.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/avm/valueAdd/calibration.ts src/lib/avm/valueAdd/calibration.test.ts
git commit -m "feat(avm): value-add calibration constants + gate/cap helpers"
```

---

## Task 6: Core move math — `applyMove` + `rawStackValue`

**Why:** the exact multiplicative marginal. `rawStackValue` is the one combiner for single AND stacked moves (one Σ over the union of changed features → no double-counting). Tested precisely against a synthetic market so the math is provably right.

**Files:**
- Create: `src/lib/avm/valueAdd/engine.ts` (first two exports)
- Create: `src/lib/avm/valueAdd/__fixtures__/cohorts.ts`
- Test: `src/lib/avm/valueAdd/engine.math.test.ts`

- [ ] **Step 1: Create the cohort fixtures (real coefficient data)**

> Before relying on this, open `src/lib/avm/anchorService.ts` and confirm `AnchorResult` has exactly the fields `anchorLevel, predSD, nEff, comps, basis`. If it has additional required fields, add them to the `anchor` object below.

```ts
// src/lib/avm/valueAdd/__fixtures__/cohorts.ts
import type { AVMMarketData } from '../../calculator';
import type { CoefficientRow } from '../../matrixService';
import type { AnchorResult } from '../../anchorService';
import type { AVMInput } from '../../types';

export function buildMarket(opts: {
  basePrice: number; r2: number; n: number;
  coefficients: CoefficientRow[]; predSD?: number;
}): AVMMarketData {
  const anchor: AnchorResult = {
    anchorLevel: Math.log(opts.basePrice),
    predSD: opts.predSD ?? 0.06,
    nEff: 40,
    comps: 50,
    basis: 'local',
  };
  return {
    anchor,
    r2: opts.r2,
    basePrice: opts.basePrice,
    coefficients: opts.coefficients,
    n: opts.n,
  };
}

export function subject(over: Partial<AVMInput>): AVMInput {
  return {
    cityRegion: 'Test', city: null, propertySubType: 'Detached', rawPropertySubType: 'Detached',
    buildingAreaTotal: null, lotWidth: null, lotDepth: null,
    bedroomsAboveGrade: null, bathroomsTotalInteger: null, parkingTotal: null,
    interiorTier: 3, exteriorTier: 3, basementTier: 5,
    ...over,
  };
}

// Real cohort coefficients (from the validation pass on scripts/worker/avm/data CSVs).
export const BRAMPTON_WEST_DETACHED = buildMarket({
  basePrice: 861351, r2: 0.7, n: 117,
  coefficients: [
    { featureName: 'building_area_total', beta: 0.044949, mean: 1560.5, std: 512.557 },
    { featureName: 'bathrooms_total_integer', beta: 0.039846, mean: 3.0256, std: 0.891187 },
    { featureName: 'bedrooms_above_grade', beta: 0.021938, mean: 3.1282, std: 0.722513 },
    { featureName: 'basement_score', beta: 0.020536, mean: 5.6239, std: 1.325145 },
  ],
});

export const ERIN_MILLS_CONDO = buildMarket({
  basePrice: 705579, r2: 0.91, n: 70,
  coefficients: [
    { featureName: 'building_area_total', beta: 0.234615, mean: 1168.84, std: 446.88 },
    { featureName: 'bathrooms_total_integer', beta: 0.077281, mean: 1.8571, std: 0.61611 },
    { featureName: 'bedrooms_above_grade', beta: -0.023497, mean: 1.7286, std: 0.475738 },
    { featureName: 'basement_score', beta: 0, mean: 1, std: 1 }, // placeholder stub
  ],
});

export const CHURCHILL_MEADOWS_TOWNHOUSE = buildMarket({
  basePrice: 801043, r2: 0.85, n: 172,
  coefficients: [
    { featureName: 'building_area_total', beta: 0.067605, mean: 1436.09, std: 485.507 },
    { featureName: 'bathrooms_total_integer', beta: 0.041009, mean: 3.0465, std: 0.861407 },
    { featureName: 'bedrooms_above_grade', beta: 0.076137, mean: 2.6395, std: 0.688996 },
    { featureName: 'basement_score', beta: 0.0207, mean: 3.5872, std: 2.284543 },
  ],
});
```

- [ ] **Step 2: Write the failing math test**

```ts
// src/lib/avm/valueAdd/engine.math.test.ts
import { describe, it, expect } from 'vitest';
import { applyMove, rawStackValue } from './engine';
import { buildMarket, subject } from './__fixtures__/cohorts';
import type { FeatureDelta } from './types';

describe('applyMove', () => {
  it('applies set and add ops immutably', () => {
    const input = subject({ bathroomsTotalInteger: 2, basementTier: 5 });
    const out = applyMove(input, [
      { field: 'bathroomsTotalInteger', op: 'add', value: 1 },
      { field: 'basementTier', op: 'set', value: 2 },
    ]);
    expect(out.bathroomsTotalInteger).toBe(3);
    expect(out.basementTier).toBe(2);
    expect(input.bathroomsTotalInteger).toBe(2); // original untouched
  });
});

describe('rawStackValue (exact exp form)', () => {
  // Synthetic market: one non-count feature, beta 0.1, mean 1000, std 500.
  const market = buildMarket({
    basePrice: 1_000_000, r2: 0.9, n: 100,
    coefficients: [{ featureName: 'building_area_total', beta: 0.1, mean: 1000, std: 500 }],
  });

  it('prices a +500 sqft move as P0·(exp(β·Δz)−1)', () => {
    const input = subject({ buildingAreaTotal: 1000 }); // z0 = 0
    const deltas: FeatureDelta[] = [{ field: 'buildingAreaTotal', op: 'add', value: 500 }]; // z1 = 1.0
    const after = applyMove(input, deltas);
    const value = rawStackValue(input, after, market, 1_000_000);
    // 1e6 * (exp(0.1*1.0) - 1) = 105170.918
    expect(value).toBeCloseTo(105170.918, 1);
  });

  it('returns 0 when nothing changed', () => {
    const input = subject({ buildingAreaTotal: 1000 });
    expect(rawStackValue(input, input, market, 1_000_000)).toBe(0);
  });
});
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `npx vitest run src/lib/avm/valueAdd/engine.math.test.ts`
Expected: FAIL — `applyMove`/`rawStackValue` not exported.

- [ ] **Step 4: Implement `applyMove` + `rawStackValue` in `engine.ts`**

```ts
// src/lib/avm/valueAdd/engine.ts
import type { AVMInput } from '../types';
import { Z_CLAMP } from '../types';
import type { AVMMarketData } from '../calculator';
import { clamp, FEATURE_SPECS } from '../features';
import { effectiveStd } from './calibration';
import type { FeatureDelta } from './types';

/** Apply a move's field deltas to a copy of the input (set = absolute, add = increment). */
export function applyMove(input: AVMInput, deltas: FeatureDelta[]): AVMInput {
  const next: AVMInput = { ...input };
  for (const d of deltas) {
    if (d.op === 'set') {
      (next[d.field] as number) = d.value;
    } else {
      const cur = (next[d.field] as number | null) ?? 0;
      (next[d.field] as number) = cur + d.value;
    }
  }
  return next;
}

/**
 * Marginal dollar value of moving from `input` to `after`, as the multiplicative
 * exp difference over the UNION of changed model features (one Σ → no double-count):
 *   ΔlogΣ = Σ_f β_f·(clamp(z1_f) − clamp(z0_f))     (count features use a floored std)
 *   value = P0 · (exp(ΔlogΣ) − 1)
 * P0 is the home's own AVM estimate. No ADJ_CLAMP here (per spec §6); saturation is
 * handled by the at-ceiling gate in evaluateMove.
 */
export function rawStackValue(
  input: AVMInput,
  after: AVMInput,
  market: AVMMarketData,
  subjectEstimate: number
): number {
  const coeff = new Map(market.coefficients.map((c) => [c.featureName, c]));
  let dLog = 0;
  for (const spec of FEATURE_SPECS) {
    const c = coeff.get(spec.name);
    if (!c || c.beta === 0 || !(c.std > 0)) continue;
    const v0 = spec.valueOf(input);
    const v1 = spec.valueOf(after);
    if (v0 === null || v1 === null || v0 === v1) continue;
    const std = effectiveStd(spec.name, c.std);
    const z0 = clamp((v0 - c.mean) / std, -Z_CLAMP, Z_CLAMP);
    const z1 = clamp((v1 - c.mean) / std, -Z_CLAMP, Z_CLAMP);
    dLog += c.beta * (z1 - z0);
  }
  return subjectEstimate * (Math.exp(dLog) - 1);
}
```

- [ ] **Step 5: Run test**

Run: `npx vitest run src/lib/avm/valueAdd/engine.math.test.ts`
Expected: PASS — value ≈ 105170.9.

- [ ] **Step 6: Commit**

```bash
git add src/lib/avm/valueAdd/engine.ts src/lib/avm/valueAdd/__fixtures__/cohorts.ts src/lib/avm/valueAdd/engine.math.test.ts
git commit -m "feat(avm): value-add core move math (applyMove + rawStackValue)"
```

---

## Task 7: `evaluateMove` — the trust gauntlet (gates + caps)

**Why:** this is the spine. It decides whether a move earns a dollar figure, suppresses the ones the raw math gets wrong, and caps magnitudes. Golden-tested against the three real cohorts — including the known failures (Erin Mills condo: placeholder basement, negative-beta bedroom, runaway sqft).

**Files:**
- Modify: `src/lib/avm/valueAdd/engine.ts` (add `evaluateMove`)
- Test: `src/lib/avm/valueAdd/engine.calibration.test.ts`

- [ ] **Step 1: Write the failing golden test**

```ts
// src/lib/avm/valueAdd/engine.calibration.test.ts
import { describe, it, expect } from 'vitest';
import { evaluateMove } from './engine';
import { MOVE_CATALOG } from './moveCatalog';
import {
  BRAMPTON_WEST_DETACHED, ERIN_MILLS_CONDO, CHURCHILL_MEADOWS_TOWNHOUSE, subject,
} from './__fixtures__/cohorts';
import type { MoveKey } from './types';

const move = (k: MoveKey) => MOVE_CATALOG.find((m) => m.key === k)!;

// A typical Brampton detached: features near cohort means, unfinished basement.
const bramptonHome = subject({
  buildingAreaTotal: 1560, bathroomsTotalInteger: 3, bedroomsAboveGrade: 3,
  parkingTotal: 2, basementTier: 5, interiorTier: 3, exteriorTier: 3, lotWidth: 40,
});

describe('evaluateMove — Brampton West Detached (well-behaved cohort)', () => {
  const P0 = 861351;
  it('prices a basement finish in a sane band', () => {
    const r = evaluateMove(bramptonHome, move('finish_basement'), BRAMPTON_WEST_DETACHED, P0);
    expect(r.status).toBe('priced');
    expect(r.valueAddTyp).toBeGreaterThan(25000);
    expect(r.valueAddTyp).toBeLessThan(70000);
  });
  it('prices an added bathroom in a sane band', () => {
    const r = evaluateMove(bramptonHome, move('add_bathroom'), BRAMPTON_WEST_DETACHED, P0);
    expect(r.status).toBe('priced');
    expect(r.valueAddTyp).toBeGreaterThan(15000);
    expect(r.valueAddTyp).toBeLessThan(55000);
  });
  it('prices an added bedroom in a sane band', () => {
    const r = evaluateMove(bramptonHome, move('add_bedroom'), BRAMPTON_WEST_DETACHED, P0);
    expect(r.status).toBe('priced');
    expect(r.valueAddTyp).toBeGreaterThan(8000);
    expect(r.valueAddTyp).toBeLessThan(40000);
  });
});

describe('evaluateMove — Erin Mills Condo (broken-feature cohort)', () => {
  const P0 = 705579;
  const condoHome = subject({
    propertySubType: 'Condo Apartment', rawPropertySubType: 'Condo Apartment',
    buildingAreaTotal: 1169, bathroomsTotalInteger: 2, bedroomsAboveGrade: 2,
    parkingTotal: 1, basementTier: 5, interiorTier: 3, exteriorTier: 3,
  });
  it('suppresses the placeholder-basement move', () => {
    const r = evaluateMove(condoHome, move('finish_basement'), ERIN_MILLS_CONDO, P0);
    expect(r.status).toBe('suppressed');
    expect(r.suppressReason).toBe('placeholder');
    expect(r.valueAddTyp).toBe(0);
  });
  it('suppresses the negative-beta bedroom move (never shows −$34k)', () => {
    const r = evaluateMove(condoHome, move('add_bedroom'), ERIN_MILLS_CONDO, P0);
    expect(r.status).toBe('suppressed');
    expect(r.suppressReason).toBe('negative_beta');
    expect(r.valueAddTyp).toBe(0);
  });
  it('caps the runaway-beta addition well below the naive +$212k', () => {
    const r = evaluateMove(condoHome, move('build_addition'), ERIN_MILLS_CONDO, P0);
    expect(r.status).toBe('priced');
    expect(r.valueAddTyp).toBeLessThanOrEqual(Math.round(0.12 * P0)); // ≤ %-of-home cap
    expect(r.valueAddTyp).toBeLessThan(100000);
  });
  it('caps the tiny-std bathroom below the naive +$94k', () => {
    const r = evaluateMove(condoHome, move('add_bathroom'), ERIN_MILLS_CONDO, P0);
    expect(r.status).toBe('priced');
    expect(r.valueAddTyp).toBeLessThanOrEqual(move('add_bathroom').capHigh);
  });
});

describe('evaluateMove — Churchill Meadows Townhouse', () => {
  const P0 = 801043;
  const thHome = subject({
    propertySubType: 'Townhouse', rawPropertySubType: 'Townhouse',
    buildingAreaTotal: 1436, bathroomsTotalInteger: 3, bedroomsAboveGrade: 2,
    parkingTotal: 1, basementTier: 5, interiorTier: 3, exteriorTier: 3,
  });
  it('caps the tiny-std bedroom below the naive +$94k', () => {
    const r = evaluateMove(thHome, move('add_bedroom'), CHURCHILL_MEADOWS_TOWNHOUSE, P0);
    expect(r.status).toBe('priced');
    expect(r.valueAddTyp).toBeLessThanOrEqual(move('add_bedroom').capHigh);
    expect(r.valueAddTyp).toBeLessThan(60000);
  });
});

describe('evaluateMove — cohort gates', () => {
  const P0 = 800000;
  it('suppresses everything in a low-R² cohort', () => {
    const lowR2 = { ...BRAMPTON_WEST_DETACHED, r2: 0.4 };
    const r = evaluateMove(bramptonHome, move('finish_basement'), lowR2, P0);
    expect(r.status).toBe('suppressed');
    expect(r.suppressReason).toBe('low_r2');
  });
  it('suppresses everything in a thin cohort', () => {
    const thin = { ...BRAMPTON_WEST_DETACHED, n: 12 };
    const r = evaluateMove(bramptonHome, move('finish_basement'), thin, P0);
    expect(r.status).toBe('suppressed');
    expect(r.suppressReason).toBe('thin_cohort');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/lib/avm/valueAdd/engine.calibration.test.ts`
Expected: FAIL — `evaluateMove` not exported.

- [ ] **Step 3: Implement `evaluateMove`** (append to `engine.ts`; add imports at top)

Add to the imports at the top of `engine.ts`:

```ts
import {
  COEFFICIENT_ENGINE_THRESHOLD, HIGH_CONFIDENCE_THRESHOLD, BAND_MED,
} from '../types';
import { MIN_COHORT_N, CEILING_STD, capValueAdd, featureGate } from './calibration';
import type { MoveSpec, ValueAddMove, SuppressReason } from './types';
```

> These merge with the imports added in Task 6 — keep a single import of each symbol (`evaluateMove` does not use `effectiveStd` directly; `rawStackValue` already does).

Append:

```ts
function suppressed(move: MoveSpec, reason: SuppressReason): ValueAddMove {
  return {
    key: move.key, label: move.label, status: 'suppressed', suppressReason: reason,
    valueAddLow: 0, valueAddTyp: 0, valueAddHigh: 0,
    costLow: move.costLow, costTyp: move.costTyp, costHigh: move.costHigh,
    netGainTyp: 0, paybackRatio: 0, confidence: 'LOW',
  };
}

/**
 * Evaluate one move into a ValueAddMove. Runs the trust gauntlet:
 *  cohort gates (R², n) → per-driving-feature gates (beta sign, stub, null baseline,
 *  at-ceiling, already-present) → raw exp value → magnitude caps → range + confidence.
 */
export function evaluateMove(
  input: AVMInput,
  move: MoveSpec,
  market: AVMMarketData,
  subjectEstimate: number
): ValueAddMove {
  // Cohort gates
  if (market.r2 === null || market.r2 === undefined || market.r2 < COEFFICIENT_ENGINE_THRESHOLD) {
    return suppressed(move, 'low_r2');
  }
  if (market.n !== null && market.n !== undefined && market.n < MIN_COHORT_N) {
    return suppressed(move, 'thin_cohort');
  }

  const coeff = new Map(market.coefficients.map((c) => [c.featureName, c]));

  // Per-driving-feature gates
  for (const fname of move.drivingFeatures) {
    const c = coeff.get(fname);
    const gate = featureGate(c);
    if (gate) return suppressed(move, gate);
    const spec = FEATURE_SPECS.find((s) => s.name === fname)!;
    const v0 = spec.valueOf(input);
    if (v0 === null) return suppressed(move, 'null_baseline');
    if (v0 >= c!.mean + CEILING_STD * c!.std) return suppressed(move, 'at_ceiling');
  }

  // Already-present: a move that changes none of its driving features (e.g. basement
  // already finished) adds nothing.
  const after = applyMove(input, move.deltas);
  const changed = FEATURE_SPECS.some((s) => {
    if (!move.drivingFeatures.includes(s.name)) return false;
    const a = s.valueOf(input);
    const b = s.valueOf(after);
    return a !== null && b !== null && a !== b;
  });
  if (!changed) return suppressed(move, 'already_present');

  // Raw value → caps
  const raw = rawStackValue(input, after, market, subjectEstimate);
  const addedSqft = (after.buildingAreaTotal ?? 0) - (input.buildingAreaTotal ?? 0);
  const typ = Math.round(capValueAdd(raw, move, subjectEstimate, addedSqft));

  // Range from the cohort band; confidence from R² and band width.
  const sd = Number.isFinite(market.anchor.predSD) ? market.anchor.predSD : 0.1;
  const valueAddLow = Math.round(typ * Math.exp(-sd));
  const valueAddHigh = Math.round(typ * Math.exp(sd));
  let confidence: ValueAddMove['confidence'] =
    market.r2 >= HIGH_CONFIDENCE_THRESHOLD ? 'HIGH' : 'MEDIUM';
  if (sd >= BAND_MED) confidence = 'LOW';

  const netGainTyp = typ - move.costTyp;
  const paybackRatio = move.costTyp > 0 ? typ / move.costTyp : 0;

  return {
    key: move.key, label: move.label, status: 'priced',
    valueAddLow, valueAddTyp: typ, valueAddHigh,
    costLow: move.costLow, costTyp: move.costTyp, costHigh: move.costHigh,
    netGainTyp, paybackRatio, confidence,
  };
}
```

- [ ] **Step 4: Run the golden tests**

Run: `npx vitest run src/lib/avm/valueAdd/engine.calibration.test.ts`
Expected: PASS — Brampton priced in-band; Erin Mills basement/bedroom suppressed, addition/bathroom capped; Churchill bedroom capped; low-R²/thin cohorts suppressed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/avm/valueAdd/engine.ts src/lib/avm/valueAdd/engine.calibration.test.ts
git commit -m "feat(avm): value-add trust gauntlet (evaluateMove gates + caps)"
```

---

## Task 8: `buildValueAddReport` — ranked report, headline, score, insight

**Why:** assembles the user-facing report. Headline upside greedily picks the best **non-overlapping** positive-payback moves (so add_parking + build_garage, or two interior moves, can't double-count) and values them jointly via one re-eval.

**Files:**
- Modify: `src/lib/avm/valueAdd/engine.ts` (add `buildValueAddReport`)
- Test: `src/lib/avm/valueAdd/engine.report.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/avm/valueAdd/engine.report.test.ts
import { describe, it, expect } from 'vitest';
import { buildValueAddReport } from './engine';
import { BRAMPTON_WEST_DETACHED, ERIN_MILLS_CONDO, subject } from './__fixtures__/cohorts';

describe('buildValueAddReport', () => {
  const bramptonHome = subject({
    cityRegion: 'Brampton West',
    buildingAreaTotal: 1560, bathroomsTotalInteger: 3, bedroomsAboveGrade: 3,
    parkingTotal: 2, basementTier: 5, interiorTier: 3, exteriorTier: 3, lotWidth: 40,
  });

  it('produces a ranked report with a positive headline and bounded score', () => {
    const r = buildValueAddReport(bramptonHome, BRAMPTON_WEST_DETACHED);
    expect(r.subjectEstimate).toBeGreaterThan(0);
    expect(r.moves.length).toBe(9);
    // ranked by netGainTyp desc
    const gains = r.moves.map((m) => m.netGainTyp);
    expect([...gains].sort((a, b) => b - a)).toEqual(gains);
    expect(r.headlineUpside).toBeGreaterThan(0);
    expect(r.valueAddScore).toBeGreaterThanOrEqual(0);
    expect(r.valueAddScore).toBeLessThanOrEqual(100);
    expect(r.disclaimer).toMatch(/not an appraisal/i);
    expect(r.basis).toMatch(/Brampton West/);
  });

  it('never lets a suppressed move contribute to the headline', () => {
    const condoHome = subject({
      cityRegion: 'Erin Mills', propertySubType: 'Condo Apartment', rawPropertySubType: 'Condo Apartment',
      buildingAreaTotal: 1169, bathroomsTotalInteger: 2, bedroomsAboveGrade: 2,
      parkingTotal: 1, basementTier: 5, interiorTier: 3, exteriorTier: 3,
    });
    const r = buildValueAddReport(condoHome, ERIN_MILLS_CONDO);
    const basement = r.moves.find((m) => m.key === 'finish_basement')!;
    const bedroom = r.moves.find((m) => m.key === 'add_bedroom')!;
    expect(basement.status).toBe('suppressed');
    expect(bedroom.status).toBe('suppressed');
    // headline is bounded by the stack %-cap and never negative
    expect(r.headlineUpside).toBeGreaterThanOrEqual(0);
  });

  it('returns an unavailable report when the home has no AVM estimate', () => {
    const noEstimate = { ...BRAMPTON_WEST_DETACHED, anchor: { ...BRAMPTON_WEST_DETACHED.anchor, predSD: 0.5 } };
    const r = buildValueAddReport(bramptonHome, noEstimate);
    expect(r.subjectEstimate).toBe(0);
    expect(r.headlineUpside).toBe(0);
    expect(r.valueAddScore).toBe(0);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/lib/avm/valueAdd/engine.report.test.ts`
Expected: FAIL — `buildValueAddReport` not exported.

- [ ] **Step 3: Implement `buildValueAddReport`** (append to `engine.ts`; extend imports)

Extend the top imports of `engine.ts`:

```ts
import { estimateFromMarketData } from '../calculator';
import { MOVE_CATALOG } from './moveCatalog';
import { PCT_CAP_STACK, SCORE_K } from './calibration';
import type { ValueAddReport, MoveKey } from './types';
```

Append:

```ts
const DISCLAIMER =
  'Modeled estimate from recent local sales — not an appraisal or guarantee. ' +
  'Actual returns vary by finish quality, permits, and market timing.';

function unavailableReport(input: AVMInput, market: AVMMarketData): ValueAddReport {
  return {
    cityRegion: input.cityRegion,
    propertySubType: input.propertySubType,
    subjectEstimate: 0,
    headlineUpside: 0,
    valueAddScore: 0,
    moves: MOVE_CATALOG.map((m) => suppressed(m, 'no_estimate')),
    neighbourhoodInsight: 'Not enough recent sales here to model renovation value yet.',
    basis: `${input.cityRegion} · ${input.propertySubType}`,
    disclaimer: DISCLAIMER,
  };
}

/** Deterministic, template-based insight from the cohort's value drivers (no AI). */
function neighbourhoodInsight(input: AVMInput, market: AVMMarketData, moves: ValueAddMove[]): string {
  const priced = moves.filter((m) => m.status === 'priced');
  if (priced.length === 0) return `Renovation premiums in ${input.cityRegion} are hard to model from current sales.`;
  const top = priced.reduce((a, b) => (b.valueAddTyp > a.valueAddTyp ? b : a));
  const suppressedNeg = moves.find((m) => m.suppressReason === 'negative_beta');
  const tail = suppressedNeg ? ` ${suppressedNeg.label.toLowerCase()} adds little here.` : '';
  return `In ${input.cityRegion}, the market pays most for: ${top.label.toLowerCase()}.${tail}`;
}

export function buildValueAddReport(input: AVMInput, market: AVMMarketData): ValueAddReport {
  const base = estimateFromMarketData(input, market);
  const P0 = base.estimatedValue;
  if (P0 <= 0) return unavailableReport(input, market);

  const moves = MOVE_CATALOG.map((m) => evaluateMove(input, m, market, P0)).sort(
    (a, b) => b.netGainTyp - a.netGainTyp
  );
  const byKey = new Map<MoveKey, (typeof MOVE_CATALOG)[number]>(MOVE_CATALOG.map((m) => [m.key, m]));

  // Greedy non-overlapping selection of positive-payback priced moves for the headline.
  const claimed = new Set<string>();
  const selectedDeltas: FeatureDelta[] = [];
  const selected: ValueAddMove[] = [];
  for (const mv of moves) {
    if (mv.status !== 'priced' || mv.paybackRatio <= 1) continue;
    const spec = byKey.get(mv.key)!;
    const fields = spec.deltas.map((d) => d.field);
    if (fields.some((f) => claimed.has(f))) continue;
    fields.forEach((f) => claimed.add(f));
    selectedDeltas.push(...spec.deltas);
    selected.push(mv);
  }

  // Joint value-add via ONE re-eval over the union, capped by the stack %-cap.
  const after = applyMove(input, selectedDeltas);
  let jointValue = Math.max(0, rawStackValue(input, after, market, P0));
  jointValue = Math.min(jointValue, PCT_CAP_STACK * P0);
  const totalCost = selected.reduce((a, m) => a + m.costTyp, 0);
  const headlineUpside = Math.max(0, Math.round(jointValue - totalCost));
  const valueAddScore = Math.min(100, Math.round((jointValue / P0) * SCORE_K));

  return {
    cityRegion: input.cityRegion,
    propertySubType: input.propertySubType,
    subjectEstimate: P0,
    headlineUpside,
    valueAddScore,
    moves,
    neighbourhoodInsight: neighbourhoodInsight(input, market, moves),
    basis: `Based on ${market.n ?? 'recent'} ${input.cityRegion} ${input.propertySubType} sales`,
    disclaimer: DISCLAIMER,
  };
}
```

- [ ] **Step 4: Run the report tests + the full suite**

Run: `npx vitest run src/lib/avm/valueAdd`
Expected: PASS (all valueAdd tests).

Run: `npx vitest run src/lib/avm`
Expected: PASS (no AVM regression).

- [ ] **Step 5: Commit**

```bash
git add src/lib/avm/valueAdd/engine.ts src/lib/avm/valueAdd/engine.report.test.ts
git commit -m "feat(avm): assemble ranked ValueAddReport with headline + score"
```

---

## Task 9: `fetchValueAddReport` async wrapper (DB → report)

**Why:** the single entry point a future UI/route calls. Mirrors `calculateAVM`'s fetch sequence, reusing the prefixed-`city_region`-safe lookups, then delegates to the pure `buildValueAddReport`.

**Files:**
- Modify: `src/lib/avm/valueAdd/engine.ts` (add `fetchValueAddReport`)
- Test: `src/lib/avm/valueAdd/engine.fetch.test.ts`

- [ ] **Step 1: Write the failing test (mocked Supabase)**

```ts
// src/lib/avm/valueAdd/engine.fetch.test.ts
import { describe, it, expect, vi } from 'vitest';
import { fetchValueAddReport } from './engine';
import * as anchorService from '../anchorService';
import * as auditService from '../auditService';
import * as matrixService from '../matrixService';
import { BRAMPTON_WEST_DETACHED, subject } from './__fixtures__/cohorts';

describe('fetchValueAddReport', () => {
  it('assembles market data via the AVM services and returns a report', async () => {
    vi.spyOn(matrixService, 'fetchCoefficients').mockResolvedValue(BRAMPTON_WEST_DETACHED.coefficients);
    vi.spyOn(auditService, 'fetchAuditInfo').mockResolvedValue({
      r2: BRAMPTON_WEST_DETACHED.r2, basePrice: BRAMPTON_WEST_DETACHED.basePrice, n: BRAMPTON_WEST_DETACHED.n!,
    });
    vi.spyOn(anchorService, 'fetchAnchor').mockResolvedValue(BRAMPTON_WEST_DETACHED.anchor);

    const input = subject({
      cityRegion: 'Brampton West',
      buildingAreaTotal: 1560, bathroomsTotalInteger: 3, bedroomsAboveGrade: 3,
      parkingTotal: 2, basementTier: 5, interiorTier: 3, exteriorTier: 3, lotWidth: 40,
    });
    const report = await fetchValueAddReport({} as any, input);
    expect(report.subjectEstimate).toBeGreaterThan(0);
    expect(report.moves.length).toBe(9);
    expect(report.headlineUpside).toBeGreaterThan(0);
  });
});
```

> If `vi.spyOn` does not intercept the named imports under your vitest config, replace the three `vi.spyOn(...)` lines with `vi.mock('../anchorService', ...)`, `vi.mock('../auditService', ...)`, and `vi.mock('../matrixService', ...)` factory mocks returning the same values.

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/lib/avm/valueAdd/engine.fetch.test.ts`
Expected: FAIL — `fetchValueAddReport` not exported.

- [ ] **Step 3: Implement the wrapper** (append to `engine.ts`; extend imports)

Extend the top imports:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAnchor } from '../anchorService';
import { fetchAuditInfo } from '../auditService';
import { fetchCoefficients } from '../matrixService';
```

Append:

```ts
/**
 * Async entry point: load this market's coefficients/audit/anchor (reusing the
 * AVM's prefixed-city_region-safe lookups), then build the pure report. The
 * value-add report does not need the peer comp-grid — at-ceiling homes are
 * suppressed by evaluateMove rather than peer-priced in Phase 1.
 */
export async function fetchValueAddReport(
  supabase: SupabaseClient,
  input: AVMInput
): Promise<ValueAddReport> {
  const [coefficients, audit] = await Promise.all([
    fetchCoefficients(supabase, input.cityRegion, input.propertySubType),
    fetchAuditInfo(supabase, input.cityRegion, input.propertySubType),
  ]);
  const anchor = await fetchAnchor(supabase, input, coefficients, audit.basePrice);
  return buildValueAddReport(input, {
    anchor,
    r2: audit.r2,
    basePrice: audit.basePrice,
    coefficients,
    n: audit.n,
  });
}
```

> Verify `fetchAnchor`'s signature against `src/lib/avm/anchorService.ts` (it is called identically in `calculator.ts:123` as `fetchAnchor(supabase, input, coefficients, audit.basePrice)`). If it differs, match the calculator's call exactly.

- [ ] **Step 4: Run the test + full suite + typecheck + lint**

Run: `npx vitest run src/lib/avm/valueAdd/engine.fetch.test.ts`
Expected: PASS.

Run: `npx vitest run src/lib/avm`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: PASS.

Run: `npm run lint`
Expected: no new errors in `src/lib/avm/valueAdd`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/avm/valueAdd/engine.ts src/lib/avm/valueAdd/engine.fetch.test.ts
git commit -m "feat(avm): fetchValueAddReport async wrapper (DB to report)"
```

---

## Final verification

- [ ] Run the whole engine suite: `npx vitest run src/lib/avm/valueAdd` → all green.
- [ ] Run the whole AVM suite (no regression): `npx vitest run src/lib/avm` → all green, golden master unchanged.
- [ ] Typecheck: `npx tsc --noEmit` → clean.
- [ ] Spot-check the spec's invariants are encoded in tests:
  - No negative value-add is ever displayed (Erin Mills bedroom suppressed). ✓ Task 7
  - Placeholder/condo-basement suppressed. ✓ Task 7
  - Runaway sqft + tiny-std bath/bedroom capped. ✓ Task 7
  - Low-R²/thin cohorts suppressed. ✓ Task 7
  - Headline uses one joint re-eval, never a sum, with non-overlapping selection. ✓ Task 8
  - Engine reuses `estimateFromMarketData` for `subjectEstimate`. ✓ Task 8

## Notes / known Phase-1 limitations (carry into follow-up plans)

- **Collinearity bundles:** moves are mostly single-feature (plus `legal_suite`). The bundle *mechanism* exists (`deltas[]`), but "add bedroom also adds sqft" bundling is deferred; the magnitude caps are the Phase-1 backstop. Revisit with a calibrated bundle table.
- **Regional $/sqft prior** is a flat `PPSF_CAP`; a per-region prior would be sharper for the runaway-condo case.
- **Score/cap constants** (`PCT_CAP`, `PPSF_CAP`, `SCORE_K`, caps) are defensible defaults — tune against the full cohort distribution before the public launch.
- **Peer routing:** at-ceiling homes are suppressed, not yet peer-priced; wiring `fetchPeerAnchor` into the report ("homes like yours after the reno") is a follow-up.
- **Follow-up plans:** (2) standalone UI tool + describe-your-home form + OG share card; (3) SEO neighbourhood pages; (4) on-listing wrapper.
