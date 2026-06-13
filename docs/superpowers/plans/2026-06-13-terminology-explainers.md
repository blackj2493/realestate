# Terminology & Explainers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one source-of-truth Term Registry that fixes inconsistent metric names, powers an on-demand `<TermTip>` explainer, and renders a public `/glossary` SEO page.

**Architecture:** A pure-data registry (`src/lib/glossary/terms.ts`) holds each concept's canonical name + plain-language definition. Surfaces read names from it (so names can't drift). A `<TermTip>` component (built on the existing `popover.tsx`) shows the definition on click/tap. The four naming fixes are display-label-only edits (no state keys change → zero migration). A `/glossary` page renders the registry.

**Tech Stack:** Next.js (App Router), TypeScript, Tailwind, Zustand (existing), Vitest (node-env — no jsdom, so only pure logic is unit-tested; React is verified via typecheck/lint/build/manual).

**Spec:** `docs/superpowers/specs/2026-06-13-terminology-explainers-design.md` (O-1 resolved as (a): keep both Capital Burn + Carry Cost with disambiguating tips).

---

## File Structure

**Create:**
- `src/lib/glossary/terms.ts` — the registry: `TermId`/`GlossaryGroupId` types, `TermDef`, `TERMS`, `GLOSSARY_GROUPS`, accessors (`term`, `termsByGroup`), tip-text helper (`buildTipContent`), constants (`NOT_MLS_LINE`, `glossaryHref`). Pure logic, no React.
- `src/lib/glossary/terms.test.ts` — registry integrity + tip-text + grouping tests.
- `src/lib/glossary/wiring.test.ts` — consistency test: renamed surfaces resolve to registry names.
- `src/components/ui/TermTip.tsx` — the ⓘ info-tip (client component on `popover.tsx`).
- `src/app/(app)/glossary/page.tsx` — the public glossary (server component).

**Modify:**
- `src/lib/personas/personaConfig.ts` — 3 renames (Yield→Cap Rate, Duplex/Suite-Duplex→Suite Potential, Zoning Potential→Density Ready), sourced from `term()`.
- `src/lib/compare/compareMetricsConfig.ts` — 1 rename (Monthly Carry→Carry Cost).
- `src/lib/personas/mapMetrics.ts` — 1 rename (Density→Listing Density).
- `src/components/Property/ListingEstimateCard.tsx` + 5 sibling cards — add `<TermTip iconOnly>` next to each title.

---

## Phase 1 — Term Registry + tests (pure logic, TDD)

### Task 1: Registry types, data, and accessors

**Files:**
- Create: `src/lib/glossary/terms.ts`
- Test: `src/lib/glossary/terms.test.ts`

- [ ] **Step 1: Write the failing test**

`src/lib/glossary/terms.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  TERMS,
  GLOSSARY_GROUPS,
  term,
  termsByGroup,
  buildTipContent,
  glossaryHref,
  NOT_MLS_LINE,
  type TermId,
} from "./terms";

const ALL_IDS = Object.keys(TERMS) as TermId[];

describe("term registry integrity", () => {
  it("every entry has non-empty name, subtitle, definition", () => {
    for (const id of ALL_IDS) {
      const t = TERMS[id];
      expect(t.id, `id key matches entry for ${id}`).toBe(id);
      expect(t.name.trim().length, `name for ${id}`).toBeGreaterThan(0);
      expect(t.subtitle.trim().length, `subtitle for ${id}`).toBeGreaterThan(0);
      expect(t.definition.trim().length, `definition for ${id}`).toBeGreaterThan(0);
    }
  });

  it("subtitles stay short (<= 40 chars) so they fit tight surfaces", () => {
    for (const id of ALL_IDS) {
      expect(TERMS[id].subtitle.length, `subtitle length for ${id}`).toBeLessThanOrEqual(40);
    }
  });

  it("every term's group is a declared glossary group", () => {
    const groupIds = new Set(GLOSSARY_GROUPS.map((g) => g.id));
    for (const id of ALL_IDS) {
      expect(groupIds.has(TERMS[id].group), `group for ${id}`).toBe(true);
    }
  });

  it("no duplicate names within a group", () => {
    for (const g of GLOSSARY_GROUPS) {
      const names = Object.values(TERMS)
        .filter((t) => t.group === g.id)
        .map((t) => t.name.toLowerCase());
      expect(new Set(names).size, `unique names in ${g.id}`).toBe(names.length);
    }
  });

  it("term() throws on unknown id", () => {
    // @ts-expect-error intentional bad id
    expect(() => term("nope")).toThrow();
  });

  it("termsByGroup partitions all terms with no loss", () => {
    const grouped = termsByGroup();
    const flat = GLOSSARY_GROUPS.flatMap((g) => grouped[g.id]);
    expect(flat.length).toBe(ALL_IDS.length);
  });
});

describe("buildTipContent", () => {
  it("includes the compliance line only for notMls terms", () => {
    expect(buildTipContent("trueValue").notMlsLine).toBe(NOT_MLS_LINE);
    expect(buildTipContent("monthsOfSupply").notMlsLine).toBeNull();
  });

  it("links to the term's glossary anchor", () => {
    expect(buildTipContent("trueDom").href).toBe(glossaryHref("trueDom"));
    expect(glossaryHref("trueDom")).toBe("/glossary#trueDom");
  });

  it("pins canonical copy for the renamed terms", () => {
    expect(term("capRate").name).toBe("Cap Rate");
    expect(term("carryCost").name).toBe("Carry Cost");
    expect(term("suitePotential").name).toBe("Suite Potential");
    expect(term("densityReady").name).toBe("Density Ready");
    expect(term("listingDensity").name).toBe("Listing Density");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx.cmd vitest run src/lib/glossary/terms.test.ts`
