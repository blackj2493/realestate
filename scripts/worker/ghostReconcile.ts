/**
 * Ghost-active reconciliation ("Query D") — the full-inventory safety net.
 *
 * WHY THIS EXISTS
 * ───────────────
 * Query A only ever fetches `StandardStatus eq 'Active'`, so when a listing leaves
 * Active its For-Sale doc freezes at the last Active state. Three nets normally
 * catch the departure — Query B (sold), Query C (de-listed), and the twice-weekly
 * vault reconciler — but each has a blind spot: B/C are ModificationTimestamp
 * delta queries (a record missed once — e.g. $skip drift during a multi-hour
 * catch-up, or an outage window — is permanently behind the advancing cursor),
 * and the vault reconciler only sees sales whose vault payload already says
 * Closed, which never happens when B missed the record (the vault froze Active
 * too). 6 Alexie Way (N13471804, sold 2026-07-02, missed by the July 2–5 Query B
 * outage + July 6 catch-up drift) is the canonical case; the 2026-07-17 sweep
 * found 26,377 closed listings still showing For Sale, 26,054 of them absent
 * from raw_vow_sold (mod-months Apr–Jul).
 *
 * WHAT IT DOES
 * ────────────
 * 1. Export every doc id in the Typesense `properties` (For Sale) index.
 * 2. Page the feed's FULL current Active snapshot (IDX, $select=ListingKey —
 *    cheap) and diff: docs not Active upstream are ghost candidates.
 * 3. Re-fetch each candidate's CURRENT full payload from the VOW feed (per-key
 *    ground truth — never trusts the snapshot diff alone) and route it:
 *      • StandardStatus 'Closed' (Sold/Leased)  → the EXACT Query-B ingest path:
 *        processBatch({isSold}) (vault refresh + stale doc delete) +
 *        upsertSoldListings (raw_vow_sold) + importSoldBatch (sold_listings).
 *        Media is NOT fetched inline — nightly Query B2 heals photos.
 *      • Still Active* (incl. Active Under Contract / Sold Conditional) → KEEP
 *        (conditionals stay visible by product policy — see NON_ACTIVE_STATUSES).
 *      • Terminated / Withdrawn / Deleted / absent from the feed → the doc is
 *        verified-dead inventory: delete it from `properties` (Query C owns the
 *        delisted_listings bookkeeping; here we only clear the search index).
 *
 * Idempotent and resumable: closed listings already present in raw_vow_sold are
 * only re-indexed/doc-deleted (cheap), and doc deletes are no-ops when absent.
 * Dry-run by default; --apply to write. Designed to run weekly (see
 * .github/workflows/ghost-reconcile.yml) with a notifyRun email summary — a
 * SPIKE in the ghost count is the early-warning that an upstream net regressed.
 *
 * Usage:
 *   npx tsx scripts/worker/ghostReconcile.ts [--apply] [--max-ghosts=N]
 */
import 'dotenv/config';
import Typesense, { Client } from 'typesense';
import { Client as PgClient } from 'pg';
import { extractSoldListingData, upsertSoldListings } from './ingester';
import { processBatch } from './sync';
import { toSoldDocument, importSoldBatch, getSoldAdminClient } from './soldIndexer';
import { buildIdDeleteFilters } from './staleSearchDocs';
import { getServiceRoleClient } from '../../src/lib/supabase/client';

const API_BASE_URL = process.env.AMPRE_API_URL || 'https://query.ampre.ca/odata';
const TYPESENSE_HOST = '9uyapwh6e5qmvl34p-1.a1.typesense.net';
const IDX_TOKEN = process.env.PROPTX_IDX_TOKEN;
const VOW_TOKEN = process.env.PROPTX_VOW_TOKEN;

const APPLY = process.argv.includes('--apply');
const MAX_GHOSTS = (() => {
  const a = process.argv.find((x) => x.startsWith('--max-ghosts='));
  return a ? Number(a.split('=')[1]) : Infinity;
})();

