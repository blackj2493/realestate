# QA Criticals Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close all 8 critical findings from `audit/ISSUES.md` — the unauthenticated TRREB/VOW exposure routes, the sync DoS/OData-injection vector, the debug surfaces, and the public `/whats-my-home-hiding` 500.

**Architecture:** Verification showed 4 of the offending API surfaces are orphaned dead code with **zero callers** anywhere in the repo (`/api/properties`, `/api/nearby`, `/api/properties/listings/[id]`, and the GET handler of `/api/sync` — the nightly cron calls `scripts/worker/ingester.ts` directly, never the API route). Deleting them is strictly safer than gating them: no auth code to get wrong, no attack surface left. The two live code paths get surgical fixes: `POST /api/sync` (called by `PropertyNotFound.tsx`) gets strict listingKey validation killing the OData injection, and `/whats-my-home-hiding` gets a non-throwing tree loader so a Supabase timeout degrades to an empty picker instead of a 500.

**Tech Stack:** Next.js App Router routes, Vitest (node env — pure-logic tests only, no jsdom/render tests), TypeScript. All npm/npx invocations must use `npm.cmd` / `npx.cmd` (Windows).

**Branch:** `fix/qa-criticals`, cut from `origin/main` (NOT from `feat/property-history-redesign`). The `audit/` directory is untracked so it stays visible after switching; never commit `audit/` or `_migration031.sql` or `scripts/admin/_*.ts` scratch files.

**Finding → Task map:**

| Finding | Resolution | Task |
|---|---|---|
| CRITICAL-1 `/api/properties/listings/[id]` unauth VOW | Delete dead route | 1 |
| CRITICAL-2 `/api/properties` uncapped `$top` | Delete dead route | 1 |
| CRITICAL-3 `/api/properties` IDX→VOW token fallback | Delete dead route | 1 |
| CRITICAL-4 `/api/nearby` unauth live VOW calls | Delete dead route | 1 |
| HIGH-15/16 OData injection via city/postalCode | Same deletions | 1 |
| CRITICAL-7 debug surfaces (`/debug-page`, `/minimal-test`, `/simple-test`, `/api/debug-search`) | Delete all four | 2 |
| HIGH-14 hardcoded Typesense key fallback (prereq for the key rotation CRITICAL-7 demands) | Remove fallback, fail fast | 2 |
| CRITICAL-6 GET `/api/sync` unauth full ETL | Delete GET handler | 3 |
| CRITICAL-8 POST `/api/sync` OData injection | Strict `^[A-Z]\d{6,9}$` validation (TDD) | 3 |
| CRITICAL-5 `/whats-my-home-hiding` 500 | `loadCohortTreeSafe()` fallback (TDD) | 4 |

**Explicitly out of scope (separate plans):** HIGH-6 partial quick-sync upsert, HIGH-17 rate limiting, HIGH-3 `VOW_ENFORCE_TERMS` (operational env-var step), the precomputed/faster cohort-tree reads (perf follow-up to CRITICAL-5), middleware-level `/api` session enforcement (each route gates itself by established convention).

**File structure (what changes):**

- Delete: `src/app/api/properties/route.ts` (the `src/app/api/properties/listings/` subtree **STAYS** — it is the live, Typesense-backed, capped, tested route)
- Delete: `src/app/api/properties/listings/[id]/route.ts` (and the now-empty `[id]` directory)
- Delete: `src/app/api/nearby/route.ts` (and directory)
- Delete: `src/app/debug-page/page.tsx`, `src/app/minimal-test/page.tsx`, `src/app/simple-test/page.tsx`, `src/app/api/debug-search/route.ts` (and their directories)
- Modify: `src/lib/typesense/client.ts:17` (remove hardcoded key fallback)
- Modify: `src/app/api/sync/route.ts` (delete GET, validate listingKey in POST)
- Create: `src/app/api/sync/route.test.ts`
- Modify: `src/lib/avm/loadCohortTree.ts` (add `loadCohortTreeSafe`)
- Create: `src/lib/avm/loadCohortTree.test.ts`
- Modify: `src/app/whats-my-home-hiding/page.tsx:3,46` (use safe loader)

---

### Task 0: Branch setup

**Files:** none (git only)

- [ ] **Step 1: Verify clean state and cut the branch from main**

