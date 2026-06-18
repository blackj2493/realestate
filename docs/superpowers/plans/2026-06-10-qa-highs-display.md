# QA Highs — Plan A: Display & Guard Quick Wins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the display/guard half of the remaining QA-audit highs: HIGH-2 (brokerage silently omitted), HIGH-4 (Infinity% render), HIGH-7 (sitemap capped at 1,000 URLs), HIGH-3 (VOW terms gate fails open), HIGH-17-remainder (Mapbox proxy routes unthrottled).

**Architecture:** Five independent, low-risk fixes, one commit each. Two get TDD (sitemap pagination, rate limiter — pure logic); the React render fixes are verified by typecheck/build (Vitest here is node-env, no jsdom). The terms-gate flip is code-plus-ops: the default hardens to fail-closed, and the merge is gated on confirming migration 029 in prod (probe script already exists at `scripts/admin/_check029.ts` — currently blocked on the Supabase instance being unhealthy).

**Tech Stack:** Next.js App Router, Vitest 4 (node env), TypeScript. Windows: always `npm.cmd`/`npx.cmd`.

**Branch:** `fix/qa-highs-display`, cut from `origin/main` **AFTER PR #20 (fix/qa-criticals) merges**. No file overlap with PR #21 (feat/market-trends) or Plan B (fix/qa-highs-etl), so all can proceed in parallel once #20 is in.