/** Feed page size ($top) and per-request or-chain size for keyed lookups. */
const FETCH_CHUNK = 50;
/** processBatch page size — mirrors the daily sync's 100/page. */
const PROCESS_CHUNK = 100;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function tsClient(): Client {
  return new Typesense.Client({
    nodes: [{ host: TYPESENSE_HOST, port: 443, protocol: 'https' }],
    apiKey: process.env.TYPESENSE_ADMIN_API_KEY!,
    connectionTimeoutSeconds: 120,
  });
}

async function feedGet(url: string, token: string): Promise<any> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (res.ok) return res.json();
    if (attempt >= 3) throw new Error(`feed HTTP ${res.status}: ${url.slice(0, 120)}`);
    await sleep(1500 * attempt);
  }
}

/** Every doc id currently in the For-Sale index. */
async function exportPropertyIds(ts: Client): Promise<Set<string>> {
  const jsonl = await ts.collections('properties').documents().export({ include_fields: 'id' } as any);
  return new Set(
    jsonl
      .split('\n')
      .filter(Boolean)
      .map((l: string) => JSON.parse(l).id as string)
  );
}

/** The feed's full current Active key set (IDX, server-driven nextLink paging). */
async function fetchActiveKeySnapshot(): Promise<Set<string>> {
  const active = new Set<string>();
  let url: string | null =
    `${API_BASE_URL}/Property?$filter=${encodeURIComponent(`StandardStatus eq 'Active'`)}` +
    `&$select=ListingKey&$top=100&$count=true`;
  let pages = 0;
  while (url) {
    const data: any = await feedGet(url, IDX_TOKEN!);
    for (const r of data.value ?? []) active.add(r.ListingKey);
    pages++;
    if (pages % 100 === 0) console.log(`   …snapshot page ${pages} (${active.size} keys)`);
    url = data['@odata.nextLink'] ?? null;
    await sleep(80);
  }
  console.log(`   Active snapshot: ${active.size} keys (${pages} pages)`);
  return active;
}

/** Current full payloads for a set of keys via VOW (or-chained, chunked). */
async function fetchCurrentPayloads(keys: string[]): Promise<Map<string, any>> {
  const out = new Map<string, any>();
  for (let i = 0; i < keys.length; i += FETCH_CHUNK) {
    const chunk = keys.slice(i, i + FETCH_CHUNK);
    const filter = chunk.map((k) => `ListingKey eq '${k}'`).join(' or ');
    const url = `${API_BASE_URL}/Property?$filter=${encodeURIComponent(filter)}&$top=${FETCH_CHUNK}`;
    const data = await feedGet(url, VOW_TOKEN!);
    for (const r of data.value ?? []) out.set(r.ListingKey, r);
    if ((i / FETCH_CHUNK) % 40 === 0)
      console.log(`   …payloads ${Math.min(i + FETCH_CHUNK, keys.length)}/${keys.length}`);
    await sleep(80);
  }
  return out;
}

/** Which of these keys already have a raw_vow_sold row (resume/idempotency). */
async function keysInRawVowSold(keys: string[]): Promise<Set<string>> {
  const sb = getServiceRoleClient();
  const present = new Set<string>();
  for (let i = 0; i < keys.length; i += 500) {
    const chunk = keys.slice(i, i + 500);
    const { data, error } = await sb.from('raw_vow_sold').select('listing_key').in('listing_key', chunk);
    if (error) throw new Error(`raw_vow_sold presence check: ${error.message}`);
    for (const r of data ?? []) present.add((r as any).listing_key);
  }
  return present;
}

