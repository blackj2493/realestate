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
 *   npx tsx scripts/admin/recompute-rent-derived-metrics.ts --all --resync-index
 *        # also repatch rows the Postgres-drift test skips. Use when the index has
 *        # diverged from Postgres — a Postgres-only comparison cannot see that.
 *   npx tsx scripts/admin/recompute-rent-derived-metrics.ts --all --apply --force
 *        # start even though a sync looks active. Only when you KNOW it has finished:
 *        # an overlap does not error, it just leaves rows stale. See src/lib/etl/
 *        # syncGuard.ts for the incident that made this a guard rather than a habit.
 * Env: DATABASE_URL (Session pooler — CLAUDE.md §12), SUPABASE_* for the AVM lookups,
 *      TYPESENSE_ADMIN_API_KEY for the partial update.
 */

import 'dotenv/config';
import { Client } from 'pg';
import { fetchRentAVM, fetchSuiteRent, fetchMainUnitRent, type SuiteRentResult } from '../worker/services/rentAVM';
import { resolveRatioPrice, fetchMillRate } from '../worker/services/ratioPriceCalculator';
import { calculateFinancialMetrics } from '../worker/services/financialMetrics';
import { hasObservedSuite } from '@/lib/listings/observedSuite';
import {
  concurrentWriterReasons,
  SYNC_STATUS_FRESH_HOURS,
  LIVE_WRITE_WINDOW_MIN,
} from '@/lib/etl/syncGuard';

const TYPESENSE_HOST = '9uyapwh6e5qmvl34p-1.a1.typesense.net';
const COLLECTION = 'properties';
const TS_CHUNK = 500;
const PG_CHUNK = 500;
const READ_PAGE = 2_000;
const CONCURRENCY = 8;

// Same active/for-sale definition the terminal uses (priceFloorClause + closed statuses).
/**
 * Statuses this job skips. It MUST be a subset of what region_active_aggregates
 * excludes, or a listing can be shut out of the repair while still feeding the metric.
 *
 * It was not. The aggregate (migration 121) excludes
 *   sold, closed, closed sale, leased, terminated, expired, suspended
 * while this list also held `sold conditional`, `sold conditional escape`,
 * `deal fell through` and `deleted` — none of which the aggregate excludes. Measured
 * 2026-08-21, right after the 125 recompute: 407 rows in the display band, median cap
 * 3.20-3.86% against a corrected book median of 2.20%, all still carrying the retired
 * 1.6x multiplier and all counted in their region's median. 0.46% of the 89,263 rows
 * the aggregate reads — small, but stale by construction and permanently so, since
 * nothing else would ever recompute them.
 *
 * A conditional sale is not a closed one. It can fall through and return to market,
 * which is exactly why the aggregate counts it.
 */
const CLOSED_STATUSES = [
  'sold', 'closed', 'closed sale', 'leased', 'terminated', 'expired', 'suspended',
];

interface Row {
  listing_key: string;
  cap_rate_est: string | number | null;
  rent_match_tier: string | null;
  suite_rent_est: string | number | null;
  full_payload: Record<string, unknown>;
}

interface Drift {
  key: string;
  address: string;
  from: number | null;
  to: number;
  yieldTo: number;
  cashflowTo: number;
  tierTo: string;
  /** What kind of comp stands behind the rent, and how many. Patched alongside the
   *  rung for the same reason the rung is patched alongside the cap rate: a repaired
   *  number beside a stale provenance line is still a number nobody can weigh. */
  basisTo: string;
  sampleTo: number;
  /** Measured suite rent (125), monthly. 0 = no observed suite, or no cohort. */
  suiteTo: number;
  suiteTierTo: string;
  suiteBasisTo: string;
  suiteSampleTo: number;
  /** One tenant, the entire house — the strategy the sandbox could not price. */
  wholeHomeTo: number;
  wholeHomeTierTo: string;
  wholeHomeBasisTo: string;
  wholeHomeSampleTo: number;
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
  const rentAVM = await withRetry(() => fetchRentAVM({
    city: raw.City || '',
    cityRegion: raw.CityRegion || raw.City || '',
    propertySubType: raw.PropertySubType || '',
    bedroomsTotal: raw.BedroomsTotal || 0,
    bedroomsAboveGrade: raw.BedroomsAboveGrade,
    bedroomsBelowGrade: raw.BedroomsBelowGrade,
    bathroomsTotal: raw.BathroomsTotalInteger || 0,
    county: raw.CountyOrParish,
  }));

