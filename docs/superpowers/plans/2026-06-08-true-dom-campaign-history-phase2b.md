# True DOM Campaign-History — Phase 2b Implementation Plan (listing-page read path + gating)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the corrected True DOM + campaign history on the individual listing page: `getListingDetail` reads the `property_campaign_history` ledger (refreshing on-demand from the VOW feed when stale/missing), exposes a VOW-**gated** `campaignHistory`, and `priceTimeline.trueDom` reads the corrected value.

**Architecture:** Pure decision helpers (TTL staleness, never-regress guard, the client view + its gate) are TDD'd in the `campaignHistory` module; a thin best-effort orchestrator (`refreshCampaignHistoryForListing`) composes the Phase-2a `fetch → mergeSubjectEvent → buildCampaignHistoryRow → upsert` path behind a 24h cache; `getListingDetail` calls it (timeout-bounded, degrades silently) and `gateVowDerived` strips the VOW-sensitive parts for anonymous users.

**Tech Stack:** TypeScript, Vitest (node-env, pure-logic), Supabase JS, the VOW feed via the Phase-2a `fetchCampaignsByAddress`.

**Spec:** `docs/superpowers/specs/2026-06-08-true-dom-campaign-history-design.md` (§8 read path, §10 gating). **Prior:** Phase 1 (`…phase1.md`) + Phase 2a (`…phase2a.md`) shipped `src/lib/campaignHistory/{types,normalize,fetch,trueDom,store}.ts` on branch `feat/true-dom-campaign-history`.

**Conventions:** Tests `npm run test` / `npx vitest run <path>`; `npm run typecheck`; commit trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Branch `feat/true-dom-campaign-history` (already checked out).

**Out of scope (Phase 2c):** the nightly `sync.ts processBatch` rewiring (replace `fetchHistoricalListings`/`fetchSoldCampaigns`/`calculateTrueDOM`) and the warm-pass over active inventory + Typesense `TrueDom` reindex. Until 2c lands, the listing page is correct (on-demand fill) but the terminal/map `TrueDom` still reflects the old engine — that's expected and called out for the user.

---

## File structure (Phase 2b)

