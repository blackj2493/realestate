/**
 * Shadow MLS - Database State Verification Script
 * 
 * Verifies the exact status of idx_listings_property_hash and related schema.
 * Outputs diagnostic info for debugging timeouts.
 * 
 * Run: npx tsx scripts/admin/verify-db-state.ts
 */

import { Client } from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL not found in environment');
  process.exit(1);
}

async function verifyDatabaseState() {
  console.log('\n🔍 Shadow MLS - Database State Verification');
  console.log('============================================\n');

  const client = new Client({
    connectionString: DATABASE_URL,
    connectionTimeoutMillis: 15000,
  });

  try {
    await client.connect();
    console.log('✅ Connected to PostgreSQL\n');

    // 1. Check property_hash column data type
    console.log('📋 STEP 1: Verifying property_hash column...');
    const colResult = await client.query(`
      SELECT 
        column_name, 
        data_type, 
        character_maximum_length,
        is_nullable
      FROM information_schema.columns 
      WHERE table_name = 'listings' AND column_name = 'property_hash'
    `);
    
    if (colResult.rows.length > 0) {
      const col = colResult.rows[0];
      console.log(`   ✅ property_hash exists: ${col.data_type}(${col.character_maximum_length})`);
      console.log(`      Nullable: ${col.is_nullable}`);
    } else {
      console.log('   ❌ property_hash column NOT FOUND');
    }

    // 2. Check all indexes on listings table
    console.log('\n📋 STEP 2: Checking indexes on listings table...');
    const indexResult = await client.query(`
      SELECT 
        indexname, 
        indexdef,
        indisunique
      FROM pg_indexes 
      WHERE tablename = 'listings'
      ORDER BY indexname
    `);
    
    console.log(`   Found ${indexResult.rows.length} indexes:`);
    for (const idx of indexResult.rows) {
      const uniqueFlag = idx.indisunique ? ' (UNIQUE)' : '';
      console.log(`   - ${idx.indexname}${uniqueFlag}`);
      console.log(`     → ${idx.indexdef}`);
    }

    // 3. Check if idx_listings_property_hash specifically exists and its method
    console.log('\n📋 STEP 3: Verifying idx_listings_property_hash...');
    const propHashIdx = indexResult.rows.find(idx => idx.indexname === 'idx_listings_property_hash');
    
    if (propHashIdx) {
      console.log('   ✅ idx_listings_property_hash EXISTS');
      console.log(`      Definition: ${propHashIdx.indexdef}`);
      
      // Check if it's a B-tree index
      if (propHashIdx.indexdef.includes('btree')) {
        console.log('      Type: B-Tree (correct)');
      } else {
        console.log('      ⚠️  Type: NOT B-Tree (may cause performance issues)');
      }
    } else {
      console.log('   ❌ idx_listings_property_hash NOT FOUND');
    }

    // 4. Check table statistics for query planner
    console.log('\n📋 STEP 4: Table statistics for query planner...');
    const statsResult = await client.query(`
      SELECT 
        relname,
        n_live_tup as estimated_rows,
        n_dead_tup as dead_rows,
        last_analyze,
        last_autoanalyze,
        idx_scan,
        idx_tup_read,
        idx_tup_fetch
      FROM pg_stat_user_tables 
      WHERE relname = 'listings'
    `);
    
    if (statsResult.rows.length > 0) {
      const stats = statsResult.rows[0];
      console.log(`   Table: ${stats.relname}`);
      console.log(`   Estimated rows: ${stats.estimated_rows}`);
      console.log(`   Dead rows: ${stats.dead_rows}`);
      console.log(`   Last ANALYZE: ${stats.last_analyze || 'never'}`);
      console.log(`   Last AUTOANALYZE: ${stats.last_autoanalyze || 'never'}`);
      console.log(`   Index scans: ${stats.idx_scan}`);
      console.log(`   Index tuples read: ${stats.idx_tup_read}`);
      console.log(`   Index tuples fetched: ${stats.idx_tup_fetch}`);
    }

    // 5. Check current index size
    console.log('\n📋 STEP 5: Index sizes...');
    const sizeResult = await client.query(`
      SELECT 
        indexname,
        pg_size_pretty(pg_relation_size(indexrelid)) as index_size
      FROM pg_stat_user_indexes
      WHERE relname = 'listings'
      AND indexname LIKE 'idx_listings_%'
      ORDER BY pg_relation_size(indexrelid) DESC
    `);
    
    for (const idx of sizeResult.rows) {
      console.log(`   ${idx.indexname}: ${idx.index_size}`);
    }

    // 6. Explain analyze for a sample IN clause query
    console.log('\n📋 STEP 6: Sample EXPLAIN ANALYZE for chunked property_hash IN query...');
    const explainResult = await client.query(`
      EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
      SELECT id, property_hash, created_at 
      FROM listings 
      WHERE property_hash IN (
        'hash_sample_1', 'hash_sample_2', 'hash_sample_3',
        'hash_sample_4', 'hash_sample_5', 'hash_sample_6',
        'hash_sample_7', 'hash_sample_8', 'hash_sample_9',
        'hash_sample_10', 'hash_sample_11', 'hash_sample_12',
        'hash_sample_13', 'hash_sample_14', 'hash_sample_15',
        'hash_sample_16', 'hash_sample_17', 'hash_sample_18',
        'hash_sample_19', 'hash_sample_20', 'hash_sample_21',
        'hash_sample_22', 'hash_sample_23', 'hash_sample_24',
        'hash_sample_25'
      )
      AND listing_key NOT IN ('EXCLUDE_1', 'EXCLUDE_2')
    `);
    
    console.log('\n   Query Plan:');
    console.log('   ' + explainResult.rows.map(r => r['QUERY PLAN']).join('\n   '));

    console.log('\n============================================');
    console.log('✅ Database verification complete');
    console.log('============================================\n');

  } catch (error: any) {
    console.error('\n❌ Database verification failed!');
    console.error('   Error:', error.message);
    console.error('   Code:', error.code);
    throw error;
  } finally {
    await client.end();
    console.log('🔌 Connection closed.\n');
  }
}

verifyDatabaseState()
  .then(() => {
    console.log('✅ Verification script completed.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Verification script failed:', error.message);
    process.exit(1);
  });