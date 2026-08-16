/**
 * Refresh region_metrics — nightly precompute of the full base-scope /analytics payload.
 *
 * For each curated market, runs the whole 11-metric AnalyticsInitial (all-types, ZERO_SCOPE)
 * via computeAnalyticsInitial() and upserts it into region_metrics (migration 081), so the
 * default /analytics view (and the dashboard scorecard) read a single precomputed row instead
 * of running the batch — including the residual slow RPCs (avm-reliability, listing-outcomes)
 * — live on the request path. Custom type/scope views still compute live (now fast post-Tier-2).
 *
 * Sequential by design (mirrors refresh-market-summary): one market at a time keeps each RPC
 * under its 60s statement_timeout instead of fanning out and contending.
 *
 * NOTE: `@/lib/market/aggregates` (and its service-role Supabase client) is imported DYNAMICALLY
 * inside main(), AFTER dotenv runs — a static import hoists above dotenv.config() and would
 * initialize the client with no env, making every RPC fail (empty payloads).
 *
 * Usage:
 *   npx tsx scripts/admin/refresh-region-metrics.ts            # dry-run (no writes)
 *   npx tsx scripts/admin/refresh-region-metrics.ts --apply    # write region_metrics
 */

// MUST set TLS env var before the supabase client is (dynamically) imported (mirrors the
// other refresh jobs).
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// In CI the daily-sync workflow supplies env via `env:`; dotenv never overrides a present value.
dotenv.config({ path: ['.env.local', '.env'] });

const APPLY = process.argv.includes('--apply');
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

interface MetricsRow {
  region: string;
  payload: unknown;
  computed_at: string;
}

async function main() {
  // Dynamic import AFTER dotenv/TLS (see file header) so the app service-role client picks up env.
  const { REGION_TO_CITIES, citiesFromRegions } = await import('@/lib/dashboard/config');
  const { computeAnalyticsInitial, ZERO_SCOPE } = await import('@/lib/market/aggregates');

  // Every market the dashboard curates (same set market_summary precomputes).
  const MARKETS = citiesFromRegions(Object.keys(REGION_TO_CITIES));

  console.log('========================================');
  console.log('  Refresh region_metrics (base scope)');
  console.log(`  Mode: ${APPLY ? 'APPLY (writing)' : 'DRY-RUN (no writes)'}`);
  console.log(`  Markets: ${MARKETS.length}`);
  console.log('========================================\n');

  const rows: MetricsRow[] = [];
  const failures: string[] = [];
  // computeAnalyticsInitial swallows per-slice rejections into nulls (Promise.allSettled),
  // so a region can print "ok" while a slice silently vanished — exactly how Ottawa's
  // outcomes went null on 2026-07-26 with "failures: 0". Name the null slices in the log.
  const SLICES = [
    'trend', 'stats', 'dom', 'cuts', 'dynamics', 'rental',
    'avm', 'inventory', 'seasonality', 'outcomes', 'ledger',
  ] as const;

  for (const region of MARKETS) {
    const t = Date.now();
    try {
      const payload = await computeAnalyticsInitial(region, [], ZERO_SCOPE);
      if (!payload) {
        failures.push(`${region}: empty payload`);
        console.warn(`   ⚠️  ${region} produced no metrics — skipped`);
      } else {
        rows.push({ region, payload, computed_at: new Date().toISOString() });
        const nullSlices = SLICES.filter((s) => (payload as unknown as Record<string, unknown>)[s] == null);
        const note = nullSlices.length ? `  ⚠️ null slices: ${nullSlices.join(', ')}` : '';
        console.log(`   ${region.padEnd(16)} ok  (${((Date.now() - t) / 1000).toFixed(1)}s)${note}`);
        if (nullSlices.length) failures.push(`${region}: null slices (${nullSlices.join(', ')})`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      failures.push(`${region}: ${msg}`);
      console.warn(`   ⚠️  ${region} failed: ${msg}`);
    }
    await sleep(250);
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

  console.log(`\n💾 Upserting ${rows.length} rows to region_metrics…`);
  const { error } = await sb.from('region_metrics').upsert(rows, { onConflict: 'region' });
  if (error) {
    console.error(`   ❌ upsert failed: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  console.log(`   ✅ region_metrics refreshed (${rows.length} markets).`);
  if (failures.length > 0) process.exitCode = 1; // surface partial failure to the orchestrator
}

main().catch((e) => {
  console.error('CRASH:', e?.message || e);
  process.exit(1);
});
