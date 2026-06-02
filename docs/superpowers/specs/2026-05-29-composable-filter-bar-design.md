# Composable Filter Bar for `/properties` — Design Spec

- **Date:** 2026-05-29
- **Status:** Approved (brainstorm complete) → ready for implementation plan
- **Author:** Brainstormed with the user via the visual companion
- **Implementation branch:** create a dedicated `feat/composable-filter-bar` off `main` (the current `feat/avm-value-add-engine` branch holds unrelated AVM WIP and must not absorb this work).

---

## 1. Context & Problem

The `/properties` "Command Center" terminal already has filtering, but **not the conventional bar every competitor has**. Today filtering is:

- **Persona ribbon** (`src/components/CommandCenter/PersonaFilterBar.tsx`, rendered by `TopCommandBar.tsx`) — persona-specific investor sliders/toggles (cap rate, True DOM, carry cost, etc.) pulled from `PERSONA_CONFIG[persona].controls`.
- **Map drawers** (`MapControlRail.tsx` → `MapDrawer.tsx`) — commute isochrone, school score/proximity, color-by metric, freehand draw; one open at a time via `store.activeModule`.
- **Geo lenses** — commute polygon, draw polygon, viewport bounds, legend-band click.

**Genuinely absent as user controls:** price range, beds, baths, property type/subtype, square footage, and Buy-vs-Rent (TransactionType). There are no multi-select facets and no facet counts (`facet_counts` is never requested by the terminal search).

**Goal:** add the missing universal layer in a way that is *measurably better* than HouseSigma / Realtor.ca (CLAUDE.md §10), not merely equivalent.

All terminal queries go to **Typesense only** (CLAUDE.md §5) — no DB, no intermediate API. New filters plug into the existing search pipeline with **no API contract change**.

---

## 2. Goals / Non-Goals

**Goals**
- A single, always-visible **composable filter bar** carrying the basics by default, with any deeper field addable on demand.
- A discoverable + fast **"+ Add filter"** surface exposing the full (real, populated) field library.
- **Saved Views**: name and restore the entire search state; local for anonymous users, synced + shareable for signed-in users.
- **View-powered alerts**: a saved View can email new matches nightly.
- Turn the **100-result TRREB cap into a UX feature** ("100 of 340 — narrow further").
- Unify **personas and saved views** into one mechanism.

**Non-Goals**
- No change to the 100-result cap or pagination model (compliance, CLAUDE.md §4).
- No filters built on known-empty/unreliable fields (see §10 exclusions).
- No raw IDX/VOW data through any LLM (CLAUDE.md §4) — all filtering/counting is deterministic Typesense.
- No faceting of high-cardinality (`PostalCode`) or numeric fields (RAM policy).
- Portfolio/owned-asset features are out of scope (watchlist stays monitor-only).

---

## 3. Decisions Locked in Brainstorm

1. **Direction: Composable Instrument Bar** (over a two-tier stack or a conventional "More Filters" panel). One bar; basics are default chips; everything else is addable; the whole set saves as a View.
2. **"+ Add filter" surface: Hybrid** — a search box on top with browsable categories below that narrow as you type (Linear/Notion pattern). Serves discovery and speed from one surface.
3. **Saved Views: tiered, now (not deferred)** — anonymous → `localStorage`; signed-in → account-synced + shareable link.
4. **Alerts: in scope** — a View can be toggled to alert; built as the final phase, but the View data shape supports it from day one.
5. **Personas = built-in preset Views** — the new bar replaces the persona slider-ribbon; a persona becomes a "factory preset" that pins a starter chip-set + sort + color metric. System presets and user Views share one data shape.
6. **Map tools stay on the map, echo as chips** — commute/draw/school remain interactive drawers, but when active also render a removable chip in the bar; the View snapshot captures them.
7. **Live match counts: scoped** — per-option counts only on low-cardinality fields that are *already* `facet:true` (≈ zero new RAM); the global `found` total powers the narrow nudge. Numeric/high-cardinality fields are never faceted.

---

## 4. Architecture

### 4.1 Filter Registry (the foundation)

Introduce `src/lib/filters/filterRegistry.ts` — every filter defined **as data**:

```ts
type FilterControlType = 'range' | 'stepper' | 'enum' | 'toggle' | 'geo';

interface FilterDef {
  key: string;                 // stable id, e.g. 'price', 'capRate', 'basement'
  label: string;               // 'Price', 'Cap Rate', 'Basement'
  category: 'Basics' | 'Investor' | 'Property' | 'Location';
  field: string;               // Typesense field name
  control: FilterControlType;
  faceted: boolean;            // true ⇒ eligible for live counts (low-cardinality enums only)
  defaultPinned?: boolean;     // shows as a default chip on a blank slate
  buildClause(value): string | null;  // emits the Typesense filter_by clause (or null when empty)
  // optional: min/max/step for ranges, options loader for enums, value→chip-label formatter
}
```

