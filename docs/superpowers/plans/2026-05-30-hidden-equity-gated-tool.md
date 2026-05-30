# Hidden Equity — Gated Member Tool — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in-members-only Hidden Equity tool — pick a modelable neighbourhood + describe your home → estimated value + the renovations that pay off most locally — reusing the Phase-1 engine, behind the Velvet Rope auth gate, with mandatory compliance disclaimers.

**Architecture:** A pure, tested cohort-tree builder feeds a gated `/api/avm/cohorts` picker endpoint; a gated `/api/avm/hidden-equity` endpoint runs `calculateAVM` + `fetchValueAddReport` (reusing the Phase-2a P0/predSD seam); a client tool renders the cascading picker, the estimate, and the Hidden Equity report (reusing `buildView`); the page server-gates on `getCurrentUser()`. The currently-open `/api/avm` is closed behind the same gate.

**Tech Stack:** Next.js (app router, server + client components, route handlers), TypeScript, Supabase (`getCurrentUser`, service-role client), vitest (node-env), Tailwind, shadcn Select/Input/Card.

**Spec:** `docs/superpowers/specs/2026-05-30-hidden-equity-gated-tool.md`

**Branch/commit discipline:** Branch `feat/composable-filter-bar` (carries the engine). Stage **explicit paths only** — never `git add -A`/`-u`/`.`; the shared working tree has a live concurrent session. New files: `git add <path>` then `git commit -m "…" -- <path>` (path-scoped). Every commit ends with the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer.

**Compliance guardrail (every UI task):** never render an individual sold record/address/price; always keep the disclaimer block on any screen showing a figure; do not attribute value to TRREB/PROPTX or imply affiliation.

---

## File Structure

| Action | Path | Responsibility |
|---|---|---|
| Create | `src/lib/avm/cohorts.ts` | pure `buildCohortTree` + `normalizeCityRegion` + types |
| Create | `src/lib/avm/cohorts.test.ts` | builder unit tests |
| Create | `src/app/api/avm/cohorts/route.ts` | gated GET modelable tree |
| Create | `src/app/api/avm/hidden-equity/route.ts` | gated POST estimate + value-add |
| Modify | `src/app/api/avm/route.ts` | add `getCurrentUser()` 401 gate |
| Modify | `src/app/(app)/avm/page.tsx` | remove anonymous access |
| Create | `src/components/hiddenEquity/Disclaimers.tsx` | compliance notices |
| Create | `src/components/hiddenEquity/HiddenEquityReport.tsx` | estimate + value-add (reuses `buildView`) |
| Create | `src/components/hiddenEquity/HiddenEquityForm.tsx` | cascading picker + details + sqft |
| Create | `src/components/hiddenEquity/HiddenEquityTool.tsx` | client container |
| Create | `src/app/(app)/hidden-equity/page.tsx` | gated server page (teaser vs tool) |

Scoped test cmd: `npx vitest run src/lib/avm/cohorts.test.ts`. Final gate: `npm test`, `npx tsc --noEmit`, `npm run lint`, `npm run build`.

---

## Task 1: Pure cohort-tree builder

**Files:** Create `src/lib/avm/cohorts.ts`, `src/lib/avm/cohorts.test.ts`.

