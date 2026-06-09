# True DOM Campaign-History — Phase 2a Implementation Plan (Ledger DAO + fetch hardening)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the data-access layer for the campaign ledger (`property_campaign_history`) and harden the VOW fetch wrapper with paging + timeout — the pieces the live wiring (Phase 2b) will call. No live behavior change yet.

**Architecture:** A small `store.ts` DAO turns a `CampaignEvent[]` into a persisted ledger row (using the Phase-1 engine for the summary) and reads/writes `property_campaign_history`. `fetch.ts` gains `$skip` paging (capped) and a per-call timeout so a busy address or a slow feed never hangs or silently truncates without bound. Pure logic is TDD'd; the network loop is thin and best-effort by design.

**Tech Stack:** TypeScript, Vitest (node-env, pure-logic), Supabase JS client, the AMPRE/ProptX OData feed via `ProptXClient`.

**Spec:** `docs/superpowers/specs/2026-06-08-true-dom-campaign-history-design.md` (§5 data model, §6 fetch, §8 read/write). **Prior:** Phase 1 (`docs/superpowers/plans/2026-06-08-true-dom-campaign-history-phase1.md`) shipped `src/lib/campaignHistory/{types,normalize,fetch,trueDom}.ts` on branch `feat/true-dom-campaign-history`.

**Conventions:** Tests `npm run test` / `npx vitest run <path>`; `npm run typecheck`; commit trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Branch `feat/true-dom-campaign-history` (already checked out).

**Out of scope (later phases):** replacing the stitch in `sync.ts`, the `getListingDetail` read path, `gateCampaignHistory` (all Phase 2b); the warm-pass over active inventory + Typesense `TrueDom` reindex (Phase 2c); all UI (Phase 3).

---

## File structure (Phase 2a)

- Create `src/lib/campaignHistory/store.ts` (+ `store.test.ts`) — ledger DAO: `mergeSubjectEvent`, `buildCampaignHistoryRow` (pure, tested), `readCampaignHistory`/`upsertCampaignHistory` (thin Supabase I/O).
- Modify `src/lib/campaignHistory/fetch.ts` (+ extend `fetch.test.ts`) — add `shouldFetchMore` (pure, tested) and make `fetchCampaignsByAddress` page via `$skip` with a per-call timeout.

---

## Task 1: Ledger DAO — `store.ts`

**Files:**
- Create: `src/lib/campaignHistory/store.ts`
- Test: `src/lib/campaignHistory/store.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/campaignHistory/store.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mergeSubjectEvent, buildCampaignHistoryRow } from './store';
import type { CampaignEvent } from './types';

const NOW = Date.parse('2026-06-08T18:00:00Z');
const ev = (p: Partial<CampaignEvent>): CampaignEvent => ({
  listing_key: 'k', transaction_type: 'Sale', status: 'Terminated',
  entry_date: null, end_date: null, end_reason: null, list_price: null,
  original_list_price: null, close_price: null, brokerage: null,
  price_change_date: null, address: null, ...p,
});

describe('mergeSubjectEvent', () => {
  it('adds the subject when absent and sorts newest-first', () => {
    const subject = ev({ listing_key: 'NEW', entry_date: '2026-06-06T00:00:00Z' });
    const out = mergeSubjectEvent([ev({ listing_key: 'OLD', entry_date: '2026-01-01T00:00:00Z' })], subject);
    expect(out.map((e) => e.listing_key)).toEqual(['NEW', 'OLD']);
  });
  it('lets the subject win over a duplicate listing_key from the feed', () => {
    const subject = ev({ listing_key: 'X', list_price: 999, entry_date: '2026-06-06T00:00:00Z' });
    const feed = ev({ listing_key: 'X', list_price: 111, entry_date: '2026-06-06T00:00:00Z' });
    const out = mergeSubjectEvent([feed], subject);
    expect(out).toHaveLength(1);
    expect(out[0].list_price).toBe(999);
  });
  it('returns feed events unchanged when subject is null', () => {
    const out = mergeSubjectEvent([ev({ listing_key: 'A', entry_date: '2026-01-01T00:00:00Z' })], null);
    expect(out.map((e) => e.listing_key)).toEqual(['A']);
  });
});

describe('buildCampaignHistoryRow', () => {
  const chain363: CampaignEvent[] = [
    ev({ listing_key: 'N13410488', status: 'Active', entry_date: '2026-06-06T14:46:17Z', list_price: 1729000, original_list_price: 1729000 }),
    ev({ listing_key: 'N13135326', status: 'Terminated', entry_date: '2026-05-15T17:38:46Z', end_date: '2026-06-04', list_price: 1850000, original_list_price: 1699900 }),
    ev({ listing_key: 'N12209050', transaction_type: 'Lease', status: 'Terminated', entry_date: '2025-06-10T13:28:48Z', end_date: '2025-08-07', list_price: 5300 }),
  ];
  const row = buildCampaignHistoryRow('hash363', chain363, { nowMs: NOW });

  it('keys the row and carries the event array', () => {
    expect(row.property_hash).toBe('hash363');
    expect(row.events).toHaveLength(3);
  });
  it('computes the engine metrics (sale-only true_dom, all-campaign count)', () => {
    expect(row.true_dom).toBe(24);
    expect(row.campaign_count).toBe(3);
    expect(row.total_price_drop).toBe(0);
    expect(row.is_stale).toBe(false);
  });
  it('sets first_seen_date to the oldest entry (date only)', () => {
    expect(row.first_seen_date).toBe('2025-06-10');
  });
  it('stamps fetched_at from the injected now', () => {
    expect(row.fetched_at).toBe('2026-06-08T18:00:00.000Z');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/campaignHistory/store.test.ts`
