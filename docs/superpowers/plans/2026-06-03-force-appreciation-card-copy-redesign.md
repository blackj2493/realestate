# Force-Appreciation Card — Copy & Insight Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the on-listing Force-Appreciation card read top-to-bottom with no contradictions — the headline sums the rows shown, the insight leads with the best-ROI move, the rows are labelled, and the score is legible — without changing any AVM math.

**Architecture:** Five presentation-seam changes across the value-add engine and its on-listing card. The engine flags a `recommended` move set (the greedy non-overlapping positive-payback moves it already computes), makes the headline/score the **additive sum** of that set so the card's Total ties out to the column, and re-keys the deterministic insight string to the best net-dollar move. The pure view-model partitions rows by that flag; the server component re-skins to labelled columns + a Total row + a labelled "Upside" score chip.

**Tech Stack:** TypeScript, Next.js (server components, zero client JS on this card), Vitest (node-env — pure-logic tests only, no jsdom), Tailwind CSS.

**Spec:** `docs/superpowers/specs/2026-06-03-force-appreciation-card-copy-redesign-design.md`

**Commit convention:** every commit message ends with the trailer
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
(shown in full in Task 1; abbreviated as `# + trailer` afterward).

**Out of scope (do NOT touch):** coefficients, the move catalog, `capValueAdd`/calibration trust gates, the multiplicative `rawStackValue` value math, cost benchmarks, the AVM, `getListingDetail.ts`, `page.tsx`, and the VOW/IDX data paths.

---

## File structure

| File | Responsibility | Change |
|---|---|---|
| `src/lib/avm/valueAdd/types.ts` | `ValueAddMove`/`ValueAddReport` shapes | add `recommended: boolean` |
| `src/lib/avm/valueAdd/engine.ts` | pure report builder + insight | flag recommended set; headline = Σ recommended; score from sum; re-key insight; drop joint/`PCT_CAP_STACK` |
| `src/lib/avm/valueAdd/calibration.ts` | trust-layer constants | remove unused `PCT_CAP_STACK` |
| `src/components/Property/forceAppreciationView.ts` | pure view-model | partition by flag; `recommendedRows`/`totalCosts`; reworded suppressed copy |
| `src/components/Property/ForceAppreciationCard.tsx` | server card | labelled columns + Total; `Upside n/100` + legend; headline copy; drop bar; empty state |
| `src/lib/avm/valueAdd/engine.report.test.ts` | engine tests | sum tie-out, recommended flag, insight, empty state |
| `src/components/Property/forceAppreciationView.test.ts` | view-model tests | flag partition, totals, new copy |

`engine.math.test.ts` and `engine.fetch.test.ts` are unchanged (they test `rawStackValue`/`applyMove` directly and the fetch wiring — all preserved) but must stay green.

---

## Task 1: Introduce the `recommended` flag (groundwork, no behavior change)

**Files:**
- Modify: `src/lib/avm/valueAdd/types.ts`
- Modify: `src/lib/avm/valueAdd/engine.ts` (the two `ValueAddMove` constructors)
- Modify: `src/components/Property/forceAppreciationView.test.ts` (test helpers)

- [ ] **Step 1: Add the field to the type.** In `src/lib/avm/valueAdd/types.ts`, inside `interface ValueAddMove`, add the field after `confidence:`:

```ts
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  /** True for the greedy, non-overlapping, positive-payback set the card recommends
   *  and the headline sums. Set in buildValueAddReport; false on every other move. */
  recommended: boolean;
```

- [ ] **Step 2: Set `recommended: false` in the suppressed constructor.** In `src/lib/avm/valueAdd/engine.ts`, in `function suppressed(...)`, change the returned object's last line:

```ts
    netGainTyp: 0, paybackRatio: 0, confidence: 'LOW', recommended: false,
```

- [ ] **Step 3: Set `recommended: false` in the priced return.** In `evaluateMove(...)`, change the final `return {...}`'s last line:

```ts
    netGainTyp, paybackRatio, confidence, recommended: false,
```

- [ ] **Step 4: Keep the view-model test helpers compiling.** In `src/components/Property/forceAppreciationView.test.ts`, add `recommended: false` to both factory helpers:

```ts
const priced = (key: string, netGainTyp: number, over: Partial<ValueAddMove> = {}): ValueAddMove => ({
  key: key as ValueAddMove['key'], label: key, status: 'priced',
  valueAddLow: 0, valueAddTyp: 50000, valueAddHigh: 0,
  costLow: 0, costTyp: 20000, costHigh: 0,
  netGainTyp, paybackRatio: 2.5, confidence: 'HIGH', recommended: false, ...over,
});
const suppressedMove = (key: string, reason: SuppressReason): ValueAddMove => ({
  key: key as ValueAddMove['key'], label: key, status: 'suppressed', suppressReason: reason,
  valueAddLow: 0, valueAddTyp: 0, valueAddHigh: 0, costLow: 0, costTyp: 0, costHigh: 0,
  netGainTyp: 0, paybackRatio: 0, confidence: 'LOW', recommended: false,
});
```

- [ ] **Step 5: Run the value-add + view-model suites — everything still green.**

Run: `npx vitest run src/lib/avm/valueAdd src/components/Property/forceAppreciationView.test.ts`
Expected: PASS (the field is additive; no behavior changed yet).

- [ ] **Step 6: Typecheck.**

Run: `npx tsc --noEmit`
Expected: no errors (the two engine constructors are the only `ValueAddMove` literals in `src/`).

- [ ] **Step 7: Commit.**

```bash
git add src/lib/avm/valueAdd/types.ts src/lib/avm/valueAdd/engine.ts src/components/Property/forceAppreciationView.test.ts
git commit -m "refactor(force-appreciation): add recommended flag to ValueAddMove" \
  -m "Additive field, defaulted false everywhere. No behavior change; sets up the headline=Σ-recommended redesign." \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Headline sums the recommended rows; retire the synergy joint

**Files:**
- Test: `src/lib/avm/valueAdd/engine.report.test.ts`
- Modify: `src/lib/avm/valueAdd/engine.ts` (`buildValueAddReport`)
- Modify: `src/lib/avm/valueAdd/calibration.ts` (remove `PCT_CAP_STACK`)

- [ ] **Step 1: Update the fixture import** in `src/lib/avm/valueAdd/engine.report.test.ts`. Replace line 4 and remove the `PCT_CAP_STACK` import (line 6):

```ts
import { BRAMPTON_WEST_DETACHED, ERIN_MILLS_CONDO, buildMarket, subject } from './__fixtures__/cohorts';
import { MOVE_CATALOG } from './moveCatalog';
```

(Delete the line `import { PCT_CAP_STACK } from './calibration';`.)

- [ ] **Step 2: Replace the stack-cap test with a sum tie-out + non-overlap test.** Replace the entire `it('exercises greedy non-overlapping selection without blowing up the headline', ...)` block with:

```ts
  it('flags a non-overlapping recommended set and sums it into the headline', () => {
    const r = buildValueAddReport(bramptonHome, BRAMPTON_WEST_DETACHED);
    const bath = r.moves.find((m) => m.key === 'add_bathroom')!;
    const suite = r.moves.find((m) => m.key === 'legal_suite')!;
    expect(bath.status).toBe('priced');
    expect(suite.status).toBe('priced');
    // both touch bathroomsTotalInteger → at most one can be recommended
    expect(bath.recommended && suite.recommended).toBe(false);

    const rec = r.moves.filter((m) => m.recommended);
    const grossSum = rec.reduce((a, m) => a + m.valueAddTyp, 0);
    const costSum = rec.reduce((a, m) => a + m.costTyp, 0);
    // headline ties out exactly to the recommended rows the card shows
    expect(r.headlineUpsideGross).toBe(grossSum);
    expect(r.headlineUpside).toBe(Math.max(0, grossSum - costSum));
    // every recommended move is priced and pays back
    expect(rec.every((m) => m.status === 'priced' && m.paybackRatio > 1)).toBe(true);
  });
```

- [ ] **Step 3: Fix the stale comment** in the `it('never lets a suppressed move contribute to the headline', ...)` block — change the comment above its last assertion to:

```ts
    // headline sums only recommended (priced) moves and is never negative
    expect(r.headlineUpside).toBeGreaterThanOrEqual(0);
