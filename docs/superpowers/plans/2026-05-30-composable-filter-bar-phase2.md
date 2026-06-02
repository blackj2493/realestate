# Composable Filter Bar — Phase 2 (Add-Filter Palette + Field Library) Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or executing-plans. Steps use `- [ ]`.

**Goal:** Turn the 4 pinned chips into a composable library of 14 filters behind a searchable **"+ Add filter"** palette, with **live facet counts** in the multi-selects.

**Architecture:** Extend the existing data-driven `filterRegistry` with 10 deeper `FilterDef`s (Property category, `defaultPinned: false`). Add an `addedFilterKeys` slice to the store so the bar can show pinned + user-added chips. Add `facet_by` to the terminal search so `searchResult.facetDistribution` populates per-option counts. New `AddFilterPalette` component (hybrid search + categorized list). `FilterBar` renders pinned + added + the "+ Add filter" button; `FilterChip`'s enum control shows counts.

**Builds on:** Phase 0+1 (`src/lib/filters/*`, `FilterBar`, `FilterChip`, `popover.tsx`, `universalFilters` store slice). All values below are **live-verified** against the active `properties` Typesense collection (facet dump 2026-05-30).

**Test setup:** vitest node-env, pure-logic only. New registry logic is TDD'd; UI is typecheck/lint/build/manual-verified. Commit path-explicit (`git commit -m … -- <paths>`) — the working tree is shared with concurrent work.

---

## Task 1: Extend the registry with the deeper field library (TDD)

**Files:** Modify `src/lib/filters/filterRegistry.ts` · Test `src/lib/filters/filterRegistry.test.ts`

- [ ] **Step 1: Add failing tests** (append to the existing `filterRegistry.test.ts`, inside a new `describe`):

```ts
import { ALL_FILTERS, FACET_FIELDS } from "./filterRegistry";

describe("MORE_FILTERS (Phase 2)", () => {
  it("registers 14 filters total (4 pinned + 10 added)", () => {
    expect(ALL_FILTERS.length).toBe(14);
    expect(ALL_FILTERS.filter((f) => f.defaultPinned).length).toBe(4);
  });
  it("basement backtick-quotes BasementType values in an OR group", () => {
    expect(FILTERS_BY_KEY.basement.buildClause(["Finished", "Separate Entrance"])).toBe(
      "(BasementType:=`Finished` || BasementType:=`Separate Entrance`)"
    );
  });
  it("occupancy emits a single-value clause", () => {
    expect(FILTERS_BY_KEY.occupancy.buildClause(["Vacant"])).toBe("(OccupantType:=`Vacant`)");
  });
  it("lotSize emits a range and null at defaults", () => {
    expect(FILTERS_BY_KEY.lotSize.buildClause([2000, 20000])).toBe("LotSqftTotal:>=2000");
    expect(FILTERS_BY_KEY.lotSize.buildClause([0, 20000])).toBeNull();
  });
  it("parking emits a >= stepper clause", () => {
    expect(FILTERS_BY_KEY.parking.buildClause(2)).toBe("ParkingTotal:>=2");
  });
  it("maintFee emits an upper bound", () => {
    expect(FILTERS_BY_KEY.maintFee.buildClause([0, 600])).toBe("AssociationFee:<=600");
  });
  it("FACET_FIELDS lists the faceted enum fields", () => {
    expect(FACET_FIELDS).toContain("BasementType");
    expect(FACET_FIELDS).toContain("PropertySubType");
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run src/lib/filters/filterRegistry.test.ts` (ALL_FILTERS/FACET_FIELDS undefined).

- [ ] **Step 3: Implement.** In `src/lib/filters/filterRegistry.ts`, immediately **after** the `CORE_FILTERS` array closes (after its `];`, currently line 104) and **before** `export const FILTERS_BY_KEY`, insert the factory helpers + `MORE_FILTERS` + `ALL_FILTERS` + `FACET_FIELDS`:

```ts
// ── Phase 2: factory helpers for the deeper field library ──────────────────
const fmtSqft = (v: number) => `${v.toLocaleString("en-US")} sf`;
const fmtFt = (v: number) => `${v}′`;
const fmtFee = (v: number) => `$${v}/mo`;

function enumFilter(o: {
  key: string;
  label: string;
  field: string;
  options: { value: string; label: string }[];
}): FilterDef {
  return {
    key: o.key,
    label: o.label,
    category: "Property",
    control: "enum",
    defaultPinned: false,
    defaultValue: [],
    facetField: o.field,
    options: o.options,
    isActive: (v) => (v as string[]).length > 0,
    buildClause: (v) => {
      const vals = v as string[];
      if (!vals.length) return null;
      return `(${vals.map((s) => `${o.field}:=\`${s}\``).join(" || ")})`;
    },
    chipLabel: (v) => {
      const vals = v as string[];
      if (!vals.length) return o.label;
      if (vals.length === 1) return o.options.find((x) => x.value === vals[0])?.label ?? vals[0];
      return `${vals.length} selected`;
    },
  };
}

function rangeFilter(o: {
  key: string;
  label: string;
  field: string;
  min: number;
  max: number;
  step: number;
  fmt: (v: number) => string;
}): FilterDef {
  return {
    key: o.key,
    label: o.label,
    category: "Property",
    control: "range",
    defaultPinned: false,
    defaultValue: [o.min, o.max],
    min: o.min,
    max: o.max,
    step: o.step,
    isActive: (v) => {
      const [lo, hi] = v as [number, number];
      return lo > o.min || hi < o.max;
    },
    buildClause: (v) => {
      const [lo, hi] = v as [number, number];
      const parts: string[] = [];
      if (lo > o.min) parts.push(`${o.field}:>=${Math.floor(lo)}`);
      if (hi < o.max) parts.push(`${o.field}:<=${Math.floor(hi)}`);
      return parts.length ? parts.join(" && ") : null;
    },
    chipLabel: (v) => {
      const [lo, hi] = v as [number, number];
      if (lo > o.min && hi < o.max) return `${o.fmt(lo)}–${o.fmt(hi)}`;
      if (lo > o.min) return `${o.fmt(lo)}+`;
      if (hi < o.max) return `≤${o.fmt(hi)}`;
      return o.label;
    },
  };
}

function stepperFilter(o: {
  key: string;
  label: string;
  field: string;
  max: number;
  unit: string;
}): FilterDef {
  return {
    key: o.key,
    label: o.label,
    category: "Property",
    control: "stepper",
    defaultPinned: false,
    defaultValue: 0,
    min: 0,
    max: o.max,
    step: 1,
    isActive: (v) => (v as number) > 0,
    buildClause: (v) => ((v as number) > 0 ? `${o.field}:>=${v as number}` : null),
    chipLabel: (v) => ((v as number) > 0 ? `${v as number}+ ${o.unit}` : o.label),
  };
}

/** The deeper, opt-in field library reached via "+ Add filter". Values live-verified. */
export const MORE_FILTERS: FilterDef[] = [
  enumFilter({
    key: "basement",
    label: "Basement",
    field: "BasementType",
    options: [
      { value: "Finished", label: "Finished" },
      { value: "Unfinished", label: "Unfinished" },
      { value: "Separate Entrance", label: "Separate Entrance" },
      { value: "Walk-Out", label: "Walk-Out" },
      { value: "Finished with Walk-Out", label: "Finished + Walk-Out" },
      { value: "Apartment", label: "Apartment" },
    ],
  }),
  enumFilter({
    key: "suite",
    label: "Suite Potential",
    field: "SuiteStatus",
    options: [
      { value: "EXISTING_SUITE", label: "Existing suite" },
      { value: "POTENTIAL_CANDIDATE", label: "Potential suite" },
    ],
  }),
  enumFilter({
    key: "multiUnit",
    label: "Multi-Unit",
    field: "multi_unit_status",
    options: [
      { value: "EXISTING_MULTI_UNIT", label: "Existing multi-unit" },
      { value: "PRIME_CANDIDATE", label: "Prime candidate" },
      { value: "MARGINAL_CANDIDATE", label: "Marginal candidate" },
    ],
  }),
  enumFilter({
    key: "occupancy",
    label: "Occupancy",
    field: "OccupantType",
    options: [
      { value: "Vacant", label: "Vacant" },
      { value: "Tenant", label: "Tenant" },
      { value: "Owner", label: "Owner" },
    ],
  }),
  enumFilter({
    key: "age",
    label: "Property Age",
    field: "ApproximateAge",
    options: [
      { value: "New", label: "New" },
      { value: "0-5", label: "0-5 yrs" },
      { value: "6-15", label: "6-15 yrs" },
      { value: "16-30", label: "16-30 yrs" },
      { value: "31-50", label: "31-50 yrs" },
      { value: "51-99", label: "51-99 yrs" },
      { value: "100+", label: "100+ yrs" },
    ],
  }),
  rangeFilter({ key: "lotSize", label: "Lot Size", field: "LotSqftTotal", min: 0, max: 20000, step: 500, fmt: fmtSqft }),
  rangeFilter({ key: "lotFrontage", label: "Lot Frontage", field: "LotWidth", min: 0, max: 200, step: 5, fmt: fmtFt }),
  stepperFilter({ key: "parking", label: "Parking", field: "ParkingTotal", max: 8, unit: "Parking" }),
  stepperFilter({ key: "kitchens", label: "Kitchens", field: "KitchensTotal", max: 4, unit: "Kitchen" }),
  rangeFilter({ key: "maintFee", label: "Maint. Fee", field: "AssociationFee", min: 0, max: 2000, step: 50, fmt: fmtFee }),
];

/** Pinned-by-default core + the opt-in deeper library. */
export const ALL_FILTERS: FilterDef[] = [...CORE_FILTERS, ...MORE_FILTERS];

/** Low-cardinality enum fields already facet:true — requested so per-option counts show. */
export const FACET_FIELDS = [
  "PropertySubType",
  "BasementType",
  "SuiteStatus",
  "multi_unit_status",
  "OccupantType",
  "ApproximateAge",
];
```

