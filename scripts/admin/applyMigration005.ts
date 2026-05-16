/**
 * Shadow MLS - Apply Migration 005: Carry Cost & Suite Columns
 * 
 * Run: npx tsx scripts/admin/applyMigration005.ts
 */

import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';
dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL not found in environment');
  process.exit(1);
}

async function applyMigration() {
  console.log('\n🔧 Shadow MLS - Migration 005: Carry Cost & Suite Columns');
  console.log('============================================================\n');

  console.log('📡 Connecting to Supabase PostgreSQL...');

  const client = new Client({
    connectionString: DATABASE_URL,
    connectionTimeoutMillis: 15000,
  });

  try {
    await client.connect();
    console.log('   ✅ Connected to PostgreSQL\n');

    // Read migration file
    const migrationPath = path.join(__dirname, '../../supabase/migrations/005_add_carry_cost_suite_columns.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf-8');

    console.log('📝 Executing migration SQL...');
    console.log('   - Adding carry_cost JSONB column');
    console.log('   - Adding suite_status, suite_score, suite_flags columns');
    console.log('   - Adding true_dom, is_stale, campaign_block_id, dead_days columns');
    console.log('   - Adding individual carry cost component columns');
    console.log('   - Creating indexes on monthly_carry_cost, suite_status, true_dom\n');

    await client.query(migrationSQL);

    console.log('✅ Migration applied successfully!\n');

    // Verify columns were added
    console.log('🔍 Verifying schema changes...');
    const columns = await client.query(`
      SELECT column_name, data_type, column_default
      FROM information_schema.columns
      WHERE table_name = 'listings' 
      AND column_name IN (
        'carry_cost', 'suite_status', 'suite_score', 'suite_flags',
        'true_dom', 'is_stale', 'campaign_block_id', 'dead_days',
        'monthly_carry_cost', 'monthly_mortgage', 'monthly_property_tax',
        'monthly_hoa', 'monthly_insurance', 'monthly_capex'
      )
      ORDER BY column_name;
    `);

    if (columns.rows.length > 0) {
      console.log('\n📊 Columns created:');
      for (const col of columns.rows) {
        const type = col.data_type === 'jsonb' ? 'JSONB' : col.data_type;
        console.log(`   ✅ ${col.column_name} (${type})`);
      }
    } else {
      console.log('   ⚠️  No columns found - they may already exist');
    }

    // List indexes created
    const indexes = await client.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE tablename = 'listings' 
      AND indexname IN ('idx_listings_monthly_carry_cost', 'idx_listings_suite_status', 'idx_listings_true_dom');
    `);

    if (indexes.rows.length > 0) {
      console.log('\n📊 Indexes created:');
      for (const idx of indexes.rows) {
        console.log(`   ✅ ${idx.indexname}`);
      }
    }

    console.log('\n============================================================');
    console.log('✅ Supabase Migration 005 Complete!');
    console.log('============================================================\n');

  } catch (error: any) {
    console.error('\n❌ Migration failed!');
    console.error('   Error:', error.message);

    if (error.code === 'ECONNREFUSED') {
      console.error('   → Connection refused. Check DATABASE_URL and network access.');
    } else if (error.code === '28P01') {
      console.error('   → Authentication failed. Check credentials in DATABASE_URL.');
    } else if (error.code === '42P01') {
      console.error('   → Table "listings" does not exist.');
    } else if (error.code === '42701') {
      console.error('   → Column or index already exists (this is OK).');
    }

    throw error;
  } finally {
    await client.end();
    console.log('🔌 Connection closed.\n');
  }
}

applyMigration()
  .then(() => {
    console.log('✅ Migration script completed successfully.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Migration script failed:', error.message);
    process.exit(1);
  });