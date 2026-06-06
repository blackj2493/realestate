# Rent-Coverage Tiered Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lift real-rent coverage of for-sale listings from ~14–19% to ~55% by replacing the single rigid `(city_region, type, beds, WashroomsType1Pcs)` rent bucket with a **3-tier fallback** keyed on **real bath count** — neighbourhood+baths → city+baths → city — each estimate tagged with the tier it came from.

**Architecture:** The rent index (`rental_market_index`) gains a `match_tier` discriminator plus `city` and `bathrooms` columns. The aggregation job emits a lease's rent into all applicable tiers at once (a lease in "Willowdale East / Toronto / Condo / 2bd / 2ba" feeds the nbhd cohort, the city+bath cohort, AND the city cohort). The lookup (`rentAVM.ts`) walks the tiers most-specific-first and returns the first cohort with ≥5 comps, plus its tier as a confidence signal. Pure aggregation stays unit-tested (vitest, node-env); the I/O job + lookup are validated by a rebuild + coverage spot-check + re-sync.

**Why:** Measured 2026-06-05 against live prod (89,575 residential for-sale, real bath count): neighbourhood-level coverage is 13.7% but **city-level is 38.5% (baths) / 55.5% (baths relaxed)** at min-5, and **75.3% of listings have ≥1 lease comp somewhere in their city** — proving the gap is rigid matching + a broken city fallback, not missing data. `rentAVM.ts:44` currently fakes the city fallback with `cityRegion.split(' ')[0]` + `LIKE`, which never fires for Toronto communities ("Willowdale East" ≠ "Toronto…"). See memory `rent-model-source-sparse`.

**Tech Stack:** TypeScript, `pg` (direct Session-pooler), Supabase (`@supabase/supabase-js`), Vitest (node-env, logic only), `tsx`.