Expected: FAIL — cannot find module `./store`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/campaignHistory/store.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { computeTrueDomFromCampaigns } from './trueDom';
import type { CampaignEvent } from './types';

/** One row of property_campaign_history (matches migration 032). */
export interface CampaignHistoryRow {
  property_hash: string;
  events: CampaignEvent[];
  true_dom: number;
  total_price_drop: number;
  campaign_count: number;
  first_seen_date: string | null;
  is_stale: boolean;
  fetched_at: string;
}

function entryMs(e: CampaignEvent): number | null {
  if (!e.entry_date) return null;
  const t = Date.parse(e.entry_date);
  return Number.isNaN(t) ? null : t;
}

/**
 * Guarantee the subject listing is in the event set (subject-always-present, so a
 * feed lag never yields an empty history / true_dom=0), dedupe by listing_key with
 * the subject winning, newest-first by entry_date.
 */
export function mergeSubjectEvent(
  events: CampaignEvent[],
  subject: CampaignEvent | null
): CampaignEvent[] {
  const byKey = new Map<string, CampaignEvent>();
  if (subject) byKey.set(subject.listing_key, subject);
  for (const e of events) if (!byKey.has(e.listing_key)) byKey.set(e.listing_key, e);
  return [...byKey.values()].sort((a, b) => (entryMs(b) ?? 0) - (entryMs(a) ?? 0));
}

/** Earliest entry_date across events, as a YYYY-MM-DD string (or null). */
function oldestEntryDate(events: CampaignEvent[]): string | null {
  let oldestMs: number | null = null;
  let oldestIso: string | null = null;
  for (const e of events) {
    const t = entryMs(e);
    if (t === null) continue;
    if (oldestMs === null || t < oldestMs) {
      oldestMs = t;
      oldestIso = e.entry_date;
    }
  }
  return oldestIso ? oldestIso.slice(0, 10) : null;
}

/** Build the persisted ledger row from a property's campaign events. Pure (now injected). */
export function buildCampaignHistoryRow(
  propertyHash: string,
  events: CampaignEvent[],
  opts: { nowMs: number }
): CampaignHistoryRow {
  const m = computeTrueDomFromCampaigns(events, { nowMs: opts.nowMs });
  return {
    property_hash: propertyHash,
    events,
    true_dom: m.true_dom,
    total_price_drop: m.total_price_drop,
    campaign_count: m.campaign_count,
    first_seen_date: oldestEntryDate(events),
    is_stale: m.is_stale,
    fetched_at: new Date(opts.nowMs).toISOString(),
  };
}