```

- [ ] **Step 4: Run — the new assertions fail.**

Run: `npx vitest run src/lib/avm/valueAdd/engine.report.test.ts`
Expected: FAIL — `headlineUpsideGross` still equals the multiplicative joint, not `grossSum`.

- [ ] **Step 5: Rewrite `buildValueAddReport`.** In `src/lib/avm/valueAdd/engine.ts`, first remove `PCT_CAP_STACK` from the calibration import (line 11) so it reads:

```ts
import { effectiveStd, MIN_COHORT_N, CEILING_STD, capValueAdd, featureGate, SCORE_K } from './calibration';
```

Then replace the body of `buildValueAddReport` (everything from `const byKey = ...` down to the `return {...}`) with:

```ts
  const byKey = new Map<MoveKey, (typeof MOVE_CATALOG)[number]>(MOVE_CATALOG.map((m) => [m.key, m]));
  const evaluated = MOVE_CATALOG.map((m) => evaluateMove(input, m, market, P0)).sort(
    (a, b) => b.netGainTyp - a.netGainTyp
  );

  // Greedy non-overlapping selection of positive-payback priced moves → recommended set.
  const claimed = new Set<string>();
  const recommendedKeys = new Set<MoveKey>();
  for (const mv of evaluated) {
    if (mv.status !== 'priced' || mv.paybackRatio <= 1) continue;
    const fields = byKey.get(mv.key)!.deltas.map((d) => d.field);
    if (fields.some((f) => claimed.has(f))) continue; // non-overlapping fields
    fields.forEach((f) => claimed.add(f));
    recommendedKeys.add(mv.key);
  }
  const moves = evaluated.map((m) => ({ ...m, recommended: recommendedKeys.has(m.key) }));

  // Headline = additive sum of the recommended rows, so the card's Total ties out to the
  // column the user can see. Each valueAddTyp is already per-move capped (capValueAdd); no
  // stack re-cap here — re-clamping would break the tie-out. The 0–100 score stays bounded.
  const recommended = moves.filter((m) => m.recommended);
  const grossSum = recommended.reduce((a, m) => a + m.valueAddTyp, 0);
  const costSum = recommended.reduce((a, m) => a + m.costTyp, 0);
  const headlineUpsideGross = Math.max(0, Math.round(grossSum));
  const headlineUpside = Math.max(0, Math.round(grossSum - costSum));
  const valueAddScore = Math.min(100, Math.round((grossSum / P0) * SCORE_K));

  return {
    cityRegion: input.cityRegion,
    propertySubType: input.propertySubType,
    subjectEstimate: P0,
    headlineUpsideGross,
    headlineUpside,
    valueAddScore,
    moves,
    neighbourhoodInsight: neighbourhoodInsight(input, market, moves),
    basis: `Based on ${market.n ?? 'recent'} ${input.cityRegion} ${input.propertySubType} sales`,
    disclaimer: DISCLAIMER,
  };
```

(`applyMove`, `rawStackValue`, and `FeatureDelta` remain imported — `evaluateMove`/`rawStackValue` still use them per-move. Only the joint headline calculation is gone.)

- [ ] **Step 6: Remove the unused constant.** In `src/lib/avm/valueAdd/calibration.ts`, delete the `PCT_CAP_STACK` export and its doc comment:

```ts
/** A non-overlapping stack of moves never adds more than this fraction.
 *  Consumed by buildValueAddReport (engine.ts) when capping the joint headline upside. */
export const PCT_CAP_STACK = 0.3;
```

- [ ] **Step 7: Run the engine suite — green.**

Run: `npx vitest run src/lib/avm/valueAdd`
Expected: PASS (report tie-out tests pass; `engine.math`/`engine.fetch` unaffected).

- [ ] **Step 8: Typecheck.** Run: `npx tsc --noEmit` — Expected: no errors (`PCT_CAP_STACK` is no longer referenced anywhere).

- [ ] **Step 9: Commit.**

```bash
git add src/lib/avm/valueAdd/engine.ts src/lib/avm/valueAdd/calibration.ts src/lib/avm/valueAdd/engine.report.test.ts
git commit -m "feat(force-appreciation): headline sums the recommended rows" \
  -m "Replace the uncapped multiplicative joint (which exceeded the rows by ~30%) with the additive sum of the greedy non-overlapping positive-payback set, flagged on each move. Score recomputed from the same sum; PCT_CAP_STACK retired. No coefficient/value-math change." \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Re-key the insight to the best net-dollar move (C1)

