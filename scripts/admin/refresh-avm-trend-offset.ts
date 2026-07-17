/**
 * Shadow MLS — Refresh avm_trend_index + avm_community_offset from raw_vow_sold.
 *
 * Precomputes the two inputs the redesigned AVM anchor needs (plan
 * concurrent-prancing-owl, migration 024). Splits the level/trend decomposition:
 *   • avm_trend_index   — robust median of FEATURE-ADJUSTED ln(close_price) per
 *                         (city × sub-type × half-year), last 24 mo.
 *   • avm_community_offset — long-window median of (ℓ_community − g_city) per
 *                         (city_region × sub-type). Trend cancels in the ratio,
 *                         so no training date is required for the offset.
 *
 * Math (deterministic; CLAUDE.md §4):
 *   ℓ_i = ln(close_price_i)  − Σ β_f · (x_{i,f} − μ_f) / σ_f
 *   g(city, sub, period)     = robust median of ℓ_i over (city × sub × period)
 *   δ(c, sub)                = median over c's comps of (ℓ_i − g(city, sub, period_i))
 *
 * Each ℓ_i is adjusted using the community matrix (avm_multiplier_matrix). Comps
 * whose community has no matrix are skipped — their AVM won't run anyway, so they
 * don't belong in the trend/offset sample. interior/exterior/basement features
 * use the SAME score conventions as calculator.ts (6−tier, 5−tier, 10−tier) so
 * the standardization aligns with the live request path.
 *
 * IO-FRUGAL (cf. supabase-io-budget memory):
 *   - SCALAR columns only on raw_vow_sold — NO raw_payload detoast.
 *   - Keyset pagination on listing_key (no slow OFFSET).
 *   - Bounded read window (filtered by close_date) + matrix preload at start.
 *   - Chunked array upserts with inter-chunk delay; timeout = backoff + retry.
 *
 * raw_vow_sold is READ-ONLY here (§12). This script writes only to its own two
 * tables, behind continue-on-error in the daily-sync workflow.
 *
 * Usage:
 *   npx.cmd tsx --env-file=.env scripts/admin/refresh-avm-trend-offset.ts                # dry-run
 *   npx.cmd tsx --env-file=.env scripts/admin/refresh-avm-trend-offset.ts --limit 5000   # dry-run, first 5000 rows
 *   npx.cmd tsx --env-file=.env scripts/admin/refresh-avm-trend-offset.ts --apply        # write both tables
 */

// MUST set TLS env var BEFORE importing the supabase client.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { createClient } from '@supabase/supabase-js';
import { normalizePropertySubType, cityRegionLookupCandidates } from '@/lib/avm/normalizeType';
import { MIN_SALE_PRICE } from '@/lib/avm/types';

// Supabase client uses Node's native fetch (undici). We deliberately do NOT override
// global.fetch with cross-fetch/node-fetch: node-fetch throws `FetchError: … Premature
// close` on GitHub Actions' egress to Supabase (it killed the daily ETL — see
// src/lib/supabase/client.ts), and its TLS-relaxed agent isn't needed (the core sync
// verifies certs fine over the same path).

// ── CLI flags ────────────────────────────────────────────────────────────────
const APPLY = process.argv.includes('--apply');
const limitArg = process.argv.find((a) => a.startsWith('--limit'));
const ROW_LIMIT = limitArg
  ? parseInt(
      limitArg.includes('=') ? limitArg.split('=')[1] : process.argv[process.argv.indexOf(limitArg) + 1],
      10
    )
  : Infinity;

// ── IO pacing ────────────────────────────────────────────────────────────────
const CHUNK_SIZE = 1000;
const UPSERT_CHUNK = 200;
const INTER_CHUNK_DELAY_MS = 300;
const MAX_READ_RETRIES = 5;

// ── Statistical thresholds (Phase 2 may tune) ───────────────────────────────
const WINDOW_MONTHS = 24;           // trailing window for trend index
const MIN_TREND_SAMPLES = 8;        // ≥ this many ℓ_i to publish a trend bucket
const MIN_OFFSET_SAMPLES = 5;       // ≥ this many ℓ_i to publish a community offset

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

// ─────────────────────────────────────────────────────────────────────────────
// Domain types
// ─────────────────────────────────────────────────────────────────────────────

