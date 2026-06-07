# De-fake the Terminal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repoint every live terminal/dashboard/compare/watchlist surface from the fabricated `ExtrapolatedCapRate` to the real `cap_rate_est` / `gross_yield_est`, behind a render-time sanity band, and flip the default persona to Flipper — without a reindex.

**Architecture:** A new pure `sanityBand` module is the single source of truth for plausible ranges + the `hasRentEstimate` predicate. Every read site swaps the fake field for the real one through that guard. `cap_rate_est`/`gross_yield_est`/`net_monthly_cashflow` are verified indexed+sortable in `typesenseSchema.ts:231-234`, so filter/sort/histogram clauses are valid. The listing-detail page (whose Supabase `full_payload` lacks the derived field) fetches the real cap via a Typesense id-lookup and drops the fake `calculateProForma` engine call. The fake field stays in the index (dead) until the next reindex.

**Tech Stack:** TypeScript, Next.js (server + client components), Typesense, Zustand, Vitest (node-env, **no jsdom** — pure-logic tests only; UI/IO sites verified via `tsc`+`eslint`+grep).

**Design spec:** `docs/superpowers/specs/2026-06-06-defake-terminal-design.md` (read it first — §4 band, §4.1 field-not-row, §4.2 cashflow forward-rule, §5 deal-score, §6 inventory, §6.1 listing page, §7 aggregate honesty, §8 persona-flip gate, §9 retirement).

**Testing reality (memory `vitest-node-env-no-jsdom`):** tests run in node-env with no DOM. Do NOT write React render tests. The pure configs/functions here (`buildFilterString`, `columnSortValue`, `getMapMetric`, `supportsHistogram`, `BOARDS`, the band module, `dealScoreFromDocument`, the zustand initial state) ARE node-testable — use them. Render cells (`LedgerRow`) and Typesense-IO sites (`bubbles/stats`, dashboard queries, `getListingDetail`) are verified by `tsc --noEmit` + `eslint` + a grep gate.

---

## File Structure

- **Create** `src/lib/metrics/sanityBand.ts` — pure band guards + `hasRentEstimate`. One responsibility: validate/suppress the real financial fields. No I/O, no imports.
- **Create** `src/lib/metrics/sanityBand.test.ts` — vitest unit tests for the above.
- **Modify** `src/lib/dealScore/fromListingDocument.ts` — feed band-validated cap (§5).
- **Create** `src/lib/dealScore/fromListingDocument.test.ts` — band-validated deal-score input.
- **Modify** `src/components/CommandCenter/columnSort.ts` — sort values off real fields.
- **Create** `src/components/CommandCenter/columnSort.test.ts` — `columnSortValue` cap/yield.
- **Modify** `src/components/CommandCenter/LedgerRow.tsx` — cap+yield cells (drop `*100`).
- **Modify** `src/lib/personas/personaConfig.ts` — cashflow+smart filter/sort/color/control + stale comments.
- **Create** `src/lib/personas/personaConfig.test.ts` — `buildFilterString`/`sortBy` emit real fields.
- **Modify** `src/lib/personas/mapMetrics.ts` — Cap Rate metric → `cap_rate_est`.
- **Create** `src/lib/personas/mapMetrics.test.ts` — metric field + `bandFilterClause`.
- **Modify** `src/lib/filters/histogram.ts` — add real fields to `HISTOGRAM_FIELDS`.
- **Modify** `src/lib/filters/histogram.test.ts` — assert `supportsHistogram('cap_rate_est')` (file exists per spec §6).
- **Modify** `src/lib/compare/compareMetricsConfig.ts` — `capRateVA` → real field + band.
- **Create** `src/lib/compare/compareMetricsConfig.test.ts` — `capRateVA.get` band behavior.
- **Modify** `src/lib/dashboard/queries.ts` — `fetchRegionStats` + `fetchRegionSpecialty`.
- **Modify** `src/lib/dashboard/boards.ts` — `cap_rate` board fields.
- **Create** `src/lib/dashboard/boards.test.ts` — `BOARDS.cap_rate` real fields.
- **Modify** `src/components/dashboard/DashboardHeatTile.tsx` — `cap` metric accessor.
- **Modify** `src/lib/bubbles/stats.ts` — `medianCapRate` source + band.
- **Modify** `src/lib/watchlist/useWatchlistSnapshot.ts` — `avgCapRate` + `capN`.
- **Modify** `src/lib/property/getListingDetail.ts` — Typesense cap lookup; drop fake engine (§6.1).
- **Modify** `src/lib/stores/commandCenterStore.ts` — default persona `smart`→`flippers` (§8, isolated commit).

---

## Task 0: Prerequisites (worktree env — not TDD)

**Files:** none

- [ ] **Step 1: Confirm the worktree + baseline.** You are in `.claude/worktrees/feat+defake-terminal` on branch `feat/defake-terminal`. Install deps + capture a green baseline before any change.

Run: `npm install`
Then: `npx tsc --noEmit && npm run lint && npm test`
Expected: all pass (baseline). If `npm test` has pre-existing failures unrelated to cap rate, note them — they are not yours to fix here.

- [ ] **Step 2: Capture the pre-state field counts** (sanity reference for the end gate).

Run: `node scripts/admin/_verifyYield.cjs`
Expected: prints non-zero `cap_rate_est` / `gross_yield_est` counts (~34.7k / ~35.3k). If it errors on env, it needs `TYPESENSE_ADMIN_API_KEY` — skip and note; it's a nicety, not a blocker.

---

## Task 1: Sanity-band module (pure, TDD) — commit 1

