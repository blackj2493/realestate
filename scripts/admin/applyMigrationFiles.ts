// scripts/admin/applyMigrationFiles.ts
/**
 * Apply one or more migration files (by filename) via the Session pooler, in order.
 * Additive DDL / CREATE OR REPLACE only — no transaction wrapper across files so a
 * later failure leaves earlier (idempotent) files applied. Requires DATABASE_URL.
 *
 * Every successful apply is recorded in the `schema_migrations` ledger (migration 087), so
 * "which migrations are actually live?" is answerable and the nightly data-health canary can
 * alert on an unapplied one. That gap is how migration 082 sat unapplied for days while the
 * app served stale numbers — it failed silently rather than erroring.
 *
 * Usage:
 *   npx tsx scripts/admin/applyMigrationFiles.ts 064_foo.sql 065_bar.sql
 *   npx tsx scripts/admin/applyMigrationFiles.ts --baseline   # record ALL current files as
 *                                                             # applied WITHOUT running them
 *
 * --baseline exists because the ledger arrives after ~86 migrations that are demonstrably
 * already live; run it once so the canary's diff is meaningful. It never executes SQL.
 */
import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: ['.env.local', '.env'] });

const DATABASE_URL = process.env.DATABASE_URL || process.env.DIRECT_DB_URL;
if (!DATABASE_URL) { console.error('❌ No DATABASE_URL'); process.exit(1); }

const MIGRATIONS_DIR = path.join(__dirname, '../../supabase/migrations');

const args = process.argv.slice(2);
const BASELINE = args.includes('--baseline');
const files = args.filter((a) => !a.startsWith('--'));
if (!BASELINE && files.length === 0) {
  console.error('❌ Pass at least one migration filename (or --baseline)');
  process.exit(1);
}

/** Record an applied file. Best-effort: never fail an applied migration over bookkeeping. */
async function record(
  client: Client,
  filename: string,
  via: 'apply' | 'baseline',
  durationMs: number | null
): Promise<void> {
  try {
    await client.query(
      `INSERT INTO schema_migrations (filename, applied_via, duration_ms)
       VALUES ($1, $2, $3)
       ON CONFLICT (filename) DO UPDATE
         SET applied_at = now(), applied_via = EXCLUDED.applied_via, duration_ms = EXCLUDED.duration_ms`,
      [filename, via, durationMs]
    );
  } catch (e) {
    // The ledger itself may not exist yet (087 not applied) — that must not break an apply.
    console.warn(`   ⚠️  could not record ${filename} in schema_migrations: ${e instanceof Error ? e.message : e}`);
  }
}

async function main() {
  const client = new Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 15000, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log('✅ connected');
  try {
    if (BASELINE) {
      const all = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
      console.log(`📋 Baselining ${all.length} migration file(s) as applied (no SQL executed)…`);
      for (const f of all) await record(client, f, 'baseline', null);
      const { rows } = await client.query('SELECT count(*)::int AS n FROM schema_migrations');
      console.log(`✅ ledger now holds ${rows[0].n} file(s)`);
      return;
    }
    for (const f of files) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf-8');
      const t = Date.now();
      await client.query(sql);
      const ms = Date.now() - t;
      console.log(`✅ applied ${f} (${(ms / 1000).toFixed(1)}s)`);
      await record(client, f, 'apply', ms);
    }
  } finally {
    await client.end();
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error('❌ failed:', e?.message || e); process.exit(1); });
