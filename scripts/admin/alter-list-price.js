// Shadow MLS - ALTER listings.list_price  BIGINT -> NUMERIC  (direct pg connection)
//
// Why: commercial LEASE listings are priced per square foot (fractional ListPrice
// like 16.95), but list_price was created as BIGINT, so those upserts fail with
// "invalid input syntax for type bigint". The Supabase SQL Editor times out on
// this change because BIGINT->NUMERIC rewrites the whole table over the REST
// gateway. This script connects directly via DATABASE_URL (same as check-db.js),
// disables the per-statement timeout, and runs the rewrite.
//
// Safe to re-run: it checks the current type and exits early if already numeric.
//
// Run:  node scripts/admin/alter-list-price.js
//   (plain node — no npx/tsx, avoids the npx file-association issue)

const { Client } = require('pg');
require('dotenv').config();

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL is not set in .env (check-db.js relies on the same var)');
    process.exit(1);
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 15000,
  });

  await client.connect();
  console.log('✅ Connected to PostgreSQL');

  const typeQuery = `
    SELECT data_type FROM information_schema.columns
    WHERE table_name = 'listings' AND column_name = 'list_price'
  `;

  const { rows } = await client.query(typeQuery);
  const current = rows[0] && rows[0].data_type;
  console.log(`   Current list_price type: ${current}`);

  if (current === 'numeric') {
    console.log('✅ Already numeric — nothing to do.');
    await client.end();
    return;
  }

  // Full-table rewrite — remove the per-statement timeout for this session.
  await client.query('SET statement_timeout = 0');

  console.log('🚀 Running ALTER (full-table rewrite — may take a few minutes)...');
  const t0 = Date.now();
  await client.query(
    'ALTER TABLE listings ALTER COLUMN list_price TYPE numeric USING list_price::numeric'
  );
  console.log(`✅ ALTER complete in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const after = await client.query(typeQuery);
  console.log(`   list_price type is now: ${after.rows[0] && after.rows[0].data_type}`);

  await client.end();
  console.log('🔌 Done.');
}

main().catch((err) => {
  console.error('❌ Failed:', err.message);
  if (err.code) console.error('   Code:', err.code);
  console.error('\n   If this is a pooler/timeout error, point DATABASE_URL at the');
  console.error('   Direct connection or Session pooler (port 5432) and retry.');
  process.exit(1);
});
