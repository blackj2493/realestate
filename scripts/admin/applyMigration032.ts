/**
 * Apply migration 032 (property_campaign_history) via the Session pooler.
 * Requires DATABASE_URL = Supabase Session pooler string (CLAUDE.md §12).
 * Run: npx tsx --env-file=.env scripts/admin/applyMigration032.ts
 */
import { Client } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';

async function main() {
  const cs = (process.env.DATABASE_URL || '').trim();
  if (!cs) {
    console.error('❌ DATABASE_URL not set (use the Supabase Session pooler string).');
    process.exit(1);
  }
  const sql = readFileSync(
    join(process.cwd(), 'supabase/migrations/032_create_property_campaign_history.sql'),
    'utf8'
  );
  const client = new Client({ connectionString: cs, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query("SET statement_timeout TO '60000'");
    await client.query(sql);
    const { rows } = await client.query(
      "SELECT to_regclass('public.property_campaign_history') AS tbl"
    );
    console.log(`✅ Applied. property_campaign_history = ${rows[0].tbl}`);
  } finally {
    await client.end();
  }
}
main().catch((e) => {
  console.error('CRASH', e.message);
  process.exit(1);
});
