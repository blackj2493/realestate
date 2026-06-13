# Similar Properties (For Sale + Recently Sold) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a HouseSigma-style "comparable properties" band to the bottom of the listing page — two ranked, area-scoped lists (For Sale + Recently Sold) with transparent per-card "why" labels and a per-list match-quality badge.

**Architecture:** A pure, unit-tested similarity-scoring module (`similarListings.ts`) drives one wide-net Typesense query per list (`properties` for sale, `sold_listings` for sold). A thin server endpoint scores/ranks the candidates, excludes the subject, and VOW-gates the sold half. A lazy client island below the Property History section fetches and renders two stacked horizontally-scrolling rows.

**Tech Stack:** Next.js 15 (async route params, server components), Typesense (search-only client for `properties`, admin client for `sold_listings`), Vitest (node-env, pure-logic tests), Tailwind, lucide-react.

**Spec:** `docs/superpowers/specs/2026-06-13-similar-properties-design.md`

---

## File Structure

- **Create** `src/lib/property/similarListings.ts` — pure scorer: form-family mapping, signal functions, composite scorers, ranker, match-quality classifier, "why" labels, Typesense filter builders. Zero framework imports (node-env testable).
- **Create** `src/lib/property/similarListings.test.ts` — unit tests for the above.
- **Create** `src/app/api/properties/[id]/similar/route.ts` — endpoint: two Typesense searches, JS subject-exclusion, ranking, VOW gate, JSON response.
- **Create** `src/components/Property/SoldCompCard.tsx` — sold comp card (close price, sold date, % of ask, why chip); renders a locked teaser when signed-out.
- **Create** `src/components/Property/SimilarProperties.tsx` — client island: fetch-on-mount, skeleton, two stacked rows (For Sale via `PropertyCard`, Sold via `SoldCompCard`), match badges, empty/sparse/locked states.
- **Modify** `src/app/(app)/properties/[id]/page.tsx` — mount `<SimilarProperties>` after the Property History `<section>`.

**Conventions to follow (verified in repo):**
- Typesense filter values with spaces/slashes MUST be backtick-quoted: `PropertySubType:=\`Att/Row/Townhouse\``.
- `PROPERTY_TYPE_OPTIONS` (`src/lib/dashboard/propertyTypes.ts`) holds the exact TRREB sub-type spellings incl. the trailing-space `"Semi-Detached "` — reuse it, never hardcode spellings.
- Vitest is node-env (no jsdom). Only pure logic gets unit tests; components/routes are verified via typecheck + lint + build + manual.
- Run a single test file: `npx.cmd vitest run <path>`. Windows: use `npm.cmd`/`npx.cmd`.

---

## Task 1: Form-family mapping

**Files:**
- Create: `src/lib/property/similarListings.ts`
- Test: `src/lib/property/similarListings.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/property/similarListings.test.ts
import { describe, it, expect } from "vitest";
import {
  formFamily,
  familySubtypeVariants,
  optionKeyForSubType,
} from "./similarListings";

describe("formFamily", () => {
  it("maps ground-related sub-types to 'ground'", () => {
    expect(formFamily("Detached")).toBe("ground");
    expect(formFamily("Att/Row/Townhouse")).toBe("ground");
    expect(formFamily("Link")).toBe("ground");
    expect(formFamily("Duplex")).toBe("ground");
  });
  it("handles the trailing-space Semi-Detached quirk", () => {
    expect(formFamily("Semi-Detached ")).toBe("ground");
    expect(optionKeyForSubType("Semi-Detached ")).toBe("semi");
  });
  it("maps condo apartments to 'apartment' and vacant to 'land'", () => {
    expect(formFamily("Condo Apartment")).toBe("apartment");
    expect(formFamily("Vacant Land")).toBe("land");
  });
  it("maps unknown/null to 'other'", () => {
    expect(formFamily("Houseboat")).toBe("other");
    expect(formFamily(null)).toBe("other");
  });
});

describe("familySubtypeVariants", () => {
  it("returns all ground variants for a detached subject and never crosses into apartment", () => {
    const v = familySubtypeVariants("Detached");
    expect(v).toContain("Detached");
    expect(v).toContain("Semi-Detached "); // trailing space preserved
    expect(v).toContain("Condo Townhouse");
    expect(v).not.toContain("Condo Apartment");
  });
  it("returns only the apartment variants for a condo subject", () => {
    const v = familySubtypeVariants("Condo Apartment");
    expect(v).toContain("Condo Apartment");
    expect(v).not.toContain("Detached");
  });
  it("returns just the raw sub-type for an unmapped 'other' subject", () => {
    expect(familySubtypeVariants("Houseboat")).toEqual(["Houseboat"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx.cmd vitest run src/lib/property/similarListings.test.ts`
Expected: FAIL — cannot resolve `./similarListings`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/property/similarListings.ts
/**
 * Similar-listings similarity scoring — pure, deterministic, node-env testable.
 *
 * Drives the listing page's "comparable properties" band. Two lists relax in
 * opposite orders (buyer browse vs appraiser comps); see
 * docs/superpowers/specs/2026-06-13-similar-properties-design.md. No framework
 * imports — keep it pure so vitest (node-env) can test it directly.
 */
import { PROPERTY_TYPE_OPTIONS } from "@/lib/dashboard/propertyTypes";

export type FormFamily = "ground" | "apartment" | "land" | "other";

const GROUND_KEYS = new Set(["detached", "semi", "town", "link", "multiplex"]);
const APARTMENT_KEYS = new Set(["condo"]);
const LAND_KEYS = new Set(["vacant"]);

// Exact PropertySubType spelling -> option key (handles trailing-space variants).
const SUBTYPE_TO_KEY = new Map<string, string>();
for (const opt of PROPERTY_TYPE_OPTIONS) {
  for (const v of opt.variants) SUBTYPE_TO_KEY.set(v, opt.key);
}

