# Composable Filter Bar — Foundation (Phase 0 + 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a composable, chip-based universal filter bar (Price, Beds, Baths, Home Type) to the `/properties` terminal, backed by a data-driven filter registry, without disturbing the existing persona investor ribbon.

**Architecture:** A pure `filterRegistry` defines each universal filter as data (control kind + a `buildClause` that emits a Typesense `filter_by` fragment). A new `universalFilters` slice in the Zustand command-center store holds the values. `page.tsx` composes `buildUniversalFilterString(universalFilters)` into the existing `rawFilterBy` chain — one extra clause, no API change. A new `FilterBar` renders the registry's pinned chips above the persona ribbon; each chip opens a small popover (range slider / stepper / multi-select). The TRREB 100-cap is surfaced as a "100 of N — narrow" nudge.

**Tech Stack:** Next.js 16 (App Router, client components), TypeScript, Zustand v5, Radix Slider, Tailwind (`pp-*`/slate/cyan terminal theme), Typesense, Vitest (node env — pure-logic tests only).

**Spec:** `docs/superpowers/specs/2026-05-29-composable-filter-bar-design.md` (this plan implements its Phases 0–1; Phases 2–5 get their own plans).

---

## Testing Strategy (read first)

The project's Vitest runs in `environment: 'node'` with **no jsdom/testing-library** (`vitest.config.ts:30`). Therefore:

- **Pure logic** (registry clause-builders, chip-label formatters, the result nudge) → **TDD with Vitest**. Tests import `{ describe, it, expect } from "vitest"` (globals are off). Files: `src/**/*.test.ts`.
- **Zustand store changes & React components** → **no unit test** (would need jsdom infra that doesn't exist). Verified by `npm run typecheck`, `npm run lint`, `npm run build`, and a manual `npm run dev` browser check. The store slice is a 3-line mirror of the existing `setFilter`; risk is low.

Commands:
- One test file: `npx vitest run <path>`
- All tests: `npm test`
- Types: `npm run typecheck` · Lint: `npm run lint` · Build: `npm run build` · Dev: `npm run dev`

## Branch setup (before Task 1)

This work should live on its own branch. The design spec is committed on `feat/avm-value-add-engine` (commit `49fc870`). Recommended: branch off the current tip so the spec + this plan come along:

```bash
git checkout -b feat/composable-filter-bar
git log --oneline -1   # confirm the branch points at the spec/plan commit
```

(If the AVM branch has already merged to `main`, branch off `main` instead — either is fine as long as the spec/plan docs are present.)

## File Structure

**Create:**
- `src/lib/filters/types.ts` — `FilterDef`, `FilterValue`, `FilterCategory`, `FilterControlKind`, `FilterOption`, `UniversalFilterState`.
- `src/lib/filters/filterRegistry.ts` — `CORE_FILTERS`, `FILTERS_BY_KEY`, `makeDefaultUniversalFilters`, `buildUniversalFilterString`.
- `src/lib/filters/filterRegistry.test.ts` — clause-builder + chip-label + combined-string tests.
- `src/components/CommandCenter/filterNudge.ts` — `formatResultNudge`.
- `src/components/CommandCenter/filterNudge.test.ts` — nudge tests.
- `src/components/ui/popover.tsx` — minimal click-outside popover (no new dependency).
- `src/components/CommandCenter/FilterChip.tsx` — one chip + its range/stepper/enum popover.
- `src/components/CommandCenter/FilterBar.tsx` — the chip row + result nudge.
- `scripts/admin/listPropertySubTypes.ts` — one-off live facet check (Task 9).

**Modify:**
- `src/lib/stores/commandCenterStore.ts` — add `universalFilters` + `setUniversalFilter` + `resetUniversalFilters`.
- `src/app/properties/page.tsx` — compose `buildUniversalFilterString` into `rawFilterBy`; add to deps.
- `src/components/CommandCenter/TopCommandBar.tsx` — mount `<FilterBar />` above `<PersonaFilterBar />`.

---

## Task 1: Filter registry + clause builders (pure logic, TDD)

**Files:**
- Create: `src/lib/filters/types.ts`
- Create: `src/lib/filters/filterRegistry.ts`
- Test: `src/lib/filters/filterRegistry.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/filters/filterRegistry.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  FILTERS_BY_KEY,
  buildUniversalFilterString,
  makeDefaultUniversalFilters,
} from "./filterRegistry";

describe("filterRegistry — clause builders", () => {
  it("price emits both bounds when narrowed", () => {
    expect(FILTERS_BY_KEY.price.buildClause([500_000, 800_000])).toBe(
      "ListPrice:>=500000 && ListPrice:<=800000"
    );
  });
  it("price emits only the lower bound when max is default", () => {
    expect(FILTERS_BY_KEY.price.buildClause([500_000, 3_000_000])).toBe("ListPrice:>=500000");
  });
  it("price returns null at defaults", () => {
    expect(FILTERS_BY_KEY.price.buildClause([0, 3_000_000])).toBeNull();
  });
  it("beds emits a >= clause, null at 0", () => {
    expect(FILTERS_BY_KEY.beds.buildClause(3)).toBe("BedroomsTotal:>=3");
    expect(FILTERS_BY_KEY.beds.buildClause(0)).toBeNull();
  });
  it("baths emits a >= clause", () => {
    expect(FILTERS_BY_KEY.baths.buildClause(2)).toBe("BathroomsTotalInteger:>=2");
  });
  it("homeType backtick-quotes each subtype in an OR group", () => {
    expect(FILTERS_BY_KEY.homeType.buildClause(["Detached", "Condo Apartment"])).toBe(
      "(PropertySubType:=`Detached` || PropertySubType:=`Condo Apartment`)"
    );
  });
  it("homeType returns null when empty", () => {
    expect(FILTERS_BY_KEY.homeType.buildClause([])).toBeNull();
  });
});

describe("filterRegistry — chip labels", () => {
  it("formats a price band", () => {
    expect(FILTERS_BY_KEY.price.chipLabel([500_000, 800_000])).toBe("$500k–$800k");
  });
  it("formats beds", () => {
    expect(FILTERS_BY_KEY.beds.chipLabel(3)).toBe("3+ Bd");
  });
  it("summarizes multiple home types", () => {
    expect(FILTERS_BY_KEY.homeType.chipLabel(["Detached", "Multiplex"])).toBe("2 types");
  });
});

describe("buildUniversalFilterString", () => {
  it("returns empty string at defaults", () => {
    expect(buildUniversalFilterString(makeDefaultUniversalFilters())).toBe("");
  });
  it("joins active clauses with &&", () => {
    const f = makeDefaultUniversalFilters();
    f.price = [500_000, 800_000];
    f.beds = 3;
    f.homeType = ["Detached"];
    expect(buildUniversalFilterString(f)).toBe(
      "ListPrice:>=500000 && ListPrice:<=800000 && BedroomsTotal:>=3 && (PropertySubType:=`Detached`)"
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/filters/filterRegistry.test.ts`
Expected: FAIL — `Cannot find module './filterRegistry'`.

- [ ] **Step 3: Create the types**

Create `src/lib/filters/types.ts`:

```ts
export type FilterCategory = "Basics" | "Investor" | "Property" | "Location";
export type FilterControlKind = "range" | "stepper" | "enum";

export interface FilterOption {
  value: string;
  label: string;
}

/** A range carries [min, max]; a stepper carries a single number; an enum carries selected values. */
export type FilterValue = [number, number] | number | string[];

export interface FilterDef {
  key: string;
  label: string;
  category: FilterCategory;
  control: FilterControlKind;
  defaultPinned: boolean;
  defaultValue: FilterValue;
  // range controls
  min?: number;
  max?: number;
  step?: number;
  // enum controls
  options?: FilterOption[];
  /** Typesense facet field for live counts (wired in the Phase 2 plan). */
  facetField?: string;
  isActive: (value: FilterValue) => boolean;
  /** Emits a Typesense filter_by fragment, or null when the value is at default. */
  buildClause: (value: FilterValue) => string | null;
  chipLabel: (value: FilterValue) => string;
}

export type UniversalFilterState = Record<string, FilterValue>;
```

- [ ] **Step 4: Implement the registry**

Create `src/lib/filters/filterRegistry.ts`:

```ts
import type { FilterDef, FilterValue, UniversalFilterState } from "./types";

const PRICE_MIN = 0;
const PRICE_MAX = 3_000_000;

const fmtPrice = (v: number): string =>
  v >= 1_000_000
    ? `$${(v / 1_000_000).toFixed(v % 1_000_000 === 0 ? 0 : 1)}M`
    : `$${Math.round(v / 1000)}k`;

/**
 * CORE_FILTERS — the universal "what" filters, defined as data so the bar, the
 * query builder, and (later) the add-filter palette all read one source.
 * Home Type filters PropertySubType (Detached/Semi/Townhouse/Condo) — the value
 * users actually mean by "type". Exact subtype spellings are confirmed in Task 9.
 */
export const CORE_FILTERS: FilterDef[] = [
  {
    key: "price",
    label: "Price",
    category: "Basics",
    control: "range",
    defaultPinned: true,
    defaultValue: [PRICE_MIN, PRICE_MAX],
    min: PRICE_MIN,
    max: PRICE_MAX,
    step: 25_000,
    isActive: (v) => {
      const [lo, hi] = v as [number, number];
      return lo > PRICE_MIN || hi < PRICE_MAX;
    },
    buildClause: (v) => {
      const [lo, hi] = v as [number, number];
      const parts: string[] = [];
      if (lo > PRICE_MIN) parts.push(`ListPrice:>=${Math.floor(lo)}`);
      if (hi < PRICE_MAX) parts.push(`ListPrice:<=${Math.floor(hi)}`);
      return parts.length ? parts.join(" && ") : null;
    },
    chipLabel: (v) => {
      const [lo, hi] = v as [number, number];
      if (lo > PRICE_MIN && hi < PRICE_MAX) return `${fmtPrice(lo)}–${fmtPrice(hi)}`;
      if (lo > PRICE_MIN) return `${fmtPrice(lo)}+`;
      if (hi < PRICE_MAX) return `≤${fmtPrice(hi)}`;
      return "Price";
    },
  },
  {
    key: "beds",
    label: "Beds",
    category: "Basics",
    control: "stepper",
    defaultPinned: true,
    defaultValue: 0,
    min: 0,
    max: 7,
    step: 1,
    isActive: (v) => (v as number) > 0,
    buildClause: (v) => ((v as number) > 0 ? `BedroomsTotal:>=${v as number}` : null),
    chipLabel: (v) => ((v as number) > 0 ? `${v as number}+ Bd` : "Beds"),
  },
  {
    key: "baths",
    label: "Baths",
    category: "Basics",
    control: "stepper",
    defaultPinned: true,
    defaultValue: 0,
    min: 0,
    max: 7,
    step: 1,
    isActive: (v) => (v as number) > 0,
    buildClause: (v) => ((v as number) > 0 ? `BathroomsTotalInteger:>=${v as number}` : null),
    chipLabel: (v) => ((v as number) > 0 ? `${v as number}+ Ba` : "Baths"),
  },
  {
    key: "homeType",
    label: "Home Type",
    category: "Basics",
    control: "enum",
    defaultPinned: true,
    defaultValue: [],
    facetField: "PropertySubType",
    options: [
      { value: "Detached", label: "Detached" },
      { value: "Semi-Detached", label: "Semi-Detached" },
      { value: "Att/Row/Townhouse", label: "Townhouse" },
      { value: "Condo Apartment", label: "Condo Apt" },
      { value: "Condo Townhouse", label: "Condo Townhouse" },
      { value: "Multiplex", label: "Multiplex" },
    ],
    isActive: (v) => (v as string[]).length > 0,
    buildClause: (v) => {
      const vals = v as string[];
      if (!vals.length) return null;
      return `(${vals.map((s) => `PropertySubType:=\`${s}\``).join(" || ")})`;
    },
    chipLabel: (v) => {
      const vals = v as string[];
      if (!vals.length) return "Home Type";
      return vals.length === 1 ? vals[0] : `${vals.length} types`;
    },
  },
];

export const FILTERS_BY_KEY: Record<string, FilterDef> = Object.fromEntries(
  CORE_FILTERS.map((f) => [f.key, f])
);

/** Fresh default-value map (arrays cloned so store state never shares references). */
export function makeDefaultUniversalFilters(): UniversalFilterState {
  const out: UniversalFilterState = {};
  for (const f of CORE_FILTERS) {
    out[f.key] = Array.isArray(f.defaultValue) ? ([...f.defaultValue] as FilterValue) : f.defaultValue;
  }
  return out;
}

/** Compose the active universal filters into one Typesense filter_by fragment ("" if none). */
export function buildUniversalFilterString(values: UniversalFilterState): string {
  const clauses: string[] = [];
  for (const def of CORE_FILTERS) {
    const value = values[def.key] ?? def.defaultValue;
    const clause = def.buildClause(value);
    if (clause) clauses.push(clause);
  }
  return clauses.join(" && ");
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/lib/filters/filterRegistry.test.ts`
Expected: PASS (all assertions green).

- [ ] **Step 6: Typecheck + lint**

Run: `npm run typecheck` then `npm run lint`
Expected: no errors in `src/lib/filters/`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/filters/types.ts src/lib/filters/filterRegistry.ts src/lib/filters/filterRegistry.test.ts
git commit -m "feat(filters): data-driven filter registry for universal filters"
```

---

## Task 2: Store slice — universalFilters (typecheck-verified)

**Files:**
- Modify: `src/lib/stores/commandCenterStore.ts`

- [ ] **Step 1: Add imports**

At the top of `src/lib/stores/commandCenterStore.ts`, after the existing personaConfig import block (around line 13), add:

```ts
import type { FilterValue, UniversalFilterState } from "@/lib/filters/types";
import { makeDefaultUniversalFilters } from "@/lib/filters/filterRegistry";
```

- [ ] **Step 2: Extend the state interface**

In `interface CommandCenterState`, immediately after the `resetFilters: () => void;` line (around line 87), add:

```ts
  // Universal composable filters (price/beds/baths/type) — persona-independent.
  universalFilters: UniversalFilterState;
  setUniversalFilter: (key: string, value: FilterValue) => void;
  resetUniversalFilters: () => void;
```

- [ ] **Step 3: Implement in the store body**

In the `create<CommandCenterState>` object, immediately after the `resetFilters: () => set({ ... })` implementation (around line 204), add:

```ts
  universalFilters: makeDefaultUniversalFilters(),
  setUniversalFilter: (key, value) =>
    set((state) => ({ universalFilters: { ...state.universalFilters, [key]: value } })),
  resetUniversalFilters: () => set({ universalFilters: makeDefaultUniversalFilters() }),
```

- [ ] **Step 4: Typecheck + lint**

Run: `npm run typecheck` then `npm run lint`
Expected: no errors. (No unit test — store slice mirrors the existing `setFilter`; behavior is exercised in Task 8's browser check.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/stores/commandCenterStore.ts
git commit -m "feat(filters): universalFilters slice in command-center store"
```

---

## Task 3: Compose universal filters into the search (typecheck-verified)

**Files:**
- Modify: `src/app/properties/page.tsx`

- [ ] **Step 1: Add the import**

In `src/app/properties/page.tsx`, after the `import { searchListings } ...` line (line 29), add:

```ts
import { buildUniversalFilterString } from "@/lib/filters/filterRegistry";
```

- [ ] **Step 2: Read `universalFilters` from the store**

In the `useCommandCenterStore()` destructure (lines 51-76), add `universalFilters,` next to `filters,` (after line 53):

```ts
    filters,
    universalFilters,
```

- [ ] **Step 3: Build and compose the clause**

In `performSearch`, immediately after `const personaFilter = persona.buildFilterString(filters);` (line 130), add:

```ts
      // Universal composable filters (price/beds/baths/type) compose alongside
      // the persona's investor filters — same filter_by chain, no API change.
      const universalFilter = buildUniversalFilterString(universalFilters);
```

Then change the `rawFilterBy` assembly (lines 151-153) from:

```ts
      const rawFilterBy = [SALES_FLOOR, personaFilter, ...schoolParts, bandClause, drawClause]
        .filter(Boolean)
        .join(" && ");
```

to:

```ts
      const rawFilterBy = [SALES_FLOOR, personaFilter, universalFilter, ...schoolParts, bandClause, drawClause]
        .filter(Boolean)
        .join(" && ");
```

- [ ] **Step 4: Add `universalFilters` to the effect deps**

In the `useCallback` dependency array for `performSearch` (line 183), add `universalFilters,` next to `filters,`:

```ts
  }, [persona, filters, universalFilters, location, commute.enabled, commute.polygon, school.enabled, school.level, school.system, school.minScore, school.targetSchool, colorBand, drawPolygon, mapBounds, setSearchResult, setIsLoading, setError, setTotalCount]);
```

- [ ] **Step 5: Typecheck + lint**

Run: `npm run typecheck` then `npm run lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/properties/page.tsx
git commit -m "feat(filters): compose universal filters into terminal search"
```

---

## Task 4: Result-nudge formatter (pure logic, TDD)

**Files:**
- Create: `src/components/CommandCenter/filterNudge.ts`
- Test: `src/components/CommandCenter/filterNudge.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/components/CommandCenter/filterNudge.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { formatResultNudge } from "./filterNudge";

describe("formatResultNudge", () => {
  it("shows a plain count when nothing is hidden by the cap", () => {
    expect(formatResultNudge(42, 42)).toEqual({ text: "42 matches", overflowing: false });
  });
  it("uses the singular for one match", () => {
    expect(formatResultNudge(1, 1)).toEqual({ text: "1 match", overflowing: false });
  });
  it("prompts to narrow when the total exceeds what is shown", () => {
    expect(formatResultNudge(100, 340)).toEqual({ text: "100 of 340 — narrow", overflowing: true });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/CommandCenter/filterNudge.test.ts`
Expected: FAIL — `Cannot find module './filterNudge'`.

- [ ] **Step 3: Implement**

Create `src/components/CommandCenter/filterNudge.ts`:

```ts
/**
 * The terminal renders at most 100 listings (TRREB cap). When the true total
 * exceeds what is shown, prompt the user to refine rather than paginate.
 */
export interface ResultNudge {
  text: string;
  overflowing: boolean;
}

export function formatResultNudge(shown: number, total: number): ResultNudge {
  if (total <= shown) {
    return { text: `${total} match${total === 1 ? "" : "es"}`, overflowing: false };
  }
  return { text: `${shown} of ${total.toLocaleString("en-US")} — narrow`, overflowing: true };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/CommandCenter/filterNudge.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/CommandCenter/filterNudge.ts src/components/CommandCenter/filterNudge.test.ts
git commit -m "feat(filters): result-count narrow nudge formatter"
```

---

## Task 5: Minimal popover primitive (typecheck/lint-verified)

**Files:**
- Create: `src/components/ui/popover.tsx`

Note: `@radix-ui/react-popover` is **not** installed (see `package.json`). This is a tiny click-outside/Escape popover — no new dependency.

- [ ] **Step 1: Implement**

Create `src/components/ui/popover.tsx`:

```tsx
"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface PopoverProps {
  trigger: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  align?: "left" | "right";
}

/** Lightweight popover: toggles on trigger click, closes on outside-click or Escape. */
export function Popover({ trigger, children, className, align = "left" }: PopoverProps) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative shrink-0">
      <div onClick={() => setOpen((o) => !o)}>{trigger}</div>
      {open && (
        <div
          className={cn(
            "absolute top-full z-50 mt-1 border border-slate-700 bg-slate-900 p-3 shadow-xl",
            align === "right" ? "right-0" : "left-0",
            className
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `npm run typecheck` then `npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/popover.tsx
git commit -m "feat(ui): minimal click-outside popover primitive"
```

---

## Task 6: FilterChip component (typecheck/lint-verified)

**Files:**
- Create: `src/components/CommandCenter/FilterChip.tsx`

- [ ] **Step 1: Implement**

Create `src/components/CommandCenter/FilterChip.tsx`:

```tsx
"use client";

import React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Slider } from "@/components/ui/slider";
import { Popover } from "@/components/ui/popover";
import type { FilterDef, FilterValue } from "@/lib/filters/types";

