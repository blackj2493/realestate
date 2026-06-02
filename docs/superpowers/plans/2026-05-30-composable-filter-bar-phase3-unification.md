# Composable Filter Bar — Phase 3: Unification (Personas-as-Presets) Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax. Pure-logic steps are TDD (Vitest, node-env — no jsdom, so UI is verified via typecheck/lint/build/manual, NOT render tests). Commit path-explicitly (`git commit -m "…" -- <paths>`) — the working tree is shared with concurrent writers; never `git add -A`/`.`.

**Goal:** Make the live `/properties` bar match the agreed capstone mockup — a gold **persona-preset chip**, the investor ribbon folded into inline **chips**, and a single composable bar — without touching the query pipeline or the bubble/lens persistence layer.

**Architecture:** *Chip-ify, don't migrate.* Keep `TerminalFilterState` + each persona's `buildFilterString` exactly as-is (they still drive the query in `page.tsx` and are serialized by bubbles/lenses). Render the active persona's `controls` as chips bound to the same `filters`/`setFilter` store slice the ribbon used. Replace the header segmented persona selector with a gold preset-chip dropdown. Remove `PersonaFilterBar`. `page.tsx` is **unchanged** — the investor chips write to `filters`, which `persona.buildFilterString(filters)` already reads.

**Why this is safe:** `buildFilterString` is persona-scoped (only emits clauses for its own controls), so a value set under one persona and hidden under another is never silently applied. No new Typesense fields — every investor clause already ships in the live ribbon today.

**Tech Stack:** Next.js 16 client components, Zustand v5, Radix Slider (`@/components/ui/slider`), the existing `Popover` (`@/components/ui/popover`), Tailwind (`pp-*`/slate-cyan terminal theme; **gold** = amber-400 family for the preset chip), Vitest.

**Out of scope (later phases):** `▦ Views ▾` save/share/alert dropdown (Phase 4 — the preset-chip dropdown is the "presets" half), Buy/Rent chip (lease changes price-floor + range semantics), deleting `TerminalFilterState`.

---

## File Structure

- **Modify** `src/lib/personas/personaConfig.ts` — add optional `short?`/`op?` to `ControlDef` variants; populate per control (concise chip labels). Additive; no behavior change.
- **Create** `src/components/CommandCenter/investorChip.ts` — pure helpers: `isControlActive`, `investorChipLabel`, `anyControlActive`.
- **Create** `src/components/CommandCenter/investorChip.test.ts` — Vitest unit tests for the helpers.
- **Create** `src/components/CommandCenter/InvestorChip.tsx` — renders one `ControlDef` as a chip (slider/range → Popover; toggle → inline).
- **Create** `src/components/CommandCenter/PresetChip.tsx` — gold persona-preset dropdown chip.
- **Modify** `src/components/ui/popover.tsx` — allow `children` to be a render function `(close) => node` (backward-compatible) so dropdown items can close the panel.
- **Modify** `src/lib/stores/commandCenterStore.ts` — add `clearAddedFilters()`.
- **Modify** `src/components/CommandCenter/FilterBar.tsx` — compose preset chip + basics + investor chips + added chips + Add-filter + clear-all + nudge.
- **Modify** `src/components/CommandCenter/TopCommandBar.tsx` — drop header segmented persona selector + the `<PersonaFilterBar />` mount.
- **Delete** `src/components/CommandCenter/PersonaFilterBar.tsx` — its only importer was `TopCommandBar`.

---

### Task 1: Concise chip labels on `ControlDef` + pure label helpers

