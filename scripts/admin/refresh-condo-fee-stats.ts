/**
 * Shadow MLS — Refresh condo_fee_stats from raw_vow_sold.
 *
 * Precomputes the cohorts the listing-page "Condo Fee Stability" card and the public
 * /data/condo-fees tracker read:
 *   • 'area'       → fee/sqft distribution (median + p25/p75) per CityRegion + sub-type.
 *   • 'corp'       → fee/sqft trend (half-year buckets + annualized %/yr) per BUILDING.
 *   • 'area_trend' → neighbourhood fee inflation: the MEDIAN of member building trends
 *                    (one vote per building) + the area's fee/sqft spread. Requires
 *                    MIN_AREA_TREND_BUILDINGS distinct buildings.
 * Corp rows are only written when the building clears MIN_CORP_SAMPLE / MIN_CORP_PERIODS
 * (sparse buildings → no corp row → benchmark-only at read time, by design).
 *
 * COHORT KEYS: corp rows are keyed `REGISTRY-NUMBER` (e.g. 'MTCC-539') via the shared
 * corpCohortKey(). A CondoCorpNumber is only unique within its registry, so the old
 * bare-number key merged unrelated buildings in different cities into one fictional
 * cohort. The listing page builds the same key through the same helper.
 *
 * EVICTION: a plain upsert never removes anything, so a cohort that qualified under
 * superseded logic lingered forever (this is how pre-clamp +568%/yr trends survived
 * later refreshes). After a clean FULL run, rows untouched by that run are deleted.
 * Skipped automatically on a --limit/partial run or any upsert failure; --no-evict opts out.
 *
 * Reads raw_vow_sold READ-ONLY (CLAUDE.md §12 — never alter it) and writes the SEPARATE
 * condo_fee_stats table. All logic is deterministic (CLAUDE.md §4) — the shared scoring
 * lives in src/lib/condo/feeStability.ts so the app and this job never drift.
 *
 * IO-FRUGAL (cf. Disk IO Budget incident — memory supabase-io-budget):
 *   - reads only the small columns / two JSONB sub-keys it needs, never the full raw_payload
 *   - keyset pagination on listing_key (no slow OFFSET on a 217k table)
 *   - in-memory aggregation, then chunked array upserts; inter-chunk delay to let IO refill
 *
 * Usage:
 *   npx.cmd tsx --env-file=.env scripts/admin/refresh-condo-fee-stats.ts                 # dry-run (no writes)
 *   npx.cmd tsx --env-file=.env scripts/admin/refresh-condo-fee-stats.ts --limit 5000    # dry-run, first 5000 rows
 *   npx.cmd tsx --env-file=.env scripts/admin/refresh-condo-fee-stats.ts --apply         # write full table
 */

// MUST set TLS env var BEFORE importing the supabase client.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { createClient } from '@supabase/supabase-js';
import {
  isCondo,
  resolveSqft,
  computeFeePsf,
  bundlesUtilities,
  median,
  quantile,
  assembleCorpStats,
  assembleAreaTrend,
  corpCohortKey,
  MIN_AREA_SAMPLE,
  MIN_CORP_SAMPLE,
  MIN_CORP_PERIODS,
  MIN_AREA_TREND_BUILDINGS,
  WINDOW_MONTHS,
  type TrendBucket,
} from '@/lib/condo/feeStability';

// Supabase client uses Node's native fetch (undici). We deliberately do NOT override
// global.fetch with cross-fetch/node-fetch: node-fetch throws `FetchError: … Premature
// close` on GitHub Actions' egress to Supabase (it killed the daily ETL — see
// src/lib/supabase/client.ts), and its TLS-relaxed agent isn't needed (the core sync
// verifies certs fine over the same path).