- [ ] **Step 1: Write the failing test** — `src/lib/avm/cohorts.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildCohortTree, normalizeCityRegion } from './cohorts';

const rows = [
  { city_region: 'Brampton West', property_sub_type: 'Detached', model_accuracy_score: 0.7, total_sales_analyzed: 117 },
  { city_region: 'Brampton West', property_sub_type: 'Townhouse', model_accuracy_score: 0.8, total_sales_analyzed: 90 },
  { city_region: '1001 - BR Bronte', property_sub_type: 'Detached', model_accuracy_score: 0.6, total_sales_analyzed: 50 },
  { city_region: 'Thin', property_sub_type: 'Detached', model_accuracy_score: 0.9, total_sales_analyzed: 10 }, // n<30 → drop
  { city_region: 'LowR2', property_sub_type: 'Detached', model_accuracy_score: 0.3, total_sales_analyzed: 100 }, // R²<0.5 → drop
];
const pairs = [
  { city: 'Brampton', city_region: 'Brampton West' },
  { city: 'Oakville', city_region: '1001 - BR Bronte' },
];

describe('normalizeCityRegion', () => {
  it('strips legacy numeric/board prefixes for display only', () => {
    expect(normalizeCityRegion('1001 - BR Bronte')).toBe('Bronte');
    expect(normalizeCityRegion('Brampton West')).toBe('Brampton West');
  });
});

describe('buildCohortTree', () => {
  const tree = buildCohortTree(rows, pairs);
  it('drops low-R² and thin cohorts', () => {
    const s = JSON.stringify(tree);
    expect(s).not.toContain('Thin');
    expect(s).not.toContain('LowR2');
  });
  it('groups communities under parent city with display label + RAW key + sorted types', () => {
    expect(tree['Brampton']).toEqual([
      { community: 'Brampton West', cityRegion: 'Brampton West', types: ['Detached', 'Townhouse'] },
    ]);
    expect(tree['Oakville']).toEqual([
      { community: 'Bronte', cityRegion: '1001 - BR Bronte', types: ['Detached'] },
    ]);
  });
  it('returns {} for empty input', () => {
    expect(buildCohortTree([], [])).toEqual({});
  });
});
```
Run `npx vitest run src/lib/avm/cohorts.test.ts` → FAIL (module missing).

- [ ] **Step 2: Implement** — `src/lib/avm/cohorts.ts`:
```ts
// src/lib/avm/cohorts.ts
// Pure builder for the Hidden Equity neighbourhood picker. Source-agnostic: the
// route supplies audit rows + (city, city_region) pairs; this groups them into a
// {city -> communities[]} tree of ONLY modelable (trained) cohorts.

export interface CohortRow {
  city_region: string;
  property_sub_type: string;
  model_accuracy_score: number; // R²
  total_sales_analyzed: number;
}
export interface CityRegionPair { city: string | null; city_region: string | null; }

export interface CohortCommunity {
  community: string;   // normalized display label
  cityRegion: string;  // RAW city_region — the lookup key passed to calculateAVM
  types: string[];     // modelable property_sub_types, sorted
}
export type CohortTree = Record<string, CohortCommunity[]>;

/** Trained-cohort gate: where the value-add report actually prices moves. */
const TRAINED_R2 = 0.5;   // COEFFICIENT_ENGINE_THRESHOLD
const TRAINED_N = 30;     // MIN_COHORT_N
/** Legacy prefixes on some matrix city_regions: "1001 - BR Bronte", "7709 - Barrhaven". */
const PREFIX_RE = /^\d+\s*-\s*(?:[A-Z]{1,3}\s+)?/;

/** Display label only — the RAW city_region remains the lookup key. */
export function normalizeCityRegion(raw: string): string {
  return raw.replace(PREFIX_RE, '').trim() || raw;
}

export function buildCohortTree(rows: CohortRow[], pairs: CityRegionPair[]): CohortTree {
  const cityByRegion = new Map<string, Set<string>>();
  for (const p of pairs) {
    if (!p.city || !p.city_region) continue;
    if (!cityByRegion.has(p.city_region)) cityByRegion.set(p.city_region, new Set());
    cityByRegion.get(p.city_region)!.add(p.city);
  }

  // city -> (raw city_region -> community accumulator)
  const tree = new Map<string, Map<string, { community: string; cityRegion: string; types: Set<string> }>>();
  for (const r of rows) {
    if (!(r.model_accuracy_score >= TRAINED_R2 && r.total_sales_analyzed >= TRAINED_N)) continue;
    const cities = cityByRegion.get(r.city_region);
    const cityList = cities && cities.size ? [...cities] : ['Other'];
    const community = normalizeCityRegion(r.city_region);
    for (const city of cityList) {
      if (!tree.has(city)) tree.set(city, new Map());
      const comms = tree.get(city)!;
      if (!comms.has(r.city_region)) comms.set(r.city_region, { community, cityRegion: r.city_region, types: new Set() });
      comms.get(r.city_region)!.types.add(r.property_sub_type);
    }
  }

  const out: CohortTree = {};
  for (const [city, comms] of [...tree.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    out[city] = [...comms.values()]
      .map((c) => ({ community: c.community, cityRegion: c.cityRegion, types: [...c.types].sort() }))
      .sort((a, b) => a.community.localeCompare(b.community));
  }
  return out;
}
```

