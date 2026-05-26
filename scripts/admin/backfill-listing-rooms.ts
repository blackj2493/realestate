/**
 * One-time backfill of listings.full_payload.rooms across active inventory.
 *
 * Why: per-room dimensions live in a SEPARATE RESO resource (/PropertyRooms), not
 * in the /Property payload. The nightly ingester attaches them per-batch
 * (scripts/worker/ingester.ts:enrichActiveListingsWithRooms), but the daily sync
 * has been failing repeatedly so existing active rows still have no `rooms` key.
 * Without rooms, AVM's GLA falls back to the coarse LivingAreaRange midpoint —
 * the over-valuation path migration 022 was built to fix.
 *
 * Design:
 * - pg + DATABASE_URL (Session pooler — direct host is IPv6-only here per
 *   CLAUDE.md §12). Mirrors scripts/admin/applyMigration023.ts.
 * - Keyset-paginate listings WHERE NOT (full_payload ? 'rooms'); project
 *   listing_key only (no full_payload detoast on read — IO-frugal per the Disk
 *   IO budget incident, memory: supabase-io-budget).
 * - Reuse fetchRoomsForKeys from scripts/worker/roomsEnrichment.ts (extracted
 *   for this purpose so we don't import sync.ts and trigger its Typesense
 *   hard-throw at module load).
 * - Patch in place via jsonb_set so the UPDATE never round-trips full_payload.
 * - Idempotent: rows whose API returns no rooms still get rooms: [] so the key
 *   exists and the WHERE NOT (?) skips them on re-run.
 *
 * Compliance:
 * - §4: deterministic — rooms are stored verbatim, no LLM.
 * - §6: never spreads payloads. Patches the single 'rooms' key.
 * - §12: raw_vow_sold not touched. Only mutates listings.full_payload.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/admin/backfill-listing-rooms.ts                # dry-run
 *   npx tsx --env-file=.env scripts/admin/backfill-listing-rooms.ts --limit 100    # dry-run, 100 keys
 *   npx tsx --env-file=.env scripts/admin/backfill-listing-rooms.ts --apply --limit 100  # write 100
 *   npx tsx --env-file=.env scripts/admin/backfill-listing-rooms.ts --apply        # full run
 *
 * Env: DATABASE_URL (Session pooler conn string), PROPTX_IDX_TOKEN.
 * After: re-run refresh-sqft-calibration.ts --apply, then refresh-property-estimates.ts --apply.
 */

import { Client } from 'pg';
import dotenv from 'dotenv';
import { fetchRoomsForKeys, ROOMS_REQUEST_DELAY_MS, type StoredRoom } from '../worker/roomsEnrichment';

dotenv.config({ path: ['.env.local', '.env'] });

const DATABASE_URL = process.env.DATABASE_URL || process.env.DIRECT_DB_URL;
if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL not set (use the Supabase Session pooler string).');
  process.exit(1);
}
if (!process.env.PROPTX_IDX_TOKEN) {
  console.error('❌ PROPTX_IDX_TOKEN not set (required for /PropertyRooms).');
  process.exit(1);
}

// ── CLI flags ────────────────────────────────────────────────────────────────
const APPLY = process.argv.includes('--apply');
const limitArg = process.argv.find((a) => a.startsWith('--limit'));
const ROW_LIMIT = limitArg
  ? parseInt(
      limitArg.includes('=')
        ? limitArg.split('=')[1]
        : process.argv[process.argv.indexOf(limitArg) + 1],
      10
    )
  : Infinity;

// ── Pacing ───────────────────────────────────────────────────────────────────
const PAGE_SIZE = 100;                       // listing keys per DB read page (then chunked 25×4 inside fetchRoomsForKeys)
const INTER_PAGE_DELAY_MS = ROOMS_REQUEST_DELAY_MS;
const MAX_UPDATE_RETRIES = 5;

// Active predicate — mirrors migration 020 / refresh-property-estimates.ts.
const PRICE_FLOOR = 50000;
const TERMINAL_STATUSES = ['sold', 'closed', 'closed sale', 'leased', 'terminated', 'expired', 'suspended'];

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Per-row UPDATE: PK lookup + jsonb_set patch. The eligibility guards
// (`NOT (full_payload ? 'rooms')` and the non-terminal-status check) move HERE,
// so they execute per-row by PK (cheap, no scan). The page READ stays JSONB-free.
// rowCount === 0 means "row was already done OR is terminal" → idempotent, free no-op.
async function updateRoomsForKey(
  client: Client,
  listingKey: string,
  rooms: StoredRoom[]
): Promise<{ written: boolean; skipped: boolean }> {
  const sql = `
    UPDATE listings
       SET full_payload = jsonb_set(full_payload, '{rooms}', $1::jsonb, true)
     WHERE listing_key = $2
       AND NOT (full_payload ? 'rooms')
       AND lower(coalesce(full_payload->>'Status',
                          full_payload->>'MlsStatus',
                          full_payload->>'StandardStatus', '')) <> ALL($3::text[])`;
  const json = JSON.stringify(rooms);

  let attempt = 0;
  for (;;) {
    try {
      const res = await client.query(sql, [json, listingKey, TERMINAL_STATUSES]);
      return { written: (res.rowCount ?? 0) > 0, skipped: (res.rowCount ?? 0) === 0 };
    } catch (err: unknown) {
      attempt++;
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt > MAX_UPDATE_RETRIES) {
        console.warn(`   ⚠️  UPDATE failed for ${listingKey} after ${MAX_UPDATE_RETRIES} retries: ${msg}`);
        return { written: false, skipped: false };
      }
      const backoff = Math.min(15000, 1000 * 2 ** (attempt - 1));
      console.warn(`   ⏳ UPDATE retry ${attempt}/${MAX_UPDATE_RETRIES} for ${listingKey} (${msg}) — backing off ${backoff}ms`);
      await sleep(backoff);
    }
  }
}