/** The PROPERTY_TYPE_OPTIONS key for a raw sub-type spelling, or null if unmapped. */
export function optionKeyForSubType(subType: string | null): string | null {
  if (!subType) return null;
  return SUBTYPE_TO_KEY.get(subType) ?? null;
}

/** Map a sub-type to its form family. The family is the hard wall we never cross. */
export function formFamily(subType: string | null): FormFamily {
  const key = optionKeyForSubType(subType);
  if (!key) return "other";
  if (GROUND_KEYS.has(key)) return "ground";
  if (APARTMENT_KEYS.has(key)) return "apartment";
  if (LAND_KEYS.has(key)) return "land";
  return "other";
}

/** Every exact sub-type spelling in the subject's family (for the Typesense OR-clause).
 *  'other' (unmapped) returns just the raw sub-type so we only match identical spellings. */
export function familySubtypeVariants(subType: string | null): string[] {
  const fam = formFamily(subType);
  if (fam === "other") return subType ? [subType] : [];
  const keys = fam === "ground" ? GROUND_KEYS : fam === "apartment" ? APARTMENT_KEYS : LAND_KEYS;
  const out: string[] = [];
  for (const opt of PROPERTY_TYPE_OPTIONS) {
    if (keys.has(opt.key)) for (const v of opt.variants) if (!out.includes(v)) out.push(v);
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx.cmd vitest run src/lib/property/similarListings.test.ts`
Expected: PASS (3 describe blocks, all green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/property/similarListings.ts src/lib/property/similarListings.test.ts
git commit -m "feat(similar): form-family mapping for comparable listings"
```

---

## Task 2: Similarity signal functions

**Files:**
- Modify: `src/lib/property/similarListings.ts`
- Test: `src/lib/property/similarListings.test.ts`

- [ ] **Step 1: Write the failing test (append to the test file)**

```ts
import {
  bedScore,
  priceScore,
  sizeScore,
  regionScore,
  subtypeScore,
  recencyScore,
} from "./similarListings";

describe("bedScore (asymmetric — bigger preferred over smaller)", () => {
  it("peaks at an exact match", () => {
    expect(bedScore(3, 3)).toBe(1);
  });
  it("prefers +1 bed over -1 bed", () => {
    expect(bedScore(3, 4)).toBeGreaterThan(bedScore(3, 2));
  });
  it("decays toward a floor for big gaps", () => {
    expect(bedScore(3, 6)).toBeLessThanOrEqual(0.1);
  });
});

describe("priceScore / sizeScore", () => {
  it("priceScore peaks when equal, 0 at >=50% off", () => {
    expect(priceScore(1_000_000, 1_000_000)).toBe(1);
    expect(priceScore(1_000_000, 1_500_000)).toBe(0);
  });
  it("sizeScore is neutral (0.5) when either area is missing", () => {
    expect(sizeScore(0, 1500)).toBe(0.5);
    expect(sizeScore(1500, 0)).toBe(0.5);
  });
  it("sizeScore peaks when equal", () => {
    expect(sizeScore(1500, 1500)).toBe(1);
  });
});

describe("regionScore / subtypeScore", () => {
  it("rewards same CityRegion over same-city-only", () => {
    expect(regionScore("Bram East", "Bram East")).toBe(1);
    expect(regionScore("Bram East", "Bram West")).toBe(0.4);
  });
  it("treats same option key as an exact sub-type match (trailing space)", () => {
    expect(subtypeScore("Semi-Detached", "Semi-Detached ")).toBe(1);
    expect(subtypeScore("Detached", "Condo Townhouse")).toBe(0.5);
  });
});

describe("recencyScore", () => {
  it("ranks fresher sales higher", () => {
    expect(recencyScore(10)).toBeGreaterThan(recencyScore(60));
    expect(recencyScore(60)).toBeGreaterThan(recencyScore(150));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx.cmd vitest run src/lib/property/similarListings.test.ts`
Expected: FAIL — `bedScore` (and siblings) not exported.

- [ ] **Step 3: Write minimal implementation (append to `similarListings.ts`)**

```ts
/** Asymmetric bed closeness: exact best, then +1 over -1, decaying to a floor. */
export function bedScore(subjectBeds: number, candBeds: number): number {
  const d = candBeds - subjectBeds;
  if (d === 0) return 1;
  if (d === 1) return 0.85;
  if (d === 2) return 0.6;
  if (d === -1) return 0.6;
  if (d === -2) return 0.3;
  return 0.1;
}

/** Linear price closeness, 1 at equal, 0 at >=50% delta. Neutral if either is <=0. */
export function priceScore(subjectPrice: number, candPrice: number): number {
  if (subjectPrice <= 0 || candPrice <= 0) return 0.5;
  const rel = Math.abs(candPrice - subjectPrice) / subjectPrice;
  return Math.max(0, 1 - rel / 0.5);
}

/** Size closeness; neutral 0.5 when either area is missing (feed has ~0% exact sqft). */
export function sizeScore(subjectArea: number, candArea: number): number {
  if (subjectArea <= 0 || candArea <= 0) return 0.5;
  const rel = Math.abs(candArea - subjectArea) / subjectArea;
  return Math.max(0, 1 - rel / 0.5);
}

/** 1 for same CityRegion, 0.4 for same-city-only (neighbourhood-first ranking). */
export function regionScore(subjectRegion: string | null, candRegion: string | null): number {
  if (subjectRegion && candRegion && subjectRegion === candRegion) return 1;
  return 0.4;
}

/** 1 when sub-types share an option key (Detached==Detached), else 0.5 (same family). */
export function subtypeScore(subjectSubType: string | null, candSubType: string | null): number {
  const a = optionKeyForSubType(subjectSubType);
  const b = optionKeyForSubType(candSubType);
  if (a && b && a === b) return 1;
  return 0.5;
}

/** Recency of a sold comp by days since contract date. */
export function recencyScore(daysAgo: number): number {
  if (daysAgo <= 30) return 1;
  if (daysAgo <= 90) return 0.8;
  if (daysAgo <= 180) return 0.5;
  return 0.3;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx.cmd vitest run src/lib/property/similarListings.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/property/similarListings.ts src/lib/property/similarListings.test.ts
git commit -m "feat(similar): similarity signal functions (beds/price/size/region/subtype/recency)"
```

---

## Task 3: Composite scorers, ranker, match-quality, why-labels

**Files:**
- Modify: `src/lib/property/similarListings.ts`
- Test: `src/lib/property/similarListings.test.ts`

- [ ] **Step 1: Write the failing test (append)**

```ts
import {
  scoreForSale,
  scoreSold,
  rankSimilar,
  classifyMatchQuality,
  buildWhyLabel,
  type SubjectAttrs,
  type CandidateAttrs,
} from "./similarListings";

const SUBJECT: SubjectAttrs = {
  id: "SUBJ",
  cityRegion: "Bram East",
  city: "Brampton",
  subType: "Detached",
  beds: 3,
  listPrice: 1_000_000,
  area: 1800,
};

const cand = (over: Partial<CandidateAttrs>): CandidateAttrs => ({
  cityRegion: "Bram East",
  subType: "Detached",
  beds: 3,
  price: 1_000_000,
  area: 1800,
  ...over,
});

describe("scoreForSale", () => {
  it("ranks a same-neighbourhood match above a same-city-only one", () => {
    expect(scoreForSale(SUBJECT, cand({}))).toBeGreaterThan(
      scoreForSale(SUBJECT, cand({ cityRegion: "Bram West" }))
    );
  });
});

describe("scoreSold ignores price (it is the answer, not a filter)", () => {
  it("gives identical scores regardless of the comp's close price", () => {
    const a = scoreSold(SUBJECT, cand({ price: 500_000, daysAgo: 10 }));
    const b = scoreSold(SUBJECT, cand({ price: 2_000_000, daysAgo: 10 }));
    expect(a).toBe(b);
  });
});

describe("rankSimilar", () => {
  it("sorts by score desc, caps at the limit, and tags exact flags + why", () => {
    const items = [
      cand({ cityRegion: "Bram West", beds: 1 }), // weak
      cand({}), // perfect
      cand({ cityRegion: "Bram East", beds: 4 }), // strong
    ];
    const ranked = rankSimilar(SUBJECT, items, (c) => c, "sale", 2);
    expect(ranked).toHaveLength(2);
    expect(ranked[0].score).toBeGreaterThanOrEqual(ranked[1].score);
    expect(ranked[0].regionExact).toBe(true);
    expect(ranked[0].subtypeExact).toBe(true);
    expect(ranked[0].why).toContain("Same neighbourhood");
  });
});

describe("classifyMatchQuality", () => {
  it("returns none/sparse/partial/close by count and strength", () => {
    expect(classifyMatchQuality([])).toBe("none");
    expect(
      classifyMatchQuality([{ regionExact: true, subtypeExact: true }])
    ).toBe("sparse");
    const strong = Array.from({ length: 4 }, () => ({ regionExact: true, subtypeExact: true }));
    expect(classifyMatchQuality(strong)).toBe("close");
    const weak = Array.from({ length: 4 }, () => ({ regionExact: false, subtypeExact: false }));
    expect(classifyMatchQuality(weak)).toBe("partial");
  });
});

describe("buildWhyLabel", () => {
  it("labels a sold comp with neighbourhood, form, and recency", () => {
    const label = buildWhyLabel(SUBJECT, cand({ cityRegion: "Bram West", beds: 4, daysAgo: 22 }), "sold");
    expect(label).toBe("Nearby in Brampton · 4bd Detached · sold 22d ago");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx.cmd vitest run src/lib/property/similarListings.test.ts`
Expected: FAIL — composite functions/types not exported.

- [ ] **Step 3: Write minimal implementation (append)**

```ts
export type MatchTier = "close" | "partial" | "sparse" | "none";
export type SimilarKind = "sale" | "sold";

/** The subject listing's match attributes (its own public fields, from the page). */
export interface SubjectAttrs {
  id: string;
  cityRegion: string | null;
  city: string | null;
  subType: string | null;
  beds: number;
  listPrice: number;
  area: number; // BuildingAreaTotal, 0 when unknown
}

/** A candidate comp's attributes (mapped from a Typesense doc by the route). */
export interface CandidateAttrs {
  cityRegion: string | null;
  subType: string | null;
  beds: number;
  price: number; // ListPrice (sale) or ClosePrice (sold)
  area: number; // 0 when unknown
  daysAgo?: number; // sold only
}

export interface RankedSimilar<T> {
  item: T;
  score: number;
  why: string;
  regionExact: boolean;
  subtypeExact: boolean;
}

// Weights — buyer browse keeps location/price; appraiser comps drop price, weight recency+size.
export function scoreForSale(s: SubjectAttrs, c: CandidateAttrs): number {
  return (
    30 * regionScore(s.cityRegion, c.cityRegion) +
    20 * subtypeScore(s.subType, c.subType) +
    20 * bedScore(s.beds, c.beds) +
    20 * priceScore(s.listPrice, c.price) +
    10 * sizeScore(s.area, c.area)
  );
}

export function scoreSold(s: SubjectAttrs, c: CandidateAttrs): number {
  return (
    20 * regionScore(s.cityRegion, c.cityRegion) +
    20 * subtypeScore(s.subType, c.subType) +
    15 * bedScore(s.beds, c.beds) +
    20 * sizeScore(s.area, c.area) +
    25 * recencyScore(c.daysAgo ?? 999)
  );
}

const KEY_TO_LABEL = new Map(PROPERTY_TYPE_OPTIONS.map((o) => [o.key, o.label]));

/** Human-readable reason a candidate is comparable (drives the per-card chip). */
export function buildWhyLabel(s: SubjectAttrs, c: CandidateAttrs, kind: SimilarKind): string {
  const region =
    regionScore(s.cityRegion, c.cityRegion) === 1
      ? "Same neighbourhood"
      : s.city
        ? `Nearby in ${s.city}`
        : "Nearby";
  const key = optionKeyForSubType(c.subType);
  const typeLabel = key ? KEY_TO_LABEL.get(key) ?? "" : "";
  const form = [c.beds > 0 ? `${c.beds}bd` : "", typeLabel].filter(Boolean).join(" ");
  let label = [region, form].filter(Boolean).join(" · ");
  if (kind === "sold" && c.daysAgo != null && c.daysAgo >= 0) {
    label += ` · sold ${Math.round(c.daysAgo)}d ago`;
  }
  return label;
}

/** Score + sort + cap candidates, tagging each with its why-label and exact flags. */
export function rankSimilar<T>(
  subject: SubjectAttrs,
  items: T[],
  toAttrs: (t: T) => CandidateAttrs,
  kind: SimilarKind,
  limit = 8
): RankedSimilar<T>[] {
  const scorer = kind === "sale" ? scoreForSale : scoreSold;
  return items
    .map((item) => {
      const c = toAttrs(item);
      return {
        item,
        score: scorer(subject, c),
        why: buildWhyLabel(subject, c, kind),
        regionExact: regionScore(subject.cityRegion, c.cityRegion) === 1,
        subtypeExact: subtypeScore(subject.subType, c.subType) === 1,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Tier the list's match strength: drives the header badge + honest-stop note. */
export function classifyMatchQuality(
  ranked: Array<{ regionExact: boolean; subtypeExact: boolean }>
): MatchTier {
  const n = ranked.length;
  if (n === 0) return "none";
  if (n <= 3) return "sparse";
  const strong = ranked.slice(0, 4).filter((r) => r.regionExact && r.subtypeExact).length;
  return strong >= 2 ? "close" : "partial";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx.cmd vitest run src/lib/property/similarListings.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/property/similarListings.ts src/lib/property/similarListings.test.ts
git commit -m "feat(similar): composite scorers, ranker, match-quality tiers, why-labels"
```

---

## Task 4: Typesense filter builders (the family wall)

**Files:**
- Modify: `src/lib/property/similarListings.ts`
- Test: `src/lib/property/similarListings.test.ts`

- [ ] **Step 1: Write the failing test (append)**

```ts
import { buildForSaleSimilarFilter, buildSoldSimilarFilter } from "./similarListings";

describe("buildForSaleSimilarFilter", () => {
  it("scopes to For Sale + city + the subject's family only (no cross-family)", () => {
    const f = buildForSaleSimilarFilter(SUBJECT);
    expect(f).toContain("TransactionType:=`For Sale`");
    expect(f).toContain("City:=`Brampton`");
    expect(f).toContain("PropertySubType:=`Detached`");
    expect(f).toContain("PropertySubType:=`Condo Townhouse`");
    expect(f).not.toContain("Condo Apartment"); // family wall
  });
});

describe("buildSoldSimilarFilter", () => {
  it("scopes to sold + price floor + window + city + family", () => {
    const NOW = 1_700_000_000_000;
    const f = buildSoldSimilarFilter(SUBJECT, 180, NOW);
    expect(f).toContain("DealType:=sold");
    expect(f).toContain("ClosePrice:>=1");
    expect(f).toContain(`PurchaseContractDate:<=${NOW}`);
    expect(f).toContain(`PurchaseContractDate:>=${NOW - 180 * 86_400_000}`);
    expect(f).toContain("PropertySubType:=`Detached`");
    expect(f).not.toContain("Condo Apartment");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx.cmd vitest run src/lib/property/similarListings.test.ts`
Expected: FAIL — filter builders not exported.

- [ ] **Step 3: Write minimal implementation (append)**

```ts
const DAY_MS = 86_400_000;

/** Backtick-quote a Typesense filter value (strip embedded backticks). */
function bq(v: string): string {
  return `\`${v.replace(/`/g, "")}\``;
}

