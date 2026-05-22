/**
 * Shadow MLS — Backfill interior / exterior / basement tiers on raw_vow_sold.
 *
 * The condition tiers (interior_tier 1-5, exterior_tier 1-5, basement_tier 1-9)
 * were never populated historically — the ETL read RESO fields that don't exist.
 * This back-scores every existing row deterministically from the structured
 * fields stored in raw_payload, using the SAME shared logic the daily sync now
 * uses (src/lib/avm/conditionScoring.ts). No LLM, no schema change (CLAUDE.md §4/§12).
 *
 * IO-FRUGAL (cf. 2026-05-19 Disk IO Budget incident — see memory supabase-io-budget):
 *   - reads ONLY the five small JSONB sub-keys it needs, never the full raw_payload
 *   - keyset pagination on listing_key (no slow OFFSET on a 217k table)
 *   - tiny writes (3 int columns) via per-row UPDATE (partial upsert would trip
 *     raw_vow_sold's NOT NULL columns), bounded concurrency, inter-chunk delay
 *   - resumable: persists a cursor so a crash / --limit run continues where it left off
 *
 * Usage:
 *   npx.cmd tsx --env-file=.env scripts/admin/backfill-condition-tiers.ts                 # dry-run (no writes)
 *   npx.cmd tsx --env-file=.env scripts/admin/backfill-condition-tiers.ts --limit 1000    # dry-run, first 1000
 *   npx.cmd tsx --env-file=.env scripts/admin/backfill-condition-tiers.ts --apply         # write, full table
 *   npx.cmd tsx --env-file=.env scripts/admin/backfill-condition-tiers.ts --apply --resume # continue from cursor
 */

// MUST set TLS env var BEFORE importing the supabase client.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { createClient } from '@supabase/supabase-js';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import crossFetch from 'cross-fetch';
import {
  deriveInteriorTier,
  deriveExteriorTier,
  deriveBasementTier,
} from '@/lib/avm/conditionScoring';

// Patch global fetch with a TLS-relaxed agent for the Supabase client.
const agent = new https.Agent({ rejectUnauthorized: false });
(global as unknown as { fetch: typeof fetch }).fetch = ((url: RequestInfo | URL, init?: RequestInit) =>
  // @ts-expect-error agent is a node-fetch option, not standard
  crossFetch(url, { ...init, agent })) as typeof fetch;

// ── CLI flags ────────────────────────────────────────────────────────────────
const APPLY = process.argv.includes('--apply');
const RESUME = process.argv.includes('--resume');
const limitArg = process.argv.find((a) => a.startsWith('--limit'));
const ROW_LIMIT = limitArg
  ? parseInt(limitArg.includes('=') ? limitArg.split('=')[1] : process.argv[process.argv.indexOf(limitArg) + 1], 10)
  : Infinity;

// ── IO pacing (deliberately gentle) ──────────────────────────────────────────
const CHUNK_SIZE = 500; // light rows per read page (only 5 JSONB sub-keys each)
const UPDATE_CONCURRENCY = 8; // in-flight single-row UPDATEs (tiny writes by PK)
const INTER_CHUNK_DELAY_MS = 200; // idle gap between pages to let IO budget refill

const CURSOR_FILE = path.join(process.cwd(), 'scripts', 'admin', '.backfill-tiers-cursor.json');

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

// Re-assemble the minimal payload shape the scorers read from the aliased select.
interface ScoringRow {
  listing_key: string;
  interiorFeatures: unknown;
  constructionMaterials: unknown;
  poolFeatures: unknown;
  exteriorFeatures: unknown;
  basement: unknown;
  waterfrontYN: unknown;
  waterfront: unknown;
  coveredSpaces: unknown;
}

function scorePayload(row: ScoringRow) {
  const payload = {
    InteriorFeatures: row.interiorFeatures,
    ConstructionMaterials: row.constructionMaterials,
    PoolFeatures: row.poolFeatures,
    ExteriorFeatures: row.exteriorFeatures,
    Basement: row.basement,
    WaterfrontYN: row.waterfrontYN,
    Waterfront: row.waterfront,
    CoveredSpaces: row.coveredSpaces,
  };
  return {
    interior_tier: deriveInteriorTier(payload),
    exterior_tier: deriveExteriorTier(payload),
    basement_tier: deriveBasementTier(payload),
  };
}

function readCursor(): string {
  if (RESUME && fs.existsSync(CURSOR_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(CURSOR_FILE, 'utf8')).cursor || '';
    } catch {
      return '';
    }
  }
  return '';
}

function writeCursor(cursor: string, processed: number) {
  fs.writeFileSync(CURSOR_FILE, JSON.stringify({ cursor, processed, ts: new Date().toISOString() }, null, 2));
}

