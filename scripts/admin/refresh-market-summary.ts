/**
 * Refresh market_summary — nightly precompute of base-scope market aggregates.
 *
 * Runs region_active_aggregates + region_price_trend (NO filters) once per market and
 * upserts the result into market_summary, so the Submarket Leaderboard / Region Scorecard
 * read a ready-made row instead of running those ~43s RPCs live on the request path.
 *
 * Sequential by design: the leaderboard's old client-side Promise.all fired all 15 markets
 * at once, which made them contend and hit the 60s statement_timeout (Toronto got cancelled).
 * One-at-a-time, each completes well under the 60s server cap. This client uses Node's native
 * fetch with NO 30s timeout wrapper (cf. src/lib/supabase/client.ts), so a slow market that
 * the APP can't wait for still finishes here.
 *
 * Usage:
 *   npx tsx scripts/admin/refresh-market-summary.ts            # dry-run (no writes)
 *   npx tsx scripts/admin/refresh-market-summary.ts --apply    # write market_summary
 */

// MUST set TLS env var BEFORE importing the supabase client (mirrors the other refresh jobs).
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { REGION_TO_CITIES, citiesFromRegions } from '@/lib/dashboard/config';

// Load env for standalone/local runs (.env.local, .env). In CI the daily-sync workflow
// supplies these via `env:`; dotenv never overrides an already-present process.env value.
dotenv.config({ path: ['.env.local', '.env'] });

const APPLY = process.argv.includes('--apply');

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

// Plain client — native fetch, NO 30s timeoutFetch wrapper, so the slow base RPCs (Toronto
// ~43s) complete (bounded only by the functions' own 60s statement_timeout).
const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const num = (v: unknown): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// Every market the dashboard curates (incl. Ottawa — fixed by migration 047). The
// leaderboard route applies its own EXCLUDED_MARKETS filter on read.
const MARKETS = citiesFromRegions(Object.keys(REGION_TO_CITIES));

interface SummaryRow {
  region: string;
  active_count: number | null;
  stale_count: number | null;
  cap_sample: number | null;
  median_cap_rate: number | null;
  avg_cap_rate: number | null;
  top_cap_rate: number | null;
  trend: unknown;
  computed_at: string;
}

async function computeRegion(region: string): Promise<SummaryRow> {
  const t = Date.now();
  // 1) Active-inventory scalars (base scope — no filters).
  const { data: statsData, error: statsErr } = await sb.rpc('region_active_aggregates', {
    p_region: region, p_subtypes: null, p_min_beds: 0, p_min_baths: 0,
    p_min_parking: 0, p_min_frontage: 0, p_basement: 'any',
  });
  if (statsErr) throw new Error(`active_aggregates: ${statsErr.message}`);
  const s = Array.isArray(statsData) ? statsData[0] : statsData;

  // 2) Sold price-trend (base scope, 24mo).
  const { data: trend, error: trendErr } = await sb.rpc('region_price_trend', {
    p_region: region, p_subtypes: null, p_min_beds: 0, p_min_baths: 0,
    p_min_parking: 0, p_min_frontage: 0, p_months: 24, p_basement: 'any',
  });
  if (trendErr) throw new Error(`price_trend: ${trendErr.message}`);

  const active = num(s?.active_count) ?? 0;
  console.log(`   ${region.padEnd(16)} active=${String(active).padStart(6)}  (${((Date.now() - t) / 1000).toFixed(1)}s)`);

  return {
    region,
    active_count: active,
    stale_count: num(s?.stale_count) ?? 0,
    cap_sample: num(s?.cap_sample) ?? 0,
    median_cap_rate: num(s?.median_cap_rate),
    avg_cap_rate: num(s?.avg_cap_rate),
    top_cap_rate: num(s?.top_cap_rate),
    trend: trend ?? null,
    computed_at: new Date().toISOString(),
  };
}

async function main() {
  console.log('========================================');
  console.log('  Refresh market_summary (base scope)');
  console.log(`  Mode: ${APPLY ? 'APPLY (writing)' : 'DRY-RUN (no writes)'}`);
  console.log(`  Markets: ${MARKETS.length}`);
  console.log('========================================\n');

  const rows: SummaryRow[] = [];
  const failures: string[] = [];

  // Sequential — never fan out (that contention is the bug we're fixing).
  for (const region of MARKETS) {
    try {
      rows.push(await computeRegion(region));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      failures.push(`${region}: ${msg}`);
      console.warn(`   ⚠️  ${region} failed: ${msg}`);
    }
    await sleep(250); // gentle gap between markets
  }

  console.log(`\n──────── Summary ────────`);
  console.log(`Computed: ${rows.length}/${MARKETS.length}  (failures: ${failures.length})`);
  failures.forEach((f) => console.log(`   ✗ ${f}`));

  if (!APPLY) {
    console.log(`\n(DRY-RUN — ${rows.length} rows would be upserted. Re-run with --apply to persist.)`);
    return;
  }
  if (rows.length === 0) {
    console.error('❌ Nothing computed — refusing to write. (Leaves the last good snapshot intact.)');
    process.exitCode = 1;
    return;
  }

  console.log(`\n💾 Upserting ${rows.length} rows to market_summary…`);
  const { error } = await sb.from('market_summary').upsert(rows, { onConflict: 'region' });
  if (error) {
    console.error(`   ❌ upsert failed: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  console.log(`   ✅ market_summary refreshed (${rows.length} markets).`);
  if (failures.length > 0) process.exitCode = 1; // surface partial failure to the orchestrator
}

main().catch((e) => {
  console.error('CRASH:', e?.message || e);
  process.exit(1);
});