/** OR-clause over the subject family's exact sub-type spellings, or "" if none. */
function familyClause(subType: string | null): string {
  const variants = familySubtypeVariants(subType);
  if (variants.length === 0) return "";
  return `(${variants.map((v) => `PropertySubType:=${bq(v)}`).join(" || ")})`;
}

/** Wide-net For-Sale filter: active + city floor + family wall. (Subject excluded in JS.) */
export function buildForSaleSimilarFilter(s: SubjectAttrs): string {
  const clauses: string[] = ["TransactionType:=`For Sale`"];
  if (s.city) clauses.push(`City:=${bq(s.city)}`);
  const fam = familyClause(s.subType);
  if (fam) clauses.push(fam);
  return clauses.join(" && ");
}

/** Wide-net Sold filter: sold + price floor + window + city floor + family wall.
 *  `nowMs` is injected (not Date.now()) so the output is deterministic for tests. */
export function buildSoldSimilarFilter(s: SubjectAttrs, windowDays: number, nowMs: number): string {
  const cutoff = Math.floor(nowMs - windowDays * DAY_MS);
  const clauses: string[] = [
    "DealType:=sold",
    "ClosePrice:>=1",
    `PurchaseContractDate:>=${cutoff}`,
    `PurchaseContractDate:<=${nowMs}`,
  ];
  if (s.city) clauses.push(`(City:=${bq(s.city)} || CityRegion:=${bq(s.city)})`);
  const fam = familyClause(s.subType);
  if (fam) clauses.push(fam);
  return clauses.join(" && ");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx.cmd vitest run src/lib/property/similarListings.test.ts`
Expected: PASS (full file green).

- [ ] **Step 5: Typecheck + lint the module**

Run: `npm.cmd run typecheck` then `npm.cmd run lint`
Expected: no errors in `similarListings.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/property/similarListings.ts src/lib/property/similarListings.test.ts
git commit -m "feat(similar): Typesense filter builders enforcing the form-family wall"
```

---

## Task 5: API endpoint

**Files:**
- Create: `src/app/api/properties/[id]/similar/route.ts`

- [ ] **Step 1: Write the route**

```ts
// src/app/api/properties/[id]/similar/route.ts
/**
 * GET /api/properties/[id]/similar
 *
 * Two area-scoped comparable lists for the listing page's "comparable properties"
 * band: For Sale (IDX, `properties` collection, ungated) and Recently Sold (VOW,
 * `sold_listings`, gated). Subject match attributes arrive as query params (the
 * subject's own public fields, already on the page) so the endpoint is
 * status-agnostic — a sold/delisted subject may be purged from `properties`.
 *
 * Compliance: sold rows are VOW Listing Information — anonymous users get the
 * count but ZERO rows (rows discarded server-side, like /api/market/activity/sold).
 * Brokerage rides every For-Sale card. Ranking is deterministic (no LLM, §4).
 */
import { NextRequest, NextResponse } from "next/server";
import Typesense, { Client } from "typesense";
import { getTypesenseClient } from "@/lib/typesense/client";
import { getConsumer } from "@/lib/auth/requireConsumer";
import { SOLD_LISTINGS_COLLECTION } from "@/lib/typesense/soldListingsSchema";
import { mapSoldDoc } from "@/app/api/market/activity/sold/soldMapper";
import {
  buildForSaleSimilarFilter,
  buildSoldSimilarFilter,
  rankSimilar,
  classifyMatchQuality,
  type SubjectAttrs,
  type CandidateAttrs,
  type MatchTier,
  type RankedSimilar,
} from "@/lib/property/similarListings";

export const dynamic = "force-dynamic";

const FORSALE_COLLECTION = "properties";
const CANDIDATE_FETCH = 80;
const RESULT_LIMIT = 8;
const SOLD_WINDOW_DAYS = 180;
const FORSALE_FIELDS =
  "id,ListPrice,UnparsedAddress,City,CityRegion,PropertySubType,BedroomsTotal,BathroomsTotalInteger,ParkingTotal,ListOfficeName,primaryImageUrl,RawImages,calculatedDOM";

const TYPESENSE_HOST = "9uyapwh6e5qmvl34p-1.a1.typesense.net";
const TYPESENSE_PORT = 443;

let soldClient: Client | null = null;
function getSoldClient(): Client {
  if (!soldClient) {
    const key = process.env.TYPESENSE_ADMIN_API_KEY;
    if (!key) throw new Error("TYPESENSE_ADMIN_API_KEY is not set");
    soldClient = new Typesense.Client({
      nodes: [{ host: TYPESENSE_HOST, port: TYPESENSE_PORT, protocol: "https" }],
      apiKey: key,
      connectionTimeoutSeconds: 10,
    });
  }
  return soldClient;
}

export interface SimilarForSaleCard {
  id: string;
  address: string;
  city: string | null;
  price: number;
  beds: number;
  baths: number;
  propertySubType: string | null;
  brokerage: string | null;
  thumb: string | null;
  daysOnMarket: number | null;
  why: string;
}

export interface SimilarSoldCard {
  id: string;
  address: string;
  city: string | null;
  closePrice: number;
  listPrice: number | null;
  soldDate: string | null;
  beds: number | null;
  baths: number | null;
  propertySubType: string | null;
  brokerage: string | null;
  thumb: string | null;
  pctOfAsk: number | null;
  why: string;
}

type Doc = Record<string, unknown>;
const numField = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);

