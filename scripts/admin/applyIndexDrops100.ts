/**
 * Applies migration 100 (drop two duplicate listing_key indexes).
 *
 * Needs its own runner: DROP INDEX CONCURRENTLY cannot run inside a transaction block,
 * and applyMigrationFiles.ts sends the whole file as one simple query (= one implicit
 * transaction). This issues each statement separately, and proves the remaining
 * unique/PK index still serves listing_key lookups before and after.
 *
 * Usage:
 *   npx tsx scripts/admin/applyIndexDrops100.ts            # dry-run: checks + plans only
 *   npx tsx scripts/admin/applyIndexDrops100.ts --apply    # actually drop
 */
import { Client } from 'pg';
import dotenv from 'dotenv';
dotenv.config({ path: ['.env.local', '.env'] });

const APPLY = process.argv.includes('--apply');
const DATABASE_URL = process.env.DATABASE_URL || process.env.DIRECT_DB_URL;
if (!DATABASE_URL) { console.error('❌ No DATABASE_URL'); process.exit(1); }

const DROPS = [
  { index: 'idx_listings_listing_key',     table: 'listings',     keeps: 'listings_listing_key_key' },
  { index: 'idx_raw_vow_sold_listing_key', table: 'raw_vow_sold', keeps: 'raw_vow_sold_pkey' },
];

async function planFor(c: Client, table: string) {
  // A representative point lookup — the access path these indexes exist to serve.
  const { rows } = await c.query(
    `EXPLAIN (FORMAT JSON) SELECT listing_key FROM public.${table} WHERE listing_key = $1`,
    ['X0000000']
  );
  const plan = JSON.stringify(rows[0]['QUERY PLAN']);
  const m = plan.match(/"Index Name":"([^"]+)"/);
  const scanType = plan.match(/"Node Type":"([^"]+)"/);
  return { index: m?.[1] ?? '(none)', node: scanType?.[1] ?? '(unknown)' };
}

async function main() {
  const c = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 600_000 });
  await c.connect();
  console.log(`✅ connected — ${APPLY ? 'APPLY' : 'DRY-RUN'}\n`);
  try {
    // ---- Pre-flight: re-verify the safety conditions at run time, not just at audit time
    const guard = await c.query(`
      SELECT i.relname AS index_name,
             (SELECT conname FROM pg_constraint WHERE conindid = x.indexrelid) AS backs_constraint,
             pg_relation_size(x.indexrelid) AS bytes
      FROM pg_index x JOIN pg_class i ON i.oid = x.indexrelid
      WHERE i.relname = ANY($1)`, [DROPS.map(d => d.index)]);

    for (const g of guard.rows) {
      if (g.backs_constraint) {
        console.error(`❌ ABORT: ${g.index_name} backs constraint ${g.backs_constraint} — not a duplicate.`);
        process.exit(1);
      }
    }
    const fk = await c.query(`
      SELECT count(*)::int n FROM pg_constraint
      WHERE contype='f' AND (confrelid IN ('public.listings'::regclass,'public.raw_vow_sold'::regclass)
                          OR conrelid  IN ('public.listings'::regclass,'public.raw_vow_sold'::regclass))`);
    if (fk.rows[0].n > 0) {
      console.error(`❌ ABORT: ${fk.rows[0].n} foreign key(s) now reference these tables — an index may be required.`);
      process.exit(1);
    }
    console.log('✅ pre-flight: neither index backs a constraint; no foreign keys on either table\n');

    const before = guard.rows.reduce((s, r) => s + Number(r.bytes), 0);
    console.log(`   duplicate index footprint: ${(before / 1024 / 1024).toFixed(1)} MB\n`);

    // ---- Plans BEFORE
    console.log('   plan before:');
    const planBefore: Record<string, { index: string; node: string }> = {};
    for (const d of DROPS) {
      planBefore[d.table] = await planFor(c, d.table);
      console.log(`     ${d.table.padEnd(14)} ${planBefore[d.table].node} using ${planBefore[d.table].index}`);
    }

    if (!APPLY) {
      console.log('\n(dry-run — nothing dropped. Re-run with --apply)');
      return;
    }

    // ---- Drop, one standalone statement each (CONCURRENTLY = no txn block)
    console.log('');
    for (const d of DROPS) {
      const t = Date.now();
      await c.query(`DROP INDEX CONCURRENTLY IF EXISTS public.${d.index}`);
      console.log(`   ✅ dropped ${d.index} (${((Date.now() - t) / 1000).toFixed(1)}s)`);
    }

    // ---- Plans AFTER — must still be an index scan, now on the surviving unique/PK index
    console.log('\n   plan after:');
    let regressed = false;
    for (const d of DROPS) {
      const p = await planFor(c, d.table);
      const ok = /Index/.test(p.node) && p.index === d.keeps;
      if (!ok) regressed = true;
      console.log(`     ${d.table.padEnd(14)} ${p.node} using ${p.index}  ${ok ? '✅' : '❌ EXPECTED ' + d.keeps}`);
    }
    if (regressed) {
      console.error('\n❌ A lookup no longer uses the expected index. Roll back with:');
      for (const d of DROPS) console.error(`   CREATE INDEX CONCURRENTLY ${d.index} ON public.${d.table} USING btree (listing_key);`);
      process.exit(1);
    }

    await c.query(
      `INSERT INTO public.schema_migrations (filename, applied_via)
       VALUES ('100_drop_duplicate_listing_key_indexes.sql','apply') ON CONFLICT DO NOTHING`
    );
    console.log(`\n✅ done — freed ~${(before / 1024 / 1024).toFixed(1)} MB, both lookups still index-served`);
  } finally {
    await c.end();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error('❌ failed:', e?.message || e); process.exit(1); });
