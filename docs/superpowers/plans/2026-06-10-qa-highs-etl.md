# QA Highs — Plan B: ETL/Formula Correctness + Typesense Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the data-correctness half of the remaining QA-audit highs: HIGH-8 (insurance double-counted in every cashflow), HIGH-9 (null end_date inflates True DOM stitching), HIGH-6 (quick-sync writes a crippled partial record), HIGH-5 (Typesense schema drift — undeclared-but-filtered fields), plus a dead-code sweep that retires HIGH-10's legacy engine and the orphans flagged in PR #20's final review.

**Architecture:** Formula fixes are TDD'd as pure-function tests (`calculateFinancialMetrics` and `computeTrueDomFromCampaigns` are pure). The quick-sync fix reuses the nightly ETL's `processBatch` with a fallback to today's minimal upsert so the flow can never regress. The schema fix declares the three actively-queried fields in `typesenseSchema.ts` and applies them to the LIVE collection via an alter script modeled exactly on the proven `add-transaction-type.ts` (alter → verify → export/import-update fallback; Typesense only, zero Supabase IO).

**Tech Stack:** TypeScript, Vitest 4 (node env), Typesense JS client, Supabase JS. Windows: `npm.cmd`/`npx.cmd`.

**Branch:** `fix/qa-highs-etl`, cut from `origin/main` **AFTER PR #20 merges** (Task 3 modifies `src/app/api/sync/route.ts`, which PR #20 rewrote — branching earlier guarantees conflicts). Independent of Plan A (`fix/qa-highs-display`) — zero file overlap.

