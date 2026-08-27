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
 *        verified-dead inventory: delete it from `properties` AND flag the vault
 *        row `is_orphaned` (Query C owns the delisted_listings bookkeeping).
 * 4. Sweep the VAULT the same way — every row reindex-from-vault would emit, minus
 *    the ones the feed still serves, verified per key. Steps 1-3 start from the
 *    index and so judge under a tenth of what a reindex publishes. See
 *    sweepVaultForOrphans and markVaultOrphans for the numbers.
 *
 * Clearing the doc alone was never enough: `listings` keeps the row frozen at its
 * last Active payload, and reindex-from-vault re-emits it. That is why E13415990 —
 * a Commercial Retail lease the feed stopped serving on 2026-06-08 — was cleared on
 * 2026-08-23 and back the same day. The vault flag is what makes a clearance stick.
 *
 * Idempotent and resumable: closed listings already present in raw_vow_sold are
 * only re-indexed/doc-deleted (cheap), doc deletes are no-ops when absent, and the
 * vault flag is re-cleared for any key the feed serves again.
 * Dry-run by default; --apply to write. Designed to run weekly (see
 * .github/workflows/ghost-reconcile.yml) with a notifyRun email summary — a
 * SPIKE in the ghost count is the early-warning that an upstream net regressed.
 *
 * Usage:
 *   npx tsx scripts/worker/ghostReconcile.ts [--apply] [--max-ghosts=N]
 *                                            [--max-vault=N] [--skip-vault-sweep]
 */
import 'dotenv/config';
import Typesense, { Client } from 'typesense';
import { Client as PgClient } from 'pg';
import { extractSoldListingData, upsertSoldListings } from './ingester';
import { processBatch } from './sync';
import { toSoldDocument, importSoldBatch, getSoldAdminClient } from './soldIndexer';
import { buildIdDeleteFilters, NON_ACTIVE_STATUSES } from './staleSearchDocs';
import { partitionGhosts } from './ghostPartition';
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
/** Escape hatch: run only the index-driven passes (steps 1-6). */
const SKIP_VAULT_SWEEP = process.argv.includes('--skip-vault-sweep');
/** Bound the vault sweep's per-key verification. Whatever is dropped is logged. */
const MAX_VAULT_SWEEP = (() => {
  const a = process.argv.find((x) => x.startsWith('--max-vault='));
  return a ? Number(a.split('=')[1]) : Infinity;
})();
/**
 * The vault-sweep candidate query is a ~294k-row scan of two plain columns — 0.6s
 * measured. The headroom is for a throttled instance, not for the query itself.
 */
const VAULT_SWEEP_TIMEOUT = '120s';

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

/** Keys per vault-marking UPDATE, and the per-chunk timeout. See markVaultOrphans. */
const ORPHAN_CHUNK = 5000;
const ORPHAN_CHUNK_TIMEOUT = '60s';

/**
 * VAULT MARKING — record the death in `listings`, not only in the search index.
 *
 * WHY THIS EXISTS
 * ───────────────
 * Step 6 deletes the ghost's Typesense doc and stops there, so the `listings` row
 * survives frozen at its last Active payload. Nothing else ever writes it: Query A
 * only fetches Active (a departed listing is never returned again), and Query B/C
 * only write rows the feed hands back with a terminal status — which never happens
 * for a listing the feed simply STOPS serving.
 *
 * That makes every cleared ghost re-creatable. reindex-from-vault reads the whole
 * vault and gates each row on isActiveListing(full_payload); a frozen payload still
 * says StandardStatus 'Active', so the reindex re-emits the doc as live inventory
 * and the ghost is back. E13415990 (70 Silver Star Blvd #121, a Commercial Retail
 * lease last served 2026-06-08) is the canonical case: cleared by the 2026-08-23
 * reconcile, restored the same day by the stage-B reindex. By 2026-08-26 the index
 * held 7,137 NOT_IN_FEED docs against 623 three days earlier, plus 2,335 the feed
 * reports Closed — 9.5% of the index was dead inventory.
 *
 * WHAT IT WRITES
 * ──────────────
 * `listings.is_orphaned` — a boolean that has existed since migration 082 and has
 * never been populated ("the orphan sweep is not populating it", 082's own note).
 * Verified 2026-08-26 to have ZERO readers in the database: no function, no view.
 * Populating it therefore cannot switch on a dormant gate — the failure mode that
 * collapsed the active set to 2% on 2026-08-18. Its ONLY reader is the reindex.
 *
 * `orphan_confirmations` counts how many sweeps condemned the row, so a row that
 * flickers is distinguishable from one dead for months.
 *
 * The flag means "verified dead inventory whose vault payload nobody rewrote" — the
 * same `dead` set step 6 clears from the index. That deliberately includes
 * Cancelled/Withdrawn/Delete, not just NOT_IN_FEED: the feed returns those with a
 * terminal status but no path writes it into `listings`, so the frozen row still
 * reads Active and the reindex resurrects it just the same.
 *
 * REVIVAL is symmetric and load-bearing, and it runs over the WHOLE Active snapshot,
 * not just this run's candidates. The vault sweep's candidate query skips rows that
 * are already flagged — otherwise it would re-verify ~84,000 keys against the feed
 * every week — so a flagged row can never be reconsidered by the sweep that flagged
 * it. Without a snapshot-wide pardon a listing that comes BACK (a reactivation keeps
 * its ListingKey) would carry is_orphaned=true forever: Query A re-indexes it, the
 * index-driven pass sees it in the snapshot and never treats it as a candidate, and
 * the next reindex silently drops a live listing. Presence in the Active snapshot is
 * positive evidence of life and needs no per-key check — verification is the price of
 * CONDEMNING a row, never of pardoning one.
 *
 * `updated_at` moves as a side effect (trigger update_listings_updated_at fires on
 * every UPDATE). That is honest — the row WAS written — but anything that watches
 * updated_at sees this sweep.
 *
 * Best-effort, exactly like the heartbeat: chunked, each chunk on its own, every
 * failure logged and swallowed. It must never abort the reconcile — the 2026-08-09
 * run died mid-way because the heartbeat threw, and the doc deletion never ran.
 */
