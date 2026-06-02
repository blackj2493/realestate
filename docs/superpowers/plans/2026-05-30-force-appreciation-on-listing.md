# Force-Appreciation On-Listing Card — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the Phase-1 Value-Add Engine as a server-rendered "Force-Appreciation" card in the listing page's sticky rail, anchored on the displayed AVM estimate.

**Architecture:** Two additive, backward-compatible engine seams (a P0 override + a `predSD` option that skips the comps re-query, plus a new `headlineUpsideGross` field), a pure unit-tested view-model, a zero-JS server card, and best-effort wiring inside the existing `getListingDetail` server fetch. No client data path, no LLM, no AVM-math changes.

**Tech Stack:** Next.js (app router, server components), TypeScript, vitest (node-env, no jsdom), Supabase, Tailwind, shadcn `Card` primitives.

**Spec:** `docs/superpowers/specs/2026-05-30-force-appreciation-on-listing.md`

**Branch/commit discipline:** Work on `feat/composable-filter-bar` (it carries the Phase-1 engine). Stage **explicit paths only** — never `git add -A`/`-u`/`.` — the working tree has unrelated uncommitted media work from a concurrent session. Each commit message ends with the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer.

---

## File Structure

| Action | Path | Responsibility |
|---|---|---|
| Modify | `src/lib/avm/valueAdd/types.ts` | add `headlineUpsideGross` to `ValueAddReport` |
| Modify | `src/lib/avm/valueAdd/engine.ts` | P0 override in `buildValueAddReport`; set `headlineUpsideGross`; `predSD`-skip option in `fetchValueAddReport` |
| Modify | `src/lib/avm/valueAdd/engine.report.test.ts` | cover override scaling + `headlineUpsideGross` |
| Modify | `src/lib/avm/valueAdd/engine.fetch.test.ts` | cover the `predSD` anchor-skip path |
| Create | `src/components/Property/forceAppreciationView.ts` | pure view-model + reason copy |
| Create | `src/components/Property/forceAppreciationView.test.ts` | view-model unit tests |
| Create | `src/components/Property/ForceAppreciationCard.tsx` | server card, native `<details>` |
| Modify | `src/lib/property/getListingDetail.ts` | compute best-effort `valueAdd`; add to `ListingDetail` |
| Modify | `src/app/(app)/properties/[id]/page.tsx` | render `<ForceAppreciationCard>` |

Test command throughout: `npx vitest run src/lib/avm/valueAdd src/components/Property` (scoped). Full gate before finishing: `npm test`, `npx tsc --noEmit`, `npm run lint`, `npm run build`.

---

## Task 1: Engine — `headlineUpsideGross` + P0 override

**Files:**
- Modify: `src/lib/avm/valueAdd/types.ts`
- Modify: `src/lib/avm/valueAdd/engine.ts:141-208` (`unavailableReport`, `buildValueAddReport`)
- Modify: `src/lib/avm/valueAdd/engine.report.test.ts`

- [ ] **Step 1: Add the field to the type**

In `types.ts`, inside `ValueAddReport`, add directly above `headlineUpside`:

```ts
  /** GROSS joint value-add in dollars (capped joint, BEFORE renovation costs).
   *  Always ≥ headlineUpside. 0 in the unavailable report. */
  headlineUpsideGross: number;
```

- [ ] **Step 2: Write failing tests**

