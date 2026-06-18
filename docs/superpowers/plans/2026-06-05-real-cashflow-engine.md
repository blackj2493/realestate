# Real Cashflow Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Populate `rental_market_index` from real lease comps so the *already-wired* `financialMetrics.ts` produces a true `cap_rate_est` / `gross_yield_est` / `net_monthly_cashflow`, replacing the fabricated flat-$5,500-rent `ExtrapolatedCapRate`.

**Architecture:** A new admin aggregation job streams leased records out of `raw_vow_sold` (which mixes sold + leased rows; leases carry monthly rent in `close_price`/`list_price`), classifies lease-vs-sale, computes median + p10 monthly rent per `(city_region, property_sub_type, bedrooms_total, washrooms_full)` cohort, and upserts into `rental_market_index` (migration 006). The existing path `transformer.ts` → `fetchRentAVM()` → `calculateFinancialMetrics()` → Typesense payload then yields real numbers on the next delta sync — **zero new engine code.** Pure aggregation helpers are unit-tested (vitest, node-env); the DB job mirrors the pooler-connected, `statement_timeout=0`, keyset-batched pattern of `scripts/admin/backfill020.ts`.

**Tech Stack:** TypeScript, `pg` (direct Session-pooler), Supabase, Vitest (node-env, no jsdom — logic tests only), `tsx`.

