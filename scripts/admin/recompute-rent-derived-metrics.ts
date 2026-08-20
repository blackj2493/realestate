/**
 * Recompute the rent-derived metrics (cap_rate_est / gross_yield_est /
 * net_monthly_cashflow) for the ACTIVE for-sale inventory.
 *
 * WHY THIS EXISTS
 * ───────────────
 * These three are written by the ETL (transformer.ts → fetchRentAVM →
 * calculateFinancialMetrics) at index time. The scheduled sync only re-transforms the
 * `ModificationTimestamp gt cursor` DELTA (Query A, ingester.ts), so a listing that is
 * stable in the feed keeps whatever value it was indexed with. Three changes landed
 * together that move the answer for a large slice of the index, and without this job
 * only freshly-touched listings would get them:
 *
 *   1. rentAVM now btrims the lookup key. The feed ships "Semi-Detached " with a
 *      trailing space and rentModel btrims before it keys a cohort, so the exact .eq
 *      could never match — 4,775 active semis were handed no rent data at all.
 *   2. financialMetrics no longer fabricates a NEGATIVE cap rate when no comp exists.
 *      With 0 revenue, NOI collapsed to -opex and the "cap rate" was an expense ratio.
 *      It sat on 41,767 of 124,924 active for-sale listings; only 653 were real.
 *   3. MIN_COHORT_SAMPLES dropped 5 -> 3, which publishes ~10k more cohorts.
 *
 * ORDER OF OPERATIONS: refreshRentalMarketIndex.ts must run FIRST, so the new floor is
 * actually in the table this job reads through.
 *
 * WHY IT RE-RUNS THE REAL CODE PATH
 * It reads `listings.full_payload` (the raw feed record the transformer saw) and calls
 * the SAME four functions the transformer calls — calculateMultiUnitPotential,
 * fetchRentAVM, resolveRatioPrice/fetchMillRate, calculateFinancialMetrics. Nothing is
 * reimplemented here, so this job cannot drift from the ETL.
 *
 * SAFETY
 *  • Idempotent — only listings whose recomputed value disagrees with the stored one are
 *    written, so a second run writes nothing.
 *  • Reversible — every value is DERIVED. Revert the code, re-run, and the old numbers
 *    come back exactly.
 *  • Postgres and Typesense are patched from the SAME recomputed records, so the pair
 *    cannot split. Typesense uses a partial `action=update` touching only these fields.
 *  • Dry-run by default. Nothing is written without --apply.
 *  • Cheap path first: a listing with no rent comp resolves to 0 without any
 *    ratio-price / mill-rate lookup, which is most of the scan.
 *
 * Usage:
 *   npx tsx scripts/admin/recompute-rent-derived-metrics.ts                # dry-run
 *   npx tsx scripts/admin/recompute-rent-derived-metrics.ts --apply
 *   npx tsx scripts/admin/recompute-rent-derived-metrics.ts --limit=2000   # bound the scan
 *   npx tsx scripts/admin/recompute-rent-derived-metrics.ts --all          # rescan positives too
 * Env: DATABASE_URL (Session pooler — CLAUDE.md §12), SUPABASE_* for the AVM lookups,
 *      TYPESENSE_ADMIN_API_KEY for the partial update.
 */

import 'dotenv/config';
import { Client } from 'pg';
import { fetchRentAVM } from '../worker/services/rentAVM';
import { resolveRatioPrice, fetchMillRate } from '../worker/services/ratioPriceCalculator';
import { calculateFinancialMetrics } from '../worker/services/financialMetrics';
import { calculateMultiUnitPotential } from '../worker/services/multiUnitCalculator';

const TYPESENSE_HOST = '9uyapwh6e5qmvl34p-1.a1.typesense.net';
const COLLECTION = 'properties';
const TS_CHUNK = 500;
const PG_CHUNK = 500;
const READ_PAGE = 2_000;
const CONCURRENCY = 8;

// Same active/for-sale definition the terminal uses (priceFloorClause + closed statuses).
const CLOSED_STATUSES = [
  'sold', 'sold conditional', 'sold conditional escape',
  'terminated', 'deleted', 'expired', 'deal fell through',
];