```powershell
git -C C:\Users\PCGamer\Projects\Realestate status --short
# Untracked files (audit/, .claude/skills/, docs/strategy/, _migration031.sql, scripts/admin/_*.ts) are fine — they travel with the working tree and must never be staged.
# If there are MODIFIED tracked files, STOP and ask the user (per their isolate-risky-work preference: stash with a label, don't commit for them).
git fetch origin
git checkout -b fix/qa-criticals origin/main
```

Expected: `Switched to a new branch 'fix/qa-criticals'`

- [ ] **Step 2: Baseline — confirm tests/typecheck pass on main before touching anything**

```powershell
npm.cmd run typecheck; if ($?) { npx.cmd vitest run }
```

Expected: typecheck clean, all tests pass (~604 at last audit). If the baseline is red, STOP and report — do not fix unrelated breakage in this branch.

---

### Task 1: Delete the four dead VOW-exposing routes (CRITICAL-1, 2, 3, 4 + HIGH-15/16)

**Files:**
- Delete: `src/app/api/properties/route.ts`
- Delete: `src/app/api/properties/listings/[id]/route.ts`
- Delete: `src/app/api/nearby/route.ts`

**Why deletion is safe (verified 2026-06-09):** `grep -rn "api/properties\b|api/nearby" src/ scripts/ .github/` finds zero fetch callers. The only `/api/properties/...` consumer is `/api/properties/listings` (no `[id]`, no bare route) which has its own colocated tests and stays. The live listing detail page (`src/app/(app)/properties/[id]/page.tsx`) reads from the Supabase vault via `getListingDetail` + `gateVowDerived` — it never touches these routes.

- [ ] **Step 1: Delete the three route files and their empty dirs**

```powershell
Remove-Item -Force C:\Users\PCGamer\Projects\Realestate\src\app\api\properties\route.ts
# -LiteralPath is REQUIRED: PowerShell otherwise treats [id] as a wildcard set and matches nothing.
Remove-Item -LiteralPath "C:\Users\PCGamer\Projects\Realestate\src\app\api\properties\listings\[id]" -Recurse -Force
Remove-Item -Recurse -Force C:\Users\PCGamer\Projects\Realestate\src\app\api\nearby
```

- [ ] **Step 2: Verify nothing referenced them**

```powershell
# Grep tool (or rg) over src/ for: "api/nearby", "properties/listings/[id]", "api/properties\?" — expect zero matches.
# Confirm the surviving sibling is intact:
Get-ChildItem C:\Users\PCGamer\Projects\Realestate\src\app\api\properties\listings
```

Expected: `listings` still contains `route.ts` + `route.test.ts`.

- [ ] **Step 3: Typecheck + full test suite**

```powershell
npm.cmd run typecheck; if ($?) { npx.cmd vitest run }
```

Expected: clean — these files had no importers, so nothing breaks.