  // Suite rent (125), only where the feed OBSERVES a suite — never from a score. Same
  // gate the transformer applies, so a recomputed listing and a freshly-synced one
  // cannot disagree.
  // Typed from the service rather than structurally, so a field added to SuiteRentResult
  // (basis / sample_count) reaches this job instead of being silently dropped by a
  // narrower local shape — which is how the index and a recompute drift apart.
  let suiteRent: SuiteRentResult = {
    monthly_rent: 0, monthly_rent_p10: 0, has_data: false, match_tier: null,
    basis: null, sample_count: null,
  };
  let rent = rentAVM;
  if (rentAVM.has_data && hasObservedSuite(raw)) {
    const [suite, mainUnit] = await Promise.all([
      withRetry(() => fetchSuiteRent({
        city: raw.City || '',
        cityRegion: raw.CityRegion || raw.City || '',
        bedroomsBelowGrade: raw.BedroomsBelowGrade,
      })),
      withRetry(() => fetchMainUnitRent({
        city: raw.City || '',
        cityRegion: raw.CityRegion || raw.City || '',
        propertySubType: raw.PropertySubType || '',
        bedroomsTotal: raw.BedroomsTotal || 0,
        bedroomsAboveGrade: raw.BedroomsAboveGrade,
        bedroomsBelowGrade: raw.BedroomsBelowGrade,
        bathroomsTotal: raw.BathroomsTotalInteger || 0,
        county: raw.CountyOrParish,
        wholeHome: rentAVM,
      })),
    ]);
    // Same all-or-nothing rule as the transformer: suite income only on the main-unit
    // basis, never added to a whole-home comp that already contains the basement.
    if (suite.has_data && mainUnit.has_data) {
      suiteRent = suite;
      rent = mainUnit;
    }
  }

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
    annual_rent: rent.annual_rent,
    annual_rent_p10: rent.annual_rent_p10,
    has_rent_data: rent.has_data,
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
    isCondo: !!(raw.PropertyType?.includes('Condo') || raw.CondoCorpNumber),
    suite_monthly_rent: suiteRent.has_data ? suiteRent.monthly_rent : 0,
    suite_monthly_rent_p10: suiteRent.has_data ? suiteRent.monthly_rent_p10 : 0,
  });
  return {
    metrics,
    hadComp: rent.has_data,
    // `rent` is the MAIN UNIT wherever a suite was observed; `rentAVM` is untouched and
    // still holds the whole-home lease. Both are published — the sandbox needs one per
    // strategy, and reading either as the other is the bug this repairs.
    wholeHomeRent: rentAVM.has_data ? Math.round(rentAVM.annual_rent / 12) : 0,
    wholeHomeTier: rentAVM.has_data ? (rentAVM.match_tier ?? '') : '',
    wholeHomeBasis: rentAVM.has_data ? (rentAVM.basis ?? '') : '',
    wholeHomeSample: rentAVM.has_data ? (rentAVM.sample_count ?? 0) : 0,
    tier: rent.has_data ? (rent.match_tier ?? '') : '',
    basis: rent.has_data ? (rent.basis ?? '') : '',
    sample: rent.has_data ? (rent.sample_count ?? 0) : 0,
    suiteRent: suiteRent.has_data ? suiteRent.monthly_rent : 0,
    suiteTier: suiteRent.has_data ? (suiteRent.match_tier ?? '') : '',
    suiteBasis: suiteRent.has_data ? (suiteRent.basis ?? '') : '',
    suiteSample: suiteRent.has_data ? (suiteRent.sample_count ?? 0) : 0,
  };
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