const LABEL = "text-[10px] font-semibold uppercase tracking-wider";

interface FilterChipProps {
  def: FilterDef;
  value: FilterValue;
  onChange: (value: FilterValue) => void;
  onClear: () => void;
}

export default function FilterChip({ def, value, onChange, onClear }: FilterChipProps) {
  const active = def.isActive(value);
  const chipText = active ? def.chipLabel(value) : def.label;

  const trigger = (
    <span
      className={cn(
        "flex cursor-pointer items-center gap-1.5 border px-2.5 py-1.5 transition-all",
        LABEL,
        active
          ? "border-cyan-500/50 bg-cyan-500/10 text-cyan-300"
          : "border-slate-800 bg-slate-900 text-slate-400 hover:border-slate-700 hover:text-slate-200"
      )}
    >
      {chipText}
      {active && (
        <X
          className="h-3 w-3 opacity-70 hover:opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            onClear();
          }}
        />
      )}
    </span>
  );

  return (
    <Popover trigger={trigger} className="w-56">
      {def.control === "range" && (
        <RangeControl def={def} value={value as [number, number]} onChange={onChange} />
      )}
      {def.control === "stepper" && (
        <StepperControl def={def} value={value as number} onChange={onChange} />
      )}
      {def.control === "enum" && (
        <EnumControl def={def} value={value as string[]} onChange={onChange} />
      )}
    </Popover>
  );
}

