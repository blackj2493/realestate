/**
 * One-time warm-pass: correct True DOM for the EXISTING active inventory.
 *
 * BOUNDED to likely-relists — actives whose property_hash already shows prior
 * campaigns in our data (appears >1× in `listings`, or present in
 * `property_sale_history`). Non-relisted actives already have a correct True DOM
 * (= their own age), so we skip them to spare the TRREB feed (CLAUDE.md §4).
 *
 * PACED (inter-call delay), DRY-RUN by default, RESUMABLE (keyset cursor on
 * listing_key). For each target: refreshCampaignHistoryForListing (populates the
 * ledger via the VOW feed) → collect the corrected TrueDom → batch-update Typesense.
 *
 * Usage:
 *   npx tsx scripts/admin/warmCampaignHistory.ts                      # DRY-RUN: count + sample, no feed calls, no writes
 *   npx tsx scripts/admin/warmCampaignHistory.ts --sample 25          # fetch+compute 25 targets, print before/after TrueDom, no Typesense write
 *   npx tsx scripts/admin/warmCampaignHistory.ts --apply --limit 500  # apply, bounded
 *   npx tsx scripts/admin/warmCampaignHistory.ts --apply              # full bounded run (likely-relists only), paced
 *
 * DATABASE_URL must be the Supabase Session pooler string (CLAUDE.md §12 — not the
 * direct IPv6-only host). The pg connection is ONLY for the enumeration SELECT;
 * the campaign-ledger refresh uses the Supabase JS client.
 */

// MUST set TLS env var BEFORE importing the supabase client.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { Client as PgClient } from 'pg';
import * as https from 'https';
import crossFetch from 'cross-fetch';
import dotenv from 'dotenv';
import Typesense from 'typesense';

// Load env (mirrors refresh-property-sale-history.ts / backfill020.ts pattern).
dotenv.config({ path: ['.env.local', '.env'] });

// Patch global fetch with a TLS-relaxed agent so the Supabase JS client works
// from this script context (matches refresh-property-sale-history.ts).
const agent = new https.Agent({ rejectUnauthorized: false });
(global as unknown as { fetch: typeof fetch }).fetch = ((url: RequestInfo | URL, init?: RequestInit) =>
  // @ts-expect-error agent is a node-fetch option, not standard
  crossFetch(url, { ...init, agent })) as typeof fetch;

// Import AFTER the TLS + fetch patches.
import { getServiceRoleClient } from '@/lib/supabase/client';
import { refreshCampaignHistoryForListing } from '@/lib/campaignHistory/store';
import { normalizeCampaign, type RawVowCampaign } from '@/lib/campaignHistory/normalize';
import { generatePropertyHash } from '@/lib/typesense/TemporalDistressEngine';

// ── Typesense admin client (mirrors sync.ts — getAdminClient is not exported, so replicate it here) ──
const TYPESENSE_HOST = '9uyapwh6e5qmvl34p-1.a1.typesense.net';
const TYPESENSE_PORT = 443;

function buildTypesenseAdminClient() {
  const key = (process.env.TYPESENSE_ADMIN_API_KEY || '').trim();
  if (!key) throw new Error('TYPESENSE_ADMIN_API_KEY is not set in environment');
  return new Typesense.Client({
    nodes: [{ host: TYPESENSE_HOST, port: TYPESENSE_PORT, protocol: 'https' }],
    apiKey: key,
    connectionTimeoutSeconds: 10,
  });
}

// ── CLI flags ──────────────────────────────────────────────────────────────────
const APPLY = process.argv.includes('--apply');

const sampleIdx = process.argv.indexOf('--sample');
const SAMPLE = sampleIdx !== -1 ? parseInt(process.argv[sampleIdx + 1] ?? '0', 10) : 0;

const limitIdx = process.argv.indexOf('--limit');
const LIMIT = limitIdx !== -1 ? parseInt(process.argv[limitIdx + 1] ?? '0', 10) : 0; // 0 = no limit