In `engine.report.test.ts`, add (reuse the file's existing market/subject fixtures and import as the other cases do):

```ts
it('exposes a gross joint value-add that is ≥ the net headline', () => {
  const report = buildValueAddReport(subject, market); // existing fixtures in this file
  expect(report.headlineUpsideGross).toBeGreaterThanOrEqual(report.headlineUpside);
  expect(report.headlineUpsideGross).toBeGreaterThan(0);
});

it('scales the whole report linearly when P0 is overridden', () => {
  const baseRep = buildValueAddReport(subject, market);
  const override = baseRep.subjectEstimate * 2;
  const scaled = buildValueAddReport(subject, market, { subjectEstimate: override });
  expect(scaled.subjectEstimate).toBe(override);
  const basePriced = baseRep.moves.find((m) => m.status === 'priced')!;
  const scaledPriced = scaled.moves.find((m) => m.key === basePriced.key)!;
  // value-add is P0·(exp(Δ)−1) → doubling P0 doubles each move's value (±rounding)
  expect(scaledPriced.valueAddTyp).toBeGreaterThan(basePriced.valueAddTyp * 1.9);
});

it('leaves output unchanged when no opts are passed', () => {
  const a = buildValueAddReport(subject, market);
  const b = buildValueAddReport(subject, market, {});
  expect(b).toEqual(a);
});
```

> If the file does not already expose `subject`/`market` at module scope, lift them out of the existing `describe`/`it` (or import the shared fixtures from `./__fixtures__/cohorts`) so these cases compile. Do not duplicate fixture literals.

Run: `npx vitest run src/lib/avm/valueAdd/engine.report.test.ts` → Expected: FAIL (`headlineUpsideGross` undefined; 3rd arg not accepted).

- [ ] **Step 3: Implement**

In `engine.ts`, add the opts type above `buildValueAddReport`:

```ts
export interface BuildValueAddOpts {
  /** Override P0 (the home's AVM estimate). The on-listing card passes the estimate
   *  already displayed so the report can never contradict it. Every move value is
   *  P0·(exp(Δ)−1), so this scales the whole report linearly. */
  subjectEstimate?: number;
}
```

Change the signature and the P0 derivation:

```ts
export function buildValueAddReport(
  input: AVMInput,
  market: AVMMarketData,
  opts?: BuildValueAddOpts
): ValueAddReport {
  const P0 =
    opts?.subjectEstimate && opts.subjectEstimate > 0
      ? opts.subjectEstimate
      : estimateFromMarketData(input, market).estimatedValue;
  if (P0 <= 0) return unavailableReport(input, market);
```

(The old `const base = estimateFromMarketData(...); const P0 = base.estimatedValue;` is replaced — `base` was used only for P0.)

Compute the gross headline next to the existing `headlineUpside`:

```ts
  const headlineUpsideGross = Math.max(0, Math.round(jointValue));
  const headlineUpside = Math.max(0, Math.round(jointValue - totalCost));
```

Add `headlineUpsideGross,` to the returned object (next to `headlineUpside`).

In `unavailableReport`, add `headlineUpsideGross: 0,` next to `headlineUpside: 0,`.

- [ ] **Step 4: Run tests to green**

Run: `npx vitest run src/lib/avm/valueAdd/engine.report.test.ts` → Expected: PASS. Then run the whole valueAdd folder to catch shape regressions: `npx vitest run src/lib/avm/valueAdd` → Expected: PASS (fix any other report literal that now needs `headlineUpsideGross`).

- [ ] **Step 5: Commit**

```bash
git add src/lib/avm/valueAdd/types.ts src/lib/avm/valueAdd/engine.ts src/lib/avm/valueAdd/engine.report.test.ts
git commit -m "feat(force-appreciation): P0 override + gross headline in value-add engine

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Engine — `fetchValueAddReport` predSD anchor-skip

**Files:**
- Modify: `src/lib/avm/valueAdd/engine.ts:216-232` (`fetchValueAddReport`)
- Modify: `src/lib/avm/valueAdd/engine.fetch.test.ts`

- [ ] **Step 1: Write failing tests**

In `engine.fetch.test.ts`, add inside the existing `describe`:

```ts
it('skips the anchor/comps query when predSD is supplied, and still prices moves', async () => {
  vi.spyOn(matrixService, 'fetchCoefficients').mockResolvedValue(BRAMPTON_WEST_DETACHED.coefficients);
  vi.spyOn(auditService, 'fetchAuditInfo').mockResolvedValue({
    r2: BRAMPTON_WEST_DETACHED.r2, basePrice: BRAMPTON_WEST_DETACHED.basePrice, n: BRAMPTON_WEST_DETACHED.n ?? 117,
  });
  const anchorSpy = vi.spyOn(anchorService, 'fetchAnchor');

  const input = subject({
    cityRegion: 'Brampton West',
    buildingAreaTotal: 1560, bathroomsTotalInteger: 3, bedroomsAboveGrade: 3,
    parkingTotal: 2, basementTier: 5, interiorTier: 3, exteriorTier: 3, lotWidth: 40,
  });
  const report = await fetchValueAddReport({} as any, input, {
    subjectEstimate: 861351, predSD: 0.07,
  });

  expect(anchorSpy).not.toHaveBeenCalled();
  expect(report.subjectEstimate).toBe(861351);
  expect(report.moves.some((m) => m.status === 'priced')).toBe(true);
});
```

Run: `npx vitest run src/lib/avm/valueAdd/engine.fetch.test.ts` → Expected: FAIL (3rd arg not accepted / anchor still called).

- [ ] **Step 2: Implement**

First confirm the exact shape of `AVMMarketData['anchor']` (the `AnchorResult` returned by `fetchAnchor`) — read its definition in `src/lib/avm/anchorService.ts`. Build a minimal object that satisfies that type with `predSD` set and the other numeric fields `0` and `basis: 'none'`.

Add the opts type and branch in `engine.ts`:

```ts
export interface FetchValueAddOpts {
  subjectEstimate?: number;
  /** Predictive SD already computed by calculateAVM (AVMResult.predictiveSD). When
   *  provided, skip the expensive anchor/comps query — the engine needs the anchor
   *  for predSD only. */
  predSD?: number;
}

export async function fetchValueAddReport(
  supabase: SupabaseClient,
  input: AVMInput,
  opts?: FetchValueAddOpts
): Promise<ValueAddReport> {
  const [coefficients, audit] = await Promise.all([
    fetchCoefficients(supabase, input.cityRegion, input.propertySubType),
    fetchAuditInfo(supabase, input.cityRegion, input.propertySubType),
  ]);
  const anchor =
    opts?.predSD !== undefined && Number.isFinite(opts.predSD)
      ? { anchorLevel: 0, predSD: opts.predSD, nEff: 0, comps: 0, basis: 'none' as const }
      : await fetchAnchor(supabase, input, coefficients, audit.basePrice);
  return buildValueAddReport(
    input,
    { anchor, r2: audit.r2, basePrice: audit.basePrice, coefficients, n: audit.n },
    { subjectEstimate: opts?.subjectEstimate }
  );
}
```

> If the `AnchorResult` type has additional fields, add them to the minimal object with zero/empty defaults so it typechecks. Keep `as const` on `basis` (or import `AnchorBasis` and cast) so `'none'` narrows correctly.

- [ ] **Step 3: Run tests to green**

Run: `npx vitest run src/lib/avm/valueAdd/engine.fetch.test.ts` → Expected: PASS (existing no-opts case still passes; new predSD case passes).

- [ ] **Step 4: Commit**

```bash
git add src/lib/avm/valueAdd/engine.ts src/lib/avm/valueAdd/engine.fetch.test.ts
git commit -m "feat(force-appreciation): predSD seam to skip comps re-query on-listing

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: View-model + tests

**Files:**
- Create: `src/components/Property/forceAppreciationView.ts`
- Create: `src/components/Property/forceAppreciationView.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/components/Property/forceAppreciationView.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { shouldRender, buildView, suppressReasonCopy } from './forceAppreciationView';
import type { ValueAddReport, ValueAddMove, SuppressReason } from '@/lib/avm/valueAdd/types';

const priced = (key: string, netGainTyp: number, over: Partial<ValueAddMove> = {}): ValueAddMove => ({
  key: key as ValueAddMove['key'], label: key, status: 'priced',
  valueAddLow: 0, valueAddTyp: 50000, valueAddHigh: 0,
  costLow: 0, costTyp: 20000, costHigh: 0,
  netGainTyp, paybackRatio: 2.5, confidence: 'HIGH', ...over,
});
const suppressedMove = (key: string, reason: SuppressReason): ValueAddMove => ({
  key: key as ValueAddMove['key'], label: key, status: 'suppressed', suppressReason: reason,
  valueAddLow: 0, valueAddTyp: 0, valueAddHigh: 0, costLow: 0, costTyp: 0, costHigh: 0,
  netGainTyp: 0, paybackRatio: 0, confidence: 'LOW',
});
const report = (over: Partial<ValueAddReport> = {}): ValueAddReport => ({
  cityRegion: 'Brampton West', propertySubType: 'Detached',
  subjectEstimate: 800000, headlineUpsideGross: 140000, headlineUpside: 58000,
  valueAddScore: 72, moves: [], neighbourhoodInsight: 'pays most for: finish the basement.',
  basis: 'Based on 117 Brampton West Detached sales', disclaimer: 'x', ...over,
});

describe('shouldRender', () => {
  it('is false for null, zero estimate, or no priced move', () => {
    expect(shouldRender(null)).toBe(false);
    expect(shouldRender(report({ subjectEstimate: 0, moves: [priced('a', 1)] }))).toBe(false);
    expect(shouldRender(report({ moves: [suppressedMove('a', 'at_ceiling')] }))).toBe(false);
  });
  it('is true with a positive estimate and ≥1 priced move', () => {
    expect(shouldRender(report({ moves: [priced('a', 1)] }))).toBe(true);
  });
});

describe('buildView', () => {
  const v = buildView(report({
    moves: [priced('m1', 90), priced('m2', 80), priced('m3', 70), priced('m4', 60),
            suppressedMove('s1', 'negative_beta')],
  }));
  it('takes the top 3 priced moves as headline rows, rest into moreRows', () => {
    expect(v.topRows.map((r) => r.key)).toEqual(['m1', 'm2', 'm3']);
    expect(v.moreRows.map((r) => r.key)).toEqual(['m4']);
  });
  it('maps suppressed moves to human copy', () => {
    expect(v.suppressed).toEqual([
      { key: 's1', label: 's1', reason: "the local market doesn't pay extra for this" },
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

describe('suppressReasonCopy', () => {
  it('covers every SuppressReason', () => {
    const reasons: SuppressReason[] = ['negative_beta', 'placeholder', 'low_r2', 'thin_cohort',
      'at_ceiling', 'null_baseline', 'already_present', 'no_estimate'];
    for (const r of reasons) expect(suppressReasonCopy(r).length).toBeGreaterThan(0);
  });
});
```

Run: `npx vitest run src/components/Property/forceAppreciationView.test.ts` → Expected: FAIL (module not found).

- [ ] **Step 2: Implement**

Create `src/components/Property/forceAppreciationView.ts`:

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
  topRows: LedgerRow[];
  moreRows: LedgerRow[];
  suppressed: SuppressedRow[];
}