**Audit re-verification status (2026-06-10, against current main):** HIGH-2, 4, 7, 3, 17-remainder confirmed still present. HIGH-11/HIGH-12 confirmed MOOT (orphan components deleted by PR #13; live LedgerRow has neutral colors, live UnderwritingSandbox has working sliders). HIGH-1 handled by PR #21. HIGH-13/14/15/16/18 fixed by PR #20.

**Out of scope:** anything ETL/Typesense (Plan B), the analytics page (PR #21).

**File structure:**
- Modify: `src/components/CommandCenter/ListingCardBody.tsx` (2 spots)
- Modify: `src/lib/campaignHistory/timeline.ts:41` + extend `src/lib/campaignHistory/timeline.test.ts`
- Modify: `src/components/Property/CampaignHistorySection.tsx:38`
- Modify: `src/app/sitemap.ts` · Create: `src/app/sitemap.test.ts`
- Create: `src/lib/rateLimit.ts` + `src/lib/rateLimit.test.ts`
- Modify: `src/app/api/geocode/route.ts`, `src/app/api/isochrone/route.ts`
- Modify: `src/lib/auth/terms.ts` · Create: `src/lib/auth/terms.test.ts`

---

### Task 0: Branch setup

- [ ] **Step 1: Verify PR #20 is merged, then cut the branch**

```powershell
gh pr view 20 --json state --jq .state   # must print MERGED — if not, STOP and ask the user to merge it first
git status --short                        # tracked modifications? STOP and ask (stash with label, don't commit)
git fetch origin
git checkout -b fix/qa-highs-display origin/main
```

- [ ] **Step 2: Baseline**

```powershell
npm.cmd run typecheck; if ($?) { npx.cmd vitest run }
```

Expected: clean / all passing (613+ after #20; count may differ if #21 merged too — record the number as the baseline). If red, STOP and report.

---

### Task 1: HIGH-2 — brokerage always rendered on listing cards

**Files:** Modify `src/components/CommandCenter/ListingCardBody.tsx`

TRREB §6.3(c) requires the brokerage on every card. Current code conditionally renders it in BOTH branches (sold-comp branch ~lines 102-107, main branch ~lines 167-172), so an absent `ListOfficeName` silently drops it. (Upstream, transformer.ts:996 writes `raw.ListOfficeName || ''` and the Typesense write suppresses empty strings — the UI fallback is the compliance backstop; the ETL chain is Plan-B/§6 territory and NOT touched here.)

- [ ] **Step 1: Replace both conditional blocks with a mandatory fallback**

Both occurrences of:

```tsx
          {doc.ListOfficeName && (
            <>
              <span className="text-slate-600">·</span>
              <span className="truncate normal-case tracking-normal">{doc.ListOfficeName}</span>
            </>
          )}
```

become:

```tsx
          {/* TRREB §6.3(c): brokerage must always be displayed — fallback, never omit */}
          <span className="text-slate-600">·</span>
          <span className="truncate normal-case tracking-normal">{doc.ListOfficeName || "Brokerage unavailable"}</span>
```

Use Edit with `replace_all: true` (the two blocks are textually identical apart from indentation — verify with Grep first; if indentation differs, do two edits).

- [ ] **Step 2: Verify**

```powershell
# Grep ListingCardBody.tsx for "ListOfficeName &&" — expect zero matches.
npm.cmd run typecheck; if ($?) { npx.cmd vitest run }
```

- [ ] **Step 3: Commit**

```powershell
git add src/components/CommandCenter/ListingCardBody.tsx
git commit -m "fix(compliance): always render brokerage on listing cards (TRREB 6.3c)

ListOfficeName was conditionally rendered, silently omitting the
brokerage when the field is absent/empty. Resolves audit HIGH-2.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: HIGH-4 — no Infinity% when original_list_price is 0

**Files:** Modify `src/lib/campaignHistory/timeline.ts`, `src/components/Property/CampaignHistorySection.tsx`; extend `src/lib/campaignHistory/timeline.test.ts`

`timeline.ts:41` guards only `!= null`, so `original_list_price = 0` (a real TRREB data case) reaches the division at line 45 → `Infinity` → `Math.round(Infinity * 100)` renders "Infinity%" in the listing-history table.

- [ ] **Step 1: Write the failing test.** Read `src/lib/campaignHistory/timeline.test.ts` first and reuse its existing CampaignEvent factory/helper (it has one — match its name and defaults). Add to the `buildEventRows` describe block:

```ts
  it('omits the Price Changed row entirely when original_list_price is 0 (no Infinity)', () => {
    // original_list_price = 0 is a real TRREB data-quality case — division by it
    // produced Infinity and the UI rendered "Infinity%" (audit HIGH-4).
    const rows = buildEventRows([
      makeEvent({
        entry_date: '2026-01-01',
        price_change_date: '2026-01-10',
        original_list_price: 0,
        list_price: 500_000,
      }),
    ]);
    expect(rows.filter((r) => r.kind === 'Price Changed')).toHaveLength(0);
    for (const r of rows) {
      if (r.deltaPct != null) expect(Number.isFinite(r.deltaPct)).toBe(true);
    }
  });
```

(`makeEvent` = whatever the file's existing factory is called — adapt the call, not the assertions.)

- [ ] **Step 2: Run it — must fail** with a `Price Changed` row present / `deltaPct: Infinity`:

```powershell
npx.cmd vitest run src/lib/campaignHistory/timeline.test.ts
```

- [ ] **Step 3: Implement.** In `timeline.ts` line 41, change the guard from:

```ts
    if (e.price_change_date && e.original_list_price != null && e.list_price != null && e.original_list_price !== e.list_price) {
```

to:

```ts
    if (e.price_change_date && e.original_list_price != null && e.original_list_price > 0 && e.list_price != null && e.original_list_price !== e.list_price) {
```

- [ ] **Step 4: Belt-and-braces render guard.** In `CampaignHistorySection.tsx` line 38, change:

```tsx
        {r.deltaPct != null ? (
```

to:

```tsx
        {r.deltaPct != null && Number.isFinite(r.deltaPct) ? (
```

- [ ] **Step 5: Run tests (file then full) + typecheck; all green.**

- [ ] **Step 6: Commit**

```powershell
git add src/lib/campaignHistory/timeline.ts src/lib/campaignHistory/timeline.test.ts src/components/Property/CampaignHistorySection.tsx
git commit -m "fix(history): guard zero original_list_price — no more Infinity% in listing history

Division by original_list_price only checked != null, so 0 produced
Infinity and the table rendered 'Infinity%'. Resolves audit HIGH-4.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: HIGH-7 — sitemap paginates past PostgREST's 1,000-row cap

**Files:** Modify `src/app/sitemap.ts` · Create `src/app/sitemap.test.ts`

`.limit(45000)` is silently capped at 1,000 by PostgREST, so ~40k listing URLs never reach search engines.

- [ ] **Step 1: Write the failing test — create `src/app/sitemap.test.ts`:**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/client', () => ({
  getServiceRoleClient: vi.fn(),
}));

import { getServiceRoleClient } from '@/lib/supabase/client';
import sitemap from './sitemap';

/** Chainable stub whose range(from, to) returns a slice of `dataset`,
 *  mimicking PostgREST range pagination (then-only thenable). */
function supabaseReturningSlices(dataset: { listing_key: string; synced_at: string }[]) {
  let from = 0;
  let to = 0;
  const q: Record<string, unknown> = {};
  for (const m of ['from', 'select', 'order']) q[m] = vi.fn(() => q);
  q.range = vi.fn((f: number, t: number) => {
    from = f;
    to = t;
    return q;
  });
  q.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(resolve({ data: dataset.slice(from, to + 1), error: null }));
  return q as unknown as ReturnType<typeof getServiceRoleClient> & { range: ReturnType<typeof vi.fn> };
}

const row = (i: number) => ({
  listing_key: `W${String(i).padStart(8, '0')}`,
  synced_at: '2026-06-10T00:00:00Z',
});

beforeEach(() => vi.clearAllMocks());

describe('sitemap — PostgREST 1000-row pagination (audit HIGH-7)', () => {
  it('emits ALL listings when there are more than 1000 (pages with .range)', async () => {
    const dataset = Array.from({ length: 2500 }, (_, i) => row(i));
    const stub = supabaseReturningSlices(dataset);
    vi.mocked(getServiceRoleClient).mockReturnValue(stub);

    const entries = await sitemap();
    // 2 static routes + every listing
    expect(entries.length).toBe(2 + 2500);
    // PAGE must be ≤ 1000 (PostgREST hard cap) and the loop must have paged ≥ 3 times
    expect(stub.range).toHaveBeenCalledTimes(3);
    const [f0, t0] = stub.range.mock.calls[0];
    expect(t0 - f0 + 1).toBeLessThanOrEqual(1000);
  });

  it('still emits the static routes when the DB read fails', async () => {
    const q: Record<string, unknown> = {};
    for (const m of ['from', 'select', 'order', 'range']) q[m] = vi.fn(() => q);
    q.then = (resolve: (v: unknown) => unknown) => Promise.resolve(resolve({ data: null, error: new Error('boom') }));
    vi.mocked(getServiceRoleClient).mockReturnValue(q as unknown as ReturnType<typeof getServiceRoleClient>);

    const entries = await sitemap();
    expect(entries.length).toBe(2);
  });
});
```

- [ ] **Step 2: Run it — must fail** (current code makes ONE `.limit(45000)` call; `range` never called):

```powershell
npx.cmd vitest run src/app/sitemap.test.ts
```

- [ ] **Step 3: Implement — replace the query block in `src/app/sitemap.ts`** (keep the imports, SITE_URL, revalidate, staticRoutes, and the map/filter shape):

```ts
const PAGE = 1000; // PostgREST hard-caps a single response at 1000 rows — must paginate
const MAX_URLS = 45_000; // headroom under the 50k-URL sitemap protocol limit

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, changeFrequency: "daily", priority: 1 },
    { url: `${SITE_URL}/properties`, changeFrequency: "hourly", priority: 0.9 },
  ];

  try {
    const supabase = getServiceRoleClient();
    const rows: { listing_key: string | null; synced_at: string | null }[] = [];
    for (let from = 0; rows.length < MAX_URLS; from += PAGE) {
      const { data, error } = await supabase
        .from("listings")
        .select("listing_key, synced_at")
        .order("synced_at", { ascending: false })
        .order("listing_key") // deterministic tie-break so range pagination never skips/dups
        .range(from, from + PAGE - 1);
      if (error || !data) break;
      rows.push(...data);
      if (data.length < PAGE) break;
    }
    if (rows.length === 0) return staticRoutes;

    const listingRoutes: MetadataRoute.Sitemap = rows
      .slice(0, MAX_URLS)
      .filter((row) => row.listing_key)
      .map((row) => ({
        url: `${SITE_URL}/properties/${row.listing_key}`,
        lastModified: row.synced_at ? new Date(row.synced_at) : undefined,
        changeFrequency: "daily" as const,
        priority: 0.7,
      }));

    return [...staticRoutes, ...listingRoutes];
  } catch {
    // Missing env at build / DB unavailable — still emit the static routes.
    return staticRoutes;
  }
}
```

- [ ] **Step 4: Run the new test (2/2), full suite, typecheck — green.**

- [ ] **Step 5: Commit**

```powershell
git add src/app/sitemap.ts src/app/sitemap.test.ts
git commit -m "fix(seo): paginate sitemap reads — PostgREST silently capped it at 1,000 of ~45k URLs

Single .limit(45000) call returned only 1000 rows, hiding ~40k listing
pages from search engines. Now pages with .range(PAGE<=1000) and a
deterministic tie-break. Resolves audit HIGH-7.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: HIGH-17 remainder — per-IP rate caps on the Mapbox proxy routes

**Files:** Create `src/lib/rateLimit.ts`, `src/lib/rateLimit.test.ts` · Modify `src/app/api/geocode/route.ts`, `src/app/api/isochrone/route.ts`

`/api/geocode` and `/api/isochrone` proxy Mapbox unauthenticated and unthrottled — a curl loop burns paid quota. In-process fixed-window limiter (per-instance memory is acceptable on the current single-instance Railway deploy; swap for Upstash if we ever scale out — say so in the code comment).

- [ ] **Step 1: Write the failing test — create `src/lib/rateLimit.test.ts`:**

```ts
import { describe, it, expect } from 'vitest';
import { makeRateLimiter } from './rateLimit';

describe('makeRateLimiter — fixed window per key (audit HIGH-17)', () => {
  it('allows up to max requests in a window, then rejects with a Retry-After', () => {
    const rl = makeRateLimiter({ windowMs: 60_000, max: 3 });
    const t0 = 1_000_000;
    expect(rl.check('1.2.3.4', t0).allowed).toBe(true);
    expect(rl.check('1.2.3.4', t0 + 1).allowed).toBe(true);
    expect(rl.check('1.2.3.4', t0 + 2).allowed).toBe(true);
    const fourth = rl.check('1.2.3.4', t0 + 3);
    expect(fourth.allowed).toBe(false);
    expect(fourth.retryAfterSec).toBeGreaterThan(0);
    expect(fourth.retryAfterSec).toBeLessThanOrEqual(60);
  });

  it('tracks keys independently', () => {
    const rl = makeRateLimiter({ windowMs: 60_000, max: 1 });
    const t0 = 5_000;
    expect(rl.check('a', t0).allowed).toBe(true);
    expect(rl.check('b', t0).allowed).toBe(true);
    expect(rl.check('a', t0 + 1).allowed).toBe(false);
  });

  it('resets after the window elapses', () => {
    const rl = makeRateLimiter({ windowMs: 60_000, max: 1 });
    const t0 = 0;
    expect(rl.check('k', t0).allowed).toBe(true);
    expect(rl.check('k', t0 + 59_999).allowed).toBe(false);
    expect(rl.check('k', t0 + 60_000).allowed).toBe(true);
  });
});
```

- [ ] **Step 2: Run — fails (`makeRateLimiter` doesn't exist).**

- [ ] **Step 3: Implement — create `src/lib/rateLimit.ts`:**

```ts
import type { NextRequest } from 'next/server';

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Fixed-window in-process rate limiter for API routes that proxy paid upstreams
 * (Mapbox geocode/isochrone — audit HIGH-17). Per-instance memory: counters
 * reset on deploy/restart and are NOT shared across instances. That is an
 * accepted trade-off for the current single-instance Railway deploy — move to
 * Upstash/Redis if the app ever scales horizontally.
 */
export function makeRateLimiter(opts: { windowMs: number; max: number }) {
  const buckets = new Map<string, Bucket>();
  return {
    check(key: string, nowMs: number = Date.now()): { allowed: boolean; retryAfterSec: number } {
      const b = buckets.get(key);
      if (!b || nowMs >= b.resetAt) {
        // Opportunistic GC so the map can't grow unbounded across windows.
        if (buckets.size > 10_000) {
          for (const [k, v] of buckets) if (nowMs >= v.resetAt) buckets.delete(k);
        }
        buckets.set(key, { count: 1, resetAt: nowMs + opts.windowMs });
        return { allowed: true, retryAfterSec: 0 };
      }
      b.count += 1;
      if (b.count > opts.max) {
        return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((b.resetAt - nowMs) / 1000)) };
      }
      return { allowed: true, retryAfterSec: 0 };
    },
  };
}

/** Client key for rate limiting: first hop of x-forwarded-for (Railway/proxies append), else x-real-ip, else a shared bucket. */
export function clientIpFrom(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}
```

- [ ] **Step 4: Wire into `src/app/api/geocode/route.ts`.** Add imports + module-level limiter, and the gate as the FIRST thing inside the `try`:

```ts
import { makeRateLimiter, clientIpFrom } from "@/lib/rateLimit";

// 30 lookups/min/IP — generous for autocomplete typing, hostile to quota-burn loops.
const limiter = makeRateLimiter({ windowMs: 60_000, max: 30 });
```

```ts
export async function GET(req: NextRequest) {
  try {
    const rl = limiter.check(clientIpFrom(req));
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
      );
    }
    // ... existing handler body unchanged ...
```

- [ ] **Step 5: Wire into `src/app/api/isochrone/route.ts`** — identical pattern at the top of the `POST` handler's `try`, with its own module-level limiter at `{ windowMs: 60_000, max: 20 }` (isochrone calls are heavier than geocodes).

- [ ] **Step 6: Run new tests (3/3), full suite, typecheck — green.**

- [ ] **Step 7: Commit**

```powershell
git add src/lib/rateLimit.ts src/lib/rateLimit.test.ts src/app/api/geocode/route.ts src/app/api/isochrone/route.ts
git commit -m "fix(security): per-IP rate caps on Mapbox proxy routes (geocode 30/min, isochrone 20/min)

Both routes proxied paid Mapbox APIs unauthenticated and unthrottled —
a curl loop could burn the quota into overage billing. In-process
fixed-window limiter (single-instance deploy). Resolves the remaining
half of audit HIGH-17 (the /api/sync + /api/nearby half shipped in PR #20).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: HIGH-3 — VOW terms gate fails CLOSED by default

**Files:** Modify `src/lib/auth/terms.ts` · Create `src/lib/auth/terms.test.ts`

`TERMS_ENFORCED = process.env.VOW_ENFORCE_TERMS === "true"` means a missing env var silently disables the VOW terms gate. Harden to enforced-unless-explicitly-disabled. Safe even if migration 029 turns out to be unapplied: `hasAcceptedTerms` already fails OPEN with a loud log on query errors (terms.ts:38-46), so the worst case is noisy logs, not lockout.

- [ ] **Step 1: Write the failing test — create `src/lib/auth/terms.test.ts`:**

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';

// terms.ts imports the server-side Supabase helpers at module load — stub them
// so the module can be imported in the node test env.
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
  getCurrentUser: vi.fn(),
}));

const ORIGINAL = process.env.VOW_ENFORCE_TERMS;

async function loadWith(envValue: string | undefined) {
  vi.resetModules();
  if (envValue === undefined) delete process.env.VOW_ENFORCE_TERMS;
  else process.env.VOW_ENFORCE_TERMS = envValue;
  return import('./terms');
}

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.VOW_ENFORCE_TERMS;
  else process.env.VOW_ENFORCE_TERMS = ORIGINAL;
});

describe('TERMS_ENFORCED default (audit HIGH-3)', () => {
  it('ENFORCES when VOW_ENFORCE_TERMS is unset (fail closed)', async () => {
    expect((await loadWith(undefined)).TERMS_ENFORCED).toBe(true);
  });
  it('stays enforced when explicitly true', async () => {
    expect((await loadWith('true')).TERMS_ENFORCED).toBe(true);
  });
  it('can only be disabled by an explicit false', async () => {
    expect((await loadWith('false')).TERMS_ENFORCED).toBe(false);
  });
});
```

- [ ] **Step 2: Run — the "unset" test must fail** (current default is off).

- [ ] **Step 3: Implement.** In `src/lib/auth/terms.ts` line 22:

```ts
/** Server-side enforcement switch. ENFORCED unless explicitly disabled with
 *  VOW_ENFORCE_TERMS=false — a missing env var must never silently open the
 *  VOW gate (audit HIGH-3). Query errors still fail open with a loud log, so
 *  a missing migration 029 degrades to logging, not lockout. */
export const TERMS_ENFORCED = process.env.VOW_ENFORCE_TERMS !== "false";
```

Also update the file's header comment (lines 9-13): the "ROLLOUT SAFETY: enforcement is OFF by default" paragraph is now wrong — rewrite it to describe the fail-closed default and the explicit `false` escape hatch.

- [ ] **Step 4: Run new tests (3/3), full suite, typecheck — green.** Note: `.env` already sets `VOW_ENFORCE_TERMS=true` locally, so dev behavior is unchanged.

- [ ] **Step 5: Commit**

```powershell
git add src/lib/auth/terms.ts src/lib/auth/terms.test.ts
git commit -m "fix(compliance): VOW terms gate enforces by default — only an explicit false disables it

A missing VOW_ENFORCE_TERMS silently served full VOW data to every
signed-in user without the required Terms acceptance. Default is now
fail-closed; query errors still fail open with loud logs so a missing
migration can't brick access. Resolves audit HIGH-3 (code half).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 6 (OPS GATE — before merging this plan's PR, requires a healthy Supabase instance):**
  1. `npx.cmd tsx scripts/admin/_check029.ts` → must print `MIGRATION 029 APPLIED`. (On 2026-06-10 this was blocked by the instance returning Cloudflare 522 on authenticated queries — the user must restore instance health first, per the supabase-compute-sizing memory.) If it prints NOT APPLIED: paste `supabase/migrations/029_profile_vow_terms.sql` into the Supabase SQL editor (instant DDL) and re-run the probe.
  2. Confirm `VOW_ENFORCE_TERMS=true` is set in the Railway production env (Dashboard → Variables). With the new default this is belt-and-braces, but it makes intent explicit.

---

### Task 6: Final verification + PR

- [ ] **Step 1:** `npm.cmd run typecheck` · `npm.cmd run lint` (0 errors; warnings must not increase in touched files) · `npx.cmd vitest run` (baseline + 8 new tests) · `npm.cmd run build`.
- [ ] **Step 2: Runtime smoke** (`npm.cmd run dev`, note the port): listing card in /properties shows a brokerage or "Brokerage unavailable" on every card; `curl` /api/geocode?q=Brampton 31× in a loop → the 31st returns 429; /sitemap.xml renders (count `<url>` entries > 1000 if local DB has data — on a dev DB with fewer rows, just confirm it renders).
- [ ] **Step 3:** Push, open PR to main titled `fix: QA-audit display & guard highs (brokerage, Infinity%, sitemap cap, terms default, Mapbox rate caps)`. PR body: per-finding table + the Task 5 Step 6 ops gate as an explicit pre-merge checklist item. End with the standard Claude Code attribution.