This **replaces the hardcoded per-persona `buildFilterString`** (`src/lib/personas/personaConfig.ts:226-294`). The new filter-string builder becomes: *iterate active filters → call each `buildClause` → join non-null clauses with `&&`*, then compose with the existing geo / `SALES_FLOOR` (`ListPrice:>=100000`) / `mapBounds` logic in `src/app/properties/page.tsx`.

**Known-empty fields are simply absent from the registry**, so they can never reach the UI (defense-in-depth vs. the `personaConfig.ts:6-17` do-not-filter warnings).

### 4.2 Personas as preset Views

A `View` shape (shared by presets and user views):

```ts
interface FilterValue { key: string; value: unknown; }    // references a FilterDef.key

interface View {
  id: string;
  name: string;
  source: 'preset' | 'user';
  filters: FilterValue[];      // active chips + values
  sort?: string;               // 'FieldName:desc'
  colorMetric?: string;        // map color-by
  mapLens?: {                  // commute / school / draw snapshot (optional)
    commute?: CommuteSnapshot;      // reuse the store's existing commute slice shape
    school?: SchoolSnapshot;        // reuse the store's existing school slice shape
    drawPolygon?: [number, number][]; // [lng,lat] ring, as stored today
  };
  alertEnabled?: boolean;      // user views only
  alertLastRunAt?: string;     // user views only
}
```

The four personas (`PERSONA_CONFIG`) are migrated into seed `View`s with `source: 'preset'`. Selecting a preset loads its `filters`/`sort`/`colorMetric`. This subsumes today's persona behavior and the existing **Lens** concept (`MapLensesPanel.tsx`, `localStorage: pp_lenses`, which today stores `{persona, filters, colorMetricId}` but not map shape — the new `mapLens` field closes that gap).

### 4.3 State model (`src/lib/stores/commandCenterStore.ts`)

- Replace the fixed `filters: TerminalFilterState` (13 fields, `personaConfig.ts:31-45`) with a dynamic `activeFilters: Record<string, unknown>` keyed by `FilterDef.key`.
- Keep `location`, `commute`, `school`, `drawPolygon`, `mapBounds`, `colorBand` as separate slices (unchanged), but surface their active state to the bar as chip-echoes.
- Setters: `setFilter(key, value)`, `removeFilter(key)`, `applyView(view)`, `clearFilters()`. Each triggers the existing 250ms-debounced `performSearch`.

### 4.4 Query pipeline (`src/app/properties/page.tsx`)

Unchanged shape, new assembly:
1. Iterate `activeFilters` → `filterRegistry[key].buildClause(value)` → collect clauses.
2. Append geo (`commute.polygon` / `drawPolygon` → `[lat,lng]` → `location:(...)`), school lens, `colorBand` (`bandFilterClause()`, `mapMetrics.ts:136`).
3. Join with `&&` + `SALES_FLOOR`; apply `mapBounds` as bounding box.
4. `searchListings()` (`src/lib/typesense/client.ts:254`) with `per_page=100`, `sort_by`, **and a new `facet_by`** = the currently-relevant faceted enum fields.
5. Response → list + map + facet counts (per option) + `found` (true total) → bar updates counts and the "X of Y" nudge.

### 4.5 Live counts scope (memory-safe)

- `facet_by` includes **only** already-`facet:true`, low-cardinality enums: `PropertyType`, `PropertySubType`, `TransactionType`, `City`, `BasementType`, `SuiteStatus`, `multi_unit_status`, `Status`, `ApproximateAge`, `OccupantType`, `PossessionType`, `IsStale`, `is_density_ready`, `assessment_status`.
- **Never** facet `PostalCode` (high-cardinality) or any numeric field (RAM policy, `typesenseSchema.ts:23-28`).
- Numeric chips show no per-value counts; the global `found` total is their feedback (and powers the narrow nudge).
- `TransactionType` value contains a space → clause/format must use backtick syntax: `` TransactionType:=`For Sale` ``.

---

## 5. Components

- `FilterBar.tsx` — active chips + `+ Add filter` + narrow-nudge + Views menu. **Replaces** `PersonaFilterBar.tsx` in `TopCommandBar.tsx`.
- `FilterChip.tsx` — one chip; shows label/value; click opens its control popover; `×` removes.
- Per-type control popovers:
  - `RangePopover` — reuses `src/components/ui/slider.tsx` (Radix 2-thumb) for price / cap rate / DOM / lot size.
  - `StepperPopover` — beds / baths / parking (N+ steppers).
  - `EnumPopover` — type / sub-type / basement / suite status (multi-select checkboxes with live counts).
  - `TogglePopover` / inline toggle — stale, density-ready, etc.