// Read by indexed columns ONLY (PK + list_price) — NO JSONB ops. A predicate
// like `NOT (full_payload ? 'rooms')` on the read forces a sequential JSONB
// detoast across ~112k rows and saturates the Disk IO budget (cf. memory
// supabase-io-budget). Idempotency is enforced at UPDATE time instead.
async function readPage(client: Client, cursor: string, pageSize: number): Promise<string[]> {
  const sql = `
    SELECT listing_key
      FROM listings
     WHERE list_price >= $1
       AND listing_key > $2
     ORDER BY listing_key
     LIMIT $3`;
  const res = await client.query<{ listing_key: string }>(sql, [PRICE_FLOOR, cursor, pageSize]);
  return res.rows.map((r) => r.listing_key);
}

async function main(): Promise<void> {
  console.log('============================================');
  console.log('  Backfill listings.full_payload.rooms ← /PropertyRooms');
  console.log(`  Mode: ${APPLY ? 'APPLY (writing)' : 'DRY-RUN (no writes)'}`);
  if (Number.isFinite(ROW_LIMIT)) console.log(`  Row limit: ${ROW_LIMIT}`);
  console.log('============================================\n');

  const client = new Client({
    connectionString: DATABASE_URL,
    connectionTimeoutMillis: 15000,
  });

  await client.connect();
  console.log('   ✅ Connected to PostgreSQL');

  // Disable statement_timeout for this session — UPDATE queries are tiny, but
  // the pooler may impose a default. Mirrors the pattern in backfill020.ts.
  await client.query("SET statement_timeout TO '0'");

  try {
    // No upfront count — `count(*) WHERE (full_payload ? 'rooms')` scans every
    // JSONB in the table and would IO-saturate the instance. Idempotency is
    // enforced by the UPDATE WHERE clause (writtenSkipped → rowCount=0).

    let cursor = '';
    let scanned = 0;
    let withRooms = 0;
    let emptyMarked = 0;
    let updatedOk = 0;
    let updateSkipped = 0;
    let updateFailed = 0;
    let sampleLogged = 0;

    while (scanned < ROW_LIMIT) {
      const pageSize = Math.min(PAGE_SIZE, ROW_LIMIT - scanned);
      const keys = await readPage(client, cursor, pageSize);
      if (keys.length === 0) {
        console.log('✅ Reached end of listings (above price floor).');
        break;
      }

      // fetchRoomsForKeys internally chunks into ROOMS_CHUNK_SIZE (25) with paced
      // /PropertyRooms calls and nextLink pagination. A failed chunk returns no
      // rooms for those keys — we still attempt to mark them with rooms: [] so
      // re-runs skip them at the UPDATE WHERE.
      const roomsMap = await fetchRoomsForKeys(keys);

      for (const key of keys) {
        scanned++;
        cursor = key;
        const rooms = roomsMap.get(key) ?? [];

        if (rooms.length > 0) withRooms++;
        else emptyMarked++;

        if (sampleLogged < 5 && rooms.length > 0) {
          const types = rooms.slice(0, 4).map((r) => (Array.isArray(r.RoomType) ? r.RoomType[0] : r.RoomType)).join('/');
          console.log(`   • ${key}: ${rooms.length} rooms (${types}${rooms.length > 4 ? '/…' : ''})`);
          sampleLogged++;
        }

        if (APPLY) {
          const { written, skipped } = await updateRoomsForKey(client, key, rooms);
          if (written) updatedOk++;
          else if (skipped) updateSkipped++;
          else updateFailed++;
        }
      }

      console.log(
        `   …page complete  scanned=${scanned}  withRooms=${withRooms}  emptyMarked=${emptyMarked}` +
          (APPLY ? `  written=${updatedOk}  skipped=${updateSkipped}  failed=${updateFailed}` : '') +
          `  lastKey=${cursor}`
      );

      if (keys.length < pageSize) {
        console.log('✅ Last page.');
        break;
      }
      await sleep(INTER_PAGE_DELAY_MS);
    }

    // ── Summary ───────────────────────────────────────────────────────────────
    console.log('\n──────── Summary ────────');
    console.log(`Keys scanned:           ${scanned}`);
    console.log(`/PropertyRooms returned rooms: ${withRooms}`);
    console.log(`/PropertyRooms returned empty: ${emptyMarked}`);
    if (APPLY) {
      console.log(`Updated (rooms newly set):   ${updatedOk}`);
      console.log(`Skipped (already had rooms or terminal status): ${updateSkipped}`);
      console.log(`Update failed:               ${updateFailed}`);
      if (updateFailed > 0) process.exitCode = 1;
    } else {
      console.log('\n(DRY-RUN — no writes. Re-run with --apply to persist.)');
    }
  } finally {
    await client.end();
    console.log('\n🔌 Connection closed.');
  }
}

main().catch((e: unknown) => {
  console.error('CRASH:', e instanceof Error ? e.message : e);
  process.exit(1);
});
