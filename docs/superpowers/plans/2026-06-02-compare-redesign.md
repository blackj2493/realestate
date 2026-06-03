# Compare Properties Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `/properties/compare` from a flat metric table into a best-in-class, interactive head-to-head: scroll-through media per property, per-row winner highlighting, grouped collapsible metric sections with a persona "lens", a shared "your assumptions" bar that re-underwrites every column live, and a diff toggle + real mobile layout.

**Architecture:** Keep the instant Typesense-only data path (`getCompareData`) and the server-side VOW gating untouched. Add a config-driven metrics model (`compareMetricsConfig`) consumed by both a desktop table and a mobile card stack via one pure `resolveRow()` seam (winner + diff + format). The "your assumptions" bar reuses the existing deterministic `computeUnderwriting` engine (the same one behind the listing page's Underwriting Sandbox) so carry / cap rate / cashflow recompute across all columns from one set of global inputs — no new math, no LLM (CLAUDE.md §4). Media reuses the existing `MediaGalleryOverlay`; the full image array is already in the Typesense doc as the unindexed `RawImages` cargo field, so no extra fetch and no RAM cost.

**Tech Stack:** Next.js (App Router) · React client components · TypeScript · Tailwind (existing slate/emerald/cyan terminal palette) · Vitest (node env — pure-logic tests only; UI verified via typecheck/lint/build) · existing `@/components/ui` primitives (`Slider`, `Input`, `Label`).

---

## Constraints & Invariants (read before any task)

- **Compliance — VOW gating is the #1 invariant.** The server (`compare/page.tsx:42-45`) already drops `estimates` and strips `TrueDom` for anonymous users. Never send AVM/VOW-derived numbers to anon. The config's `gated` flag is the client backstop (renders `LockedCell`). Gated rows: **Deal Score, Est. Value, vs Estimate, Stale**. NOT gated (pure list-price + user-input math, allowed for everyone per `computeUnderwriting.ts:14-15`): **Cap Rate (your assumptions), Monthly Cashflow, Monthly Carry**.
- **Brokerage (`ListOfficeName`) must always display** (TRREB §4) — never gated, never hidden by the diff toggle (`alwaysShow: true`).
- **Deterministic only** — every derived number comes from `computeUnderwriting` or pure helpers. No listing text through any LLM.
- **Reuse, don't reinvent:** `computeUnderwriting`, `seedAssumptions`, `seedMonthlyRent`, `UW_DEFAULTS` (`@/lib/underwriting/computeUnderwriting`); `MediaGalleryOverlay` (`@/components/Property/MediaGalleryOverlay`); `ListingThumbnail` (`@/components/listing/ListingThumbnail`); `dealScoreFromDocument` + `DealScoreBadge`; `PersonaType`/`PERSONA_LIST` (`@/lib/personas/personaConfig`); `cn`/`formatPrice` (`@/lib/utils`); `Slider`/`Input`/`Label` (`@/components/ui/*`).
- **Branch & commits:** all work on a NEW branch `feat/compare-redesign` cut from `main`. One commit per phase, concern-separated. End every commit message with the trailer:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- **Tests:** Vitest is configured for the **node** environment (no jsdom). Write tests for **pure logic only** (`winner`, `diff`, `resolveRow`). Do NOT add React render tests. Verify UI with `npm run typecheck` (or `tsc --noEmit`), `npm run lint`, `npm run build`, and manual check.
- **Persona lens** maps 1:1 to the existing `PersonaType` (`"smart" | "cashflow" | "flippers" | "builders"`). **Default lens = `"smart"`** (Smart Home Buyer).

---

## File Structure

### Create
| Path | Responsibility |
|------|----------------|
| `src/lib/compare/winner.ts` | Pure: `winnerIndices(values, dir)`, `bestValue(values, dir)`. |
| `src/lib/compare/winner.test.ts` | Vitest unit tests for winner helpers. |
| `src/lib/compare/diff.ts` | Pure: `rowIsIdentical(displayed)`. |
| `src/lib/compare/diff.test.ts` | Vitest unit tests for diff. |
| `src/lib/compare/compareMetricsConfig.ts` | `CompareMetric[]` config, group order/labels, lens ordering, and the pure `resolveRow()` seam. |
| `src/lib/compare/compareMetricsConfig.test.ts` | Vitest tests for `resolveRow` (gating, winner, formatting, tags). |
| `src/lib/compare/useCompareAssumptions.ts` | Client hook: global DP%/rate + per-property rent → `resultById: Record<id, UnderwritingResult>`. |
| `src/components/compare/LockedCell.tsx` | Shared locked (blurred + lock icon) cell, extracted from CompareClient. |
| `src/components/compare/CompareMediaCell.tsx` | Per-property media: thumbnail + count badge + inline prev/next → opens `MediaGalleryOverlay`. |
| `src/components/compare/RentInput.tsx` | Small editable per-property monthly-rent field (seeds from the engine; drives live cap rate / cashflow). |
| `src/components/compare/LensSelector.tsx` | Persona-lens segmented control. |
| `src/components/compare/AssumptionsBar.tsx` | Sticky bar: DP% + rate sliders, lens selector, diff toggle. |
| `src/components/compare/MetricRow.tsx` | One desktop `<tr>`: resolves a metric across columns, renders winner highlight + delta + tag + cellKind visual. |
| `src/components/compare/MetricGroup.tsx` | Collapsible desktop `<tbody>` group; applies diff hiding; "All identical" line. |
| `src/components/compare/CompareMobile.tsx` | Mobile per-property card stack reusing config + `resolveRow`. |

### Modify
| Path | Change |
|------|--------|
| `src/lib/typesense/client.ts:125` | Add `RawImages?: string[];` to `ListingDocument` (next to `primaryImageUrl`). |
| `src/app/(app)/properties/compare/CompareClient.tsx` | Replace the monolithic table with the config-driven desktop groups + `AssumptionsBar` + `CompareMediaCell` header + `CompareMobile`. Preserve `Header`, anon banner, empty state, disclaimer, gating. |

### Verify-only (expect no code change)
- `src/app/(app)/properties/compare/page.tsx` — gating already correct; confirm the invariant holds.
- `src/lib/property/getCompareData.ts` — already returns the full doc (incl. `RawImages`) + estimates.

---

## Phase 0 — Branch + plumbing

### Task 0: Branch and surface `RawImages`

**Files:**
- Modify: `src/lib/typesense/client.ts:125`

- [ ] **Step 1: Cut the feature branch**

```bash
git checkout main
git pull --ff-only
git checkout -b feat/compare-redesign
```

- [ ] **Step 2: Add `RawImages` to the listing type**

In `src/lib/typesense/client.ts`, immediately after line 125 (`primaryImageUrl?: string;`) add:

```ts
  // Full deduped photo URL array (unindexed Typesense cargo `RawImages`) — used by
  // the Compare media cell to scroll all photos with no extra fetch. May be empty.
  RawImages?: string[];
```

(`searchListings` returns the whole document — `client.ts:480` maps `hit.document` with no `include_fields` — so no projection change is needed.)

- [ ] **Step 3: Verify the build is green and compare still renders**

Run: `npm run typecheck && npm run build`
Expected: PASS. Visit `/properties/compare?ids=<two real ids>` — unchanged single-thumbnail table still works.

- [ ] **Step 4: Commit**

```bash
git add src/lib/typesense/client.ts
git commit -m "feat(compare): surface RawImages on ListingDocument for media scroll

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Phase 1 — Pure helpers (TDD)

### Task 1: `winner.ts`

**Files:**
- Create: `src/lib/compare/winner.ts`
- Test: `src/lib/compare/winner.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { winnerIndices, bestValue } from "./winner";

describe("winnerIndices", () => {
  it("returns empty for direction null", () => {
    expect(winnerIndices([1, 2, 3], null).size).toBe(0);
  });
  it("returns empty when fewer than 2 columns have a value", () => {
    expect(winnerIndices([5, null, null], "high").size).toBe(0);
  });
  it("picks the max index for 'high'", () => {
    expect([...winnerIndices([1, 9, 4], "high")]).toEqual([1]);
  });
  it("picks the min index for 'low'", () => {
    expect([...winnerIndices([7, 3, 5], "low")]).toEqual([1]);
  });
  it("returns all tied winners", () => {
    expect([...winnerIndices([4, 4, 1], "high")].sort()).toEqual([0, 1]);
  });
  it("ignores null / undefined / NaN / Infinity", () => {
    expect([...winnerIndices([null, 2, NaN, Infinity, 8], "high")]).toEqual([4]);
  });
});

describe("bestValue", () => {
  it("is null when direction is null or <2 values", () => {
    expect(bestValue([1, 2], null)).toBeNull();
    expect(bestValue([1, null], "low")).toBeNull();
  });
  it("returns the winning magnitude", () => {
    expect(bestValue([10, 4, 7], "low")).toBe(4);
    expect(bestValue([10, 4, 7], "high")).toBe(10);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/compare/winner.test.ts`
Expected: FAIL — `Cannot find module './winner'`.

- [ ] **Step 3: Write the implementation**

```ts
/** Winner-highlighting helpers for the Compare grid. Pure + deterministic. */

export type WinnerDirection = "high" | "low" | null;

const finite = (v: number | null | undefined): v is number =>
  typeof v === "number" && Number.isFinite(v);

/**
 * Indices of the winning column(s). Empty unless ≥2 columns have a finite value,
 * so a winner is never crowned on missing/locked data. Ties return every winner.
 */
export function winnerIndices(
  values: (number | null | undefined)[],
  dir: WinnerDirection
): Set<number> {
  if (!dir) return new Set();
  const valid = values
    .map((v, i) => ({ v, i }))
    .filter((x): x is { v: number; i: number } => finite(x.v));
  if (valid.length < 2) return new Set();
  const best = dir === "high"
    ? Math.max(...valid.map((x) => x.v))
    : Math.min(...valid.map((x) => x.v));
  return new Set(valid.filter((x) => x.v === best).map((x) => x.i));
}

/** The winning numeric value (for magnitude/gap deltas), or null. */
export function bestValue(
  values: (number | null | undefined)[],
  dir: WinnerDirection
): number | null {
  if (!dir) return null;
  const valid = values.filter(finite);
  if (valid.length < 2) return null;
  return dir === "high" ? Math.max(...valid) : Math.min(...valid);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/compare/winner.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/compare/winner.ts src/lib/compare/winner.test.ts
git commit -m "feat(compare): pure winner-highlighting helpers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 2: `diff.ts`

**Files:**
- Create: `src/lib/compare/diff.ts`
- Test: `src/lib/compare/diff.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { rowIsIdentical } from "./diff";

describe("rowIsIdentical", () => {
  it("true when all present displayed values match", () => {
    expect(rowIsIdentical(["$3,200/mo", "$3,200/mo", "$3,200/mo"])).toBe(true);
  });
  it("false when any displayed value differs", () => {
    expect(rowIsIdentical(["Condo", "Condo", "Detached"])).toBe(false);
  });
  it("treats fewer than 2 present values as identical", () => {
    expect(rowIsIdentical(["Detached", null, null])).toBe(true);
    expect(rowIsIdentical([null, "", undefined])).toBe(true);
  });
  it("ignores null/empty when comparing", () => {
    expect(rowIsIdentical(["5", null, "5", ""])).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/compare/diff.test.ts`
Expected: FAIL — `Cannot find module './diff'`.

- [ ] **Step 3: Write the implementation**

```ts
/**
 * Diff-mode helper. A row is "identical" (hidden when "show only differences" is
 * on) when every present, DISPLAYED value is the same string — comparing rendered
 * strings so two values that both display "$3,200/mo" collapse even if raw cents
 * differ. Fewer than 2 present values → identical (nothing to compare).
 */
export function rowIsIdentical(displayed: (string | null | undefined)[]): boolean {
  const present = displayed.filter((s): s is string => s != null && s !== "");
  if (present.length < 2) return true;
  return present.every((s) => s === present[0]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/compare/diff.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/compare/diff.ts src/lib/compare/diff.test.ts
git commit -m "feat(compare): pure diff-mode row-identity helper

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Phase 2 — Metrics config + resolve seam

### Task 3: `compareMetricsConfig.ts` (config + `resolveRow`)

**Files:**
- Create: `src/lib/compare/compareMetricsConfig.ts`
- Test: `src/lib/compare/compareMetricsConfig.test.ts`

This is the single source of truth for every row, its group, formatting, winner direction, gating, persona ordering, and the pure `resolveRow()` seam that both desktop and mobile consume.

- [ ] **Step 1: Write the config + resolver**

```ts
/**
 * Config-driven Compare metrics. Each row declares its group, how to read a value
 * (from the listing, the cached AVM estimate, or the live underwrite), how to
 * format it, its winner direction, gating, and persona priority. `resolveRow`
 * turns a metric + the per-column contexts into displayed strings + winners + tags
 * — the one pure seam shared by the desktop table and the mobile card stack.
 */
import type { ListingDocument } from "@/lib/typesense/client";
import type { CompareEstimate } from "@/lib/property/getCompareData";
import type { UnderwritingResult } from "@/lib/underwriting/computeUnderwriting";
import type { PersonaType } from "@/lib/personas/personaConfig";
import { formatPrice } from "@/lib/utils";
import { dealScoreFromDocument } from "@/lib/dealScore/fromListingDocument";
import { winnerIndices, bestValue, type WinnerDirection } from "./winner";

export type CompareGroupId =
  | "valuationDeal"
  | "cashflowCarry"
  | "distressTiming"
  | "suiteDensity"
  | "structural";

/** Visual treatment; winner/diff logic is uniform regardless of kind. */
export type CellKind = "numeric" | "text" | "dealScore" | "estValue" | "discount";

export interface MetricContext {
  listing: ListingDocument;
  estimate?: CompareEstimate;
  underwriting?: UnderwritingResult;
  isAuthed: boolean;
}

export interface CompareMetric {
  key: string;
  label: string;
  group: CompareGroupId;
  cellKind: CellKind;
  /** Numeric value (drives winner + default formatting); null when absent. */
  get?: (ctx: MetricContext) => number | null;
  /** Text value (for cellKind "text"); mutually exclusive with get. */
  getText?: (ctx: MetricContext) => string | null;
  /** Numeric → display string. Defaults to String(v). */
  format?: (v: number) => string;
  winner?: WinnerDirection;
  /** Show each non-winning column's gap to the best (e.g. "+$80k"). */
  magnitude?: boolean;
  /** Gated rows render LockedCell for anonymous users. */
  gated?: boolean;
  /** Never hidden by the diff toggle (e.g. mandatory Brokerage display). */
  alwaysShow?: boolean;
  /** Small tag appended to each populated cell (e.g. "est"). */
  tag?: (ctx: MetricContext) => string | null;
}

// ── Group metadata ────────────────────────────────────────────────────────────
export const GROUP_ORDER: CompareGroupId[] = [
  "valuationDeal",
  "cashflowCarry",
  "distressTiming",
  "suiteDensity",
  "structural",
];

export const GROUP_LABELS: Record<CompareGroupId, string> = {
  valuationDeal: "Valuation & Deal",
  cashflowCarry: "Cashflow & Carry",
  distressTiming: "Distress & Timing",
  suiteDensity: "Suite & Density",
  structural: "Structural",
};

/** The group each persona lens floats to the top (and auto-expands). */
export const LENS_PRIORITY_GROUP: Record<PersonaType, CompareGroupId> = {
  smart: "valuationDeal",
  cashflow: "cashflowCarry",
  flippers: "distressTiming",
  builders: "suiteDensity",
};

export function lensGroupOrder(lens: PersonaType): CompareGroupId[] {
  const p = LENS_PRIORITY_GROUP[lens];
  return [p, ...GROUP_ORDER.filter((g) => g !== p)];
}

// ── Formatters ──────────────────────────────────────────────────────────────
const fmtMoney = (v: number) => `$${Math.round(v).toLocaleString()}`;
const fmtPct1 = (v: number) => `${v.toFixed(1)}%`;
const fmtPerMo = (v: number) => `${formatPrice(Math.round(v))}/mo`;
const fmtSignedPerMo = (v: number) =>
  `${v >= 0 ? "+" : "−"}${formatPrice(Math.abs(Math.round(v)))}/mo`;
const fmtInt = (v: number) => `${v}`;
const fmtDays = (v: number) => `${v} days`;

// ── Derived getters ───────────────────────────────────────────────────────────
const domOf = (l: ListingDocument): number | null =>
  l.TrueDom ?? l.calculatedDOM ?? l.DaysOnMarket ?? null;

const priceDropPct = (l: ListingDocument): number | null => {
  if (!l.OriginalListPrice || !l.ListPrice || l.OriginalListPrice <= l.ListPrice) return 0;
  return Math.round(((l.OriginalListPrice - l.ListPrice) / l.OriginalListPrice) * 100);
};

const discountPctOf = (ctx: MetricContext): number | null => {
  const est = ctx.estimate;
  if (!est?.estimatedValue || est.estimatedValue <= 0 || !ctx.listing.ListPrice) return null;
  return ((est.estimatedValue - ctx.listing.ListPrice) / est.estimatedValue) * 100;
};

const ppsfOf = (ctx: MetricContext): number | null => {
  const { estimate: est, listing: l } = ctx;
  if (est?.ppsf && est.ppsf > 0) return est.ppsf;
  return l.BuildingAreaTotal && l.BuildingAreaTotal > 0 ? l.ListPrice / l.BuildingAreaTotal : null;
};

const suiteText = (l: ListingDocument): string =>
  l.SuiteStatus === "EXISTING_SUITE"
    ? "Income suite"
    : l.SuiteStatus === "POTENTIAL_CANDIDATE" || l.hasSecondarySuitePotential
    ? "Suite potential"
    : "None";

const multiUnitText = (l: ListingDocument): string => {
  switch (l.multi_unit_status) {
    case "EXISTING_MULTI_UNIT": return "Existing multi-unit";
    case "PRIME_CANDIDATE": return "Prime candidate";
    case "MARGINAL_CANDIDATE": return "Marginal";
    case "NOT_VIABLE": return "Not viable";
    default: return "—";
  }
};

// ── The metric table ──────────────────────────────────────────────────────────
export const COMPARE_METRICS: CompareMetric[] = [
  // Valuation & Deal
  { key: "dealScore", label: "Deal Score", group: "valuationDeal", cellKind: "dealScore",
    get: (c) => dealScoreFromDocument(c.listing, c.estimate?.estimatedValue && c.estimate.confidence
      ? { estimatedValue: c.estimate.estimatedValue, confidence: c.estimate.confidence } : null).score,
    winner: "high", gated: true },
  { key: "estValue", label: "Est. Value", group: "valuationDeal", cellKind: "estValue",
    get: (c) => c.estimate?.estimatedValue ?? null, winner: null, gated: true },
  { key: "vsEstimate", label: "vs Estimate", group: "valuationDeal", cellKind: "discount",
    get: discountPctOf, winner: "high", gated: true },
  { key: "listPrice", label: "List Price", group: "valuationDeal", cellKind: "numeric",
    get: (c) => c.listing.ListPrice ?? null, format: formatPrice, winner: "low", magnitude: true },
  { key: "ppsf", label: "Price / Sqft", group: "valuationDeal", cellKind: "numeric",
    get: ppsfOf, format: fmtMoney, winner: "low", magnitude: true },

  // Cashflow & Carry (recomputed live — NOT gated)
  { key: "capRateUw", label: "Cap Rate (your assumptions)", group: "cashflowCarry", cellKind: "numeric",
    get: (c) => c.underwriting?.capRatePct ?? null, format: fmtPct1, winner: "high",
    tag: () => "est" },
  { key: "capRateVA", label: "Value-Add Cap Rate", group: "cashflowCarry", cellKind: "numeric",
    get: (c) => c.listing.ExtrapolatedCapRate ?? null, format: fmtPct1, winner: "high",
    tag: () => "BRRRR" },
  { key: "cashflow", label: "Monthly Cashflow", group: "cashflowCarry", cellKind: "numeric",
    get: (c) => c.underwriting?.monthlyCashflow ?? null, format: fmtSignedPerMo, winner: "high",
    tag: () => "est" },
  { key: "carry", label: "Monthly Carry", group: "cashflowCarry", cellKind: "numeric",
    get: (c) => c.underwriting?.monthlyCarry ?? null, format: fmtPerMo, winner: "low" },
  { key: "taxes", label: "Annual Taxes", group: "cashflowCarry", cellKind: "numeric",
    get: (c) => c.listing.TaxAnnualAmount ?? null, format: formatPrice, winner: "low" },
  { key: "fees", label: "Monthly Fees", group: "cashflowCarry", cellKind: "numeric",
    get: (c) => c.listing.AssociationFee ?? null, format: formatPrice, winner: "low" },

  // Distress & Timing
  { key: "trueDom", label: "True DOM", group: "distressTiming", cellKind: "numeric",
    get: (c) => domOf(c.listing), format: fmtDays, winner: "high" },
  { key: "priceDrop", label: "Price Drop", group: "distressTiming", cellKind: "numeric",
    get: (c) => priceDropPct(c.listing), format: (v) => `${v}%`, winner: "high" },
  { key: "stale", label: "Stale", group: "distressTiming", cellKind: "text", gated: true,
    getText: (c) => (c.listing.IsStale ? "Stale (>90d)" : "Fresh") },

  // Suite & Density
  { key: "suite", label: "Suite", group: "suiteDensity", cellKind: "text",
    getText: (c) => suiteText(c.listing) },
  { key: "suiteScore", label: "Suite Score", group: "suiteDensity", cellKind: "numeric",
    get: (c) => c.listing.SuiteScore ?? null, format: (v) => `${v}/6`, winner: "high" },
  { key: "multiUnit", label: "Multi-Unit", group: "suiteDensity", cellKind: "text",
    getText: (c) => multiUnitText(c.listing) },
  { key: "surplusParking", label: "Surplus Parking", group: "suiteDensity", cellKind: "numeric",
    get: (c) => c.listing.surplus_parking_count ?? null, format: fmtInt, winner: "high" },
  { key: "densityReady", label: "Density Ready", group: "suiteDensity", cellKind: "text",
    getText: (c) => (c.listing.is_density_ready ? "Yes" : "No") },

  // Structural
  { key: "type", label: "Type", group: "structural", cellKind: "text",
    getText: (c) => c.listing.PropertySubType || c.listing.PropertyType || "—" },
  { key: "beds", label: "Beds", group: "structural", cellKind: "numeric",
    get: (c) => c.listing.BedroomsTotal ?? null, format: fmtInt, winner: null },
  { key: "baths", label: "Baths", group: "structural", cellKind: "numeric",
    get: (c) => c.listing.BathroomsTotalInteger ?? null, format: fmtInt, winner: null },
  { key: "parking", label: "Parking", group: "structural", cellKind: "numeric",
    get: (c) => c.listing.ParkingTotal ?? null, format: fmtInt, winner: null },
  { key: "brokerage", label: "Brokerage", group: "structural", cellKind: "text", alwaysShow: true,
    getText: (c) => c.listing.ListOfficeName || "—" },
];

// ── The pure resolve seam ──────────────────────────────────────────────────────
export interface ResolvedRow {
  values: (number | null)[];
  /** Formatted display strings; null = locked or absent. */
  displayed: (string | null)[];
  locked: boolean[];
  winners: Set<number>;
  bestVal: number | null;
  tags: (string | null)[];
}

/** Turn one metric + the per-column contexts into everything the UI needs. Pure. */
export function resolveRow(metric: CompareMetric, contexts: MetricContext[]): ResolvedRow {
  const locked = contexts.map((c) => Boolean(metric.gated) && !c.isAuthed);

  if (metric.cellKind === "text") {
    const displayed = contexts.map((c, i) => (locked[i] ? null : metric.getText?.(c) ?? null));
    return {
      values: contexts.map(() => null),
      displayed,
      locked,
      winners: new Set(),
      bestVal: null,
      tags: contexts.map(() => null),
    };
  }

  const fmt = metric.format ?? ((v: number) => `${v}`);
  const values = contexts.map((c, i) => (locked[i] ? null : metric.get?.(c) ?? null));
  const displayed = values.map((v) => (v == null ? null : fmt(v)));
  const winners = winnerIndices(values, metric.winner ?? null);
  const bestVal = metric.magnitude ? bestValue(values, metric.winner ?? null) : null;
  const tags = contexts.map((c, i) => (locked[i] || values[i] == null ? null : metric.tag?.(c) ?? null));
  return { values, displayed, locked, winners, bestVal, tags };
}
```

- [ ] **Step 2: Write the resolver test**

```ts
import { describe, it, expect } from "vitest";
import { COMPARE_METRICS, resolveRow, lensGroupOrder, type MetricContext } from "./compareMetricsConfig";
import type { ListingDocument } from "@/lib/typesense/client";

const L = (over: Partial<ListingDocument>): ListingDocument =>
  ({ id: "X", ListPrice: 100, location: [0, 0], isDistressed: false, hasSecondarySuitePotential: false, ...over } as ListingDocument);

const ctx = (listing: ListingDocument, isAuthed = true): MetricContext => ({ listing, isAuthed });
const metric = (key: string) => COMPARE_METRICS.find((m) => m.key === key)!;

describe("resolveRow", () => {
  it("locks gated rows for anonymous users (no winner crowned)", () => {
    const r = resolveRow(metric("dealScore"), [ctx(L({}), false), ctx(L({}), false)]);
    expect(r.locked).toEqual([true, true]);
    expect(r.displayed).toEqual([null, null]);
    expect(r.winners.size).toBe(0);
  });

  it("crowns the cheaper List Price with a magnitude gap", () => {
    const r = resolveRow(metric("listPrice"), [ctx(L({ ListPrice: 900000 })), ctx(L({ ListPrice: 800000 }))]);
    expect([...r.winners]).toEqual([1]);
    expect(r.bestVal).toBe(800000);
  });

  it("renders text rows without winners", () => {
    const r = resolveRow(metric("type"), [ctx(L({ PropertySubType: "Condo" })), ctx(L({ PropertySubType: "Detached" }))]);
    expect(r.displayed).toEqual(["Condo", "Detached"]);
    expect(r.winners.size).toBe(0);
  });

  it("reads recomputed cap rate from the underwriting context and tags it 'est'", () => {
    const c1: MetricContext = { listing: L({}), isAuthed: true, underwriting: { capRatePct: 4.2 } as never };
    const c2: MetricContext = { listing: L({}), isAuthed: true, underwriting: { capRatePct: 5.1 } as never };
    const r = resolveRow(metric("capRateUw"), [c1, c2]);
    expect(r.displayed).toEqual(["4.2%", "5.1%"]);
    expect([...r.winners]).toEqual([1]);
    expect(r.tags).toEqual(["est", "est"]);
  });
});

describe("lensGroupOrder", () => {
  it("floats the persona's priority group to the front", () => {
    expect(lensGroupOrder("cashflow")[0]).toBe("cashflowCarry");
    expect(lensGroupOrder("smart")[0]).toBe("valuationDeal");
    expect(lensGroupOrder("builders")[0]).toBe("suiteDensity");
  });
  it("keeps all five groups exactly once", () => {
    const order = lensGroupOrder("flippers");
    expect(new Set(order).size).toBe(5);
    expect(order[0]).toBe("distressTiming");
  });
});
```

- [ ] **Step 3: Run tests (red → green)**

Run: `npx vitest run src/lib/compare/compareMetricsConfig.test.ts`
Expected: FAIL first (module missing) → after Step 1 exists, PASS.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS (config references only existing `ListingDocument`/`CompareEstimate`/`UnderwritingResult` fields).

- [ ] **Step 5: Commit**

```bash
git add src/lib/compare/compareMetricsConfig.ts src/lib/compare/compareMetricsConfig.test.ts
git commit -m "feat(compare): config-driven metrics model + pure resolveRow seam

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Phase 3 — Assumptions hook + bar + lens

### Task 4: `useCompareAssumptions.ts`

**Files:**
- Create: `src/lib/compare/useCompareAssumptions.ts`

- [ ] **Step 1: Write the hook**

```ts
"use client";

/**
 * Shared "your assumptions" state for Compare. Global down-payment % + interest
 * rate apply to ALL columns; rent is seeded per property via the same engine seed
 * the listing-page Sandbox uses (transparent, editable), with an optional override.
 * Every column re-underwrites through the deterministic computeUnderwriting engine.
 */
import { useMemo, useState, useCallback } from "react";
import type { ListingDocument } from "@/lib/typesense/client";
import {
  computeUnderwriting,
  seedAssumptions,
  UW_DEFAULTS,
  type UnderwritingResult,
} from "@/lib/underwriting/computeUnderwriting";

const hasSuite = (l: ListingDocument): boolean =>
  l.SuiteStatus === "EXISTING_SUITE" ||
  l.SuiteStatus === "POTENTIAL_CANDIDATE" ||
  Boolean(l.hasSecondarySuitePotential);

export interface UseCompareAssumptions {
  downPaymentPct: number;
  interestRatePct: number;
  setDownPaymentPct: (v: number) => void;
  setInterestRatePct: (v: number) => void;
  rentById: Record<string, number>;
  seededRentById: Record<string, number>;
  setRent: (id: string, v: number) => void;
  resultById: Record<string, UnderwritingResult>;
}

export function useCompareAssumptions(listings: ListingDocument[]): UseCompareAssumptions {
  const [downPaymentPct, setDownPaymentPct] = useState(UW_DEFAULTS.downPaymentPct);
  const [interestRatePct, setInterestRatePct] = useState(UW_DEFAULTS.interestRatePct);
  const [rentById, setRentById] = useState<Record<string, number>>({});

  const setRent = useCallback(
    (id: string, v: number) => setRentById((r) => ({ ...r, [id]: Math.max(0, v) })),
    []
  );

  const { resultById, seededRentById } = useMemo(() => {
    const results: Record<string, UnderwritingResult> = {};
    const seeds: Record<string, number> = {};
    for (const l of listings) {
      const base = seedAssumptions({
        listPrice: l.ListPrice,
        annualTaxes: l.TaxAnnualAmount ?? 0,
        monthlyFees: l.AssociationFee ?? 0,
        hasSuitePotential: hasSuite(l),
      });
      seeds[l.id] = base.monthlyRent;
      results[l.id] = computeUnderwriting({
        ...base,
        downPaymentPct,
        interestRatePct,
        monthlyRent: rentById[l.id] ?? base.monthlyRent,
      });
    }
    return { resultById: results, seededRentById: seeds };
  }, [listings, downPaymentPct, interestRatePct, rentById]);

  return {
    downPaymentPct, interestRatePct, setDownPaymentPct, setInterestRatePct,
    rentById, seededRentById, setRent, resultById,
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/compare/useCompareAssumptions.ts
git commit -m "feat(compare): useCompareAssumptions hook (global DP/rate + per-property rent)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 5: `LensSelector.tsx`

**Files:**
- Create: `src/components/compare/LensSelector.tsx`

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { cn } from "@/lib/utils";
import { PERSONA_LIST, type PersonaType } from "@/lib/personas/personaConfig";

export default function LensSelector({
  lens,
  onChange,
}: {
  lens: PersonaType;
  onChange: (lens: PersonaType) => void;
}) {
  return (
    <div className="inline-flex rounded-md border border-slate-700 bg-slate-900/60 p-0.5">
      {PERSONA_LIST.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => onChange(p.id)}
          className={cn(
            "rounded px-2.5 py-1 text-xs font-medium transition-colors",
            lens === p.id
              ? "bg-cyan-500/20 text-cyan-100"
              : "text-slate-400 hover:text-slate-200"
          )}
          title={p.label}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
```

(If `PERSONA_LIST` entries expose a short label field other than `.label`, use that; confirm against `personaConfig.ts:202`'s `PersonaDef`.)

- [ ] **Step 2: Typecheck + commit**

Run: `npm run typecheck`
Expected: PASS.

```bash
git add src/components/compare/LensSelector.tsx
git commit -m "feat(compare): persona LensSelector

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 6: `AssumptionsBar.tsx`

**Files:**
- Create: `src/components/compare/AssumptionsBar.tsx`

- [ ] **Step 1: Write the component** (mirrors the Sandbox slider pattern at `UnderwritingSandbox.tsx:179-213`)

```tsx
"use client";

import { Percent, Home, GitCompareArrows } from "lucide-react";
import { cn, formatPrice } from "@/lib/utils";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import LensSelector from "./LensSelector";
import type { PersonaType } from "@/lib/personas/personaConfig";

export default function AssumptionsBar({
  downPaymentPct,
  interestRatePct,
  onDownPayment,
  onInterestRate,
  lens,
  onLens,
  diffOnly,
  onDiffToggle,
}: {
  downPaymentPct: number;
  interestRatePct: number;
  onDownPayment: (v: number) => void;
  onInterestRate: (v: number) => void;
  lens: PersonaType;
  onLens: (lens: PersonaType) => void;
  diffOnly: boolean;
  onDiffToggle: (v: boolean) => void;
}) {
  return (
    <div className="sticky top-0 z-20 mb-4 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-lg border border-slate-800 bg-slate-900/80 px-4 py-3 backdrop-blur">
      <div className="min-w-[160px] flex-1">
        <div className="mb-1 flex items-center justify-between">
          <Label className="flex items-center gap-1 text-xs text-slate-400">
            <Home className="h-3 w-3" /> Down Payment
          </Label>
          <span className="font-mono text-xs text-emerald-400">{downPaymentPct}%</span>
        </div>
        <Slider value={[downPaymentPct]} onValueChange={([v]) => onDownPayment(v)} min={5} max={50} step={1} />
      </div>

      <div className="min-w-[160px] flex-1">
        <div className="mb-1 flex items-center justify-between">
          <Label className="flex items-center gap-1 text-xs text-slate-400">
            <Percent className="h-3 w-3" /> Interest Rate
          </Label>
          <span className="font-mono text-xs text-emerald-400">{interestRatePct.toFixed(3)}%</span>
        </div>
        <Slider value={[interestRatePct]} onValueChange={([v]) => onInterestRate(v)} min={3} max={12} step={0.125} />
      </div>

      <div className="flex items-center gap-3">
        <LensSelector lens={lens} onChange={onLens} />
        <button
          type="button"
          onClick={() => onDiffToggle(!diffOnly)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
            diffOnly
              ? "border-cyan-400/50 bg-cyan-500/20 text-cyan-100"
              : "border-slate-700 text-slate-400 hover:text-slate-200"
          )}
          title="Hide rows where every property is identical"
        >
          <GitCompareArrows className="h-3.5 w-3.5" />
          Differences only
        </button>
      </div>

      <p className="w-full text-[10px] text-slate-600">
        Carry, cap rate &amp; cashflow recompute live from your assumptions — list-price math, not advice.
        Rent is a per-property estimate; adjust it in each column.
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
git add src/components/compare/AssumptionsBar.tsx
git commit -m "feat(compare): sticky assumptions bar (DP/rate sliders, lens, diff toggle)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Phase 4 — Media + per-property rent

### Task 7: `CompareMediaCell.tsx`

**Files:**
- Create: `src/components/compare/CompareMediaCell.tsx`

- [ ] **Step 1: Write the component** (reuses `ListingThumbnail` + `MediaGalleryOverlay`)

```tsx
"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Images } from "lucide-react";
import dynamic from "next/dynamic";
import ListingThumbnail from "@/components/listing/ListingThumbnail";
import type { ListingDocument } from "@/lib/typesense/client";

// Overlay is heavy + only needed on click — load it lazily, never 4× up front.
const MediaGalleryOverlay = dynamic(
  () => import("@/components/Property/MediaGalleryOverlay"),
  { ssr: false }
);

export default function CompareMediaCell({ listing }: { listing: ListingDocument }) {
  const images = useMemo(() => {
    const all = listing.RawImages?.length
      ? listing.RawImages
      : [listing.primaryImageUrl, listing.thumbnailUrl].filter((u): u is string => Boolean(u));
    return Array.from(new Set(all));
  }, [listing.RawImages, listing.primaryImageUrl, listing.thumbnailUrl]);

  const [idx, setIdx] = useState(0);
  const [open, setOpen] = useState(false);
  const count = images.length;
  const current = images[Math.min(idx, Math.max(0, count - 1))] ?? null;

  const step = (d: number) => setIdx((i) => (count ? (i + d + count) % count : 0));

  return (
    <div className="relative mb-2 h-28 w-full overflow-hidden rounded-md bg-slate-800">
      <button
        type="button"
        onClick={() => count > 0 && setOpen(true)}
        className="block h-full w-full"
        aria-label={count > 0 ? `Open ${count} photos` : "No photos"}
      >
        <ListingThumbnail
          src={current}
          alt={listing.UnparsedAddress || "Listing"}
          className="h-full w-full"
          imgClassName="object-cover"
        />
      </button>

      {count > 1 && (
        <>
          <button type="button" onClick={() => step(-1)} aria-label="Previous photo"
            className="absolute left-1 top-1/2 -translate-y-1/2 rounded-full bg-slate-950/70 p-1 text-slate-200 hover:bg-slate-900">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => step(1)} aria-label="Next photo"
            className="absolute right-1 top-1/2 -translate-y-1/2 rounded-full bg-slate-950/70 p-1 text-slate-200 hover:bg-slate-900">
            <ChevronRight className="h-4 w-4" />
          </button>
          <span className="absolute bottom-1 right-1 inline-flex items-center gap-1 rounded bg-slate-950/70 px-1.5 py-0.5 text-[10px] font-mono text-slate-200">
            <Images className="h-3 w-3" /> {Math.min(idx, count - 1) + 1}/{count}
          </span>
        </>
      )}

      {open && (
        <MediaGalleryOverlay images={images} isOpen={open} initialIndex={idx} onClose={() => setOpen(false)} />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify `ListingThumbnail` prop names**

Confirm `src/components/listing/ListingThumbnail.tsx` accepts `src`, `alt`, `className`, `imgClassName`. If the image-class prop differs, adjust.

- [ ] **Step 3: Typecheck + build + commit**

Run: `npm run typecheck && npm run build`
Expected: PASS.

```bash
git add src/components/compare/CompareMediaCell.tsx
git commit -m "feat(compare): scroll-through media cell (reuses MediaGalleryOverlay)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 7b: `RentInput.tsx`

**Files:**
- Create: `src/components/compare/RentInput.tsx`

A per-property monthly-rent field. Seeds from the engine's `seedMonthlyRent`; editing it calls `useCompareAssumptions.setRent(id, v)`, which re-underwrites that one column so its Cap Rate (your assumptions) + Monthly Cashflow update live. Lives in the property column header (desktop) and the identity card (mobile), not as a metric row — keeping the `resolveRow` seam pure.

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { Input } from "@/components/ui/input";

export default function RentInput({
  value,
  seeded,
  onChange,
}: {
  value: number | undefined;
  seeded: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="mt-1 flex items-center gap-1 text-[10px] text-slate-500">
      <span className="uppercase tracking-wide">Rent</span>
      <Input
        type="number"
        inputMode="numeric"
        value={value ?? seeded}
        onChange={(e) => onChange(Math.max(0, Number(e.target.value)))}
        className="h-6 w-20 border-slate-700 bg-slate-800 px-1.5 font-mono text-xs text-slate-200"
        aria-label="Monthly rent assumption"
      />
      <span className="text-amber-400/80">/mo est</span>
    </label>
  );
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `npm run typecheck`
Expected: PASS.

```bash
git add src/components/compare/RentInput.tsx
git commit -m "feat(compare): editable per-property rent input

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Phase 5 — Desktop grouped renderer

### Task 8: `LockedCell.tsx`

**Files:**
- Create: `src/components/compare/LockedCell.tsx`

- [ ] **Step 1: Extract from `CompareClient.tsx:358-365`**

```tsx
import { Lock } from "lucide-react";

export default function LockedCell() {
  return (
    <span className="inline-flex items-center gap-1 text-slate-500" title="Sign in to view">
      <Lock className="h-3.5 w-3.5 text-cyan-400/70" />
      <span aria-hidden="true" className="select-none blur-[2px]">•••</span>
    </span>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/compare/LockedCell.tsx
git commit -m "refactor(compare): extract shared LockedCell

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 9: `MetricRow.tsx`

**Files:**
- Create: `src/components/compare/MetricRow.tsx`

Renders one desktop `<tr>` for a metric, consuming a pre-computed `ResolvedRow` plus the contexts (needed for the dealScore/estValue/discount visuals).

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { cn, formatPrice } from "@/lib/utils";
import { DealScoreBadge } from "@/components/Property/DealScoreCard";
import { dealScoreFromDocument } from "@/lib/dealScore/fromListingDocument";
import LockedCell from "./LockedCell";
import type { CompareMetric, MetricContext, ResolvedRow } from "@/lib/compare/compareMetricsConfig";

export default function MetricRow({
  metric,
  contexts,
  resolved,
}: {
  metric: CompareMetric;
  contexts: MetricContext[];
  resolved: ResolvedRow;
}) {
  return (
    <tr className="hover:bg-slate-900/30">
      <td className="sticky left-0 z-10 bg-slate-950 p-3 text-slate-500">{metric.label}</td>
      {contexts.map((ctx, i) => {
        if (resolved.locked[i]) {
          return <td key={ctx.listing.id} className="p-3"><LockedCell /></td>;
        }
        const v = resolved.values[i];
        const display = resolved.displayed[i];
        const isBest = resolved.winners.has(i);
        const tag = resolved.tags[i];

        // Special visual treatments (winner/diff logic already applied upstream).
        if (metric.cellKind === "dealScore") {
          const d = dealScoreFromDocument(
            ctx.listing,
            ctx.estimate?.estimatedValue && ctx.estimate.confidence
              ? { estimatedValue: ctx.estimate.estimatedValue, confidence: ctx.estimate.confidence }
              : null
          );
          return (
            <td key={ctx.listing.id} className={cn("p-3", isBest && "bg-emerald-500/5")}>
              {d.score != null ? (
                <span className="inline-flex items-center gap-1.5">
                  <DealScoreBadge score={d.score} grade={d.grade} />
                  {isBest && <span className="text-[10px] uppercase text-emerald-500">best</span>}
                </span>
              ) : <span className="text-slate-600">—</span>}
            </td>
          );
        }

        if (metric.cellKind === "estValue") {
          return (
            <td key={ctx.listing.id} className="p-3 font-mono text-slate-200">
              {v != null ? (
                <span className="inline-flex items-center gap-1.5">
                  {formatPrice(v)}
                  {ctx.estimate?.confidence && (
                    <span className="text-[10px] uppercase tracking-wide text-slate-500">
                      {ctx.estimate.confidence.toLowerCase()}
                    </span>
                  )}
                </span>
              ) : <span className="text-xs text-slate-600">Insufficient comps</span>}
            </td>
          );
        }

        if (metric.cellKind === "discount") {
          if (v == null) return <td key={ctx.listing.id} className="p-3 text-slate-600">—</td>;
          const under = v >= 0;
          return (
            <td key={ctx.listing.id} className="p-3 font-mono">
              <span className={cn("font-semibold", under ? "text-emerald-400" : "text-amber-400")}>
                {`${Math.abs(v).toFixed(1)}% ${under ? "under" : "over"}`}
              </span>
              {isBest && <span className="ml-1.5 text-[10px] uppercase text-emerald-500">best</span>}
            </td>
          );
        }

        // numeric + text
        const delta =
          metric.magnitude && resolved.bestVal != null && v != null && v !== resolved.bestVal
            ? `${v - resolved.bestVal > 0 ? "+" : "−"}${(metric.format ?? String)(Math.abs(v - resolved.bestVal))}`
            : null;
        return (
          <td
            key={ctx.listing.id}
            className={cn(
              "p-3",
              metric.cellKind === "numeric" && "font-mono",
              isBest ? "font-bold text-emerald-400" : "text-slate-200"
            )}
          >
            {display ?? <span className="text-slate-600">—</span>}
            {isBest && <span className="ml-1.5 text-[10px] uppercase text-emerald-500">best</span>}
            {tag && <span className="ml-1.5 text-[10px] text-amber-400/80">{tag}</span>}
            {delta && <span className="ml-1.5 text-[10px] text-slate-500">{delta}</span>}
          </td>
        );
      })}
    </tr>
  );
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
git add src/components/compare/MetricRow.tsx
git commit -m "feat(compare): config-driven desktop MetricRow

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 10: `MetricGroup.tsx`

**Files:**
- Create: `src/components/compare/MetricGroup.tsx`

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { rowIsIdentical } from "@/lib/compare/diff";
import {
  resolveRow,
  GROUP_LABELS,
  type CompareGroupId,
  type CompareMetric,
  type MetricContext,
} from "@/lib/compare/compareMetricsConfig";
import MetricRow from "./MetricRow";

export default function MetricGroup({
  groupId,
  metrics,
  contexts,
  colSpan,
  defaultOpen,
  diffOnly,
}: {
  groupId: CompareGroupId;
  metrics: CompareMetric[];
  contexts: MetricContext[];
  colSpan: number;
  defaultOpen: boolean;
  diffOnly: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  const rows = metrics.map((m) => ({ metric: m, resolved: resolveRow(m, contexts) }));
  const visible = diffOnly
    ? rows.filter(({ metric, resolved }) => metric.alwaysShow || !rowIsIdentical(resolved.displayed))
    : rows;

  return (
    <tbody className="divide-y divide-slate-800/70 border-b-4 border-slate-950">
      <tr className="bg-slate-900/50">
        <td colSpan={colSpan} className="sticky left-0 z-10 p-0">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-400 hover:text-slate-200"
          >
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", !open && "-rotate-90")} />
            {GROUP_LABELS[groupId]}
          </button>
        </td>
      </tr>
      {open && visible.length === 0 && (
        <tr>
          <td colSpan={colSpan} className="px-3 py-2 text-xs italic text-slate-600">
            All identical
          </td>
        </tr>
      )}
      {open && visible.map(({ metric, resolved }) => (
        <MetricRow key={metric.key} metric={metric} contexts={contexts} resolved={resolved} />
      ))}
    </tbody>
  );
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
git add src/components/compare/MetricGroup.tsx
git commit -m "feat(compare): collapsible MetricGroup with diff hiding

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 11: Rebuild `CompareClient.tsx` (desktop)

**Files:**
- Modify: `src/app/(app)/properties/compare/CompareClient.tsx`

- [ ] **Step 1: Replace the component body** (keep `Header`, anon banner, empty state, disclaimer; delete the inline `NUMERIC_METRICS`/`TEXT_METRICS`/`bestIndices`/`bestValue`/`LockedCell` now living in the config + helpers)

```tsx
"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, GitCompareArrows, Lock } from "lucide-react";
import type { CompareData } from "@/lib/property/getCompareData";
import {
  COMPARE_METRICS,
  GROUP_ORDER,
  LENS_PRIORITY_GROUP,
  lensGroupOrder,
  type MetricContext,
} from "@/lib/compare/compareMetricsConfig";
import { useCompareAssumptions } from "@/lib/compare/useCompareAssumptions";
import AssumptionsBar from "@/components/compare/AssumptionsBar";
import MetricGroup from "@/components/compare/MetricGroup";
import CompareMediaCell from "@/components/compare/CompareMediaCell";
import RentInput from "@/components/compare/RentInput";
import CompareMobile from "@/components/compare/CompareMobile";
import { formatPrice } from "@/lib/utils";
import type { PersonaType } from "@/lib/personas/personaConfig";

export default function CompareClient({
  listings,
  estimates,
  isAuthed,
}: CompareData & { isAuthed: boolean }) {
  const [lens, setLens] = useState<PersonaType>("smart");
  const [diffOnly, setDiffOnly] = useState(false);
  const uw = useCompareAssumptions(listings);

  const contexts: MetricContext[] = useMemo(
    () => listings.map((l) => ({
      listing: l,
      estimate: estimates[l.id],
      underwriting: uw.resultById[l.id],
      isAuthed,
    })),
    [listings, estimates, uw.resultById, isAuthed]
  );

  if (listings.length === 0) {
    return (
      <div className="mx-auto max-w-[1400px] px-4 py-6">
        <Header />
        <div className="py-20 text-center text-slate-400">
          <p className="mb-4">No properties to compare.</p>
          <Link href="/properties" className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800">
            ← Pick properties in the Command Center
          </Link>
        </div>
      </div>
    );
  }

  const colSpan = listings.length + 1;
  const order = lensGroupOrder(lens);

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6">
      <Header />
      {!isAuthed && <AnonBanner ids={listings.map((l) => l.id)} />}

      <AssumptionsBar
        downPaymentPct={uw.downPaymentPct}
        interestRatePct={uw.interestRatePct}
        onDownPayment={uw.setDownPaymentPct}
        onInterestRate={uw.setInterestRatePct}
        lens={lens}
        onLens={setLens}
        diffOnly={diffOnly}
        onDiffToggle={setDiffOnly}
      />

      {/* Desktop table */}
      <div className="hidden overflow-x-auto rounded-lg border border-slate-800 md:block">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-800 bg-slate-900/50">
              <th className="sticky left-0 z-10 min-w-[150px] bg-slate-900/50 p-3 text-left text-xs uppercase tracking-wider text-slate-500">
                Metric
              </th>
              {listings.map((l) => (
                <th key={l.id} className="min-w-[220px] p-3 text-left align-top">
                  <CompareMediaCell listing={l} />
                  <Link href={`/properties/${l.id}`} className="group block">
                    <p className="font-mono text-base font-bold text-emerald-400">{formatPrice(l.ListPrice)}</p>
                    <p className="text-xs leading-snug text-slate-300 group-hover:text-cyan-300">
                      {l.UnparsedAddress || l.City || "Address unavailable"}
                    </p>
                  </Link>
                  <RentInput
                    value={uw.rentById[l.id]}
                    seeded={uw.seededRentById[l.id] ?? 0}
                    onChange={(v) => uw.setRent(l.id, v)}
                  />
                </th>
              ))}
            </tr>
          </thead>
          {order.map((groupId) => (
            <MetricGroup
              key={groupId}
              groupId={groupId}
              metrics={COMPARE_METRICS.filter((m) => m.group === groupId)}
              contexts={contexts}
              colSpan={colSpan}
              defaultOpen={groupId === LENS_PRIORITY_GROUP[lens] || groupId === GROUP_ORDER[0]}
              diffOnly={diffOnly}
            />
          ))}
        </table>
      </div>

      {/* Mobile */}
      <CompareMobile
        listings={listings}
        contexts={contexts}
        lens={lens}
        diffOnly={diffOnly}
        rentById={uw.rentById}
        seededRentById={uw.seededRentById}
        onRent={uw.setRent}
      />

      <p className="mt-3 text-[11px] leading-relaxed text-slate-600">
        Est. Value is the PureProperty Estimate — our own deterministic model, not an MLS/TRREB figure.
        Carry, cap rate &amp; cashflow are computed from your assumptions and a rent estimate, not advice.
      </p>
    </div>
  );
}

function AnonBanner({ ids }: { ids: string[] }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-cyan-500/30 bg-cyan-500/5 px-4 py-2.5">
      <p className="text-xs text-slate-300">
        <Lock className="mr-1.5 inline h-3.5 w-3.5 text-cyan-400" />
        Estimates, deal scores &amp; sold-derived metrics are members-only.
      </p>
      <Link
        href={`/login?next=${encodeURIComponent(`/properties/compare?ids=${ids.join(",")}`)}`}
        className="shrink-0 rounded-md border border-cyan-400/50 bg-cyan-500/20 px-3 py-1.5 text-xs font-semibold text-cyan-100 transition-colors hover:bg-cyan-500/30"
      >
        Sign in to unlock
      </Link>
    </div>
  );
}

function Header() {
  return (
    <div className="mb-6 flex items-center justify-between">
      <div>
        <Link href="/properties" className="mb-2 inline-flex items-center gap-1.5 text-sm text-cyan-400 transition-colors hover:text-cyan-300">
          <ArrowLeft className="h-4 w-4" />
          Back to Command Center
        </Link>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-100">
          <GitCompareArrows className="h-6 w-6 text-cyan-400" />
          Compare Properties
        </h1>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + build**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 3: Manual verification (desktop)**

Run `npm run dev`; open `/properties/compare?ids=<4 ids>`:
- Media cell: prev/next cycles photos; count badge correct; click opens full-screen overlay; address/price below unchanged.
- Move DP%/rate sliders → Cap Rate (your assumptions), Monthly Cashflow, Monthly Carry update in every column simultaneously; winner highlight follows.
- Switch lens → priority group floats to top + auto-expands; collapse/expand groups works.
- Toggle "Differences only" → identical rows hide; a fully-identical group shows "All identical"; **Brokerage never hides**.
- Anon (logged out): Deal Score / Est. Value / vs Estimate / Stale show `LockedCell`; Carry/Cap Rate (your assumptions)/Cashflow still compute and show; Brokerage shows.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/properties/compare/CompareClient.tsx"
git commit -m "feat(compare): grouped, lens-aware desktop grid with live assumptions

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Phase 6 — Mobile

### Task 12: `CompareMobile.tsx`

**Files:**
- Create: `src/components/compare/CompareMobile.tsx`

A per-property card stack. For each group (in lens order), render the metric label once with a horizontally-scrolling row of per-property value chips (winner-highlighted), reusing `resolveRow` + `rowIsIdentical`. Property identity = a snapping row of `CompareMediaCell` mini-cards at top. Shown only on small screens (`md:hidden`); the desktop table uses `hidden md:block` (CSS toggle, no `matchMedia` → no hydration mismatch).

- [ ] **Step 1: Write the component**

```tsx
"use client";

import Link from "next/link";
import { cn, formatPrice } from "@/lib/utils";
import { rowIsIdentical } from "@/lib/compare/diff";
import {
  COMPARE_METRICS,
  GROUP_LABELS,
  lensGroupOrder,
  resolveRow,
  type MetricContext,
} from "@/lib/compare/compareMetricsConfig";
import CompareMediaCell from "./CompareMediaCell";
import RentInput from "./RentInput";
import LockedCell from "./LockedCell";
import type { ListingDocument } from "@/lib/typesense/client";
import type { PersonaType } from "@/lib/personas/personaConfig";

export default function CompareMobile({
  listings,
  contexts,
  lens,
  diffOnly,
  rentById,
  seededRentById,
  onRent,
}: {
  listings: ListingDocument[];
  contexts: MetricContext[];
  lens: PersonaType;
  diffOnly: boolean;
  rentById: Record<string, number>;
  seededRentById: Record<string, number>;
  onRent: (id: string, v: number) => void;
}) {
  return (
    <div className="space-y-6 md:hidden">
      {/* Property identity row */}
      <div className="flex snap-x gap-3 overflow-x-auto pb-1">
        {listings.map((l) => (
          <div key={l.id} className="w-40 shrink-0 snap-start">
            <CompareMediaCell listing={l} />
            <Link href={`/properties/${l.id}`} className="block">
              <p className="font-mono text-sm font-bold text-emerald-400">{formatPrice(l.ListPrice)}</p>
              <p className="text-[11px] leading-snug text-slate-300">{l.UnparsedAddress || l.City || "—"}</p>
            </Link>
            <RentInput
              value={rentById[l.id]}
              seeded={seededRentById[l.id] ?? 0}
              onChange={(v) => onRent(l.id, v)}
            />
          </div>
        ))}
      </div>

      {lensGroupOrder(lens).map((groupId) => {
        const rows = COMPARE_METRICS.filter((m) => m.group === groupId).map((m) => ({
          metric: m,
          resolved: resolveRow(m, contexts),
        }));
        const visible = diffOnly
          ? rows.filter(({ metric, resolved }) => metric.alwaysShow || !rowIsIdentical(resolved.displayed))
          : rows;
        if (visible.length === 0) return null;

        return (
          <div key={groupId} className="rounded-lg border border-slate-800">
            <div className="border-b border-slate-800 bg-slate-900/50 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
              {GROUP_LABELS[groupId]}
            </div>
            <div className="divide-y divide-slate-800/70">
              {visible.map(({ metric, resolved }) => (
                <div key={metric.key} className="px-3 py-2">
                  <p className="mb-1 text-[11px] uppercase tracking-wide text-slate-500">{metric.label}</p>
                  <div className="flex snap-x gap-2 overflow-x-auto">
                    {contexts.map((ctx, i) => (
                      <div
                        key={ctx.listing.id}
                        className={cn(
                          "w-28 shrink-0 snap-start rounded px-2 py-1 font-mono text-sm",
                          resolved.winners.has(i)
                            ? "bg-emerald-500/10 font-bold text-emerald-400"
                            : "text-slate-200"
                        )}
                      >
                        {resolved.locked[i] ? <LockedCell /> : (resolved.displayed[i] ?? <span className="text-slate-600">—</span>)}
                        {resolved.tags[i] && <span className="ml-1 text-[10px] text-amber-400/80">{resolved.tags[i]}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

(Mobile renders dealScore/estValue/discount via their resolved display string + winner highlight — the rich badge/colour treatment is desktop-only by design; the number + "best" chip is enough on a phone.)

- [ ] **Step 2: Typecheck + build**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 3: Manual verification (mobile)**

In dev tools device mode (≤640px): desktop table hidden, card stack shown; property row scrolls horizontally; each metric's value chips scroll and winner-highlight; diff toggle + lens still work; gated cells locked for anon.

- [ ] **Step 4: Commit**

```bash
git add src/components/compare/CompareMobile.tsx
git commit -m "feat(compare): mobile card-stack layout reusing the metric config

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Phase 7 — Compliance + edge-case pass & finish

### Task 13: Final verification sweep

**Files:** none (verification + any small fixes surfaced).

- [ ] **Step 1: Full test + build**

Run: `npx vitest run src/lib/compare && npm run typecheck && npm run lint && npm run build`
Expected: all PASS.

- [ ] **Step 2: Compliance checklist (manual, logged out)**
  - Deal Score, Est. Value, vs Estimate, Stale → `LockedCell`. ✅
  - `TrueDom` not leaked (server already strips; True DOM row shows IDX-fallback DOM, not the stitched value). ✅
  - Brokerage visible on every column, every lens, and with "Differences only" ON. ✅
  - Carry / Cap Rate (your assumptions) / Cashflow compute for anon (list-price math only). ✅

- [ ] **Step 3: Edge cases (manual)**
  - 2 columns and 4 columns both render; winner needs ≥2 values (no lone "best").
  - A listing with empty `RawImages` → media cell falls back to thumbnail, no prev/next, no badge.
  - Ties → all tied columns show "best".
  - Per-property rent override (if exposed in a column) recomputes only that column; clearing reverts to the seed.

- [ ] **Step 4: Push the branch & open a PR (only if the user asks)**

```bash
git push -u origin feat/compare-redesign
```

Then open a PR titled `Compare Properties redesign: media scroll, live underwriting, lenses, diff, mobile`.

---

## Self-Review (completed by plan author)

- **Spec coverage:** media scroll-through (Task 7) · editable per-property rent (Task 7b, wired in Tasks 11/12) · winner highlighting (Task 1 + MetricRow) · grouped collapsible sections (Task 10) · persona lens default smart (config + Task 11) · shared "your assumptions" recompute bar (Tasks 4/6/11) · diff toggle (Task 2 + Groups) · mobile rework (Task 12) · no in-compare search (excluded — basket unchanged). ✅ All covered.
- **Placeholders:** none — every code step is complete; types/functions referenced (`computeUnderwriting`, `seedAssumptions`, `dealScoreFromDocument`, `DealScoreBadge`, `PERSONA_LIST`, `Slider`/`Input`/`Label`, `MediaGalleryOverlay`, `ListingThumbnail`) all exist and were read during planning.
- **Type consistency:** `ResolvedRow`, `MetricContext`, `CompareMetric`, `CompareGroupId`, `PersonaType` are defined once in `compareMetricsConfig.ts` and consumed unchanged by `MetricRow`/`MetricGroup`/`CompareMobile`/`CompareClient`. The hook's `UnderwritingResult` comes straight from the engine.
- **Open verification items flagged in steps:** confirm `ListingThumbnail` prop names (Task 7 Step 2) and `PersonaDef.label` field (Task 5 Step 1) at execution time.