- `AddFilterPalette.tsx` — hybrid search + categorized list; excludes already-active filters; shows counts on faceted enums.
- `ViewsMenu.tsx` — presets group + "My Views" group; apply / save-current / rename / delete / share-link / alert-toggle.
- Map drawers (`CommuteFilter.tsx`, `SchoolFilter.tsx`, draw panel) unchanged, but register a chip-echo in the bar when active.

**Design system (CLAUDE.md + memory):** `pp-*` namespaced tokens only — additive `tailwind.config.ts` extend; **never** override default `--background`/`--radius`/`text-*` (would restyle 88+ files). Palette: `pp-bg` `#0A1828`, `pp-accent` `#1DD3E0` cyan for active/live state; gold for the loaded preset chip; amber for the narrow nudge. Terminal aesthetic: monospace, uppercase micro-labels.

---

## 6. Saved Views — storage & sharing

- **Anonymous** → `localStorage` key `pp_views` (evolves `pp_lenses`). Full `View` snapshot minus server-only fields.
- **Signed-in** → new owner-scoped table `saved_views` (RLS owner-only via `auth.uid()`, mirroring migration `015_auth_profiles_watchlist.sql`):
  - `id`, `user_id`, `name`, `payload jsonb` (the `View` snapshot), `alert_enabled bool`, `alert_last_run_at timestamptz`, `created_at`, `updated_at`.
  - CRUD via a new `/api/views` route (pattern after the bubbles API).
- **Sharing** → `?view=<id>` deep link; a shared View is applied on load (hydration pattern like `useBubbleHydration.ts`). Anonymous→sign-in handoff via `sessionStorage` (pattern like `pp_pending_bubble`) so a view built logged-out can be saved after sign-in.
- **Migration connectivity caveat (memory):** apply the migration via the Supabase SQL editor or the **Session pooler** `DATABASE_URL` (port 5432) — the direct host is IPv6-only and unreachable here.

---

## 7. Alerts (final phase)

Extend `scripts/worker/alerts.ts` (the nightly "Send Watchlist Alerts" step, Resend, `continue-on-error`):
- For each `saved_views` row with `alert_enabled = true`, rebuild the View's `filter_by` and query the freshly-synced Typesense index.
- Diff matched `listing_key`s against the prior run (via `alert_last_run_at` + an "added/changed since" predicate, or a stored seen-set) to find **new** matches.
- Email a per-user digest via Resend (`ALERTS_FROM_EMAIL`, `NEXT_PUBLIC_SITE_URL`), then advance `alert_last_run_at`.
- Deterministic comparison only — **no LLM** (CLAUDE.md §4). Daily cadence. The step stays optional/no-op when `RESEND_API_KEY` is unset.

This is a saved-*search* alert, distinct from today's per-listing price-drop watchlist alert; it reuses the same pipeline and email infrastructure.

---

## 8. Compliance & Constraints (CLAUDE.md §4)

- **100-result cap unchanged** — `MAX_LISTINGS=100` (`page.tsx:24`), `MAX_LIMIT=100` (`listings/route.ts:30`), `per_page=100`. `found` (true total) is shown only as the narrow nudge; we still render ≤100. Filters are designed to *refine toward* the meaningful 100, not paginate past it.
- **Mandatory brokerage display** — untouched; list/thumbnail rendering unaffected.
- **No AI on raw data** — all clauses/counts are deterministic Typesense ops.
- **Data freshness / sync** — unaffected; alerts ride the existing nightly index.

---

## 9. Field Inventory

### Filterable & populated (registry candidates)

**Basics:** `ListPrice` (range, sortable) · `BedroomsTotal` (stepper) · `BathroomsTotalInteger` (stepper) · `KitchensTotal` (stepper) · `PropertyType` (enum, facet) · `PropertySubType` (enum, facet) · `TransactionType` (enum, facet — backtick) · `City` (enum, facet) · `CityRegion` (enum) · `PostalCode` (filter-only, **no facet**) · `Status` (enum, facet)

**Investor:** `ExtrapolatedCapRate` (range, sortable — the only rankable cap metric) · `TrueDom` (range) · `TotalPriceDrop` (range) · `CapitalBurnRateMonthly` (range) · `MonthlyCarryCost` + components (range) · `IsStale` (toggle, facet) · `SuiteScore` (range) · `surplus_parking_count` (range) · `TotalCapitalBasis` (range)