Then change the three helpers below to iterate **`ALL_FILTERS`** instead of `CORE_FILTERS`:
- `FILTERS_BY_KEY`: `Object.fromEntries(ALL_FILTERS.map((f) => [f.key, f]))`
- `makeDefaultUniversalFilters`: `for (const f of ALL_FILTERS) {`
- `buildUniversalFilterString`: `for (const def of ALL_FILTERS) {`

- [ ] **Step 4: Run, expect PASS** — `npx vitest run src/lib/filters/filterRegistry.test.ts` (all green). Then `npm run typecheck`.

- [ ] **Step 5: Commit** — `git add src/lib/filters/filterRegistry.ts src/lib/filters/filterRegistry.test.ts && git commit -m "feat(filters): deeper field library (basement/suite/lot/parking/age/...)" -- src/lib/filters/filterRegistry.ts src/lib/filters/filterRegistry.test.ts`

---

## Task 2: Store — added-filter keys (typecheck-verified)

**Files:** Modify `src/lib/stores/commandCenterStore.ts`

- [ ] **Step 1:** In `interface CommandCenterState`, after `resetUniversalFilters: () => void;`, add:

```ts
  // Which non-pinned filters the user has added to the bar (chip shown even at default).
  addedFilterKeys: string[];
  addFilter: (key: string) => void;
  removeAddedFilter: (key: string) => void;
```

- [ ] **Step 2:** In the store body, after `resetUniversalFilters: () => set({ universalFilters: makeDefaultUniversalFilters() }),`, add:

```ts
  addedFilterKeys: [],
  addFilter: (key) =>
    set((state) =>
      state.addedFilterKeys.includes(key)
        ? {}
        : { addedFilterKeys: [...state.addedFilterKeys, key] }
    ),
  removeAddedFilter: (key) =>
    set((state) => ({ addedFilterKeys: state.addedFilterKeys.filter((k) => k !== key) })),
```

- [ ] **Step 3:** `npm run typecheck` + `npm run lint`. Commit: `git commit -m "feat(filters): track user-added filter chips in the store" -- src/lib/stores/commandCenterStore.ts`

---

## Task 3: Request facet counts in the terminal search (typecheck-verified)

**Files:** Modify `src/lib/typesense/client.ts`, `src/app/properties/page.tsx`

- [ ] **Step 1:** In `client.ts`, add `facetBy?: string;` to the `SearchOptions` interface (after `geoPolygon`). Destructure it in `searchListings` (`const { ..., geoPolygon, facetBy } = options;`). After the `query_by` line in `searchParams`, and before the return, add:

```ts
  if (facetBy) {
    searchParams.facet_by = facetBy;
    searchParams.max_facet_values = 50;
  }
```

(`facet_distribution` is already returned into `SearchResult.facetDistribution`.)

- [ ] **Step 2:** In `page.tsx`, add `FACET_FIELDS` to the registry import: `import { buildUniversalFilterString, FACET_FIELDS } from "@/lib/filters/filterRegistry";`. In the `searchListings({ ... })` call, add `facetBy: FACET_FIELDS.join(","),` (next to `perPage`).

- [ ] **Step 3:** `npm run typecheck` + `npm run lint`. Commit (two files): `git commit -m "feat(filters): request facet counts for the filter palette" -- src/lib/typesense/client.ts src/app/properties/page.tsx`

---

## Task 4: Show facet counts in the enum control (typecheck-verified)