Expected: FAIL — `Cannot find module './terms'`.

- [ ] **Step 3: Write the registry**

`src/lib/glossary/terms.ts`:

```ts
/**
 * Term Registry — single source of truth for PureProperty's branded metric
 * names + plain-language explainers. Pure data/logic (no React, no Node APIs)
 * so it is unit-testable in vitest's node env and importable from both server
 * (glossary page) and client (TermTip, persona/compare configs).
 *
 * Definitions are generic concept explanations authored by hand — they are
 * NEVER raw IDX/VOW listing data passed through an LLM, and never a specific
 * listing's gated figure, so they are safe to render to anonymous users
 * (CLAUDE.md §4 / VOW). `notMls: true` surfaces the standard disclosure.
 */

export type GlossaryGroupId =
  | "valuation"
  | "cashflowCarry"
  | "timingDistress"
  | "suiteDensity"
  | "market"
  | "personas";

export type TermId =
  // valuation
  | "trueValue" | "expectedSalePrice" | "ourCall" | "dealScore" | "priceDrop"
  // cashflow & carry
  | "capRate" | "grossYield" | "carryCost" | "capitalBurn" | "monthlyCashflow"
  // timing & distress
  | "trueDom" | "stale" | "fresh" | "alphaFlag"
  // suite & density
  | "suitePotential" | "incomeSuite" | "multiUnit" | "surplusParking"
  | "densityReady" | "listingDensity"
  // market
  | "marketPulse" | "monthsOfSupply" | "soldToList" | "renovationUpside"
  | "condoFeeStability"
  // personas
  | "personaSmart" | "personaCashflow" | "personaFlippers" | "personaBuilders";

export interface TermDef {
  id: TermId;
  /** Canonical display name. THE source of truth — surfaces import this. */
  name: string;
  /** <= 40 chars. Bolded lead in the tip; inline hint where space allows. */
  subtitle: string;
  /** 1–2 sentences. Tip body + glossary entry. */
  definition: string;
  /** Optional deeper note; glossary-only. */
  methodology?: string;
  /** When true, TermTip + glossary append NOT_MLS_LINE. */
  notMls?: boolean;
  group: GlossaryGroupId;
  /** Prior/alternate names — glossary "also known as" + searchability. */
  aka?: string[];
}

export const NOT_MLS_LINE = "Our metric — not an MLS or TRREB figure.";

export const glossaryHref = (id: TermId): string => `/glossary#${id}`;

export const GLOSSARY_GROUPS: { id: GlossaryGroupId; title: string }[] = [
  { id: "valuation", title: "Valuation & Deal" },
  { id: "cashflowCarry", title: "Cashflow & Carry" },
  { id: "timingDistress", title: "Timing & Distress" },
  { id: "suiteDensity", title: "Suite & Density" },
  { id: "market", title: "Market & Value-Add" },
  { id: "personas", title: "Investor Lenses" },
];