function RangeControl({
  def,
  value,
  onChange,
}: {
  def: FilterDef;
  value: [number, number];
  onChange: (v: FilterValue) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className={cn(LABEL, "text-slate-400")}>{def.label}</span>
        <span className="font-mono text-xs text-cyan-400">{def.chipLabel(value)}</span>
      </div>
      <Slider
        value={value}
        min={def.min ?? 0}
        max={def.max ?? 100}
        step={def.step ?? 1}
        onValueChange={(v) => onChange([v[0], v[1]] as [number, number])}
      />
    </div>
  );
}

function StepperControl({
  def,
  value,
  onChange,
}: {
  def: FilterDef;
  value: number;
  onChange: (v: FilterValue) => void;
}) {
  const max = def.max ?? 7;
  const options = Array.from({ length: max + 1 }, (_, i) => i);
  return (
    <div className="flex flex-col gap-2">
      <span className={cn(LABEL, "text-slate-400")}>{def.label}</span>
      <div className="flex flex-wrap gap-1">
        {options.map((n) => (
          <button
            key={n}
            onClick={() => onChange(n)}
            className={cn(
              "h-7 w-9 border text-xs font-semibold transition-colors",
              value === n
                ? "border-cyan-500/60 bg-cyan-500/10 text-cyan-300"
                : "border-slate-800 bg-slate-900 text-slate-400 hover:border-slate-700"
            )}
          >
            {n === 0 ? "Any" : `${n}+`}
          </button>
        ))}
      </div>
    </div>
  );
}

