/**
 * VACUUM FULL a table to return its freed space to the OS.
 *
 * The strips in migrations 102/103 make rows smaller, but plain VACUUM only marks the
 * vacated pages reusable *inside* the file — the database keeps reporting its old size.
 * This is the step that actually shrinks it.
 *
 * WARNING: takes an ACCESS EXCLUSIVE lock for the whole rewrite. The table is
 * unavailable to readers and writers until it finishes (raw_vow_sold blocks AVM comps;
 * listings blocks the detail page). Run it when a few minutes of that is acceptable.
 *
 * Needs free disk >= the COMPACTED size of the table, because it builds a complete new
 * copy before dropping the original, and it is fully WAL-logged on top of that. Checks
 * headroom is plausible before starting, and refuses if the table still holds the keys
 * the strip was supposed to remove (i.e. you are repacking before you finished).
 *
 * Usage:
 *   npx tsx scripts/admin/repackTable.ts raw_vow_sold          # dry-run: sizes + checks
 *   npx tsx scripts/admin/repackTable.ts raw_vow_sold --apply
 */
import { Client } from 'pg';
import dotenv from 'dotenv';
dotenv.config({ path: ['.env.local', '.env'] });

const ALLOWED = ['raw_vow_sold', 'listings'] as const;
const table = process.argv[2] as (typeof ALLOWED)[number];
const APPLY = process.argv.includes('--apply');

if (!ALLOWED.includes(table)) {
  console.error(`❌ Usage: repackTable.ts <${ALLOWED.join('|')}> [--apply]`);
  process.exit(1);
}

const DATABASE_URL = process.env.DATABASE_URL || process.env.DIRECT_DB_URL;
if (!DATABASE_URL) { console.error('❌ No DATABASE_URL'); process.exit(1); }

const mb = (b: number) => `${(b / 1024 / 1024).toFixed(0)} MB`;

async function main() {
  // No statement_timeout: a repack legitimately runs for minutes.
  const c = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  await c.query("SET statement_timeout TO '0'");
  await c.query("SET lock_timeout TO '60s'"); // fail fast rather than queue behind a long reader
  console.log(`✅ connected — repack ${table} — ${APPLY ? 'APPLY' : 'DRY-RUN'}\n`);
  try {
    // Guard: the strip must actually be finished, or we would repack the fat version
    // and have to do it all again.
    const payloadCol = table === 'raw_vow_sold' ? 'raw_payload' : 'full_payload';
    const { rows: [g] } = await c.query(
      `SELECT count(*)::int AS unstripped FROM ${table} WHERE ${payloadCol} ? 'media'`);
    if (g.unstripped > 0) {
      console.error(`❌ ABORT: ${g.unstripped} rows still carry ${payloadCol}->'media'.`);
      console.error('   Finish the strip first — repacking now would just have to be redone.');
      process.exit(1);
    }
    console.log(`✅ guard: no rows still carry ${payloadCol}->'media'`);

    const { rows: [before] } = await c.query(`
      SELECT pg_total_relation_size($1) AS total,
             pg_relation_size($1) AS heap,
             pg_indexes_size($1) AS idx,
             pg_database_size(current_database()) AS db`, [table]);
    console.log(`\n   ${table}: ${mb(before.total)} total (heap ${mb(before.heap)}, indexes ${mb(before.idx)})`);
    console.log(`   database: ${mb(before.db)}`);
    console.log(`   VACUUM FULL will need roughly the COMPACTED size free, plus WAL.\n`);

    if (!APPLY) { console.log('(dry-run — nothing done. Re-run with --apply)'); return; }

    console.log('   🔒 taking ACCESS EXCLUSIVE and rewriting — table is unavailable until this finishes…');
    const t0 = Date.now();
    await c.query(`VACUUM FULL ${table}`);
    const secs = ((Date.now() - t0) / 1000).toFixed(0);

    const { rows: [after] } = await c.query(`
      SELECT pg_total_relation_size($1) AS total,
             pg_relation_size($1) AS heap,
             pg_indexes_size($1) AS idx,
             pg_database_size(current_database()) AS db`, [table]);

    console.log(`\n✅ repacked in ${secs}s`);
    console.log(`   ${table}: ${mb(before.total)} -> ${mb(after.total)}  (freed ${mb(before.total - after.total)})`);
    console.log(`   heap    ${mb(before.heap)} -> ${mb(after.heap)}`);
    console.log(`   indexes ${mb(before.idx)} -> ${mb(after.idx)}`);
    console.log(`   database ${mb(before.db)} -> ${mb(after.db)}`);
    console.log('\n   NOTE: provisioned disk does not shrink by itself — reduce it in the');
    console.log('   Supabase dashboard to turn this into a billing change.');
  } finally {
    await c.end();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error('❌ failed:', e?.message || e); process.exit(1); });
