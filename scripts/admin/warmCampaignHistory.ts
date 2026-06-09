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

// Import AFTER the TLS + fetch patches. NOTE: @/lib/supabase/client captures
// SUPABASE_SERVICE_ROLE_KEY at MODULE LOAD, and static ESM imports hoist ABOVE the
// top-level dotenv.config() — so it is imported DYNAMICALLY in main() (after dotenv
// has populated process.env) to avoid capturing an empty key. The modules below read
// no env at load (verified), so static import is safe.
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

// Mutual exclusion: --sample is a NO-WRITE validation mode. With --apply present, the
// downstream `if (!APPLY)` no-write guard is skipped, so --apply --sample would WRITE
// while looking like a dry validation. Reject the combo up front.
if (APPLY && SAMPLE > 0) {
  console.error('❌ --apply and --sample are mutually exclusive. Use --apply --limit N for a bounded apply.');
  process.exit(1);
}

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

  // ── Enumeration (likely-relist actives) ─────────────────────────────────────
  // relist_hashes = addresses with >1 campaign in `listings` (Index-Only Scan on
  // idx_listings_property_hash) UNION any present in property_sale_history (PK
  // Index-Only Scan). The property_hash side is cheap. The cost is the active-status
  // filter: there is NO index covering `full_payload->>'StandardStatus'` on its own
  // (only idx_listings_active_city_lower, a partial btree keyed on lower(city)), so
  // Postgres seq-scans + detoasts full_payload across all ~136k listings rows to apply
  // it — this is the dominant cost and is IO-bound-slow on this instance (~5 min;
  // CLAUDE.md §12 / supabase-io-budget). Reordering can't avoid it without a new
  // partial index on the active-status expression (a migration, out of scope here).
  // statement_timeout is disabled above so the scan can run to completion.
  const RELIST_HASHES_CTE = `
    relist_hashes AS (
      SELECT property_hash FROM listings
      WHERE property_hash IS NOT NULL AND property_hash <> ''
      GROUP BY property_hash HAVING count(*) > 1
      UNION
      SELECT property_hash FROM property_sale_history
    )`;
  const ACTIVE_PREDICATE = `lower(coalesce(full_payload->>'StandardStatus','')) = 'active'`;

  // DRY-RUN count: same narrowed-first + active-filtered set, COUNT only (no full_payload).
  const COUNT_SQL = `
    WITH ${RELIST_HASHES_CTE}
    SELECT count(*) AS cnt
    FROM listings
    WHERE property_hash IN (SELECT property_hash FROM relist_hashes)
      AND ${ACTIVE_PREDICATE};
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

  // ── Full enumeration for processing phases (--sample / --apply) ─────────────
  // Loads true_dom (the Postgres column — NOT in full_payload) so before/after is real,
  // plus full_payload for the hash + address. Same relist-first narrowing as the count.
  // ORDER BY listing_key makes this resumable (keyset cursor for future incremental runs).
  const maxRows = SAMPLE > 0 ? SAMPLE : LIMIT > 0 ? LIMIT : totalTargets;
  const FULL_SQL = `
    WITH ${RELIST_HASHES_CTE}
    SELECT listing_key, true_dom, full_payload
    FROM listings
    WHERE property_hash IN (SELECT property_hash FROM relist_hashes)
      AND ${ACTIVE_PREDICATE}
    ORDER BY listing_key
    LIMIT $1;
  `;

  console.log(`Loading up to ${maxRows} target rows (full_payload)…`);
  const { rows: workSlice } = await pg.query<{
    listing_key: string;
    true_dom: number | null;
    full_payload: Record<string, unknown>;
  }>(FULL_SQL, [maxRows]);

  // Dynamic import so client.ts reads SUPABASE_SERVICE_ROLE_KEY AFTER dotenv.config()
  // populated it (static ESM imports hoist above the top-level dotenv call → empty key).
  const { getServiceRoleClient } = await import('@/lib/supabase/client');
  const supabase = getServiceRoleClient();
  const vowToken = (process.env.PROPTX_VOW_TOKEN || '').trim() || undefined;
  const nowMs = Date.now();

  if (!vowToken) {
    console.warn('⚠️  PROPTX_VOW_TOKEN not set — campaign refresh will serve cached ledger rows only (no feed fetch).');
  }

  // Build the Typesense admin client BEFORE the feed loop under --apply, so a missing
  // TYPESENSE_ADMIN_API_KEY fails fast instead of burning the whole VOW feed run first.
  const tsAdmin = APPLY ? buildTypesenseAdminClient() : null;

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

      // prevDom is the existing true_dom Postgres COLUMN (never lives in full_payload).
      const prevDom = typeof r.true_dom === 'number' ? r.true_dom : null;

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
  // tsAdmin was built before the loop (fail-fast on a missing key); non-null under APPLY.
  const admin = tsAdmin ?? buildTypesenseAdminClient();
  let tsOk = 0;
  let tsFailed = 0;

  for (let i = 0; i < updates.length; i += REINDEX_CHUNK) {
    const chunk = updates.slice(i, i + REINDEX_CHUNK);
    try {
      const res = await admin.collections('properties').documents().import(chunk, { action: 'update' });
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
