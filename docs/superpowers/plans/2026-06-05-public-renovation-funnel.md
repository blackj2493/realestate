# Public Renovation-Upside Funnel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a public, shareable renovation-upside funnel where a visitor describes their home with no login, sees a non-VOW teaser (move catalog + cost ranges + a blurred hero), and signs in to unlock the real VOW-derived numbers — then shares a neighbourhood challenge card that pulls in the next visitor.

**Architecture:** A new public SSR route `/whats-my-home-hiding` reuses the existing `HiddenEquityForm` and value-add engine. The existing `POST /api/avm/hidden-equity` is changed from a hard 401-for-anon gate to a **soft gate** (`getConsumer()`): anonymous callers get a `{ locked: true, catalog }` payload built by a new pure `buildAnonCatalog()` (no AVM run, no VOW reads); consumers get the full `{ locked: false, estimate, valueAdd }` (unchanged). A dynamic OG image route renders the share card from a `?community=` slug. Everything VOW-derived stays behind the existing `getConsumer`/`requireConsumer` gate — zero new compliance surface.

**Tech Stack:** Next.js 16 (App Router, `next/og`), React 18, TypeScript, Zod, Supabase (service-role for cohort/AVM reads), Vitest (node-env — pure-logic tests only).

**Spec:** `docs/superpowers/specs/2026-06-05-public-renovation-funnel-design.md`

**Working directory:** this worktree — `.claude/worktrees/feat+public-renovation-funnel/` on branch `worktree-feat+public-renovation-funnel` (off `origin/main`). All paths below are repo-relative.

**Commit convention:** the repo uses concern-separated commits ending with the
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer. The
commit commands below omit the trailer for brevity — add it (or use the `commit` skill).

---

## Pre-flight (once, before Task 1)

- [ ] **Install deps + baseline.** This is a fresh worktree with no `node_modules`.

Run: `npm install`
Then: `npm run test`
Expected: install succeeds; the existing suite passes (this is the clean baseline). If anything fails before any change, stop and report.

---

## File Structure

**New — pure logic (vitest-tested):**
- `src/lib/reno/communitySlug.ts` — `slugifyCommunity`, `deslugifyCommunity`, `resolveCommunitySlug(tree, slug)`.
- `src/lib/avm/valueAdd/anonCatalog.ts` — `buildAnonCatalog(input)`, `isMoveApplicable(move, input)`, `AnonCatalogItem`, `AnonCatalogPayload`.

**New — server/UI:**
- `src/lib/avm/loadCohortTree.ts` — `loadCohortTree()` server fn (extracted from the cohorts route; cache + DB reads).
- `src/components/reno/RenovationRevealLocked.tsx` — locked teaser (blurred hero + catalog + unlock CTA).
- `src/components/reno/ShareChallengeButton.tsx` — post-reveal neighbourhood challenge share.
- `src/components/reno/RenovationFunnel.tsx` — client tool (form + submit + reveal + sessionStorage rehydrate + share).
- `src/app/whats-my-home-hiding/page.tsx` — public SSR landing + `generateMetadata`.
- `src/app/api/og/whats-my-home-hiding/route.tsx` — dynamic OG `ImageResponse` from `?community=`.

**Modified:**
- `src/app/api/avm/hidden-equity/route.ts` — soft-gate branch (anon → locked catalog; consumer → full).
- `src/app/api/avm/cohorts/route.ts` — use `loadCohortTree()` (keep its 401 gate).

**Tests:**
- `src/lib/reno/communitySlug.test.ts`
- `src/lib/avm/valueAdd/anonCatalog.test.ts`

---

## Task 1: Community slug helpers

**Files:**
- Create: `src/lib/reno/communitySlug.ts`
- Test: `src/lib/reno/communitySlug.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/reno/communitySlug.test.ts
import { describe, it, expect } from 'vitest';
import { slugifyCommunity, deslugifyCommunity, resolveCommunitySlug } from './communitySlug';
import type { CohortTree } from '@/lib/avm/cohorts';

describe('communitySlug', () => {
  it('slugifies a normalized community name', () => {
    expect(slugifyCommunity('Churchill Meadows')).toBe('churchill-meadows');
  });

  it('strips legacy numeric/area prefixes before slugifying', () => {
    expect(slugifyCommunity('1001 - BR Bronte')).toBe('bronte');
  });

  it('deslugifies to a title-cased display label', () => {
    expect(deslugifyCommunity('churchill-meadows')).toBe('Churchill Meadows');
  });

  it('round-trips slugify → deslugify for simple names', () => {
    expect(deslugifyCommunity(slugifyCommunity('Erin Mills'))).toBe('Erin Mills');
  });

  it('resolves a slug back to the RAW cityRegion + city via the tree', () => {
    const tree: CohortTree = {
      Mississauga: [
        { community: 'Churchill Meadows', cityRegion: '0140 - Churchill Meadows', types: ['Detached'] },
        { community: 'Erin Mills', cityRegion: 'Erin Mills', types: ['Condo'] },
      ],
    };
    expect(resolveCommunitySlug(tree, 'churchill-meadows')).toEqual({
      city: 'Mississauga',
      cityRegion: '0140 - Churchill Meadows',
    });
  });

  it('returns null for an unknown slug', () => {
    expect(resolveCommunitySlug({}, 'nowhere')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/lib/reno/communitySlug.test.ts`