/**
 * Patch one chunk, classifying the outcome three ways.
 *
 * ABSENT is not a failure. This job's scope comes from Postgres `listings`, and that
 * table holds rows the live index does not: measured on the first 40 candidates, 16
 * were absent from Typesense — de-listed or closed stock whose `standard_status` in
 * Postgres has drifted from what the index actually serves. Typesense answers those
 * with a 404 "Could not find a document with id". Counting them as failures buries a
 * REAL failure in noise, which is how a half-applied patch gets read as a finished
 * one. The Postgres write still happens for those rows: listings.cap_rate_est feeds
 * region_active_aggregates, and clearing a fabricated negative there is right whether
 * or not the row is currently indexed.
 */
async function pushTypesense(
  rows: Drift[]
): Promise<{ updated: number; absent: number; failed: number; errors: string[] }> {
  const body = rows
    .map((r) => JSON.stringify({
      id: r.key,
      cap_rate_est: r.to,
      gross_yield_est: r.yieldTo,
      net_monthly_cashflow: r.cashflowTo,
      // Patched in the SAME document as the numbers it qualifies. Splitting them would
      // leave a repaired cap rate sitting next to a stale confidence signal.
      rent_match_tier: r.tierTo,
      rent_basis: r.basisTo,
      rent_sample_count: r.sampleTo,
      suite_rent_est: r.suiteTo,
      suite_rent_tier: r.suiteTierTo,
      suite_rent_basis: r.suiteBasisTo,
      suite_rent_sample_count: r.suiteSampleTo,
      whole_home_monthly_rent: r.wholeHomeTo,
      whole_home_rent_tier: r.wholeHomeTierTo,
      whole_home_rent_basis: r.wholeHomeBasisTo,
      whole_home_rent_sample_count: r.wholeHomeSampleTo,
    }))
    .join('\n');
  const res = await fetch(
    `https://${TYPESENSE_HOST}/collections/${COLLECTION}/documents/import?action=update`,
    { method: 'POST', headers: { 'X-TYPESENSE-API-KEY': apiKey(), 'Content-Type': 'text/plain' }, body }
  );
  const text = await res.text();
  let updated = 0;
  let absent = 0;
  const errors: string[] = [];
  // Typesense returns one result line per submitted document, in order, so the index
  // maps straight back to the row that produced it.
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const who = rows[i]?.key ?? '?';
    try {
      const r = JSON.parse(line) as { success?: boolean; error?: string };
      if (r.success) updated++;
      else if (/could not find a document/i.test(r.error ?? '')) absent++;
      else errors.push(`${who}: ${r.error ?? line.slice(0, 120)}`);
    } catch {
      errors.push(`${who}: unparseable response — ${line.slice(0, 120)}`);
    }
  }
  return { updated, absent, failed: errors.length, errors };
}