// Bounded-concurrency runner for the per-row UPDATEs.
async function applyUpdates(
  updates: { listing_key: string; interior_tier: number; exterior_tier: number; basement_tier: number }[]
): Promise<{ ok: number; failed: number; errors: string[] }> {
  const result = { ok: 0, failed: 0, errors: [] as string[] };
  let idx = 0;
  async function worker() {
    while (idx < updates.length) {
      const u = updates[idx++];
      const { error } = await sb
        .from('raw_vow_sold')
        .update({ interior_tier: u.interior_tier, exterior_tier: u.exterior_tier, basement_tier: u.basement_tier })
        .eq('listing_key', u.listing_key);
      if (error) {
        result.failed++;
        if (result.errors.length < 5) result.errors.push(`${u.listing_key}: ${error.message}`);
      } else {
        result.ok++;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(UPDATE_CONCURRENCY, updates.length) }, worker));
  return result;
}

async function main() {
  console.log('========================================');
  console.log('  Backfill condition tiers — raw_vow_sold');
  console.log(`  Mode: ${APPLY ? 'APPLY (writing)' : 'DRY-RUN (no writes)'}`);
  if (Number.isFinite(ROW_LIMIT)) console.log(`  Row limit: ${ROW_LIMIT}`);
  if (RESUME) console.log('  Resuming from saved cursor');
  console.log('========================================\n');

  let cursor = readCursor();
  if (cursor) console.log(`▶️  Starting after listing_key > "${cursor}"\n`);

  let processed = 0;
  let updatedOk = 0;
  let updateFailed = 0;
  const dist = { interior: new Map<number, number>(), exterior: new Map<number, number>(), basement: new Map<number, number>() };
  const bump = (m: Map<number, number>, k: number) => m.set(k, (m.get(k) || 0) + 1);
  const samples: string[] = [];

  while (processed < ROW_LIMIT) {
    const pageSize = Math.min(CHUNK_SIZE, ROW_LIMIT - processed);
    const { data, error } = await sb
      .from('raw_vow_sold')
      .select(
        'listing_key, ' +
          'interiorFeatures:raw_payload->InteriorFeatures, ' +
          'constructionMaterials:raw_payload->ConstructionMaterials, ' +
          'poolFeatures:raw_payload->PoolFeatures, ' +
          'exteriorFeatures:raw_payload->ExteriorFeatures, ' +
          'basement:raw_payload->Basement, ' +
          'waterfrontYN:raw_payload->WaterfrontYN, ' +
          'waterfront:raw_payload->Waterfront, ' +
          'coveredSpaces:raw_payload->CoveredSpaces'
      )
      .gt('listing_key', cursor)
      .order('listing_key', { ascending: true })
      .limit(pageSize);

    if (error) {
      console.error(`❌ Read failed at cursor "${cursor}": ${error.message}`);
      process.exitCode = 1;
      break;
    }
    if (!data || data.length === 0) {
      console.log('✅ Reached end of table.');
      break;
    }

    const rows = data as unknown as ScoringRow[];
    const updates = rows.map((r) => {
      const tiers = scorePayload(r);
      bump(dist.interior, tiers.interior_tier);
      bump(dist.exterior, tiers.exterior_tier);
      bump(dist.basement, tiers.basement_tier);
      if (samples.length < 8) {
        samples.push(`   ${r.listing_key}  int=${tiers.interior_tier} ext=${tiers.exterior_tier} bsmt=${tiers.basement_tier}`);
      }
      return { listing_key: r.listing_key, ...tiers };
    });

    if (APPLY) {
      const res = await applyUpdates(updates);
      updatedOk += res.ok;
      updateFailed += res.failed;
      if (res.errors.length) res.errors.forEach((e) => console.warn(`   ⚠️  ${e}`));
    }

    processed += rows.length;
    cursor = rows[rows.length - 1].listing_key;
    if (APPLY) writeCursor(cursor, processed);

    console.log(
      `   …${processed} processed${APPLY ? ` (${updatedOk} ok, ${updateFailed} failed)` : ''} — last key ${cursor}`
    );

    if (rows.length < pageSize) {
      console.log('✅ Last page.');
      break;
    }
    await sleep(INTER_CHUNK_DELAY_MS);
  }

  const fmt = (m: Map<number, number>) =>
    [...m.entries()].sort((a, b) => a[0] - b[0]).map(([k, n]) => `${k}:${n}`).join('  ');

  console.log('\n──────── Summary ────────');
  console.log(`Processed:        ${processed}`);
  if (APPLY) console.log(`Updated:          ${updatedOk} ok, ${updateFailed} failed`);
  console.log(`interior_tier →   ${fmt(dist.interior)}`);
  console.log(`exterior_tier →   ${fmt(dist.exterior)}`);
  console.log(`basement_tier →   ${fmt(dist.basement)}`);
  console.log('\nSample rows:');
  samples.forEach((s) => console.log(s));
  if (!APPLY) console.log('\n(DRY-RUN — no rows written. Re-run with --apply to persist.)');
}

main().catch((e) => {
  console.error('CRASH:', e?.message || e);
  process.exit(1);
});