- Modify `src/lib/campaignHistory/store.ts` (+test) — add pure `isLedgerStale`, `preferFreshOrPrior`, and the thin `refreshCampaignHistoryForListing` orchestrator.
- Create `src/lib/campaignHistory/view.ts` (+test) — `CampaignHistoryView`, `toCampaignHistoryView`, `gateCampaignHistory` (the client-facing shape + its VOW gate; pure, no server deps so it's unit-testable).
- Modify `src/lib/property/getListingDetail.ts` — add `campaignHistory` to `ListingDetail`, read/refresh it, point `priceTimeline.trueDom`/`totalPriceDrop` at the ledger, and gate it in `gateVowDerived`.

---

## Task 1: Pure helpers in `store.ts` (TTL + never-regress guard)

**Files:**
- Modify: `src/lib/campaignHistory/store.ts`
- Test: `src/lib/campaignHistory/store.test.ts` (append)

- [ ] **Step 1: Append failing tests to `store.test.ts`**

Change the existing first import line to also pull the two new functions:

```ts
import { mergeSubjectEvent, buildCampaignHistoryRow, isLedgerStale, preferFreshOrPrior, type CampaignHistoryRow } from './store';
```

Append this block to the end of `store.test.ts`:

```ts
describe('isLedgerStale', () => {
  const NOW2 = Date.parse('2026-06-08T18:00:00Z');
  it('is stale when never fetched', () => {
    expect(isLedgerStale(null, NOW2)).toBe(true);
  });
  it('is fresh within the TTL', () => {
    expect(isLedgerStale('2026-06-08T06:00:00Z', NOW2)).toBe(false); // 12h < 24h
  });
  it('is stale past the TTL', () => {
    expect(isLedgerStale('2026-06-07T00:00:00Z', NOW2)).toBe(true); // 42h > 24h
  });
  it('is stale on an unparseable timestamp', () => {
    expect(isLedgerStale('not-a-date', NOW2)).toBe(true);
  });
});

describe('preferFreshOrPrior', () => {
  const row = (campaign_count: number): CampaignHistoryRow => ({
    property_hash: 'h', events: [], true_dom: 0, total_price_drop: 0,
    campaign_count, first_seen_date: null, is_stale: false, fetched_at: '2026-06-08T18:00:00.000Z',
  });
  it('keeps a richer prior when the fetch returned nothing (no regression)', () => {
    const prior = row(7);
    expect(preferFreshOrPrior(row(1), prior, 0)).toBe(prior);
  });
  it('uses fresh when the fetch returned events', () => {
    const fresh = row(3);
    expect(preferFreshOrPrior(fresh, row(7), 5)).toBe(fresh);
  });
  it('uses fresh when there is no prior', () => {
    const fresh = row(1);
    expect(preferFreshOrPrior(fresh, null, 0)).toBe(fresh);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/campaignHistory/store.test.ts`
Expected: FAIL — `isLedgerStale`/`preferFreshOrPrior` not exported.

- [ ] **Step 3: Implement in `store.ts`**

Add these two exported functions to `store.ts` (after `buildCampaignHistoryRow`):

```ts
const TTL_HOURS = 24;

/** True when the ledger row is missing/expired and should be refreshed from the feed. */
export function isLedgerStale(fetchedAt: string | null, nowMs: number, ttlHours: number = TTL_HOURS): boolean {
  if (!fetchedAt) return true;
  const t = Date.parse(fetchedAt);
  if (Number.isNaN(t)) return true;
  return nowMs - t > ttlHours * 3_600_000;
}

/**
 * Never-regress guard: when a refresh fetch returned NO campaigns (transient feed
 * failure → only the subject is in `fresh`), keep a richer prior row rather than
 * collapsing the history. Otherwise the freshly-built row wins.
 */
export function preferFreshOrPrior(
  fresh: CampaignHistoryRow,
  prior: CampaignHistoryRow | null,
  fetchedCount: number
): CampaignHistoryRow {
  if (fetchedCount === 0 && prior && prior.campaign_count > fresh.campaign_count) return prior;
  return fresh;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/campaignHistory/store.test.ts`
Expected: PASS (the original 7 + 7 new = 14).

- [ ] **Step 5: Typecheck + commit (stage ONLY the store files)**

Run: `npm run typecheck` → PASS.

```bash
git add src/lib/campaignHistory/store.ts src/lib/campaignHistory/store.test.ts
git commit -m "$(cat <<'EOF'
feat(true-dom): ledger TTL staleness + never-regress guard

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Client view + VOW gate — `view.ts`

**Files:**
- Create: `src/lib/campaignHistory/view.ts`
- Test: `src/lib/campaignHistory/view.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/campaignHistory/view.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { toCampaignHistoryView, gateCampaignHistory } from './view';
import type { CampaignHistoryRow } from './store';
import type { CampaignEvent } from './types';

const events: CampaignEvent[] = [
  { listing_key: 'A', transaction_type: 'Sale', status: 'Active', entry_date: '2026-06-06T00:00:00Z', end_date: null, end_reason: null, list_price: 800000, original_list_price: 800000, close_price: null, brokerage: 'ACME', price_change_date: null, address: '1 Main St' },
];
const row: CampaignHistoryRow = {
  property_hash: 'h', events, true_dom: 24, total_price_drop: 50000,
  campaign_count: 7, first_seen_date: '2025-06-10', is_stale: false, fetched_at: '2026-06-08T18:00:00.000Z',
};

describe('toCampaignHistoryView', () => {
  it('maps a row to the client view', () => {
    const v = toCampaignHistoryView(row);
    expect(v).toEqual({ available: true, campaignCount: 7, trueDom: 24, totalPriceDrop: 50000, firstSeenDate: '2025-06-10', events });
  });
  it('returns an empty view for a null row', () => {
    expect(toCampaignHistoryView(null)).toEqual({ available: false, campaignCount: 0, trueDom: null, totalPriceDrop: 0, firstSeenDate: null, events: [] });
  });
  it('available is false when there are no events', () => {
    expect(toCampaignHistoryView({ ...row, events: [] }).available).toBe(false);
  });
});

describe('gateCampaignHistory', () => {
  it('returns the full view for authed users', () => {
    const v = toCampaignHistoryView(row);
    expect(gateCampaignHistory(v, true)).toBe(v);
  });
  it('strips VOW-sensitive parts for anon, keeping the count + first-seen teaser', () => {
    const gated = gateCampaignHistory(toCampaignHistoryView(row), false);
    expect(gated).toEqual({ available: true, campaignCount: 7, trueDom: null, totalPriceDrop: 0, firstSeenDate: '2025-06-10', events: [] });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/campaignHistory/view.test.ts`
Expected: FAIL — cannot find module `./view`.

- [ ] **Step 3: Implement `view.ts`**

Create `src/lib/campaignHistory/view.ts`:

```ts
import type { CampaignHistoryRow } from './store';
import type { CampaignEvent } from './types';

/**
 * Listing-page shape for campaign history. `campaignCount` + `firstSeenDate` are the
 * teaser hooks that survive gating (analogous to SaleHistory.saleCount); `events`,
 * `trueDom`, `totalPriceDrop` are VOW-derived and stripped for anonymous users.
 */
export interface CampaignHistoryView {
  available: boolean;        // there is a renderable timeline (events present)
  campaignCount: number;     // "listed N times" — survives gating
  trueDom: number | null;    // VOW-derived → null for anon
  totalPriceDrop: number;    // VOW-derived → 0 for anon
  firstSeenDate: string | null;
  events: CampaignEvent[];   // VOW-sensitive → [] for anon
}

/** Map a persisted ledger row (or null) to the client view. */
export function toCampaignHistoryView(row: CampaignHistoryRow | null): CampaignHistoryView {
  if (!row) {
    return { available: false, campaignCount: 0, trueDom: null, totalPriceDrop: 0, firstSeenDate: null, events: [] };
  }
  return {
    available: row.events.length > 0,
    campaignCount: row.campaign_count,
    trueDom: row.true_dom,
    totalPriceDrop: row.total_price_drop,
    firstSeenDate: row.first_seen_date,
    events: row.events,
  };
}

/** VOW gate (CLAUDE.md §4): anon keeps only the count + first-seen teaser. */
export function gateCampaignHistory(view: CampaignHistoryView, isAuthed: boolean): CampaignHistoryView {
  if (isAuthed) return view;
  return {
    available: view.available,
    campaignCount: view.campaignCount,
    trueDom: null,
    totalPriceDrop: 0,
    firstSeenDate: view.firstSeenDate,
    events: [],
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/campaignHistory/view.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Typecheck + commit (stage ONLY the view files)**

Run: `npm run typecheck` → PASS.

```bash
git add src/lib/campaignHistory/view.ts src/lib/campaignHistory/view.test.ts
git commit -m "$(cat <<'EOF'
feat(true-dom): campaign-history client view + VOW gate

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Refresh orchestrator — `refreshCampaignHistoryForListing`

**Files:**
- Modify: `src/lib/campaignHistory/store.ts`

This is thin integration glue over the tested helpers (best-effort fetch + cache + guard + upsert). Network/DB are not unit-tested by design (node-env); correctness of the *decisions* lives in Task 1's tested helpers. Verified by typecheck + the Task 4 wiring.

- [ ] **Step 1: Add imports at the top of `store.ts`**

```ts
import { fetchCampaignsByAddress, type SubjectAddress } from './fetch';
import type { CampaignEvent } from './types';
```

(`./types` may already be imported for `CampaignEvent` — if so, keep one import; do not duplicate.)

- [ ] **Step 2: Add the orchestrator to `store.ts` (after `upsertCampaignHistory`)**

```ts
/**
 * Read the ledger for a property; if missing or older than the TTL, refresh it from
 * the VOW feed (best-effort, subject-always-merged) and upsert. Never throws and
 * never regresses a richer prior on a transient fetch failure. Returns the row to
 * use (or null when there's nothing — no prior, no subject, no fetch).
 */
export async function refreshCampaignHistoryForListing(
  supabase: SupabaseClient,
  params: {
    propertyHash: string;
    addr: SubjectAddress;
    subjectEvent: CampaignEvent | null;
    vowToken: string | undefined;
    nowMs: number;
    ttlHours?: number;
  }
): Promise<CampaignHistoryRow | null> {
  const { propertyHash, addr, subjectEvent, vowToken, nowMs, ttlHours } = params;

  let prior: CampaignHistoryRow | null = null;
  try {
    prior = await readCampaignHistory(supabase, propertyHash);
  } catch {
    prior = null;
  }

  // Fresh cache hit → serve as-is.
  if (prior && !isLedgerStale(prior.fetched_at, nowMs, ttlHours)) return prior;
  // No token → can't refresh; serve whatever we had (possibly null).
  if (!vowToken) return prior;

  let fetched: CampaignEvent[] = [];
  try {
    fetched = await fetchCampaignsByAddress(addr, vowToken);
  } catch {
    fetched = [];
  }

  const merged = mergeSubjectEvent(fetched, subjectEvent);
  if (merged.length === 0) return prior; // nothing to build

  const fresh = buildCampaignHistoryRow(propertyHash, merged, { nowMs });
  const chosen = preferFreshOrPrior(fresh, prior, fetched.length);
  if (chosen === fresh) {
    try {
      await upsertCampaignHistory(supabase, fresh);
    } catch {
      /* best-effort: still return the fresh metrics for this render */
    }
  }
  return chosen;
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS. (`fetchCampaignsByAddress`/`SubjectAddress` resolve from `./fetch`; `isLedgerStale`/`preferFreshOrPrior`/`mergeSubjectEvent`/`buildCampaignHistoryRow`/`readCampaignHistory`/`upsertCampaignHistory` are in this file.)

- [ ] **Step 4: Run the campaignHistory suite (no regressions)**

Run: `npx vitest run src/lib/campaignHistory`
Expected: PASS (types/normalize/fetch/trueDom/store/view all green).

- [ ] **Step 5: Commit (stage ONLY `store.ts`)**

```bash
git add src/lib/campaignHistory/store.ts
git commit -m "$(cat <<'EOF'
feat(true-dom): on-demand campaign-history refresh orchestrator (TTL + best-effort)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Wire `getListingDetail` (read + gate)

**Files:**
- Modify: `src/lib/property/getListingDetail.ts`

Read the file before editing. Integration — verified by typecheck + the FULL test suite + a manual smoke note. The `payload`, `supabase`, `withTimeout`, and `generatePropertyHash` used below already exist in this file (the sale-history block at ~line 372 already computes the same `propertyHash`).

- [ ] **Step 1: Add imports (top of file, near the other `@/lib/campaignHistory`-free imports)**

```ts
import {
  refreshCampaignHistoryForListing,
} from "@/lib/campaignHistory/store";
import {
  toCampaignHistoryView,
  gateCampaignHistory,
  type CampaignHistoryView,
} from "@/lib/campaignHistory/view";
import { normalizeCampaign, type RawVowCampaign } from "@/lib/campaignHistory/normalize";
```

- [ ] **Step 2: Add `campaignHistory` to the `ListingDetail` interface**

In `interface ListingDetail { … }`, add after `priceTimeline: PriceTimeline;`:

```ts
  /** Full per-property campaign history (gated for anon). Powers True DOM + the timeline. */
  campaignHistory: CampaignHistoryView;
```

- [ ] **Step 3: Read/refresh the ledger — insert AFTER the existing `saleHistory` try/catch block and BEFORE the `// Price timeline` section**

```ts
    // Campaign history (corrected True DOM + event timeline). Read the ledger; if
    // missing/stale, refresh on-demand from the VOW feed (best-effort, timeout-bounded
    // — never blocks the page). Subject is merged in so a feed lag can't zero True DOM.
    let campaignHistory: CampaignHistoryView = toCampaignHistoryView(null);
    try {
      const propertyHash =
        (typeof listing.property_hash === "string" && listing.property_hash) ||
        generatePropertyHash(payload);
      if (propertyHash) {
        const row = await withTimeout(
          refreshCampaignHistoryForListing(supabase, {
            propertyHash,
            addr: {
              StreetNumber: payload["StreetNumber"],
              StreetName: payload["StreetName"],
              City: payload["City"],
              UnitNumber: payload["UnitNumber"],
              PropertySubType: payload["PropertySubType"],
            },
            subjectEvent: normalizeCampaign(payload as RawVowCampaign),
            vowToken: process.env.PROPTX_VOW_TOKEN,
            nowMs: Date.now(),
          }),
          8000,
          "Campaign history"
        );
        campaignHistory = toCampaignHistoryView(row);
      }
    } catch (chErr) {
      console.error(`[getListingDetail] Campaign history failed for ${listingKey}:`, chErr);
    }
```

- [ ] **Step 4: Point `priceTimeline` at the ledger**

In the `// Price timeline` section, REPLACE the `totalPriceDrop` and `trueDom` consts with:

```ts
    const ledgerDrop = campaignHistory.totalPriceDrop;
    const payloadDrop =
      typeof payload["total_price_drop"] === "number" && payload["total_price_drop"] > 0
        ? (payload["total_price_drop"] as number)
        : 0;
    const totalPriceDrop = ledgerDrop > 0 ? ledgerDrop : payloadDrop;
    const trueDom =
      campaignHistory.trueDom ??
      (typeof payload["true_dom"] === "number"
        ? (payload["true_dom"] as number)
        : deriveDomDays(payload));
```

- [ ] **Step 5: Return `campaignHistory` in the `ListingDetail` object**

In the final `return { … }`, add after `priceTimeline,`:

```ts
      campaignHistory,
```

- [ ] **Step 6: Gate it for anon in `gateVowDerived`**

In `gateVowDerived`'s returned object, add after `priceTimeline: { ...detail.priceTimeline, trueDom: null },`:

```ts
    campaignHistory: gateCampaignHistory(detail.campaignHistory, false),
```

- [ ] **Step 7: Verify (typecheck + lint + full suite) and manual smoke**

Run: `npm run typecheck && npm run lint && npm run test`
Expected: all PASS (report any pre-existing unrelated lint warnings separately).

Manual smoke (report what you observe; do NOT block the commit on prod data): start `npm run dev`, open a listing detail page for a known relisted property (e.g. `/properties/N13410488` if present locally), and confirm the page renders without error and the server logs show the campaign-history block running (a `[getListingDetail] Campaign history failed` line is acceptable if `PROPTX_VOW_TOKEN` isn't set locally — it must degrade gracefully, not 500). If you cannot run dev against real data, say so and rely on typecheck + tests.

- [ ] **Step 8: Commit (stage ONLY `getListingDetail.ts`)**

```bash
git add src/lib/property/getListingDetail.ts
git commit -m "$(cat <<'EOF'
feat(true-dom): listing page reads corrected True DOM + campaign history (gated)

getListingDetail refreshes the property_campaign_history ledger on-demand (24h TTL,
subject-always-merged, best-effort) and gates VOW events for anon. priceTimeline.trueDom
now reflects the corrected engine. Terminal/map TrueDom still pending Phase 2c (sync rewire).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-review notes (author)

- Spec coverage: §8 read path (TTL refresh, subject-always-merged, best-effort, never-zero) → `refreshCampaignHistoryForListing` + `preferFreshOrPrior` + `mergeSubjectEvent`; §10 gating (authed full / anon teaser) → `gateCampaignHistory` + `gateVowDerived` extension; corrected `priceTimeline.trueDom` → Task 4 Step 4.
- Type consistency: `CampaignHistoryView` is produced by `toCampaignHistoryView(CampaignHistoryRow|null)` and consumed by `gateCampaignHistory` + `ListingDetail.campaignHistory`; `refreshCampaignHistoryForListing` returns `CampaignHistoryRow | null` (fed straight into `toCampaignHistoryView`); `subjectEvent` is `normalizeCampaign(payload) : CampaignEvent | null`, the exact type `mergeSubjectEvent` expects.
- Risk: the on-demand refresh writes to Postgres during a page render — bounded by the 24h TTL (one write per property per day max on the read path) and fully best-effort/timeout-guarded so it never breaks or blocks the page.

## What's next (Phase 2c)

Nightly `sync.ts processBatch` rewiring (replace the broken stitch with `refreshCampaignHistoryForListing` per active listing; write `true_dom`/`total_price_drop` to `full_payload` + Typesense `TrueDom`; never overwrite a good value with 0) + the one-time warm-pass over active inventory + Typesense `TrueDom` reindex. Gated on explicit go-ahead (hits prod + the VOW feed at volume).
```