interface Row {
  listing_key: string;
  cap_rate_est: string | number | null;
  full_payload: Record<string, unknown>;
}

interface Drift {
  key: string;
  address: string;
  from: number | null;
  to: number;
  yieldTo: number;
  cashflowTo: number;
  hadComp: boolean;
}

function apiKey(): string {
  const key = process.env.TYPESENSE_ADMIN_API_KEY;
  if (!key) {
    console.error('❌ TYPESENSE_ADMIN_API_KEY is not set — the partial update requires it.');
    process.exit(1);
  }
  return key;
}

/** Retry every Supabase call: supabase-js REJECTS on a dropped fetch instead of
 *  returning { error }, so a transient socket drop arrives as a thrown exception. */
async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 250 * (i + 1)));
    }
  }
  throw last;
}

const millRateCache = new Map<string, Awaited<ReturnType<typeof fetchMillRate>>>();
async function millRateFor(cityRegion: string) {
  const hit = millRateCache.get(cityRegion);
  if (hit) return hit;
  const v = await withRetry(() => fetchMillRate(cityRegion));
  millRateCache.set(cityRegion, v);
  return v;
}

/** Rebuilds the exact input the transformer hands calculateFinancialMetrics. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function recompute(raw: any) {
  const multiUnit = calculateMultiUnitPotential(raw);
  const isSuiteCandidate = ['EXISTING_MULTI_UNIT', 'PRIME_CANDIDATE', 'MARGINAL_CANDIDATE']
    .includes(multiUnit.multi_unit_status);

  const rentAVM = await withRetry(() => fetchRentAVM({
    city: raw.City || '',
    cityRegion: raw.CityRegion || raw.City || '',
    propertySubType: raw.PropertySubType || '',
    bedroomsTotal: raw.BedroomsTotal || 0,
    bedroomsAboveGrade: raw.BedroomsAboveGrade,
    bedroomsBelowGrade: raw.BedroomsBelowGrade,
    bathroomsTotal: raw.BathroomsTotalInteger || 0,
    isSuiteCandidate,
  }));

  // No comp ⇒ every rent-derived metric is the 0 sentinel regardless of the cost side,
  // so skip the two lookups entirely. That is most of the scan.
  let ratioPrice = { calculation_price: raw.ListPrice || 0, is_price_discovery: false };
  let millRate = { base_mill_rate: 0.0095, city: raw.City || '' };
  if (rentAVM.has_data) {
    const region = raw.CityRegion || raw.City || '';
    [ratioPrice, millRate] = await Promise.all([
      withRetry(() => resolveRatioPrice({
        listPrice: raw.ListPrice || 0,
        propertySubType: raw.PropertySubType || '',
        cityRegion: region,
      })),
      millRateFor(region),
    ]);
  }

  const metrics = calculateFinancialMetrics({
    annual_rent: rentAVM.annual_rent,
    annual_rent_p10: rentAVM.annual_rent_p10,
    has_rent_data: rentAVM.has_data,
    calculation_price: ratioPrice.calculation_price,
    is_price_discovery: ratioPrice.is_price_discovery,
    propertySubType: raw.PropertySubType || '',
    listPrice: raw.ListPrice || 0,
    transactionType: raw.TransactionType,
    taxAnnualAmount: raw.TaxAnnualAmount ?? null,
    associationFee: raw.AssociationFee ?? null,
    maintenanceExpense: raw.MaintenanceExpense ?? null,
    insuranceExpense: raw.InsuranceExpense ?? null,
    baseMillRate: millRate.base_mill_rate,
    multiUnitStatus: multiUnit.multi_unit_status,
    isCondo: !!(raw.PropertyType?.includes('Condo') || raw.CondoCorpNumber),
  });
  return { metrics, hadComp: rentAVM.has_data };
}

/** Run `worker` over `items` with a bounded number in flight. */
async function mapPool<T, R>(items: T[], n: number, worker: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await worker(items[i]);
      }
    })
  );
  return out;
}