**Files:**
- Test: `src/lib/avm/valueAdd/engine.report.test.ts`
- Modify: `src/lib/avm/valueAdd/engine.ts` (`neighbourhoodInsight` + import)

- [ ] **Step 1: Add insight + empty-state tests.** Append these two `it` blocks inside the `describe('buildValueAddReport', ...)` block in `engine.report.test.ts`:

```ts
  it('insight names the best net-dollar recommended move, never a rejected one', () => {
    const r = buildValueAddReport(bramptonHome, BRAMPTON_WEST_DETACHED);
    const rec = r.moves.filter((m) => m.recommended);
    const bestNet = rec.reduce((a, b) => (b.netGainTyp > a.netGainTyp ? b : a));
    expect(r.neighbourhoodInsight).toContain('Best payback in Brampton West');
    expect(r.neighbourhoodInsight).toContain(bestNet.label);
    expect(r.neighbourhoodInsight).not.toContain('pays most for');
  });

  it('falls back to a no-payback insight when nothing recommended prices', () => {
    // Synthetic market: one feature, beta so small every move prices but never pays back.
    const tinyMarket = buildMarket({
      basePrice: 800000, r2: 0.9, n: 100,
      coefficients: [{ featureName: 'building_area_total', beta: 0.001, mean: 1500, std: 500 }],
    });
    const home = subject({ cityRegion: 'Nowhere', buildingAreaTotal: 1500 });
    const r = buildValueAddReport(home, tinyMarket);
    expect(r.moves.some((m) => m.status === 'priced')).toBe(true);   // build_addition prices
    expect(r.moves.some((m) => m.recommended)).toBe(false);          // …but pays back < 1×
    expect(r.headlineUpside).toBe(0);
    expect(r.valueAddScore).toBe(0);
    expect(r.neighbourhoodInsight).toContain('is projected to pay for itself');
  });
```

- [ ] **Step 2: Run — they fail.**

Run: `npx vitest run src/lib/avm/valueAdd/engine.report.test.ts`
Expected: FAIL — current insight reads "the market pays most for: …".

- [ ] **Step 3: Add the `formatPrice` import** at the top of `src/lib/avm/valueAdd/engine.ts` (after the existing imports):

```ts
import { formatPrice } from '@/lib/utils';
```

- [ ] **Step 4: Replace `neighbourhoodInsight`.** Swap the whole existing function for:

```ts
/** Deterministic, template-based insight keyed on ROI/net (no AI — CLAUDE.md §4).
 *  Names the recommended move that nets the most after cost, so the headline can
 *  never contradict the ledger. */
function neighbourhoodInsight(input: AVMInput, _market: AVMMarketData, moves: ValueAddMove[]): string {
  const recommended = moves.filter((m) => m.status === 'priced' && m.recommended);
  if (recommended.length === 0) {
    const anyPriced = moves.some((m) => m.status === 'priced');
    return anyPriced
      ? `No renovation in ${input.cityRegion} is projected to pay for itself right now.`
      : `Renovation premiums in ${input.cityRegion} are hard to model from current sales.`;
  }
  const best = recommended.reduce((a, b) => (b.netGainTyp > a.netGainTyp ? b : a));
  return `Best payback in ${input.cityRegion}: ${best.label} — +${formatPrice(best.netGainTyp)} after cost (${best.paybackRatio.toFixed(1)}×).`;
}
```

- [ ] **Step 5: Run the engine suite — green.**

Run: `npx vitest run src/lib/avm/valueAdd`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add src/lib/avm/valueAdd/engine.ts src/lib/avm/valueAdd/engine.report.test.ts
git commit -m "feat(force-appreciation): insight leads with best net-dollar move" \
  -m "Re-key neighbourhoodInsight from highest-gross to the best-net recommended move (and a no-payback fallback), so the headline sentence can no longer recommend a move the ledger rejects. Deterministic template, no LLM." \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: View-model partition + card re-skin (labelled columns, Total, Upside chip)

The view-model interface rename (`topRows → recommendedRows`) and its sole consumer (the card) are one cohesive unit, so they ship together to keep the build green. The view-model is TDD'd; the component (no jsdom) is verified by typecheck + lint + build.

**Files:**
- Test: `src/components/Property/forceAppreciationView.test.ts`
- Modify: `src/components/Property/forceAppreciationView.ts`
- Modify: `src/components/Property/ForceAppreciationCard.tsx`