**Files:**
- Create: `src/lib/metrics/sanityBand.ts`
- Test: `src/lib/metrics/sanityBand.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/metrics/sanityBand.test.ts
import { describe, it, expect } from "vitest";
import {
  CAP_RATE_BAND, GROSS_YIELD_BAND,
  capRateOrNull, grossYieldOrNull, hasRentEstimate,
} from "./sanityBand";

describe("capRateOrNull", () => {
  it("passes in-band values", () => {
    expect(capRateOrNull(CAP_RATE_BAND.min)).toBe(1);
    expect(capRateOrNull(6.5)).toBe(6.5);
    expect(capRateOrNull(CAP_RATE_BAND.max)).toBe(15);
  });
  it("nulls out-of-band, zero, negative, and nullish", () => {
    expect(capRateOrNull(0)).toBeNull();
    expect(capRateOrNull(0.9)).toBeNull();
    expect(capRateOrNull(15.1)).toBeNull();
    expect(capRateOrNull(-3)).toBeNull(); // opex>rent: real but not displayable
    expect(capRateOrNull(null)).toBeNull();
    expect(capRateOrNull(undefined)).toBeNull();
  });
});

describe("grossYieldOrNull", () => {
  it("passes in-band, nulls outside [1.5,18]", () => {
    expect(grossYieldOrNull(1.5)).toBe(1.5);
    expect(grossYieldOrNull(5.2)).toBe(5.2);
    expect(grossYieldOrNull(18)).toBe(18);
    expect(grossYieldOrNull(1.49)).toBeNull();
    expect(grossYieldOrNull(18.1)).toBeNull();
    expect(grossYieldOrNull(0)).toBeNull();
  });
});

describe("hasRentEstimate", () => {
  it("true when either real field is > 0", () => {
    expect(hasRentEstimate({ cap_rate_est: 5 })).toBe(true);
    expect(hasRentEstimate({ gross_yield_est: 4 })).toBe(true);
  });
  it("false when both absent/zero", () => {
    expect(hasRentEstimate({})).toBe(false);
    expect(hasRentEstimate({ cap_rate_est: 0, gross_yield_est: 0 })).toBe(false);
    expect(hasRentEstimate({ cap_rate_est: null })).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/metrics/sanityBand.test.ts`
Expected: FAIL — "Cannot find module './sanityBand'".

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/metrics/sanityBand.ts
/**
 * Render-time sanity band for the real cap-rate / gross-yield fields.
 *
 * Catches tier-fallback mismatch at the extremes (a luxury home handed a coarse
 * city rent → spuriously low; a cheap unit handed a too-high comp → spuriously
 * high). FIELD-LEVEL suppression only (spec §4.1): a garbage value blanks the
 * CELL, never drops the listing. NEVER use these bounds as a default global query
 * filter — fold them into filter_by only when the user actively sorts/filters by
 * the metric.
 *
 * Units: both fields are PERCENT (cap_rate_est = NOI/price*100,
 * gross_yield_est = rent/price*100), per financialMetrics.ts.
 *
 * Compliance (spec §3): IDX-only metric (own list price × active for-lease asking
 * rents), shipped at the rent index's N≥5 floor. Not VOW-derived.
 */
export const CAP_RATE_BAND = { min: 1, max: 15 } as const; // percent
export const GROSS_YIELD_BAND = { min: 1.5, max: 18 } as const; // percent

function inBandOrNull(v: number | null | undefined, lo: number, hi: number): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : null;
}

/** Returns the cap rate (%) if plausibly in-band, else null (→ render "—"). */
export function capRateOrNull(v: number | null | undefined): number | null {
  return inBandOrNull(v, CAP_RATE_BAND.min, CAP_RATE_BAND.max);
}

/** Returns the gross yield (%) if plausibly in-band, else null (→ render "—"). */
export function grossYieldOrNull(v: number | null | undefined): number | null {
  return inBandOrNull(v, GROSS_YIELD_BAND.min, GROSS_YIELD_BAND.max);
}

/**
 * True when the listing carries any real rent-derived estimate. Gates the
 * (currently orphan) cashflow surfaces per spec §4.2 — exported now so the rule is
 * enforceable the moment a cashflow display/sort/filter is wired.
 */