async function markVaultOrphans(
  deadKeys: string[],
  seenKeys: string[],
  apply: boolean
): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.log('   ⏭️  DATABASE_URL not set — skipping vault orphan marking.');
    return;
  }
  const pg = new PgClient({ connectionString: process.env.DATABASE_URL });
  await pg.connect();
  try {
    if (!apply) {
      // Report the DELTA, not the candidate counts: rows already flagged by an earlier
      // sweep would otherwise inflate a dry run into looking like fresh damage, and a
      // 95k-key pardon list would read as 95k pending writes when almost none match.
      const r = await pg.query(
        `SELECT
           (SELECT count(*) FROM listings
             WHERE listing_key = ANY($1::text[]) AND is_orphaned IS DISTINCT FROM true) AS to_flag,
           (SELECT count(*) FROM listings
             WHERE listing_key = ANY($2::text[]) AND is_orphaned IS TRUE) AS to_clear`,
        [deadKeys, seenKeys]
      );
      console.log(
        `   (dry-run — would flag ${r.rows[0].to_flag} vault row(s) orphaned, ` +
          `clear ${r.rows[0].to_clear})`
      );
      return;
    }

    await pg.query(`SET statement_timeout TO '${ORPHAN_CHUNK_TIMEOUT}'`);

    let flagged = 0;
    let failed = 0;
    for (let i = 0; i < deadKeys.length; i += ORPHAN_CHUNK) {
      const chunk = deadKeys.slice(i, i + ORPHAN_CHUNK);
      try {
        const r = await pg.query(
          `UPDATE listings
              SET is_orphaned = true,
                  orphan_confirmations = COALESCE(orphan_confirmations, 0) + 1
            WHERE listing_key = ANY($1::text[])`,
          [chunk]
        );
        flagged += r.rowCount ?? 0;
      } catch (e) {
        failed++;
        console.warn(
          `   ⚠️  orphan-mark chunk ${i}-${i + chunk.length} failed: ${e instanceof Error ? e.message : e}`
        );
      }
    }

    let revived = 0;
    for (let i = 0; i < seenKeys.length; i += ORPHAN_CHUNK) {
      const chunk = seenKeys.slice(i, i + ORPHAN_CHUNK);
      try {
        const r = await pg.query(
          `UPDATE listings
              SET is_orphaned = false, orphan_confirmations = 0
            WHERE listing_key = ANY($1::text[]) AND is_orphaned IS TRUE`,
          [chunk]
        );
        revived += r.rowCount ?? 0;
      } catch (e) {
        failed++;
        console.warn(
          `   ⚠️  orphan-clear chunk ${i}-${i + chunk.length} failed: ${e instanceof Error ? e.message : e}`
        );
      }
    }

    console.log(
      `   ✅ vault: ${flagged} row(s) flagged orphaned, ${revived} cleared` +
        (failed ? ` (${failed} chunk(s) failed — see above)` : '') + '.'
    );
  } catch (e) {
    console.warn(`   ⚠️  vault orphan marking skipped: ${e instanceof Error ? e.message : e}`);
  } finally {
    await pg.end();
  }
}