- [ ] **Step 3: Green** — `npx vitest run src/lib/avm/cohorts.test.ts` → PASS.
- [ ] **Step 4: Commit**
```bash
git add src/lib/avm/cohorts.ts src/lib/avm/cohorts.test.ts
git commit -m "feat(hidden-equity): pure modelable-cohort tree builder

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Gated cohorts API

**Files:** Create `src/app/api/avm/cohorts/route.ts`.

> **DISK-IO CAVEAT (read first):** Do NOT `select` all `listings` rows to get (city, city_region) pairs — that scans ~112k rows and burns the instance IO burst budget (memory `supabase-io-budget`). Source the pairs CHEAPLY: prefer the small `region_aggregates` table (migration `020_region_aggregates.sql`) if it carries both `city` and `city_region` (verify its columns first). If it doesn't, add a Postgres RPC `get_distinct_cohort_cities()` that runs `SELECT DISTINCT city, city_region FROM listings WHERE city_region IS NOT NULL` (indexed) and call it via `supabase.rpc(...)`. The `avm_audit_report` read is only 970 rows — fine in one page.

- [ ] **Step 1: Implement** — `src/app/api/avm/cohorts/route.ts`:
```ts
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/supabase/server';
import { getServiceRoleClient } from '@/lib/supabase/client';
import { buildCohortTree, type CohortRow, type CityRegionPair } from '@/lib/avm/cohorts';

export async function GET() {
  if (!(await getCurrentUser())) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  }
  try {
    const supabase = getServiceRoleClient();
    const { data: cohorts } = await supabase
      .from('avm_audit_report')
      .select('city_region, property_sub_type, model_accuracy_score, total_sales_analyzed');
    // CHEAP city map — see DISK-IO CAVEAT above; replace this line with the small source you verified.
    const pairs = await fetchCityRegionPairs(supabase);
    const tree = buildCohortTree((cohorts ?? []) as CohortRow[], pairs);
    return NextResponse.json({ tree });
  } catch (err) {
    console.error('[avm/cohorts]', err);
    return NextResponse.json({ error: 'Failed to load neighbourhoods' }, { status: 500 });
  }
}

// Implement against the cheap source you verified (region_aggregates columns OR an RPC).
async function fetchCityRegionPairs(supabase: ReturnType<typeof getServiceRoleClient>): Promise<CityRegionPair[]> {
  // EXAMPLE if region_aggregates has (city, city_region):
  //   const { data } = await supabase.from('region_aggregates').select('city, city_region');
  //   return (data ?? []) as CityRegionPair[];
  // EXAMPLE via RPC:
  //   const { data } = await supabase.rpc('get_distinct_cohort_cities');
  //   return (data ?? []) as CityRegionPair[];
  throw new Error('fetchCityRegionPairs: wire to the verified cheap source');
}
```

- [ ] **Step 2: Resolve the city source** — Inspect `supabase/migrations/020_region_aggregates.sql` for `city`/`city_region` columns. If present, implement `fetchCityRegionPairs` against `region_aggregates`. Otherwise create the `get_distinct_cohort_cities()` RPC (add a migration `0NN_cohort_cities_rpc.sql` with `CREATE OR REPLACE FUNCTION get_distinct_cohort_cities() RETURNS TABLE(city text, city_region text) LANGUAGE sql STABLE AS $$ SELECT DISTINCT city, city_region FROM listings WHERE city_region IS NOT NULL $$;`) and call it. **Never** select all listings.

- [ ] **Step 3: Verify** — `npx tsc --noEmit` clean. Manual: signed-out `GET /api/avm/cohorts` → 401; signed-in → `{ tree: { "Brampton": [...] } }`.

- [ ] **Step 4: Commit**
```bash
git add src/app/api/avm/cohorts/route.ts   # + any migration you added
git commit -m "feat(hidden-equity): gated modelable-cohort picker endpoint

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>" -- src/app/api/avm/cohorts/route.ts
```
(If you added a migration, stage + commit it on its own explicit path too.)

---

## Task 3: Gated Hidden Equity valuation API

**Files:** Create `src/app/api/avm/hidden-equity/route.ts`. Reuse the existing `AVMInputSchema` (`src/lib/avm/validation.ts`) and extend it minimally for the optional sqft.

- [ ] **Step 1: Implement** — mirror `src/app/api/avm/route.ts`, add auth + value-add:
```ts
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/supabase/server';
import { getServiceRoleClient } from '@/lib/supabase/client';
import { calculateAVM } from '@/lib/avm/calculator';
import { fetchValueAddReport } from '@/lib/avm/valueAdd/engine';
import { AVMInputSchema } from '@/lib/avm/validation';
import { normalizePropertySubType } from '@/lib/avm/normalizeType';
import type { AVMInput } from '@/lib/avm/types';