/** Sold repair for one PROCESS_CHUNK of raw payloads — the exact Query-B path. */
async function repairSoldChunk(raws: any[]): Promise<{ vaulted: number; anchored: number; indexed: number }> {
  // 1. Vault refresh + stale For-Sale doc delete (collectStaleSearchDocIds path).
  const syncResult = await processBatch(raws, { isSold: true });
  if (!syncResult.success)
    console.warn(`   ⚠️  processBatch errors: ${[...syncResult.supabase.errors, ...syncResult.typesense.errors].slice(0, 3).join('; ')}`);

  // 2. raw_vow_sold (AVM anchor) + sold_listings docs — mirrors ingester.ts Query B.
  const records = [];
  const docs = [];
  for (const raw of raws) {
    const rec = extractSoldListingData(raw);
    if (!rec) continue;
    records.push(rec);
    const doc = toSoldDocument(
      { ...rec, mls_status: raw.MlsStatus ?? null, transaction_type: raw.TransactionType ?? null } as any,
      raw.ListOfficeName ?? null,
      { media: raw.media, images: raw.images }
    );
    if (doc) docs.push(doc);
  }
  let anchored = 0;
  if (records.length) {
    const up = await upsertSoldListings(getServiceRoleClient(), records);
    anchored = up.inserted;
    if (up.failed) console.warn(`   ⚠️  raw_vow_sold: ${up.failed} failed`);
  }
  let indexed = 0;
  if (docs.length) {
    try {
      const { success } = await importSoldBatch(getSoldAdminClient(), docs);
      indexed = success;
    } catch (e: any) {
      console.warn(`   ⚠️  sold_listings import (non-fatal): ${e.message}`);
    }
  }
  return { vaulted: raws.length, anchored, indexed };
}

const HEARTBEAT_TERMINAL = ['sold', 'closed', 'closed sale', 'leased', 'terminated', 'expired', 'suspended'];
/** Keys per heartbeat UPDATE, and the per-chunk timeout. See stampLastSeenHeartbeat. */
const HEARTBEAT_CHUNK = 5000;
const HEARTBEAT_CHUNK_TIMEOUT = '60s';

/**
 * HEARTBEAT — persist the Active snapshot to `listings.last_seen_at`.
 *
 * The delta sync (Query A) never stamps last_seen_at, so ~40% of rows are NULL (migration 082)
 * and the region RPCs' freshness gate is forced to treat NULL as live — keeping dead rows in the
 * active-set / %-stale / months-of-supply. ghostReconcile already holds the FULL active key set
 * (it fetched it to diff the index), so persisting it here is free — no extra feed enumeration.
 *
 * This only POPULATES the signal (and reports the listings-table ghost count for visibility). It
 * is the enabling step for a later, reviewed flip of the region-RPC gate to `last_seen_at >=
 * now()-30d` (or a purge) — deferred until a few weekly stamps have accrued so a listing briefly
 * absent from one snapshot is never mistaken for dead. pg via DATABASE_URL; skips gracefully (so
 * the core reconcile is never blocked) if the secret is absent.
 */