/**
 * VAULT-WIDE SWEEP — the same verdict, over the rows that have no doc yet.
 *
 * WHY THE INDEX-DRIVEN PASS IS NOT ENOUGH
 * ───────────────────────────────────────
 * Steps 3-6 start from `properties` doc ids, so they only ever judge listings that
 * are ALREADY indexed. reindex-from-vault does not read the index — it reads the
 * vault, and emits every row whose payload passes isActiveListing. Measured
 * 2026-08-26: 179,176 vault rows carry a payload reading StandardStatus 'Active'
 * against 95,136 actives in the feed. A full reindex therefore materialises ~84,000
 * ghosts, and the index-driven pass had condemned only the 7,909 of them that
 * happened to hold a doc that day — under a tenth. The index you had on 2026-08-24
 * held 178,912 docs, which is what that looks like when it happens.
 *
 * So the candidate set for the VAULT flag cannot be the index. It has to be the
 * vault: every row the reindex would emit, minus the ones the feed still serves.
 *
 * DISCIPLINE IS UNCHANGED
 * ───────────────────────
 * The snapshot diff only proposes; the VOW feed decides, per key, exactly as step 4
 * does. This file has never trusted a diff on its own and does not start here — an
 * 84,000-row write earns the same verification a 7,909-row one gets.
 *
 * WHAT IT DOES NOT DO
 * ───────────────────
 * It does not repair vault-only closes. A key the feed reports Closed that has no
 * doc is real missing data — the close never reached `listings` — but repairing tens
 * of thousands of them is a different job with a different runtime. They are
 * condemned (so no reindex can publish them as available) and COUNTED in the log, so
 * the number is visible rather than silently absorbed.
 *
 * COST: ~1,700 extra feed requests, +8-10 min on a 240-min budget. Best-effort: any
 * failure logs and returns, exactly like the heartbeat. The reconcile must survive it.
 */
async function sweepVaultForOrphans(
  activeKeys: Set<string>,
  alreadyJudged: Set<string>,
  apply: boolean
): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.log('   ⏭️  DATABASE_URL not set — skipping vault-wide sweep.');
    return;
  }

  let candidates: string[] = [];
  const pg = new PgClient({ connectionString: process.env.DATABASE_URL });
  await pg.connect();
  try {
    // Candidates = rows the reindex would emit. Its gate is isActiveListing(full_payload),
    // which reads Status → MlsStatus → StandardStatus (first non-empty wins) against the
    // shared NON_ACTIVE_STATUSES. Expressing that precedence in SQL means three jsonb
    // extractions over ~294k rows with no index to lean on: measured 2026-08-26, it does
    // not finish — cancelled at 20s, and it hung a 300s attempt.
    //
    // The `standard_status` column gives the same answer in 0.6s. That is only safe in ONE
    // direction, so it was measured rather than assumed: the dangerous case is the column
    // reading terminal (row skipped here) while the payload reads active (row emitted by
    // the reindex). Counted 2026-08-26: **0 rows**, against 180,339 candidates the two
    // agree on exactly. A closed listing always carries a terminal MlsStatus, so the
    // precedence never rescues it.
    //
    // Re-measure with scripts/admin if the ingest ever starts writing Status/MlsStatus
    // that disagree with standard_status.
    await pg.query(`SET statement_timeout TO '${VAULT_SWEEP_TIMEOUT}'`);
    const res = await pg.query(
      `SELECT listing_key
         FROM listings
        WHERE is_orphaned IS DISTINCT FROM true
          AND lower(coalesce(standard_status, '')) <> ALL($1::text[])`,
      [[...NON_ACTIVE_STATUSES]]
    );
    candidates = res.rows.map((r: any) => r.listing_key);
  } catch (e) {
    console.warn(`   ⚠️  vault sweep skipped: ${e instanceof Error ? e.message : e}`);
    await pg.end();
    return;
  }
  await pg.end();

  const indexable = candidates.length;
  // Drop keys step 4 already ruled on. `dead` is gone from the query anyway (4.5 flagged
  // it), but `closed` and `alive` are NOT: their vault rows still read live at this point,
  // so without this the sweep re-verifies them and reports the SAME closes a second time —
  // step 5 is about to repair them. On 2026-08-27 that made 2,389 repaired closes look like
  // a separate body of 2,391 unrecorded ones. It also saves ~2,400 feed requests per run.
  const judged = candidates.filter((k) => alreadyJudged.has(k)).length;
  let absent = candidates.filter((k) => !activeKeys.has(k) && !alreadyJudged.has(k));
  console.log(
    `   vault rows a reindex would emit: ${indexable} · feed actives: ${activeKeys.size}` +
      ` · already judged in step 4: ${judged} · absent: ${absent.length}`
  );
  if (absent.length > MAX_VAULT_SWEEP) {
    console.log(
      `   (bounded to first ${MAX_VAULT_SWEEP} by --max-vault; ${absent.length - MAX_VAULT_SWEEP} left for the next run)`
    );
    absent = absent.slice(0, MAX_VAULT_SWEEP);
  }
  if (!absent.length) {
    console.log('   ✅ nothing absent — vault and feed agree.');
    return;
  }

  console.log(`   verifying ${absent.length} key(s) against the VOW feed…`);
  const payloads = await fetchCurrentPayloads(absent);
  const { closed, dead, alive, keptActive, statusTally } = partitionGhosts(absent, payloads);

  console.log('   breakdown:');
  for (const [s, n] of Object.entries(statusTally).sort((a, b) => b[1] - a[1]))
    console.log(`     ${s}: ${n}`);

  // Condemn the closes too: nothing rewrites their vault payload on this path, so an
  // unflagged one stays re-indexable as "available" forever. Counted, not repaired.
  const condemn = [...dead, ...closed.map((r: any) => r.ListingKey)];
  console.log(
    `   → flag ${condemn.length} (${dead.length} off-market, ${closed.length} closed with a ` +
      `stale vault status) · pardon ${keptActive} still-Active`
  );

  await markVaultOrphans(condemn, alive, apply);
}

