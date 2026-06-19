/**
 * BACKFILL raw_vow_sold.postal_code from raw_payload->>'PostalCode'.
 *
 * The scalar postal_code column is FSA-truncated (3-char) on ~97% of legacy rows, while
 * the full 6-char code sits in raw_payload.PostalCode for 100% of rows. The AVM's
 * hierarchical geographic comp weighting (geoMatchWeight) only reaches block/building
 * granularity when the comp column carries the full code — so this backfills it.
 *
 * NOT a schema change (CLAUDE.md §12 forbids ALTERing raw_vow_sold; a value UPDATE is
 * allowed and matches what the current ingester already writes for new rows). Idempotent:
 * only rewrites rows whose column is shorter than the full payload code. Keyset-batched
 * by listing_key with statement_timeout disabled, per the backfill020 pattern — a single
 * full-table UPDATE would detoast 217k JSONB rows and exceed the gateway timeout.
 *
 * REQUIRES a direct/pooler Postgres connection (CLAUDE.md §12): set DATABASE_URL to the
 * Supabase SESSION pooler string (port 5432). Run:
 *   npx.cmd tsx --env-file=.env.local scripts/admin/backfill-postal.ts --dry-run   # counts only
 *   npx.cmd tsx --env-file=.env.local scripts/admin/backfill-postal.ts             # apply
 */
import { Client } from 'pg';

const DRY_RUN = process.argv.includes('--dry-run');
const BATCH = 2000;

const CONN = (process.env.DATABASE_URL || process.env.DIRECT_DB_URL || '').trim();
if (!CONN) { console.error('Set DATABASE_URL to the Supabase Session pooler string (port 5432).'); process.exit(1); }

// Normalized-length check: count significant chars (no spaces). FSA=3, full=6.
const NEEDS_UPDATE = `
  length(regexp_replace(coalesce(postal_code, ''), '\\s', '', 'g')) < 6
  AND raw_payload->>'PostalCode' IS NOT NULL
  AND length(regexp_replace(raw_payload->>'PostalCode', '\\s', '', 'g')) >= 6
`;

async function main() {
  // Supabase's Supavisor pooler presents a self-signed CA (no public chain), so we cannot
  // verify it against the system bundle. rejectUnauthorized:false matches the repo's
  // established pattern for this pooler (all scripts/admin/applyMigration*.ts connect this way).
  const client = new Client({ connectionString: CONN, ssl: { rejectUnauthorized: false } });
  await client.connect();
  await client.query("SET statement_timeout TO '0'");
  console.log(`Connected. ${DRY_RUN ? 'DRY RUN — counting only.' : 'APPLYING updates.'}`);

  // Cheap count on the scalar column only (no JSONB detoast). The payload carries a full
  // postal ~100% of the time, so this ≈ the rows that will actually be rewritten.
  const { rows: pre } = await client.query(
    `SELECT count(*)::int AS n FROM raw_vow_sold WHERE length(regexp_replace(coalesce(postal_code, ''), '\\s', '', 'g')) < 6`,
  );
  console.log(`Rows with FSA-truncated postal_code column: ${pre[0].n}`);
  if (DRY_RUN || pre[0].n === 0) { await client.end(); return; }

  let cursor = '';
  let updated = 0, scanned = 0;
  for (;;) {
    // Keyset page of listing_keys, update the ones that need it in one statement.
    const res = await client.query(
      `WITH page AS (
         SELECT listing_key FROM raw_vow_sold
         WHERE listing_key > $1 ORDER BY listing_key LIMIT $2
       ), upd AS (
         UPDATE raw_vow_sold t
         SET postal_code = t.raw_payload->>'PostalCode'
         FROM page p
         WHERE t.listing_key = p.listing_key AND ${NEEDS_UPDATE.replace(/postal_code/g, 't.postal_code').replace(/raw_payload/g, 't.raw_payload')}
         RETURNING t.listing_key
       )
       SELECT (SELECT max(listing_key) FROM page) AS last_key,
              (SELECT count(*) FROM page)::int AS page_n,
              (SELECT count(*) FROM upd)::int AS upd_n`,
      [cursor, BATCH],
    );
    const { last_key, page_n, upd_n } = res.rows[0];
    if (!page_n || last_key === null) break;
    cursor = last_key;
    scanned += page_n;
    updated += upd_n;
    if (scanned % 20000 === 0) console.log(`   scanned ${scanned} · updated ${updated}`);
    if (page_n < BATCH) break;
  }
  console.log(`DONE. scanned ${scanned} · updated ${updated} rows.`);
  await client.end();
}
main().catch((e) => { console.error('CRASH:', e?.message || e); process.exit(1); });
