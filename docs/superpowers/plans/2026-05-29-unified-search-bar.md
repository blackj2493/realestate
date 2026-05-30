# Unified Search Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `/properties` terminal's Typesense autocomplete search bar (`LocationSearch`) the search bar on every app page, navigating into the terminal/listing off-terminal instead of mutating in-place state.

**Architecture:** Add a pure, unit-tested helper (`src/lib/search/searchTarget.ts`) that classifies a search commit into a mode-independent `SearchTarget` and renders a route for navigate mode. `LocationSearch` consumes it and gains a `mode` prop: `"inplace"` (default — today's `commandCenterStore` behavior on `/properties`) and `"navigate"` (used by `AppHeader` — `router.push` into `/properties?city=…` or `/properties/<ListingKey>`). The weak plain-input in `AppHeader` is replaced by `<LocationSearch mode="navigate" />`, and the orphaned `SearchDropdown.tsx` is deleted.

**Tech Stack:** Next.js (App Router), React client components, Zustand (`commandCenterStore`), Typesense (`suggestSearch`), vitest (node env), Tailwind.

---

## File Structure

- **Create** `src/lib/search/searchTarget.ts` — pure resolver + href builder. One responsibility: turn a chosen suggestion / free text into a `SearchTarget`, and a target into a route. No React, no store, no Typesense calls — trivially unit-testable in the node env.
- **Create** `src/lib/search/searchTarget.test.ts` — vitest unit tests for the resolver and href builder.
- **Modify** `src/components/CommandCenter/LocationSearch.tsx` — add `mode` prop + `useRouter`; route commits through the helper. `inplace` branch stays behaviorally identical.
- **Modify** `src/components/layout/AppHeader.tsx` — replace the plain `<form>/<input>` with `<LocationSearch mode="navigate" />`; drop now-unused state/imports.
- **Delete** `src/components/SearchDropdown.tsx` — 680-line orphan.

---

### Task 1: Pure search-target resolver

**Files:**
- Create: `src/lib/search/searchTarget.ts`
- Test: `src/lib/search/searchTarget.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/search/searchTarget.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { SearchSuggestion } from '@/lib/typesense/client';
import {
  resolveSuggestionTarget,
  resolveTextTarget,
  targetToHref,
} from './searchTarget';

// Minimal ListingDocument stand-in — only `id` matters to these functions.
const listing = { id: 'W12632618' } as unknown as NonNullable<SearchSuggestion['listing']>;

describe('resolveSuggestionTarget', () => {
  it('opens the listing for an address suggestion that carries a listing', () => {
    const s: SearchSuggestion = { kind: 'address', label: '40 Rampart Dr', listing };
    expect(resolveSuggestionTarget(s)).toEqual({ action: 'open-listing', listing });
  });

  it('opens the listing for an MLS suggestion', () => {
    const s: SearchSuggestion = { kind: 'mls', label: 'W12632618', listing };
    expect(resolveSuggestionTarget(s)).toEqual({ action: 'open-listing', listing });
  });

  it('sets location for a city suggestion', () => {
    const s: SearchSuggestion = { kind: 'city', label: 'Hamilton', count: 1200 };
    expect(resolveSuggestionTarget(s)).toEqual({ action: 'set-location', label: 'Hamilton' });
  });

  it('sets location for a neighbourhood suggestion', () => {
    const s: SearchSuggestion = { kind: 'neighbourhood', label: 'Vales of Castlemore' };
    expect(resolveSuggestionTarget(s)).toEqual({
      action: 'set-location',
      label: 'Vales of Castlemore',
    });
  });

  it('falls back to location when an address suggestion has no listing', () => {
    const s: SearchSuggestion = { kind: 'address', label: '40 Rampart Dr' };
    expect(resolveSuggestionTarget(s)).toEqual({ action: 'set-location', label: '40 Rampart Dr' });
  });

  it('trims the location label', () => {
    const s: SearchSuggestion = { kind: 'city', label: '  Hamilton  ' };
    expect(resolveSuggestionTarget(s)).toEqual({ action: 'set-location', label: 'Hamilton' });
  });
});

describe('resolveTextTarget', () => {
  it('treats free-typed text as a location search and trims it', () => {
    expect(resolveTextTarget('  Brampton ')).toEqual({ action: 'set-location', label: 'Brampton' });
  });
});

describe('targetToHref', () => {
  it('routes a listing target to the detail page by id', () => {
    expect(targetToHref({ action: 'open-listing', listing })).toBe('/properties/W12632618');
  });

  it('routes a location target to /properties?city= with encoding', () => {
    expect(targetToHref({ action: 'set-location', label: 'St. Catharines' })).toBe(
      '/properties?city=St.%20Catharines',
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/search/searchTarget.test.ts`
Expected: FAIL — `Failed to resolve import "./searchTarget"` (module does not exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/search/searchTarget.ts`:

```ts
/**
 * Pure routing logic for the unified search bar. Classifies a chosen
 * suggestion (or free-typed text) into a mode-independent SearchTarget, and
 * renders a target into a route for navigate mode. No React / store / network —
 * the component decides how to APPLY a target (in-place store write vs router.push).
 */

import type { SearchSuggestion } from '@/lib/typesense/client';

export type SearchTarget =
  | { action: 'open-listing'; listing: NonNullable<SearchSuggestion['listing']> }
  | { action: 'set-location'; label: string };

/** A chosen suggestion: address/MLS with a listing opens it; everything else is a place. */
export function resolveSuggestionTarget(s: SearchSuggestion): SearchTarget {
  if ((s.kind === 'address' || s.kind === 'mls') && s.listing) {
    return { action: 'open-listing', listing: s.listing };
  }
  return { action: 'set-location', label: s.label.trim() };
}

/** Free-typed text (no suggestion chosen) is always a location search. */
export function resolveTextTarget(text: string): SearchTarget {
  return { action: 'set-location', label: text.trim() };
}

/** navigate-mode only: turn a target into a route into the terminal / listing. */
export function targetToHref(t: SearchTarget): string {
  return t.action === 'open-listing'
    ? `/properties/${t.listing.id}`
    : `/properties?city=${encodeURIComponent(t.label)}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/search/searchTarget.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/search/searchTarget.ts src/lib/search/searchTarget.test.ts
git commit -m "feat(search): pure search-target resolver for unified search bar"
```

---

### Task 2: Add `mode` to LocationSearch and route commits through the resolver

**Files:**
- Modify: `src/components/CommandCenter/LocationSearch.tsx`

This task is component wiring. There is no React Testing Library in this repo (vitest runs in a `node` env, `.ts` only), so verification is `typecheck` + `lint` + Task 1's unit tests. The `inplace` branch must stay behaviorally identical to today.

- [ ] **Step 1: Update imports and props**

In `src/components/CommandCenter/LocationSearch.tsx`, add the router and helper imports near the top (after the existing `suggestSearch` import on line 22):

```ts
import { useRouter } from "next/navigation";
import { resolveSuggestionTarget, resolveTextTarget, targetToHref, type SearchTarget } from "@/lib/search/searchTarget";
```

Change the props interface (lines 24-26) to add `mode`:

```ts
interface LocationSearchProps {
  className?: string;
  /** "inplace" (default): mutate commandCenterStore (terminal reacts live).
   *  "navigate": router.push into /properties or the listing detail page. */
  mode?: "inplace" | "navigate";
}
```

Update the component signature (line 41) and add the router (after line 45, the `setSelectedProperty` selector):

```ts
export default function LocationSearch({ className, mode = "inplace" }: LocationSearchProps) {
  const location = useCommandCenterStore((s) => s.location);
  const setLocation = useCommandCenterStore((s) => s.setLocation);
  const totalCount = useCommandCenterStore((s) => s.totalCount);
  const setSelectedProperty = useCommandCenterStore((s) => s.setSelectedProperty);
  const router = useRouter();
```

- [ ] **Step 2: Add a single `applyTarget` that branches on mode**

Replace the existing `commitLocation` (lines 95-100) and `select` (lines 102-111) functions with one shared applier plus thin call sites:

```ts
  // Apply a resolved target. navigate mode routes; inplace mode mutates the store
  // exactly as before (city → setLocation, listing → setSelectedProperty).
  const applyTarget = (t: SearchTarget) => {
    if (mode === "navigate") {
      router.push(targetToHref(t));
    } else if (t.action === "open-listing") {
      setSelectedProperty(t.listing); // opens the in-page listing terminal
    } else {
      setLocation(t.label); // drives the existing debounced search
    }
    setValue("");
    closeAndBlur();
  };

  // Act on a chosen suggestion.
  const select = (s: SearchSuggestion) => applyTarget(resolveSuggestionTarget(s));
```

Note: `closeAndBlur` is defined at lines 89-93 and stays as-is. The old `commitLocation` is now gone — its remaining caller (`onSubmit`) is updated in the next step.

- [ ] **Step 3: Update the free-typed submit path**

In `onSubmit` (lines 134-141), replace the `commitLocation(value)` call with the resolver path:

```ts
  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (open && highlight >= 0 && highlight < suggestions.length) {
      select(suggestions[highlight]);
    } else if (value.trim()) {
      applyTarget(resolveTextTarget(value));
    }
  };
```

Leave `clear()` (lines 113-119) unchanged: in navigate mode `location` is the store default (empty) so `setLocation("")` is a harmless no-op, and the `X` button still clears the typed value.

- [ ] **Step 4: Typecheck and run unit tests**

Run: `npm run typecheck`
Expected: no errors.

Run: `npm test -- src/lib/search/searchTarget.test.ts`
Expected: PASS (still green — resolver unchanged).

- [ ] **Step 5: Lint the changed file**

Run: `npm run lint`
Expected: no errors for `LocationSearch.tsx` (no unused `commitLocation`, no unused imports).

- [ ] **Step 6: Commit**

```bash
git add src/components/CommandCenter/LocationSearch.tsx
git commit -m "feat(search): add navigate mode to LocationSearch via target resolver"
```

---

### Task 3: Swap AppHeader to the unified search bar

**Files:**
- Modify: `src/components/layout/AppHeader.tsx`

- [ ] **Step 1: Replace the plain input with LocationSearch**

In `src/components/layout/AppHeader.tsx`:

Remove the now-unused imports `useState` (line 3), `useRouter` (line 4), and `Search` (line 6). Add the LocationSearch import:

```ts
import LocationSearch from "@/components/CommandCenter/LocationSearch";
```

Delete the local `q` state and `submit` handler (lines 36 and 39-43): the `const [q, setQ] = useState("");` line and the entire `const submit = (e) => {…};` block. Keep the `home` line (line 37).

Replace the `{search && ( … )}` form block (lines 52-62) with:

```tsx
        {search && <LocationSearch mode="navigate" className="max-w-xl flex-1" />}
```

Keep everything else: the `search` prop gate, the `{!search && <div className="flex-1" />}` spacer (line 65), and the right cluster (lines 67-71).

- [ ] **Step 2: Update the doc comment**

The header doc comment (lines 11-20) says "this search just routes to /properties?q=." Replace that sentence so it reads:

```
 * page with no provider. Off the terminal the shared LocationSearch runs in
 * "navigate" mode — it router.pushes to /properties?city= or the listing
 * detail page rather than writing to commandCenterStore.
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors (no dangling `q`, `useState`, `useRouter`, or `Search` references).

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: no errors — confirms no unused imports remain in `AppHeader.tsx`.

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/AppHeader.tsx
git commit -m "feat(search): use unified LocationSearch in AppHeader (navigate mode)"
```

---

### Task 4: Delete the orphaned SearchDropdown

**Files:**
- Delete: `src/components/SearchDropdown.tsx`
- Modify: `src/components/CommandCenter/LocationSearch.tsx` (doc comment only)

- [ ] **Step 1: Confirm it is imported nowhere**

Run: `git grep -n "SearchDropdown" -- src ':!src/components/SearchDropdown.tsx'`
Expected: exactly one hit — the doc comment in `LocationSearch.tsx` line ~4 (`the old (orphaned) SearchDropdown`). If any real `import` of `SearchDropdown` appears, STOP and do not delete.

- [ ] **Step 2: Delete the file**

Run: `git rm src/components/SearchDropdown.tsx`

- [ ] **Step 3: Remove the stale reference in the doc comment**

In `src/components/CommandCenter/LocationSearch.tsx`, edit the opening doc comment (lines 4-5) so it no longer names SearchDropdown. Change:

```
 * Restores the autocomplete the old (orphaned) SearchDropdown provided, but native
 * to the dark terminal. A debounced Typesense query surfaces, in priority order:
```

to:

```
 * A debounced Typesense query surfaces, in priority order:
```

- [ ] **Step 4: Typecheck and lint**

Run: `npm run typecheck`
Expected: no errors (nothing referenced the deleted file).

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(search): delete orphaned SearchDropdown component"
```

---

### Task 5: Full build + manual verification

**Files:** none (verification only)

- [ ] **Step 1: Production build**

Run: `npm run build`
Expected: build succeeds with no type or lint errors.

- [ ] **Step 2: Manual smoke test**

Run: `npm run dev`, then check each of:

- [ ] On `/dashboard`: type ≥2 chars (e.g. `Ham`) → Typesense dropdown appears with suggestions and live counts; ArrowDown + Enter selects.
- [ ] On `/dashboard`, pick a **city** (e.g. Hamilton) → lands on `/properties?city=Hamilton` with the terminal map/ledger filtered to that location.
- [ ] On `/dashboard`, pick a specific **address or MLS#** → lands on `/properties/<ListingKey>` (the detail page).
- [ ] Repeat the dropdown check on `/avm`, `/analytics`, `/listings` — autocomplete works on each.
- [ ] On `/properties` (the terminal): `TopCommandBar` search is **unchanged** — a city pick filters in place (no navigation), an address/MLS pick opens the in-page listing terminal.

- [ ] **Step 3: Commit (only if any fixes were needed)**

If the smoke test surfaced a fix, commit it:

```bash
git add -A
git commit -m "fix(search): <describe the fix>"
```

If no fixes were needed, nothing to commit — the feature is complete.

---

## Notes for the implementer

- `SearchSuggestion` and `ListingDocument` live in `src/lib/typesense/client.ts`. `ListingDocument.id` is the TRREB ListingKey (its line ~46 comment: `// Maps to ListingKey`), which is the segment the `(app)/properties/[id]` detail route expects.
- `LocationSearch` is a **default export**; import it without braces.
- `commandCenterStore` is a self-standing Zustand singleton — reading its selectors in `AppHeader` (off-terminal) is safe with no provider, the same way `WatchlistAlertsBell` already mounts there.
- Do not add a live total-count fetch to the header (YAGNI). Off-terminal `totalCount` is 0, so the placeholder correctly falls back to `"Search city, neighbourhood, address, or MLS#…"`.