function forSaleAttrs(d: Doc): CandidateAttrs {
  return {
    cityRegion: (d.CityRegion as string) || null,
    subType: (d.PropertySubType as string) || null,
    beds: numField(d.BedroomsTotal),
    price: numField(d.ListPrice),
    area: 0, // BuildingAreaTotal is not reliably present on the active index → neutral
  };
}

function soldAttrs(d: Doc, nowMs: number): CandidateAttrs {
  const ms = Number(d.PurchaseContractDate);
  const daysAgo = Number.isFinite(ms) && ms > 0 ? (nowMs - ms) / 86_400_000 : 999;
  return {
    cityRegion: (d.CityRegion as string) || null,
    subType: (d.PropertySubType as string) || null,
    beds: numField(d.BedroomsTotal),
    price: numField(d.ClosePrice),
    area: numField(d.BuildingAreaTotal),
    daysAgo,
  };
}

function toForSaleCard(r: RankedSimilar<Doc>): SimilarForSaleCard {
  const d = r.item;
  const imgs = Array.isArray(d.RawImages) ? (d.RawImages as string[]) : [];
  return {
    id: String(d.id),
    address: (d.UnparsedAddress as string) || "",
    city: (d.City as string) || null,
    price: numField(d.ListPrice),
    beds: numField(d.BedroomsTotal),
    baths: numField(d.BathroomsTotalInteger),
    propertySubType: (d.PropertySubType as string) || null,
    brokerage: (d.ListOfficeName as string) || null,
    thumb: (d.primaryImageUrl as string) || imgs[0] || null,
    daysOnMarket: Number.isFinite(Number(d.calculatedDOM)) ? Number(d.calculatedDOM) : null,
    why: r.why,
  };
}

