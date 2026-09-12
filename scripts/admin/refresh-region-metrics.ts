/**
 * Refresh region_metrics — nightly precompute of the full base-scope /analytics payload.
 *
 * For each curated market, runs the whole 11-metric AnalyticsInitial (all-types, ZERO_SCOPE)
 * via computeAnalyticsInitial() and upserts it into region_metrics (migration 081), so the
 * default /analytics view (and the dashboard scorecard) read a single precomputed row instead
 * of running the batch — including the residual slow RPCs (avm-reliability, listing-outcomes)
 * — live on the request path. Custom type/scope views still compute live (now fast post-Tier-2).
 *
 * Sequential ACROSS MARKETS (mirrors refresh-market-summary): one market at a time, so the 15
 * markets never contend with each other. WITHIN a market it is not sequential —
 * computeAnalyticsInitial fires all 11 slice RPCs at once under Promise.allSettled. That is
 * the right shape (wall-clock is the slowest slice, ~23s for Ottawa, not the ~75s sum), but it
 * means each slice runs against 10 siblings, and anything holding a tight budget loses. Two
 * consequences, both of which bit in September 2026 and are handled here:
 *
 *   1. The CLIENT abort must clear the server budgets. supabase-js aborts at 30s by default
 *      while these RPCs carry 60-90s; the daily-sync step therefore sets
 *      SUPABASE_FETCH_TIMEOUT_MS=120000. Without it Ottawa lost 4-5 slices a night at exactly
 *      30.0s, and Toronto — 22.7-25.0s on a good night — crossed the same wall on a slow one.
 *   2. A failed slice must not DESTROY the good value it replaces. The upsert writes the whole
 *      payload, so one cancelled RPC blanked a live number on /data for 24h. See carryForward().
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
// Safe as a STATIC import, unlike @/lib/market/aggregates: pure rules, no Supabase client,
// nothing that reads env at module load.
import { carryForwardSlices, type Payload } from '@/lib/data/regionMetricsCarry';

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

// How long a slice may be carried forward from the previous snapshot before this job gives
// up and writes the null. The rule and the reasoning live in src/lib/data/regionMetricsCarry.ts.
const CARRY_MAX_HOURS = Number(process.env.REGION_METRICS_CARRY_MAX_HOURS) || undefined;

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

  // The snapshot this run replaces. Read UP FRONT, in one query, so carryForward() has the
  // last good value for a slice that fails tonight. A read failure is not fatal: the job
  // simply loses the safety net and behaves exactly as it did before.
  const prior = new Map<string, { payload: Payload; computedAt: string | null }>();
  {
    const { data, error } = await sb.from('region_metrics').select('region, payload, computed_at');
    if (error) {
      console.warn(`   ⚠️  could not read the prior snapshot (${error.message}) — carry-forward disabled this run`);
    } else {
      for (const r of (data ?? []) as { region: string; payload: Payload; computed_at: string | null }[]) {
        prior.set(r.region, { payload: r.payload, computedAt: r.computed_at });
      }
    }
  }

  for (const region of MARKETS) {
    const t = Date.now();
    try {
      const payload = await computeAnalyticsInitial(region, [], ZERO_SCOPE);
      if (!payload) {
        failures.push(`${region}: empty payload`);
        console.warn(`   ⚠️  ${region} produced no metrics — skipped`);
      } else {
        const p = payload as unknown as Payload;
        const nullSlices = SLICES.filter((s) => p[s] == null);
        const was = prior.get(region);
        const carried = carryForwardSlices({
          fresh: p,
          prior: was?.payload ?? null,
          priorComputedAt: was?.computedAt ?? null,
          nullSlices,
          nowMs: Date.now(),
          maxHours: CARRY_MAX_HOURS,
        });
        const lost = nullSlices.filter((s) => !carried.includes(s));

        rows.push({ region, payload, computed_at: new Date().toISOString() });

        let note = '';
        if (carried.length) note += `  ↺ carried forward: ${carried.join(', ')}`;
        if (lost.length) note += `  ⚠️ null slices: ${lost.join(', ')}`;
        console.log(`   ${region.padEnd(16)} ok  (${((Date.now() - t) / 1000).toFixed(1)}s)${note}`);

        // A carried slice is still a failed slice. It must keep the run non-zero, or the
        // safety net becomes a way to hide the very failure it is papering over.
        if (carried.length) failures.push(`${region}: carried forward (${carried.join(', ')})`);
        if (lost.length) failures.push(`${region}: null slices (${lost.join(', ')})`);
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