**Files:**
- Modify: `src/lib/personas/personaConfig.ts` (the `ControlDef` union ~81-103 + each persona's `controls`)
- Create: `src/components/CommandCenter/investorChip.ts`
- Test: `src/components/CommandCenter/investorChip.test.ts`

- [ ] **Step 1: Extend `ControlDef` with optional `short`/`op` (additive).**

In `personaConfig.ts`, change the union to:

```ts
export type ControlDef =
  | {
      kind: "slider";
      key: NumericKey;
      label: string;
      short?: string;        // concise chip name, e.g. "Cap Rate"
      op?: "≥" | "≤";        // chip threshold direction (default "≥")
      min: number;
      max: number;
      step: number;
      format: (v: number) => string;
      accent: string;
    }
  | {
      kind: "range";
      minKey: NumericKey;
      maxKey: NumericKey;
      label: string;
      short?: string;
      min: number;
      max: number;
      step: number;
      format: (v: number) => string;
      accent: string;
    }
  | { kind: "toggle"; key: BoolKey; label: string; short?: string; accent: string };
```

- [ ] **Step 2: Populate `short`/`op` on each control** (add the new keys inline — do not change label/min/max/step/format/accent):

  - smart: minYield → `short: "Yield", op: "≥"`; trueDom range → `short: "True DOM"`; maxCapitalBurn → `short: "Capital Burn", op: "≤"`; zoningPotential toggle → `short: "Density Ready"`; duplexCandidate toggle → `short: "Duplex"`.
  - cashflow: minCapRate → `short: "Cap Rate", op: "≥"`; maxCarryCost → `short: "Carry Cost", op: "≤"`; minSurplusParking → `short: "Surplus Parking", op: "≥"`; duplexCandidate toggle → `short: "Suite / Duplex"`.
  - flippers: trueDom range → `short: "True DOM"`; minPriceDrop → `short: "Price Drop", op: "≥"`; maxCapitalBurn → `short: "Capital Burn", op: "≤"`; staleOnly toggle → `short: "Stale Only"`.
  - builders: minFrontage → `short: "Frontage", op: "≥"`; minLotSqft → `short: "Lot Size", op: "≥"`; minSurplusParking → `short: "Surplus Parking", op: "≥"`; zoningPotential toggle → `short: "Density Ready"`.

- [ ] **Step 3: Write the failing test** `investorChip.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isControlActive, investorChipLabel, anyControlActive } from "./investorChip";
import { defaultTerminalFilters, PERSONA_CONFIG } from "@/lib/personas/personaConfig";

const f = (patch: Partial<typeof defaultTerminalFilters> = {}) => ({ ...defaultTerminalFilters, ...patch });
const flippers = PERSONA_CONFIG.flippers.controls;
const priceDrop = flippers.find((c) => "key" in c && c.key === "minPriceDrop")!;
const trueDom = flippers.find((c) => c.kind === "range")!;
const stale = flippers.find((c) => "key" in c && c.key === "staleOnly")!;

describe("investorChip helpers", () => {
  it("slider inactive shows the short name only", () => {
    expect(isControlActive(priceDrop, f())).toBe(false);
    expect(investorChipLabel(priceDrop, f())).toBe("Price Drop");
  });
  it("slider active shows short + op + formatted value", () => {
    expect(isControlActive(priceDrop, f({ minPriceDrop: 50000 }))).toBe(true);
    expect(investorChipLabel(priceDrop, f({ minPriceDrop: 50000 }))).toBe("Price Drop ≥ $50k");
  });
  it("range with only min moved shows ≥", () => {
    expect(investorChipLabel(trueDom, f({ trueDomMin: 60 }))).toBe("True DOM ≥ 60d");
  });
  it("range with only max moved shows ≤", () => {
    expect(investorChipLabel(trueDom, f({ trueDomMax: 90 }))).toBe("True DOM ≤ 90d");
  });
  it("range with both moved shows a span", () => {
    expect(investorChipLabel(trueDom, f({ trueDomMin: 60, trueDomMax: 180 }))).toBe("True DOM 60d–180d");
  });
  it("toggle shows the short name; active flips isActive", () => {
    expect(investorChipLabel(stale, f())).toBe("Stale Only");
    expect(isControlActive(stale, f({ staleOnly: true }))).toBe(true);
  });
  it("anyControlActive is true when one control differs from default", () => {
    expect(anyControlActive(flippers, f())).toBe(false);
    expect(anyControlActive(flippers, f({ staleOnly: true }))).toBe(true);
  });
});
```

- [ ] **Step 4: Run it — expect FAIL** (`investorChip.ts` not found):
  `npx vitest run src/components/CommandCenter/investorChip.test.ts`

- [ ] **Step 5: Implement `investorChip.ts`:**

```ts
import {
  defaultTerminalFilters,
  type ControlDef,
  type TerminalFilterState,
} from "@/lib/personas/personaConfig";

/** True when a control's bound value(s) differ from the terminal defaults. */
export function isControlActive(c: ControlDef, f: TerminalFilterState): boolean {
  if (c.kind === "slider") return f[c.key] !== defaultTerminalFilters[c.key];
  if (c.kind === "range")
    return (
      f[c.minKey] !== defaultTerminalFilters[c.minKey] ||
      f[c.maxKey] !== defaultTerminalFilters[c.maxKey]
    );
  return f[c.key] !== defaultTerminalFilters[c.key];
}

/** Concise chip text: "Cap Rate ≥ 5%", "True DOM 60d–180d", "Stale Only". */
export function investorChipLabel(c: ControlDef, f: TerminalFilterState): string {
  if (c.kind === "toggle") return c.short ?? c.label;

  if (c.kind === "slider") {
    const name = c.short ?? c.label;
    if (f[c.key] === defaultTerminalFilters[c.key]) return name;
    return `${name} ${c.op ?? "≥"} ${c.format(f[c.key])}`;
  }

  // range
  const name = c.short ?? c.label;
  const lo = f[c.minKey];
  const hi = f[c.maxKey];
  const loActive = lo !== defaultTerminalFilters[c.minKey];
  const hiActive = hi !== defaultTerminalFilters[c.maxKey];
  if (!loActive && !hiActive) return name;
  if (loActive && hiActive) return `${name} ${c.format(lo)}–${c.format(hi)}`;
  if (loActive) return `${name} ≥ ${c.format(lo)}`;
  return `${name} ≤ ${c.format(hi)}`;
}

/** True when any of a persona's controls is non-default. */
export function anyControlActive(controls: ControlDef[], f: TerminalFilterState): boolean {
  return controls.some((c) => isControlActive(c, f));
}
```

- [ ] **Step 6: Run it — expect PASS.** Then `npx vitest run` (full suite green).

- [ ] **Step 7: Commit** (path-explicit):
```bash
git commit -m "feat(filters): concise investor chip-label helpers + ControlDef short/op" -- src/lib/personas/personaConfig.ts src/components/CommandCenter/investorChip.ts src/components/CommandCenter/investorChip.test.ts
```

---

### Task 2: `Popover` render-function children (close-on-select)

**Files:**
- Modify: `src/components/ui/popover.tsx`

- [ ] **Step 1: Allow `children` to be `ReactNode | ((close) => ReactNode)`.** Change the prop type and the render site only:

```ts
interface PopoverProps {
  trigger: React.ReactNode;
  children: React.ReactNode | ((close: () => void) => React.ReactNode);
  className?: string;
  align?: "left" | "right";
}
```

In the portal body, replace `{children}` with:

```tsx
{typeof children === "function" ? children(() => setOpen(false)) : children}
```

This is backward-compatible — every existing `ReactNode` child still renders unchanged.

- [ ] **Step 2: Verify** `npx tsc --noEmit` clean (existing Popover callers untouched).

- [ ] **Step 3: Commit:**
```bash
git commit -m "feat(ui): Popover supports render-fn children for close-on-select" -- src/components/ui/popover.tsx
```

---

### Task 3: `InvestorChip` component

**Files:**
- Create: `src/components/CommandCenter/InvestorChip.tsx`

- [ ] **Step 1: Implement** (slider/range open a Popover slider; toggle flips inline; `×` clears to default):

```tsx
"use client";

import React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Slider } from "@/components/ui/slider";
import { Popover } from "@/components/ui/popover";
import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";
import { defaultTerminalFilters, type ControlDef } from "@/lib/personas/personaConfig";
import { isControlActive, investorChipLabel } from "./investorChip";

const LABEL = "text-[10px] font-semibold uppercase tracking-wider";

const chipClass = (active: boolean) =>
  cn(
    "flex shrink-0 cursor-pointer items-center gap-1.5 border px-2.5 py-1.5 transition-all",
    LABEL,
    active
      ? "border-cyan-500/50 bg-cyan-500/10 text-cyan-300"
      : "border-slate-800 bg-slate-900 text-slate-400 hover:border-slate-700 hover:text-slate-200"
  );

export default function InvestorChip({ control }: { control: ControlDef }) {
  const { filters, setFilter } = useCommandCenterStore();
  const active = isControlActive(control, filters);
  const text = investorChipLabel(control, filters);

  if (control.kind === "toggle") {
    return (
      <button className={chipClass(active)} onClick={() => setFilter(control.key, !filters[control.key])}>
        <span className={cn("h-1.5 w-1.5", active ? "bg-cyan-400" : "bg-slate-600")} />
        {text}
      </button>
    );
  }

  const clear = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (control.kind === "slider") {
      setFilter(control.key, defaultTerminalFilters[control.key]);
    } else {
      setFilter(control.minKey, defaultTerminalFilters[control.minKey]);
      setFilter(control.maxKey, defaultTerminalFilters[control.maxKey]);
    }
  };

  const valueText =
    control.kind === "slider"
      ? control.format(filters[control.key])
      : `${control.format(filters[control.minKey])}–${control.format(filters[control.maxKey])}`;

  const trigger = (
    <span className={chipClass(active)}>
      {text}
      {active && <X className="h-3 w-3 opacity-70 hover:opacity-100" onClick={clear} />}
    </span>
  );

  return (
    <Popover trigger={trigger} className="w-56">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className={cn(LABEL, "text-slate-400")}>{control.label}</span>
          <span className="font-mono text-xs text-cyan-400">{valueText}</span>
        </div>
        {control.kind === "slider" ? (
          <Slider
            value={[filters[control.key]]}
            min={control.min}
            max={control.max}
            step={control.step}
            onValueChange={([v]) => setFilter(control.key, v)}
          />
        ) : (
          <Slider
            value={[filters[control.minKey], filters[control.maxKey]]}
            min={control.min}
            max={control.max}
            step={control.step}
            onValueChange={([lo, hi]) => {
              setFilter(control.minKey, lo);
              setFilter(control.maxKey, hi);
            }}
          />
        )}
      </div>
    </Popover>
  );
}
```

- [ ] **Step 2: Verify** `npx tsc --noEmit` clean.

- [ ] **Step 3: Commit** with Task 4 (PresetChip) — both are leaf components committed together to keep the tree compiling between commits.

---

### Task 4: `PresetChip` component (gold persona dropdown)

**Files:**
- Create: `src/components/CommandCenter/PresetChip.tsx`

- [ ] **Step 1: Implement** (gold/amber chip; dropdown lists the four personas; selecting sets persona and closes):

```tsx
"use client";

import React from "react";
import { ChevronDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover } from "@/components/ui/popover";
import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";
import { PERSONA_LIST, PERSONA_CONFIG } from "@/lib/personas/personaConfig";

const LABEL = "text-[10px] font-semibold uppercase tracking-wider";

export default function PresetChip() {
  const { activePersona, setActivePersona } = useCommandCenterStore();
  const active = PERSONA_CONFIG[activePersona];
  const ActiveIcon = active.icon;

  const trigger = (
    <span
      className={cn(
        LABEL,
        "flex shrink-0 cursor-pointer items-center gap-1.5 border border-amber-400/50 bg-amber-400/10 px-2.5 py-1.5 text-amber-300 transition-colors hover:border-amber-300/70 hover:bg-amber-400/20"
      )}
    >
      <ActiveIcon className="h-3.5 w-3.5" />
      {active.label}
      <ChevronDown className="h-3 w-3 opacity-70" />
    </span>
  );

  return (
    <Popover trigger={trigger} className="w-56 p-1">
      {(close) => (
        <div className="flex flex-col">
          <span className={cn(LABEL, "px-2 py-1.5 text-slate-500")}>Preset</span>
          {PERSONA_LIST.map((p) => {
            const Icon = p.icon;
            const selected = p.id === activePersona;
            return (
              <button
                key={p.id}
                onClick={() => {
                  setActivePersona(p.id);
                  close();
                }}
                className={cn(
                  "flex items-center justify-between gap-2 px-2 py-1.5 text-left text-xs transition-colors",
                  selected ? "text-amber-300" : "text-slate-300 hover:bg-amber-400/10 hover:text-amber-200"
                )}
              >
                <span className="flex items-center gap-2">
                  <Icon className="h-3.5 w-3.5" />
                  {p.label}
                </span>
                {selected && <Check className="h-3.5 w-3.5" />}
              </button>
            );
          })}
        </div>
      )}
    </Popover>
  );
}
```

- [ ] **Step 2: Verify** `npx tsc --noEmit` clean.

- [ ] **Step 3: Commit** (InvestorChip + PresetChip together):
```bash
git commit -m "feat(filters): InvestorChip + gold PresetChip (persona dropdown)" -- src/components/CommandCenter/InvestorChip.tsx src/components/CommandCenter/PresetChip.tsx
```

---

### Task 5: Store — `clearAddedFilters`

**Files:**
- Modify: `src/lib/stores/commandCenterStore.ts` (interface ~96-99 + impl ~223-231)

- [ ] **Step 1: Add to the interface** (next to `removeAddedFilter`):
```ts
  clearAddedFilters: () => void;
```

- [ ] **Step 2: Add to the implementation** (next to `removeAddedFilter`):
```ts
  clearAddedFilters: () => set({ addedFilterKeys: [] }),
```

- [ ] **Step 3: Verify** `npx tsc --noEmit` clean. **Commit** with Task 6 (FilterBar uses it).

---

### Task 6: `FilterBar` — unified composition

**Files:**
- Modify: `src/components/CommandCenter/FilterBar.tsx`

- [ ] **Step 1: Rewrite** so the bar reads, left→right: gold **PresetChip** · basics (`CORE_FILTERS`) · divider · **investor chips** (active persona controls) · user-added chips · **+ Add filter** · (right) **Clear all** (when anything active) · **nudge**.

```tsx
"use client";

import React from "react";
import { Plus, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";
import { CORE_FILTERS, FILTERS_BY_KEY } from "@/lib/filters/filterRegistry";
import { PERSONA_CONFIG, defaultTerminalFilters } from "@/lib/personas/personaConfig";
import type { FilterDef, FilterValue } from "@/lib/filters/types";
import FilterChip from "./FilterChip";
import InvestorChip from "./InvestorChip";
import PresetChip from "./PresetChip";
import AddFilterPalette from "./AddFilterPalette";
import { Popover } from "@/components/ui/popover";
import { formatResultNudge } from "./filterNudge";
import { anyControlActive } from "./investorChip";

const LABEL = "text-[10px] font-semibold uppercase tracking-wider";

const freshDefault = (v: FilterValue): FilterValue =>
  Array.isArray(v) ? ([...v] as FilterValue) : v;

export default function FilterBar() {
  const {
    universalFilters,
    setUniversalFilter,
    resetUniversalFilters,
    addedFilterKeys,
    removeAddedFilter,
    clearAddedFilters,
    searchResult,
    totalCount,
    activePersona,
    filters,
    setFilters,
  } = useCommandCenterStore();

  const nudge = formatResultNudge(searchResult?.listings.length ?? 0, totalCount);
  const controls = PERSONA_CONFIG[activePersona].controls;

  const addedDefs = addedFilterKeys
    .map((k) => FILTERS_BY_KEY[k])
    .filter((f): f is FilterDef => Boolean(f));

  const universalActive =
    CORE_FILTERS.some((d) => d.isActive(universalFilters[d.key] ?? d.defaultValue)) ||
    addedDefs.some((d) => d.isActive(universalFilters[d.key] ?? d.defaultValue));
  const investorActive = anyControlActive(controls, filters);
  const anyActive = universalActive || investorActive;

  const clearAll = () => {
    setFilters({ ...defaultTerminalFilters });
    resetUniversalFilters();
    clearAddedFilters();
  };

  return (
    <div className="no-scrollbar flex h-11 items-center gap-x-2 overflow-x-auto border-t border-slate-800 bg-slate-950 px-3">
      <PresetChip />
      <div className="h-5 w-px shrink-0 bg-slate-800" />

      {CORE_FILTERS.map((def) => (
        <FilterChip
          key={def.key}
          def={def}
          value={universalFilters[def.key] ?? def.defaultValue}
          onChange={(v) => setUniversalFilter(def.key, v)}
          onClear={() => setUniversalFilter(def.key, freshDefault(def.defaultValue))}
        />
      ))}

      <div className="h-5 w-px shrink-0 bg-slate-800" />
      {controls.map((c, i) => (
        <InvestorChip key={`${activePersona}-${i}`} control={c} />
      ))}

      {addedDefs.map((def) => (
        <FilterChip
          key={def.key}
          def={def}
          value={universalFilters[def.key] ?? def.defaultValue}
          onChange={(v) => setUniversalFilter(def.key, v)}
          onClear={() => {
            setUniversalFilter(def.key, freshDefault(def.defaultValue));
            removeAddedFilter(def.key);
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

      <div className="ml-auto flex shrink-0 items-center gap-3 pl-2">
        {anyActive && (
          <button
            onClick={clearAll}
            className={cn(
              LABEL,
              "flex items-center gap-1.5 border border-slate-700 px-2 py-1 text-slate-300 transition-colors hover:border-cyan-500/50 hover:text-cyan-300"
            )}
          >
            Clear
            <RotateCcw className="h-3 w-3" />
          </button>
        )}
        <span className={cn(LABEL, nudge.overflowing ? "text-amber-400" : "text-slate-400")}>
          {nudge.text}
        </span>
      </div>
    </div>
  );
}
```

Notes: `clearAll` uses `setFilters(defaultTerminalFilters)` (resets investor values only — leaves `commute`/`school` map lenses intact, unlike the old ribbon's `resetFilters`). The investor-chip `key` is `${activePersona}-${i}` so the chip set re-keys cleanly on persona switch.

- [ ] **Step 2: Verify** `npx tsc --noEmit` clean.

- [ ] **Step 3: Commit** (FilterBar + the store action it needs):
```bash
git commit -m "feat(filters): unified bar — preset chip + investor chips + clear-all" -- src/components/CommandCenter/FilterBar.tsx src/lib/stores/commandCenterStore.ts
```

---

### Task 7: `TopCommandBar` — drop the header persona selector + ribbon mount

**Files:**
- Modify: `src/components/CommandCenter/TopCommandBar.tsx`
- Delete: `src/components/CommandCenter/PersonaFilterBar.tsx`

- [ ] **Step 1: Remove** from `TopCommandBar.tsx`: the `PersonaFilterBar` import + its `<PersonaFilterBar />` mount; the center segmented persona-selector block (the `[ Persona: ]` label + the `PERSONA_LIST.map(...)` segmented buttons); and now-unused imports (`PERSONA_LIST`, `PERSONA_SHORT` const, `PersonaType` if unused). Keep: logo, `PrimaryNav`, `LocationSearch`, the right-side `WatchlistAlertsBell`, and the `<FilterBar />` mount. Resulting body:

```tsx
  return (
    <div className={cn("border-b border-slate-800 bg-slate-950", className)}>
      {/* Context bar */}
      <div className="flex h-12 items-center gap-4 px-4">
        <div className="flex shrink-0 items-center gap-3">
          <Link href="/" className="flex shrink-0 items-center px-3 py-1.5" aria-label="PureProperty.ca home">
            <Logo size="md" theme="dark" />
          </Link>
          <PrimaryNav variant="compact" className="hidden sm:flex" />
          <LocationSearch className="w-56 lg:w-64" />
        </div>

        <div className="flex-1" />

        <div className="flex shrink-0 items-center justify-end gap-3">
          <WatchlistAlertsBell />
        </div>
      </div>

      {/* Unified composable filter bar (preset + basics + investor + add) */}
      <FilterBar />
    </div>
  );
```

Also drop the now-unused `useCommandCenterStore`/`PersonaType` destructure (`activePersona`/`setActivePersona` are no longer read here — they move into `PresetChip`). Remove the `PERSONA_SHORT` map. Leave the file's other imports that are still used.

- [ ] **Step 2: Delete** `src/components/CommandCenter/PersonaFilterBar.tsx`.

- [ ] **Step 3: Verify nothing else imports it:**
  `grep -r "PersonaFilterBar" src` → no matches.

- [ ] **Step 4: Full verification:**
```bash
npx tsc --noEmit          # clean
npm run lint              # clean (no unused imports left behind)
npx vitest run            # all green
npm run build             # compiles
```

- [ ] **Step 5: Commit:**
```bash
git commit -m "feat(filters): retire persona ribbon + header selector for unified bar" -- src/components/CommandCenter/TopCommandBar.tsx src/components/CommandCenter/PersonaFilterBar.tsx
```

---

## Self-Review

- **Spec coverage:** preset chip (Task 4) + investor chips (Tasks 1-3,6) + one bar replacing the ribbon (Tasks 6-7) = the mockup's persona-preset + investor-metric chips + unified bar (design §3.5, §5). `▦ Views ▾` save/share/alert and Buy/Rent are explicitly deferred.
- **No placeholders:** every code step is complete and copy-pasteable.
- **Type consistency:** `isControlActive`/`investorChipLabel`/`anyControlActive` signatures match across Tasks 1, 3, 6; `clearAddedFilters` defined (Task 5) before use (Task 6); `Popover` render-fn (Task 2) used by `PresetChip` (Task 4).
- **Risk guards:** `page.tsx` query pipeline unchanged; `TerminalFilterState` + `buildFilterString` + bubble/lens persistence untouched; clear-all leaves `commute`/`school` lenses intact; investor values are persona-scoped so hidden values never silently filter.