export async function POST(req: NextRequest) {
  if (!(await getCurrentUser())) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  }
  try {
    const body = await req.json();
    const parsed = AVMInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 });
    }
    const v = parsed.data;
    const buildingAreaTotal =
      typeof body.buildingAreaTotal === 'number' && body.buildingAreaTotal > 0 ? body.buildingAreaTotal : null;
    const input: AVMInput = {
      cityRegion: v.cityRegion,
      city: v.city ?? null,
      propertySubType: normalizePropertySubType(v.propertySubType),
      rawPropertySubType: v.propertySubType,
      buildingAreaTotal,
      lotWidth: null,
      bedroomsAboveGrade: v.bedroomsAboveGrade,
      bathroomsTotalInteger: v.bathroomsTotalInteger,
      parkingTotal: v.parkingTotal,
      interiorTier: v.interiorTier,
      exteriorTier: v.exteriorTier,
      basementTier: v.basementTier,
    };
    const supabase = getServiceRoleClient();
    const estimate = await calculateAVM(supabase, input);
    let valueAdd = null;
    if (estimate.estimatedValue > 0) {
      valueAdd = await fetchValueAddReport(supabase, input, {
        subjectEstimate: estimate.estimatedValue,
        predSD: estimate.predictiveSD,
      });
    }
    return NextResponse.json({ estimate, valueAdd });
  } catch (err) {
    console.error('[avm/hidden-equity]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```
> If `AVMInputSchema` rejects unknown keys, pass `buildingAreaTotal` outside the schema (as above, read from raw `body`) or add `buildingAreaTotal: z.number().positive().nullable().optional()` to the schema — verify the schema first.

- [ ] **Step 2: Verify** — `npx tsc --noEmit` clean. Manual: signed-out POST → 401; signed-in with a trained cohort → `{ estimate, valueAdd }` with priced moves.
- [ ] **Step 3: Commit** (path-scoped, add schema file too if modified).

---

## Task 4: Close the open `/api/avm` + `/avm` page

**Files:** Modify `src/app/api/avm/route.ts`, `src/app/(app)/avm/page.tsx`.

- [ ] **Step 1: Gate the API** — at the top of `POST` in `src/app/api/avm/route.ts`, add:
```ts
import { getCurrentUser } from '@/lib/supabase/server';
// ...
  if (!(await getCurrentUser())) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  }
```
- [ ] **Step 2: Gate the page** — in `src/app/(app)/avm/page.tsx`, make it a server component (or add a server check) that redirects unauthed users to `/hidden-equity` (the new home for this), or renders the same teaser. Smallest change that removes anonymous access. Read the file first; if it's a thin client page, wrap with a server gate.
- [ ] **Step 3: Verify** — `npx tsc --noEmit`. Manual: signed-out POST `/api/avm` → 401; `/avm` no longer renders the calculator anonymously.
- [ ] **Step 4: Commit** (path-scoped, both files).

---

## Task 5: Disclaimers component

**Files:** Create `src/components/hiddenEquity/Disclaimers.tsx`.

- [ ] **Step 1: Implement** — a small presentational block (server-safe):
```tsx
export default function Disclaimers() {
  return (
    <div className="space-y-1 rounded-md border border-slate-800 bg-slate-900/40 p-3 text-[11px] leading-relaxed text-slate-500">
      <p>This is an automated estimate generated from aggregate market data — <span className="text-slate-400">not an appraisal</span> or professional opinion of value.</p>
      <p>Information herein is deemed reliable but is not guaranteed accurate by PROPTX.</p>
      <p>The information provided herein must only be used by consumers that have a bona fide interest in the purchase, sale, or lease of real estate and may not be used for any commercial purpose or any other purpose.</p>
    </div>
  );
}
```
> Copy is a first draft pending Broker-of-Record review (see spec §2/§6). Do not attribute value to TRREB/PROPTX as a source.
- [ ] **Step 2: tsc clean → Commit** (path-scoped).

---

## Task 6: Hidden Equity input form

**Files:** Create `src/components/hiddenEquity/HiddenEquityForm.tsx` (`'use client'`).

Read `src/components/avm/AVMPropertyForm.tsx` first and reuse its labelled bed/bath/parking/tier `<Select>` blocks verbatim where possible (INTERIOR/EXTERIOR/BASEMENT labels included).

- [ ] **Step 1: Implement.** Props: `{ tree: CohortTree; value: HEFormState; onChange: (next: HEFormState) => void }`. `HEFormState` = `{ city, cityRegion, propertySubType, bedroomsAboveGrade, bathroomsTotalInteger, parkingTotal, interiorTier, exteriorTier, basementTier, buildingAreaTotal }`. Logic:
  - **City `<Select>`** options = `Object.keys(tree)` sorted. On change: set `city`, clear `cityRegion` + `propertySubType`.
  - **Community `<Select>`** options = `tree[city]` (each `{community,cityRegion,types}`); option value = `cityRegion` (raw), label = `community`. On change: set `cityRegion`, clear `propertySubType`. Disabled until a city is chosen.
  - **Property type `<Select>`** options = `types` of the chosen community (`tree[city].find(c => c.cityRegion === cityRegion)?.types`). Disabled until a community is chosen.
  - Beds/baths/parking/interior/exterior/basement: reuse `AVMPropertyForm`'s selects (defaults: tiers 3/3/5 neutral).
  - **Square footage** optional `<Input type="number">` → `buildingAreaTotal` (empty → null), labelled "Square footage (optional — improves accuracy)".
  - Each change calls `onChange` with the updated state. No fetching here (the container fetches).
- [ ] **Step 2: tsc clean → Commit** (path-scoped).

---

## Task 7: Hidden Equity report display

**Files:** Create `src/components/hiddenEquity/HiddenEquityReport.tsx`.

Reuse `shouldRender`/`buildView` from `@/components/Property/forceAppreciationView` and `formatPrice`. Consumer-framed wrapper.

- [ ] **Step 1: Implement.** Props: `{ estimate: AVMResult | null; report: ValueAddReport | null }`.
  - If `!estimate || estimate.estimatedValue <= 0` → "We couldn't produce a confident estimate for this home yet."
  - Else show the estimate headline: `formatPrice(estimate.estimatedValue)` + a confidence chip (reuse the `CONFIDENCE_STYLES` idea from `ListingEstimateCard.tsx`) + the 1-SD band (`estimate.lowBand`–`estimate.highBand`).
  - If `shouldRender(report)`: render `buildView(report)` — a soft headline ("You could unlock up to **{formatPrice(v.headlineGross)}** in hidden equity — best net **{formatPrice(v.headlineNet)}** after costs"), the `topRows` ledger (`+value · −cost · payback×`, same row markup as `ForceAppreciationCard`), the `<details>` "Why not the others?" with `moreRows` + `suppressed`, and `v.basis`.
  - Else (no priced moves) → estimate only + "Renovation modeling isn't available for this neighbourhood yet."
  - Always render `<Disclaimers />` at the bottom.
- [ ] **Step 2: tsc clean → Commit** (path-scoped).

---

## Task 8: Tool container

**Files:** Create `src/components/hiddenEquity/HiddenEquityTool.tsx` (`'use client'`).

- [ ] **Step 1: Implement.** On mount, `GET /api/avm/cohorts` → `tree` (loading + error states). Holds `HEFormState` (defaults: empty city/community/type, tiers 3/3/5, counts e.g. beds 3/baths 2/parking 1, sqft null). Renders `<HiddenEquityForm tree={tree} value={form} onChange={setForm} />`, a "Reveal my hidden equity" button (disabled until `city && cityRegion && propertySubType`), and `<HiddenEquityReport estimate report />`. On submit: `POST /api/avm/hidden-equity` with the form (sending `cityRegion` raw, `city`, `propertySubType`, the counts/tiers, `buildingAreaTotal`); set `{estimate, valueAdd}` from the response; handle loading/error. Two-column terminal layout like `AVMCalculator.tsx` (form left, report right).
- [ ] **Step 2: tsc clean → Commit** (path-scoped).

---

## Task 9: Gated page + full verification

**Files:** Create `src/app/(app)/hidden-equity/page.tsx` (server component).

- [ ] **Step 1: Implement.**
```tsx
import { getCurrentUser } from "@/lib/supabase/server";
import MagicLinkForm from "@/components/auth/MagicLinkForm"; // verify default vs named export
import HiddenEquityTool from "@/components/hiddenEquity/HiddenEquityTool";

export const dynamic = "force-dynamic";

export default async function HiddenEquityPage() {
  const user = await getCurrentUser();
  if (!user) {
    return (
      <main className="mx-auto max-w-md px-4 py-16 text-slate-200">
        <h1 className="mb-2 text-2xl font-bold">Unlock your home's Hidden Equity</h1>
        <p className="mb-6 text-sm text-slate-400">
          See your estimated value and the renovations that pay off most in your neighbourhood.
          Members only — sign in to continue.
        </p>
        <MagicLinkForm />
      </main>
    );
  }
  return (
    <main className="mx-auto max-w-[1200px] px-4 py-8 text-slate-200">
      <h1 className="mb-1 text-2xl font-bold">Hidden Equity</h1>
      <p className="mb-6 text-sm text-slate-400">Your estimated value + the renovations that add the most where you are.</p>
      <HiddenEquityTool />
    </main>
  );
}
```
> Verify `MagicLinkForm`'s export style and required props (read `src/components/auth/MagicLinkForm.tsx`); adapt the import/usage. If it needs a redirect target, pass `/hidden-equity`.

- [ ] **Step 2: FULL gate** — run all, all must pass:
  1. `npm test` (cohorts + existing suites green)
  2. `npx tsc --noEmit`
  3. `npm run lint` (no new errors in your files)
  4. `npm run build`
- [ ] **Step 3: Commit** (path-scoped).

---

## Final review

Dispatch a holistic reviewer over the feature: confirm (1) every VOW-derived screen is auth-gated and carries `<Disclaimers />`, (2) no individual sold record/address/price is ever surfaced, (3) `/api/avm`, `/api/avm/cohorts`, `/api/avm/hidden-equity` all 401 when unauthed, (4) the picker only offers trained cohorts and selections round-trip via the RAW `city_region`, (5) no `listings` full-table scan (Disk IO), (6) reuse of the Phase-1 engine + `buildView` is correct, (7) §4 deterministic / no-LLM. Then use **superpowers:finishing-a-development-branch**.

## Self-review (plan vs spec)

- **Spec coverage:** gated page+teaser (T9), cohorts API+builder (T1–T2), valuation API (T3), gate old endpoint (T4), disclaimers (T5), form w/ cascading picker + sqft (T6), report reusing buildView (T7), container (T8). ✓
- **Placeholders:** the only deliberate "fill-in" is `fetchCityRegionPairs` in T2 — gated behind an explicit verify-the-cheap-source step with two concrete implementations given, because the right source (region_aggregates vs RPC) must be confirmed against the DB, and a wrong `listings` scan is a real IO hazard. Justified, not vague.
- **Type consistency:** `CohortTree`/`CohortCommunity` defined T1, consumed T2/T6/T8; `HEFormState` defined T6, used T8; `{estimate, valueAdd}` shape from T3 consumed by T7/T8; reuses `ValueAddReport`/`AVMResult`/`buildView` by their real names. ✓
- **Compliance:** auth gate on every VOW-derived surface (T2/T3/T4/T9), `<Disclaimers />` mandatory (T5/T7), no individual records, no public exposure. ✓
