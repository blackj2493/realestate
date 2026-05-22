/**
 * Supabase — Verify expected indexes are present on the hot ETL tables,
 * apply any missing ones.
 *
 * Why: alert "depleting Disk IO Budget" on project pyzgnivilxhnwzfrdkiq.
 * Missing/inadequate indexes on `listings.property_hash` and the
 * `raw_vow_sold` anchor query cause seq scans on every sync batch, which
 * is the #1 IO killer.
 *
 * Uses the IPv4 Session Pooler (same connection as scripts/admin/forceIndexes.ts)
 * because local IPv6 is blocked.
 *
 * Run:  npx tsx scripts/admin/verifyAndApplyIndexes.ts          (read-only audit)
 *       npx tsx scripts/admin/verifyAndApplyIndexes.ts --apply  (create missing)
 */

import { Client } from 'pg';

// Note: do NOT include `sslmode=...` in the URL. Modern pg versions promote it
// to `verify-full` even when `rejectUnauthorized: false` is set in the client
// options, which fails against the pooler's self-signed cert chain.
const CONNECTION_STRING =
  'postgresql://postgres.pyzgnivilxhnwzfrdkiq:Tanshal4002%21@aws-0-ca-central-1.pooler.supabase.com:5432/postgres';

// Expected indexes. CONCURRENTLY = non-blocking; required for hot prod tables.
// Each entry's `sql` MUST be idempotent (CREATE INDEX IF NOT EXISTS / CONCURRENTLY).
type ExpectedIndex = {
  name: string;
  table: string;
  reason: string;
  sql: string;
};

const EXPECTED: ExpectedIndex[] = [
  {
    name: 'idx_listings_property_hash',
    table: 'listings',
    reason: 'fetchHistoricalListings() WHERE property_hash IN (...) — runs N times per sync batch',
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_listings_property_hash
            ON public.listings USING btree (property_hash);`,
  },
  {
    name: 'idx_listings_listing_key',
    table: 'listings',
    reason: 'Sync orchestrator looks up current rows by listing_key on every upsert',
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_listings_listing_key
            ON public.listings USING btree (listing_key);`,
  },
  {
    name: 'idx_raw_vow_sold_anchor',
    table: 'raw_vow_sold',
    reason: 'AVM anchorService 90-day avg query: (city_region, property_sub_type, close_date)',
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_raw_vow_sold_anchor
            ON public.raw_vow_sold USING btree (city_region, property_sub_type, close_date DESC);`,
  },
  {
    name: 'idx_raw_vow_sold_listing_key',
    table: 'raw_vow_sold',
    reason: 'upsertSoldListings() ON CONFLICT (listing_key) target',
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_raw_vow_sold_listing_key
            ON public.raw_vow_sold USING btree (listing_key);`,
  },
];

async function main() {
  const apply = process.argv.includes('--apply');
  const client = new Client({
    connectionString: CONNECTION_STRING,
    ssl: { rejectUnauthorized: false },
  });

  console.log('🔌 Connecting to Supabase pooler ...');
  await client.connect();
  console.log('✅ Connected.\n');

  try {
    // Pull all indexes on the tables we care about, in one round-trip.
    const tables = Array.from(new Set(EXPECTED.map((e) => e.table)));
    const res = await client.query(
      `SELECT tablename, indexname, indexdef
         FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = ANY($1::text[])
        ORDER BY tablename, indexname;`,
      [tables],
    );

    console.log(`📊 Existing indexes (${res.rows.length}):`);
    for (const row of res.rows) {
      console.log(`   ${row.tablename}.${row.indexname}`);
    }

    const existingNames = new Set<string>(res.rows.map((r: any) => r.indexname));
    const missing = EXPECTED.filter((e) => !existingNames.has(e.name));

    console.log(`\n🔎 Audit: ${EXPECTED.length} expected, ${EXPECTED.length - missing.length} present, ${missing.length} missing.`);
    for (const m of missing) {
      console.log(`   ❌ MISSING ${m.table}.${m.name}`);
      console.log(`      reason: ${m.reason}`);
    }

    if (missing.length === 0) {
      console.log('\n✅ All expected indexes present. Nothing to apply.');
      return;
    }

    if (!apply) {
      console.log('\nDry-run only. Re-run with `--apply` to CREATE the missing indexes.');
      return;
    }

    // CONCURRENTLY cannot run inside a transaction; pg auto-commits each query by default.
    for (const m of missing) {
      console.log(`\n🔨 Creating ${m.name} ...`);
      try {
        const t0 = Date.now();
        await client.query(m.sql);
        console.log(`   ✅ done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      } catch (err: any) {
        console.error(`   ❌ failed: ${err.message}`);
      }
    }

    console.log('\n🧹 Running ANALYZE on touched tables ...');
    for (const t of new Set(missing.map((m) => m.table))) {
      await client.query(`ANALYZE public.${t};`);
      console.log(`   ✅ ANALYZE ${t}`);
    }
  } finally {
    await client.end();
    console.log('\n🔌 Connection closed.');
  }
}

main().catch((err) => {
  console.error('❌ Execution failed:', err.message || err);
  process.exit(1);
});