async function stampLastSeenHeartbeat(activeKeys: string[], apply: boolean): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.log('   ⏭️  DATABASE_URL not set — skipping last_seen_at heartbeat (add the secret to enable).');
    return;
  }
  const pg = new PgClient({ connectionString: process.env.DATABASE_URL });
  await pg.connect();
  try {
    await pg.query('CREATE TEMP TABLE swept (listing_key text PRIMARY KEY)');
    await pg.query('INSERT INTO swept (listing_key) SELECT DISTINCT unnest($1::text[]) ON CONFLICT DO NOTHING', [activeKeys]);
    const ourActive = `list_price >= 50000 AND standard_status IS NOT NULL AND standard_status <> ALL($1::text[])`;
    const recon = await pg.query(
      `SELECT
         (SELECT count(*) FROM listings WHERE ${ourActive}) AS our_active,
         (SELECT count(*) FROM listings l WHERE ${ourActive}
            AND NOT EXISTS (SELECT 1 FROM swept s WHERE s.listing_key = l.listing_key)) AS absent_from_feed
       `,
      [HEARTBEAT_TERMINAL]
    );
    const r = recon.rows[0];
    console.log(`   listings active=${r.our_active} · absent-from-feed (region-metric ghosts)=${r.absent_from_feed}`);
    if (!apply) {
      console.log('   (dry-run — no stamp)');
      return;
    }
    // Chunked, not one statement. A single UPDATE over the ~95k swept keys exceeded the
    // 120s statement timeout on 2026-08-09; the throw propagated out of main() and killed
    // the run BEFORE the ghost-deletion step, while the workflow still reported success
    // (the `| tee` pipeline swallowed the exit code — fixed with pipefail). Stamping is a
    // best-effort side job, so it must never be able to abort the reconcile: each chunk is
    // committed on its own and any failure is logged and swallowed.
    let stamped = 0;
    let failed = 0;
    // Recorded as the sweep time on success. Taken BEFORE the first chunk: every row the
    // loop stamps gets now() >= this, so a floor derived from it can never exclude a row
    // this very sweep just confirmed.
    const sweepStartedAt = new Date().toISOString();
    try {
      await pg.query(`SET statement_timeout TO '${HEARTBEAT_CHUNK_TIMEOUT}'`);
      for (let i = 0; i < activeKeys.length; i += HEARTBEAT_CHUNK) {
        const chunk = activeKeys.slice(i, i + HEARTBEAT_CHUNK);
        try {
          const upd = await pg.query(
            'UPDATE listings SET last_seen_at = now() WHERE listing_key = ANY($1::text[])',
            [chunk]
          );
          stamped += upd.rowCount ?? 0;
        } catch (e) {
          failed++;
          console.warn(`   ⚠️  heartbeat chunk ${i}-${i + chunk.length} failed: ${e instanceof Error ? e.message : e}`);
        }
      }
      console.log(
        `   ✅ heartbeat: stamped last_seen_at on ${stamped} listings row(s)` +
          (failed ? ` (${failed} chunk(s) failed — see above)` : '') + '.'
      );

      // Publish the sweep so region_active_aggregates / region_dom_distribution /
      // region_price_cuts can measure liveness from it (migration 121,
      // public.feed_liveness_floor). They previously inferred the sweep from
      // max(listings.last_seen_at), which is NOT the sweep: a new row keeps the column
      // default now(), so that watermark tracked the newest row CREATED and always read
      // as "today". The 36h gate then slid off this weekly stamp within a day and the
      // active set collapsed to ~2% (Toronto served 222 of 20,734 on 2026-08-18).
      //
      // ONLY on a clean run. A partial sweep leaves live rows unstamped, so advancing the
      // heartbeat after one would tell the gate to discard exactly those rows — turning a
      // dropped chunk into a silently shrunken market. Keeping the previous timestamp
      // degrades to a slightly stale floor, which admits too much rather than too little.
      // Fail toward showing listings.
      if (failed === 0 && stamped > 0) {
        try {
          await pg.query(
            `INSERT INTO sync_state (id, last_sync_timestamp, sync_type, records_synced, status, updated_at)
             VALUES ('last_seen_heartbeat', $1, 'full', $2, 'completed', now())
             ON CONFLICT (id) DO UPDATE
               SET last_sync_timestamp = EXCLUDED.last_sync_timestamp,
                   records_synced      = EXCLUDED.records_synced,
                   status              = EXCLUDED.status,
                   updated_at          = now()`,
            [sweepStartedAt, stamped]
          );
          console.log(`   ✅ recorded sweep in sync_state(last_seen_heartbeat) at ${sweepStartedAt}`);
        } catch (e) {
          // Never fatal: the gate fails open on a missing or stale row, so the worst case
          // is a wider active set for a week, not an empty one.
          console.warn(`   ⚠️  could not record sweep in sync_state: ${e instanceof Error ? e.message : e}`);
        }
      } else if (stamped > 0) {
        console.warn(
          `   ⚠️  sweep NOT recorded (${failed} chunk(s) failed) — the liveness floor keeps the ` +
            'previous sweep so unstamped-but-live rows are not discarded.'
        );
      }
    } catch (e) {
      console.warn(`   ⚠️  heartbeat skipped: ${e instanceof Error ? e.message : e}`);
    }
  } finally {
    await pg.end();
  }
}