export const TERMS: Record<TermId, TermDef> = {
  // ── Valuation & Deal ──
  trueValue: {
    id: "trueValue", group: "valuation", notMls: true,
    name: "True Value", subtitle: "What the asset is worth",
    definition:
      "Our estimate of the home's market value from comparable recent sales — independent of the asking price.",
  },
  expectedSalePrice: {
    id: "expectedSalePrice", group: "valuation", notMls: true,
    name: "Expected Sale Price", subtitle: "Likely closing price",
    definition:
      "A list-aware estimate of what this listing will likely sell for, blending its asking price with how local homes are closing versus ask. It shifts if the asking price changes.",
  },
  ourCall: {
    id: "ourCall", group: "valuation", notMls: true,
    name: "Our Call vs. The Sale", subtitle: "Our pre-sale estimate vs. result",
    definition:
      "The value our model published before the sale price was known, shown next to the actual result for transparency.",
  },
  dealScore: {
    id: "dealScore", group: "valuation", notMls: true,
    name: "Deal Score", subtitle: "0–100 deal strength",
    definition:
      "A deterministic 0–100 score that combines estimated value versus ask, cashflow, and timing signals into one comparable deal-strength grade.",
  },
  priceDrop: {
    id: "priceDrop", group: "valuation",
    name: "Price Drop", subtitle: "Total cut from peak ask",
    definition:
      "The total dollar reduction from the listing's highest ask to its current price — a seller-motivation signal.",
  },

  // ── Cashflow & Carry ──
  capRate: {
    id: "capRate", group: "cashflowCarry", notMls: true,
    name: "Cap Rate", subtitle: "Net yield on price",
    definition:
      "Estimated annual net operating income as a percentage of price — the standard income-property yield measure.",
    aka: ["Yield", "Target Gross Yield"],
  },
  grossYield: {
    id: "grossYield", group: "cashflowCarry", notMls: true,
    name: "Gross Yield", subtitle: "Gross rent ÷ price",
    definition: "Estimated annual gross rent as a percentage of price, before expenses.",
  },
  carryCost: {
    id: "carryCost", group: "cashflowCarry", notMls: true,
    name: "Carry Cost", subtitle: "Monthly cost to own",
    definition:
      "Estimated monthly cost to hold the property, itemized as mortgage, property tax, and fees.",
    aka: ["Monthly Carry"],
  },
  capitalBurn: {
    id: "capitalBurn", group: "cashflowCarry", notMls: true,
    name: "Capital Burn", subtitle: "Standardized monthly carry",
    definition:
      "A standardized estimate of the monthly cash needed to carry the property on a typical financed purchase (mortgage, taxes, fees, insurance). Use it to compare listings on equal financing terms; Carry Cost is the itemized figure for a specific deal.",
  },
  monthlyCashflow: {
    id: "monthlyCashflow", group: "cashflowCarry", notMls: true,
    name: "Monthly Cashflow", subtitle: "Rent minus carry",
    definition:
      "Estimated monthly rent minus carrying costs — positive means the property covers its own costs.",
  },

  // ── Timing & Distress ──
  trueDom: {
    id: "trueDom", group: "timingDistress", notMls: true,
    name: "True DOM", subtitle: "Real days on market",
    definition:
      "True days on market — stitched across relistings, so a property re-listed to reset its counter still shows the real elapsed time.",
    methodology:
      "We link a property's successive listing campaigns by address and stitch their durations, correcting the counter resets that consumer portals show as fresh listings.",
  },
  stale: {
    id: "stale", group: "timingDistress", notMls: true,
    name: "Stale", subtitle: "On market 90+ days",
    definition: "A listing on the market 90+ days (relist-adjusted) — often negotiable.",
  },
  fresh: {
    id: "fresh", group: "timingDistress", notMls: true,
    name: "Fresh", subtitle: "Newly listed",
    definition: "A recently listed property, by True DOM.",
  },
  alphaFlag: {
    id: "alphaFlag", group: "timingDistress", notMls: true,
    name: "Alpha Flag", subtitle: "Strongest signal on this listing",
    definition:
      "The single highest-priority investment signal we detect on a listing, surfaced in priority order: Distressed › Zoning upside › Income suite › Suite potential › Density-ready › Stale › New.",
  },

  // ── Suite & Density ──
  suitePotential: {
    id: "suitePotential", group: "suiteDensity", notMls: true,
    name: "Suite Potential", subtitle: "Possible second unit",
    definition:
      "Characteristics (e.g. a separate entrance or layout) suggest a legal secondary suite could be added. Not a guarantee — verify zoning.",
    aka: ["Duplex", "Suite / Duplex", "Duplex Candidate"],
  },
  incomeSuite: {
    id: "incomeSuite", group: "suiteDensity",
    name: "Income Suite", subtitle: "Existing second unit",
    definition: "The listing already has a second self-contained living unit.",
  },
  multiUnit: {
    id: "multiUnit", group: "suiteDensity", notMls: true,
    name: "Multi-Unit", subtitle: "Multiple dwelling units",
    definition:
      "The property contains, or strongly supports, multiple separate dwelling units.",
  },
  surplusParking: {
    id: "surplusParking", group: "suiteDensity", notMls: true,
    name: "Surplus Parking", subtitle: "Spare parking spaces",
    definition:
      "Parking spaces beyond what the unit count requires — a value and rentability signal.",
  },
  densityReady: {
    id: "densityReady", group: "suiteDensity", notMls: true,
    name: "Density Ready", subtitle: "Zoning may allow more units",
    definition:
      "Zoning and lot characteristics suggest the site may support added density (e.g. missing-middle housing). Verify with the municipality.",
    aka: ["Zoning Potential"],
  },
  listingDensity: {
    id: "listingDensity", group: "suiteDensity",
    name: "Listing Density", subtitle: "How many listings here",
    definition:
      "On the heatmap, intensity reflects the count of listings in an area. Distinct from Density Ready, which describes a single lot's zoning capacity.",
    aka: ["Density"],
  },

  // ── Market & Value-Add ──
  marketPulse: {
    id: "marketPulse", group: "market", notMls: true,
    name: "Market Pulse", subtitle: "Region price trend",
    definition:
      "Regional price and price-per-square-foot trend over time, with year-over-year movement.",
  },
  monthsOfSupply: {
    id: "monthsOfSupply", group: "market",
    name: "Months of Supply", subtitle: "How fast inventory clears",
    definition:
      "How many months it would take to sell all current listings at the recent sales pace. Low means a seller's market; high means a buyer's market.",
  },
  soldToList: {
    id: "soldToList", group: "market",
    name: "Sold / List", subtitle: "Sale price vs. ask",
    definition:
      "The ratio of sale price to asking price across recent sales. Above 100% means homes are selling over ask.",
  },
  renovationUpside: {
    id: "renovationUpside", group: "market", notMls: true,
    name: "Renovation Upside", subtitle: "Equity unlockable by renovating",
    definition:
      "An index of how much value a renovation could add relative to the home's current value, before cost.",
  },
  condoFeeStability: {
    id: "condoFeeStability", group: "market", notMls: true,
    name: "Condo Fee Stability", subtitle: "Fee-increase risk",
    definition:
      "A signal of how stable this building's condo fees have been, derived from sold condo data in the area.",
  },

  // ── Investor Lenses (personas) ──
  personaSmart: {
    id: "personaSmart", group: "personas",
    name: "Smart Homebuyer", subtitle: "Hidden value, no bidding wars",
    definition:
      "A lens tuned for buyers hunting undervalued homes, suite potential, and fair carrying costs.",
  },
  personaCashflow: {
    id: "personaCashflow", group: "personas",
    name: "Cashflow Investor", subtitle: "Maximize monthly yield",
    definition: "A lens tuned for rental income — cap rate, carry, and suite/parking upside.",
  },
  personaFlippers: {
    id: "personaFlippers", group: "personas",
    name: "Flippers & Deal Hunters", subtitle: "Buy under market, force value",
    definition: "A lens tuned for distress and timing — True DOM, price drops, and carry.",
  },
  personaBuilders: {
    id: "personaBuilders", group: "personas",
    name: "Builders & Developers", subtitle: "Land assembly & density",
    definition: "A lens tuned for lot size, frontage, and density-ready zoning.",
  },
};