**Scope boundary:** Index + lookup + wiring only. Does NOT surface the tier/confidence label in the UI (that's Plan 2 — De-fake the terminal). The lease-guard from `financial-metrics-lease-contamination` stays intact. `min-5` is fixed across tiers (city pools are large); add a per-tier knob only if a later measurement asks for it.

---

## Deployment & sequencing caveat (READ FIRST)

`rental_market_index` is **shared prod data** read by the deployed (main-branch) worker. This plan repurposes its schema and TRUNCATE-rebuilds it. Between the rebuild (Task 6) and merging the new `rentAVM.ts` to main, the deployed worker's *old* lookup (washrooms-based) will find no rows → `cap_rate_est=0` on the nightly sync. **This is acceptable because `cap_rate_est` is not surfaced in the UI yet (Plan 2).** Do Task 6 (rebuild) and Task 7 (re-sync) last, and merge promptly after. The migration in Task 1 is purely additive, so it is safe to apply early.

---

## File Structure

- **Modify** `supabase/migrations/030_rental_index_tiers.sql` (create) — additive schema: `match_tier`, `city`, `bathrooms`; relax `city_region NOT NULL`; drop the old unique constraint; add per-tier lookup indexes.
- **Modify** `scripts/worker/services/rentModel.ts` — replace single-cohort accumulator with a 3-tier accumulator keyed on real bath count. Pure, no I/O.
- **Modify** `scripts/worker/services/rentModel.test.ts` — update existing cohort tests; add tier-emission tests.
- **Modify** `scripts/admin/refreshRentalMarketIndex.ts` — select `city` + `BathroomsTotalInteger`; feed the tiered accumulator; TRUNCATE + INSERT tiered rows.
- **Modify** `scripts/worker/services/rentAVM.ts` — tiered lookup (nbhd → city+bath → city); return the matched tier.
- **Modify** `scripts/worker/transformer.ts` — pass `city` + `bathroomsTotal` into `fetchRentAVM`.

---

## Task 0: Prerequisites

**Files:** none

- [ ] **Step 1: Confirm DB reachable** (the Supabase instance was IO-flaky 2026-06-05; pooler returned `{:error, :timeout}`).

Run: `node -e "require('dotenv').config({path:['.env.local','.env']});const{Client}=require('pg');(async()=>{const c=new Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:15000});await c.connect();console.log('OK',(await c.query('select count(*) from rental_market_index')).rows[0]);await c.end();})().catch(e=>{console.error(e.message);process.exit(1)})"`
Expected: `OK { count: ... }`. If it times out, wait for the instance to recover before proceeding (see memory `supabase-compute-sizing`).

- [ ] **Step 2: Confirm `DATABASE_URL` is the Session pooler** (`...pooler.supabase.com:5432`, not `db.<ref>.supabase.co`). See CLAUDE.md §12.

---

## Task 1: Migration 030 — tiered schema (additive)

**Files:**
- Create: `supabase/migrations/030_rental_index_tiers.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Migration 030: tiered rent index (neighbourhood+baths -> city+baths -> city)
-- Additive: existing rows remain valid until refreshRentalMarketIndex rebuilds.
ALTER TABLE rental_market_index ADD COLUMN IF NOT EXISTS match_tier TEXT;       -- 'nbhd' | 'city_bath' | 'city'
ALTER TABLE rental_market_index ADD COLUMN IF NOT EXISTS city TEXT;             -- municipality (listings.city)
ALTER TABLE rental_market_index ADD COLUMN IF NOT EXISTS bathrooms INTEGER;     -- BathroomsTotalInteger (real bath count)

-- City-level tiers have no neighbourhood; relax the NOT NULL.
ALTER TABLE rental_market_index ALTER COLUMN city_region DROP NOT NULL;

-- The old (city_region, sub_type, beds, washrooms_full) uniqueness no longer models the key.
-- Drop it (name auto-generated by migration 006's UNIQUE(...) → rental_market_index_city_region_..._key).
DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c FROM pg_constraint
   WHERE conrelid = 'rental_market_index'::regclass AND contype = 'u'
     AND pg_get_constraintdef(oid) LIKE '%washrooms_full%';
  IF c IS NOT NULL THEN EXECUTE format('ALTER TABLE rental_market_index DROP CONSTRAINT %I', c); END IF;
END $$;

-- Per-tier lookup indexes (partial). Table is small (≤ a few thousand rows), so these are instant.
CREATE INDEX IF NOT EXISTS idx_rmi_nbhd
  ON rental_market_index (city_region, property_sub_type, bedrooms_total, bathrooms)
  WHERE match_tier = 'nbhd';
CREATE INDEX IF NOT EXISTS idx_rmi_city_bath
  ON rental_market_index (city, property_sub_type, bedrooms_total, bathrooms)
  WHERE match_tier = 'city_bath';
CREATE INDEX IF NOT EXISTS idx_rmi_city
  ON rental_market_index (city, property_sub_type, bedrooms_total)
  WHERE match_tier = 'city';

-- Integrity: one row per (tier, dims). COALESCE so NULL city_region/bathrooms don't defeat uniqueness.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_rmi_tier
  ON rental_market_index (match_tier, COALESCE(city_region,''), COALESCE(city,''),
                          property_sub_type, bedrooms_total, COALESCE(bathrooms,-1));
```

- [ ] **Step 2: Apply it** (instant DDL — Supabase SQL editor is fine; or pooler script per CLAUDE.md §12).

Run (script path): `node -e "require('dotenv').config({path:['.env.local','.env']});const fs=require('fs');const{Client}=require('pg');(async()=>{const c=new Client({connectionString:process.env.DATABASE_URL});await c.connect();await c.query(fs.readFileSync('supabase/migrations/030_rental_index_tiers.sql','utf8'));console.log('applied 030');await c.end();})().catch(e=>{console.error(e.message);process.exit(1)})"`
Expected: `applied 030`.

- [ ] **Step 3: Verify columns + indexes exist**

Run: `node -e "require('dotenv').config({path:['.env.local','.env']});const{Client}=require('pg');(async()=>{const c=new Client({connectionString:process.env.DATABASE_URL});await c.connect();console.log((await c.query(\"select column_name from information_schema.columns where table_name='rental_market_index' and column_name in ('match_tier','city','bathrooms') order by 1\")).rows);console.log((await c.query(\"select indexname from pg_indexes where tablename='rental_market_index' and indexname like 'idx_rmi%'\")).rows);await c.end();})()"`
Expected: 3 columns (`bathrooms`, `city`, `match_tier`) and 3 `idx_rmi_*` indexes.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/030_rental_index_tiers.sql
git commit -m "feat(rent-model): migration 030 — tiered rent-index schema (match_tier/city/bathrooms)"
```

---

## Task 2: Tiered accumulator on real bath count (pure, TDD)

**Files:**
- Modify: `scripts/worker/services/rentModel.ts`
- Test: `scripts/worker/services/rentModel.test.ts`

- [ ] **Step 1: Replace the cohort-key tests with tier tests**

Open `scripts/worker/services/rentModel.test.ts`. (1) In the imports, change `import { cohortKeyOf, percentile } from './rentModel';` to `import { percentile } from './rentModel';` (`cohortKeyOf` is being removed). (2) DELETE the `describe('cohortKeyOf', …)` block. (3) Keep the `isLeaseRecord`, `extractMonthlyRent`, and `percentile` blocks unchanged. (4) REPLACE the `describe('buildRentalIndexRows', …)` block with:

```typescript
import { createRentAccumulator, buildRentalIndexRows, type RentalIndexRow } from './rentModel';

const lease = (rent: number, over: Partial<import('./rentModel').RawLeaseInput> = {}) => ({
  status: 'Leased', closePrice: rent,
  city: 'Toronto', cityRegion: 'Willowdale East', propertySubType: 'Condo Apartment',
  bedroomsTotal: 2, bathroomsTotal: 2, ...over,
});

describe('buildRentalIndexRows (tiered)', () => {
  it('emits all three tiers for a fully-specified cohort once it meets MIN_COHORT_SAMPLES', () => {
    const rows = buildRentalIndexRows([2000, 2100, 2200, 2300, 2400].map((r) => lease(r)));
    const byTier = Object.fromEntries(rows.map((r) => [r.match_tier, r]));
    expect(new Set(rows.map((r) => r.match_tier))).toEqual(new Set(['nbhd', 'city_bath', 'city']));

    expect(byTier.nbhd).toMatchObject({
      city_region: 'Willowdale East', city: 'Toronto', property_sub_type: 'Condo Apartment',
      bedrooms_total: 2, bathrooms: 2, avg_rent: 2200, p10_rent: 2040, sample_count: 5,
    });
    expect(byTier.city_bath).toMatchObject({ city_region: null, city: 'Toronto', bathrooms: 2 });
    expect(byTier.city).toMatchObject({ city_region: null, city: 'Toronto', bathrooms: null });
  });

  it('pools different bath counts into the city (baths-relaxed) tier', () => {
    // Three 1-bath + two 2-bath leases: neither bath-specific bucket clears min-5,
    // but the baths-relaxed city tier pools all five.
    const recs = [
      ...[2000, 2100, 2200].map((r) => lease(r, { bathroomsTotal: 1 })),
      ...[2600, 2800].map((r) => lease(r, { bathroomsTotal: 2 })),
    ];
    const rows = buildRentalIndexRows(recs);
    expect(rows.find((r) => r.match_tier === 'city_bath')).toBeUndefined(); // 3 and 2 < 5
    const city = rows.find((r) => r.match_tier === 'city') as RentalIndexRow;
    expect(city.sample_count).toBe(5);
    expect(city.bathrooms).toBeNull();
  });

  it('a lease missing bath count still feeds the city (baths-relaxed) tier only', () => {
    const rows = buildRentalIndexRows([2000, 2100, 2200, 2300, 2400].map((r) => lease(r, { bathroomsTotal: null })));
    expect(rows.map((r) => r.match_tier)).toEqual(['city']);
  });

  it('drops thin cohorts (< MIN_COHORT_SAMPLES) and ignores sale/out-of-band rows', () => {
    expect(buildRentalIndexRows([lease(2000), lease(2100)])).toHaveLength(0); // 2 < 5
    const mixed = [
      ...[2000, 2100, 2200, 2300, 2400].map((r) => lease(r)),
      { status: 'Sold', closePrice: 850000, city: 'Toronto', cityRegion: 'Willowdale East', propertySubType: 'Condo Apartment', bedroomsTotal: 2, bathroomsTotal: 2 },
      lease(50), // below floor
    ];
    expect((buildRentalIndexRows(mixed).find((r) => r.match_tier === 'nbhd') as RentalIndexRow).sample_count).toBe(5);
  });

  it('createRentAccumulator streams to the same result as buildRentalIndexRows', () => {
    const acc = createRentAccumulator();
    [2000, 2100, 2200, 2300, 2400].forEach((r) => acc.add(lease(r)));
    expect(acc.finalize()).toEqual(buildRentalIndexRows([2000, 2100, 2200, 2300, 2400].map((r) => lease(r))));
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run scripts/worker/services/rentModel.test.ts`
Expected: FAIL — `RawLeaseInput` has no `city`/`bathroomsTotal`; rows have no `match_tier`; `cohortKeyOf` import removed.

- [ ] **Step 3: Rewrite `rentModel.ts`** (replace the file body BELOW the unchanged `MIN_*` consts + `isLeaseRecord` + `extractMonthlyRent` + `percentile`). Replace `RawLeaseInput`, delete `cohortKeyOf`, replace `RentalIndexRow`/`createRentAccumulator`/`buildRentalIndexRows` with:

```typescript
export type MatchTier = 'nbhd' | 'city_bath' | 'city';

export interface RawLeaseInput {
  status?: string | null;
  transactionType?: string | null;
  closePrice?: number | null;
  listPrice?: number | null;
  city?: string | null;
  cityRegion?: string | null;
  propertySubType?: string | null;
  bedroomsTotal?: number | null;
  bathroomsTotal?: number | null; // real bath count (BathroomsTotalInteger)
}

export interface RentalIndexRow {
  match_tier: MatchTier;
  city_region: string | null;
  city: string | null;
  property_sub_type: string;
  bedrooms_total: number;
  bathrooms: number | null;
  avg_rent: number;   // median monthly rent
  p10_rent: number;   // 10th-percentile monthly rent
  sample_count: number;
}

type RowMeta = Omit<RentalIndexRow, 'avg_rent' | 'p10_rent' | 'sample_count'>;

export function createRentAccumulator() {
  const groups = new Map<string, { meta: RowMeta; rents: number[] }>();
  const bump = (key: string, meta: RowMeta, rent: number) => {
    let g = groups.get(key);
    if (!g) { g = { meta, rents: [] }; groups.set(key, g); }
    g.rents.push(rent);
  };
  return {
    add(r: RawLeaseInput): void {
      if (!isLeaseRecord(r)) return;
      const rent = extractMonthlyRent(r);
      if (rent == null) return;
      const cr = (r.cityRegion ?? '').trim();
      const city = (r.city ?? '').trim();
      const st = (r.propertySubType ?? '').trim();
      const beds = r.bedroomsTotal;
      const bath = r.bathroomsTotal;
      if (!st || beds == null) return;

      // Tier 1 — neighbourhood + baths (most precise)
      if (cr && bath != null) {
        bump(`nbhd|${cr.toLowerCase()}|${st.toLowerCase()}|${beds}|${bath}`,
          { match_tier: 'nbhd', city_region: cr, city: city || null, property_sub_type: st, bedrooms_total: beds, bathrooms: bath }, rent);
      }
      // Tier 2 — city + baths
      if (city && bath != null) {
        bump(`cb|${city.toLowerCase()}|${st.toLowerCase()}|${beds}|${bath}`,
          { match_tier: 'city_bath', city_region: null, city, property_sub_type: st, bedrooms_total: beds, bathrooms: bath }, rent);
      }
      // Tier 3 — city, baths relaxed (last resort)
      if (city) {
        bump(`c|${city.toLowerCase()}|${st.toLowerCase()}|${beds}`,
          { match_tier: 'city', city_region: null, city, property_sub_type: st, bedrooms_total: beds, bathrooms: null }, rent);
      }
    },
    finalize(): RentalIndexRow[] {
      const rows: RentalIndexRow[] = [];
      for (const g of groups.values()) {
        if (g.rents.length < MIN_COHORT_SAMPLES) continue;
        const sorted = [...g.rents].sort((a, b) => a - b);
        rows.push({ ...g.meta, avg_rent: Math.round(percentile(sorted, 0.5)), p10_rent: Math.round(percentile(sorted, 0.10)), sample_count: sorted.length });
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
Expected: PASS (all blocks).

- [ ] **Step 5: Typecheck + lint**

Run: `npx tsc --noEmit && npx eslint scripts/worker/services/rentModel.ts`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add scripts/worker/services/rentModel.ts scripts/worker/services/rentModel.test.ts
git commit -m "feat(rent-model): 3-tier cohort accumulator on real bath count"
```

---

## Task 3: Aggregation job — source city + bath, write tiered rows

**Files:**
- Modify: `scripts/admin/refreshRentalMarketIndex.ts`

- [ ] **Step 1: Update the source query and the accumulator feed.** Replace the SELECT + `for (const r of rows)` loop with:

```typescript
  const { rows } = await client.query(
    `SELECT list_price,
            city,
            city_region,
            property_sub_type,
            full_payload->>'TransactionType'        AS transaction_type,
            full_payload->>'BedroomsTotal'          AS bedrooms_total,
            full_payload->>'BathroomsTotalInteger'  AS bathrooms_total
       FROM listings
      WHERE lower(coalesce(full_payload->>'TransactionType', '')) ~ '(leas|rent)'`,
  );
  for (const r of rows) {
    acc.add({
      transactionType: r.transaction_type,
      closePrice: null,
      listPrice: r.list_price != null ? Number(r.list_price) : null,
      city: r.city,
      cityRegion: r.city_region,
      propertySubType: r.property_sub_type,
      bedroomsTotal: r.bedrooms_total != null ? parseInt(r.bedrooms_total, 10) : null,
      // Real bath count — replaces the bogus WashroomsType1Pcs piece-count key.
      bathroomsTotal: /^[0-9]+$/.test(r.bathrooms_total ?? '') ? parseInt(r.bathrooms_total, 10) : null,
    });
  }
```

- [ ] **Step 2: Replace the INSERT block** (TRUNCATE + insert tiered columns; drop the ON CONFLICT — TRUNCATE guarantees a clean slate and the builder emits unique keys):

```typescript
  await client.query('TRUNCATE rental_market_index');
  for (let i = 0; i < indexRows.length; i += WRITE_CHUNK) {
    const batch = indexRows.slice(i, i + WRITE_CHUNK);
    const params: (string | number | null)[] = [];
    const tuples = batch.map((row, j) => {
      const b = j * 9;
      params.push(row.match_tier, row.city_region, row.city, row.property_sub_type,
        row.bedrooms_total, row.bathrooms, row.avg_rent, row.p10_rent, row.sample_count);
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}, $${b + 9})`;
    });
    await client.query(
      `INSERT INTO rental_market_index
         (match_tier, city_region, city, property_sub_type, bedrooms_total, bathrooms, avg_rent, p10_rent, sample_count)
       VALUES ${tuples.join(',')}`,
      params,
    );
  }
  console.log(`Upserted ${indexRows.length} tiered cohorts into rental_market_index.`);
```

- [ ] **Step 3: Update the file header comment** (line 2-6) to say it builds 3 tiers (nbhd/city+bath/city) on real bath count.

- [ ] **Step 4: Typecheck + lint**

Run: `npx tsc --noEmit && npx eslint scripts/admin/refreshRentalMarketIndex.ts`
Expected: no errors.

- [ ] **Step 5: Dry-run** (no writes — confirms tier mix + credible rents)

Run: `npx tsx scripts/admin/refreshRentalMarketIndex.ts --dry-run`
Expected: `Read ~38000 active for-lease listings -> NNNN cohorts`; `Sample:` rows showing a mix of `match_tier` values and credible rents (Toronto condo ≈ $2,200–2,800). If 0 cohorts, STOP — the lease filter or bath parsing is wrong.

- [ ] **Step 6: Commit**

```bash
git add scripts/admin/refreshRentalMarketIndex.ts
git commit -m "feat(rent-model): build tiered rent index from active leases (city + real baths)"
```

---

## Task 4: Tiered lookup in rentAVM

**Files:**
- Modify: `scripts/worker/services/rentAVM.ts`

- [ ] **Step 1: Replace `RentAVMResult` + `fetchRentAVM`** with the tiered walk:

```typescript
export interface RentAVMResult {
  annual_rent: number;
  annual_rent_p10: number;
  has_data: boolean;
  match_tier: 'nbhd' | 'city_bath' | 'city' | null; // confidence signal (Plan 2 surfaces it)
}

export async function fetchRentAVM(params: {
  city: string;
  cityRegion: string;
  propertySubType: string;
  bedroomsTotal: number;
  bathroomsTotal?: number;
  isSuiteCandidate: boolean;
}): Promise<RentAVMResult> {
  const { city, cityRegion, propertySubType, bedroomsTotal, bathroomsTotal = 0, isSuiteCandidate } = params;
  const sel = () => supabase.from('rental_market_index').select('avg_rent, p10_rent');

  let row: { avg_rent: number; p10_rent: number } | null = null;
  let tier: RentAVMResult['match_tier'] = null;

  // Tier 1 — neighbourhood + baths
  {
    const { data } = await sel()
      .eq('match_tier', 'nbhd').eq('city_region', cityRegion)
      .eq('property_sub_type', propertySubType).eq('bedrooms_total', bedroomsTotal)
      .eq('bathrooms', bathroomsTotal).maybeSingle();
    if (data) { row = data; tier = 'nbhd'; }
  }
  // Tier 2 — city + baths
  if (!row && city) {
    const { data } = await sel()
      .eq('match_tier', 'city_bath').eq('city', city)
      .eq('property_sub_type', propertySubType).eq('bedrooms_total', bedroomsTotal)
      .eq('bathrooms', bathroomsTotal).maybeSingle();
    if (data) { row = data; tier = 'city_bath'; }
  }
  // Tier 3 — city, baths relaxed
  if (!row && city) {
    const { data } = await sel()
      .eq('match_tier', 'city').eq('city', city)
      .eq('property_sub_type', propertySubType).eq('bedrooms_total', bedroomsTotal)
      .maybeSingle();
    if (data) { row = data; tier = 'city'; }
  }

  if (!row) return { annual_rent: 0, annual_rent_p10: 0, has_data: false, match_tier: null };

  let annualRent = (row.avg_rent || 0) * 12;
  let annualRentP10 = (row.p10_rent || 0) * 12;
  if (isSuiteCandidate) { annualRent *= 1.6; annualRentP10 *= 1.6; } // secondary-suite uplift (unchanged)

  return { annual_rent: annualRent, annual_rent_p10: annualRentP10, has_data: true, match_tier: tier };
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit && npx eslint scripts/worker/services/rentAVM.ts`
Expected: no errors. (NOTE: `transformer.ts` still calls the old signature — Task 5 fixes it; tsc will flag that call until then, which is expected. Run tsc again after Task 5.)

- [ ] **Step 3: Commit**

```bash
git add scripts/worker/services/rentAVM.ts
git commit -m "feat(rent-model): tiered rentAVM lookup (nbhd -> city+baths -> city)"
```

---

## Task 5: Wire the transformer (pass city + real baths)

**Files:**
- Modify: `scripts/worker/transformer.ts` (the `fetchRentAVM({...})` call, ~line 827)

- [ ] **Step 1: Replace the `fetchRentAVM` arguments:**

```typescript
    rentAVM = await fetchRentAVM({
      city: raw.City || '',
      cityRegion: raw.CityRegion || raw.City || '',
      propertySubType: raw.PropertySubType || '',
      bedroomsTotal: raw.BedroomsTotal || 0,
      bathroomsTotal: raw.BathroomsTotalInteger || 0,
      isSuiteCandidate,
    });
```

(`rentAVM` is initialized as `{ annual_rent: 0, annual_rent_p10: 0, has_data: false }`; add `match_tier: null` to that initializer at ~line 825 so the type matches `RentAVMResult`.)

- [ ] **Step 2: Full typecheck + lint + tests**

Run: `npx tsc --noEmit && npx eslint scripts/worker/transformer.ts && npm run test`
Expected: tsc 0 errors, lint no NEW errors (pre-existing `any` warnings in transformer.ts are unrelated), full suite green.

- [ ] **Step 3: Commit**

```bash
git add scripts/worker/transformer.ts
git commit -m "feat(rent-model): pass city + real bath count into tiered rentAVM"
```

---

## Task 6: Rebuild the index + verify coverage

**Files:** none (DB write + read). See the Deployment caveat at top.

- [ ] **Step 1: Populate**

Run: `npx tsx scripts/admin/refreshRentalMarketIndex.ts --apply`
Expected: `Upserted NNNN tiered cohorts into rental_market_index.`

- [ ] **Step 2: Verify tier mix + a spot lookup**

Run: `node -e "require('dotenv').config({path:['.env.local','.env']});const{Client}=require('pg');(async()=>{const c=new Client({connectionString:process.env.DATABASE_URL});await c.connect();console.log((await c.query('select match_tier,count(*),min(sample_count) from rental_market_index group by 1 order by 1')).rows);console.log((await c.query(\"select city,property_sub_type,bedrooms_total,bathrooms,avg_rent,sample_count from rental_market_index where match_tier='city_bath' and city='Toronto' order by sample_count desc limit 5\")).rows);await c.end();})()"`
Expected: three tiers present, each `min(sample_count) >= 5`; Toronto city_bath rows with credible `avg_rent` (~$2k–4k).

- [ ] **Step 3: Spot-check the tiered walk resolves** for a representative Toronto condo (verifies the `city` join works — the casing risk). This simulates what `rentAVM` does for one listing:

```bash
node -e "require('dotenv').config({path:['.env.local','.env']});const{Client}=require('pg');(async()=>{const c=new Client({connectionString:process.env.DATABASE_URL});await c.connect();const q=async(t,extra,vals)=>(await c.query('select avg_rent,sample_count from rental_market_index where match_tier=\$1 and property_sub_type=\$2 and bedrooms_total=\$3 '+extra,[t,'Condo Apartment',2,...vals])).rows[0];console.log('nbhd   :',await q('nbhd','and city_region=\$4 and bathrooms=\$5',['Willowdale East',2]));console.log('citybath:',await q('city_bath','and city=\$4 and bathrooms=\$5',['Toronto',2]));console.log('city   :',await q('city','and city=\$4',['Toronto']));await c.end();})()"
```

Expected: at least the `city`-tier row resolves with a credible `avg_rent` and `sample_count >= 5`. (Full for-sale coverage is validated end-to-end in Task 7 Step 3 via the Typesense `cap_rate_est:>0` count — expected to roughly triple vs the prior 326.)

---

## Task 7: Re-sync + verify real metrics still flow (lease guard intact)

**Files:** none (re-sync + verify). Requires Typesense healthy.

- [ ] **Step 1: Confirm Typesense healthy**

Run: `node -e "fetch('https://9uyapwh6e5qmvl34p-1.a1.typesense.net/health').then(r=>r.status).then(s=>console.log('health',s))"`
Expected: `health 200`.

- [ ] **Step 2: Re-run a delta sync**

Run: `npx tsx scripts/worker/ingester.ts sync`
Expected: `status:completed`, `records_synced > 0`.

- [ ] **Step 3: Confirm cap rates rose and lease contamination stayed zero**

```bash
node -e "const base='https://9uyapwh6e5qmvl34p-1.a1.typesense.net';const key=process.env.NEXT_PUBLIC_TYPESENSE_SEARCH_ONLY_API_KEY||'BzXkIss7SXH0U1Hb0a1COwdvEACxbhkj';const c=async f=>(await fetch(base+'/collections/properties/documents/search?q=*&query_by=City&filter_by='+encodeURIComponent(f)+'&per_page=0',{headers:{'x-typesense-api-key':key}}).then(r=>r.json())).found;(async()=>{console.log('cap_rate_est:>0 (For-Sale, should rise vs 326):',await c('cap_rate_est:>0'));console.log('cap_rate_est:>0 && !=For Sale (must be 0):',await c('cap_rate_est:>0 && TransactionType:!=\`For Sale\`'));})()"
```

Expected: `cap_rate_est:>0` materially **higher than the prior 326** (tiered coverage lifts for-sale hits); `cap_rate_est:>0 && !=For Sale` stays **0** (the `financial-metrics-lease-contamination` guard still holds).

- [ ] **Step 4: Update memory + final commit**

Update memory `rent-model-source-sparse` (coverage lever shipped) and mark the plan executed.

```bash
git add docs/superpowers/plans/2026-06-05-rent-coverage-tiered-fallback.md
git commit -m "docs(rent-model): mark tiered-fallback plan executed"
```

---

## Self-Review notes (for the executor)

- **Tiers nest:** a lease feeds all tiers it qualifies for, so the `city` tier is the aggregate of its neighbourhoods. Coverage of the combined walk ≈ the `city`-tier number (~55% at min-5).
- **`bathrooms = 0` means "unknown":** a for-sale listing with no `BathroomsTotalInteger` passes `bathroomsTotal: 0`, which won't match tier 1/2 (no bath=0 cohorts) and correctly falls to tier 3.
- **Casing:** lookups use exact `.eq` on `city`/`city_region`/`property_sub_type`. Producer and consumer both read the same `listings` columns, so casing agrees — do NOT lowercase one side only.
- **Suite uplift unchanged:** the ×1.6 secondary-suite multiplier still applies after tier selection.
- **min-5 fixed:** city pools are large, so 5 is easily met with low noise. Only revisit if a later measurement shows a coverage cliff.
- **Lease guard untouched:** `financialMetrics.ts` still zeroes cap/yield/cashflow for lease listings — Task 7 Step 3 re-verifies it.
```