// ── Pacing constants (TRREB feed + Disk IO budget) ────────────────────────────
const DELAY_MS = 250;       // inter-listing pause (feed-friendly, CLAUDE.md §4)
const REINDEX_CHUNK = 100;  // Typesense partial-update batch size
const REINDEX_DELAY_MS = 200;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const cs = (process.env.DATABASE_URL || '').trim();
  if (!cs) {
    console.error('❌ DATABASE_URL (session pooler) required — set it to the Supabase Session pooler string (CLAUDE.md §12)');
    process.exit(1);
  }

  console.log('========================================');
  console.log('  warmCampaignHistory — True DOM warm-pass');
  const mode = APPLY ? 'APPLY' : SAMPLE > 0 ? `SAMPLE (${SAMPLE})` : 'DRY-RUN (count only)';
  console.log(`  Mode: ${mode}`);
  if (APPLY && LIMIT > 0) console.log(`  Limit: ${LIMIT}`);
  console.log('========================================\n');

  // pg is ONLY for the enumeration SELECT (CLAUDE.md §12).
  const pg = new PgClient({
    connectionString: cs,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });
  await pg.connect();
  await pg.query("SET statement_timeout TO '0'");
  console.log('   pg connected (enumeration)\n');

  // ── Count query (DRY-RUN + sizing for all modes) ────────────────────────────
  // Uses the same NOT-IN predicate as the existing idx_listings_active_city_lower
  // partial index so Postgres can use an index scan rather than a full JSONB detoast.
  // StandardStatus='Active' rows pass because they are NOT in the terminal-status list.
  const NON_ACTIVE_SQL =
    `lower(coalesce(full_payload->>'Status', full_payload->>'MlsStatus', full_payload->>'StandardStatus', ''))` +
    ` NOT IN ('sold','closed','closed sale','leased','terminated','expired','suspended')`;

  const COUNT_SQL = `
    WITH active AS (
      SELECT listing_key, property_hash
      FROM listings
      WHERE property_hash IS NOT NULL AND property_hash <> ''
        AND ${NON_ACTIVE_SQL}
    ),
    multi AS (
      SELECT property_hash FROM active GROUP BY property_hash HAVING count(*) > 1
    )
    SELECT COUNT(*) AS cnt
    FROM active a
    WHERE a.property_hash IN (SELECT property_hash FROM multi)
       OR a.property_hash IN (SELECT property_hash FROM property_sale_history);
  `;

  const { rows: countRows } = await pg.query<{ cnt: string }>(COUNT_SQL);
  const totalTargets = parseInt(countRows[0]?.cnt ?? '0', 10);
  console.log(`Likely-relist active targets: ${totalTargets}`);

  // DRY-RUN (no --sample, no --apply): print count and exit without any feed calls.
  if (!APPLY && SAMPLE === 0) {
    console.log('(DRY-RUN — counts only; no feed calls, no writes.)');
    console.log('Re-run with --sample N to validate a subset, or --apply to reindex.');
    await pg.end();
    process.exit(0);
  }

  // ── Full enumeration for processing phases ─────────────────────────────────
  // Load full_payload only when we need to actually process records (--sample / --apply).
  // ORDER BY listing_key makes this resumable (keyset cursor for future incremental runs).
  const maxRows = SAMPLE > 0 ? SAMPLE : LIMIT > 0 ? LIMIT : totalTargets;
  const FULL_SQL = `
    WITH active AS (
      SELECT listing_key, property_hash, full_payload
      FROM listings
      WHERE property_hash IS NOT NULL AND property_hash <> ''
        AND ${NON_ACTIVE_SQL}
    ),
    multi AS (
      SELECT property_hash FROM active GROUP BY property_hash HAVING count(*) > 1
    )
    SELECT a.listing_key, a.full_payload
    FROM active a
    WHERE a.property_hash IN (SELECT property_hash FROM multi)
       OR a.property_hash IN (SELECT property_hash FROM property_sale_history)
    ORDER BY a.listing_key
    LIMIT $1;
  `;

  console.log(`Loading up to ${maxRows} target rows (full_payload)…`);
  const { rows: workSlice } = await pg.query<{ listing_key: string; full_payload: Record<string, unknown> }>(
    FULL_SQL,
    [maxRows]
  );

  const supabase = getServiceRoleClient();
  const vowToken = (process.env.PROPTX_VOW_TOKEN || '').trim() || undefined;
  const nowMs = Date.now();

  if (!vowToken) {
    console.warn('⚠️  PROPTX_VOW_TOKEN not set — campaign refresh will serve cached ledger rows only (no feed fetch).');
  }

  const updates: { id: string; TrueDom: number }[] = [];
  let processed = 0;
  let corrected = 0;
  let errors = 0;

  for (const r of workSlice) {
    const raw = r.full_payload as Record<string, unknown>;
    const propertyHash = generatePropertyHash(raw);

    try {
      const row = await refreshCampaignHistoryForListing(supabase, {
        propertyHash,
        addr: {
          StreetNumber: raw['StreetNumber'],
          StreetName: raw['StreetName'],
          City: raw['City'],
          UnitNumber: raw['UnitNumber'],
          PropertySubType: raw['PropertySubType'],
        },
        subjectEvent: normalizeCampaign(raw as RawVowCampaign),
        vowToken,
        nowMs,
      });

      const prevDom = typeof raw['true_dom'] === 'number' ? (raw['true_dom'] as number) : null;

      if (row) {
        if (SAMPLE > 0) {
          console.log(
            `  ${r.listing_key}: true_dom ${prevDom ?? '—'} → ${row.true_dom}` +
            ` (campaigns ${row.campaign_count}${row.is_stale ? ', stale' : ''})`
          );
        }
        updates.push({ id: r.listing_key, TrueDom: row.true_dom });
        if (prevDom !== row.true_dom) corrected++;
      }
    } catch (e) {
      errors++;
      console.warn(`  ⚠️  ${r.listing_key}: ${(e as Error)?.message ?? e}`);
    }

    processed++;
    if (processed % 100 === 0) {
      console.log(`   …${processed}/${workSlice.length} (corrected ${corrected}, errors ${errors})`);
    }
    await sleep(DELAY_MS);
  }

  console.log(`\nProcessed: ${processed}`);
  console.log(`Corrected (true_dom changed): ${corrected}`);
  console.log(`Errors (per-listing, non-fatal): ${errors}`);
  console.log(`Typesense updates queued: ${updates.length}`);

  // --sample mode: print summary only, no Typesense write.
  if (!APPLY) {
    console.log('\n(--sample mode: no Typesense write. Re-run with --apply to reindex.)');
    await pg.end();
    process.exit(0);
  }

  // --apply: batch-update Typesense TrueDom (partial update, id = listing_key).
  if (updates.length === 0) {
    console.log('\n✅ No Typesense updates needed.');
    await pg.end();
    process.exit(0);
  }

  console.log(`\n🔍 Reindexing Typesense TrueDom for ${updates.length} documents (partial update)…`);
  const tsAdmin = buildTypesenseAdminClient();
  let tsOk = 0;
  let tsFailed = 0;

  for (let i = 0; i < updates.length; i += REINDEX_CHUNK) {
    const chunk = updates.slice(i, i + REINDEX_CHUNK);
    try {
      const res = await tsAdmin.collections('properties').documents().import(chunk, { action: 'update' });
      // import() returns an array of per-doc result objects.
      const results: Array<{ success: boolean; error?: string }> = Array.isArray(res)
        ? res
        : (JSON.parse(res as unknown as string) as Array<{ success: boolean; error?: string }>);
      for (const x of results) {
        if (x.success) tsOk++;
        else {
          tsFailed++;
          if (x.error) console.warn(`   Typesense doc error: ${x.error}`);
        }
      }
    } catch (e) {
      tsFailed += chunk.length;
      console.warn(`   ⚠️  reindex chunk @${i} failed: ${(e as Error)?.message ?? e}`);
    }
    await sleep(REINDEX_DELAY_MS);
  }

  console.log(`\n✅ Typesense TrueDom reindex: ${tsOk} ok, ${tsFailed} failed`);

  await pg.end();

  if (tsFailed > 0) {
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('CRASH:', e?.message ?? e);
  process.exit(1);
});