/** Read the ledger row for a property_hash (PK point-lookup). null when absent. */
export async function readCampaignHistory(
  supabase: SupabaseClient,
  propertyHash: string
): Promise<CampaignHistoryRow | null> {
  const { data } = await supabase
    .from('property_campaign_history')
    .select(
      'property_hash, events, true_dom, total_price_drop, campaign_count, first_seen_date, is_stale, fetched_at'
    )
    .eq('property_hash', propertyHash)
    .maybeSingle();
  return (data as CampaignHistoryRow | null) ?? null;
}

/** Upsert a ledger row (onConflict property_hash). */
export async function upsertCampaignHistory(
  supabase: SupabaseClient,
  row: CampaignHistoryRow
): Promise<void> {
  const { error } = await supabase
    .from('property_campaign_history')
    .upsert(row, { onConflict: 'property_hash' });
  if (error) throw error;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/campaignHistory/store.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Verify types + commit (stage ONLY these two files)**

Run: `npm run typecheck`
Expected: PASS (note any pre-existing unrelated errors separately).

```bash
git add src/lib/campaignHistory/store.ts src/lib/campaignHistory/store.test.ts
git commit -m "$(cat <<'EOF'
feat(true-dom): campaign-history ledger DAO (build row + read/upsert)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Harden `fetch.ts` — paging + timeout

**Files:**
- Modify: `src/lib/campaignHistory/fetch.ts` (add `shouldFetchMore`; make `fetchCampaignsByAddress` page with a per-call timeout)
- Test: `src/lib/campaignHistory/fetch.test.ts` (append a `shouldFetchMore` describe block)

- [ ] **Step 1: Write the failing test (append to the existing `fetch.test.ts`)**

Add this import line at the top of `src/lib/campaignHistory/fetch.test.ts` — change the existing first import to also pull `shouldFetchMore`:

```ts
import { buildCampaignFilter, filterEventsToSubjectUnit, shouldFetchMore } from './fetch';
```

Then append this describe block to the end of the file:

```ts
describe('shouldFetchMore', () => {
  it('continues when the last page was full and the cap is not reached', () => {
    expect(shouldFetchMore(100, 1)).toBe(true);
  });
  it('stops on a partial page (no more rows)', () => {
    expect(shouldFetchMore(42, 1)).toBe(false);
  });
  it('stops at the page cap even on a full page', () => {
    expect(shouldFetchMore(100, 3)).toBe(false);
  });
  it('honors custom pageSize/maxPages', () => {
    expect(shouldFetchMore(50, 1, { pageSize: 50, maxPages: 2 })).toBe(true);
    expect(shouldFetchMore(50, 2, { pageSize: 50, maxPages: 2 })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/campaignHistory/fetch.test.ts`
Expected: FAIL — `shouldFetchMore` is not exported.

- [ ] **Step 3: Edit `src/lib/campaignHistory/fetch.ts`**

(a) Add this import near the other imports at the top of `fetch.ts` (the params cast below needs it):

```ts
import type { PropertySearchParams } from '@/lib/proptx/types';
```

Then add these constants + helpers near the top, after the `CAMPAIGN_SELECT` constant:

```ts
const PAGE_SIZE = 100;
const MAX_PAGES = 3; // cap: 300 campaigns at one address is already pathological
const DEFAULT_TIMEOUT_MS = 8000;

/** Page-continuation predicate: keep going only on a full page under the page cap. */
export function shouldFetchMore(
  lastPageLength: number,
  pagesFetched: number,
  opts: { pageSize?: number; maxPages?: number } = {}
): boolean {
  const pageSize = opts.pageSize ?? PAGE_SIZE;
  const maxPages = opts.maxPages ?? MAX_PAGES;
  return lastPageLength === pageSize && pagesFetched < maxPages;
}

/** Reject a promise after `ms` so a slow feed call never hangs the caller. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('campaign fetch timeout')), ms)),
  ]);
}
```

(b) Replace the existing `fetchCampaignsByAddress` function body with this paged, timeout-guarded version (keep the same export signature plus an optional `opts`):

```ts
/**
 * Fetch + normalize every campaign at the subject's address from the VOW feed.
 * Pages via $skip up to MAX_PAGES, each call timeout-guarded. Best-effort: returns
 * [] on a missing filter, and returns whatever pages succeeded if a later page
 * errors/times out (the caller decides how to treat a partial/empty result).
 */
export async function fetchCampaignsByAddress(
  addr: SubjectAddress,
  vowToken: string,
  opts: { timeoutMs?: number; maxPages?: number } = {}
): Promise<CampaignEvent[]> {
  const filter = buildCampaignFilter(addr);
  if (!filter) return [];
  const client = new ProptXClient(vowToken, 'VOW');
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxPages = opts.maxPages ?? MAX_PAGES;

  const rows: RawVowCampaign[] = [];
  let skip = 0;
  let pages = 0;
  let lastLen = 0;
  do {
    let page: RawVowCampaign[];
    try {
      const res = await withTimeout(
        client.getProperties({
          $filter: filter,
          $select: CAMPAIGN_SELECT,
          $top: PAGE_SIZE,
          $skip: skip,
          $count: false,
        } as PropertySearchParams),
        timeoutMs
      );
      page = ((res?.value ?? []) as unknown[]) as RawVowCampaign[];
    } catch {
      break; // best-effort: keep the pages we already have
    }
    rows.push(...page);
    lastLen = page.length;
    pages += 1;
    skip += PAGE_SIZE;
  } while (shouldFetchMore(lastLen, pages, { maxPages }));

  return normalizeCampaigns(filterEventsToSubjectUnit(rows, addr));
}
```

Note: the `as PropertySearchParams` assertion lets the literal carry `$skip`/`$count`/`$select` even if any aren't declared on that interface; `ProptXClient.request` iterates `Object.entries`, so every key reaches the query at runtime. If `npm run typecheck` still complains, report the exact error rather than widening the cast to `any`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/campaignHistory/fetch.test.ts`
Expected: PASS (the original 5 + 4 new `shouldFetchMore` cases = 9).

- [ ] **Step 5: Verify types + commit (stage ONLY the fetch files)**

Run: `npm run typecheck`
Expected: PASS.

```bash
git add src/lib/campaignHistory/fetch.ts src/lib/campaignHistory/fetch.test.ts
git commit -m "$(cat <<'EOF'
feat(true-dom): page + timeout-guard the VOW campaign fetch

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-review notes (author)

- Spec coverage: §5 ledger row shape → `CampaignHistoryRow`/`buildCampaignHistoryRow`; §6 paging/timeout ("follows nextLink (capped)… best-effort") → `$skip` paging + `withTimeout` (we page by `$skip` rather than `@odata.nextLink` — the feed supports `$skip` and it avoids depending on a count field; same capped, best-effort behavior); §8 subject-always-present + read/upsert → `mergeSubjectEvent` + `readCampaignHistory`/`upsertCampaignHistory`.
- Type consistency: `CampaignHistoryRow` columns match migration 032 exactly; `buildCampaignHistoryRow` returns the engine's `true_dom`/`total_price_drop`/`campaign_count`/`is_stale`; `mergeSubjectEvent` returns `CampaignEvent[]` consumed by `buildCampaignHistoryRow`.

## What's next (separate plans)

- **Phase 2b (live wiring):** replace `fetchHistoricalListings`/`fetchSoldCampaigns`/`calculateTrueDOM` in `scripts/worker/sync.ts processBatch` with `fetchCampaignsByAddress` → `mergeSubjectEvent` (subject = the listing being indexed, normalized from its own payload) → `buildCampaignHistoryRow` → `upsertCampaignHistory`; write `true_dom`/`total_price_drop` to `full_payload` + Typesense `TrueDom`; on fetch failure KEEP the prior `true_dom` (never overwrite a good value with 0). Add the `getListingDetail` read path (`readCampaignHistory`; if missing or `fetched_at` > 24h, refresh via `fetchCampaignsByAddress` + `upsertCampaignHistory`, best-effort) returning a new `campaignHistory` field; `gateCampaignHistory` + extend `gateVowDerived`.
- **Phase 2c (operational):** `scripts/admin/warmCampaignHistory.ts` — enumerate active listings, fetch+upsert ledger, recompute, reindex Typesense `TrueDom`; paced for IO/feed limits; gated on explicit go-ahead (hits prod + the VOW feed at volume).
```
