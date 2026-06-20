/**
 * Apply Migration 045: flat dimension columns on `listings`.
 * Pure nullable ADD COLUMN (instant catalog change, no 136k-row rewrite).
 * Run: npx tsx scripts/admin/applyMigration045.ts   (needs DATABASE_URL / DIRECT_DB_URL)
 */

import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: ['.env.local', '.env'] });

const DATABASE_URL = process.env.DATABASE_URL || process.env.DIRECT_DB_URL;
if (!DATABASE_URL) {
  console.error('❌ No connection string found (set DATABASE_URL or DIRECT_DB_URL)');
  process.exit(1);
}

async function applyMigration() {
  console.log('\n🔧 Migration 045: listings flat dimension columns');
  console.log('============================================\n');
  const client = new Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 15000 });
  try {
    await client.connect();
    console.log('   ✅ Connected to PostgreSQL\n');

    const sql = fs.readFileSync(
      path.join(__dirname, '../../supabase/migrations/045_listings_dimension_columns.sql'),
      'utf-8'
    );
    console.log('📝 Executing migration SQL (ALTER TABLE listings ADD COLUMN ...)...');
    await client.query(sql);
    console.log('✅ Migration applied successfully!\n');

    // Confirm the five columns now exist.
    const cols = await client.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'listings'
        AND column_name IN ('bedrooms_total','bathrooms_total_integer','parking_total','lot_width','basement_tier')
      ORDER BY column_name`);
    console.log('📊 New columns on listings:');
    for (const r of cols.rows) console.log(`   • ${r.column_name} ${r.data_type}`);
    console.log(cols.rows.length === 5 ? '   ✅ all 5 present\n' : `   ⚠️  expected 5, found ${cols.rows.length}\n`);

    console.log('============================================');
    console.log('✅ Migration 045 Complete!  Next: run the backfill, then migration 046.');
    console.log('   npx tsx scripts/admin/backfill-listings-dimensions.ts --apply');
    console.log('============================================\n');
  } catch (error: unknown) {
    console.error('\n❌ Migration failed!');
    console.error('   Error:', (error as { message?: string }).message);
    throw error;
  } finally {
    await client.end();
    console.log('🔌 Connection closed.\n');
  }
}

applyMigration().then(() => process.exit(0)).catch(() => process.exit(1));