**Verified current facts (2026-06-10):**
- `calculateFinancialMetrics(input: FinancialMetricsInput): FinancialMetrics` in `scripts/worker/services/financialMetrics.ts` is pure; insurance is hardcoded (`isCondo ? 480 : 1500`); returns `annual_opex`, `annual_revenue`, `mortgage_monthly` alongside the cashflows. No test file exists.
- `trueDom.ts` `resolveEndMs` returns `nowMs` for null end_date regardless of status; `trueDom.test.ts` exists but has NO test for a non-Active event with null end_date.
- The legacy `TemporalDistressEngine.calculateTrueDOM` is `@deprecated` and has ZERO callers (sync.ts imports only `generatePropertyHash`; trueDom.ts imports only `parseTimestamp`). HIGH-10 is therefore a dead-code removal, not a behavior fix.
- Quick-sync POST (`src/app/api/sync/route.ts`, post-PR #20) still upserts only 9 columns, no Typesense write. `processBatch(rawListings, options?)` in `scripts/worker/sync.ts` does transformListing + Supabase upsert + Typesense import; needs `TYPESENSE_ADMIN_API_KEY` only at call time (lazy `getAdminClient()`); media must arrive on `raw.media` (transformer derives `media_urls`/`primaryImageUrl` from it via `collectMediaUrls`/`selectPrimaryImage`).
- Schema drift: transformer writes `isDistressed` (:937), `hasSecondarySuitePotential` (:938), `targetGrossYield` (:993, dead — its filter clauses were removed by PR #13), `calculatedDOM` (:994), `BuildingAreaTotal` (:992), `price_discovery_flag` (:1029). None declared in `typesenseSchema.ts`. Live query paths: `client.ts` filter_by `isDistressed:=`/`hasSecondarySuitePotential:=` (~:376-381), `calculatedDOM:>=/<=` via the `MinDaysOnMarket` param of `/api/properties/listings` (~:403-408), and `searchNearby`'s `sort_by: 'calculatedDOM:asc'` (:689). Undeclared fields are STORED on the docs (retrievable, just not indexed) — so a schema alter re-indexes from stored values without a vault reindex.
- `.env` has `TYPESENSE_ADMIN_API_KEY` (alter script runnable locally).

**Operational note (HIGH-8):** the nightly delta sync only rewrites *changed* listings, so corrected cashflows propagate to unchanged docs only via a full reindex-from-vault. That reindex (and its bug-fixed script on the `worktree-reindex` branch that still needs a PR) is a follow-up ops task — record it in the PR body; do NOT run it inside this plan.

**Out of scope:** Plan A items; the Supabase-side region-aggregate refresh; the reindex-from-vault run.

**File structure:**
- Modify: `scripts/worker/services/financialMetrics.ts:156-157` · Create: `scripts/worker/services/financialMetrics.test.ts`
- Modify: `src/lib/campaignHistory/trueDom.ts` · Extend: `src/lib/campaignHistory/trueDom.test.ts`
- Modify: `src/app/api/sync/route.ts` · Extend: `src/app/api/sync/route.test.ts`
- Modify: `src/lib/typesense/typesenseSchema.ts`, `scripts/worker/transformer.ts:993` · Create: `scripts/admin/add-investor-filter-fields.ts`
- Delete (cleanup): dead exports in `src/lib/typesense/TemporalDistressEngine.ts`, `src/lib/propertyTypes.ts`, `createVowClient`/`createClientFromEnv` in `src/lib/proptx/client.ts` (+ barrel), `src/lib/ampre/`, and `searchNearby` in `src/lib/typesense/client.ts` if orphaned

---

### Task 0: Branch setup

- [ ] **Step 1:**

```powershell
gh pr view 20 --json state --jq .state    # must print MERGED — STOP if not
git status --short                         # tracked modifications? STOP and ask
git fetch origin
git checkout -b fix/qa-highs-etl origin/main
# Sanity: PR #20's listingKey gate must be present (Task 3 builds on it):
# Grep src/app/api/sync/route.ts for LISTING_KEY_RE — expect a match.
```

- [ ] **Step 2: Baseline** — `npm.cmd run typecheck` then `npx.cmd vitest run`; record the passing count; STOP if red.

---

### Task 1: HIGH-8 — insurance deducted exactly once

**Files:** Modify `scripts/worker/services/financialMetrics.ts` · Create `scripts/worker/services/financialMetrics.test.ts`

Line 137 already includes insurance in `annualOpex` (and `insurance * 1.2` in `annualOpexFloor`); lines 156-157 deduct it AGAIN. Every for-sale listing's `net_monthly_cashflow` is understated by $125/mo (freehold) or $40/mo (condo); the floor by $150/$48.

- [ ] **Step 1: Write the failing test — create `scripts/worker/services/financialMetrics.test.ts`:**

```ts
import { describe, it, expect } from 'vitest';
import { calculateFinancialMetrics, type FinancialMetricsInput } from './financialMetrics';

const BASE: FinancialMetricsInput = {
  annual_rent: 30_000,
  annual_rent_p10: 24_000,
  has_rent_data: true,
  calculation_price: 500_000,
  is_price_discovery: false,
  propertySubType: 'Detached',
  listPrice: 500_000,
  transactionType: 'For Sale',
  taxAnnualAmount: 4_000,
  associationFee: 0,
  maintenanceExpense: null,
  insuranceExpense: null,
  baseMillRate: 0.008,
  multiUnitStatus: 'NONE',
  isCondo: false,
};

describe('calculateFinancialMetrics — insurance single-count (audit HIGH-8)', () => {
  it('net_monthly_cashflow reconciles with its own returned components (no second insurance deduction)', () => {
    const m = calculateFinancialMetrics(BASE);
    // Spec: cashflow = grossRent*0.96 − mortgage − opex/12. Insurance is INSIDE
    // annual_opex; deducting it again (the bug) makes this off by $125/mo (freehold).
    const expected = (m.annual_revenue / 12) * 0.96 - (m.mortgage_monthly + m.annual_opex / 12);
    // Components are individually rounded to the dollar — allow ±$5; the bug is off by $125.
    expect(Math.abs(m.net_monthly_cashflow - expected)).toBeLessThanOrEqual(5);
  });

  it('condo variant reconciles too (bug delta would be $40/mo)', () => {
    const m = calculateFinancialMetrics({ ...BASE, isCondo: true, propertySubType: 'Condo Apartment', associationFee: 600 });
    const expected = (m.annual_revenue / 12) * 0.96 - (m.mortgage_monthly + m.annual_opex / 12);
    expect(Math.abs(m.net_monthly_cashflow - expected)).toBeLessThanOrEqual(5);
  });
});
```

- [ ] **Step 2: Run — both tests must FAIL with a delta of ≈125 / ≈40:**

```powershell
npx.cmd vitest run scripts/worker/services/financialMetrics.test.ts
```

If the test file fails to import (e.g. `FinancialMetricsInput` not exported, or a transitive import does I/O at module load), report the actual error — adapt the import, never the assertions.

- [ ] **Step 3: Implement.** Lines 156-157 of `financialMetrics.ts`:

```ts
  const netMonthlyCashflow = (monthlyGrossRent * 0.96) - (mortgageMonthly + (annualOpex / 12) + (insurance / 12));
  const netMonthlyCashflowFloor = ((annualRevenueP10 / 12) * 0.92) - (mortgageMonthly + (annualOpexFloor / 12) + (insurance * 1.2 / 12));
```

become:

```ts
  // Insurance is already inside annualOpex / annualOpexFloor — deduct it exactly once (audit HIGH-8).
  const netMonthlyCashflow = (monthlyGrossRent * 0.96) - (mortgageMonthly + (annualOpex / 12));
  const netMonthlyCashflowFloor = ((annualRevenueP10 / 12) * 0.92) - (mortgageMonthly + (annualOpexFloor / 12));
```

- [ ] **Step 4: Add a floor regression test.** Read the function (lines ~60-150) and hand-derive `cashflow_floor` for `BASE` from the source formulas (annualRevenueP10 derivation → grossRentNetVacancyFloor → annualOpexFloor → the fixed formula), then add:

```ts
  it('cashflow_floor matches the hand-derived spec value for BASE', () => {
    const m = calculateFinancialMetrics(BASE);
    expect(m.cashflow_floor).toBe(/* hand-derived integer from the source formulas — show the arithmetic in a comment */);
  });
```

The derivation must be done on paper from the read source (it is the test's independent oracle) — do not paste the function's own output.

- [ ] **Step 5: Run the file (3/3), full suite, typecheck — green.**

- [ ] **Step 6: Commit**

```powershell
git add scripts/worker/services/financialMetrics.ts scripts/worker/services/financialMetrics.test.ts
git commit -m "fix(formula): stop double-counting insurance in net_monthly_cashflow and cashflow_floor

annualOpex already contains insurance; lines 156-157 deducted it a
second time, understating every for-sale cashflow by \$40-150/mo and
biasing investors away from viable deals. Resolves audit HIGH-8.
Full effect on existing Typesense docs requires the reindex-from-vault
follow-up (nightly delta only rewrites changed listings).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: HIGH-9 — unknown terminal dates never stitch into True DOM

**Files:** Modify `src/lib/campaignHistory/trueDom.ts` · Extend `src/lib/campaignHistory/trueDom.test.ts`

`resolveEndMs` returns `nowMs` when `end_date` is null even for Terminated/Expired campaigns. The gap check `(nextStartMs - prior.endMs) > windowDays` then sees a huge NEGATIVE gap, so every null-end-date historical campaign stitches unconditionally: a 2024 campaign with a missing TerminatedDate turns a fresh 38-day listing into true_dom ≈ 737.

- [ ] **Step 1: Write the failing tests.** Read `trueDom.test.ts` first and reuse its existing event factory (match its name/defaults). Add a describe block:

```ts
describe('null end_date on non-Active campaigns (audit HIGH-9)', () => {
  it('does NOT stitch a Terminated campaign with no end_date — true_dom counts only the fresh campaign', () => {
    const now = Date.parse('2026-06-09T00:00:00Z');
    const events = [
      makeEvent({ listing_key: 'OLD1', status: 'Terminated', entry_date: '2024-06-01', end_date: null, transaction_type: 'Sale' }),
      makeEvent({ listing_key: 'NEW1', status: 'Active', entry_date: '2026-05-02', end_date: null, transaction_type: 'Sale' }),
    ];
    const r = computeTrueDomFromCampaigns(events, { nowMs: now });
    expect(r.true_dom).toBe(38); // 2026-05-02 → 2026-06-09, NOT ~737 days back to 2024
  });

  it('still stitches a prior with a KNOWN end_date within the window (regression guard)', () => {
    const now = Date.parse('2026-06-09T00:00:00Z');
    const events = [
      makeEvent({ listing_key: 'OLD2', status: 'Terminated', entry_date: '2026-03-01', end_date: '2026-04-20', transaction_type: 'Sale' }),
      makeEvent({ listing_key: 'NEW2', status: 'Active', entry_date: '2026-05-02', end_date: null, transaction_type: 'Sale' }),
    ];
    const r = computeTrueDomFromCampaigns(events, { nowMs: now });
    expect(r.true_dom).toBe(100); // gap 12d ≤ 35 → stitched back to 2026-03-01
  });

  it('a NEWEST non-Active campaign with no end_date contributes 0 days (conservative, not inflated)', () => {
    const now = Date.parse('2026-06-09T00:00:00Z');
    const events = [
      makeEvent({ listing_key: 'ONLY', status: 'Terminated', entry_date: '2025-01-01', end_date: null, transaction_type: 'Sale' }),
    ];
    const r = computeTrueDomFromCampaigns(events, { nowMs: now });
    expect(r.true_dom).toBe(0); // unknown terminal — refuse to fabricate ~524 days
  });
});
```

- [ ] **Step 2: Run — tests 1 and 3 must fail with the inflated values; test 2 should already pass.**

- [ ] **Step 3: Implement in `trueDom.ts`.** Replace `SaleNode` and `resolveEndMs`:

```ts
interface SaleNode {
  e: CampaignEvent;
  startMs: number;
  endMs: number | null; // real terminal date; nowMs while Active; null = unknown terminal (never stitched across)
}

function resolveEndMs(e: CampaignEvent, nowMs: number): number | null {
  const end = parseTimestamp(e.end_date);
  if (end !== null) return end;
  // Non-Active with no terminal date = ended at an UNKNOWN time. Treating it as
  // "ended now" made every historical gap negative, so such campaigns stitched
  // unconditionally and inflated true_dom by months/years (audit HIGH-9).
  return e.status === 'Active' ? nowMs : null;
}
```

In `currentStitchedSaleSpan`, the `.map` for `endMs` stays the same call; update the two consumers:

```ts
  const newest = sales[0];
  // Active → measure to now. Known terminal → measure to it. UNKNOWN terminal →
  // contribute zero days rather than fabricating a span (conservative for a distress signal).
  const endMs = newest.e.status === 'Active' ? opts.nowMs : (newest.endMs ?? newest.startMs);
```

and in the stitching loop, before the gap check:

```ts
    const prior = sales[i];
    if (prior.endMs === null) break; // unknown terminal date — never stitch across it
    if (Math.floor((nextStartMs - prior.endMs) / DAY_MS) > windowDays) break;
```

Fix the intermediate typing: the `.map((n) => ({ ...n, endMs: resolveEndMs(n.e, opts.nowMs) }))` now produces `endMs: number | null` — adjust the earlier `.filter((n): n is SaleNode => n.startMs !== null)` placement so types check (the placeholder `endMs: 0` in the first map can stay; the type predicate is on startMs only).

- [ ] **Step 4: Run the file (all green), full suite, typecheck.** `timeline.ts` consumes `currentStitchedSaleSpan` for chart spans — its tests must stay green (a behavior change there is EXPECTED only if a timeline test fabricated a null-end-date non-Active sale; inspect any failure before touching it, and report if one occurs).

- [ ] **Step 5: Commit**

```powershell
git add src/lib/campaignHistory/trueDom.ts src/lib/campaignHistory/trueDom.test.ts
git commit -m "fix(true-dom): never stitch across campaigns with unknown terminal dates

resolveEndMs treated a missing end_date as 'ended now' for ALL statuses,
making historical gaps negative so Terminated/Expired campaigns without
TerminatedDate/ExpirationDate stitched unconditionally — inflating
true_dom by months or years and faking distress. Unknown terminals now
break the chain; an unknown-terminal newest campaign counts 0 days.
Resolves audit HIGH-9.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: HIGH-6 — quick-sync runs the full transform pipeline

**Files:** Modify `src/app/api/sync/route.ts` · Extend `src/app/api/sync/route.test.ts`

The POST quick-sync upserts a 9-column partial record: NULL financials poison region aggregates and the listing never reaches Typesense. Fix: attach the fetched media to the raw payload and run `processBatch([prop])` (the nightly ETL path — transform + Supabase + Typesense + campaign history). Keep the current minimal upsert as a CATCH FALLBACK so quick-sync never regresses (e.g. if `TYPESENSE_ADMIN_API_KEY` is absent in the web runtime, `processBatch` throws at the Typesense step — note: its Supabase upsert has already succeeded by then, so the fallback's re-upsert is harmlessly idempotent).

- [ ] **Step 1: Write the failing tests.** In `src/app/api/sync/route.test.ts`, add a mock for the sync module (alongside the existing mocks):

```ts
vi.mock('../../../../scripts/worker/sync', () => ({
  processBatch: vi.fn(),
}));
```

import it:

```ts
import { processBatch } from '../../../../scripts/worker/sync';
const mockedProcessBatch = vi.mocked(processBatch);
```

in `beforeEach`, add a default success resolution:

```ts
  mockedProcessBatch.mockResolvedValue({
    success: true,
    supabase: { inserted: 1, failed: 0, errors: [] },
    typesense: { indexed: 1, failed: 0, errors: [] },
  } as Awaited<ReturnType<typeof processBatch>>);
```

and add a describe block:

```ts
describe('POST /api/sync — full pipeline quick-sync (audit HIGH-6)', () => {
  it('runs processBatch with the fetched listing + attached media', async () => {
    const res = await post({ action: 'quick-sync', listingKey: 'W12632618' });
    expect(res.status).toBe(200);
    expect(mockedProcessBatch).toHaveBeenCalledTimes(1);
    const batch = mockedProcessBatch.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(batch).toHaveLength(1);
    expect(batch[0].ListingKey).toBe('W12632618');
    expect(Array.isArray(batch[0].media)).toBe(true); // media attached for transformListing
  });

  it('falls back to the minimal upsert (still 200) when the full pipeline throws', async () => {
    mockedProcessBatch.mockRejectedValueOnce(new Error('TYPESENSE_ADMIN_API_KEY is not set in environment'));
    const res = await post({ action: 'quick-sync', listingKey: 'W12632618' });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { success: boolean; pipeline?: string };
    expect(json.success).toBe(true);
    expect(json.pipeline).toBe('fallback-minimal');
  });

  it('reports the pipeline mode on the happy path', async () => {
    const res = await post({ action: 'quick-sync', listingKey: 'W12632618' });
    expect(((await res.json()) as { pipeline?: string }).pipeline).toBe('full');
  });
});
```

The existing happy-path test (`accepts a well-formed TRREB key and syncs it`) asserts on the legacy supabase upsert — it will need its expectation reconciled: after this change the LEGACY upsert only runs on fallback, so update that test to assert `pipeline: 'full'` + `mockedProcessBatch` called (keep its 200/success/listingKey assertions).

- [ ] **Step 2: Run — new tests fail** (`processBatch` never called; no `pipeline` field).

- [ ] **Step 3: Implement in `route.ts`.** Add the import:

```ts
import { processBatch } from "../../../../scripts/worker/sync";
```

Inside the handler, keep everything through the media fetch, but ALSO keep the raw media items (not just the URL strings):

```ts
      // Fetch media for this listing
      let mediaUrls: string[] = [];
      let mediaItems: unknown[] = [];
      try {
        const mediaResponse = await client.getMediaBatch(`ResourceRecordKey eq '${listingKey}'`);
        mediaItems = mediaResponse.value;
        // ... existing sizePriority/sortedMedia/mediaUrls code unchanged ...
```

Then REPLACE the direct Supabase upsert block with:

```ts
      // Attach media so transformListing derives media_urls / primaryImageUrl
      // exactly like the nightly ETL (it reads raw.media — audit HIGH-6).
      (prop as Record<string, unknown>).media = mediaItems;

      try {
        const result = await processBatch([prop]);
        if (result.supabase.failed > 0) {
          throw new Error(String(result.supabase.errors?.[0] ?? "supabase upsert failed"));
        }
        console.log(`[Quick-Sync] Full pipeline synced listing: ${listingKey}`);
        return NextResponse.json({
          success: true,
          message: "Listing synced successfully",
          listingKey,
          mediaCount: mediaUrls.length,
          pipeline: "full",
        });
      } catch (pipelineErr) {
        // The full pipeline needs ETL env (e.g. TYPESENSE_ADMIN_API_KEY at the
        // Typesense step). Never let that break on-demand sync for a visitor —
        // degrade to the legacy minimal upsert; the nightly ETL repairs the rest.
        console.error(`[Quick-Sync] full pipeline failed for ${listingKey} — falling back to minimal upsert:`, pipelineErr);
      }

      // Fallback: legacy minimal upsert (pre-HIGH-6 behavior, kept as a floor)
      const supabase = getServiceRoleClient();
      const { error: upsertError } = await supabase
        .from('listings')
        .upsert({
          // ... the existing 9-column object, byte-identical ...
        }, { onConflict: 'listing_key' });

      if (upsertError) { /* existing 500 response unchanged */ }

      console.log(`[Quick-Sync] Successfully synced listing (minimal): ${listingKey}`);
      return NextResponse.json({
        success: true,
        message: "Listing synced successfully",
        listingKey,
        mediaCount: mediaUrls.length,
        pipeline: "fallback-minimal",
      });
```

- [ ] **Step 4: Run the route tests, full suite, typecheck, AND `npm.cmd run build`** (the route now imports the ETL module graph — the build must stay green; sync.ts is verified import-safe, its admin client is lazy).

- [ ] **Step 5: Manual smoke (recommended):** `npm.cmd run dev`, POST a real listing key to /api/sync, confirm `pipeline: "full"` locally (local .env has the admin key) and that the listing's `list_price`/`property_hash` columns are populated in Supabase — SKIP the DB check if the instance is still unhealthy, and say so in the report.

- [ ] **Step 6: Commit**

```powershell
git add src/app/api/sync/route.ts src/app/api/sync/route.test.ts
git commit -m "fix(etl): quick-sync runs the full transform pipeline instead of a 9-column partial upsert

On-demand synced listings had NULL financials (poisoning region
aggregates) and never reached Typesense. POST /api/sync now attaches the
fetched media and calls processBatch (transform + Supabase + Typesense +
campaign history), with the legacy minimal upsert kept as a fallback so
a missing ETL env var degrades instead of breaking the visitor flow.
Resolves audit HIGH-6.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: HIGH-5 — declare the queried investor fields in the Typesense schema and alter the live collection

**Files:** Modify `src/lib/typesense/typesenseSchema.ts`, `scripts/worker/transformer.ts` · Create `scripts/admin/add-investor-filter-fields.ts`

Three transformer-written fields are queried by live code paths but undeclared, so any query touching them is HTTP 400: `isDistressed`, `hasSecondarySuitePotential` (filter_by in client.ts — exposed via the `SearchFilters` interface), `calculatedDOM` (filter_by via the `MinDaysOnMarket` route param; sort_by in `searchNearby`). The values are already STORED on every doc, so a collection alter re-indexes them without touching Supabase. Also: `targetGrossYield` (transformer:993) is dead — its last consumers were removed by PR #13 — delete the write instead of declaring it. `BuildingAreaTotal` and `price_discovery_flag` are display cargo (stored is sufficient) — leave them undeclared, but document that.

- [ ] **Step 1: Declare the three fields in `typesenseSchema.ts`.** Add to the `fields` array, matching the file's existing entry style:

```ts
  // Investor-filter fields — written by transformer.ts since Phase 2 but undeclared
  // until 2026-06-10 (audit HIGH-5): every filter_by/sort_by on them was HTTP 400.
  // Live collection altered via scripts/admin/add-investor-filter-fields.ts.
  { name: 'isDistressed', type: 'bool' as const, facet: true },
  { name: 'hasSecondarySuitePotential', type: 'bool' as const, facet: true },
  { name: 'calculatedDOM', type: 'int32' as const, facet: false, sort: true, optional: true },
```

(`calculatedDOM` is optional because transformer.ts:994 writes it conditionally.) Also add a one-line comment near the array noting that `BuildingAreaTotal` / `price_discovery_flag` are deliberately stored-only.

- [ ] **Step 2: Delete the dead `targetGrossYield` write.** In `transformer.ts` remove line 993 (`if (metrics.targetGrossYield !== null) typesensePayload.targetGrossYield = ...`). Then Grep `targetGrossYield` across src/ and scripts/: remove now-dead producers (e.g. the field on the metrics object and its computation) ONLY if nothing else reads them — otherwise leave the computation and just stop emitting to Typesense. Report what you found.

- [ ] **Step 3: Create `scripts/admin/add-investor-filter-fields.ts`** — a multi-field generalization of the proven `add-transaction-type.ts` (same client setup, same dry-run/--apply contract, same fallback). Full content:

```ts
/**
 * Shadow MLS — index the investor-filter fields on the live `properties` collection.
 *
 * isDistressed / hasSecondarySuitePotential / calculatedDOM have always been STORED
 * on every doc (transformer.ts writes them) but were never DECLARED, so every
 * filter_by/sort_by on them returned HTTP 400 (audit HIGH-5). This script:
 *   1. ALTERs the collection to add each missing field (definitions pulled from
 *      typesenseSchema — the source of truth; declare there first).
 *   2. VERIFIES docs got indexed (an alter re-indexes from the stored raw docs);
 *      falls back to export → import(action:'update') if not.
 *
 * Typesense ONLY — zero Supabase reads (IO budget). Idempotent: re-running no-ops.
 *
 * Usage:
 *   npx tsx scripts/admin/add-investor-filter-fields.ts          # dry-run
 *   npx tsx scripts/admin/add-investor-filter-fields.ts --apply  # alter live
 */
import 'dotenv/config';
import Typesense from 'typesense';
import { typesenseSchema } from '@/lib/typesense/typesenseSchema';

const APPLY = process.argv.includes('--apply');
const TYPESENSE_HOST = '9uyapwh6e5qmvl34p-1.a1.typesense.net';
const COLLECTION = 'properties';
const KEY = process.env.TYPESENSE_ADMIN_API_KEY || '';
const FIELDS = ['isDistressed', 'hasSecondarySuitePotential', 'calculatedDOM'] as const;
const CHUNK = 2000;

const ts = new Typesense.Client({
  nodes: [{ host: TYPESENSE_HOST, port: 443, protocol: 'https' }],
  apiKey: KEY,
  connectionTimeoutSeconds: 120,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = any;

async function missingFields(): Promise<string[]> {
  const coll: AnyObj = await ts.collections(COLLECTION).retrieve();
  const present = new Set((coll.fields || []).map((f: AnyObj) => f.name));
  return FIELDS.filter((f) => !present.has(f));
}

async function alterCollection(missing: string[]) {
  const defs = missing.map((name) => {
    const def = (typesenseSchema.fields as AnyObj[]).find((f) => f.name === name);
    if (!def) throw new Error(`${name} not found in typesenseSchema.fields — declare it there first.`);
    return def;
  });
  console.log(`Adding fields: ${defs.map((d) => JSON.stringify(d)).join('\n               ')}`);
  if (!APPLY) {
    console.log('   (dry-run — skipping alter)');
    return;
  }
  await ts.collections(COLLECTION).update({ fields: defs } as AnyObj);
  console.log('   ✅ Collection altered.');
}

/** Prove a field is filterable by counting on it (HTTP 400 = not indexed). */
async function countWhere(filterBy: string): Promise<number> {
  try {
    const r: AnyObj = await ts.collections(COLLECTION).documents().search({
      q: '*',
      query_by: 'City',
      filter_by: filterBy,
      per_page: 0,
    });
    return r.found ?? 0;
  } catch (e: AnyObj) {
    console.log(`   count(${filterBy}) failed: ${e?.message || e}`);
    return -1;
  }
}

async function reindexFromStored() {
  console.log('\nExisting docs not indexed by the alter — export → import(update) reindex...');
  const raw = (await ts
    .collections(COLLECTION)
    .documents()
    .export({ include_fields: `id,${FIELDS.join(',')}` })) as unknown as string;
  const lines = raw.split('\n').filter((l) => l.trim());
  console.log(`Exported ${lines.length.toLocaleString()} docs.`);

  const updates: string[] = [];
  for (const line of lines) {
    const doc = JSON.parse(line) as AnyObj;
    if (!doc.id) continue;
    const u: AnyObj = { id: doc.id };
    for (const f of FIELDS) if (doc[f] !== undefined) u[f] = doc[f];
    updates.push(JSON.stringify(u));
  }

  let done = 0;
  for (let i = 0; i < updates.length; i += CHUNK) {
    const batch = updates.slice(i, i + CHUNK).join('\n');
    await ts.collections(COLLECTION).documents().import(batch, { action: 'update' });
    done += Math.min(CHUNK, updates.length - i);
    console.log(`   …reindexed ${done.toLocaleString()}/${updates.length.toLocaleString()}`);
  }
  console.log('   ✅ Reindex complete.');
}

async function report(): Promise<boolean> {
  const [distressed, notDistressed, suite, dom] = await Promise.all([
    countWhere('isDistressed:=true'),
    countWhere('isDistressed:=false'),
    countWhere('hasSecondarySuitePotential:=true'),
    countWhere('calculatedDOM:>=0'),
  ]);
  console.log(`\nisDistressed true/false = ${distressed.toLocaleString()} / ${notDistressed.toLocaleString()}`);
  console.log(`hasSecondarySuitePotential true = ${suite.toLocaleString()}`);
  console.log(`calculatedDOM >= 0 = ${dom.toLocaleString()}`);
  // Filterability is what we're proving; -1 means HTTP 400 (not indexed).
  return distressed >= 0 && notDistressed >= 0 && suite >= 0 && dom >= 0 && (distressed + notDistressed) > 0;
}

async function main() {
  console.log(`\n🏷️  Add investor filter fields  [${APPLY ? 'APPLY' : 'DRY-RUN'}]`);
  console.log('='.repeat(56));
  if (!KEY) {
    console.error('❌ TYPESENSE_ADMIN_API_KEY not set');
    process.exit(1);
  }

  const missing = await missingFields();
  if (missing.length === 0) {
    console.log('✅ All fields already declared on the live collection.');
  } else {
    await alterCollection(missing);
  }

  if (!APPLY) {
    console.log('\nDry-run complete. Re-run with --apply to alter the live collection.');
    return;
  }

  let ok = await report();
  if (!ok) {
    await reindexFromStored();
    ok = await report();
  }
  if (ok) {
    console.log('\n✅ Investor filter fields are now filterable.');
  } else {
    console.error('\n❌ Fields still not filterable — investigate before relying on them.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('❌ Failed:', err?.message || err);
  process.exit(1);
});
```

- [ ] **Step 4: Typecheck + full suite + build — green.**

- [ ] **Step 5: Run the alter against the LIVE collection** (Typesense only — safe regardless of Supabase health):

```powershell
npx.cmd tsx scripts/admin/add-investor-filter-fields.ts            # dry-run: review output
npx.cmd tsx scripts/admin/add-investor-filter-fields.ts --apply    # alter + verify counts
```

Expected: alter succeeds, then non-negative counts for all three filters (the isDistressed true-count may be 0 — that's a data question, not a schema failure; filterability without HTTP 400 is the success criterion). Paste the output in your report. An alter on an ~83k-doc collection takes a moment — the 120s connection timeout in the script covers it.

- [ ] **Step 6: Commit**

```powershell
git add src/lib/typesense/typesenseSchema.ts scripts/worker/transformer.ts scripts/admin/add-investor-filter-fields.ts
git commit -m "fix(typesense): declare isDistressed/hasSecondarySuitePotential/calculatedDOM; drop dead targetGrossYield emit

The three fields were written to every doc but never declared, so the
filter_by/sort_by paths that reference them were HTTP 400 (audit HIGH-5).
Declared in the schema (source of truth) and applied to the live
collection via add-investor-filter-fields.ts (alter + verify, stored-value
reindex fallback — zero Supabase IO). targetGrossYield's last consumers
went in PR #13, so its emit is removed instead of declared.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Dead-code sweep — HIGH-10's legacy engine + PR #20 review leftovers

**Files:** Modify `src/lib/typesense/TemporalDistressEngine.ts` (+ its test), `src/lib/proptx/client.ts`, `src/lib/proptx/index.ts`, `src/lib/typesense/client.ts` · Delete `src/lib/propertyTypes.ts`, `src/lib/ampre/`

HIGH-10's `calculateTrueDOM` is `@deprecated` with zero callers (the campaign-history ledger replaced it in PR #17) — but as long as it exists it can be re-wired and its Date.now()-fallback bug shipped again. Same sweep removes the orphans PR #20's final review flagged, including the dead modules that still textually contain the CLAUDE.md-forbidden token-fallback pattern.

**Rule for every deletion: Grep for callers FIRST (src/ + scripts/, excluding the file itself, its test, and barrel re-exports). If a grep finds a live caller, DO NOT delete that item — report it instead.**

- [ ] **Step 1: `TemporalDistressEngine.ts`** — KEEP `generatePropertyHash` (sync.ts uses it) and `parseTimestamp` (trueDom.ts uses it) plus whatever types/helpers they need. DELETE: `calculateTrueDOM`, `generateLooseKey`, `unitsMatchForMerge`, `resolveHistoricalCandidates`, `generatePropertyHashBatch` (verify each at zero callers). Update `TemporalDistressEngine.test.ts`: delete the tests of removed functions, keep the `generatePropertyHash`/`parseTimestamp` tests.
- [ ] **Step 2: Delete `src/lib/propertyTypes.ts`** (its only callers were the routes PR #20 deleted; the similarly-named `src/lib/dashboard/propertyTypes.ts` — or wherever `dashboard/queries.ts` imports `./propertyTypes` from — is a DIFFERENT module and must be untouched).
- [ ] **Step 3: `src/lib/proptx/client.ts`** — delete `createVowClient` and `createClientFromEnv` (the latter contains the forbidden `PROPTX_*||PROPTX_*` fallback chains) + their re-exports in `src/lib/proptx/index.ts`. Root-level `test-vow-*.ts/js` throwaway scripts that called them: if they're untracked scratch, leave them (broken scratch is the owner's problem — note it); if tracked, delete them too.
- [ ] **Step 4: Delete `src/lib/ampre/` entirely** (orphaned module with unparameterized OData interpolations + its own env-fallback pattern; only self-references).
- [ ] **Step 5: `src/lib/typesense/client.ts` — `searchNearby`:** Grep for callers (its old consumer was the deleted `/api/nearby`). If zero: delete the function (this also removes the `calculatedDOM:asc` sort that predated Task 4's alter). If a caller exists, leave it — Task 4 made the sort legal anyway.
- [ ] **Step 6: Verify the forbidden patterns are gone:** Grep src/ for `PROPTX_IDX_TOKEN \|\| PROPTX_VOW_TOKEN` (and the reverse) → zero; Grep src/ for `eq '\$\{` → remaining hits must all be in `src/app/api/sync/route.ts` (regex-gated, by design) and `campaignHistory/fetch.ts` (odataEscape'd, by design) — report anything else.
- [ ] **Step 7: Typecheck + full suite + build — green.**
- [ ] **Step 8: Commit**

```powershell
git add -A src/lib/typesense/TemporalDistressEngine.ts src/lib/typesense/TemporalDistressEngine.test.ts src/lib/propertyTypes.ts src/lib/proptx src/lib/ampre src/lib/typesense/client.ts
git commit -m "chore: dead-code sweep — retire legacy calculateTrueDOM engine + post-PR-20 orphans

calculateTrueDOM (audit HIGH-10) was deprecated dead code whose
Date.now() fallback inflated true_dom; the campaign-history ledger
replaced it in PR #17. Also removes the orphaned propertyTypes,
createVowClient/createClientFromEnv, ampre client, and searchNearby —
which were the last textual carriers of the forbidden token-fallback
and unescaped-OData patterns.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Final verification + PR

- [ ] **Step 1:** `npm.cmd run typecheck` · `npm.cmd run lint` (0 errors) · `npx.cmd vitest run` · `npm.cmd run build` — all green; paste summaries.
- [ ] **Step 2: Live filter smoke (Typesense, post-Task-4 alter):** `Invoke-WebRequest "http://localhost:3000/api/properties/listings?MinDaysOnMarket=30&limit=5"` against `npm.cmd run dev` → must be 200 with results (this was HTTP 400 before the alter). Adjust port to what dev prints.
- [ ] **Step 3:** Push, open PR to main titled `fix: QA-audit ETL/formula highs (insurance double-count, True DOM stitching, quick-sync pipeline, Typesense schema drift) + dead-code sweep`. PR body: per-finding table; the live-alter already applied (Task 4 Step 5 output); and the follow-up ops item: **full reindex-from-vault so corrected cashflows/True DOM reach unchanged docs** (requires the reindex script fixes on `worktree-reindex` to land first, and a healthy Supabase instance). End with the standard Claude Code attribution.