interface SoldRow {
  listing_key: string;
  close_price: number | null;
  close_date: string | null;
  purchase_contract_date: string | null;
  city: string | null;
  city_region: string | null;
  property_sub_type: string | null;
  building_area_total: number | null;
  lot_width: number | null;
  bedrooms_above_grade: number | null;
  bathrooms_total_integer: number | null;
  parking_total: number | null;
  interior_tier: number | null;
  exterior_tier: number | null;
  basement_tier: number | null;
}

interface FeatureCoeff {
  beta: number;
  mean: number;
  std: number;
}

type MatrixKey = string; // `${city_region}||${sub_type}`
type Matrix = Map<string, FeatureCoeff>; // feature_name → coeff

interface MatrixIndex {
  /** Lookup map — one entry per CANDIDATE city_region key; multiple keys may point at the same Matrix. */
  byKey: Map<MatrixKey, Matrix>;
  /** Distinct cohort count (one per verbatim (city_region, sub_type)). */
  cohortCount: number;
}

/** A feature-adjusted log-level record, ready for trend/offset aggregation. */
interface LRecord {
  city: string;
  cityRegion: string;
  subType: string;
  periodEnd: string; // 'YYYY-06-30' or 'YYYY-12-31'
  l: number;         // adjusted ln(price)
}

/** Group of ℓ_i values for one bucket. */
type LBucket = { values: number[] };

// ─────────────────────────────────────────────────────────────────────────────
// Math helpers
// ─────────────────────────────────────────────────────────────────────────────

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** End-of-half-year date for a given YYYY-MM-DD, ISO 'YYYY-06-30' or 'YYYY-12-31'. */
function periodEndForDate(iso: string): string {
  const d = new Date(iso);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth(); // 0-based
  return m <= 5 ? `${y}-06-30` : `${y}-12-31`;
}

/** Z-clamp matches calculator.ts so adjustments behave identically. */
const Z_CLAMP = 3;
function clampZ(z: number): number {
  return Math.max(-Z_CLAMP, Math.min(Z_CLAMP, z));
}

// ─────────────────────────────────────────────────────────────────────────────
// Matrix preload
// ─────────────────────────────────────────────────────────────────────────────

async function loadMatrices(): Promise<MatrixIndex> {
  const out = new Map<MatrixKey, Matrix>();
  // Per-(city_region, sub_type) matrix instances, keyed by VERBATIM city_region
  // so all feature rows for a single matrix accumulate into the same Map.
  const byVerbatim = new Map<string, Matrix>();
  let cursor = 0;
  // PostgREST caps `.limit()` server-side at 1000 by default. Anything larger
  // here would return only 1000 rows and trip the data.length<PAGE early-exit
  // → we'd see only the first cohort batch (was 125 of 970).
  const PAGE = 1000;

  for (;;) {
    const { data, error } = await sb
      .from('avm_multiplier_matrix')
      .select('id, city_region, property_sub_type, feature_name, beta, feat_mean, feat_std')
      .gt('id', cursor)
      .order('id', { ascending: true })
      .limit(PAGE);

    if (error) throw new Error(`matrix load failed: ${error.message}`);
    if (!data || data.length === 0) break;

    for (const r of data as Array<{
      id: number;
      city_region: string;
      property_sub_type: string;
      feature_name: string;
      beta: number;
      feat_mean: number;
      feat_std: number;
    }>) {
      // Normalize sub_type so live lookups match (matrices are mostly canonical
      // already, but normalize is cheap and defensive against any drift).
      const sub = normalizePropertySubType(r.property_sub_type);
      const verbatimKey = `${r.city_region}||${sub}`;
      let m = byVerbatim.get(verbatimKey);
      if (!m) {
        m = new Map();
        byVerbatim.set(verbatimKey, m);
        // Register the SAME matrix under every candidate spelling so a
        // raw_vow_sold lookup hits it regardless of whether the comp's
        // CityRegion is the verbatim, prefix-stripped, or tag-stripped form.
        for (const cand of cityRegionLookupCandidates(r.city_region)) {
          const candKey = `${cand}||${sub}`;
          if (!out.has(candKey)) out.set(candKey, m);
        }
      }
      m.set(r.feature_name, { beta: r.beta, mean: r.feat_mean, std: r.feat_std });
      cursor = r.id;
    }
    if (data.length < PAGE) break;
  }

  return { byKey: out, cohortCount: byVerbatim.size };
}

/**
 * Feature-adjust ln(price): ℓ = ln(price) − Σ β·z(x).
 * Matches calculator.ts conventions: null features skip; tiers → scores;
 * std>0 required; z clamped to ±3.
 */