async function pushTypesense(rows: Drift[]): Promise<{ updated: number; failed: number }> {
  const body = rows
    .map((r) => JSON.stringify({
      id: r.key,
      cap_rate_est: r.to,
      gross_yield_est: r.yieldTo,
      net_monthly_cashflow: r.cashflowTo,
    }))
    .join('\n');
  const res = await fetch(
    `https://${TYPESENSE_HOST}/collections/${COLLECTION}/documents/import?action=update`,
    { method: 'POST', headers: { 'X-TYPESENSE-API-KEY': apiKey(), 'Content-Type': 'text/plain' }, body }
  );
  const text = await res.text();
  let updated = 0;
  let failed = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      if (JSON.parse(line).success) updated++;
      else failed++;
    } catch {
      failed++;
    }
  }
  return { updated, failed };
}

async function main() {
  const apply = process.argv.includes('--apply');
  const all = process.argv.includes('--all');
  const limitArg = process.argv.find((a) => a.startsWith('--limit='));
  const sampleArg = process.argv.find((a) => a.startsWith('--samples='));
  const limit = limitArg ? Number(limitArg.split('=')[1]) : null;
  const sampleCount = sampleArg ? Number(sampleArg.split('=')[1]) : 10;
  if (apply) apiKey(); // fail before the scan, not after it

  console.log('\n💰 Recompute rent-derived metrics (cap rate / gross yield / cashflow)');
  console.log(
    `  ${apply ? 'APPLY' : 'DRY-RUN'}${limit ? ` · limit ${limit}` : ''}` +
    `${all ? ' · scanning ALL actives' : ' · scanning non-positive only'}\n`
  );

  const url = process.env.DATABASE_URL || process.env.DIRECT_DB_URL;
  if (!url) throw new Error('DATABASE_URL (Session pooler) is required — see CLAUDE.md §12.');
  const client = new Client({ connectionString: url });
  await client.connect();
  await client.query("SET statement_timeout TO '0'");

  // Default scan is the population that can only improve: a stored value that is
  // negative (fabricated), zero (no comp at index time) or null (never computed).
  // --all re-checks the positives too, which the cohort-floor change can also move.
  const candidateFilter = all ? '' : 'AND (cap_rate_est IS NULL OR cap_rate_est <= 0)';
  const scopeSql =
    `FROM listings WHERE list_price >= 100000 ` +
    `AND coalesce(standard_status,'') <> ALL($1::text[]) ${candidateFilter}`;

  const { rows: countRows } = await client.query(`SELECT count(*)::int AS n ${scopeSql}`, [CLOSED_STATUSES]);
  const total = limit ? Math.min(limit, countRows[0].n) : countRows[0].n;
  console.log(`📋 ${total.toLocaleString()} listing(s) in scope\n`);

  let scanned = 0;
  let gainedComp = 0;
  let clearedNegative = 0;
  const drifted: Drift[] = [];

  for (let offset = 0; offset < total; offset += READ_PAGE) {
    const { rows } = await client.query<Row>(
      `SELECT listing_key, cap_rate_est, full_payload ${scopeSql} ORDER BY listing_key LIMIT $2 OFFSET $3`,
      [CLOSED_STATUSES, Math.min(READ_PAGE, total - offset), offset]
    );
    if (rows.length === 0) break;

    const results = await mapPool(rows, CONCURRENCY, async (r) => {
      try {
        return { r, ...(await recompute(r.full_payload)) };
      } catch (e) {
        console.warn(`   ⚠️  ${r.listing_key}: ${(e as Error)?.message ?? e}`);
        return null;
      }
    });

    for (const res of results) {
      if (!res) continue;
      scanned++;
      const { r, metrics, hadComp } = res;
      const stored = r.cap_rate_est == null ? null : Number(r.cap_rate_est);
      if (hadComp) gainedComp++;
      if (stored != null && stored < 0 && metrics.cap_rate_est >= 0) clearedNegative++;
      // Postgres stores NULL where the Typesense payload writes the 0 sentinel (the
      // transformer uses `|| null`), so compare on the sentinel-normalised value.
      if (Math.abs((stored ?? 0) - metrics.cap_rate_est) < 0.005) continue;
      drifted.push({
        key: r.listing_key,
        address: String((r.full_payload as { UnparsedAddress?: string }).UnparsedAddress ?? '(no address)'),
        from: stored,
        to: metrics.cap_rate_est,
        yieldTo: metrics.gross_yield_est,
        cashflowTo: metrics.net_monthly_cashflow,
        hadComp,
      });
    }
    console.log(
      `   … scanned ${scanned.toLocaleString()}/${total.toLocaleString()}  (drift ${drifted.length.toLocaleString()})`
    );
  }

  const pct = (n: number) => (scanned ? `${((n / scanned) * 100).toFixed(2)}%` : '-');
  console.log(`\n📊 Scanned ${scanned.toLocaleString()} listing(s)`);
  console.log(`   now resolve to a rent comp:  ${gainedComp.toLocaleString()} (${pct(gainedComp)})`);
  console.log(`   fabricated negative cleared: ${clearedNegative.toLocaleString()} (${pct(clearedNegative)})`);
  console.log(`   values to write:             ${drifted.length.toLocaleString()}`);

  if (drifted.length) {
    console.log(`\n   Sample (first ${Math.min(sampleCount, drifted.length)}):`);
    for (const d of drifted.slice(0, sampleCount)) {
      const from = d.from == null ? 'null' : d.from.toFixed(2);
      console.log(
        `      ${d.key.padEnd(12)} ${d.address.slice(0, 44).padEnd(44)} ` +
        `${from.padStart(8)}% → ${d.to.toFixed(2).padStart(6)}%   ${d.hadComp ? 'comp' : 'no comp'}`
      );
    }
  }

  if (!apply) {
    console.log(`\nDRY-RUN — re-run with --apply to write ${drifted.length.toLocaleString()} listing(s).`);
    await client.end();
    return;
  }
  if (drifted.length === 0) {
    console.log('\n✅ Already converged — nothing to write.');
    await client.end();
    return;
  }

  // Postgres first: it is what region_active_aggregates reads. Typesense follows from
  // the same in-memory records, so the two cannot disagree about a listing.
  console.log(`\n📥 Postgres: updating listings.cap_rate_est on ${drifted.length.toLocaleString()} row(s)…`);
  let pgUpdated = 0;
  for (let i = 0; i < drifted.length; i += PG_CHUNK) {
    const chunk = drifted.slice(i, i + PG_CHUNK);
    const res = await client.query(
      `UPDATE listings AS l SET cap_rate_est = v.cap
         FROM (SELECT unnest($1::text[]) AS key, unnest($2::numeric[]) AS cap) AS v
        WHERE l.listing_key = v.key`,
      // The transformer writes `metrics3.cap_rate_est || null`, so 0 must land as NULL
      // here too, or this column would disagree with a freshly-transformed row.
      [chunk.map((d) => d.key), chunk.map((d) => (d.to === 0 ? null : d.to))]
    );
    pgUpdated += res.rowCount ?? 0;
    console.log(`   … ${Math.min(i + PG_CHUNK, drifted.length)}/${drifted.length}`);
  }
  console.log(`✅ Postgres: ${pgUpdated.toLocaleString()} row(s) updated.`);
  await client.end();

  console.log(`\n📤 Typesense: patching ${drifted.length.toLocaleString()} document(s)…`);
  let updated = 0;
  let failed = 0;
  for (let i = 0; i < drifted.length; i += TS_CHUNK) {
    const r = await pushTypesense(drifted.slice(i, i + TS_CHUNK));
    updated += r.updated;
    failed += r.failed;
    console.log(`   … ${Math.min(i + TS_CHUNK, drifted.length)}/${drifted.length} (updated ${updated}, failed ${failed})`);
  }
  console.log(`\n✅ Typesense: ${updated.toLocaleString()} updated, ${failed.toLocaleString()} failed.`);
}

main().catch((err) => {
  console.error('❌ Fatal:', err);
  process.exit(1);
});