- [ ] **Step 1: Rewrite the `buildView` describe block** in `forceAppreciationView.test.ts` to assert flag-based partition, totals, and the new suppressed copy. Replace the whole `describe('buildView', ...)` block with:

```ts
describe('buildView', () => {
  const v = buildView(report({
    moves: [
      priced('m1', 90, { recommended: true }),
      priced('m2', 80, { recommended: false }),
      priced('m3', 70, { recommended: true, costTyp: 10000 }),
      priced('m4', 60, { recommended: false }),
      suppressedMove('s1', 'negative_beta'),
    ],
  }));
  it('partitions priced moves by the engine flag, not a slice', () => {
    expect(v.recommendedRows.map((r) => r.key)).toEqual(['m1', 'm3']);
    expect(v.moreRows.map((r) => r.key)).toEqual(['m2', 'm4']);
  });
  it('sums the recommended costs for the Total row', () => {
    expect(v.totalCosts).toBe(30000); // 20000 (m1 default) + 10000 (m3 override)
  });
  it('maps suppressed moves to the softened copy', () => {
    expect(v.suppressed).toEqual([
      { key: 's1', label: 's1', reason: "local sales don't show a reliable premium" },
    ]);
  });
  it('wires headline, score, insight and basis', () => {
    expect(v.score).toBe(72);
    expect(v.headlineGross).toBe(140000);
    expect(v.headlineNet).toBe(58000);
    expect(v.basis).toBe('Based on 117 Brampton West Detached sales · modeled, not appraised');
    expect(v.insight).toContain('finish the basement');
  });
});
```

- [ ] **Step 2: Run — fails.**

Run: `npx vitest run src/components/Property/forceAppreciationView.test.ts`
Expected: FAIL — `v.recommendedRows`/`v.totalCosts` are undefined; old copy string differs.

- [ ] **Step 3: Rewrite the view-model.** Replace the entire contents of `src/components/Property/forceAppreciationView.ts` with:

```ts
// src/components/Property/forceAppreciationView.ts
import type { ValueAddReport, ValueAddMove, SuppressReason } from '@/lib/avm/valueAdd/types';

export interface LedgerRow {
  key: string;
  label: string;
  valueTyp: number;
  costTyp: number;
  payback: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
}
export interface SuppressedRow {
  key: string;
  label: string;
  reason: string;
}
export interface ForceAppreciationView {
  score: number;
  headlineGross: number;
  headlineNet: number;
  insight: string;
  basis: string;
  /** The greedy positive-payback set the headline sums (engine `recommended` flag). */
  recommendedRows: LedgerRow[];
  /** Σ costTyp of recommendedRows — the Total row's Costs cell. */
  totalCosts: number;
  /** Priced-but-not-recommended moves (the "Why not the others?" disclosure). */
  moreRows: LedgerRow[];
  suppressed: SuppressedRow[];
}

const REASON_COPY: Record<SuppressReason, string> = {
  negative_beta: "local sales don't show a reliable premium",
  placeholder: 'not enough local signal to price this',
  low_r2: 'too few comparable sales to model this area',
  thin_cohort: 'too few comparable sales to model this area',
  at_ceiling: 'this home is already top-of-market on this',
  null_baseline: 'this home is missing the data needed',
  already_present: 'already present in this home',
  no_estimate: 'no estimate available for this home',
};

export function suppressReasonCopy(reason: SuppressReason): string {
  return REASON_COPY[reason];
}

export function shouldRender(report: ValueAddReport | null): report is ValueAddReport {
  return (
    report !== null &&
    report.subjectEstimate > 0 &&
    report.moves.some((m) => m.status === 'priced')
  );
}

function toRow(m: ValueAddMove): LedgerRow {
  return {
    key: m.key,
    label: m.label,
    valueTyp: m.valueAddTyp,
    costTyp: m.costTyp,
    payback: m.paybackRatio,
    confidence: m.confidence,
  };
}

export function buildView(report: ValueAddReport): ForceAppreciationView {
  const priced = report.moves.filter((m) => m.status === 'priced'); // sorted by net gain
  const recommended = priced.filter((m) => m.recommended);
  const more = priced.filter((m) => !m.recommended);
  const suppressed: SuppressedRow[] = report.moves
    .filter((m) => m.status === 'suppressed')
    .map((m) => ({ key: m.key, label: m.label, reason: suppressReasonCopy(m.suppressReason ?? 'no_estimate') }));
  return {
    score: report.valueAddScore,
    headlineGross: report.headlineUpsideGross,
    headlineNet: report.headlineUpside,
    insight: report.neighbourhoodInsight,
    basis: `${report.basis} · modeled, not appraised`,
    recommendedRows: recommended.map(toRow),
    totalCosts: recommended.reduce((a, m) => a + m.costTyp, 0),
    moreRows: more.map(toRow),
    suppressed,
  };
}
```