function adjustedLogPrice(row: SoldRow, matrix: Matrix): number | null {
  if (!row.close_price || row.close_price <= 0) return null;
  let l = Math.log(row.close_price);

  const interiorScore = row.interior_tier !== null ? 6 - row.interior_tier : null;
  const exteriorScore = row.exterior_tier !== null ? 5 - row.exterior_tier : null;
  const basementScore = row.basement_tier !== null ? 10 - row.basement_tier : null;

  const feats: Array<[string, number | null]> = [
    ['building_area_total', row.building_area_total],
    ['lot_width', row.lot_width !== null && row.lot_width > 0 ? row.lot_width : null],
    ['bedrooms_above_grade', row.bedrooms_above_grade],
    ['bathrooms_total_integer', row.bathrooms_total_integer],
    ['parking_total', row.parking_total],
    ['basement_score', basementScore],
    ['interior_score', interiorScore],
    ['exterior_score', exteriorScore],
  ];

  for (const [name, value] of feats) {
    if (value === null) continue;
    const c = matrix.get(name);
    if (!c || c.beta === 0 || !(c.std > 0)) continue;
    const z = clampZ((value - c.mean) / c.std);
    l -= c.beta * z;
  }

  if (!Number.isFinite(l)) return null;
  return l;
}

// ─────────────────────────────────────────────────────────────────────────────
// raw_vow_sold streaming read
// ─────────────────────────────────────────────────────────────────────────────