const REASON_COPY: Record<SuppressReason, string> = {
  negative_beta: "the local market doesn't pay extra for this",
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
  const priced = report.moves.filter((m) => m.status === 'priced'); // already sorted by net gain
  const suppressed: SuppressedRow[] = report.moves
    .filter((m) => m.status === 'suppressed')
    .map((m) => ({ key: m.key, label: m.label, reason: suppressReasonCopy(m.suppressReason ?? 'no_estimate') }));
  return {
    score: report.valueAddScore,
    headlineGross: report.headlineUpsideGross,
    headlineNet: report.headlineUpside,
    insight: report.neighbourhoodInsight,
    basis: `${report.basis} · modeled, not appraised`,
    topRows: priced.slice(0, 3).map(toRow),
    moreRows: priced.slice(3).map(toRow),
    suppressed,
  };
}
```

- [ ] **Step 3: Run tests to green**

Run: `npx vitest run src/components/Property/forceAppreciationView.test.ts` → Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/Property/forceAppreciationView.ts src/components/Property/forceAppreciationView.test.ts
git commit -m "feat(force-appreciation): pure view-model + suppress-reason copy

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Server card component

**Files:**
- Create: `src/components/Property/ForceAppreciationCard.tsx`

No render test (node-env has no jsdom). Verified by `tsc` + `build` in Task 5's gate.

- [ ] **Step 1: Implement**

Create `src/components/Property/ForceAppreciationCard.tsx`:

```tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPrice } from "@/lib/utils";
import type { ValueAddReport } from "@/lib/avm/valueAdd/types";
import { shouldRender, buildView, type LedgerRow } from "./forceAppreciationView";