function toSoldCard(r: RankedSimilar<Doc>): SimilarSoldCard {
  const m = mapSoldDoc(r.item);
  const pctOfAsk = m.listPrice && m.listPrice > 0 ? (m.closePrice / m.listPrice) * 100 : null;
  return {
    id: m.id,
    address: m.address,
    city: m.city,
    closePrice: m.closePrice,
    listPrice: m.listPrice,
    soldDate: m.soldDate,
    beds: m.beds,
    baths: m.baths,
    propertySubType: m.propertySubType,
    brokerage: m.brokerage,
    thumb: m.primaryImageUrl,
    pctOfAsk,
    why: r.why,
  };
}

const numParam = (v: string | null): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sp = new URL(req.url).searchParams;
  const subject: SubjectAttrs = {
    id,
    cityRegion: (sp.get("cityRegion") || "").trim() || null,
    city: (sp.get("city") || "").trim() || null,
    subType: (sp.get("subType") || "").trim() || null,
    beds: numParam(sp.get("beds")),
    listPrice: numParam(sp.get("listPrice")),
    area: numParam(sp.get("area")),
  };

  // ── For Sale (IDX, ungated) ──
  let forSale: SimilarForSaleCard[] = [];
  let forSaleTier: MatchTier = "none";
  try {
    const res = await getTypesenseClient()
      .collections(FORSALE_COLLECTION)
      .documents()
      .search({
        q: "*",
        query_by: "City",
        filter_by: buildForSaleSimilarFilter(subject),
        per_page: CANDIDATE_FETCH,
        page: 1,
        include_fields: FORSALE_FIELDS,
      });
    const docs = (res.hits ?? [])
      .map((h) => h.document as Doc)
      .filter((d) => String(d.id) !== id);
    const ranked = rankSimilar<Doc>(subject, docs, forSaleAttrs, "sale", RESULT_LIMIT);
    forSale = ranked.map(toForSaleCard);
    forSaleTier = classifyMatchQuality(ranked);
  } catch (e) {
    console.error("[properties/similar] forSale", e instanceof Error ? e.message : e);
  }

  // ── Sold (VOW, gated) ──
  const { isConsumer } = await getConsumer();
  let sold: SimilarSoldCard[] = [];
  let soldTier: MatchTier = "none";
  let soldCount = 0;
  try {
    const nowMs = Date.now();
    const res = await getSoldClient()
      .collections(SOLD_LISTINGS_COLLECTION)
      .documents()
      .search({
        q: "*",
        query_by: "UnparsedAddress",
        filter_by: buildSoldSimilarFilter(subject, SOLD_WINDOW_DAYS, nowMs),
        sort_by: "PurchaseContractDate:desc",
        per_page: CANDIDATE_FETCH,
        page: 1,
      });
    soldCount = res.found ?? 0;
    if (isConsumer) {
      const docs = (res.hits ?? [])
        .map((h) => h.document as Doc)
        .filter((d) => String(d.id) !== id);
      const ranked = rankSimilar<Doc>(subject, docs, (d) => soldAttrs(d, nowMs), "sold", RESULT_LIMIT);
      sold = ranked.map(toSoldCard);
      soldTier = classifyMatchQuality(ranked);
    }
  } catch (e) {
    console.error("[properties/similar] sold", e instanceof Error ? e.message : e);
  }

  return NextResponse.json({
    forSale,
    sold,
    soldLocked: !isConsumer,
    soldCount,
    matchQuality: { forSale: forSaleTier, sold: soldTier },
    area: { cityRegion: subject.cityRegion, city: subject.city },
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `npm.cmd run typecheck`
Expected: no errors. (If `res.hits`/`document` typing complains, the `as Doc` casts above already narrow it.)

- [ ] **Step 3: Lint**

Run: `npm.cmd run lint`
Expected: no errors in the new route.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/properties/[id]/similar/route.ts
git commit -m "feat(similar): /api/properties/[id]/similar endpoint (for-sale + VOW-gated sold)"
```

---

## Task 6: SoldCompCard component

**Files:**
- Create: `src/components/Property/SoldCompCard.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/Property/SoldCompCard.tsx
"use client";

import Link from "next/link";
import { Bed, Bath, Lock } from "lucide-react";
import { formatPrice } from "@/lib/utils";
import { ListingThumbnail } from "@/components/listing/ListingThumbnail";
import type { SimilarSoldCard } from "@/app/api/properties/[id]/similar/route";

function fmtSoldDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" });
}

/** A single recently-sold comp. `locked` (anonymous) blurs the VOW numbers. */
export function SoldCompCard({ card, locked }: { card: SimilarSoldCard; locked?: boolean }) {
  if (locked) {
    return (
      <Link
        href="/login"
        className="block w-[260px] shrink-0 overflow-hidden rounded-lg border border-slate-800 bg-slate-900/50"
      >
        <div className="relative aspect-[4/3] bg-slate-800/60">
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-slate-400">
            <Lock className="h-5 w-5" />
            <span className="text-xs">Sign in for sold price</span>
          </div>
        </div>
        <div className="space-y-1 p-3">
          <div className="h-5 w-24 rounded bg-slate-800" />
          <div className="h-3 w-32 rounded bg-slate-800/70" />
        </div>
      </Link>
    );
  }

  return (
    <Link
      href={`/properties/${card.id}`}
      className="group block w-[260px] shrink-0 overflow-hidden rounded-lg border border-slate-800 bg-slate-900/50 transition-colors hover:border-slate-700"
    >
      <div className="relative aspect-[4/3]">
        <ListingThumbnail
          src={card.thumb}
          alt={card.address}
          className="absolute inset-0"
          imgClassName="group-hover:scale-105 transition-transform duration-300"
          sizes="260px"
        />
        <span className="absolute left-2 top-2 rounded bg-rose-500/90 px-2 py-0.5 font-mono text-[10px] font-bold tracking-wider text-white">
          SOLD{card.soldDate ? ` ${fmtSoldDate(card.soldDate)}` : ""}
        </span>
      </div>
      <div className="p-3">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-lg font-bold text-emerald-400">
            {formatPrice(card.closePrice)}
          </span>
          {card.pctOfAsk != null && (
            <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-300">
              {card.pctOfAsk.toFixed(0)}% of ask
            </span>
          )}
        </div>
        <p className="mt-1 line-clamp-1 text-sm font-medium text-slate-200">{card.address}</p>
        <div className="mt-1 flex items-center gap-3 text-xs text-slate-400">
          {card.beds != null && card.beds > 0 && (
            <span className="flex items-center gap-1">
              <Bed className="h-3 w-3" />
              {card.beds}
            </span>
          )}
          {card.baths != null && card.baths > 0 && (
            <span className="flex items-center gap-1">
              <Bath className="h-3 w-3" />
              {card.baths}
            </span>
          )}
        </div>
        {/* Brokerage — same text size as the details above (TRREB §6.3(c)). */}
        <p className="mt-2 text-xs text-slate-500">Listed by {card.brokerage || "Unknown"}</p>
        <p className="mt-1 text-[11px] text-cyan-300/80">{card.why}</p>
      </div>
    </Link>
  );
}
```

- [ ] **Step 2: Verify the thumbnail import path**

Run: `npx.cmd tsc --noEmit`
Expected: no errors. If `ListingThumbnail` is a default export, change to `import ListingThumbnail from "..."`. (Confirm by opening `src/components/listing/ListingThumbnail.tsx` — `PropertyCard.tsx` imports it as a named export, so the named import above should match.)

- [ ] **Step 3: Commit**

```bash
git add src/components/Property/SoldCompCard.tsx
git commit -m "feat(similar): SoldCompCard with locked VOW teaser"
```

---

## Task 7: SimilarProperties client island

**Files:**
- Create: `src/components/Property/SimilarProperties.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/Property/SimilarProperties.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PropertyCard, type PropertyCardData } from "@/components/PropertyCard";
import { SoldCompCard } from "@/components/Property/SoldCompCard";
import type {
  SimilarForSaleCard,
  SimilarSoldCard,
} from "@/app/api/properties/[id]/similar/route";
import type { MatchTier } from "@/lib/property/similarListings";