// ── Concurrency guard ────────────────────────────────────────────────────────────
// The decision lives in src/lib/etl/syncGuard.ts, where it is pure and tested. This
// only gathers the two signals it needs. See that file for the 2026-08-21 incident
// that motivated it.
async function assertNoConcurrentWriter(client: Client, force: boolean): Promise<void> {
  const { rows: running } = await client.query<{ id: string; mins: string }>(
    `SELECT id, round(EXTRACT(EPOCH FROM (now() - updated_at)) / 60)::text AS mins
       FROM sync_state
      WHERE status = 'running'
        AND updated_at > now() - ($1 || ' hours')::interval
      ORDER BY updated_at DESC`,
    [String(SYNC_STATUS_FRESH_HOURS)]
  );
  const { rows: writes } = await client.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM listings
      WHERE updated_at > now() - ($1 || ' minutes')::interval`,
    [String(LIVE_WRITE_WINDOW_MIN)]
  );
  const liveWrites = Number(writes[0]?.n ?? 0);
  const reasons = concurrentWriterReasons({
    running: running.map((r) => ({ id: r.id, minutesAgo: Number(r.mins) })),
    liveWrites,
  });

  if (reasons.length === 0) {
    console.log(
      `🔒 No concurrent writer (sync_state idle · ${liveWrites} row(s) written in the last ${LIVE_WRITE_WINDOW_MIN}m)\n`
    );
    return;
  }
  console.error('\n🚫 A sync appears to be running. Refusing to start.');
  for (const r of reasons) console.error(`   • ${r}`);
  console.error(
    '\n   Both jobs write the same rows, and whichever finishes last wins per row.\n' +
    '   The overlap does not error — it just leaves some listings stale.\n' +
    '   Wait for the sync to finish, then re-run. Use --force to override deliberately.'
  );
  if (!force) process.exit(2);
  console.error('   --force given; continuing anyway.\n');
}

/**
 * Re-read what we just wrote. The pre-flight check can only see a writer that has
 * already started, so this is the net that catches one which began mid-run — and it
 * needs no guess about who or why, only whether the values still hold.
 */
async function verifyWrites(client: Client, wrote: Drift[]): Promise<number> {
  if (wrote.length === 0) return 0;
  const { rows } = await client.query<{ listing_key: string; cap_rate_est: string | null }>(
    `SELECT listing_key, cap_rate_est FROM listings WHERE listing_key = ANY($1::text[])`,
    [wrote.map((d) => d.key)]
  );
  const stored = new Map(rows.map((r) => [r.listing_key, r.cap_rate_est == null ? 0 : Number(r.cap_rate_est)]));
  const clobbered = wrote.filter((d) => {
    const now = stored.get(d.key);
    return now !== undefined && Math.abs(now - d.to) >= 0.005;
  });
  if (clobbered.length === 0) {
    console.log(`🔎 Verified: all ${wrote.length.toLocaleString()} written row(s) still hold their new value.`);
    return 0;
  }
  console.error(
    `\n⚠️  ${clobbered.length.toLocaleString()} of ${wrote.length.toLocaleString()} row(s) were overwritten after this job wrote them.`
  );
  console.error('   Another writer (almost certainly the sync) is active. Re-run once it finishes.');
  for (const d of clobbered.slice(0, 5)) {
    console.error(`     ${d.key}  wrote ${d.to}%  now ${stored.get(d.key)}%`);
  }
  return clobbered.length;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const all = process.argv.includes('--all');
  const resyncIndex = process.argv.includes('--resync-index');
  const force = process.argv.includes('--force');
  const limitArg = process.argv.find((a) => a.startsWith('--limit='));
  const sampleArg = process.argv.find((a) => a.startsWith('--samples='));
  const limit = limitArg ? Number(limitArg.split('=')[1]) : null;
  const sampleCount = sampleArg ? Number(sampleArg.split('=')[1]) : 10;
  if (apply) apiKey(); // fail before the scan, not after it

  console.log('\n💰 Recompute rent-derived metrics (cap rate / gross yield / cashflow)');
  console.log(
    `  ${apply ? 'APPLY' : 'DRY-RUN'}${limit ? ` · limit ${limit}` : ''}` +
    `${all ? ' · scanning ALL actives' : ' · scanning non-positive only'}` +
    `${resyncIndex ? ' · RESYNC INDEX (patch every scanned row)' : ''}\n`
  );

  const url = process.env.DATABASE_URL || process.env.DIRECT_DB_URL;
  if (!url) throw new Error('DATABASE_URL (Session pooler) is required — see CLAUDE.md §12.');
  const client = new Client({ connectionString: url });
  await client.connect();
  await client.query("SET statement_timeout TO '0'");

  // Before the scan, not after it: a 127k-row walk that has to be thrown away is a
  // waste, and starting one against a live sync is how rows go quietly stale.
  if (apply) await assertNoConcurrentWriter(client, force);

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
      `SELECT listing_key, cap_rate_est, rent_match_tier, suite_rent_est, full_payload ${scopeSql}
        ORDER BY listing_key LIMIT $2 OFFSET $3`,
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
      const {
        r, metrics, hadComp, tier, basis, sample, suiteRent, suiteTier, suiteBasis, suiteSample,
        wholeHomeRent, wholeHomeTier, wholeHomeBasis, wholeHomeSample,
      } = res;
      const stored = r.cap_rate_est == null ? null : Number(r.cap_rate_est);
      if (hadComp) gainedComp++;
      if (stored != null && stored < 0 && metrics.cap_rate_est >= 0) clearedNegative++;
      // Postgres stores NULL where the Typesense payload writes the 0 sentinel (the
      // transformer uses `|| null`), so compare on the sentinel-normalised value.
      const capSame = Math.abs((stored ?? 0) - metrics.cap_rate_est) < 0.005;
      // The TIER counts as drift too. A listing whose cap rate is already correct but
      // whose stored rung is absent or stale would otherwise keep comp-grade
      // presentation forever — 124 introduced the column, so every row needs one pass.
      const tierSame = (r.rent_match_tier ?? '') === tier;
      // Suite rent counts as drift on its own (125). A listing whose cap rate happens
      // to land in the same place while its suite line changed would otherwise keep a
      // stale suite figure — and the sandbox reads that figure directly.
      const storedSuite = r.suite_rent_est == null ? 0 : Number(r.suite_rent_est);
      const suiteSame = Math.abs(storedSuite - suiteRent) < 0.5;
      // The skip is keyed on POSTGRES, which assumes the index agrees with it. Measured
      // after the first full run, 1,422 residential for-sale documents still held a
      // fabricated negative: Postgres already read NULL (so "no drift", skipped) while
      // Typesense carried a stale value from an older sync. --resync-index ignores the
      // skip and patches the index for every scanned row, to reconcile a divergence a
      // Postgres-only comparison cannot see. Idempotence is the reason this is a flag
      // and not the default: without it a converged re-run writes nothing.
      //
      // THE PROVENANCE FIELDS CANNOT DRIFT-DETECT. `rent_basis` and `rent_sample_count`
      // are new and Postgres stores neither, so there is nothing on `r` to compare them
      // against — a converged row skips here and keeps an empty provenance line forever.
      // Backfilling them is a ONE-TIME `--resync-index` pass, which is exactly the case
      // that flag was added for. After that pass they ride along with any real drift.
      // The same is true of the four `whole_home_*` fields.
      if (capSame && tierSame && suiteSame && !resyncIndex) continue;
      drifted.push({
        key: r.listing_key,
        address: String((r.full_payload as { UnparsedAddress?: string }).UnparsedAddress ?? '(no address)'),
        from: stored,
        to: metrics.cap_rate_est,
        yieldTo: metrics.gross_yield_est,
        cashflowTo: metrics.net_monthly_cashflow,
        tierTo: tier,
        basisTo: basis,
        sampleTo: sample,
        suiteTo: suiteRent,
        suiteTierTo: suiteTier,
        suiteBasisTo: suiteBasis,
        suiteSampleTo: suiteSample,
        wholeHomeTo: wholeHomeRent,
        wholeHomeTierTo: wholeHomeTier,
        wholeHomeBasisTo: wholeHomeBasis,
        wholeHomeSampleTo: wholeHomeSample,
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
  const tierMix = drifted.reduce<Record<string, number>>((a, d) => {
    const k = d.tierTo || '(no comp)';
    a[k] = (a[k] ?? 0) + 1;
    return a;
  }, {});
  console.log('');
  console.log('   rung mix of the rewritten values:');
  for (const t of ['nbhd', 'city_bath', 'city', 'city_family', 'county', '(no comp)']) {
    if (tierMix[t]) console.log(`      ${t.padEnd(12)} ${tierMix[t].toLocaleString().padStart(7)}`);
  }

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
      `UPDATE listings AS l
          SET cap_rate_est = v.cap, rent_match_tier = v.tier,
              suite_rent_est = v.suite, suite_rent_tier = v.suite_tier
         FROM (SELECT unnest($1::text[]) AS key, unnest($2::numeric[]) AS cap,
                      unnest($3::text[]) AS tier, unnest($4::numeric[]) AS suite,
                      unnest($5::text[]) AS suite_tier) AS v
        WHERE l.listing_key = v.key`,
      // The transformer writes `metrics3.cap_rate_est || null` and a null tier when no
      // comp exists, so both must land as NULL here or this row would disagree with a
      // freshly-transformed one.
      [
        chunk.map((d) => d.key),
        chunk.map((d) => (d.to === 0 ? null : d.to)),
        chunk.map((d) => d.tierTo || null),
        chunk.map((d) => (d.suiteTo > 0 ? d.suiteTo : null)),
        chunk.map((d) => d.suiteTierTo || null),
      ]
    );
    pgUpdated += res.rowCount ?? 0;
    console.log(`   … ${Math.min(i + PG_CHUNK, drifted.length)}/${drifted.length}`);
  }
  console.log(`✅ Postgres: ${pgUpdated.toLocaleString()} row(s) updated.`);
  // THE CONNECTION STAYS OPEN. It used to close here, and `verifyWrites` at the end of
  // main() takes the same client -- so that check has never once run. Every invocation
  // since it was added has ended with:
  //
  //   Fatal: Error: Client was closed and is not queryable
  //       at async verifyWrites (...)
  //
  // after the writes had already landed, which reads like a failed job that in fact
  // succeeded. Worse, verifyWrites is the net added AFTER the 2026-08-21 clobber
  // incident to catch a writer that starts MID-RUN -- the one thing the pre-flight
  // guard structurally cannot see, because this job writes nothing until the whole
  // scan is done. It was dead on arrival.
  //
  // The 2026-08-31 run proved why that gap is real: a second copy of this job was
  // started from another worktree two minutes after the first, and its pre-flight
  // printed "No concurrent writer" quite honestly.

  console.log(`\n📤 Typesense: patching ${drifted.length.toLocaleString()} document(s)…`);
  let updated = 0;
  let absent = 0;
  let failed = 0;
  const firstErrors: string[] = [];
  for (let i = 0; i < drifted.length; i += TS_CHUNK) {
    const r = await pushTypesense(drifted.slice(i, i + TS_CHUNK));
    updated += r.updated;
    absent += r.absent;
    failed += r.failed;
    if (firstErrors.length < 10) firstErrors.push(...r.errors.slice(0, 10 - firstErrors.length));
    console.log(
      `   … ${Math.min(i + TS_CHUNK, drifted.length)}/${drifted.length} ` +
      `(updated ${updated}, not indexed ${absent}, failed ${failed})`
    );
  }
  console.log(`\n✅ Typesense: ${updated.toLocaleString()} updated.`);
  console.log(`   ${absent.toLocaleString()} not in the index (de-listed/closed stock — expected, Postgres still updated).`);
  if (failed) {
    // A real failure, as opposed to an absent document. Print it: a bare count is how
    // a half-applied patch gets read as a finished one.
    console.log(`   ❌ ${failed.toLocaleString()} REAL failure(s):`);
    for (const e of firstErrors) console.log(`      ${e}`);
  } else {
    console.log('   0 real failures.');
  }

  // The pre-flight check can only see a writer that had already started. This catches
  // one that began mid-run, which is exactly what happened on 2026-08-21 — and it asks
  // the only question that matters: do the rows still hold what we wrote?
  const clobbered = await verifyWrites(client, drifted);
  await client.end();
  if (clobbered > 0) process.exit(3);
}

main().catch((err) => {
  console.error('❌ Fatal:', err);
  process.exit(1);
});