function PaybackBar({ payback }: { payback: number }) {
  const pct = (Math.min(payback, 3) / 3) * 100;
  return (
    <span className="inline-block h-1.5 w-10 rounded bg-slate-700 align-middle">
      <span className="block h-full rounded bg-emerald-500" style={{ width: `${pct}%` }} />
    </span>
  );
}

function Row({ row }: { row: LedgerRow }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="truncate text-slate-300">{row.label}</span>
      <span className="flex shrink-0 items-center gap-2 font-mono">
        <span className="text-emerald-400">+{formatPrice(row.valueTyp)}</span>
        <span className="text-slate-500">−{formatPrice(row.costTyp)}</span>
        <PaybackBar payback={row.payback} />
        <span className="w-9 text-right text-slate-400">{row.payback.toFixed(1)}×</span>
      </span>
    </div>
  );
}

export default function ForceAppreciationCard({ report }: { report: ValueAddReport | null }) {
  if (!shouldRender(report)) return null;
  const v = buildView(report);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>Force-Appreciation</CardTitle>
        <span className="rounded border border-emerald-700 bg-emerald-950/40 px-2 py-0.5 font-mono text-xs text-emerald-300">
          {v.score}/100
        </span>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm">
          <span className="text-slate-400">up to </span>
          <span className="font-semibold text-emerald-400">{formatPrice(v.headlineGross)}</span>
          <span className="text-slate-400"> unlockable · best net </span>
          <span className="font-semibold text-emerald-400">{formatPrice(v.headlineNet)}</span>
        </p>

        {v.insight && <p className="text-xs text-slate-400">{v.insight}</p>}

        <div className="space-y-1.5">
          {v.topRows.map((r) => (
            <Row key={r.key} row={r} />
          ))}
        </div>

        {(v.moreRows.length > 0 || v.suppressed.length > 0) && (
          <details>
            <summary className="cursor-pointer list-none text-xs text-cyan-400 hover:text-cyan-300">
              Why not the others?
            </summary>
            <div className="mt-2 space-y-1.5">
              {v.moreRows.map((r) => (
                <Row key={r.key} row={r} />
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

> Match the import path/casing of the `Card` primitives to how `ListingEstimateCard.tsx` imports them (`@/components/ui/card`). If `CardHeader` rejects `className`, follow the same pattern the sibling cards use to add a header chip.

- [ ] **Step 2: Typecheck the new file**

Run: `npx tsc --noEmit` → Expected: no new errors from `ForceAppreciationCard.tsx` / `forceAppreciationView.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/components/Property/ForceAppreciationCard.tsx
git commit -m "feat(force-appreciation): zero-JS server card with native disclosure

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Wire into the listing page

**Files:**
- Modify: `src/lib/property/getListingDetail.ts`
- Modify: `src/app/(app)/properties/[id]/page.tsx:397`

- [ ] **Step 1: Extend `getListingDetail`**

Add imports near the other avm imports (top of file):

```ts
import { fetchValueAddReport } from "@/lib/avm/valueAdd/engine";
import type { ValueAddReport } from "@/lib/avm/valueAdd/types";
```

Add to the `ListingDetail` interface (next to `estimate`):

```ts
  valueAdd: ValueAddReport | null;
```

Declare the holder next to `let estimate: AVMResult | null = null;`:

```ts
    let valueAdd: ValueAddReport | null = null;
```

Inside the existing AVM `try`, after `estimate = await withTimeout(calculateAVM(...), 8000, "AVM");`, and still inside `if (avmInput) {`:

```ts
        if (estimate && estimate.estimatedValue > 0) {
          try {
            valueAdd = await withTimeout(
              fetchValueAddReport(supabase, avmInput, {
                subjectEstimate: estimate.estimatedValue,
                predSD: estimate.predictiveSD,
              }),
              8000,
              "Value-Add"
            );
          } catch (vaErr) {
            console.error(`[getListingDetail] Value-Add failed for ${listingKey}:`, vaErr);
          }
        }
```

Add `valueAdd,` to the returned object (next to `estimate,`).

- [ ] **Step 2: Render the card on the page**

In `src/app/(app)/properties/[id]/page.tsx`, add the import with the other Property-card imports:

```ts
import ForceAppreciationCard from "@/components/Property/ForceAppreciationCard";
```

Immediately after the `<ListingEstimateCard ... />` line (currently line 397), add:

```tsx
              {/* Force-Appreciation — renovation ROI from the Value-Add Engine */}
              <ForceAppreciationCard report={detail.valueAdd} />
```

- [ ] **Step 3: Full verification gate**

Run each, expect clean:
- `npm test` (full suite — no regressions; AVM + new view-model green)
- `npx tsc --noEmit`
- `npm run lint`
- `npm run build`

- [ ] **Step 4: Commit**

```bash
git add src/lib/property/getListingDetail.ts "src/app/(app)/properties/[id]/page.tsx"
git commit -m "feat(force-appreciation): surface the card on the listing page

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final review

After all tasks: dispatch a final code reviewer over the whole diff (`git diff feat/composable-filter-bar~5..HEAD` scoped to the touched files), confirm the §4 (no-LLM) and P0-consistency guarantees hold end to end, then use **superpowers:finishing-a-development-branch**.

## Self-review (plan vs spec)

- **Spec coverage:** P0 override (T1), gross headline (T1), predSD-skip (T2), view-model + reason copy (T3), zero-JS card + `<details>` (T4), best-effort wiring + render-only-when-priced + anonymous-visible (T5). ✓
- **Placeholders:** none — every code step is concrete.
- **Type consistency:** `headlineUpsideGross` defined in T1, consumed in T3/T4; `BuildValueAddOpts`/`FetchValueAddOpts` defined in T1/T2; `LedgerRow`/`ForceAppreciationView` defined in T3, imported in T4; `shouldRender`/`buildView`/`suppressReasonCopy` names match across T3/T4. ✓
- **Known verification point:** the minimal-anchor literal in T2 must match the real `AnchorResult` shape — the task instructs reading `anchorService.ts` first. ✓