- [ ] **Step 4: Run — view-model green.**

Run: `npx vitest run src/components/Property/forceAppreciationView.test.ts`
Expected: PASS.

- [ ] **Step 5: Re-skin the card.** Replace the entire contents of `src/components/Property/ForceAppreciationCard.tsx` with:

```tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPrice } from "@/lib/utils";
import type { ValueAddReport } from "@/lib/avm/valueAdd/types";
import { shouldRender, buildView, type LedgerRow } from "./forceAppreciationView";
import VowGateOverlay from "@/components/auth/VowGateOverlay";

const SCORE_LEGEND =
  "Upside = the share of this home's value you could add by renovating, before cost (0–100).";
const COLS = "grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-3";

function ColumnHeader() {
  return (
    <div className={`${COLS} text-[10px] uppercase tracking-wide text-slate-500`}>
      <span />
      <span className="text-right">Adds</span>
      <span className="text-right">Costs</span>
      <span className="w-10 text-right">Return</span>
    </div>
  );
}

function LedgerRowView({ row }: { row: LedgerRow }) {
  return (
    <div className={`${COLS} text-xs`}>
      <span className="truncate text-slate-300">{row.label}</span>
      <span className="text-right font-mono text-emerald-400">+{formatPrice(row.valueTyp)}</span>
      <span className="text-right font-mono text-slate-500">−{formatPrice(row.costTyp)}</span>
      <span className="w-10 text-right font-mono text-slate-400">
        {Number.isFinite(row.payback) ? row.payback.toFixed(1) : "—"}×
      </span>
    </div>
  );
}

export default function ForceAppreciationCard({
  report,
  locked,
}: {
  report: ValueAddReport | null;
  /** VOW gate: Value-Add is AVM-derived — render a blurred "Login Required" teaser for anon. */
  locked?: boolean;
}) {
  if (locked) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>Force-Appreciation</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="relative">
            <div className="space-y-2 blur-sm select-none" aria-hidden="true">
              <p className="text-sm">
                <span className="text-slate-400">up to </span>
                <span className="font-semibold text-emerald-400">$000,000</span>
                <span className="text-slate-400"> unlockable · ~$000,000 net after cost</span>
              </p>
              <div className="h-3 w-full rounded bg-slate-700/40" />
              <div className="h-3 w-2/3 rounded bg-slate-700/40" />
            </div>
            <VowGateOverlay message="Sign in to view value-add ROI" />
          </div>
        </CardContent>
      </Card>
    );
  }
  if (!shouldRender(report)) return null;
  const v = buildView(report);
  const hasRecommended = v.recommendedRows.length > 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>Force-Appreciation</CardTitle>
        <span
          title={SCORE_LEGEND}
          className="cursor-help rounded border border-emerald-700 bg-emerald-950/40 px-2 py-0.5 font-mono text-xs text-emerald-300"
        >
          Upside {v.score}/100
        </span>
      </CardHeader>
      <CardContent className="space-y-3">
        {hasRecommended && (
          <p className="text-sm">
            <span className="text-slate-400">up to </span>
            <span className="font-semibold text-emerald-400">{formatPrice(v.headlineGross)}</span>
            <span className="text-slate-400"> unlockable · ~</span>
            <span className="font-semibold text-emerald-400">{formatPrice(v.headlineNet)}</span>
            <span className="text-slate-400"> net after cost</span>
          </p>
        )}

        {v.insight && <p className="text-xs text-slate-400">{v.insight}</p>}

        {hasRecommended && (
          <div className="space-y-1.5">
            <ColumnHeader />
            {v.recommendedRows.map((r) => (
              <LedgerRowView key={r.key} row={r} />
            ))}
            <div className={`${COLS} border-t border-slate-700 pt-1 text-xs font-semibold`}>
              <span className="text-slate-400">Total</span>
              <span className="text-right font-mono text-emerald-400">+{formatPrice(v.headlineGross)}</span>
              <span className="text-right font-mono text-slate-500">−{formatPrice(v.totalCosts)}</span>
              <span className="w-10 text-right font-mono text-emerald-400">{formatPrice(v.headlineNet)}</span>
            </div>
          </div>
        )}

        {(v.moreRows.length > 0 || v.suppressed.length > 0) && (
          <details open={!hasRecommended}>
            <summary className="cursor-pointer list-none text-xs text-cyan-400 hover:text-cyan-300">
              {hasRecommended ? "Why not the others?" : "Modeled moves (none pay back here)"}
            </summary>
            <div className="mt-2 space-y-1.5">
              {v.moreRows.length > 0 && <ColumnHeader />}
              {v.moreRows.map((r) => (
                <LedgerRowView key={r.key} row={r} />
              ))}
              {v.suppressed.map((s) => (
                <div key={s.key} className="flex justify-between gap-2 text-xs">
                  <span className="truncate text-slate-400">{s.label}</span>
                  <span className="shrink-0 text-right text-slate-500">{s.reason}</span>
                </div>
              ))}
            </div>
          </details>
        )}

        <p className="text-[10px] text-slate-500">{v.basis}</p>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 6: Typecheck + lint + build.**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: no type errors; lint clean; build succeeds. (The old `PaybackBar` is gone; nothing references it.)

- [ ] **Step 7: Commit.**

```bash
git add src/components/Property/forceAppreciationView.ts src/components/Property/forceAppreciationView.test.ts src/components/Property/ForceAppreciationCard.tsx
git commit -m "feat(force-appreciation): labelled columns, Total row, Upside score" \
  -m "View-model partitions by the recommended flag (recommendedRows/moreRows + totalCosts) and softens the negative-coefficient copy. Card re-skins to Adds/Costs/Return columns with a Total that ties to the headline, an 'Upside n/100' chip + legend tooltip, 'net after cost' headline, and an expanded empty state; payback bar dropped." \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Full verification + manual spot-check

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite.**