export function term(id: TermId): TermDef {
  const t = TERMS[id];
  if (!t) throw new Error(`Unknown term id: ${id}`);
  return t;
}

export function termsByGroup(): Record<GlossaryGroupId, TermDef[]> {
  const out = {} as Record<GlossaryGroupId, TermDef[]>;
  for (const g of GLOSSARY_GROUPS) out[g.id] = [];
  for (const t of Object.values(TERMS)) out[t.group].push(t);
  return out;
}

export interface TipContent {
  name: string;
  subtitle: string;
  definition: string;
  notMlsLine: string | null;
  href: string;
}

export function buildTipContent(id: TermId): TipContent {
  const t = term(id);
  return {
    name: t.name,
    subtitle: t.subtitle,
    definition: t.definition,
    notMlsLine: t.notMls ? NOT_MLS_LINE : null,
    href: glossaryHref(id),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx.cmd vitest run src/lib/glossary/terms.test.ts`
Expected: PASS (all assertions green).

- [ ] **Step 5: Typecheck**

Run: `npx.cmd tsc --noEmit`
Expected: no errors in `src/lib/glossary/`.

- [ ] **Step 6: Commit**

```bash
git checkout -b feat/terminology-explainers
git add src/lib/glossary/terms.ts src/lib/glossary/terms.test.ts
git commit -m "feat(glossary): term registry — single source of truth for metric names + definitions"
```

---

## Phase 2 — `<TermTip>` component

### Task 2: The ⓘ info-tip

**Files:**
- Create: `src/components/ui/TermTip.tsx`
- Depends on: `src/components/ui/popover.tsx` (existing — click/tap to open, portals to body, closes on outside-click/Escape), `src/lib/glossary/terms.ts` (Phase 1).

> The pure tip-text logic (`buildTipContent`) is already tested in Phase 1. The component is presentational; vitest is node-env (no jsdom) so it is verified via typecheck/lint/build/manual, per project convention.

- [ ] **Step 1: Write the component**

`src/components/ui/TermTip.tsx`:

```tsx
"use client";

import * as React from "react";
import Link from "next/link";
import { Info } from "lucide-react";
import { Popover } from "@/components/ui/popover";
import { buildTipContent, type TermId } from "@/lib/glossary/terms";
import { cn } from "@/lib/utils";

interface TermTipProps {
  id: TermId;
  /** Visible label before the ⓘ. Defaults to the term's canonical name. */
  children?: React.ReactNode;
  /** Render only the ⓘ trigger — place it beside an existing title. */
  iconOnly?: boolean;
  className?: string;
}

/**
 * Branded term + an ⓘ that reveals a plain-language definition on click/tap
 * (the Popover primitive is click-to-open, which is the reliable touch gesture).
 * Use `iconOnly` to drop just the ⓘ beside a heading you don't want to wrap.
 */
export function TermTip({ id, children, iconOnly, className }: TermTipProps) {
  const tip = buildTipContent(id);
  const trigger = (
    <button
      type="button"
      aria-label={`What is ${tip.name}?`}
      className={cn(
        "inline-flex items-center gap-1 text-left align-middle",
        "text-slate-400 hover:text-slate-200 transition-colors",
        className
      )}
    >
      {!iconOnly && <span>{children ?? tip.name}</span>}
      <Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
    </button>
  );

  return (
    <Popover trigger={trigger} className="max-w-xs">
      <p className="text-sm font-semibold text-slate-100">{tip.subtitle}</p>
      <p className="mt-1 text-sm text-slate-300">{tip.definition}</p>
      {tip.notMlsLine && (
        <p className="mt-2 text-xs text-slate-500">{tip.notMlsLine}</p>
      )}
      <Link
        href={tip.href}
        className="mt-2 inline-block text-xs text-cyan-400 hover:underline"
      >
        Full definition →
      </Link>
    </Popover>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx.cmd tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Lint**

Run: `npx.cmd next lint --file src/components/ui/TermTip.tsx`
Expected: no errors (or clean per repo config).

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/TermTip.tsx
git commit -m "feat(glossary): TermTip — on-demand ⓘ explainer on the popover primitive"
```

---

## Phase 3 — Naming fixes + wire surfaces to the registry

> All edits are display-label only. No state key, persona id, filter key, color-metric id, or compare key changes — so saved Lenses (localStorage `pp_lenses`) and Market Bubbles (Supabase) keep deserializing. Verified by the safety matrix in spec §6.

### Task 3: Fix the four+one names, sourced from `term()`

**Files:**
- Modify: `src/lib/personas/personaConfig.ts` (Smart cap-rate control ~line 235; Smart `duplexCandidate` toggle ~line 239; Smart `zoningPotential` toggle ~line 238; Cashflow `duplexCandidate` toggle ~line 270)
- Modify: `src/lib/compare/compareMetricsConfig.ts` (`carry` row ~line 161)
- Modify: `src/lib/personas/mapMetrics.ts` (density metric `label`)
- Test: `src/lib/glossary/wiring.test.ts`

- [ ] **Step 1: Write the failing consistency test**

`src/lib/glossary/wiring.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { PERSONA_CONFIG } from "@/lib/personas/personaConfig";
import { COMPARE_METRICS } from "@/lib/compare/compareMetricsConfig";
import { MAP_METRICS } from "@/lib/personas/mapMetrics";
import { term } from "@/lib/glossary/terms";

const findControl = (persona: keyof typeof PERSONA_CONFIG, key: string) =>
  PERSONA_CONFIG[persona].controls.find(
    (c) => ("key" in c && c.key === key) || ("minKey" in c && c.minKey === key)
  );

describe("surface labels resolve to the registry (no drift)", () => {
  it("Smart Homebuyer cap-rate filter no longer says 'Yield'", () => {
    const c = findControl("smart", "minYield");
    expect(c?.short).toBe(term("capRate").name);
    expect(c?.label).not.toMatch(/yield/i);
  });

  it("both duplex toggles read 'Suite Potential'", () => {
    expect(findControl("smart", "duplexCandidate")?.short).toBe(term("suitePotential").name);
    expect(findControl("cashflow", "duplexCandidate")?.label).toBe(term("suitePotential").name);
  });

  it("Smart zoning toggle reads 'Density Ready'", () => {
    expect(findControl("smart", "zoningPotential")?.label).toBe(term("densityReady").name);
  });

  it("Compare carry row reads 'Carry Cost'", () => {
    expect(COMPARE_METRICS.find((m) => m.key === "carry")?.label).toBe(term("carryCost").name);
  });

  it("density map metric reads 'Listing Density'", () => {
    expect(MAP_METRICS.find((m) => m.id === "density")?.label).toBe(term("listingDensity").name);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx.cmd vitest run src/lib/glossary/wiring.test.ts`
Expected: FAIL — current labels are "Yield" / "Duplex" / "Zoning Potential" / "Monthly Carry" / "Density".

- [ ] **Step 3: Apply the renames in `personaConfig.ts`**

Add the import near the other imports at the top of `src/lib/personas/personaConfig.ts`:

```ts
import { term } from "@/lib/glossary/terms";
```

Smart Homebuyer — replace the cap-rate control (currently `short: "Yield", label: "Target Gross Yield"`):

```ts
      { kind: "slider", key: "minYield", label: `Min ${term("capRate").name}`, short: term("capRate").name, op: "≥", min: 0, max: 12, step: 0.5, format: fmtPct, field: "cap_rate_est" },
```

Smart Homebuyer — replace the zoning toggle (currently `label: "Zoning Potential", short: "Density Ready"`):

```ts
      { kind: "toggle", key: "zoningPotential", label: term("densityReady").name, short: term("densityReady").name },
```

Smart Homebuyer — replace the duplex toggle (currently `label: "Duplex Candidate", short: "Duplex"`):

```ts
      { kind: "toggle", key: "duplexCandidate", label: term("suitePotential").name, short: term("suitePotential").name },
```

Cashflow Investor — replace the duplex toggle (currently `label: "Suite / Duplex", short: "Suite / Duplex"`):

```ts
      { kind: "toggle", key: "duplexCandidate", label: term("suitePotential").name, short: term("suitePotential").name },
```

- [ ] **Step 4: Apply the rename in `compareMetricsConfig.ts`**

Add near the top imports:

```ts
import { term } from "@/lib/glossary/terms";
```

Replace the `carry` row label (currently `label: "Monthly Carry"`):

```ts
  { key: "carry", label: term("carryCost").name, group: "cashflowCarry", cellKind: "numeric",
    get: (c) => c.underwriting?.monthlyCarry ?? null, format: fmtPerMo, winner: "low" },
```

- [ ] **Step 5: Apply the rename in `mapMetrics.ts`**

Add near the top imports:

```ts
import { term } from "@/lib/glossary/terms";
```

Replace the density metric's `label: "Density"` with:

```ts
    label: term("listingDensity").name,
```

(Leave its `id: "density"` untouched — that id is persisted in saved Lenses.)

- [ ] **Step 6: Run the consistency test + full suite**

Run: `npx.cmd vitest run src/lib/glossary/wiring.test.ts`
Expected: PASS.

Run: `npx.cmd vitest run`
Expected: PASS — no existing test asserted the old "Yield"/"Density" strings; if one does, update it to the new registry name in the same commit.

- [ ] **Step 7: Typecheck**

Run: `npx.cmd tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/lib/personas/personaConfig.ts src/lib/compare/compareMetricsConfig.ts src/lib/personas/mapMetrics.ts src/lib/glossary/wiring.test.ts
git commit -m "fix(terminology): unify metric names via registry (Yield→Cap Rate, Monthly Carry→Carry Cost, Duplex/Zoning→Suite Potential/Density Ready, Density→Listing Density)"
```

---

## Phase 4 — Listing-page card explainers

### Task 4: Add `<TermTip iconOnly>` beside each card title

**Files:**
- Modify: `src/components/Property/ListingEstimateCard.tsx` (worked example below)
- Modify (same pattern, see table): `ExpectedSaleCard.tsx`, `DealScoreCard.tsx`, `SoldOutcomeCard.tsx`, `CondoFeeStabilityCard.tsx`, `ForceAppreciationCard.tsx`

The pattern: place `<TermTip iconOnly>` as a **sibling** of the title (not a child of `CardTitle`) to avoid invalid block-in-heading nesting, and source the title text from `term().name`.

- [ ] **Step 1: Wire `ListingEstimateCard.tsx` (worked example)**

Add the imports:

```tsx
import { TermTip } from "@/components/ui/TermTip";
import { term } from "@/lib/glossary/terms";
```

There are **two** `CardHeader` blocks (the `locked` branch ~line 46 and the main branch ~line 71). In **both**, replace:

```tsx
        <CardHeader>
          <CardTitle>True Value</CardTitle>
          <p className="text-xs text-muted-foreground">
            What the asset itself is worth — independent of asking price.
          </p>
        </CardHeader>
```

with:

```tsx
        <CardHeader>
          <div className="flex items-center gap-1.5">
            <CardTitle>{term("trueValue").name}</CardTitle>
            <TermTip id="trueValue" iconOnly />
          </div>
          <p className="text-xs text-muted-foreground">
            What the asset itself is worth — independent of asking price.
          </p>
        </CardHeader>
```

(The existing rich subtitle stays — it's good, listing-specific copy. The ⓘ adds the canonical definition + a "Full definition →" link to the glossary.)

- [ ] **Step 2: Apply the same pattern to the other five cards**

For each, wrap the existing title in a `flex items-center gap-1.5` div, source the title from `term(id).name`, and add `<TermTip id={id} iconOnly />`:

| File | TermId | Current title string |
|------|--------|----------------------|
| `ExpectedSaleCard.tsx` | `expectedSalePrice` | "Expected Sale Price" |
| `DealScoreCard.tsx` | `dealScore` | "Deal Score" |
| `SoldOutcomeCard.tsx` | `ourCall` | "Our Call vs. The Sale" |
| `CondoFeeStabilityCard.tsx` | `condoFeeStability` | "Condo Fee Stability" |
| `ForceAppreciationCard.tsx` | `renovationUpside` | "Renovation Upside" |

For each file add the two imports from Step 1, then apply the wrap. Example for `DealScoreCard.tsx` — replace `<CardTitle>Deal Score</CardTitle>` (and any duplicate in a locked/teaser branch) with:

```tsx
          <div className="flex items-center gap-1.5">
            <CardTitle>{term("dealScore").name}</CardTitle>
            <TermTip id="dealScore" iconOnly />
          </div>
```

> Note: some cards (e.g. `DealScoreCard`, `ExpectedSaleCard`) render their title in more than one branch (locked vs. live). Apply the wrap in **every** branch that shows the title. Grep each file for the title string to find them all, e.g. `npx.cmd vitest` is not needed here — use editor search for the literal string.

- [ ] **Step 3: Typecheck**

Run: `npx.cmd tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Lint**

Run: `npx.cmd next lint`
Expected: clean.

- [ ] **Step 5: Build**

Run: `npx.cmd next build`
Expected: build succeeds (the cards still render; `TermTip` is a client component inside already-client cards).

- [ ] **Step 6: Manual verify**

Run: `npm.cmd run dev`, open a listing page (`/properties/<id>`), confirm: each card title shows an ⓘ; clicking it opens the definition popover with a "Full definition →" link; the link navigates to `/glossary#<id>`; the popover closes on outside-click and Escape; it works on a touch viewport (DevTools device mode → tap).

- [ ] **Step 7: Commit**

```bash
git add src/components/Property/ListingEstimateCard.tsx src/components/Property/ExpectedSaleCard.tsx src/components/Property/DealScoreCard.tsx src/components/Property/SoldOutcomeCard.tsx src/components/Property/CondoFeeStabilityCard.tsx src/components/Property/ForceAppreciationCard.tsx
git commit -m "feat(listing): add TermTip explainers to property metric cards"
```

---

## Phase 5 — `/glossary` page

### Task 5: Render the registry as a public glossary

**Files:**
- Create: `src/app/(app)/glossary/page.tsx`
- Test: `src/lib/glossary/terms.test.ts` (extend — assert anchor coverage)

> The `(app)` route group gives the unified AppHeader (per the design-system note). The page is a server component (registry is static) → statically renderable and indexable.

- [ ] **Step 1: Extend the registry test for anchor coverage**

Append to `src/lib/glossary/terms.test.ts`:

```ts
import { termsByGroup as _tbg } from "./terms";

describe("glossary rendering contract", () => {
  it("every group with terms yields rows whose anchor id === term id", () => {
    const grouped = _tbg();
    for (const [groupId, rows] of Object.entries(grouped)) {
      for (const t of rows) {
        expect(t.id, `anchor for ${t.name} in ${groupId}`).toBeTruthy();
        expect(TERMS[t.id].id).toBe(t.id);
      }
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `npx.cmd vitest run src/lib/glossary/terms.test.ts`
Expected: PASS (the helper already exists from Phase 1; this pins the rendering contract).

- [ ] **Step 3: Write the glossary page**

`src/app/(app)/glossary/page.tsx`:

```tsx
import type { Metadata } from "next";
import { GLOSSARY_GROUPS, termsByGroup, NOT_MLS_LINE } from "@/lib/glossary/terms";

export const metadata: Metadata = {
  title: "Glossary — PureProperty",
  description:
    "Plain-language definitions of PureProperty's real-estate investment metrics: True DOM, Cap Rate, Carry Cost, Deal Score, Suite Potential, and more.",
};

export default function GlossaryPage() {
  const grouped = termsByGroup();
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-bold">Glossary</h1>
      <p className="mt-2 text-muted-foreground">
        What every metric on PureProperty means — and how we derive it.
      </p>

      {GLOSSARY_GROUPS.map((g) => {
        const rows = grouped[g.id];
        if (!rows || rows.length === 0) return null;
        return (
          <section key={g.id} className="mt-10">
            <h2 className="border-b pb-1 text-lg font-semibold">{g.title}</h2>
            <dl className="mt-4 space-y-6">
              {rows.map((t) => (
                <div key={t.id} id={t.id} className="scroll-mt-24">
                  <dt className="font-semibold">
                    {t.name}
                    {t.aka && t.aka.length > 0 && (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        also: {t.aka.join(", ")}
                      </span>
                    )}
                  </dt>
                  <dd className="mt-1 text-sm text-muted-foreground">{t.definition}</dd>
                  {t.methodology && (
                    <dd className="mt-1 text-sm text-muted-foreground">{t.methodology}</dd>
                  )}
                  {t.notMls && (
                    <dd className="mt-1 text-xs text-muted-foreground">{NOT_MLS_LINE}</dd>
                  )}
                </div>
              ))}
            </dl>
          </section>
        );
      })}
    </main>
  );
}
```

- [ ] **Step 4: Typecheck + build**

Run: `npx.cmd tsc --noEmit`
Expected: no errors.

Run: `npx.cmd next build`
Expected: build succeeds; `/glossary` appears as a static route in the output.

- [ ] **Step 5: Manual verify**

Run: `npm.cmd run dev`, open `/glossary`: confirm all groups render, each term has a definition, `aka` shows for renamed terms (Cap Rate "also: Yield…"), and a `TermTip`'s "Full definition →" from a listing card jumps to the right `#anchor` with `scroll-mt` offset.

- [ ] **Step 6: Commit**

```bash
git add src/app/(app)/glossary/page.tsx src/lib/glossary/terms.test.ts
git commit -m "feat(glossary): public /glossary page rendering the term registry (SEO)"
```

---

## Phase 6 — (Optional follow-up) Dense-surface inline ⓘ

> **Scoped as optional** because the same terms are already explained on their cards (Phase 4) and in the glossary (Phase 5), and the Terminal's tiny `text-[10px]` sort-button headers + interactive filter chips + persona buttons need care to host a click-popover without conflicting with their existing click behavior. Pick up when desired.

Candidate surfaces and the snag to solve first:
- **Persona selector** (`src/components/dashboard/PersonaSwitcher.tsx`): persona items are buttons that select on click — a nested ⓘ button would conflict. Solution: render the ⓘ *outside* the select button (e.g. a small `<TermTip id="personaSmart" iconOnly />` adjacent to each label), or move selection to the label and the ⓘ to a trailing slot.
- **Filter chips** (`src/components/CommandCenter/InvestorChip.tsx`): already open a Popover for their slider. Add `term(id).definition` as a one-line header inside that existing popover (no new trigger needed) — lowest-risk integration.
- **Ledger column headers** (`src/components/CommandCenter/LedgerPanel.tsx:92–129`): sortable headers are click-to-sort. Either add a non-sorting ⓘ in a trailing slot, or expose definitions only via the chips/glossary. Map each `col.type` → `TermId` (`trueDom→trueDom`, `capRate→capRate`, `yield→grossYield`, `carryCost→carryCost`, `priceDrop→priceDrop`, `suite→suitePotential`, `density→densityReady`, `alphaFlag→alphaFlag`).
- **Map color legend** (`src/components/CommandCenter/MapColorPanel.tsx`): roomy — straightforward `<TermTip>` next to each metric label.

No tasks specified here pending a decision; if pursued, each gets its own TDD-light task following the Phase 4 sibling-placement pattern.

---

## Self-Review (completed during planning)

- **Spec coverage:** Registry (§3.1)→Task 1; TermTip (§3.2)→Task 2; renames + safety (§5/§6)→Task 3; inline card subtitles + centralized notMls (§3.3/§7)→Task 4; glossary (§3.4)→Task 5; compliance (§7) honored — definitions are generic, `notMls` centralized, TermTip shows only static text. Dense-surface ⓘ (§3.2 "everywhere") is split into the optional Phase 6 with the integration snags named (honest scoping; not dropped).
- **O-1 (a):** `capitalBurn` and `carryCost` both kept; their definitions explicitly disambiguate (standardized-vs-itemized). ✓
- **Placeholder scan:** none — all code is concrete; the only deferral (Phase 6) is explicitly optional with named files/line ranges.
- **Type consistency:** `TermId`, `term()`, `buildTipContent()`, `termsByGroup()`, `GLOSSARY_GROUPS`, `NOT_MLS_LINE`, `glossaryHref()` are defined in Task 1 and used with the same signatures in Tasks 2–5. `TermTip` props (`id`, `children`, `iconOnly`, `className`) match all call sites.
- **Migration safety:** every Task 3 edit touches `label`/`short` only; keys/ids/filter strings untouched (spec §6). ✓
```