// ── CLI flags ────────────────────────────────────────────────────────────────
const APPLY = process.argv.includes('--apply');
// Stale cohorts (ones that qualified under superseded logic but no longer qualify)
// are deleted after a clean full run — see the eviction block in main(). --no-evict
// keeps them, and eviction is skipped automatically on a partial/limited run.
const NO_EVICT = process.argv.includes('--no-evict');
const limitArg = process.argv.find((a) => a.startsWith('--limit'));
const ROW_LIMIT = limitArg
  ? parseInt(limitArg.includes('=') ? limitArg.split('=')[1] : process.argv[process.argv.indexOf(limitArg) + 1], 10)
  : Infinity;

// ── IO pacing (deliberately gentle) ──────────────────────────────────────────
// NOTE: the two JSONB sub-keys in the select (raw_payload->CondoCorpNumber /
// ->AssociationFeeIncludes) force Postgres to DETOAST the full raw_payload blob
// per row — these reads are not "light". So we (a) pre-filter the trailing window
// in SQL so only in-window rows detoast, (b) keep pages small enough to finish
// under statement_timeout even when the Disk IO burst budget is depleted, and
// (c) retry with backoff on timeout (= budget exhaustion; cf. memory supabase-io-budget).
const CHUNK_SIZE = 500; // rows per read page (each detoasts full raw_payload)
const UPSERT_CHUNK = 200; // rows per array-upsert
const INTER_CHUNK_DELAY_MS = 400; // gentler pacing so the IO burst budget can refill
const MAX_READ_RETRIES = 5; // statement timeout = IO budget exhausted → back off + retry

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Raw row shape from the aliased select.
interface SoldRow {
  listing_key: string;
  association_fee: number | string | null;
  living_area_range: string | number | null;
  building_area_total: number | string | null;
  property_sub_type: string | null;
  city_region: string | null;
  close_date: string | null;
  purchase_contract_date: string | null;
  corp: number | string | null; // raw_payload->CondoCorpNumber
  reg: string | null; // raw_payload->AssociationName (condo registry: TSCC/MTCC/YCC/…)
  city: string | null;
  incl: unknown; // raw_payload->AssociationFeeIncludes
}

// In-memory accumulators.
interface AreaAcc {
  cityRegion: string;
  propertySubType: string;
  psf: number[];
  bundled: number;
  nonBundled: number;
}
interface CorpAcc {
  corp: string;
  // Raw in-window sold observations (exact date + fee/sqft). The robust log-slope
  // trend needs per-sale time points, so we no longer pre-bucket here — assembleCorpStats
  // does the half-year bucketing (for the chart) and the slope fit (for the headline).
  sales: { date: string; psf: number }[];
  total: number;
  bundled: number;
  nonBundled: number;
  // Where this building sits — tallied because a corp's rows can carry slightly
  // different spellings; the most frequent value wins (see `dominant`).
  regions: Map<string, number>;
  cities: Map<string, number>;
}

const areaMap = new Map<string, AreaAcc>();
const corpMap = new Map<string, CorpAcc>();

/** Most frequently seen value in a tally, or '' when empty. */
function dominant(tally: Map<string, number>): string {
  let best = '';
  let bestN = 0;
  for (const [k, n] of tally) {
    if (n > bestN) {
      best = k;
      bestN = n;
    }
  }
  return best;
}

function bump(tally: Map<string, number>, key: string): void {
  if (!key) return;
  tally.set(key, (tally.get(key) ?? 0) + 1);
}

/**
 * Reads one keyset page of raw_vow_sold with retry + exponential backoff.
 *
 * The trailing-window pre-filter (`close_date >= cutoff OR close_date IS NULL`)
 * is what makes this affordable: Postgres only detoasts raw_payload (for the
 * corp/inclusions sub-keys) on rows that pass it, instead of all ~217k. Keeping
 * `close_date IS NULL` rows lets the in-memory `close_date || contract_date`
 * fallback still decide them, so excluded rows are exactly the ones the loop would
 * `continue` past anyway — behavior-preserving.
 *
 * A statement timeout here is the IO burst-budget exhaustion pattern; backing off
 * a few seconds lets the budget refill and the same page then succeeds.
 */