**Scope boundary:** This plan ONLY populates the rent index and proves real metrics flow to Typesense. It does NOT touch the frontend surfaces that still read `ExtrapolatedCapRate` (that's Plan 2 — *De-fake the terminal*). After this plan, both fields coexist; Plan 2 cuts the UI over.

**This is Plan 1 of 4** (see the decomposition map in `docs/strategy/2026-06-04-beat-housesigma.md` discussion). Plans 2-4: De-fake the terminal, Stabilize & observe, Compliance toggle.

---

## File Structure

- **Create** `scripts/worker/services/rentModel.ts` — pure aggregation helpers (lease classification, rent extraction, cohort keying, percentile, accumulator). One responsibility: turn raw lease records into rental-index rows. No I/O.
- **Create** `scripts/worker/services/rentModel.test.ts` — vitest unit tests for the above.
- **Create** `scripts/admin/refreshRentalMarketIndex.ts` — the I/O job: pooler connect → keyset-stream `raw_vow_sold` → feed the accumulator → batch-upsert `rental_market_index`. Mirrors `backfill020.ts`.
- **Verify (no change)** `supabase/migrations/006_create_rental_market_index.sql`, `007_*`, `008_*` — apply if unapplied.
- **Verify (no change)** `scripts/worker/services/rentAVM.ts`, `scripts/worker/transformer.ts` — confirm the lookup + wiring already consume `rental_market_index`.

---

## Task 0: Prerequisites (ops — not TDD)

**Files:** none (environment + DB)

- [ ] **Step 1: Confirm Typesense is healthy** (a prior outage 502'd the search backend). 

Run: `curl -s -o /dev/null -w "%{http_code}" "https://9uyapwh6e5qmvl34p-1.a1.typesense.net/health" -H "x-typesense-api-key: $TYPESENSE_ADMIN_API_KEY"`
Expected: `200`. If not, fix in the Typesense Cloud dashboard before the re-sync in Task 7.

- [ ] **Step 2: Confirm `DATABASE_URL` is the Session-pooler string** (port 5432, IPv4-reachable; the direct host is IPv6-only and fails here — see CLAUDE.md §12).

Run: `node -e "console.log((process.env.DATABASE_URL||'').replace(/:[^:@]+@/,':***@'))"`
Expected: a `...pooler.supabase.com:5432/...` URL (NOT `db.<ref>.supabase.co`).

- [ ] **Step 3: Apply migrations 006, 007, 008 if not already present.** These are simple `CREATE TABLE` DDL — safe to paste into the Supabase SQL editor (instant DDL, no gateway-timeout risk).

Verify after applying:
```bash
psql "$DATABASE_URL" -c "select to_regclass('public.rental_market_index'), to_regclass('public.city_region_avg_price'), to_regclass('public.municipal_mill_rates');"
```
Expected: all three non-null. Then confirm the seed data loaded for the two static tables:
```bash
psql "$DATABASE_URL" -c "select count(*) from city_region_avg_price; select count(*) from municipal_mill_rates;"
```
Expected: ~21 rows each (pre-seeded Ontario metros). `rental_market_index` is expected EMPTY — this plan fills it.

---

## Task 1: Lease classification + rent extraction (pure)

**Files:**
- Create: `scripts/worker/services/rentModel.ts`
- Test: `scripts/worker/services/rentModel.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// scripts/worker/services/rentModel.test.ts
import { describe, it, expect } from 'vitest';
import { isLeaseRecord, extractMonthlyRent, MIN_MONTHLY_RENT, MAX_MONTHLY_RENT } from './rentModel';

describe('isLeaseRecord', () => {
  it('flags status="Leased" (any case/space) as a lease', () => {
    expect(isLeaseRecord({ status: 'Leased' })).toBe(true);
    expect(isLeaseRecord({ status: '  leased ' })).toBe(true);
    expect(isLeaseRecord({ status: 'Lease' })).toBe(true);
  });
  it('flags transactionType containing lease/rent as a lease', () => {
    expect(isLeaseRecord({ transactionType: 'For Lease' })).toBe(true);
    expect(isLeaseRecord({ transactionType: 'For Rent' })).toBe(true);
  });
  it('treats sold/closed as NOT a lease', () => {
    expect(isLeaseRecord({ status: 'Sold' })).toBe(false);
    expect(isLeaseRecord({ status: 'Closed', transactionType: 'For Sale' })).toBe(false);
    expect(isLeaseRecord({})).toBe(false);
  });
});

describe('extractMonthlyRent', () => {
  it('prefers closePrice, falls back to listPrice', () => {
    expect(extractMonthlyRent({ closePrice: 2800, listPrice: 2900 })).toBe(2800);
    expect(extractMonthlyRent({ closePrice: 0, listPrice: 2900 })).toBe(2900);
  });
  it('rejects out-of-band values (sale prices, junk)', () => {
    expect(extractMonthlyRent({ closePrice: 850000 })).toBeNull(); // a sale leaked in
    expect(extractMonthlyRent({ closePrice: 50 })).toBeNull();      // too low
    expect(extractMonthlyRent({ closePrice: null, listPrice: null })).toBeNull();
  });
  it('honors the band constants', () => {
    expect(extractMonthlyRent({ closePrice: MIN_MONTHLY_RENT })).toBe(MIN_MONTHLY_RENT);
    expect(extractMonthlyRent({ closePrice: MAX_MONTHLY_RENT })).toBe(MAX_MONTHLY_RENT);
    expect(extractMonthlyRent({ closePrice: MAX_MONTHLY_RENT + 1 })).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run scripts/worker/services/rentModel.test.ts`
Expected: FAIL — "Cannot find module './rentModel'".

- [ ] **Step 3: Write the minimal implementation**

```typescript
// scripts/worker/services/rentModel.ts
/**
 * Rent-model aggregation helpers (pure, no I/O).
 * Source: leased rows in raw_vow_sold (sold + leased are mixed; a lease carries
 * its monthly rent in close_price/list_price, NOT a sale price). We compute
 * median + p10 monthly rent per cohort for rental_market_index (migration 006).
 */

export const MIN_MONTHLY_RENT = 500;
export const MAX_MONTHLY_RENT = 25000;
export const MIN_COHORT_SAMPLES = 5; // suppress thin cohorts (noise + min-N hygiene)

export interface RawLeaseInput {
  status?: string | null;
  transactionType?: string | null;
  closePrice?: number | null;
  listPrice?: number | null;
  cityRegion?: string | null;
  propertySubType?: string | null;
  bedroomsTotal?: number | null;
  washroomsFull?: number | null;
}

const LEASE_STATUS = new Set(['leased', 'lease', 'for lease', 'rented', 'rental']);

export function isLeaseRecord(r: RawLeaseInput): boolean {
  const s = (r.status ?? '').trim().toLowerCase();
  const t = (r.transactionType ?? '').trim().toLowerCase();
  if (LEASE_STATUS.has(s)) return true;
  return t.includes('lease') || t.includes('rent');
}

export function extractMonthlyRent(r: RawLeaseInput): number | null {
  const raw = r.closePrice && r.closePrice > 0 ? r.closePrice : (r.listPrice ?? 0);
  if (!raw || raw < MIN_MONTHLY_RENT || raw > MAX_MONTHLY_RENT) return null;
  return Math.round(raw);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run scripts/worker/services/rentModel.test.ts`
Expected: PASS (all in the two describe blocks).

- [ ] **Step 5: Commit**

```bash
git add scripts/worker/services/rentModel.ts scripts/worker/services/rentModel.test.ts
git commit -m "feat(rent-model): lease classification + monthly-rent extraction"
```

---

## Task 2: Cohort key + percentile (pure)

**Files:**
- Modify: `scripts/worker/services/rentModel.ts`
- Test: `scripts/worker/services/rentModel.test.ts`

- [ ] **Step 1: Add the failing tests**

```typescript
// append to rentModel.test.ts
import { cohortKeyOf, percentile } from './rentModel';

describe('cohortKeyOf', () => {
  it('builds a normalized key from region/subtype/beds/washrooms', () => {
    expect(cohortKeyOf({ cityRegion: 'Brampton East', propertySubType: 'Detached', bedroomsTotal: 3, washroomsFull: 2 }))
      .toBe('brampton east|detached|3|2');
  });
  it('defaults washrooms to 0', () => {
    expect(cohortKeyOf({ cityRegion: 'Ajax', propertySubType: 'Condo Apt', bedroomsTotal: 1 }))
      .toBe('ajax|condo apt|1|0');
  });
  it('returns null when region/subtype/beds missing', () => {
    expect(cohortKeyOf({ propertySubType: 'Detached', bedroomsTotal: 3 })).toBeNull();
    expect(cohortKeyOf({ cityRegion: 'Ajax', bedroomsTotal: 3 })).toBeNull();
    expect(cohortKeyOf({ cityRegion: 'Ajax', propertySubType: 'Detached' })).toBeNull();
  });
});

describe('percentile', () => {
  it('interpolates on a sorted ascending array', () => {
    expect(percentile([10, 20, 30, 40, 50], 0.5)).toBe(30);
    expect(percentile([10, 20, 30, 40, 50], 0.10)).toBeCloseTo(14, 5);
  });
  it('handles single/empty', () => {
    expect(percentile([42], 0.5)).toBe(42);
    expect(percentile([], 0.5)).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run scripts/worker/services/rentModel.test.ts`
Expected: FAIL — `cohortKeyOf`/`percentile` not exported.

- [ ] **Step 3: Implement (append to `rentModel.ts`)**

```typescript
export function cohortKeyOf(r: RawLeaseInput): string | null {
  const cr = (r.cityRegion ?? '').trim();
  const st = (r.propertySubType ?? '').trim();
  const bd = r.bedroomsTotal;
  if (!cr || !st || bd == null) return null;
  const wr = r.washroomsFull ?? 0;
  return [cr.toLowerCase(), st.toLowerCase(), bd, wr].join('|');
}

/** Linear-interpolated percentile over an ASCENDING-sorted array. p in [0,1]. */
export function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const idx = (sortedAsc.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (idx - lo);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run scripts/worker/services/rentModel.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/worker/services/rentModel.ts scripts/worker/services/rentModel.test.ts
git commit -m "feat(rent-model): cohort keying + interpolated percentile"
```

---

## Task 3: Streaming accumulator → rental-index rows (pure)

**Files:**
- Modify: `scripts/worker/services/rentModel.ts`
- Test: `scripts/worker/services/rentModel.test.ts`

- [ ] **Step 1: Add the failing tests**

```typescript
// append to rentModel.test.ts
import { createRentAccumulator, buildRentalIndexRows, type RentalIndexRow } from './rentModel';

const lease = (rent: number, over: Partial<import('./rentModel').RawLeaseInput> = {}) => ({
  status: 'Leased', closePrice: rent, cityRegion: 'Ajax', propertySubType: 'Condo Apt',
  bedroomsTotal: 1, washroomsFull: 1, ...over,
});

describe('buildRentalIndexRows', () => {
  it('aggregates a cohort once it meets MIN_COHORT_SAMPLES', () => {
    const recs = [2000, 2100, 2200, 2300, 2400].map((r) => lease(r));
    const rows = buildRentalIndexRows(recs);
    expect(rows).toHaveLength(1);
    const row = rows[0] as RentalIndexRow;
    expect(row.city_region).toBe('Ajax');
    expect(row.property_sub_type).toBe('Condo Apt');
    expect(row.bedrooms_total).toBe(1);
    expect(row.washrooms_full).toBe(1);
    expect(row.sample_count).toBe(5);
    expect(row.avg_rent).toBe(2200);   // median
    expect(row.p10_rent).toBe(2040);   // 10th pct, interpolated + rounded
  });
  it('drops thin cohorts (< MIN_COHORT_SAMPLES)', () => {
    expect(buildRentalIndexRows([lease(2000), lease(2100)])).toHaveLength(0);
  });
  it('ignores sale rows and out-of-band rents', () => {
    const recs = [
      ...[2000, 2100, 2200, 2300, 2400].map((r) => lease(r)),
      { status: 'Sold', closePrice: 850000, cityRegion: 'Ajax', propertySubType: 'Condo Apt', bedroomsTotal: 1, washroomsFull: 1 },
      lease(50), // below floor → dropped
    ];
    const rows = buildRentalIndexRows(recs);
    expect(rows[0].sample_count).toBe(5); // sale + junk excluded
  });
  it('createRentAccumulator streams to the same result', () => {
    const acc = createRentAccumulator();
    [2000, 2100, 2200, 2300, 2400].forEach((r) => acc.add(lease(r)));
    expect(acc.finalize()).toEqual(buildRentalIndexRows([2000, 2100, 2200, 2300, 2400].map((r) => lease(r))));
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run scripts/worker/services/rentModel.test.ts`
Expected: FAIL — `createRentAccumulator`/`buildRentalIndexRows` not exported.

- [ ] **Step 3: Implement (append to `rentModel.ts`)**

```typescript
export interface RentalIndexRow {
  city_region: string;
  property_sub_type: string;
  bedrooms_total: number;
  washrooms_full: number;
  avg_rent: number;   // median monthly rent
  p10_rent: number;   // 10th-percentile monthly rent
  sample_count: number;
}

export function createRentAccumulator() {
  const groups = new Map<string, { meta: RawLeaseInput; rents: number[] }>();
  return {
    add(r: RawLeaseInput): void {
      if (!isLeaseRecord(r)) return;
      const rent = extractMonthlyRent(r);
      if (rent == null) return;
      const key = cohortKeyOf(r);
      if (!key) return;
      let g = groups.get(key);
      if (!g) { g = { meta: r, rents: [] }; groups.set(key, g); }
      g.rents.push(rent);
    },
    finalize(): RentalIndexRow[] {
      const rows: RentalIndexRow[] = [];
      for (const g of groups.values()) {
        if (g.rents.length < MIN_COHORT_SAMPLES) continue;
        const sorted = [...g.rents].sort((a, b) => a - b);
        rows.push({
          city_region: (g.meta.cityRegion ?? '').trim(),
          property_sub_type: (g.meta.propertySubType ?? '').trim(),
          bedrooms_total: g.meta.bedroomsTotal as number,
          washrooms_full: g.meta.washroomsFull ?? 0,
          avg_rent: Math.round(percentile(sorted, 0.5)),
          p10_rent: Math.round(percentile(sorted, 0.10)),
          sample_count: sorted.length,
        });
      }
      return rows;
    },
  };
}

export function buildRentalIndexRows(records: RawLeaseInput[]): RentalIndexRow[] {
  const acc = createRentAccumulator();
  for (const r of records) acc.add(r);
  return acc.finalize();
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run scripts/worker/services/rentModel.test.ts`
Expected: PASS (all describe blocks).

- [ ] **Step 5: Typecheck + lint the new module**

Run: `npx tsc --noEmit && npx eslint scripts/worker/services/rentModel.ts`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add scripts/worker/services/rentModel.ts scripts/worker/services/rentModel.test.ts
git commit -m "feat(rent-model): streaming cohort accumulator -> rental-index rows"
```

---

## Task 4: The aggregation job (I/O — mirrors backfill020.ts)

**Files:**
- Create: `scripts/admin/refreshRentalMarketIndex.ts`

> No unit test (it's an I/O orchestrator over a live DB). It is validated by a `--dry-run` (Task 5) and the row-count + spot-check (Task 6). It reuses the Task 1-3 pure helpers, which ARE tested.

- [ ] **Step 1: Write the job**

```typescript
// scripts/admin/refreshRentalMarketIndex.ts
/**
 * Populate rental_market_index from leased rows in raw_vow_sold.
 * Mirrors scripts/admin/backfill020.ts: direct pg Session-pooler client,
 * statement_timeout=0, keyset pagination by id, batched upserts.
 *
 * Usage:
 *   npx tsx scripts/admin/refreshRentalMarketIndex.ts --dry-run   (no writes; prints cohort stats)
 *   npx tsx scripts/admin/refreshRentalMarketIndex.ts --apply     (truncates + repopulates)
 */
import 'dotenv/config';
import { Client } from 'pg';
import { createRentAccumulator, type RentalIndexRow } from '../worker/services/rentModel';

const READ_CHUNK = 2000;
const WRITE_CHUNK = 500;
const APPLY = process.argv.includes('--apply');
const DRY = process.argv.includes('--dry-run') || !APPLY;

async function main() {
  const url = process.env.DATABASE_URL || process.env.DIRECT_DB_URL;
  if (!url) throw new Error('DATABASE_URL (Session pooler) is required — see CLAUDE.md §12.');
  const client = new Client({ connectionString: url });
  await client.connect();
  await client.query("SET statement_timeout TO '0'");

  const acc = createRentAccumulator();
  let lastId = '00000000-0000-0000-0000-000000000000';
  let scanned = 0;

  for (;;) {
    const { rows } = await client.query(
      `SELECT id,
              city_region,
              close_price,
              list_price,
              full_payload->>'Status'           AS status,
              full_payload->>'MlsStatus'         AS mls_status,
              full_payload->>'StandardStatus'    AS standard_status,
              full_payload->>'TransactionType'   AS transaction_type,
              full_payload->>'PropertySubType'   AS property_sub_type,
              full_payload->>'BedroomsTotal'     AS bedrooms_total,
              full_payload->>'WashroomsType1Pcs' AS washrooms_full
         FROM raw_vow_sold
        WHERE id > $1
        ORDER BY id
        LIMIT $2`,
      [lastId, READ_CHUNK],
    );
    if (rows.length === 0) break;
    for (const r of rows) {
      acc.add({
        status: r.status || r.mls_status || r.standard_status,
        transactionType: r.transaction_type,
        closePrice: r.close_price != null ? Number(r.close_price) : null,
        listPrice: r.list_price != null ? Number(r.list_price) : null,
        cityRegion: r.city_region,
        propertySubType: r.property_sub_type,
        bedroomsTotal: r.bedrooms_total != null ? parseInt(r.bedrooms_total, 10) : null,
        washroomsFull: r.washrooms_full != null ? parseInt(r.washrooms_full, 10) : 0,
      });
    }
    scanned += rows.length;
    lastId = rows[rows.length - 1].id;
    if (scanned % 50000 === 0) console.log(`   …scanned ${scanned} rows`);
  }

  const indexRows: RentalIndexRow[] = acc.finalize();
  console.log(`Scanned ${scanned} raw rows → ${indexRows.length} qualifying cohorts (min-N met).`);
  console.log('Sample:', indexRows.slice(0, 5));

  if (DRY) {
    console.log('DRY RUN — no writes. Re-run with --apply to populate rental_market_index.');
    await client.end();
    return;
  }

  await client.query('TRUNCATE rental_market_index');
  for (let i = 0; i < indexRows.length; i += WRITE_CHUNK) {
    const batch = indexRows.slice(i, i + WRITE_CHUNK);
    const params: (string | number)[] = [];
    const tuples = batch.map((row, j) => {
      const b = j * 6;
      params.push(row.city_region, row.property_sub_type, row.bedrooms_total, row.washrooms_full, row.avg_rent, row.p10_rent);
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, ${row.sample_count})`;
    });
    await client.query(
      `INSERT INTO rental_market_index
         (city_region, property_sub_type, bedrooms_total, washrooms_full, avg_rent, p10_rent, sample_count)
       VALUES ${tuples.join(',')}
       ON CONFLICT (city_region, property_sub_type, bedrooms_total, washrooms_full)
       DO UPDATE SET avg_rent = EXCLUDED.avg_rent, p10_rent = EXCLUDED.p10_rent,
                     sample_count = EXCLUDED.sample_count, updated_at = NOW()`,
      params,
    );
  }
  console.log(`Upserted ${indexRows.length} cohorts into rental_market_index.`);
  await client.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit && npx eslint scripts/admin/refreshRentalMarketIndex.ts`
Expected: no errors. (If `eslint src` is scoped to `src/`, run `npx eslint scripts/admin/refreshRentalMarketIndex.ts` explicitly.)

- [ ] **Step 3: Commit**

```bash
git add scripts/admin/refreshRentalMarketIndex.ts
git commit -m "feat(rent-model): rental_market_index aggregation job (raw_vow_sold leases)"
```

---

## Task 5: Dry-run validation

**Files:** none (runs the job read-only)

- [ ] **Step 1: Dry-run the job**

Run: `npx tsx scripts/admin/refreshRentalMarketIndex.ts --dry-run`
Expected: prints `Scanned <N> raw rows → <M> qualifying cohorts`, with `M` in the hundreds-to-thousands and a `Sample:` array of plausible rents (e.g. Toronto 1-bed Condo Apt avg_rent ≈ 2200-2800). If `M === 0`, STOP — the lease-status strings in this data don't match `LEASE_STATUS`; print a distinct-status probe and widen the set:
```bash
psql "$DATABASE_URL" -c "select distinct full_payload->>'Status' s, count(*) from raw_vow_sold group by 1 order by 2 desc limit 30;"
```
Add any genuine lease status (e.g. `'lsd'`) to `LEASE_STATUS` in `rentModel.ts`, extend the Task 1 test, re-run.

- [ ] **Step 2: Sanity-check the sample against known market rents.** If medians look like sale prices (6-7 figures) the band/extraction is wrong — revisit `extractMonthlyRent`. Do not proceed to `--apply` until the dry-run sample is credible.

---

## Task 6: Apply + verify the index

**Files:** none (DB write + read)

- [ ] **Step 1: Populate the table**

Run: `npx tsx scripts/admin/refreshRentalMarketIndex.ts --apply`
Expected: `Upserted <M> cohorts into rental_market_index.`

- [ ] **Step 2: Verify row count + a spot cohort**

```bash
psql "$DATABASE_URL" -c "select count(*) from rental_market_index;"
psql "$DATABASE_URL" -c "select city_region, property_sub_type, bedrooms_total, washrooms_full, avg_rent, p10_rent, sample_count from rental_market_index where city_region ilike 'toronto%' order by sample_count desc limit 5;"
```
Expected: count = `M` from Task 6 Step 1; Toronto cohorts with `avg_rent` in a credible band (~$2k-$5k) and `sample_count >= 5`.

---

## Task 7: Prove real metrics flow end-to-end

**Files:** none (re-sync + verify)

- [ ] **Step 1: Re-run a delta sync** so the transformer recomputes metrics with the now-populated rent index.

Run: `npx tsx scripts/worker/ingester.ts sync`
Expected: completes without error; `records_synced > 0`. (Requires Typesense healthy — Task 0 Step 1.)

- [ ] **Step 2: Confirm `cap_rate_est` / `gross_yield_est` are now populated (non-zero) in Typesense.**

Run:
```bash
curl -s "https://9uyapwh6e5qmvl34p-1.a1.typesense.net/collections/properties/documents/search?q=*&filter_by=cap_rate_est:>0&per_page=0" \
  -H "x-typesense-api-key: $TYPESENSE_ADMIN_API_KEY" | python -c "import sys,json;print('found:', json.load(sys.stdin)['found'])"
```
Expected: `found:` in the tens-of-thousands (was **0** before this plan — verified by the council). Repeat with `filter_by=gross_yield_est:>0`.

- [ ] **Step 3: Final commit (docs note)**

```bash
git add docs/superpowers/plans/2026-06-05-real-cashflow-engine.md
git commit -m "docs(rent-model): mark real-cashflow-engine plan executed"
```

---

## Self-Review notes (for the executor)

- **Coexistence is intentional:** after this plan, `ExtrapolatedCapRate` (fake) and `cap_rate_est`/`gross_yield_est` (real) both exist in the index. The UI still shows the fake one until **Plan 2 (De-fake the terminal)** repoints `personaConfig.ts`, `LedgerRow.tsx`, `mapMetrics.ts`, `dashboard/queries.ts`, `compareMetricsConfig.ts`, etc. and flips the default persona. Do NOT skip Plan 2 — this plan alone does not change what users see.
- **Casing/prefix caveat:** `rentAVM.ts` looks up `rental_market_index` with an exact `.eq('city_region', …)` then a city-level fallback. Some `city_region` values carry numeric MLS prefixes (e.g. `"1001 - BR Bronte"`) — see memory `avm-matrix-city-region-prefix`. If coverage is low after Task 7, normalization belongs in a follow-up, not here.
- **Lease detection is data-driven:** Task 5 Step 1 is the gate — if the status strings don't match, the whole index is empty. Always dry-run first.
- **VOW provenance:** `cap_rate_est`/`gross_yield_est` are VOW-derived → gated-use only (compliance §6.2(f)); they may power gated terminal surfaces but not public/anon ones. (Relevant to Plan 2, not this plan.)
