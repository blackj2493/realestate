/**
 * Shadow MLS — Refresh condo_fee_stats from raw_vow_sold.
 *
 * Precomputes the two cohorts the listing-page "Condo Fee Stability" card reads:
 *   • 'area' → fee/sqft distribution (median + p25/p75) per CityRegion + condo sub-type.
 *   • 'corp' → fee/sqft trend (half-year median buckets + 24mo % change) per condo corp.
 * Corp rows are only written when the building clears MIN_CORP_SAMPLE / MIN_CORP_PERIODS
 * (sparse buildings → no corp row → benchmark-only at read time, by design).
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
  halfYearPeriod,
  assembleCorpStats,
  MIN_AREA_SAMPLE,
  MIN_CORP_SAMPLE,
  MIN_CORP_PERIODS,
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
  byPeriod: Map<string, number[]>;
  total: number;
  bundled: number;
  nonBundled: number;
}

const areaMap = new Map<string, AreaAcc>();
const corpMap = new Map<string, CorpAcc>();

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
      .select(
        'listing_key, association_fee, living_area_range, building_area_total, ' +
          'property_sub_type, city_region, close_date, purchase_contract_date, ' +
          'corp:raw_payload->CondoCorpNumber, incl:raw_payload->AssociationFeeIncludes'
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

  const cutoff = windowCutoff();
  const cutoffDate = cutoff.toISOString().slice(0, 10); // YYYY-MM-DD for the close_date filter
  let cursor = '';
  let scanned = 0;
  let condos = 0;
  let withPsf = 0;
  let condosWithCorp = 0;

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

      // ── Corp cohort (CondoCorpNumber) ──
      const corpKey = r.corp === null || r.corp === undefined ? '' : String(r.corp).trim();
      if (corpKey && corpKey !== '0') {
        condosWithCorp++;
        const period = halfYearPeriod(dateStr);
        if (period) {
          let c = corpMap.get(corpKey);
          if (!c) {
            c = { corp: corpKey, byPeriod: new Map(), total: 0, bundled: 0, nonBundled: 0 };
            corpMap.set(corpKey, c);
          }
          const bucket = c.byPeriod.get(period) || [];
          bucket.push(psf);
          c.byPeriod.set(period, bucket);
          c.total++;
          if (bundled) c.bundled++;
          else c.nonBundled++;
        }
      }
    }

    cursor = rows[rows.length - 1].listing_key;
    console.log(`   …scanned ${scanned} (condos ${condos}, with fee/sqft ${withPsf}) — last key ${cursor}`);

    if (rows.length < pageSize) {
      console.log('✅ Last page.');
      break;
    }
    await sleep(INTER_CHUNK_DELAY_MS);
  }

  // ── Build upsert rows ────────────────────────────────────────────────────────
  const round4 = (n: number) => Math.round(n * 10000) / 10000;

  type StatsRow = {
    cohort_type: 'area' | 'corp';
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

  let corpQualified = 0;
  for (const c of corpMap.values()) {
    // Shared assembler drops low-n buckets and gates on periods/sample (see lib).
    const stats = assembleCorpStats(c.byPeriod, c.bundled > 0 && c.nonBundled > 0);
    if (!stats) continue;
    corpQualified++;
    upserts.push({
      cohort_type: 'corp',
      cohort_key: c.corp,
      property_sub_type: 'ALL',
      median_fee_psf: null,
      p25_fee_psf: null,
      p75_fee_psf: null,
      trend_buckets: stats.buckets,
      pct_change_24mo: stats.pctChange24mo,
      inclusions_mixed: stats.inclusionsMixed,
      sample_count: stats.sampleCount,
      window_months: WINDOW_MONTHS,
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
        `   corp ${u.cohort_key}  Δ${u.pct_change_24mo}%/24mo  n=${u.sample_count}  ` +
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
}

main().catch((e) => {
  console.error('CRASH:', e?.message || e);
  process.exit(1);
});