export function hasRentEstimate(doc: {
  cap_rate_est?: number | null;
  gross_yield_est?: number | null;
}): boolean {
  return (
    (typeof doc.cap_rate_est === "number" && doc.cap_rate_est > 0) ||
    (typeof doc.gross_yield_est === "number" && doc.gross_yield_est > 0)
  );
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/lib/metrics/sanityBand.test.ts`
Expected: PASS (all three describe blocks).

- [ ] **Step 5: Typecheck + lint**

Run: `npx tsc --noEmit && npx eslint src/lib/metrics/sanityBand.ts`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/metrics/sanityBand.ts src/lib/metrics/sanityBand.test.ts
git commit -m "feat(metrics): sanity band + hasRentEstimate module + tests"
```

---

## Task 2: Deal-score input band-validation (TDD) — commit 2

**Files:**
- Modify: `src/lib/dealScore/fromListingDocument.ts:25-26`
- Test: `src/lib/dealScore/fromListingDocument.test.ts`

**Context:** `computeDealScore` is already correct (drops the yield component when `capRatePct` is not `> 0`, renormalizes). The defect is the INPUT: it reads the fake field first and an out-of-band real cap would clamp to max yield points. Feed band-validated cap.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/dealScore/fromListingDocument.test.ts
import { describe, it, expect } from "vitest";
import { dealScoreFromDocument } from "./fromListingDocument";
import type { ListingDocument } from "@/lib/typesense/client";

// Minimal doc with enough signal that the score is non-null even without yield.
const baseDoc = (over: Partial<ListingDocument> = {}): ListingDocument =>
  ({ ListPrice: 800000, OriginalListPrice: 850000, DaysOnMarket: 30, ...over } as ListingDocument);

const hasYield = (doc: ListingDocument) =>
  dealScoreFromDocument(doc).components.some((c) => c.key === "yield");

describe("dealScoreFromDocument cap input", () => {
  it("includes the yield component for an in-band real cap", () => {
    expect(hasYield(baseDoc({ cap_rate_est: 6 }))).toBe(true);
  });
  it("drops the yield component for an out-of-band real cap (no max-points clamp)", () => {
    expect(hasYield(baseDoc({ cap_rate_est: 16 }))).toBe(false);
    expect(hasYield(baseDoc({ cap_rate_est: 0 }))).toBe(false);
  });
  it("ignores the fake ExtrapolatedCapRate entirely", () => {
    // fake present, real absent → yield component must NOT appear
    expect(hasYield(baseDoc({ ExtrapolatedCapRate: 8 } as Partial<ListingDocument>))).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/dealScore/fromListingDocument.test.ts`
Expected: FAIL — the "ignores the fake" case currently includes a yield component (reads `ExtrapolatedCapRate`).

- [ ] **Step 3: Edit the implementation**

In `src/lib/dealScore/fromListingDocument.ts`, add the import after line 14 and replace line 26 + its consumer (line 36).

Add import (after the existing `import type { ListingDocument }` line):
```typescript
import { capRateOrNull } from "@/lib/metrics/sanityBand";
```

Replace:
```typescript
  const capRate = doc.ExtrapolatedCapRate ?? doc.cap_rate_est;
```
with:
```typescript
  const capRate = capRateOrNull(doc.cap_rate_est);
```

Replace (in the `computeDealScore({...})` call):
```typescript
    capRatePct: typeof capRate === "number" ? capRate : null,
```
with:
```typescript
    capRatePct: capRate,
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/lib/dealScore/fromListingDocument.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + lint**

Run: `npx tsc --noEmit && npx eslint src/lib/dealScore/fromListingDocument.ts`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/dealScore/fromListingDocument.ts src/lib/dealScore/fromListingDocument.test.ts
git commit -m "fix(dealscore): band-validated cap input, drop fake-field read"
```

---

## Task 3: Ledger sort values (TDD) + ledger cells (render)

**Files:**
- Modify: `src/components/CommandCenter/columnSort.ts:56-59`
- Test: `src/components/CommandCenter/columnSort.test.ts`
- Modify: `src/components/CommandCenter/LedgerRow.tsx:51-57`

- [ ] **Step 1: Write the failing test for `columnSortValue`**

```typescript
// src/components/CommandCenter/columnSort.test.ts
import { describe, it, expect } from "vitest";
import { columnSortValue } from "./columnSort";
import type { ListingDocument } from "@/lib/typesense/client";

const doc = (over: Partial<ListingDocument> = {}): ListingDocument => ({ ...over } as ListingDocument);

describe("columnSortValue cap/yield", () => {
  it("uses the real cap_rate_est, band-guarded", () => {
    expect(columnSortValue(doc({ cap_rate_est: 6.2 }), "capRate")).toBe(6.2);
    expect(columnSortValue(doc({ cap_rate_est: 99 }), "capRate")).toBeNull();
    expect(columnSortValue(doc({}), "capRate")).toBeNull();
  });
  it("uses the real gross_yield_est (percent), band-guarded — NOT the fraction", () => {
    expect(columnSortValue(doc({ gross_yield_est: 5.1 }), "yield")).toBe(5.1);
    expect(columnSortValue(doc({ gross_yield_est: 99 }), "yield")).toBeNull();
  });
  it("ignores the fake ExtrapolatedCapRate", () => {
    expect(columnSortValue(doc({ ExtrapolatedCapRate: 8 } as Partial<ListingDocument>), "capRate")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/components/CommandCenter/columnSort.test.ts`
Expected: FAIL (currently reads `ExtrapolatedCapRate` / the fraction `targetGrossYield`).

- [ ] **Step 3: Edit `columnSort.ts`**

Add import after line 12 (`import type { ColumnType }...`):
```typescript
import { capRateOrNull, grossYieldOrNull } from "@/lib/metrics/sanityBand";
```

Replace:
```typescript
    case "capRate":
      return doc.ExtrapolatedCapRate ?? doc.cap_rate_est ?? null;
    case "yield":
      return doc.targetGrossYield ?? doc.gross_yield_est ?? null;
```
with:
```typescript
    case "capRate":
      return capRateOrNull(doc.cap_rate_est);
    case "yield":
      return grossYieldOrNull(doc.gross_yield_est);
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/components/CommandCenter/columnSort.test.ts`
Expected: PASS.

- [ ] **Step 5: Edit `LedgerRow.tsx` cells (render — no unit test; verified by tsc + grep)**

Replace:
```typescript
    case "capRate": {
      const v = doc.ExtrapolatedCapRate ?? doc.cap_rate_est;
      return <div className={cn(base, "text-cyan-400")}>{v ? `${v.toFixed(1)}%` : "—"}</div>;
    }
    case "yield": {
      const v = doc.targetGrossYield ?? doc.gross_yield_est;
      return <div className={cn(base, "text-cyan-400")}>{v ? `${(v * 100).toFixed(1)}%` : "—"}</div>;
    }
```
with:
```typescript
    case "capRate": {
      const v = capRateOrNull(doc.cap_rate_est);
      return <div className={cn(base, "text-cyan-400")}>{v != null ? `${v.toFixed(1)}%` : "—"}</div>;
    }
    case "yield": {
      // gross_yield_est is already a PERCENT — no ×100 (that was for the old fraction targetGrossYield).
      const v = grossYieldOrNull(doc.gross_yield_est);
      return <div className={cn(base, "text-cyan-400")}>{v != null ? `${v.toFixed(1)}%` : "—"}</div>;
    }
```

Add the import after line 17 (`import { carryFor } from "./columnSort";`):
```typescript
import { capRateOrNull, grossYieldOrNull } from "@/lib/metrics/sanityBand";
```

- [ ] **Step 6: Typecheck + lint**

Run: `npx tsc --noEmit && npx eslint src/components/CommandCenter/columnSort.ts src/components/CommandCenter/LedgerRow.tsx`
Expected: no errors.

---

## Task 4: Persona config repoint (TDD) — (commit 3 covers Tasks 3–6)

**Files:**
- Modify: `src/lib/personas/personaConfig.ts` (lines 7-19, 225-228, 236, 250, 260, 267, 272, 280)
- Test: `src/lib/personas/personaConfig.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/personas/personaConfig.test.ts
import { describe, it, expect } from "vitest";
import { PERSONA_CONFIG, defaultTerminalFilters } from "./personaConfig";

const f = (over = {}) => ({ ...defaultTerminalFilters, ...over });

describe("cashflow persona — real cap field", () => {
  it("filters on cap_rate_est with the band ceiling, not ExtrapolatedCapRate", () => {
    const s = PERSONA_CONFIG.cashflow.buildFilterString(f({ minCapRate: 5 }));
    expect(s).toContain("cap_rate_est:>=5");
    expect(s).toContain("cap_rate_est:<=15");
    expect(s).not.toContain("ExtrapolatedCapRate");
  });
  it("sorts on cap_rate_est", () => {
    expect(PERSONA_CONFIG.cashflow.sortBy).toBe("cap_rate_est");
  });
  it("emits no cap clause when the slider is at 0", () => {
    expect(PERSONA_CONFIG.cashflow.buildFilterString(f())).not.toContain("cap_rate_est");
  });
});

describe("smart persona — real cap field on the yield slider", () => {
  it("thresholds cap_rate_est, not ExtrapolatedCapRate", () => {
    const s = PERSONA_CONFIG.smart.buildFilterString(f({ minYield: 4 }));
    expect(s).toContain("cap_rate_est:>=4");
    expect(s).not.toContain("ExtrapolatedCapRate");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/personas/personaConfig.test.ts`
Expected: FAIL (emits `ExtrapolatedCapRate`, `sortBy` is `ExtrapolatedCapRate`).

- [ ] **Step 3: Edit `personaConfig.ts`**

Add import after line 23 (`import type { ListingDocument }...`):
```typescript
import { capRateOrNull, grossYieldOrNull } from "@/lib/metrics/sanityBand";
```

**3a — smart yield slider control field (line 228):** replace
```typescript
      { kind: "slider", key: "minYield", label: "Target Gross Yield", short: "Yield", op: "≥", min: 0, max: 12, step: 0.5, format: fmtPct, field: "ExtrapolatedCapRate" },
```
with
```typescript
      { kind: "slider", key: "minYield", label: "Target Gross Yield", short: "Yield", op: "≥", min: 0, max: 12, step: 0.5, format: fmtPct, field: "cap_rate_est" },
```

**3b — smart filter (line 236):** replace
```typescript
        f.minYield > 0 ? `ExtrapolatedCapRate:>=${f.minYield}` : "",
```
with
```typescript
        f.minYield > 0 ? `cap_rate_est:>=${Math.max(f.minYield, 1)} && cap_rate_est:<=15` : "",
```

**3c — smart mapColor (line 250):** replace
```typescript
    mapColor: { metric: (d) => d.targetGrossYield ?? 0, domain: [0, 0.08], range: GREEN_RANGE, legendLow: "Low Yield", legendHigh: "High Yield" },
```
with
```typescript
    mapColor: { metric: (d) => grossYieldOrNull(d.gross_yield_est) ?? 0, domain: [2, 8], range: GREEN_RANGE, legendLow: "Low Yield", legendHigh: "High Yield" },
```

**3d — cashflow control field (line 260):** replace
```typescript
      { kind: "slider", key: "minCapRate", label: "Min Cap Rate", short: "Cap Rate", op: "≥", min: 0, max: 12, step: 0.5, format: fmtPct, field: "ExtrapolatedCapRate" },
```
with
```typescript
      { kind: "slider", key: "minCapRate", label: "Min Cap Rate", short: "Cap Rate", op: "≥", min: 0, max: 12, step: 0.5, format: fmtPct, field: "cap_rate_est" },
```

**3e — cashflow filter (line 267):** replace
```typescript
        f.minCapRate > 0 ? `ExtrapolatedCapRate:>=${f.minCapRate}` : "",
```
with
```typescript
        f.minCapRate > 0 ? `cap_rate_est:>=${Math.max(f.minCapRate, 1)} && cap_rate_est:<=15` : "",
```

**3f — cashflow sortBy (line 272):** replace
```typescript
    sortBy: "ExtrapolatedCapRate",
```
with
```typescript
    sortBy: "cap_rate_est",
```

**3g — cashflow mapColor (line 280):** replace
```typescript
    mapColor: { metric: (d) => d.ExtrapolatedCapRate ?? 0, domain: [0, 10], range: GREEN_RANGE, legendLow: "Low Cap", legendHigh: "High Cap" },
```
with
```typescript
    mapColor: { metric: (d) => capRateOrNull(d.cap_rate_est) ?? 0, domain: [0, 10], range: GREEN_RANGE, legendLow: "Low Cap", legendHigh: "High Cap" },
```

**3h — fix the stale header + slider comments.** Replace the two stale bullets in the header block (lines 13-19):
```typescript
 * - gross_yield_est / cap_rate_floor / net_monthly_cashflow are filterable but
 *   all 0 in the data — do NOT filter on them.
 * - Filterable + populated: ExtrapolatedCapRate, CapitalBurnRateMonthly,
 *   MonthlyCarryCost, TrueDom, SuiteStatus, multi_unit_status, is_density_ready,
 *   surplus_parking_count, LotWidth, LotSqftTotal, IsStale, TotalPriceDrop.
 * - targetGrossYield is a FRACTION (0.034 = 3.4%); ExtrapolatedCapRate is a
 *   PERCENT (4.64 = 4.64%).
```
with:
```typescript
 * - cap_rate_est / gross_yield_est ARE populated (~47% of for-sale) + indexed +
 *   filterable + sortable — they back the cashflow/smart cap & yield controls.
 *   Sparse by design (rent index suppresses cohorts < N=5); guard every read with
 *   the sanity band (src/lib/metrics/sanityBand.ts). cap_rate_est / gross_yield_est
 *   are PERCENT. The old fake ExtrapolatedCapRate is retired from the UI (spec §9).
 * - Filterable + populated: cap_rate_est, gross_yield_est, CapitalBurnRateMonthly,
 *   MonthlyCarryCost, TrueDom, SuiteStatus, multi_unit_status, is_density_ready,
 *   surplus_parking_count, LotWidth, LotSqftTotal, IsStale, TotalPriceDrop.
```
Then replace the smart-control comment (lines 225-227):
```typescript
      // Histogram field = the field the filter actually uses (ExtrapolatedCapRate,
      // fully populated); gross_yield_est is empty in the live index. (The "Yield"
      // label is a pre-existing misnomer — this control thresholds cap rate.)
```
with:
```typescript
      // This control thresholds cap_rate_est (real, indexed). The "Yield" label is
      // a legacy misnomer — kept to avoid churning the chip UI; it filters cap rate.
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/lib/personas/personaConfig.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + lint**

Run: `npx tsc --noEmit && npx eslint src/lib/personas/personaConfig.ts`
Expected: no errors.

---

## Task 5: Map metric — Cap Rate → cap_rate_est (TDD)

**Files:**
- Modify: `src/lib/personas/mapMetrics.ts:7-10, 53-56`
- Test: `src/lib/personas/mapMetrics.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/personas/mapMetrics.test.ts
import { describe, it, expect } from "vitest";
import { getMapMetric, bandFilterClause } from "./mapMetrics";

describe("Cap Rate map metric", () => {
  it("is backed by the real indexed field", () => {
    const m = getMapMetric("capRate")!;
    expect(m.field).toBe("cap_rate_est");
  });
  it("band-guards the metric accessor", () => {
    const m = getMapMetric("capRate")!;
    expect(m.metric({ cap_rate_est: 7 } as never)).toBe(7);
    expect(m.metric({ cap_rate_est: 99 } as never)).toBe(0); // out-of-band → 0 (excluded by v>0)
  });
  it("band-filters the legend clause on the real field", () => {
    const m = getMapMetric("capRate")!;
    expect(bandFilterClause(m, 0)).toContain("cap_rate_est");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/personas/mapMetrics.test.ts`
Expected: FAIL (`field` is `ExtrapolatedCapRate`).

- [ ] **Step 3: Edit `mapMetrics.ts`**

Add import after line 19 (the `} from "./personaConfig";` block):
```typescript
import { capRateOrNull } from "@/lib/metrics/sanityBand";
```

Replace the Cap Rate entry (lines 52-63):
```typescript
  {
    id: "capRate",
    label: "Cap Rate",
    field: "ExtrapolatedCapRate",
    metric: (d: ListingDocument) => d.ExtrapolatedCapRate ?? 0,
    domain: [0, 10],
    range: GREEN_RANGE,
    legendLow: "Low",
    legendHigh: "High",
    format: pct,
    bands: 6,
  },
```
with:
```typescript
  {
    id: "capRate",
    label: "Cap Rate",
    field: "cap_rate_est",
    // Band-guarded; out-of-band → 0 so the heat/pin consumers' `v > 0` filter drops it.
    metric: (d: ListingDocument) => capRateOrNull(d.cap_rate_est) ?? 0,
    domain: [0, 10],
    range: GREEN_RANGE,
    legendLow: "Low",
    legendHigh: "High",
    format: pct,
    bands: 6,
  },
```

Update the header comment (lines 7-9) — replace `ExtrapolatedCapRate,` in the populated-fields list with `cap_rate_est,`.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/lib/personas/mapMetrics.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + lint**

Run: `npx tsc --noEmit && npx eslint src/lib/personas/mapMetrics.ts`
Expected: no errors.

---

## Task 6: Histogram fields (TDD) — then commit 3

**Files:**
- Modify: `src/lib/filters/histogram.ts:41-57`
- Modify/Create test: `src/lib/filters/histogram.test.ts`

- [ ] **Step 1: Add the failing assertion**

Append to (or create) `src/lib/filters/histogram.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { supportsHistogram } from "./histogram";

describe("histogram supports the real cap/yield fields", () => {
  it("includes cap_rate_est and gross_yield_est", () => {
    expect(supportsHistogram("cap_rate_est")).toBe(true);
    expect(supportsHistogram("gross_yield_est")).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/filters/histogram.test.ts`
Expected: FAIL (`cap_rate_est` excluded by the stale comment block).

- [ ] **Step 3: Edit `HISTOGRAM_FIELDS` (lines 50-56)**

Replace:
```typescript
  "ExtrapolatedCapRate",
  "CapitalBurnRateMonthly",
  "MonthlyCarryCost",
  "TrueDom",
  "TotalPriceDrop",
  // NB: gross_yield_est / cap_rate_est are EMPTY in the live index — intentionally
  // excluded so no slider fires 20 all-zero count queries. Use ExtrapolatedCapRate.
]);
```
with:
```typescript
  "ExtrapolatedCapRate", // legacy — retired from UI controls (spec §9); kept indexed until reindex
  "cap_rate_est",
  "gross_yield_est",
  "CapitalBurnRateMonthly",
  "MonthlyCarryCost",
  "TrueDom",
  "TotalPriceDrop",
]);
```

- [ ] **Step 4: Run to verify pass + full pure-logic suite**

Run: `npx vitest run src/lib/filters/histogram.test.ts src/lib/metrics src/lib/personas src/components/CommandCenter/columnSort.test.ts src/lib/dealScore/fromListingDocument.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + lint + commit (commit 3 = Tasks 3–6)**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

```bash
git add src/components/CommandCenter/columnSort.ts src/components/CommandCenter/columnSort.test.ts \
  src/components/CommandCenter/LedgerRow.tsx \
  src/lib/personas/personaConfig.ts src/lib/personas/personaConfig.test.ts \
  src/lib/personas/mapMetrics.ts src/lib/personas/mapMetrics.test.ts \
  src/lib/filters/histogram.ts src/lib/filters/histogram.test.ts
git commit -m "feat(terminal): repoint ledger/map/histogram/persona to real cap+yield

Drops the yield-cell *100 unit bug (gross_yield_est is already a percent).
No persona-default flip (that is its own commit)."
```

---

## Task 7: Compare grid — Value-Add Cap Rate (TDD)

**Files:**
- Modify: `src/lib/compare/compareMetricsConfig.ts:13-14 (import), 154-156`
- Test: `src/lib/compare/compareMetricsConfig.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/compare/compareMetricsConfig.test.ts
import { describe, it, expect } from "vitest";
import { COMPARE_METRICS } from "./compareMetricsConfig";
import type { ListingDocument } from "@/lib/typesense/client";

const ctx = (listing: Partial<ListingDocument>) =>
  ({ listing: listing as ListingDocument, isAuthed: true });

describe("compare Value-Add Cap Rate", () => {
  const m = COMPARE_METRICS.find((x) => x.key === "capRateVA")!;
  it("reads the real cap_rate_est, band-guarded", () => {
    expect(m.get!(ctx({ cap_rate_est: 7 }) as never)).toBe(7);
    expect(m.get!(ctx({ cap_rate_est: 99 }) as never)).toBeNull();
  });
  it("ignores the fake ExtrapolatedCapRate", () => {
    expect(m.get!(ctx({ ExtrapolatedCapRate: 8 } as Partial<ListingDocument>) as never)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/compare/compareMetricsConfig.test.ts`
Expected: FAIL (reads `ExtrapolatedCapRate`).

- [ ] **Step 3: Edit `compareMetricsConfig.ts`**

Add import after line 15 (`import { rowIsIdentical } from "./diff";`):
```typescript
import { capRateOrNull } from "@/lib/metrics/sanityBand";
```

Replace the `capRateVA` metric (lines 154-156):
```typescript
  { key: "capRateVA", label: "Value-Add Cap Rate", group: "cashflowCarry", cellKind: "numeric",
    get: (c) => c.listing.ExtrapolatedCapRate ?? null, format: fmtPct1, winner: "high",
    tag: () => "BRRRR" },
```
with:
```typescript
  { key: "capRateVA", label: "Est. Cap Rate", group: "cashflowCarry", cellKind: "numeric",
    get: (c) => capRateOrNull(c.listing.cap_rate_est), format: fmtPct1, winner: "high",
    tag: () => "est" },
```
(Label/tag updated: it now shows the real estimated cap rate, not a BRRRR value-add figure. The live-underwrite `capRateUw` row is untouched.)

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/lib/compare/compareMetricsConfig.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + lint**

Run: `npx tsc --noEmit && npx eslint src/lib/compare/compareMetricsConfig.ts`
Expected: no errors.

---

## Task 8: Dashboard — boards (TDD) + queries + heat tile

**Files:**
- Modify: `src/lib/dashboard/boards.ts:38, 51-61`
- Test: `src/lib/dashboard/boards.test.ts`
- Modify: `src/lib/dashboard/queries.ts:63-68, 78, 127`
- Modify: `src/components/dashboard/DashboardHeatTile.tsx:34`

- [ ] **Step 1: Write the failing test for the board**

```typescript
// src/lib/dashboard/boards.test.ts
import { describe, it, expect } from "vitest";
import { BOARDS } from "./boards";

describe("cap_rate board uses the real field", () => {
  it("sorts/filters/labels off cap_rate_est, not ExtrapolatedCapRate", () => {
    const b = BOARDS.cap_rate;
    expect(b.sortBy).toBe("cap_rate_est");
    expect(b.metricField).toBe("cap_rate_est");
    expect(b.rawFilterBy).toContain("cap_rate_est");
    expect(b.rawFilterBy).not.toContain("ExtrapolatedCapRate");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/dashboard/boards.test.ts`
Expected: FAIL.

- [ ] **Step 3: Edit `boards.ts`** — replace the `cap_rate` board (lines 51-61):
```typescript
  cap_rate: {
    id: 'cap_rate',
    title: 'Highest Cap Rate',
    metricField: 'ExtrapolatedCapRate',
    metricLabel: 'CAP',
    formatMetric: pct,
    sortBy: 'ExtrapolatedCapRate',
    sortOrder: 'desc',
    rawFilterBy: 'ExtrapolatedCapRate:>0',
    objectives: ['Analyze rental yield / cap rates'],
  },
```
with:
```typescript
  cap_rate: {
    id: 'cap_rate',
    title: 'Highest Cap Rate',
    metricField: 'cap_rate_est',
    metricLabel: 'CAP',
    formatMetric: pct,
    sortBy: 'cap_rate_est',
    sortOrder: 'desc',
    rawFilterBy: 'cap_rate_est:>=1 && cap_rate_est:<=15',
    objectives: ['Analyze rental yield / cap rates'],
  },
```
Update the comment on line 38 (`// ExtrapolatedCapRate is stored as a percentage...`) to `// cap_rate_est is stored as a percentage (7.1 → "7.1%").`

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/lib/dashboard/boards.test.ts`
Expected: PASS.

- [ ] **Step 5: Edit `queries.ts` (Typesense IO — verified by tsc + grep)**

In `fetchRegionStats` (lines 63-69) replace the cap search block:
```typescript
    searchListings({
      query: '*',
      rawFilterBy: combine(scope, 'ExtrapolatedCapRate:>0'),
      sortBy: 'ExtrapolatedCapRate',
      sortOrder: 'desc',
      perPage: 1,
    }),
```
with:
```typescript
    searchListings({
      query: '*',
      rawFilterBy: combine(scope, 'cap_rate_est:>=1 && cap_rate_est:<=15'),
      sortBy: 'cap_rate_est',
      sortOrder: 'desc',
      perPage: 1,
    }),
```
Replace the read (line 78):
```typescript
    topCapRate: cap.listings[0]?.ExtrapolatedCapRate ?? null,
```
with:
```typescript
    topCapRate: cap.listings[0]?.cap_rate_est ?? null,
```
In `fetchRegionSpecialty` (line 127) replace:
```typescript
    countMatching(combine(scope, `ExtrapolatedCapRate:>=${CASHFLOW_CAP_FLOOR}`)),
```
with:
```typescript
    countMatching(combine(scope, `cap_rate_est:>=${CASHFLOW_CAP_FLOOR} && cap_rate_est:<=15`)),
```
(`CASHFLOW_CAP_FLOOR = 4.5` is inside the band — no change needed there. Update the line 104 doc-comment `ExtrapolatedCapRate` → `cap_rate_est`.)

- [ ] **Step 6: Edit `DashboardHeatTile.tsx` (line 34)** — replace:
```typescript
  { id: "cap", label: "Cap Rate", get: (d) => d.ExtrapolatedCapRate },
```
with:
```typescript
  { id: "cap", label: "Cap Rate", get: (d) => capRateOrNull(d.cap_rate_est) ?? undefined },
```
Add import after line 24 (`import { ALPHA_GLOW_RANGE } ...`):
```typescript
import { capRateOrNull } from "@/lib/metrics/sanityBand";
```
(The existing `v != null && v > 0` guard at the points memo already excludes the `undefined`.)

- [ ] **Step 7: Typecheck + lint**

Run: `npx tsc --noEmit && npx eslint src/lib/dashboard/queries.ts src/lib/dashboard/boards.ts src/components/dashboard/DashboardHeatTile.tsx`
Expected: no errors.

---

## Task 9: Bubble stats median (Typesense IO — verify)

**Files:**
- Modify: `src/lib/bubbles/stats.ts:168, 190-191, 210-215`

- [ ] **Step 1: Repoint the sampled field**

Replace `include_fields` (line 168):
```typescript
      include_fields: "ListPrice,ExtrapolatedCapRate",
```
with:
```typescript
      include_fields: "ListPrice,cap_rate_est",
```
Replace the ascDocs typing (lines 189-191):
```typescript
  const ascDocs = (ascRes.hits ?? []).map(
    (h) => h.document as { ListPrice?: number; ExtrapolatedCapRate?: number }
  );
```
with:
```typescript
  const ascDocs = (ascRes.hits ?? []).map(
    (h) => h.document as { ListPrice?: number; cap_rate_est?: number }
  );
```
Replace the cap-rate extraction (lines 213-215) with a band-guarded version:
```typescript
  const capRates = ascDocs
    .map((d) => Number(d.cap_rate_est))
    .filter((n) => Number.isFinite(n) && n >= 1 && n <= 15);
```
Update the comment at lines 210-212 to reference `cap_rate_est` (now sortable, but the sample-median approach stays). `capRateSample: capRates.length` already IS the §7 n-qualifier for this surface — leave it.

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit && npx eslint src/lib/bubbles/stats.ts`
Expected: no errors.

---

## Task 10: Watchlist rollup (verify) — then commit 4

**Files:**
- Modify: `src/lib/watchlist/useWatchlistSnapshot.ts:45-54 (type), 157-160, 179-188`

- [ ] **Step 1: Repoint `avgCapRate` + add the `capN` qualifier (§7)**

Add import after line 23 (`import { dealScoreFromDocument } ...`):
```typescript
import { capRateOrNull } from "@/lib/metrics/sanityBand";
```
Replace the cap accumulation (lines 157-161):
```typescript
      const cap = c.current?.ExtrapolatedCapRate;
      if (cap != null && cap > 0) {
        capSum += cap;
        capN += 1;
      }
```
with:
```typescript
      const cap = capRateOrNull(c.current?.cap_rate_est);
      if (cap != null) {
        capSum += cap;
        capN += 1;
      }
```
Add `avgCapRateSample` to the `WatchlistRollup` interface (after `avgCapRate` on line 49):
```typescript
  avgCapRate: number | null; // yield quality of what you tend to save
  avgCapRateSample: number; // n listings with a real cap estimate (§7 honesty)
```
And in the returned rollup object (after `avgCapRate: capN ? capSum / capN : null,` ~line 183) add:
```typescript
      avgCapRate: capN ? capSum / capN : null,
      avgCapRateSample: capN,
```

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit && npx eslint src/lib/watchlist/useWatchlistSnapshot.ts`
Expected: no errors. (If a consumer destructures `WatchlistRollup` exhaustively, `tsc` will flag it — add the field there too. Grep `avgCapRate` to find consumers.)

- [ ] **Step 3: Commit (commit 4 = Tasks 7–10)**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: pass.

```bash
git add src/lib/compare/compareMetricsConfig.ts src/lib/compare/compareMetricsConfig.test.ts \
  src/lib/dashboard/boards.ts src/lib/dashboard/boards.test.ts src/lib/dashboard/queries.ts \
  src/components/dashboard/DashboardHeatTile.tsx \
  src/lib/bubbles/stats.ts src/lib/watchlist/useWatchlistSnapshot.ts
git commit -m "feat(dashboard,compare,watchlist): repoint cap rate to cap_rate_est + band + n-qualifier"
```

---

## Task 11: Listing detail page — real cap via Typesense lookup, drop fake engine (§6.1) — commit 5

**Files:**
- Modify: `src/lib/property/getListingDetail.ts:27 (drop import), 13-14 (add imports), 349, 358`

**Context:** `getListingDetail` reads the Supabase `listings.full_payload`, which does NOT carry the derived `cap_rate_est` (the transformer writes it only to the Typesense payload). Fetch the real cap from Typesense by id, band-validate it, feed the deal score, and remove the fake `calculateProForma` call entirely.

- [ ] **Step 1: Add imports** — after line 13 (`import { getServiceRoleClient } ...`):
```typescript
import { searchListings } from "@/lib/typesense/client";
import { capRateOrNull } from "@/lib/metrics/sanityBand";
```

- [ ] **Step 2: Remove the fake-engine import (line 27):**
```typescript
import { calculateProForma } from "@/lib/typesense/ExtrapolatedCapRateEngine";
```
Delete that line.

- [ ] **Step 3: Replace the proForma computation + deal-score input (lines 349-359).** Replace:
```typescript
    const proForma = calculateProForma(listPrice, { listPrice: listPrice ?? 0, taxAnnualAmount, associationFee });

    const dealScore = computeDealScore({
      listPrice,
      originalListPrice,
      avmEstimate: estimate
        ? { estimatedValue: estimate.estimatedValue, confidence: estimate.confidence }
        : null,
      domDays: deriveDomDays(payload),
      capRatePct: proForma.extrapolated_cap_rate > 0 ? proForma.extrapolated_cap_rate : null,
    });
```
with:
```typescript
    // Real cap rate lives on the Typesense doc (full_payload doesn't carry the
    // derived metric). One id-lookup against the search index — NOT a Supabase
    // scan, so it stays §12 Disk-IO-clean. Best-effort: null on miss/timeout.
    let realCapRate: number | null = null;
    try {
      const capRes = await withTimeout(
        searchListings({ query: "*", rawFilterBy: `id:=\`${listingKey}\``, perPage: 1 }),
        4000,
        "CapRate"
      );
      realCapRate = capRateOrNull(capRes.listings[0]?.cap_rate_est);
    } catch (capErr) {
      console.error(`[getListingDetail] cap_rate lookup failed for ${listingKey}:`, capErr);
    }

    const dealScore = computeDealScore({
      listPrice,
      originalListPrice,
      avmEstimate: estimate
        ? { estimatedValue: estimate.estimatedValue, confidence: estimate.confidence }
        : null,
      domDays: deriveDomDays(payload),
      capRatePct: realCapRate,
    });
```

- [ ] **Step 4: Remove now-dead locals if `tsc` flags them.** `taxAnnualAmount` / `associationFee` (lines 345-348) were only consumed by `calculateProForma`. Run `tsc`; if it reports them unused (or eslint `no-unused-vars`), delete those two `const` declarations. If they're used elsewhere, leave them.

Run: `npx tsc --noEmit`
Expected: no errors (delete unused locals as flagged, then re-run to green).

- [ ] **Step 5: Grep-verify the fake engine is gone from this path**

Run: `npx eslint src/lib/property/getListingDetail.ts` and `grep -n "calculateProForma\|ExtrapolatedCapRate" src/lib/property/getListingDetail.ts`
Expected: eslint clean; grep returns nothing.

- [ ] **Step 6: Commit (commit 5)**

```bash
git add src/lib/property/getListingDetail.ts
git commit -m "feat(listing): de-fake detail-page deal score — real cap via Typesense lookup, drop fake engine"
```

---

## Task 12: Default persona flip smart→flippers (§8 — audit-gated, isolated) — commit 6

**Files:**
- Audit (read-only): `src/components/CommandCenter/ListingTerminal.tsx`, `src/lib/personas/personaConfig.ts` (flippers columns + mapColor)
- Modify: `src/lib/stores/commandCenterStore.ts` (the `activePersona` default)
- Test: extend `src/lib/personas/personaConfig.test.ts` (or a store test)

- [ ] **Step 1: Run the §8 anon-field audit (BLOCKING GATE — do this before editing).**

The `flippers` persona's ledger columns are `address, trueDom, priceDrop, carryCost, alphaFlag` and its `mapColor.metric` is `TrueDom` (`personaConfig.ts:304-311`). Per strategy item G, **row-level True DOM is VOW-gated**. `VOW_ENFORCE_TERMS` is OFF.

Read `ListingTerminal.tsx` and determine, for an **anonymous** user, whether the Flipper ledger + map actually RENDER `TrueDom` (and Capital Burn) values, or whether an `isAuthed` gate blanks them.

Record the finding explicitly:
- **If anon already sees row-level True DOM under the CURRENT `smart` default** (smart's columns also include `trueDom`): the flip does not NEWLY expose it → **proceed with the flip**, and file the pre-existing exposure as a separate compliance ticket (out of scope here, per spec §8). 
- **If the flip would newly surface a gated VOW field to anon** (e.g. via the map color) that smart did not: **STOP** — either add a field-level anon lock first, or move the flip to Plan 4. Do not ship the flip in that case; report back.

Document the decision in the commit body.

- [ ] **Step 2: Write the failing test** (only if Step 1 cleared the flip)

Append to `src/lib/personas/personaConfig.test.ts`:
```typescript
import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";

describe("default persona", () => {
  it("defaults to the Flipper beachhead", () => {
    expect(useCommandCenterStore.getState().activePersona).toBe("flippers");
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run src/lib/personas/personaConfig.test.ts`
Expected: FAIL — currently `"smart"`.

- [ ] **Step 4: Edit `commandCenterStore.ts`** — replace:
```typescript
  activePersona: "smart",
```
with:
```typescript
  activePersona: "flippers",
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run src/lib/personas/personaConfig.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck + lint + commit (commit 6 — isolated, revertable)**

Run: `npx tsc --noEmit && npm run lint`

```bash
git add src/lib/stores/commandCenterStore.ts src/lib/personas/personaConfig.test.ts
git commit -m "feat(terminal): default persona smart->flippers (Flipper beachhead)

§8 anon-field audit: <record the finding from Step 1 here>."
```

---

## Task 13: Retirement gate + final verification — commit 7

**Files:** none (verification) + any stale-comment cleanup surfaced by the grep.

- [ ] **Step 1: Grep gate — zero functional reads of the fake field**

Run: `grep -rn "ExtrapolatedCapRate" src/`
Expected: ONLY these remain (all non-functional):
- `src/lib/typesense/client.ts:141` — the `ExtrapolatedCapRate?` type declaration.
- `src/lib/typesense/ExtrapolatedCapRateEngine.ts` + `…Engine.test.ts` — the engine itself (deferred removal, spec §9).
- `src/lib/typesense/typesenseSchema.ts` — the indexed field def (stays until reindex).
- `src/lib/filters/histogram.ts` — the one legacy entry we intentionally kept (commented).
- Comments referencing the retirement.

If any **functional read** (`d.ExtrapolatedCapRate`, `:>=`, `sortBy: 'ExtrapolatedCapRate'`) remains in an app surface, repoint it (it was missed) before proceeding.

- [ ] **Step 2: Full verification suite**

Run: `npx tsc --noEmit && npm run lint && npm test && npm run build`
Expected: all green.

- [ ] **Step 3: Post-state field sanity (optional, env-gated)**

Run: `node scripts/admin/_verifyYield.cjs`
Expected: same non-zero `cap_rate_est` counts as Task 0 (we changed readers, not data).

- [ ] **Step 4: Commit any cleanup**

```bash
git add -A
git commit -m "chore(terminal): retire ExtrapolatedCapRate from UI reads + grep-gate green"
```

(If Step 1/2 surfaced nothing to change, skip this commit.)

---

## Self-Review (run after writing — fill before execution)

**Spec coverage:** §4 band → Task 1; §4.1 field-not-row → Tasks 3/5 (band guards, no global filter); §4.2 cashflow → `hasRentEstimate` shipped in Task 1 (forward-rule, no live target); §5 deal-score → Tasks 2 + 11; §6 inventory rows 1-18 → Tasks 3-10; §6.1 listing page → Task 11; §7 aggregate honesty → bubbles `capRateSample` (existing) + watchlist `avgCapRateSample` (Task 10); §8 persona flip → Task 12 (audit-gated); §9 retirement → Task 13.

**Placeholder scan:** the only deliberate fill-in is Task 12 Step 1's audit finding (recorded in the commit body) — it is a real gate, not a TODO.

**Type consistency:** `capRateOrNull` / `grossYieldOrNull` / `hasRentEstimate` signatures are identical at every call site (Tasks 2,3,4,5,7,8,10,11). `cap_rate_est` / `gross_yield_est` are the exact `ListingDocument` field names (typesenseSchema doc type). `sortBy: "cap_rate_est"` matches the schema's `sort: true` field.

**No reindex / out of scope:** confirmed — no migration, no transformer change, no `region-stats`, no orphan-stack wiring (spec §14).

---

## Execution Handoff

After the plan is approved:

1. **Subagent-Driven (recommended)** — one fresh subagent per task, review between tasks.
2. **Inline Execution** — execute in this session with checkpoints.

**Pre-flight before any code:** run Task 0 (`npm install` + baseline `tsc`/`lint`/`test`) — deferred from worktree creation.