**Files:** Modify `src/components/CommandCenter/FilterChip.tsx`

- [ ] **Step 1:** Add the store import at the top: `import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";`

- [ ] **Step 2:** Replace the `EnumControl` function body so it reads facet counts and renders them. The new version:

```tsx
function EnumControl({
  def,
  value,
  onChange,
}: {
  def: FilterDef;
  value: string[];
  onChange: (v: FilterValue) => void;
}) {
  const facetDist = useCommandCenterStore((s) => s.searchResult?.facetDistribution);
  const counts = def.facetField ? facetDist?.[def.facetField] : undefined;
  const toggle = (val: string) => {
    onChange(value.includes(val) ? value.filter((x) => x !== val) : [...value, val]);
  };
  return (
    <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
      <span className={cn(LABEL, "mb-1 text-slate-400")}>{def.label}</span>
      {(def.options ?? []).map((opt) => {
        const checked = value.includes(opt.value);
        const n = counts?.[opt.value];
        return (
          <button
            key={opt.value}
            onClick={() => toggle(opt.value)}
            className={cn(
              "flex items-center justify-between gap-2 px-1 py-1 text-left text-xs transition-colors",
              checked ? "text-cyan-300" : "text-slate-400 hover:text-slate-200"
            )}
          >
            <span className="flex items-center gap-2">
              <span
                className={cn(
                  "flex h-3.5 w-3.5 items-center justify-center border",
                  checked ? "border-cyan-500 bg-cyan-500/20" : "border-slate-600"
                )}
              >
                {checked && <span className="h-1.5 w-1.5 bg-cyan-400" />}
              </span>
              {opt.label}
            </span>
            {n !== undefined && (
              <span className="font-mono text-[10px] text-slate-500">{n.toLocaleString("en-US")}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3:** `npm run typecheck` + `npm run lint`. Commit: `git commit -m "feat(filters): live facet counts in multi-select chips" -- src/components/CommandCenter/FilterChip.tsx`

---

## Task 5: The "+ Add filter" palette (typecheck-verified)

**Files:** Create `src/components/CommandCenter/AddFilterPalette.tsx`

- [ ] **Step 1:** Create the component — a hybrid search box + categorized list of filters not currently shown:

```tsx
"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";
import { ALL_FILTERS, FILTERS_BY_KEY } from "@/lib/filters/filterRegistry";
import type { FilterCategory } from "@/lib/filters/types";

const LABEL = "text-[10px] font-semibold uppercase tracking-wider";
const CATEGORY_ORDER: FilterCategory[] = ["Basics", "Property", "Investor", "Location"];