async function readPage(cursor: string, pageSize: number, windowStartIso: string): Promise<SoldRow[] | null> {
  let attempt = 0;
  for (;;) {
    const { data, error } = await sb
      .from('raw_vow_sold')
      .select(
        'listing_key, close_price, close_date, purchase_contract_date, city, city_region, ' +
          'property_sub_type, building_area_total, lot_width, bedrooms_above_grade, ' +
          'bathrooms_total_integer, parking_total, interior_tier, exterior_tier, basement_tier'
      )
      .gt('listing_key', cursor)
      .gte('close_date', windowStartIso)
      // raw_vow_sold mixes SOLD rows with LEASED ones (close_price = monthly rent,
      // ~$1.4k–$6k). Match the live anchor query's MIN_SALE_PRICE floor so leases
      // never enter the trend/offset medians — without it, the still-filling current
      // half-year bucket (few sales, many leases) flips to a lease-level median and
      // poisons g(now) for the whole cohort. (See anchorService.ts / types.ts.)
      .gte('close_price', MIN_SALE_PRICE)
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
    const backoff = Math.min(30000, 3000 * 2 ** (attempt - 1));
    console.warn(
      `   ⏳ Read ${isTimeout ? 'timed out' : 'errored'} at cursor "${cursor}" ` +
        `(attempt ${attempt}/${MAX_READ_RETRIES}): ${error.message} — backing off ${backoff}ms…`
    );
    await sleep(backoff);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('========================================');
  console.log('  Refresh avm_trend_index + avm_community_offset');
  console.log(`  Mode: ${APPLY ? 'APPLY (writing)' : 'DRY-RUN (no writes)'}`);
  if (Number.isFinite(ROW_LIMIT)) console.log(`  Row limit: ${ROW_LIMIT}`);
  console.log(`  Trend window: ${WINDOW_MONTHS} mo  ·  min/bucket: trend≥${MIN_TREND_SAMPLES} offset≥${MIN_OFFSET_SAMPLES}`);
  console.log('========================================\n');

  // Trailing window (close_date is the read filter — covers both purchase_contract
  // and close cadences; we choose the period bucket below from contract date when
  // available so trend is dated by deal-signing, not title-transfer).
  const windowStart = new Date();
  windowStart.setUTCMonth(windowStart.getUTCMonth() - WINDOW_MONTHS);
  const windowStartIso = windowStart.toISOString().slice(0, 10);
  console.log(`📅 Reading raw_vow_sold close_date >= ${windowStartIso}`);

  // 1) Preload matrices (one short query, kept in memory).
  console.log('📥 Loading avm_multiplier_matrix into memory…');
  const matrixIndex = await loadMatrices();
  console.log(
    `   ${matrixIndex.cohortCount} (city_region × sub_type) cohorts loaded ` +
      `(${matrixIndex.byKey.size} lookup keys after candidate expansion).\n`
  );
  if (matrixIndex.cohortCount === 0) {
    console.error('❌ No matrices found — aborting (nothing to feature-adjust against).');
    process.exit(1);
  }

  // 2) Stream raw_vow_sold, compute ℓ_i, accumulate L records.
  const records: LRecord[] = [];
  let cursor = '';
  let scanned = 0;
  let noMatrix = 0;
  let noPeriod = 0;
  let noCity = 0;
  let usable = 0;

  while (scanned < ROW_LIMIT) {
    const pageSize = Math.min(CHUNK_SIZE, ROW_LIMIT - scanned);
    let page: SoldRow[] | null;
    try {
      page = await readPage(cursor, pageSize, windowStartIso);
    } catch (e) {
      console.error(`❌ ${e instanceof Error ? e.message : String(e)}`);
      process.exitCode = 1;
      return;
    }
    if (!page || page.length === 0) {
      console.log('✅ Reached end of read window.');
      break;
    }

    for (const r of page) {
      scanned++;
      cursor = r.listing_key;

      const city = (r.city || '').trim();
      const cityRegion = (r.city_region || '').trim();
      const sub = normalizePropertySubType(r.property_sub_type);
      if (!city || !cityRegion || !sub) {
        noCity++;
        continue;
      }

      // Period is dated by contract signing when present (the actual market signal);
      // close_date is the legal transfer and lags by 30–90 days, which would smear
      // the half-year boundary.
      const dateIso = r.purchase_contract_date || r.close_date;
      if (!dateIso) {
        noPeriod++;
        continue;
      }
      const periodEnd = periodEndForDate(dateIso);

      const matrix = matrixIndex.byKey.get(`${cityRegion}||${sub}`);
      if (!matrix) {
        noMatrix++;
        continue;
      }

      const l = adjustedLogPrice(r, matrix);
      if (l === null) continue;

      records.push({ city, cityRegion, subType: sub, periodEnd, l });
      usable++;
    }

    if (scanned % 5000 === 0 || page.length < pageSize) {
      console.log(
        `   …scanned ${scanned}  usable=${usable}  no-matrix=${noMatrix}  no-period=${noPeriod}  no-city=${noCity}  last key=${cursor}`
      );
    }

    if (page.length < pageSize) {
      console.log('✅ Last page.');
      break;
    }
    await sleep(INTER_CHUNK_DELAY_MS);
  }

  console.log(
    `\nScanned ${scanned} sold rows  ·  feature-adjusted ${usable}  ·  skipped ${noMatrix} (no matrix), ${noPeriod} (no date), ${noCity} (missing keys)`
  );

  // 3) Aggregate trend index: (city, sub, period) → median(l).
  const trendBuckets = new Map<string, LBucket>(); // key: city||sub||period
  for (const rec of records) {
    const k = `${rec.city}||${rec.subType}||${rec.periodEnd}`;
    let b = trendBuckets.get(k);
    if (!b) {
      b = { values: [] };
      trendBuckets.set(k, b);
    }
    b.values.push(rec.l);
  }

  type TrendRow = {
    city: string;
    property_sub_type: string;
    period_end: string;
    level_log: number;
    n_sales: number;
  };
  const trendUpserts: TrendRow[] = [];
  for (const [k, b] of trendBuckets.entries()) {
    if (b.values.length < MIN_TREND_SAMPLES) continue;
    const [city, subType, periodEnd] = k.split('||');
    trendUpserts.push({
      city,
      property_sub_type: subType,
      period_end: periodEnd,
      level_log: median(b.values),
      n_sales: b.values.length,
    });
  }

  // 4) Community offset: for each record, δ_i = ℓ_i − g(city,sub,period); take
  //    median per (city_region, sub). g is the SAME median we just computed.
  const gIndex = new Map<string, number>(); // city||sub||period → level_log
  for (const t of trendUpserts) {
    gIndex.set(`${t.city}||${t.property_sub_type}||${t.period_end}`, t.level_log);
  }

  const offsetBuckets = new Map<string, LBucket>(); // city_region||sub → δ_i samples
  for (const rec of records) {
    const g = gIndex.get(`${rec.city}||${rec.subType}||${rec.periodEnd}`);
    if (g === undefined) continue; // bucket below MIN_TREND_SAMPLES → can't anchor
    const key = `${rec.cityRegion}||${rec.subType}`;
    let b = offsetBuckets.get(key);
    if (!b) {
      b = { values: [] };
      offsetBuckets.set(key, b);
    }
    b.values.push(rec.l - g);
  }

  type OffsetRow = {
    city_region: string;
    property_sub_type: string;
    delta_log: number;
    n_sales: number;
  };
  const offsetUpserts: OffsetRow[] = [];
  for (const [k, b] of offsetBuckets.entries()) {
    if (b.values.length < MIN_OFFSET_SAMPLES) continue;
    const [cityRegion, subType] = k.split('||');
    offsetUpserts.push({
      city_region: cityRegion,
      property_sub_type: subType,
      delta_log: median(b.values),
      n_sales: b.values.length,
    });
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('\n──────── Summary ────────');
  console.log(`Trend buckets (city × sub × period): ${trendBuckets.size}, qualified ${trendUpserts.length}`);
  console.log(`Offset buckets (city_region × sub): ${offsetBuckets.size}, qualified ${offsetUpserts.length}`);

  const trendSamples = trendUpserts
    .filter((t) => ['Brampton', 'Mississauga'].includes(t.city) && t.property_sub_type === 'Detached')
    .sort((a, b) => a.city.localeCompare(b.city) || a.period_end.localeCompare(b.period_end));
  if (trendSamples.length) {
    console.log('\nTrend probe (Brampton/Mississauga Detached):');
    for (const t of trendSamples) {
      console.log(
        `   ${t.city} ${t.period_end}  ℓ=${t.level_log.toFixed(4)} → ~$${Math.round(Math.exp(t.level_log)).toLocaleString()}  n=${t.n_sales}`
      );
    }
  }

  const offsetSamples = offsetUpserts
    .filter((o) => o.property_sub_type === 'Detached')
    .sort((a, b) => b.delta_log - a.delta_log);
  if (offsetSamples.length) {
    console.log('\nOffset probe (top + bottom 5 Detached communities):');
    for (const o of offsetSamples.slice(0, 5)) {
      console.log(`   +  ${o.city_region}  δ=${o.delta_log.toFixed(4)}  (~×${Math.exp(o.delta_log).toFixed(2)})  n=${o.n_sales}`);
    }
    for (const o of offsetSamples.slice(-5).reverse()) {
      console.log(`   −  ${o.city_region}  δ=${o.delta_log.toFixed(4)}  (~×${Math.exp(o.delta_log).toFixed(2)})  n=${o.n_sales}`);
    }
  }

  if (!APPLY) {
    console.log(
      `\n(DRY-RUN — would upsert ${trendUpserts.length} trend rows + ${offsetUpserts.length} offset rows. Re-run with --apply to persist.)`
    );
    return;
  }

  // ── Write ──────────────────────────────────────────────────────────────────
  let okT = 0, failT = 0;
  if (trendUpserts.length === 0) {
    console.log('\n(No qualified trend buckets — nothing to write.)');
  } else {
    console.log(`\n💾 Upserting ${trendUpserts.length} rows to avm_trend_index…`);
    for (let i = 0; i < trendUpserts.length; i += UPSERT_CHUNK) {
      const chunk = trendUpserts.slice(i, i + UPSERT_CHUNK);
      const { error } = await sb
        .from('avm_trend_index')
        .upsert(chunk, { onConflict: 'city,property_sub_type,period_end' });
      if (error) {
        failT += chunk.length;
        console.warn(`   ⚠️  trend chunk @${i} failed: ${error.message}`);
      } else {
        okT += chunk.length;
      }
      await sleep(INTER_CHUNK_DELAY_MS);
    }
    console.log(`   ✅ avm_trend_index: ${okT} upserted, ${failT} failed`);
  }

  let okO = 0, failO = 0;
  if (offsetUpserts.length === 0) {
    console.log('\n(No qualified offset cohorts — nothing to write.)');
  } else {
    console.log(`💾 Upserting ${offsetUpserts.length} rows to avm_community_offset…`);
    for (let i = 0; i < offsetUpserts.length; i += UPSERT_CHUNK) {
      const chunk = offsetUpserts.slice(i, i + UPSERT_CHUNK);
      const { error } = await sb
        .from('avm_community_offset')
        .upsert(chunk, { onConflict: 'city_region,property_sub_type' });
      if (error) {
        failO += chunk.length;
        console.warn(`   ⚠️  offset chunk @${i} failed: ${error.message}`);
      } else {
        okO += chunk.length;
      }
      await sleep(INTER_CHUNK_DELAY_MS);
    }
    console.log(`   ✅ avm_community_offset: ${okO} upserted, ${failO} failed`);
  }

  if (failT > 0 || failO > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error('CRASH:', e?.message || e);
  process.exit(1);
});