function EnumControl({
  def,
  value,
  onChange,
}: {
  def: FilterDef;
  value: string[];
  onChange: (v: FilterValue) => void;
}) {
  const toggle = (val: string) => {
    onChange(value.includes(val) ? value.filter((x) => x !== val) : [...value, val]);
  };
  return (
    <div className="flex flex-col gap-1">
      <span className={cn(LABEL, "mb-1 text-slate-400")}>{def.label}</span>
      {(def.options ?? []).map((opt) => {
        const checked = value.includes(opt.value);
        return (
          <button
            key={opt.value}
            onClick={() => toggle(opt.value)}
            className={cn(
              "flex items-center gap-2 px-1 py-1 text-left text-xs transition-colors",
              checked ? "text-cyan-300" : "text-slate-400 hover:text-slate-200"
            )}
          >
            <span
              className={cn(
                "flex h-3.5 w-3.5 items-center justify-center border",
                checked ? "border-cyan-500 bg-cyan-500/20" : "border-slate-600"
              )}
            >
              {checked && <span className="h-1.5 w-1.5 bg-cyan-400" />}
            </span>
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `npm run typecheck` then `npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/CommandCenter/FilterChip.tsx
git commit -m "feat(filters): FilterChip with range/stepper/enum popovers"
```

---

## Task 7: FilterBar component (typecheck/lint-verified)

**Files:**
- Create: `src/components/CommandCenter/FilterBar.tsx`

- [ ] **Step 1: Implement**

Create `src/components/CommandCenter/FilterBar.tsx`:

```tsx
"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";
import { CORE_FILTERS } from "@/lib/filters/filterRegistry";
import type { FilterValue } from "@/lib/filters/types";
import FilterChip from "./FilterChip";
import { formatResultNudge } from "./filterNudge";

const LABEL = "text-[10px] font-semibold uppercase tracking-wider";

const freshDefault = (v: FilterValue): FilterValue =>
  Array.isArray(v) ? ([...v] as FilterValue) : v;

export default function FilterBar() {
  const { universalFilters, setUniversalFilter, searchResult, totalCount } =
    useCommandCenterStore();
  const shown = searchResult?.listings.length ?? 0;
  const nudge = formatResultNudge(shown, totalCount);

  return (
    <div className="no-scrollbar flex h-11 items-center gap-x-2 overflow-x-auto border-t border-slate-800 bg-slate-950 px-3">
      <span className={cn(LABEL, "shrink-0 text-slate-500")}>Filters</span>
      {CORE_FILTERS.map((def) => (
        <FilterChip
          key={def.key}
          def={def}
          value={universalFilters[def.key] ?? def.defaultValue}
          onChange={(v) => setUniversalFilter(def.key, v)}
          onClear={() => setUniversalFilter(def.key, freshDefault(def.defaultValue))}
        />
      ))}
      <div className="ml-auto flex shrink-0 items-center pl-2">
        <span className={cn(LABEL, nudge.overflowing ? "text-amber-400" : "text-slate-400")}>
          {nudge.text}
        </span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `npm run typecheck` then `npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/CommandCenter/FilterBar.tsx
git commit -m "feat(filters): FilterBar chip row with narrow nudge"
```

---

## Task 8: Mount the bar + manual browser verification

**Files:**
- Modify: `src/components/CommandCenter/TopCommandBar.tsx`

- [ ] **Step 1: Add the import**

In `src/components/CommandCenter/TopCommandBar.tsx`, after `import PersonaFilterBar from "./PersonaFilterBar";` (line 14), add:

```ts
import FilterBar from "./FilterBar";
```

- [ ] **Step 2: Render the bar above the persona ribbon**

Replace the trailing ribbon block (lines 93-96) from:

```tsx
      {/* Parameter ribbon */}
      <PersonaFilterBar />
```

to:

```tsx
      {/* Universal composable filter bar (price/beds/baths/type) */}
      <FilterBar />

      {/* Persona investor ribbon */}
      <PersonaFilterBar />
```

- [ ] **Step 3: Typecheck, lint, build**

Run: `npm run typecheck` then `npm run lint` then `npm run build`
Expected: all succeed.

- [ ] **Step 4: Manual browser verification**

Run: `npm run dev`, open `http://localhost:3000/properties`, then confirm:
1. A "FILTERS" row with **Price · Beds · Baths · Home Type** chips renders directly above the persona investor ribbon.
2. Clicking **Price** opens a popover with a two-thumb slider; dragging it narrows the list and the chip relabels (e.g. `$500k–$800k`) and turns cyan.
3. Clicking **Beds** → `3+` filters the list; the chip shows `3+ Bd` with an `×` that clears it.
4. **Home Type** multi-select narrows results; selecting two shows `2 types`.
5. The right side shows the nudge — e.g. `100 of 340 — narrow` in amber when the total exceeds 100, or `N matches` in slate otherwise.
6. Switching persona still works and the investor ribbon is unchanged.

If a Home Type selection returns **zero** results, the subtype spelling is wrong — fix it in Task 9 before committing.

- [ ] **Step 5: Commit**

```bash
git add src/components/CommandCenter/TopCommandBar.tsx
git commit -m "feat(filters): mount composable FilterBar in the terminal"
```

---

## Task 9: Verify PropertySubType values against the live index

**Files:**
- Create: `scripts/admin/listPropertySubTypes.ts`
- Modify (if needed): `src/lib/filters/filterRegistry.ts`

The `homeType` options in Task 1 are best-guess spellings. The Typesense `PropertySubType` values must match **exactly** (a wrong spelling silently returns zero — see the persona/raw-subtype spelling pitfalls). Confirm against live data.

- [ ] **Step 1: Write the one-off facet check**

Create `scripts/admin/listPropertySubTypes.ts`:

```ts
import "dotenv/config";
import { getTypesenseClient } from "../../src/lib/typesense/client";

(async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r: any = await getTypesenseClient()
    .collections("properties")
    .documents()
    .search({
      q: "*",
      query_by: "City",
      filter_by: "ListPrice:>=100000",
      facet_by: "PropertySubType",
      max_facet_values: 50,
      per_page: 1,
    });
  const counts = r.facet_counts?.[0]?.counts ?? [];
  for (const c of counts) console.log(`${String(c.count).padStart(6)}  ${JSON.stringify(c.value)}`);
})();
```

- [ ] **Step 2: Run it**

Run: `npx tsx scripts/admin/listPropertySubTypes.ts`
Expected: a ranked list of the real subtype strings with counts (e.g. `  4210  "Detached"`).

- [ ] **Step 3: Reconcile the registry options**

Compare the printed values to the `homeType.options` array in `src/lib/filters/filterRegistry.ts`. For any mismatch, set `value` to the **exact** printed string (keep `label` friendly). Keep the 5–7 highest-count residential subtypes; drop options with no live match.

- [ ] **Step 4: Re-verify in the browser**

Re-run `npm run dev` and confirm each Home Type option now returns a non-empty result set (Task 8, check 4).

- [ ] **Step 5: Commit (only if the registry changed)**

```bash
git add src/lib/filters/filterRegistry.ts scripts/admin/listPropertySubTypes.ts
git commit -m "fix(filters): align Home Type options with live PropertySubType values"
```

---

## Task 10: Full-suite verification

- [ ] **Step 1: Run everything**

Run, in order:
- `npm test` → all Vitest suites pass (including the new `filterRegistry` and `filterNudge` suites).
- `npm run typecheck` → no type errors.
- `npm run lint` → no lint errors.
- `npm run build` → production build succeeds.

- [ ] **Step 2: Confirm parity of existing behavior**

In the browser, with **no** universal chips active, confirm the result set matches pre-change behavior for each persona (the universal clause is `""` and contributes nothing). Toggle a persona investor control and confirm it still filters as before.

- [ ] **Step 3: Final state**

The foundation is complete: a composable, data-driven universal filter bar ships above the persona ribbon, fully wired to Typesense, with the cap surfaced as a narrow nudge. The next plan (Phase 2) adds the hybrid **+ Add filter** palette, exposes the investor/property fields through the registry, and wires `facet_by` for live counts.

---

## Self-Review

**Spec coverage (Phases 0–1):**
- Filter registry / data-driven clause-building → Tasks 1, 3 ✓
- `universalFilters` store slice → Task 2 ✓
- Composable bar with default chips (Price/Beds/Baths/Type) → Tasks 6, 7, 8 ✓
- Chip popovers (range/stepper/enum) reusing `ui/slider` → Tasks 5, 6 ✓
- Narrow nudge from `found`/`totalCount` → Tasks 4, 7 ✓
- Live counts / Buy-Rent / personas-as-presets / saved views / alerts → **intentionally deferred** to Phase 2–5 plans (noted in Goal + Task 10).

**Deviations from the spec (called out):**
- The registry is **additive** (covers universal filters; persona builders untouched) rather than a parity-rewrite of `buildFilterString`. Rationale: zero regression risk for the foundation; the persona-builder migration moves to the Phase 3 plan when personas become presets.
- The FilterBar is mounted **above** the persona ribbon (interim two-tier) rather than replacing it. Full unification (ribbon removal) lands when personas become presets (Phase 3 plan).
- **Buy/Rent deferred** — lease changes the `SALES_FLOOR` and price-range semantics; handled in a later plan.

**Placeholder scan:** none — every code step contains complete code; every command has expected output.

**Type consistency:** `FilterValue` (`[number,number] | number | string[]`), `FilterDef`, `UniversalFilterState` are defined in Task 1 and used identically in Tasks 2, 3, 6, 7. `buildUniversalFilterString` / `makeDefaultUniversalFilters` / `CORE_FILTERS` / `FILTERS_BY_KEY` signatures match across tasks. `formatResultNudge(shown, total)` defined in Task 4, used in Task 7. `Popover` props (`trigger`/`children`/`className`/`align`) defined in Task 5, used in Task 6.