Run: `npx vitest run`
Expected: PASS — all suites, including `engine.math.test.ts` and `engine.fetch.test.ts` (unchanged).

- [ ] **Step 2: Typecheck, lint, build.**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: all clean.

- [ ] **Step 3: Manual spot-check (dev server).**

Run: `npm run dev`, then open a **detached** listing in a rich cohort (e.g. Brampton/Lisgar). Confirm on the Force-Appreciation card:
- The `Adds` column sums to the `up to … unlockable` figure and the `Total` row's net equals `~… net after cost`.
- The insight names one of the recommended rows (not a "Why not the others?" row); no "pays most for".
- The score chip reads `Upside n/100`; hovering shows the legend.
- Suppressed moves read "local sales don't show a reliable premium" (no "doesn't pay extra").

- [ ] **Step 4: Manual no-card check.** Open a **condo** (thin/placeholder cohort) and confirm the card does not render (`shouldRender` false). Stop the dev server.

- [ ] **Step 5 (optional): no commit needed** — this task only verifies. If the manual check surfaces a copy/layout tweak, make it, re-run Step 2, and commit with a `fix(force-appreciation): …` message + trailer.

---

## Self-review notes (author)
- **Spec coverage:** H1 headline → Task 2; C1 insight + empty state → Task 3; R2 columns + Total + D1 score chip/legend + E suppressed copy → Task 4; `recommended` flag → Task 1; tests → Tasks 2–4; verification → Task 5. All §5 sub-sections mapped.
- **Type consistency:** `recommended: boolean` (Task 1) is read in `buildValueAddReport`/`neighbourhoodInsight` (Tasks 2–3) and `buildView` (Task 4); view fields `recommendedRows`/`moreRows`/`totalCosts`/`headlineGross`/`headlineNet`/`score`/`insight`/`basis` are produced in Task 4's view-model and consumed by the same task's component. No dangling names.
- **No AVM-math change:** `rawStackValue`, `capValueAdd`, coefficients, and the move catalog are untouched; only the headline aggregation, the insight string, and presentation change.