/** Opens from the "+ Add filter" chip. Lists filters not pinned and not already added. */
export default function AddFilterPalette({ onPicked }: { onPicked?: () => void }) {
  const { addedFilterKeys, addFilter } = useCommandCenterStore();
  const [q, setQ] = React.useState("");

  const available = ALL_FILTERS.filter(
    (f) => !f.defaultPinned && !addedFilterKeys.includes(f.key)
  ).filter((f) => f.label.toLowerCase().includes(q.trim().toLowerCase()));

  const byCategory = CATEGORY_ORDER.map((cat) => ({
    cat,
    items: available.filter((f) => f.category === cat),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="flex w-64 flex-col gap-2">
      <input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search filters…"
        className="w-full border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:border-cyan-500/60 focus:outline-none"
      />
      <div className="flex max-h-72 flex-col gap-2 overflow-y-auto">
        {byCategory.length === 0 && (
          <p className="px-1 py-2 text-xs text-slate-500">No more filters.</p>
        )}
        {byCategory.map((g) => (
          <div key={g.cat} className="flex flex-col">
            <span className={cn(LABEL, "px-1 py-1 text-slate-500")}>{g.cat}</span>
            {g.items.map((f) => (
              <button
                key={f.key}
                onClick={() => {
                  addFilter(f.key);
                  onPicked?.();
                }}
                className="px-2 py-1.5 text-left text-xs text-slate-300 transition-colors hover:bg-cyan-500/10 hover:text-cyan-300"
              >
                {FILTERS_BY_KEY[f.key].label}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2:** `npm run typecheck` + `npm run lint`. Commit: `git commit -m "feat(filters): hybrid + Add filter palette (search + categories)" -- src/components/CommandCenter/AddFilterPalette.tsx`

---

## Task 6: Wire palette + added chips into FilterBar (typecheck/lint/build + manual)

**Files:** Modify `src/components/CommandCenter/FilterBar.tsx`

- [ ] **Step 1:** Replace `FilterBar.tsx` with the pinned + added + "+ Add filter" version:

```tsx
"use client";

import React from "react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";
import { CORE_FILTERS, FILTERS_BY_KEY } from "@/lib/filters/filterRegistry";
import type { FilterDef, FilterValue } from "@/lib/filters/types";
import FilterChip from "./FilterChip";
import AddFilterPalette from "./AddFilterPalette";
import { Popover } from "@/components/ui/popover";
import { formatResultNudge } from "./filterNudge";

const LABEL = "text-[10px] font-semibold uppercase tracking-wider";

const freshDefault = (v: FilterValue): FilterValue =>
  Array.isArray(v) ? ([...v] as FilterValue) : v;

export default function FilterBar() {
  const {
    universalFilters,
    setUniversalFilter,
    addedFilterKeys,
    removeAddedFilter,
    searchResult,
    totalCount,
  } = useCommandCenterStore();
  const nudge = formatResultNudge(searchResult?.listings.length ?? 0, totalCount);

  // Pinned core chips, then any user-added chips (deduped, in add order).
  const addedDefs = addedFilterKeys
    .map((k) => FILTERS_BY_KEY[k])
    .filter((f): f is FilterDef => Boolean(f));
  const chips = [...CORE_FILTERS, ...addedDefs];

  return (
    <div className="no-scrollbar flex h-11 items-center gap-x-2 overflow-x-auto border-t border-slate-800 bg-slate-950 px-3">
      <span className={cn(LABEL, "shrink-0 text-slate-500")}>Filters</span>
      {chips.map((def) => (
        <FilterChip
          key={def.key}
          def={def}
          value={universalFilters[def.key] ?? def.defaultValue}
          onChange={(v) => setUniversalFilter(def.key, v)}
          onClear={() => {
            setUniversalFilter(def.key, freshDefault(def.defaultValue));
            if (!def.defaultPinned) removeAddedFilter(def.key);
          }}
        />
      ))}

      <Popover
        trigger={
          <span
            className={cn(
              LABEL,
              "flex shrink-0 cursor-pointer items-center gap-1 border border-dashed border-slate-700 px-2.5 py-1.5 text-slate-400 transition-colors hover:border-cyan-500/50 hover:text-cyan-300"
            )}
          >
            <Plus className="h-3 w-3" />
            Add filter
          </span>
        }
        className="p-2"
      >
        <AddFilterPalette />
      </Popover>

      <div className="ml-auto flex shrink-0 items-center pl-2">
        <span className={cn(LABEL, nudge.overflowing ? "text-amber-400" : "text-slate-400")}>
          {nudge.text}
        </span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2:** `npm run typecheck` + `npm run lint` + `npm run build`.

- [ ] **Step 3: Manual browser check** (`npm run dev` → `/properties`):
  1. The bar shows Price/Beds/Baths/Home Type + a dashed **"+ Add filter"**.
  2. Clicking "+ Add filter" opens the palette (portaled, not clipped); typing "base" narrows to Basement; categories show under Property.
  3. Picking **Basement** adds a chip; opening it shows options **with live counts** (e.g. `Finished 18,909`); selecting narrows the list.
  4. Clearing an added chip's `×` removes it from the bar; clearing a pinned chip keeps it.
  5. The nudge still updates.

- [ ] **Step 4: Commit** — `git commit -m "feat(filters): render added chips + Add-filter palette in FilterBar" -- src/components/CommandCenter/FilterBar.tsx`

---

## Task 7: Full verification

- [ ] `npm test` (all suites green, incl. the expanded registry tests) · `npm run typecheck` · `npm run lint` · `npm run build`.
- [ ] Confirm in-browser: adding 2-3 deeper filters AND-combines correctly with Price/Beds and the persona ribbon; counts reflect the current narrowing.

---

## Self-Review

**Coverage:** deeper field library (Task 1), added-chip state (Task 2), facet wiring (Task 3), counts UI (Task 4), palette (Task 5), bar integration (Task 6). **Placeholders:** none. **Type consistency:** `ALL_FILTERS`/`FACET_FIELDS`/`MORE_FILTERS` defined in Task 1 and consumed in 3/5/6; `addedFilterKeys`/`addFilter`/`removeAddedFilter` defined in Task 2, used in 5/6; `facetBy` defined in Task 3. **Note:** investor metrics (Cap Rate/DOM/etc.) intentionally stay in the persona ribbon — folding them into the bar (personas-as-presets) is the Phase 3 plan, not this one.