async function readPage(
  cursor: string,
  pageSize: number,
  cutoffDate: string
): Promise<SoldRow[] | null> {
  let attempt = 0;
  for (;;) {
    const { data, error } = await sb
      .from('raw_vow_sold')
      // NOTE: raw_payload is already detoasted for the corp/inclusions sub-keys, so
      // pulling AssociationName + city here costs no additional IO.
      .select(
        'listing_key, association_fee, living_area_range, building_area_total, ' +
          'property_sub_type, city_region, city, close_date, purchase_contract_date, ' +
          'corp:raw_payload->CondoCorpNumber, reg:raw_payload->AssociationName, ' +
          'incl:raw_payload->AssociationFeeIncludes'
      )
      .gt('listing_key', cursor)
      .or(`close_date.gte.${cutoffDate},close_date.is.null`)
      .order('listing_key', { ascending: true })
      .limit(pageSize);

    if (!error) return data as unknown as SoldRow[] | null;

    attempt++;
    const isTimeout = /timeout|57014|canceling statement/i.test(error.message);
    if (attempt > MAX_READ_RETRIES) {
      throw new Error(
        `read failed at cursor "${cursor}" after ${MAX_READ_RETRIES} retries: ${error.message}`
      );
    }
    const backoff = Math.min(30000, 3000 * 2 ** (attempt - 1)); // 3s,6s,12s,24s,30s
    console.warn(
      `   ⏳ Read ${isTimeout ? 'timed out' : 'errored'} at cursor "${cursor}" ` +
        `(attempt ${attempt}/${MAX_READ_RETRIES}): ${error.message} — backing off ${backoff}ms…`
    );
    await sleep(backoff);
  }
}

function windowCutoff(): Date {
  const d = new Date();
  d.setMonth(d.getMonth() - WINDOW_MONTHS);
  return d;
}