/** One call site for the sweep, reached from both of main()'s exits. */
async function maybeSweepVault(
  activeKeys: Set<string>,
  alreadyJudged: Set<string>,
  apply: boolean
): Promise<void> {
  if (SKIP_VAULT_SWEEP) {
    console.log('\n4️⃣.6  Vault-wide sweep: SKIPPED (--skip-vault-sweep).');
    return;
  }
  console.log('\n4️⃣.6  Vault-wide sweep: judging rows a reindex would emit…');
  await sweepVaultForOrphans(activeKeys, alreadyJudged, apply);
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

  // 2c. Pardon anything the feed serves again BEFORE condemning anything new. A
  // reactivation keeps its ListingKey, and the vault sweep below skips already-flagged
  // rows, so this is the only thing that can ever clear a flag. See markVaultOrphans.
  console.log('\n2️⃣.6  Pardoning vault rows the feed serves again…');
  await markVaultOrphans([], [...active], APPLY);

  let ghosts = [...propIds].filter((id) => !active.has(id));
  console.log(`\n3️⃣  Ghost candidates: ${ghosts.length}`);
  if (ghosts.length > MAX_GHOSTS) {
    console.log(`   (bounded to first ${MAX_GHOSTS} by --max-ghosts; re-run for the rest)`);
    ghosts = ghosts.slice(0, MAX_GHOSTS);
  }
  // A clean index does NOT mean a clean vault — the two sets are independent, and the
  // vault is the one the reindex reads. Run the sweep before returning.
  if (!ghosts.length) {
    console.log('✅ index is clean — nothing to reconcile');
    if (SKIP_VAULT_SWEEP) {
      console.log('\n4️⃣.6  Vault-wide sweep: SKIPPED (--skip-vault-sweep).');
    } else {
      console.log('\n4️⃣.6  Vault-wide sweep: judging rows a reindex would emit…');
      await sweepVaultForOrphans(active, new Set(), APPLY);
    }
    return;
  }

  console.log('\n4️⃣  Verifying each candidate against the VOW feed…');
  const payloads = await fetchCurrentPayloads(ghosts);

  // Partition by verified current status (pure — see ghostPartition.ts).
  const { closed, dead, alive, keptActive, statusTally } = partitionGhosts(ghosts, payloads);
  console.log('\n   breakdown:');
  for (const [s, n] of Object.entries(statusTally).sort((a, b) => b[1] - a[1]))
    console.log(`     ${s}: ${n}`);
  console.log(`   → sold repair: ${closed.length} · clear from index: ${dead.length} · keep: ${keptActive}`);

  // 4b. Mark the vault BEFORE touching the index. If the run then dies in sold repair
  // (a 240-minute timeout is a real outcome on a large regression), the marks are
  // already committed and the next reindex cannot resurrect these keys. The reverse
  // order would clear the index and leave the vault primed to undo it.
  console.log('\n4️⃣.5  Marking verified-dead rows in the vault…');
  await markVaultOrphans(dead, alive, APPLY);

  // 4c. The same verdict over the rows that have no doc yet — the set reindex-from-vault
  // actually reads. See sweepVaultForOrphans: the index-driven pass above covers under a
  // tenth of what a full reindex would publish.
  await maybeSweepVault(
    active,
    new Set([...closed.map((r: { ListingKey: string }) => r.ListingKey), ...alive]),
    APPLY
  );

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