async function main() {
  if (!IDX_TOKEN || !VOW_TOKEN) throw new Error('PROPTX_IDX_TOKEN / PROPTX_VOW_TOKEN missing');
  const ts = tsClient();

  console.log('═══ Ghost reconcile (Query D) ═══');
  console.log(`mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);

  console.log('\n1️⃣  Exporting For-Sale index ids…');
  const propIds = await exportPropertyIds(ts);
  console.log(`   properties: ${propIds.size} docs`);

  console.log('\n2️⃣  Fetching feed Active snapshot…');
  const active = await fetchActiveKeySnapshot();

  console.log('\n2️⃣.5  Heartbeat: persisting last_seen_at from the snapshot…');
  await stampLastSeenHeartbeat([...active], APPLY);

  let ghosts = [...propIds].filter((id) => !active.has(id));
  console.log(`\n3️⃣  Ghost candidates: ${ghosts.length}`);
  if (ghosts.length > MAX_GHOSTS) {
    console.log(`   (bounded to first ${MAX_GHOSTS} by --max-ghosts; re-run for the rest)`);
    ghosts = ghosts.slice(0, MAX_GHOSTS);
  }
  if (!ghosts.length) {
    console.log('✅ nothing to reconcile');
    return;
  }

  console.log('\n4️⃣  Verifying each candidate against the VOW feed…');
  const payloads = await fetchCurrentPayloads(ghosts);

  // Partition by verified current status.
  const closed: any[] = []; // → sold repair path
  const dead: string[] = []; // → verified non-available: clear from For-Sale index
  let keptActive = 0; // snapshot-timing false positives + conditionals: KEEP
  const statusTally: Record<string, number> = {};
  for (const key of ghosts) {
    const raw = payloads.get(key);
    const label = raw ? `${raw.StandardStatus}/${raw.MlsStatus}` : 'NOT_IN_FEED';
    statusTally[label] = (statusTally[label] ?? 0) + 1;
    if (!raw) {
      dead.push(key); // absent from the feed entirely — cannot be available inventory
    } else if (String(raw.StandardStatus).startsWith('Active')) {
      keptActive++; // Active again, or Active Under Contract (conditionals stay visible)
    } else if (raw.StandardStatus === 'Closed') {
      closed.push(raw);
    } else {
      dead.push(key); // Cancelled / Withdrawn / Delete — verified off-market
    }
  }
  console.log('\n   breakdown:');
  for (const [s, n] of Object.entries(statusTally).sort((a, b) => b[1] - a[1]))
    console.log(`     ${s}: ${n}`);
  console.log(`   → sold repair: ${closed.length} · clear from index: ${dead.length} · keep: ${keptActive}`);

  if (!APPLY) {
    console.log('\nDRY RUN complete — re-run with --apply to reconcile.');
    return;
  }

  // 5a. Sold repair (chunked through the standard Query-B path).
  console.log('\n5️⃣  Sold repair…');
  const already = await keysInRawVowSold(closed.map((r) => r.ListingKey));
  console.log(`   (${already.size} already in raw_vow_sold — still re-run for doc delete + index)`);
  let vaulted = 0,
    anchored = 0,
    indexed = 0;
  for (let i = 0; i < closed.length; i += PROCESS_CHUNK) {
    const chunk = closed.slice(i, i + PROCESS_CHUNK);
    const r = await repairSoldChunk(chunk);
    vaulted += r.vaulted;
    anchored += r.anchored;
    indexed += r.indexed;
    console.log(`   sold ${Math.min(i + PROCESS_CHUNK, closed.length)}/${closed.length} (vault ${vaulted}, anchor ${anchored}, index ${indexed})`);
  }

  // 5b. Verified-dead docs: clear from the For-Sale index.
  console.log('\n6️⃣  Clearing verified-dead docs…');
  let cleared = 0;
  for (const filter of buildIdDeleteFilters(dead, 100)) {
    const res: any = await ts.collections('properties').documents().delete({ filter_by: filter });
    cleared += res?.num_deleted ?? 0;
  }
  console.log(`   cleared ${cleared} docs`);

  const coll: any = await ts.collections('properties').retrieve();
  console.log(`\n✅ Reconcile complete. sold-repaired=${closed.length} cleared=${cleared} kept=${keptActive}`);
  console.log(`   properties collection now: ${coll.num_documents} docs`);
}

main().catch((e) => {
  console.error('ghost reconcile failed:', e?.message || e);
  process.exit(1);
});