- [ ] **Step 4: Commit (use the repo's `commit` skill — it enforces branch check + pre-commit typecheck/lint/test)**

```powershell
git add -A src/app/api/properties src/app/api/nearby
git commit -m "fix(security): delete dead unauth TRREB routes (/api/properties, /api/nearby, listings/[id])

Orphaned routes with zero callers served live VOW data to anonymous
callers, had an uncapped \$top, an IDX->VOW token fallback, and OData
injection via city/postalCode. Resolves audit CRITICAL-1..4, HIGH-15/16."
```

---

### Task 2: Delete debug surfaces + remove hardcoded Typesense key fallback (CRITICAL-7, HIGH-14)

**Files:**
- Delete: `src/app/debug-page/page.tsx`, `src/app/minimal-test/page.tsx`, `src/app/simple-test/page.tsx`, `src/app/api/debug-search/route.ts`
- Modify: `src/lib/typesense/client.ts:17`

The key-fallback removal belongs here because CRITICAL-7's remediation says "rotate the key" — rotation is pointless while `'BzXkIss7...'` is baked into the bundle as a fallback.

- [ ] **Step 1: Confirm the env var exists locally so removing the fallback can't break dev**

```powershell
Select-String -Path C:\Users\PCGamer\Projects\Realestate\.env.local -Pattern "NEXT_PUBLIC_TYPESENSE_SEARCH_ONLY_API_KEY" -Quiet
```

Expected: `True`. If `False`, STOP and ask the user to add it to `.env.local` (value = the current search-only key) before continuing.

- [ ] **Step 2: Delete the four debug surfaces**

```powershell
Remove-Item -Recurse -Force C:\Users\PCGamer\Projects\Realestate\src\app\debug-page
Remove-Item -Recurse -Force C:\Users\PCGamer\Projects\Realestate\src\app\minimal-test
Remove-Item -Recurse -Force C:\Users\PCGamer\Projects\Realestate\src\app\simple-test
Remove-Item -Recurse -Force C:\Users\PCGamer\Projects\Realestate\src\app\api\debug-search
```

Then Grep `src/` for `debug-page|minimal-test|simple-test|debug-search` — expect zero remaining references (the only known caller of `/api/debug-search` was `/debug-page` itself, deleted together).

- [ ] **Step 3: Remove the hardcoded key fallback in `src/lib/typesense/client.ts`**

Replace line 17:

```ts
const SEARCH_API_KEY = process.env.NEXT_PUBLIC_TYPESENSE_SEARCH_ONLY_API_KEY || 'BzXkIss7SXH0U1Hb0a1COwdvEACxbhkj';
```

with:

```ts
const SEARCH_API_KEY = process.env.NEXT_PUBLIC_TYPESENSE_SEARCH_ONLY_API_KEY ?? '';
```

and inside `getTypesenseClient()` (before constructing the client at line ~27), add a fail-fast guard so a missing key is a loud config error instead of a silently-working leaked credential:

```ts
export function getTypesenseClient(): Client {
  if (!client) {
    if (!SEARCH_API_KEY) {
      throw new Error(
        'NEXT_PUBLIC_TYPESENSE_SEARCH_ONLY_API_KEY is not set — refusing to fall back to a hardcoded key.'
      );
    }
    client = new Typesense.Client({
      // ... existing config unchanged
```

Do NOT touch `TYPESENSE_HOST` (line 15) — the host alone is not a credential, and changing it is out of scope.

- [ ] **Step 4: Typecheck + tests + production build (the build proves the deleted pages aren't linked anywhere)**

```powershell
npm.cmd run typecheck; if ($?) { npx.cmd vitest run; if ($?) { npm.cmd run build } }
```

Expected: all green. If the build fails on a missing env var, the dev `.env.local` from Step 1 covers it.

- [ ] **Step 5: Commit**

```powershell
git add -A src/app/debug-page src/app/minimal-test src/app/simple-test src/app/api/debug-search src/lib/typesense/client.ts
git commit -m "fix(security): delete debug surfaces; remove hardcoded Typesense key fallback

/minimal-test served the search key in raw HTML; /api/debug-search
returned listing data outside the capped search path. Fallback removal
makes the planned key rotation effective. Resolves audit CRITICAL-7,
HIGH-14."
```

- [ ] **Step 6: Record the operational follow-up for the user (in the final report, not code):** after this deploys, rotate the Typesense search-only key in Typesense Cloud, then update `NEXT_PUBLIC_TYPESENSE_SEARCH_ONLY_API_KEY` in Railway/CI/`.env.local` and redeploy. The old key remains in git history and previously-served bundles, so rotation is mandatory, in that order (deploy first, rotate second — rotating first would break prod search).

---

### Task 3: /api/sync — delete GET handler, validate listingKey in POST (CRITICAL-6, CRITICAL-8)

**Files:**
- Modify: `src/app/api/sync/route.ts`
- Create: `src/app/api/sync/route.test.ts`

**Constraints:** `POST /api/sync` MUST keep working unauthenticated — it is the on-demand quick-sync that `src/app/(app)/properties/[id]/PropertyNotFound.tsx:13` fires for anonymous visitors hitting a not-yet-synced listing. The injection fix is strict input validation, not auth. TRREB listing keys match `^[A-Z]\d{6,9}$` (e.g. `W12632618`, `N13229524`). Both injection points (`route.ts:60` filter, `route.ts:78` media filter) use the same variable, so one validation up front covers both. The GET handler is deleted outright: the nightly cron (`.github/workflows/daily-sync.yml`) runs `npx tsx scripts/worker/ingester.ts sync` directly and nothing calls GET `/api/sync` (only two comments in `scripts/worker/sync.ts` mention it — update them).

- [ ] **Step 1: Write the failing test — create `src/app/api/sync/route.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/client', () => ({
  getServiceRoleClient: vi.fn(),
}));
vi.mock('@/lib/proptx/client', () => ({
  ProptXClient: vi.fn(),
}));
// The GET handler (deleted in Step 3) imported the full ETL; mock it so the
// suite never loads scripts/worker/* while the handler still exists.
vi.mock('../../../../scripts/worker/ingester', () => ({
  runDeltaSync: vi.fn(),
}));

import { getServiceRoleClient } from '@/lib/supabase/client';
import { ProptXClient } from '@/lib/proptx/client';
import * as routeModule from './route';

const MockedProptX = vi.mocked(ProptXClient);
const mockedSupabase = vi.mocked(getServiceRoleClient);

function post(body: unknown): Promise<Response> {
  return routeModule.POST(
    new NextRequest(new URL('http://x/api/sync'), {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.PROPTX_VOW_TOKEN = 'test-vow-token';
  MockedProptX.mockImplementation(
    () =>
      ({
        getProperties: vi.fn().mockResolvedValue({
          value: [{ ListingKey: 'W12632618', City: 'Brampton', PropertySubType: 'Detached', DaysOnMarket: 5 }],
        }),
        getMediaBatch: vi.fn().mockResolvedValue({ value: [] }),
      }) as unknown as InstanceType<typeof ProptXClient>
  );
  mockedSupabase.mockReturnValue({
    from: vi.fn(() => ({
      upsert: vi.fn().mockResolvedValue({ error: null }),
    })),
  } as unknown as ReturnType<typeof getServiceRoleClient>);
});

describe('POST /api/sync — listingKey validation (OData injection guard)', () => {
  it("rejects an OData injection payload with 400 and never calls ProptX", async () => {
    const res = await post({
      action: 'quick-sync',
      listingKey: "X' or 1 eq 1 or ListingKey eq 'Y",
      priority: 'high',
    });
    expect(res.status).toBe(400);
    expect(MockedProptX).not.toHaveBeenCalled();
  });

  it('rejects a lowercase / malformed key with 400', async () => {
    const res = await post({ action: 'quick-sync', listingKey: 'w12632618; drop' });
    expect(res.status).toBe(400);
    expect(MockedProptX).not.toHaveBeenCalled();
  });

  it('rejects a non-string listingKey with 400', async () => {
    const res = await post({ action: 'quick-sync', listingKey: { $filter: '1 eq 1' } });
    expect(res.status).toBe(400);
    expect(MockedProptX).not.toHaveBeenCalled();
  });

  it('accepts a well-formed TRREB key and syncs it', async () => {
    const res = await post({ action: 'quick-sync', listingKey: 'W12632618', priority: 'high' });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { success: boolean; listingKey: string };
    expect(json.success).toBe(true);
    expect(json.listingKey).toBe('W12632618');
    expect(MockedProptX).toHaveBeenCalledTimes(1);
  });
});

describe('GET /api/sync — removed (unauth full-ETL trigger, audit CRITICAL-6)', () => {
  it('no longer exports a GET handler', () => {
    expect((routeModule as Record<string, unknown>).GET).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it — verify it fails for the right reasons**

```powershell
npx.cmd vitest run src/app/api/sync/route.test.ts
```

Expected: FAIL — the injection tests fail (current code 404s/proceeds instead of 400), and the GET test fails (`GET` is still exported).

- [ ] **Step 3: Implement — rewrite `src/app/api/sync/route.ts` top section**

Delete the entire `GET` handler (lines 9–30) and the `runDeltaSync` import (line 2). Replace the head of the file and the start of `POST` with:

```ts
import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/client";
import { ProptXClient } from "@/lib/proptx/client";

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // single-listing quick-sync only; the full ETL runs via GitHub Actions cron

// TRREB MLS listing keys: one uppercase board letter + 6-9 digits (e.g. W12632618).
// Strict validation is the OData-injection guard — listingKey is interpolated into
// two $filter strings below, so nothing outside this shape may pass.
const LISTING_KEY_RE = /^[A-Z]\d{6,9}$/;

/**
 * POST /api/sync - Handle quick-sync requests for individual listings
 *
 * Body: { action: 'quick-sync', listingKey: string, priority: 'high' }
 *
 * This is used when a property detail page can't find a listing in Supabase
 * and needs to trigger an immediate sync for that specific listing.
 * NOTE: the unauthenticated GET full-ETL trigger was removed 2026-06-09
 * (audit CRITICAL-6) — the nightly sync runs scripts/worker/ingester.ts via cron.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, listingKey } = body;

    if (action === 'quick-sync' && listingKey) {
      if (typeof listingKey !== 'string' || !LISTING_KEY_RE.test(listingKey)) {
        return NextResponse.json(
          { success: false, error: "Invalid listingKey format" },
          { status: 400 }
        );
      }
      console.log(`[Quick-Sync] Received request for listing: ${listingKey}`);
      // ... rest of the existing POST body (lines 48-132) UNCHANGED ...
```

Everything from `const vowToken = process.env.PROPTX_VOW_TOKEN;` down (including the upsert and both filter interpolations) stays byte-identical — the regex gate above makes the interpolations safe. Also remove the now-unused `priority` destructure if lint flags it.

- [ ] **Step 4: Update the two stale comments in `scripts/worker/sync.ts` (lines 34 and 618)** that claim `/api/sync` imports this module during `next build` — change "via /api/sync during `next build`" → "via the (since-removed) /api/sync GET route" or simply drop the route mention, e.g. line 618: `// ingester.ts imports this module for processBatch/getAdminClient`. Comment-only edit; do not change code in that file.

- [ ] **Step 5: Run the new tests, then the full suite + typecheck**

```powershell
npx.cmd vitest run src/app/api/sync/route.test.ts
npm.cmd run typecheck; if ($?) { npx.cmd vitest run }
```

Expected: new file 5/5 PASS; full suite green; typecheck clean (deleting GET removes the `runDeltaSync` import — nothing else in `src/` imports `scripts/worker/ingester`).

- [ ] **Step 6: Commit**

```powershell
git add src/app/api/sync/route.ts src/app/api/sync/route.test.ts scripts/worker/sync.ts
git commit -m "fix(security): remove unauth GET /api/sync ETL trigger; validate quick-sync listingKey

GET ran the full production ETL on any anonymous request (DoS + cursor
corruption risk); the cron calls ingester.ts directly so the route added
nothing. POST now rejects anything not matching ^[A-Z]\d{6,9}$, closing
the OData filter injection at both interpolation sites. Resolves audit
CRITICAL-6, CRITICAL-8."
```

---

### Task 4: /whats-my-home-hiding — degrade gracefully instead of 500 (CRITICAL-5)

**Files:**
- Modify: `src/lib/avm/loadCohortTree.ts`
- Create: `src/lib/avm/loadCohortTree.test.ts`
- Modify: `src/app/whats-my-home-hiding/page.tsx:3,46`

**Design:** add `loadCohortTreeSafe()` alongside the existing thrower. The page (public, SEO) uses the safe variant: on failure it serves the stale module cache if one exists (stale tree beats empty tree), else an empty `CohortTree` so `RenovationFunnel` renders with no community options instead of the route 500ing. The gated `/api/avm/cohorts` route keeps calling the throwing `loadCohortTree()` unchanged — an API consumer should see the error. The root cause (Postgres 57014 statement timeout under Supabase IO load) gets a separate perf fix later; this task is the resilience half the audit asked for.

- [ ] **Step 1: Write the failing test — create `src/lib/avm/loadCohortTree.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest';
import { buildCohortTree } from '@/lib/avm/cohorts';

vi.mock('@/lib/supabase/client', () => ({
  getServiceRoleClient: vi.fn(),
}));

// Chainable query stub: every builder method returns itself; awaiting it
// resolves to the given payload (mirrors supabase-js thenable builders).
function queryResolving(payload: { data: unknown; error: unknown }) {
  const q: Record<string, unknown> = {};
  for (const m of ['from', 'select', 'order', 'range', 'rpc']) {
    q[m] = vi.fn(() => q);
  }
  q.then = (resolve: (v: unknown) => unknown) => Promise.resolve(resolve(payload));
  return q;
}

const TIMEOUT_ERROR = Object.assign(new Error('canceling statement due to statement timeout'), {
  code: '57014',
});

// Fresh module per test: loadCohortTree.ts holds a module-level cache.
async function freshModule(payload: { data: unknown; error: unknown }) {
  vi.resetModules();
  const supa = await import('@/lib/supabase/client');
  vi.mocked(supa.getServiceRoleClient).mockReturnValue(
    queryResolving(payload) as unknown as ReturnType<typeof supa.getServiceRoleClient>
  );
  return import('./loadCohortTree');
}

describe('loadCohortTreeSafe — public-page resilience (audit CRITICAL-5)', () => {
  it('resolves to an empty tree instead of throwing when Supabase times out (57014)', async () => {
    const mod = await freshModule({ data: null, error: TIMEOUT_ERROR });
    const tree = await mod.loadCohortTreeSafe();
    expect(tree).toEqual(buildCohortTree([], []));
  });

  it('keeps loadCohortTree (unsafe) throwing for the gated API route', async () => {
    const mod = await freshModule({ data: null, error: TIMEOUT_ERROR });
    await expect(mod.loadCohortTree()).rejects.toMatchObject({ code: '57014' });
  });

  it('serves the stale cached tree when a refresh fails after a prior success', async () => {
    vi.useFakeTimers();
    try {
      // First load succeeds with one audit row + matching pair.
      const row = {
        city_region: 'Vales of Castlemore North',
        property_sub_type: 'Detached',
        model_accuracy_score: 0.8,
        total_sales_analyzed: 50,
      };
      const pair = { city: 'Brampton', city_region: 'Vales of Castlemore North' };
      vi.resetModules();
      const supa = await import('@/lib/supabase/client');
      const good = queryResolving({ data: [row, pair], error: null });
      vi.mocked(supa.getServiceRoleClient).mockReturnValue(
        good as unknown as ReturnType<typeof supa.getServiceRoleClient>
      );
      const mod = await import('./loadCohortTree');
      const first = await mod.loadCohortTreeSafe();
      expect(Object.keys(first).length).toBeGreaterThan(0);

      // Expire the 1h TTL, then make the DB fail — the stale tree must survive.
      vi.advanceTimersByTime(61 * 60 * 1000);
      vi.mocked(supa.getServiceRoleClient).mockReturnValue(
        queryResolving({ data: null, error: TIMEOUT_ERROR }) as unknown as ReturnType<
          typeof supa.getServiceRoleClient
        >
      );
      const second = await mod.loadCohortTreeSafe();
      expect(second).toEqual(first);
    } finally {
      vi.useRealTimers();
    }
  });
});
```

Note for the executor: the third test feeds `[row, pair]` to BOTH queries (audit + RPC share one stub); `buildCohortTree` ignores rows missing the fields it reads, so the tree still gains ≥1 city. If `buildCohortTree`'s actual filtering rejects the mixed array (empty `first`), give each call its own stub by making `getServiceRoleClient` return a fresh `queryResolving` per invocation with query-appropriate data — adjust the stub, not the production code.

- [ ] **Step 2: Run it — verify it fails because `loadCohortTreeSafe` doesn't exist**

```powershell
npx.cmd vitest run src/lib/avm/loadCohortTree.test.ts
```

Expected: FAIL — `loadCohortTreeSafe is not a function`.

- [ ] **Step 3: Implement — append to `src/lib/avm/loadCohortTree.ts`**

Also add `buildCohortTree` to the existing import from `'@/lib/avm/cohorts'` (it is already imported — verify; line 16 imports it).

```ts
/**
 * Non-throwing variant for the PUBLIC /whats-my-home-hiding page. A Supabase
 * failure (typically Postgres 57014 statement timeout under IO load) must
 * degrade to a stale or empty picker tree, never a route 500 — the page is a
 * public marketing/SEO surface. The gated /api/avm/cohorts route keeps using
 * loadCohortTree() so API consumers still see real errors.
 */
export async function loadCohortTreeSafe(): Promise<CohortTree> {
  try {
    return await loadCohortTree();
  } catch (err) {
    console.error('[loadCohortTree] failed — serving stale/empty tree fallback:', err);
    if (treeCache) return treeCache.data; // stale beats empty
    return buildCohortTree([], []);
  }
}
```

- [ ] **Step 4: Point the page at the safe loader — `src/app/whats-my-home-hiding/page.tsx`**

Line 3: `import { loadCohortTreeSafe } from '@/lib/avm/loadCohortTree';`
Line 46: `const tree = await loadCohortTreeSafe();`

(`loadCohortTree` is no longer imported by the page; the API route import is untouched.)

- [ ] **Step 5: Run the new tests, then full suite + typecheck**

```powershell
npx.cmd vitest run src/lib/avm/loadCohortTree.test.ts
npm.cmd run typecheck; if ($?) { npx.cmd vitest run }
```

Expected: 3/3 PASS, full suite green.

- [ ] **Step 6: Commit**

```powershell
git add src/lib/avm/loadCohortTree.ts src/lib/avm/loadCohortTree.test.ts src/app/whats-my-home-hiding/page.tsx
git commit -m "fix(runtime): /whats-my-home-hiding degrades to stale/empty tree instead of 500

loadCohortTree() rethrows Supabase errors (57014 statement timeouts under
IO load) straight through the RSC, 500ing the public SEO page for every
visitor. New loadCohortTreeSafe() serves the stale cache or an empty tree;
the gated /api/avm/cohorts route keeps the throwing variant. Resolves
audit CRITICAL-5 (resilience half; faster precomputed reads tracked
separately)."
```

---

### Task 5: Final verification + PR

**Files:** none

- [ ] **Step 1: Full gate — typecheck, lint, tests, production build**

```powershell
npm.cmd run typecheck
npm.cmd run lint
npx.cmd vitest run
npm.cmd run build
```

Expected: all green. Per superpowers:verification-before-completion — paste actual outputs, no claims without evidence.

- [ ] **Step 2: Runtime smoke (dev server)**

```powershell
npm.cmd run dev
```

Then verify each fix at runtime (separate shell, while dev server runs):

```powershell
# Deleted surfaces must 404:
foreach ($p in '/api/nearby?city=Brampton', '/api/properties?city=Brampton', '/api/properties/listings/W12632618', '/api/debug-search', '/debug-page', '/minimal-test', '/simple-test') {
  try { $r = Invoke-WebRequest -Uri "http://localhost:3000$p" -UseBasicParsing -TimeoutSec 30; $code = $r.StatusCode } catch { $code = $_.Exception.Response.StatusCode.value__ }
  "$code  $p"
}
# Expect 404 on all seven.
# GET /api/sync must 405 (handler gone), POST with injection must 400:
try { Invoke-WebRequest -Uri "http://localhost:3000/api/sync" -UseBasicParsing -TimeoutSec 10 } catch { $_.Exception.Response.StatusCode.value__ }   # expect 405
try { Invoke-WebRequest -Uri "http://localhost:3000/api/sync" -Method POST -ContentType "application/json" -Body '{"action":"quick-sync","listingKey":"X'' or 1 eq 1"}' -UseBasicParsing } catch { $_.Exception.Response.StatusCode.value__ }   # expect 400
# Public page must render (200), even if the cohort tree read is slow/failing:
(Invoke-WebRequest -Uri "http://localhost:3000/whats-my-home-hiding" -UseBasicParsing -TimeoutSec 60).StatusCode   # expect 200
```

- [ ] **Step 3: Push and open the PR (use superpowers:finishing-a-development-branch)**

```powershell
git push -u origin fix/qa-criticals
gh pr create --base main --title "fix: close all 8 critical QA-audit findings (unauth TRREB routes, sync injection, debug surfaces, public 500)" --body "..."
```

PR body should list the finding→fix table from this plan's header and the two **operational follow-ups the merge does NOT cover**: (1) rotate the Typesense search-only key after deploy (old key is in git history/served bundles), (2) `VOW_ENFORCE_TERMS=true` in prod (HIGH-3, separate). End body with the standard Claude Code attribution line.

---

## Post-merge operational checklist (user actions, not code)

1. **Rotate the Typesense search-only key** in Typesense Cloud → update `NEXT_PUBLIC_TYPESENSE_SEARCH_ONLY_API_KEY` in Railway + GitHub secrets + `.env.local` → redeploy. Order matters: deploy the fallback removal first.
2. Confirm prod env: `VOW_ENFORCE_TERMS=true` (HIGH-3, after migration 029 verified applied).
3. Next plans to write (highs, roughly in order of blast radius): HIGH-5 Typesense schema drift (400s on live filters), HIGH-8 insurance double-count, HIGH-9/10 True-DOM null-end-date stitching, HIGH-2 brokerage fallback, HIGH-7 sitemap pagination, HIGH-1 fake analytics page, HIGH-12 dead pro-forma sliders.