Expected: FAIL — "Cannot find module './communitySlug'".

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/reno/communitySlug.ts
import { normalizeCityRegion, type CohortTree } from '@/lib/avm/cohorts';

/** Slug for share links / OG cards. Strips the legacy "1001 - BR " prefix first. */
export function slugifyCommunity(raw: string): string {
  return normalizeCityRegion(raw)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Display label for the OG card when we only have the slug (lossy — title-cased). */
export function deslugifyCommunity(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Map a slug back to the exact { city, cityRegion } lookup key using the live tree. */
export function resolveCommunitySlug(
  tree: CohortTree,
  slug: string,
): { city: string; cityRegion: string } | null {
  const target = slug.toLowerCase();
  for (const [city, communities] of Object.entries(tree)) {
    for (const c of communities) {
      if (slugifyCommunity(c.community) === target) {
        return { city, cityRegion: c.cityRegion };
      }
    }
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/lib/reno/communitySlug.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/reno/communitySlug.ts src/lib/reno/communitySlug.test.ts
git commit -m "feat(reno-funnel): community slug helpers (slugify/deslugify/resolve)"
```

---

## Task 2: Anon catalog builder (the compliance core)

The anonymous payload must contain **no VOW-derived numbers** — only move labels and construction-cost ranges. This task includes the compliance-guard regression test.

**Files:**
- Create: `src/lib/avm/valueAdd/anonCatalog.ts`
- Test: `src/lib/avm/valueAdd/anonCatalog.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/avm/valueAdd/anonCatalog.test.ts
import { describe, it, expect } from 'vitest';
import { buildAnonCatalog, isMoveApplicable, type AnonCatalogInput } from './anonCatalog';
import { MOVE_CATALOG } from './moveCatalog';

const BASE: AnonCatalogInput = {
  basementTier: 5,            // "Full Unfinished" — finish_basement applies
  interiorTier: 3,
  exteriorTier: 3,
  bathroomsTotalInteger: 2,
  bedroomsAboveGrade: 3,
  parkingTotal: 1,
  buildingAreaTotal: null,
};

describe('isMoveApplicable', () => {
  it('finish_basement applies when basement is unfinished (tier worse than target)', () => {
    const m = MOVE_CATALOG.find((x) => x.key === 'finish_basement')!;
    expect(isMoveApplicable(m, BASE)).toBe(true);
  });

  it('finish_basement does NOT apply when basement already finished (tier 1)', () => {
    const m = MOVE_CATALOG.find((x) => x.key === 'finish_basement')!;
    expect(isMoveApplicable(m, { ...BASE, basementTier: 1 })).toBe(false);
  });

  it('add_bathroom always applies (pure increment)', () => {
    const m = MOVE_CATALOG.find((x) => x.key === 'add_bathroom')!;
    expect(isMoveApplicable(m, BASE)).toBe(true);
  });
});

describe('buildAnonCatalog', () => {
  it('returns locked=true and applicable items with label + cost ranges only', () => {
    const payload = buildAnonCatalog(BASE);
    expect(payload.locked).toBe(true);
    expect(payload.catalog.length).toBeGreaterThan(0);
    for (const item of payload.catalog) {
      expect(Object.keys(item).sort()).toEqual(
        ['costHigh', 'costLow', 'costTyp', 'key', 'label'].sort(),
      );
      expect(item.costTyp).toBeGreaterThan(0);
    }
  });

  it('COMPLIANCE: payload contains no VOW-derived fields, anywhere', () => {
    const json = JSON.stringify(buildAnonCatalog(BASE));
    for (const forbidden of [
      'estimatedValue', 'subjectEstimate', 'valueAdd', 'valueAddTyp',
      'valueAddLow', 'valueAddHigh', 'headlineUpside', 'valueAddScore',
      'paybackRatio', 'netGainTyp', 'predictiveSD', 'beta',
    ]) {
      expect(json).not.toContain(forbidden);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/lib/avm/valueAdd/anonCatalog.test.ts`
Expected: FAIL — "Cannot find module './anonCatalog'".

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/avm/valueAdd/anonCatalog.ts
//
// Non-VOW public teaser. Given only the home's own attributes, returns the
// applicable renovation moves + their GTA construction-cost ranges. It runs NO
// AVM, reads NO VOW data, and exposes NO value-add dollars. The blurred hero on
// the reveal is a pure UI placeholder — no number is sent here. This is the
// anonymous half of the soft-gated /api/avm/hidden-equity route.
import { MOVE_CATALOG } from './moveCatalog';
import type { MoveSpec, MoveField, MoveKey } from './types';

/** The only home attributes move-applicability depends on (all non-VOW). */
export interface AnonCatalogInput {
  basementTier: number;
  interiorTier: number;
  exteriorTier: number;
  bathroomsTotalInteger: number;
  bedroomsAboveGrade: number;
  parkingTotal: number;
  buildingAreaTotal: number | null;
}

export interface AnonCatalogItem {
  key: MoveKey;
  label: string;
  costLow: number;
  costTyp: number;
  costHigh: number;
}

export interface AnonCatalogPayload {
  locked: true;
  catalog: AnonCatalogItem[];
}

function currentValue(field: MoveField, input: AnonCatalogInput): number | null {
  switch (field) {
    case 'basementTier': return input.basementTier;
    case 'interiorTier': return input.interiorTier;
    case 'exteriorTier': return input.exteriorTier;
    case 'bathroomsTotalInteger': return input.bathroomsTotalInteger;
    case 'bedroomsAboveGrade': return input.bedroomsAboveGrade;
    case 'parkingTotal': return input.parkingTotal;
    case 'buildingAreaTotal': return input.buildingAreaTotal;
    case 'lotWidth': return null; // no move drives this; treat as unknown
    default: return null;
  }
}

/**
 * A move is shown if applying it would actually improve the home:
 *  - 'add' deltas always change the home (positive increment).
 *  - 'set' deltas (tiers; LOWER tier = better) improve only when current > target,
 *    or when the current value is unknown (null).
 * Mirrors the engine's 'already_present' suppression — without any VOW math.
 */
export function isMoveApplicable(move: MoveSpec, input: AnonCatalogInput): boolean {
  return move.deltas.some((d) => {
    if (d.op === 'add') return d.value !== 0;
    const cur = currentValue(d.field, input); // 'set'
    return cur === null || cur > d.value;
  });
}

export function buildAnonCatalog(input: AnonCatalogInput): AnonCatalogPayload {
  const catalog: AnonCatalogItem[] = MOVE_CATALOG
    .filter((m) => isMoveApplicable(m, input))
    .map((m) => ({
      key: m.key,
      label: m.label,
      costLow: m.costLow,
      costTyp: m.costTyp,
      costHigh: m.costHigh,
    }));
  return { locked: true, catalog };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/lib/avm/valueAdd/anonCatalog.test.ts`
Expected: PASS (5 tests, including the COMPLIANCE guard).

- [ ] **Step 5: Commit**

```bash
git add src/lib/avm/valueAdd/anonCatalog.ts src/lib/avm/valueAdd/anonCatalog.test.ts
git commit -m "feat(reno-funnel): non-VOW anon catalog builder + compliance-guard test"
```

---

## Task 3: Extract `loadCohortTree()` server helper

The public page needs the cohort tree server-side (no client fetch, no 401). Extract the route's tree-loading into a reusable server function and have the route call it. Behaviour is unchanged.

**Files:**
- Create: `src/lib/avm/loadCohortTree.ts`
- Modify: `src/app/api/avm/cohorts/route.ts`

- [ ] **Step 1: Create the server helper (move cache + reads out of the route)**

```ts
// src/lib/avm/loadCohortTree.ts
//
// Server-only loader for the neighbourhood picker tree. Shared by the gated
// /api/avm/cohorts route and the PUBLIC /whats-my-home-hiding page. The tree is
// geographic/type TAXONOMY only (city → community → property types) built from
// trained cohorts — it carries NO sold prices, counts, or VOW Listing Information
// (buildCohortTree drops model_accuracy_score / total_sales_analyzed), so it is
// safe to expose publicly. Module-level 1h TTL cache (tree is global).
import { getServiceRoleClient } from '@/lib/supabase/client';
import { buildCohortTree, type CohortRow, type CityRegionPair, type CohortTree } from '@/lib/avm/cohorts';

let treeCache: { data: CohortTree; at: number } | null = null;
const TREE_TTL_MS = 60 * 60 * 1000; // 1h

export async function loadCohortTree(): Promise<CohortTree> {
  if (treeCache && Date.now() - treeCache.at < TREE_TTL_MS) return treeCache.data;

  const supabase = getServiceRoleClient();

  const { data: cohorts, error: cohortsErr } = await supabase
    .from('avm_audit_report')
    .select('city_region, property_sub_type, model_accuracy_score, total_sales_analyzed');
  if (cohortsErr) throw cohortsErr;

  const { data: pairData, error: pairErr } = await supabase.rpc('get_distinct_cohort_cities');
  if (pairErr) throw pairErr;

  const tree = buildCohortTree(
    (cohorts ?? []) as CohortRow[],
    (pairData ?? []) as CityRegionPair[],
  );
  treeCache = { data: tree, at: Date.now() };
  return tree;
}
```

- [ ] **Step 2: Refactor the route to use it (keep the 401 gate)**

Replace the body of `src/app/api/avm/cohorts/route.ts` with:

```ts
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/supabase/server';
import { loadCohortTree } from '@/lib/avm/loadCohortTree';

export async function GET() {
  if (!(await getCurrentUser())) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  }
  try {
    const tree = await loadCohortTree();
    return NextResponse.json({ tree });
  } catch (err) {
    console.error('[avm/cohorts]', err);
    return NextResponse.json({ error: 'Failed to load neighbourhoods' }, { status: 500 });
  }
}
```

- [ ] **Step 3: Verify typecheck + build**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/avm/loadCohortTree.ts src/app/api/avm/cohorts/route.ts
git commit -m "refactor(avm): extract loadCohortTree() server helper (reused by public funnel)"
```

---

## Task 4: Soft-gate the hidden-equity API route

Anonymous callers must get the locked catalog instead of a 401; consumers get the full report (unchanged). Branch on `getConsumer()`.

**Files:**
- Modify: `src/app/api/avm/hidden-equity/route.ts`

- [ ] **Step 1: Rewrite the route**

```ts
/**
 * Hidden Equity API Route — SOFT-GATED (VOW posture B)
 *
 * POST /api/avm/hidden-equity
 *  - Anonymous / non-consumer → { locked: true, catalog }  (non-VOW move list +
 *    cost ranges; NO AVM run, NO VOW reads). Powers the public funnel teaser.
 *  - Consumer (signed in, + Terms when enforced) → { locked: false, estimate,
 *    valueAdd }  (unchanged — the existing /hidden-equity tool reads these).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServiceRoleClient } from '@/lib/supabase/client';
import { getConsumer } from '@/lib/auth/requireConsumer';
import { calculateAVM } from '@/lib/avm/calculator';
import { fetchValueAddReport } from '@/lib/avm/valueAdd/engine';
import { buildAnonCatalog } from '@/lib/avm/valueAdd/anonCatalog';
import { AVMInputSchema } from '@/lib/avm/validation';
import { normalizePropertySubType } from '@/lib/avm/normalizeType';
import type { AVMInput } from '@/lib/avm/types';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const parsed = AVMInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const v = parsed.data;

    // SOFT GATE: non-consumers get the non-VOW teaser. No AVM/VOW touched.
    const { isConsumer } = await getConsumer();
    if (!isConsumer) {
      return NextResponse.json(
        buildAnonCatalog({
          basementTier: v.basementTier,
          interiorTier: v.interiorTier,
          exteriorTier: v.exteriorTier,
          bathroomsTotalInteger: v.bathroomsTotalInteger,
          bedroomsAboveGrade: v.bedroomsAboveGrade,
          parkingTotal: v.parkingTotal,
          buildingAreaTotal: v.buildingAreaTotal ?? null,
        }),
      );
    }

    // CONSUMER: full VOW-derived report (unchanged behaviour).
    const input: AVMInput = {
      cityRegion: v.cityRegion,
      city: v.city ?? null,
      propertySubType: normalizePropertySubType(v.propertySubType),
      rawPropertySubType: v.propertySubType,
      buildingAreaTotal: v.buildingAreaTotal ?? null,
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

    return NextResponse.json({ locked: false, estimate, valueAdd });
  } catch (err) {
    console.error('[avm/hidden-equity]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Verify the existing authed tool still reads the response.** `HiddenEquityTool.handleSubmit` reads `json.estimate` / `json.valueAdd` — both still present on the consumer branch (the added `locked: false` is ignored). No change needed there.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/avm/hidden-equity/route.ts
git commit -m "feat(reno-funnel): soft-gate hidden-equity API (anon→locked catalog, consumer→full)"
```

---

## Task 5: Locked reveal component

Reveal C for anonymous users: a blurred hero placeholder (no real number), the non-VOW catalog, and an unlock CTA that signs in and returns to the funnel.

**Files:**
- Create: `src/components/reno/RenovationRevealLocked.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/reno/RenovationRevealLocked.tsx
'use client';

import Link from 'next/link';
import { Lock } from 'lucide-react';
import { formatPrice } from '@/lib/utils';
import type { AnonCatalogItem } from '@/lib/avm/valueAdd/anonCatalog';

/**
 * Reveal C (locked). The hero "$▓▓▓,▓▓▓" is a pure CSS-blur PLACEHOLDER — no real,
 * VOW-derived figure is ever in the DOM for anonymous users (the server sent only
 * the catalog). Unlock routes to /login?next=<funnel> ; the funnel re-submits as a
 * consumer on return (see RenovationFunnel sessionStorage rehydrate).
 */
export default function RenovationRevealLocked({
  community,
  catalog,
  unlockHref,
  onUnlock,
}: {
  community: string | null;
  catalog: AnonCatalogItem[];
  unlockHref: string;
  onUnlock: () => void;
}) {
  const where = community ? ` in ${community}` : '';
  return (
    <div className="space-y-5 rounded-xl border border-slate-800 bg-slate-900 p-6">
      {/* Blurred hero — placeholder only */}
      <div className="rounded-lg border border-slate-700 bg-slate-950/40 p-4 text-center">
        <p className="text-xs text-slate-400">Your home may be hiding</p>
        <p className="select-none text-3xl font-bold text-emerald-400 blur-sm" aria-hidden="true">
          $000,000
        </p>
        <p className="text-xs text-slate-400">in renovation upside</p>
      </div>

      <div>
        <p className="mb-2 text-sm text-slate-300">We&apos;ll rank these for your home:</p>
        <div className="space-y-1.5">
          {catalog.map((m) => (
            <div key={m.key} className="flex items-center justify-between gap-2 text-xs">
              <span className="text-slate-300">{m.label}</span>
              <span className="shrink-0 font-mono text-slate-400">
                {formatPrice(m.costLow)}–{formatPrice(m.costHigh)}
              </span>
            </div>
          ))}
        </div>
      </div>

      <Link
        href={unlockHref}
        onClick={onUnlock}
        className="flex items-center justify-center gap-2 rounded-md border border-cyan-400/50 bg-cyan-500/20 px-4 py-2.5 text-sm font-semibold text-cyan-100 transition-colors hover:bg-cyan-500/30"
      >
        <Lock className="h-4 w-4" />
        Unlock my ranking{where} →
      </Link>
      <p className="text-center text-[11px] text-slate-500">Free · one-tap sign-in</p>
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/reno/RenovationRevealLocked.tsx
git commit -m "feat(reno-funnel): locked reveal (blurred hero + non-VOW catalog + unlock CTA)"
```

---

## Task 6: Share challenge button

Post-reveal, user-minted neighbourhood challenge — B-framing + A-hook. Carries only the community slug; never a number.

**Files:**
- Create: `src/components/reno/ShareChallengeButton.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/reno/ShareChallengeButton.tsx
'use client';

import { useState } from 'react';
import { Share2, Check } from 'lucide-react';

/**
 * Curiosity-gap share (loop A). The link carries ONLY the community slug — no
 * VOW-derived number is ever shared. The destination's generateMetadata renders
 * the branded OG card. Uses the Web Share API where available, else copies the link.
 */
export default function ShareChallengeButton({
  communitySlug,
  community,
}: {
  communitySlug: string | null;
  community: string | null;
}) {
  const [copied, setCopied] = useState(false);

  const where = community ? ` ${community}` : '';
  const url =
    typeof window !== 'undefined'
      ? `${window.location.origin}/whats-my-home-hiding${communitySlug ? `?community=${communitySlug}` : ''}`
      : '';
  const text = `I just found the hidden renovation upside in my home. What's hiding in your${where} home?`;

  const onShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'What’s my home hiding?', text, url });
        return;
      } catch {
        /* user cancelled — fall through to copy */
      }
    }
    try {
      await navigator.clipboard.writeText(`${text} ${url}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — no-op */
    }
  };

  return (
    <button
      type="button"
      onClick={onShare}
      className="flex w-full items-center justify-center gap-2 rounded-md border border-emerald-700 bg-emerald-950/40 px-4 py-2.5 text-sm font-semibold text-emerald-200 transition-colors hover:bg-emerald-900/40"
    >
      {copied ? <Check className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
      {copied ? 'Link copied' : `Challenge a neighbour`}
    </button>
  );
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/reno/ShareChallengeButton.tsx
git commit -m "feat(reno-funnel): neighbourhood challenge share button (slug-only, no VOW)"
```

---

## Task 7: Client funnel component

Owns form state, submits, branches locked/unlocked, preserves inputs across sign-in via `sessionStorage`, and shows the share button when unlocked. Reuses `HiddenEquityForm` and `HiddenEquityReport`.

**Files:**
- Create: `src/components/reno/RenovationFunnel.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/reno/RenovationFunnel.tsx
'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import HiddenEquityForm, { type HEFormState } from '@/components/hiddenEquity/HiddenEquityForm';
import HiddenEquityReport from '@/components/hiddenEquity/HiddenEquityReport';
import RenovationRevealLocked from './RenovationRevealLocked';
import ShareChallengeButton from './ShareChallengeButton';
import type { CohortTree } from '@/lib/avm/cohorts';
import type { AVMResult } from '@/lib/avm/types';
import type { ValueAddReport } from '@/lib/avm/valueAdd/types';
import type { AnonCatalogItem } from '@/lib/avm/valueAdd/anonCatalog';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

const STASH_KEY = 'reno_funnel_pending';

type Result =
  | { locked: true; catalog: AnonCatalogItem[] }
  | { locked: false; estimate: AVMResult | null; report: ValueAddReport | null };

export default function RenovationFunnel({
  tree,
  initialCity,
  initialCityRegion,
  communitySlug,
  communityLabel,
}: {
  tree: CohortTree;
  initialCity: string;
  initialCityRegion: string;
  communitySlug: string | null;
  communityLabel: string | null;
}) {
  const [form, setForm] = useState<HEFormState>({
    city: initialCity,
    cityRegion: initialCityRegion,
    propertySubType: '',
    bedroomsAboveGrade: 3,
    bathroomsTotalInteger: 2,
    parkingTotal: 1,
    interiorTier: 3,
    exteriorTier: 3,
    basementTier: 5,
    buildingAreaTotal: null,
  });
  const [result, setResult] = useState<Result | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const autoTried = useRef(false);

  const canSubmit = !!(form.city && form.cityRegion && form.propertySubType);

  const submit = useCallback(async (f: HEFormState) => {
    setSubmitting(true);
    setSubmitError(null);
    setResult(null);
    try {
      const res = await fetch('/api/avm/hidden-equity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cityRegion: f.cityRegion,
          city: f.city,
          propertySubType: f.propertySubType,
          bedroomsAboveGrade: f.bedroomsAboveGrade,
          bathroomsTotalInteger: f.bathroomsTotalInteger,
          parkingTotal: f.parkingTotal,
          interiorTier: f.interiorTier,
          exteriorTier: f.exteriorTier,
          basementTier: f.basementTier,
          buildingAreaTotal: f.buildingAreaTotal,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setSubmitError(json.error ?? 'Something went wrong. Please try again.');
        return;
      }
      if (json.locked) {
        setResult({ locked: true, catalog: json.catalog ?? [] });
      } else {
        setResult({ locked: false, estimate: json.estimate ?? null, report: json.valueAdd ?? null });
      }
    } catch {
      setSubmitError('Unable to reach the service. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }, []);

  // Rehydrate + auto-submit after returning from sign-in.
  useEffect(() => {
    if (autoTried.current) return;
    autoTried.current = true;
    let stashed: HEFormState | null = null;
    try {
      const raw = sessionStorage.getItem(STASH_KEY);
      if (raw) stashed = JSON.parse(raw) as HEFormState;
    } catch {
      stashed = null;
    }
    if (stashed) {
      sessionStorage.removeItem(STASH_KEY);
      setForm(stashed);
      void submit(stashed);
    }
  }, [submit]);

  const onUnlock = useCallback(() => {
    try {
      sessionStorage.setItem(STASH_KEY, JSON.stringify(form));
    } catch {
      /* storage blocked — unlock still navigates, user re-enters once */
    }
  }, [form]);

  const unlockHref = `/login?next=${encodeURIComponent(
    `/whats-my-home-hiding${communitySlug ? `?community=${communitySlug}` : ''}`,
  )}`;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {/* LEFT — form */}
      <Card className="border-gray-800 bg-gray-900/50 p-6">
        <div className="space-y-6">
          <div>
            <h2 className="mb-1 font-mono text-lg text-gray-100">YOUR HOME</h2>
            <p className="text-xs text-gray-500">Pick your neighbourhood and home details.</p>
          </div>
          <HiddenEquityForm tree={tree} value={form} onChange={setForm} />
          <Button
            onClick={() => void submit(form)}
            disabled={!canSubmit || submitting}
            className="w-full bg-emerald-700 font-mono text-white hover:bg-emerald-600 disabled:opacity-40"
          >
            {submitting ? 'Analyzing…' : "See what my home's hiding"}
          </Button>
          {submitError && <p className="text-sm text-red-400">{submitError}</p>}
        </div>
      </Card>

      {/* RIGHT — reveal */}
      <Card className="border-gray-800 bg-gray-900/50 p-6">
        <div className="space-y-6">
          <div>
            <h2 className="mb-1 font-mono text-lg text-gray-100">RENOVATION UPSIDE</h2>
            <p className="text-xs text-gray-500">What pays back most — for your home.</p>
          </div>

          {!result && (
            <p className="text-sm text-gray-500">
              Fill in your home on the left to reveal its renovation upside.
            </p>
          )}

          {result?.locked && (
            <RenovationRevealLocked
              community={communityLabel}
              catalog={result.catalog}
              unlockHref={unlockHref}
              onUnlock={onUnlock}
            />
          )}

          {result && !result.locked && (
            <div className="space-y-4">
              <HiddenEquityReport estimate={result.estimate} report={result.report} />
              <ShareChallengeButton communitySlug={communitySlug} community={communityLabel} />
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/reno/RenovationFunnel.tsx
git commit -m "feat(reno-funnel): client funnel (locked/unlocked reveal + sign-in rehydrate + share)"
```

---

## Task 8: Dynamic OG image route

Renders the branded neighbourhood challenge card from `?community=<slug>`. Pure (slug → display name); no VOW, no DB.

**Files:**
- Create: `src/app/api/og/whats-my-home-hiding/route.tsx`

- [ ] **Step 1: Write the route**

```tsx
// src/app/api/og/whats-my-home-hiding/route.tsx
import { ImageResponse } from 'next/og';
import type { NextRequest } from 'next/server';
import { deslugifyCommunity } from '@/lib/reno/communitySlug';

export const runtime = 'edge';

export function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get('community');
  const community = slug ? deslugifyCommunity(slug) : null;
  const headline = community
    ? `Which renovation pays you back most in ${community}?`
    : 'What renovation pays you back most in your home?';

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: 'linear-gradient(135deg, #16202e 0%, #0a0e15 60%)',
          padding: '64px',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', color: '#7ee0b8', fontSize: 28, fontWeight: 700, letterSpacing: 1 }}>
          PUREPROPERTY.CA
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ color: '#ffffff', fontSize: 60, fontWeight: 800, lineHeight: 1.15 }}>
            {headline}
          </div>
          <div style={{ color: '#9fb0c2', fontSize: 30 }}>Most homeowners guess wrong.</div>
        </div>
        <div style={{ display: 'flex', color: '#0a0e15', background: '#2f7d5b', alignSelf: 'flex-start', padding: '14px 26px', borderRadius: 10, fontSize: 28, fontWeight: 700 }}>
          Find your home&#39;s #1 move →
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
```

- [ ] **Step 2: Verify typecheck + build (build compiles the edge route + JSX)**

Run: `npm run typecheck && npm run build`
Expected: build succeeds; route `/api/og/whats-my-home-hiding` is emitted. If the build complains that `next/og` types are missing, confirm `next` ≥ 13.3 (it is, v16) — the import is `next/og`.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/og/whats-my-home-hiding/route.tsx
git commit -m "feat(reno-funnel): dynamic OG share card (next/og, community-keyed)"
```

---

## Task 9: Public landing page + metadata

The public SSR entry: loads the tree, resolves the `?community=` prefill, renders the funnel, and emits curiosity-gap SEO/OG metadata.

**Files:**
- Create: `src/app/whats-my-home-hiding/page.tsx`

- [ ] **Step 1: Write the page (+ generateMetadata)**

```tsx
// src/app/whats-my-home-hiding/page.tsx
import type { Metadata } from 'next';
import RenovationFunnel from '@/components/reno/RenovationFunnel';
import { loadCohortTree } from '@/lib/avm/loadCohortTree';
import { resolveCommunitySlug, deslugifyCommunity } from '@/lib/reno/communitySlug';

export const dynamic = 'force-dynamic';

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://pureproperty.ca').replace(/\/$/, '');

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ community?: string }>;
}): Promise<Metadata> {
  const { community: slug } = await searchParams;
  const where = slug ? deslugifyCommunity(slug) : null;
  const title = where
    ? `Which renovation pays you back most in ${where}?`
    : "What's my home hiding? Renovation upside, free";
  const description = where
    ? `Find the renovation that pays back most for your ${where} home. Free, 60-second analysis.`
    : 'Describe your home and find the renovations that pay back most in your neighbourhood. Free.';
  const ogImage = `/api/og/whats-my-home-hiding${slug ? `?community=${encodeURIComponent(slug)}` : ''}`;

  return {
    metadataBase: new URL(SITE_URL),
    title,
    description,
    openGraph: {
      title,
      description,
      url: `/whats-my-home-hiding${slug ? `?community=${encodeURIComponent(slug)}` : ''}`,
      images: [{ url: ogImage, width: 1200, height: 630 }],
    },
    twitter: { card: 'summary_large_image', title, description, images: [ogImage] },
  };
}

export default async function WhatsMyHomeHidingPage({
  searchParams,
}: {
  searchParams: Promise<{ community?: string }>;
}) {
  const { community: slug } = await searchParams;
  const tree = await loadCohortTree();
  const resolved = slug ? resolveCommunitySlug(tree, slug) : null;
  const communityLabel = resolved ? deslugifyCommunity(slug!) : null;

  return (
    <main className="mx-auto max-w-[1200px] px-4 py-10 text-slate-200">
      <h1 className="mb-1 text-3xl font-bold">What&apos;s my home hiding?</h1>
      <p className="mb-8 max-w-2xl text-sm text-slate-400">
        Describe your home and see the renovations that pay back the most where you are —
        ranked by what actually sells nearby. Free.
      </p>
      <RenovationFunnel
        tree={tree}
        initialCity={resolved?.city ?? ''}
        initialCityRegion={resolved?.cityRegion ?? ''}
        communitySlug={slug ?? null}
        communityLabel={communityLabel}
      />
    </main>
  );
}
```

- [ ] **Step 2: Verify typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: build succeeds; route `/whats-my-home-hiding` is emitted.

- [ ] **Step 3: Commit**

```bash
git add src/app/whats-my-home-hiding/page.tsx
git commit -m "feat(reno-funnel): public /whats-my-home-hiding landing + curiosity-gap metadata"
```

---

## Task 10: Full verification + manual E2E

**Files:** none (verification only)

- [ ] **Step 1: Full gates**

Run: `npm run test && npm run typecheck && npm run lint && npm run build`
Expected: all green. The new pure-logic tests pass; build emits `/whats-my-home-hiding` and `/api/og/whats-my-home-hiding`.

- [ ] **Step 2: Manual E2E (dev server).** Run `npm run dev`, then verify:

  1. **Anon teaser:** open `/whats-my-home-hiding` while signed out → pick a city/community/type, submit → the RIGHT panel shows the **blurred hero + catalog (move labels + cost ranges) + "Unlock my ranking →"**. Open devtools → Network → the `/api/avm/hidden-equity` response is `{ locked: true, catalog: [...] }` with **no dollar value, score, or ranking** anywhere.
  2. **Prefill:** open `/whats-my-home-hiding?community=churchill-meadows` → the City/Community are pre-selected (when that cohort exists).
  3. **Unlock round-trip:** click **Unlock** → sign in via the code → you land back on `/whats-my-home-hiding?...` and the analysis **auto-runs as a consumer**, showing the real estimate + ranked moves (HiddenEquityReport) + **Challenge a neighbour** button.
  4. **Share card:** open `/api/og/whats-my-home-hiding?community=erin-mills` directly → a 1200×630 branded card with the neighbourhood headline renders. Paste `/whats-my-home-hiding?community=erin-mills` into a link-preview tester (or inspect `<meta property="og:image">` in page source) → points at the OG route.
  5. **Existing tool unaffected:** `/hidden-equity` (signed in) still returns the full report.

- [ ] **Step 3: Final spec-coverage sweep.** Confirm against the spec: posture B (anon never gets VOW ✓ Task 2/4), loop A (OG share ✓ Task 6/8), reveal C (blurred hero + catalog ✓ Task 5), share B+A (Task 6), compliance guard test (Task 2), no street-address / no `manual_properties` (not built — YAGNI ✓).

- [ ] **Step 4: Finalize.** Use the `superpowers:finishing-a-development-branch` skill to choose merge / PR / cleanup.

---

## Open decisions deferred to execution (low-risk, documented)

- **`/hidden-equity`** stays as the signed-in in-terminal tool (NOT redirected). The public funnel is the new growth entry. Revisit if you want a single entry. (Caveat: when `VOW_ENFORCE_TERMS=true`, a signed-in-but-not-accepted user on `/hidden-equity` would now get the locked catalog from the soft-gated route; that page predates Terms enforcement and is out of scope here.)
- **OG infra:** new `next/og` API route (the codebase had no `next/og` usage; file-convention `opengraph-image` can't read the `?community=` query, so an API route wired via `generateMetadata` is required).
- **Cohort-tree exposure:** the public page serves the tree taxonomy (place + type names only; `buildCohortTree` already drops R²/sales counts). Treated as non-VOW. If compliance wants this gated too, swap the SSR `loadCohortTree()` for a curated static GTA community list.