**Property:** `LotWidth` / `LotDepth` / `LotSqftTotal` (range) · `BasementType` (enum multi, facet) · `ParkingTotal` (stepper) · `SuiteStatus` (enum, facet) · `multi_unit_status` (enum, facet) · `is_density_ready` (toggle, facet) · `ApproximateAge` (enum, facet) · `OccupantType` (enum, facet) · `PossessionType` (enum, facet) · `assessment_status` (enum, facet)

**Location/Geo:** `location` (geopoint — commute/draw/radius/bounds) · school scores (`BestElementaryScore`, `BestSecondaryScore`, etc.) · `NearbySchools` (target-school proximity)

### Excluded (empty / unreliable — never build UI on these)

`cap_rate_est`, `gross_yield_est`, `net_monthly_cashflow`, `cashflow_floor`, `cap_rate_floor`, `tax_burden_ratio` (all 0 / unreliable) · `BuildingAreaTotal` (exact sqft ~0% coverage — prefer `LotSqftTotal`) · `IsSold` (always false in the active collection).

---

## 10. Build Phases (commit between each — CLAUDE.md §8)

- **Phase 0 — Registry refactor.** Build `filterRegistry.ts`; refactor `buildFilterString` to data-driven; migrate existing persona controls into registry entries. **No UI change.** Tests prove byte-for-byte parity of generated `filter_by` vs. current behavior for each persona.
- **Phase 1 — Composable bar.** `FilterBar` + `FilterChip` + range/stepper/enum/toggle popovers; default chips (Buy/Rent, Price, Beds, Baths, Type); narrow nudge from `found`. Replaces `PersonaFilterBar`.
- **Phase 2 — Add-filter palette + counts.** Hybrid search+category palette exposing the full registry; add `facet_by` (scoped enums) to the terminal search; render live counts in the palette and enum popovers.
- **Phase 3 — Presets + Saved Views (local).** Personas reframed as preset Views; `ViewsMenu`; local `pp_views` persistence; map-lens chip echoes captured in snapshots.
- **Phase 4 — Account sync + sharing.** `saved_views` table + RLS migration; `/api/views`; `?view=<id>` hydration; anonymous→sign-in handoff.
- **Phase 5 — View-powered alerts.** `alert_enabled` toggle in `ViewsMenu`; extend `scripts/worker/alerts.ts` for nightly saved-search digests.

**Acceptance per phase:** lint + relevant tests pass; Phase 0 has explicit parity tests; Phases 1–3 verified against the live Typesense index (counts, narrow nudge, view round-trip); Phase 4 verified for RLS isolation; Phase 5 verified to email only *new* matches.

---

## 11. Key Files (for the implementer)

- `src/app/properties/page.tsx` — orchestration, `rawFilterBy` assembly, 250ms debounce, `MAX_LISTINGS`
- `src/lib/stores/commandCenterStore.ts` — state shape
- `src/lib/personas/personaConfig.ts` — current `TerminalFilterState` + per-persona `buildFilterString` + `controls` (source for registry migration)
- `src/components/CommandCenter/PersonaFilterBar.tsx`, `TopCommandBar.tsx` — bar to replace
- `src/lib/typesense/client.ts` (`searchListings`) — add `facet_by`
- `src/lib/typesense/typesenseSchema.ts` — authoritative field/facet flags
- `src/lib/personas/mapMetrics.ts` — band-filter pattern
- `src/components/ui/slider.tsx` — reusable 2-thumb range slider
- `src/lib/bubbles/serialize.ts`, `useBubbleHydration.ts`, `MapLensesPanel.tsx` — saved-view / hydration primitives to mirror
- `scripts/worker/alerts.ts` — alert pipeline to extend
- `tailwind.config.ts` — `pp-*` tokens

---

## 12. Risks & Open Items

- **Phase 0 parity** is the linchpin — if the data-driven builder doesn't reproduce current persona `filter_by` exactly, behavior silently changes. Lock with snapshot/parity tests before any UI work.
- **`TotalPriceDrop` / `TrueDom`** carry real values only after `sync.ts` overwrites transformer placeholders — verify against the live index before building their chips.
- **Facet field set** must be validated against `typesenseSchema.ts` at implementation time (confirm each is actually `facet:true`); add `facet_by` only for confirmed ones.
- **Single map drawer slot** (`store.activeModule`) — the chip-echo must not fight the drawer for that slot; chips open lightweight popovers, not drawers.
- **Migration connectivity** — `saved_views` migration must run via SQL editor or Session pooler (direct host unreachable here).