interface SimilarResponse {
  forSale: SimilarForSaleCard[];
  sold: SimilarSoldCard[];
  soldLocked: boolean;
  soldCount: number;
  matchQuality: { forSale: MatchTier; sold: MatchTier };
  area: { cityRegion: string | null; city: string | null };
}

interface Props {
  subjectId: string;
  cityRegion: string | null;
  city: string | null;
  subType: string | null;
  beds: number;
  baths: number;
  listPrice: number;
  area: number;
}

const TIER_BADGE: Record<MatchTier, { label: string; cls: string } | null> = {
  close: { label: "Close comparables", cls: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20" },
  partial: { label: "Few exact matches", cls: "text-amber-400 bg-amber-400/10 border-amber-400/20" },
  sparse: { label: "Limited activity", cls: "text-slate-400 bg-slate-700/30 border-slate-700" },
  none: null,
};

function Badge({ tier }: { tier: MatchTier }) {
  const b = TIER_BADGE[tier];
  if (!b) return null;
  return (
    <span className={`rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${b.cls}`}>
      {b.label}
    </span>
  );
}

function toCardData(c: SimilarForSaleCard): PropertyCardData {
  return {
    id: c.id,
    listingId: c.id,
    address: c.address,
    city: c.city ?? "",
    price: c.price,
    propertyType: c.propertySubType ?? "",
    bedrooms: c.beds,
    bathrooms: c.baths,
    brokerage: c.brokerage ?? undefined,
    photoUrl: c.thumb,
    daysOnMarket: c.daysOnMarket ?? undefined,
  };
}

function Row({ title, children, badge, action }: {
  title: string;
  badge: MatchTier;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-6">
      <div className="mb-3 flex items-center gap-3">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-200">{title}</h3>
        <Badge tier={badge} />
        <span className="ml-auto">{action}</span>
      </div>
      <div className="flex gap-4 overflow-x-auto pb-2">{children}</div>
    </div>
  );
}

export default function SimilarProperties(props: Props) {
  const { subjectId, cityRegion, city, subType, beds, baths, listPrice, area } = props;
  const [data, setData] = useState<SimilarResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const qs = new URLSearchParams({
      cityRegion: cityRegion ?? "",
      city: city ?? "",
      subType: subType ?? "",
      beds: String(beds),
      baths: String(baths),
      listPrice: String(listPrice),
      area: String(area),
    });
    setLoading(true);
    fetch(`/api/properties/${subjectId}/similar?${qs.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (alive) setData(j);
      })
      .catch(() => {
        if (alive) setData(null);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [subjectId, cityRegion, city, subType, beds, baths, listPrice, area]);

  if (loading) {
    return (
      <section className="mt-8">
        <div className="mb-3 h-4 w-48 rounded bg-slate-800" />
        <div className="flex gap-4 overflow-hidden">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-64 w-[260px] shrink-0 animate-pulse rounded-lg bg-slate-900/60" />
          ))}
        </div>
      </section>
    );
  }

  if (!data) return null;

  const areaName = data.area.cityRegion || data.area.city || "this area";
  const cityName = data.area.city;
  const hasSold = data.sold.length > 0 || (data.soldLocked && data.soldCount > 0);
  const hasForSale = data.forSale.length > 0;
  if (!hasForSale && !hasSold) return null;

  const seeAll = cityName ? (
    <Link href={`/properties?city=${encodeURIComponent(cityName)}`} className="text-xs text-cyan-400 hover:text-cyan-300">
      See all in {cityName} →
    </Link>
  ) : null;

  return (
    <section className="mt-8 border-t border-slate-800 pt-6">
      <h2 className="mb-4 text-lg font-bold text-slate-100">Comparable Properties</h2>

      {/* For Sale */}
      {hasForSale ? (
        <Row title={`For Sale in ${areaName}`} badge={data.matchQuality.forSale} action={seeAll}>
          {data.forSale.map((c) => (
            <div key={c.id} className="w-[260px] shrink-0">
              <PropertyCard property={toCardData(c)} showSaveButton={false} />
              <p className="mt-1 px-1 text-[11px] text-cyan-300/80">{c.why}</p>
            </div>
          ))}
        </Row>
      ) : (
        <p className="mb-6 text-sm text-slate-500">No comparable active listings in {areaName} right now.</p>
      )}

      {/* Recently Sold */}
      {hasSold && (
        <Row
          title={`Recently Sold in ${areaName}`}
          badge={data.soldLocked ? "none" : data.matchQuality.sold}
          action={
            data.soldLocked ? (
              <span className="text-xs text-slate-400">{data.soldCount} sold · sign in to view</span>
            ) : (
              seeAll
            )
          }
        >
          {data.soldLocked
            ? Array.from({ length: Math.min(4, data.soldCount) }).map((_, i) => (
                <SoldCompCard
                  key={i}
                  locked
                  card={{} as SimilarSoldCard}
                />
              ))
            : data.sold.map((c) => <SoldCompCard key={c.id} card={c} />)}
        </Row>
      )}

      {data.matchQuality.forSale === "sparse" && (
        <p className="text-xs text-slate-500">Limited comparable activity in {areaName}.</p>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm.cmd run typecheck`
Expected: no errors. (`PropertyCard`/`PropertyCardData` are named exports from `src/components/PropertyCard.tsx` — verified.)

- [ ] **Step 3: Lint**

Run: `npm.cmd run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/Property/SimilarProperties.tsx
git commit -m "feat(similar): SimilarProperties client island (two stacked rows + states)"
```

---

## Task 8: Wire into the listing page

**Files:**
- Modify: `src/app/(app)/properties/[id]/page.tsx`

- [ ] **Step 1: Add the import**

Add to the import block (near the other `@/components/Property/*` imports, ~line 37):

```ts
import SimilarProperties from "@/components/Property/SimilarProperties";
```

- [ ] **Step 2: Mount the island after the Property History section**

Find the closing `</section>` of the Property History band (the one that opens `{/* ── FULL-WIDTH: Property History ... */}`, ~line 585) and insert immediately AFTER it, still inside `<div className="mx-auto max-w-[1400px] px-4 py-6">`:

```tsx
        {/* ── Comparable Properties (For Sale + Recently Sold), lazy client island ── */}
        <SimilarProperties
          subjectId={id}
          cityRegion={p.CityRegion ?? null}
          city={p.City ?? null}
          subType={p.PropertySubType ?? null}
          beds={p.BedroomsTotal ?? 0}
          baths={p.BathroomsTotalInteger ?? 0}
          listPrice={price}
          area={p.BuildingAreaTotal ?? 0}
        />
```

- [ ] **Step 3: Typecheck**

Run: `npm.cmd run typecheck`
Expected: no errors. (`id`, `p`, and `price` are all in scope in `PropertyPage`.)

- [ ] **Step 4: Build**

Run: `npm.cmd run build`
Expected: build succeeds; the new route `/api/properties/[id]/similar` appears in the route list.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/properties/[id]/page.tsx"
git commit -m "feat(similar): mount Comparable Properties band on the listing page"
```

---

## Task 9: Full verification + manual smoke

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm.cmd run test`
Expected: all tests pass, including `similarListings.test.ts`.

- [ ] **Step 2: Typecheck + lint the whole project**

Run: `npm.cmd run typecheck` then `npm.cmd run lint`
Expected: clean.

- [ ] **Step 3: Manual smoke (dev server)**

Run: `npm.cmd run dev`, then visit a listing in a DENSE area (e.g. a Brampton/Mississauga listing) and a listing in a THIN/rural area.

Verify:
- Dense: "For Sale in {region}" and "Recently Sold in {region}" rows render up to 8 cards each; "why" chips read sensibly (`Same neighbourhood · 3bd Detached`); a match badge shows.
- Each For-Sale card shows the brokerage line; no condo apartments appear for a detached subject (family wall).
- Signed OUT: the Sold row shows locked placeholders + "{n} sold · sign in to view", and NO sold prices appear in the network response (check `/api/properties/<id>/similar` → `sold: []`, `soldLocked: true`).
- Signed IN (consumer): Sold cards show close price + "% of ask" + sold date.
- Thin area: rows degrade to fewer cards or the honest "No comparable active listings…" / "Limited comparable activity…" copy — never padded with off-family product.
- The band is below Property History and did not slow the top of the page (it pops in after paint).

- [ ] **Step 4: Final commit (if any smoke fixes were needed)**

```bash
git add -A
git commit -m "fix(similar): manual-smoke adjustments"
```

(Skip if no changes.)

---

## Self-Review notes (for the executor)

- **Spec coverage:** family wall (Task 1+4), opposite relax-orders/weights (Task 3), city-fallback via region-scoring-not-filtering (Tasks 3–4), VOW gate + count teaser (Task 5), honest-stop tiers (Tasks 3,7), brokerage display (Tasks 6–7), lazy island below history (Tasks 7–8), pure-logic tests (Tasks 1–4).
- **Known soft spots to watch:** `BuildingAreaTotal` may be absent on the `properties` index → For-Sale `sizeScore` is intentionally neutral (not a bug). The "See all in {city}" link passes `?city=` which the terminal may not yet consume — it still lands on the terminal (spec §12 future item). `ListingThumbnail` import style must match its export (named, per `PropertyCard.tsx`).
- **Do NOT** reintroduce a `BuildingAreaTotal` filter clause or an `id:!=` Typesense clause — subject exclusion is done in JS in the route on purpose.
```
