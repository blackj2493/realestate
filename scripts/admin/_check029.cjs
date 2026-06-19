/**
 * One-shot: check whether migration 029 (profiles VOW-terms columns) is applied;
 * apply it if missing (instant DDL, idempotent ADD COLUMN IF NOT EXISTS).
 * Delete after use.
 */
require('dotenv').config({ path: ['.env.local', '.env'] });
const fs = require('fs');
const { Client } = require('pg');

const VERIFY = `
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='profiles'
  AND column_name IN ('terms_accepted_at','terms_version','bona_fide_attested')
ORDER BY column_name;`;

(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    let { rows } = await client.query(VERIFY);
    if (rows.length === 3) {
      console.log('029 already applied:', rows.map((r) => r.column_name).join(', '));
      return;
    }
    console.log(`029 missing (${rows.length}/3 columns) — applying...`);
    await client.query("SET statement_timeout TO '60s'");
    await client.query(fs.readFileSync('supabase/migrations/029_profile_vow_terms.sql', 'utf8'));
    ({ rows } = await client.query(VERIFY));
    console.log(`Applied. ${rows.length}/3 columns present:`, rows.map((r) => r.column_name).join(', '));
  } finally {
    await client.end();
  }
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