async function main() {
  console.log('========================================');
  console.log('  Refresh condo_fee_stats ← raw_vow_sold');
  console.log(`  Mode: ${APPLY ? 'APPLY (writing)' : 'DRY-RUN (no writes)'}`);
  if (Number.isFinite(ROW_LIMIT)) console.log(`  Row limit: ${ROW_LIMIT}`);
  console.log(`  Window: trailing ${WINDOW_MONTHS} months`);
  console.log('========================================\n');

  // Captured BEFORE any write: every row this run touches ends up with a later
  // updated_at (DEFAULT now() on insert, trigger on update), so anything still older
  // than this is a cohort we did not write — the eviction cutoff. Taking it at run
  // start (rather than at upsert time) is the conservative direction: it can only
  // spare rows, never over-delete.
  const runStartedAt = new Date().toISOString();
  const cutoff = windowCutoff();
  const cutoffDate = cutoff.toISOString().slice(0, 10); // YYYY-MM-DD for the close_date filter
  let cursor = '';
  let scanned = 0;
  let condos = 0;
  let withPsf = 0;
  let condosWithCorp = 0;
  // Only a run that walked the whole table may evict (a --limit or early break must not).
  let completedFullScan = false;

  while (scanned < ROW_LIMIT) {
    const pageSize = Math.min(CHUNK_SIZE, ROW_LIMIT - scanned);
    let data: SoldRow[] | null;
    try {
      data = await readPage(cursor, pageSize, cutoffDate);
    } catch (e) {
      console.error(`❌ ${e instanceof Error ? e.message : String(e)}`);
      process.exitCode = 1;
      return;
    }
    if (!data || data.length === 0) {
      console.log('✅ Reached end of table.');
      completedFullScan = true;
      break;
    }

    const rows = data as unknown as SoldRow[];
    for (const r of rows) {
      scanned++;

      // Condo only.
      if (!isCondo({ PropertySubType: r.property_sub_type })) continue;
      condos++;

      // Within window (prefer close_date; fall back to contract date).
      const dateStr = r.close_date || r.purchase_contract_date;
      if (!dateStr) continue;
      const d = new Date(dateStr);
      if (Number.isNaN(d.getTime()) || d < cutoff) continue;

      const sqft = resolveSqft({
        BuildingAreaTotal: r.building_area_total,
        LivingAreaRange: r.living_area_range,
      });
      const psf = computeFeePsf(r.association_fee, sqft);
      if (psf === null) continue;
      withPsf++;

      const bundled = bundlesUtilities(r.incl);
      const cityRegion = (r.city_region || '').trim();
      const subType = (r.property_sub_type || '').trim();

      // ── Area cohort (CityRegion + sub-type) ──
      if (cityRegion && subType) {
        const key = `${cityRegion}||${subType}`;
        let a = areaMap.get(key);
        if (!a) {
          a = { cityRegion, propertySubType: subType, psf: [], bundled: 0, nonBundled: 0 };
          areaMap.set(key, a);
        }
        a.psf.push(psf);
        if (bundled) a.bundled++;
        else a.nonBundled++;
      }

      // ── Corp cohort (registry + CondoCorpNumber) ──
      // Keyed through the shared helper: a bare corp number is only unique within its
      // registry, so 'MTCC-539' (Toronto) and 'YRCC-539' (Markham) must stay distinct.
      const corpKey = corpCohortKey(r.reg, r.corp);
      if (corpKey) {
        condosWithCorp++;
        let c = corpMap.get(corpKey);
        if (!c) {
          c = {
            corp: corpKey,
            sales: [],
            total: 0,
            bundled: 0,
            nonBundled: 0,
            regions: new Map(),
            cities: new Map(),
          };
          corpMap.set(corpKey, c);
        }
        c.sales.push({ date: dateStr, psf });
        c.total++;
        if (bundled) c.bundled++;
        else c.nonBundled++;
        bump(c.regions, cityRegion);
        bump(c.cities, (r.city || '').trim());
      }
    }

    cursor = rows[rows.length - 1].listing_key;
    console.log(`   …scanned ${scanned} (condos ${condos}, with fee/sqft ${withPsf}) — last key ${cursor}`);

    if (rows.length < pageSize) {
      console.log('✅ Last page.');
      completedFullScan = true;
      break;
    }
    await sleep(INTER_CHUNK_DELAY_MS);
  }

  // ── Build upsert rows ────────────────────────────────────────────────────────
  const round4 = (n: number) => Math.round(n * 10000) / 10000;

  type StatsRow = {
    cohort_type: 'area' | 'corp' | 'area_trend';
    cohort_key: string;
    property_sub_type: string;
    median_fee_psf: number | null;
    p25_fee_psf: number | null;
    p75_fee_psf: number | null;
    trend_buckets: TrendBucket[];
    pct_change_24mo: number | null;
    inclusions_mixed: boolean;
    sample_count: number;
    window_months: number;
    meta?: Record<string, unknown> | null; // migration 086 — area_trend context
  };

  const upserts: StatsRow[] = [];

  let areaQualified = 0;
  for (const a of areaMap.values()) {
    if (a.psf.length < MIN_AREA_SAMPLE) continue;
    areaQualified++;
    upserts.push({
      cohort_type: 'area',
      cohort_key: a.cityRegion,
      property_sub_type: a.propertySubType,
      median_fee_psf: round4(median(a.psf)),
      p25_fee_psf: round4(quantile(a.psf, 0.25)),
      p75_fee_psf: round4(quantile(a.psf, 0.75)),
      trend_buckets: [],
      pct_change_24mo: null,
      inclusions_mixed: a.bundled > 0 && a.nonBundled > 0,
      sample_count: a.psf.length,
      window_months: WINDOW_MONTHS,
    });
  }

  // Neighbourhood fee-inflation accumulator, filled as each building qualifies below.
  interface AreaTrendAcc {
    cityRegion: string;
    cities: Map<string, number>;
    buildings: { annualPct: number; sampleCount: number }[];
  }
  const areaTrendMap = new Map<string, AreaTrendAcc>();

  let corpQualified = 0;
  for (const c of corpMap.values()) {
    // Shared assembler builds the chart buckets AND the robust annualized log-slope
    // (drops low-n buckets, gates on periods/sample/span — see lib).
    const stats = assembleCorpStats(c.sales, c.bundled > 0 && c.nonBundled > 0);
    if (!stats) continue;
    corpQualified++;

    // Feed the building's trend into its neighbourhood cohort.
    const region = dominant(c.regions);
    if (region) {
      let at = areaTrendMap.get(region);
      if (!at) {
        at = { cityRegion: region, cities: new Map(), buildings: [] };
        areaTrendMap.set(region, at);
      }
      at.buildings.push({ annualPct: stats.annualPct, sampleCount: stats.sampleCount });
      for (const [city, n] of c.cities) at.cities.set(city, (at.cities.get(city) ?? 0) + n);
    }
    upserts.push({
      cohort_type: 'corp',
      cohort_key: c.corp,
      property_sub_type: 'ALL',
      median_fee_psf: null,
      p25_fee_psf: null,
      p75_fee_psf: null,
      trend_buckets: stats.buckets,
      // NOTE: the pct_change_24mo COLUMN now stores an ANNUALIZED %/yr rate
      // (repurposed 2026-07 in the trend rework — see feeStability.ts). The physical
      // column name is kept to avoid a migration; getListingDetail reads it as annualPct.
      pct_change_24mo: stats.annualPct,
      inclusions_mixed: stats.inclusionsMixed,
      sample_count: stats.sampleCount,
      window_months: WINDOW_MONTHS,
    });
  }

  // ── Area fee-trend cohorts (neighbourhood condo-fee inflation) ───────────────
  // The public /data condo-fee tracker reads these. The headline is a MEDIAN of member
  // building trends (one vote per building), and the fee/sqft distribution reuses the
  // psf already pooled for the area cohorts, merged across condo sub-types.
  const psfByRegion = new Map<string, number[]>();
  for (const a of areaMap.values()) {
    const arr = psfByRegion.get(a.cityRegion) ?? [];
    arr.push(...a.psf);
    psfByRegion.set(a.cityRegion, arr);
  }

  let areaTrendQualified = 0;
  for (const at of areaTrendMap.values()) {
    const stats = assembleAreaTrend(at.buildings);
    if (!stats) continue;
    areaTrendQualified++;
    const pool = psfByRegion.get(at.cityRegion) ?? [];
    upserts.push({
      cohort_type: 'area_trend',
      cohort_key: at.cityRegion,
      property_sub_type: 'ALL',
      median_fee_psf: pool.length ? round4(median(pool)) : null,
      p25_fee_psf: pool.length ? round4(quantile(pool, 0.25)) : null,
      p75_fee_psf: pool.length ? round4(quantile(pool, 0.75)) : null,
      trend_buckets: [],
      pct_change_24mo: stats.medianAnnualPct, // %/yr, same units as corp rows
      inclusions_mixed: false,
      sample_count: stats.sampleCount,
      window_months: WINDOW_MONTHS,
      meta: {
        city: dominant(at.cities),
        p25AnnualPct: stats.p25AnnualPct,
        p75AnnualPct: stats.p75AnnualPct,
        buildingCount: stats.buildingCount,
      },
    });
  }

  // ── Summary (this is the "verify-first" diagnostic the plan calls for) ────────
  console.log('\n──────── Summary ────────');
  console.log(`Rows scanned:           ${scanned}`);
  console.log(`Condos:                 ${condos}`);
  console.log(`Condos w/ fee+sqft:     ${withPsf}`);
  console.log(
    `CondoCorpNumber present: ${condosWithCorp}/${condos}` +
      (condos ? ` (${Math.round((condosWithCorp / condos) * 100)}%)` : '')
  );
  console.log(`Area cohorts (≥${MIN_AREA_SAMPLE}):    ${areaQualified} / ${areaMap.size} total`);
  console.log(
    `Corp cohorts (≥${MIN_CORP_SAMPLE} & ≥${MIN_CORP_PERIODS}p): ${corpQualified} / ${corpMap.size} total`
  );
  console.log(
    `Area-trend cohorts (≥${MIN_AREA_TREND_BUILDINGS} bldgs): ${areaTrendQualified} / ${areaTrendMap.size} total`
  );

  const areaSamples = upserts.filter((u) => u.cohort_type === 'area').slice(0, 5);
  if (areaSamples.length) {
    console.log('\nSample area cohorts:');
    areaSamples.forEach((u) =>
      console.log(
        `   ${u.cohort_key} / ${u.property_sub_type}  median=$${u.median_fee_psf}/sqft ` +
          `[${u.p25_fee_psf}–${u.p75_fee_psf}]  n=${u.sample_count}${u.inclusions_mixed ? '  (incl mixed)' : ''}`
      )
    );
  }
  const corpSamples = upserts.filter((u) => u.cohort_type === 'corp').slice(0, 5);
  if (corpSamples.length) {
    console.log('\nSample corp trends:');
    corpSamples.forEach((u) =>
      console.log(
        `   corp ${u.cohort_key}  ${u.pct_change_24mo}%/yr  n=${u.sample_count}  ` +
          u.trend_buckets.map((b) => `${b.period}:$${b.medianPsf}(${b.n})`).join(' ')
      )
    );
  }

  if (!APPLY) {
    console.log(`\n(DRY-RUN — ${upserts.length} rows would be upserted. Re-run with --apply to persist.)`);
    return;
  }

  // ── Write (chunked array upserts, IO-paced) ──────────────────────────────────
  console.log(`\n💾 Upserting ${upserts.length} rows to condo_fee_stats…`);
  let ok = 0;
  let failed = 0;
  for (let i = 0; i < upserts.length; i += UPSERT_CHUNK) {
    const chunk = upserts.slice(i, i + UPSERT_CHUNK);
    const { error } = await sb
      .from('condo_fee_stats')
      .upsert(chunk, { onConflict: 'cohort_type,cohort_key,property_sub_type' });
    if (error) {
      failed += chunk.length;
      console.warn(`   ⚠️  upsert chunk @${i} failed: ${error.message}`);
    } else {
      ok += chunk.length;
    }
    await sleep(INTER_CHUNK_DELAY_MS);
  }
  console.log(`   ✅ condo_fee_stats: ${ok} upserted, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;

  // ── Evict stale cohorts ──────────────────────────────────────────────────────
  // The upsert alone never removes anything, so a cohort that qualified under
  // SUPERSEDED logic lingers forever with its old value. That is how pre-clamp trends
  // (e.g. +568%/yr, written before the 2026-07 trend rework) survived every later
  // refresh. Anything this run did not touch is by definition no longer qualifying.
  //
  // Guarded hard: only after a clean, complete run, so a partial scan or a failed
  // chunk can never mass-delete good data.
  const fullRun = completedFullScan && !Number.isFinite(ROW_LIMIT);
  const canEvict = !NO_EVICT && fullRun && failed === 0 && ok > 0;
  if (!canEvict) {
    console.log(
      `   ⏭️  Eviction skipped (${
        NO_EVICT ? '--no-evict' : !fullRun ? 'partial/limited scan' : failed > 0 ? 'upsert failures' : 'nothing written'
      }).`
    );
    return;
  }
  const { data: evicted, error: evictErr } = await sb
    .from('condo_fee_stats')
    .delete()
    .lt('updated_at', runStartedAt)
    .in('cohort_type', ['area', 'corp', 'area_trend'])
    .select('cohort_type');
  if (evictErr) {
    console.warn(`   ⚠️  eviction failed: ${evictErr.message}`);
    process.exitCode = 1;
  } else {
    const rows = evicted ?? [];
    const byType = rows.reduce<Record<string, number>>((acc, r) => {
      const t = String((r as { cohort_type: string }).cohort_type);
      acc[t] = (acc[t] ?? 0) + 1;
      return acc;
    }, {});
    console.log(
      `   🧹 Evicted ${rows.length} stale cohort row(s)` +
        (rows.length ? ` (${Object.entries(byType).map(([t, n]) => `${t}:${n}`).join(', ')})` : '')
    );
  }
}

main().catch((e) => {
  console.error('CRASH:', e?.message || e);
  process.exit(1);
});
