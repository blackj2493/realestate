/**
 * Shadow MLS - Migration Executor via Supabase REST API
 * 
 * Executes DDL statements directly against Supabase PostgreSQL
 * using the REST API (bypasses connection pooler transaction wrapping).
 * 
 * For CONCURRENTLY index operations, we must use direct pg connection.
 * This script uses the Supabase project's REST API endpoint.
 * 
 * Run: npx tsx scripts/admin/execute-migration.ts
 */

import dotenv from 'dotenv';
dotenv.config();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing Supabase configuration');
  process.exit(1);
}

const headers = {
  'apikey': SUPABASE_SERVICE_KEY,
  'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=minimal'
};

async function execSQL(sql: string): Promise<{ success: boolean; error?: string }> {
  console.log('📤 Executing SQL via REST API...');
  console.log('   SQL:', sql.substring(0, 80) + '...');
  
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query: sql })
    });
    
    if (!response.ok) {
      const error = await response.text();
      return { success: false, error: `HTTP ${response.status}: ${error}` };
    }
    
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

async function checkIndexStatus(): Promise<boolean> {
  console.log('\n🔍 Checking current index status...');
  
  try {
    // Query pg_indexes via REST API
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/?select=indexname,indexdef&schemaname=eq.public&tablename=eq.listings`,
      { headers }
    );
    
    if (!response.ok) {
      console.log('   ⚠️  Could not query indexes via REST API');
      return false;
    }
    
    const indexes = await response.json();
    const propHashIdx = indexes.find((idx: any) => idx.indexname === 'idx_listings_property_hash');
    
    if (propHashIdx) {
      console.log('   ✅ idx_listings_property_hash EXISTS');
      console.log(`   Definition: ${propHashIdx.indexdef}`);
      return true;
    } else {
      console.log('   ❌ idx_listings_property_hash NOT FOUND');
      return false;
    }
  } catch (err: any) {
    console.log('   ⚠️  Index check error:', err.message);
    return false;
  }
}

async function runMigration() {
  console.log('\n🔧 Shadow MLS - Index Migration via REST API');
  console.log('============================================\n');
  
  console.log('⚠️  IMPORTANT: For CONCURRENTLY operations, use Supabase Dashboard SQL Editor');
  console.log('   The REST API does not support non-transactional DDL.\n');
  
  console.log('📋 Migration SQL to execute in Supabase SQL Editor:');
  console.log('═'.repeat(60));
  console.log(`
-- Step 1: Commit any pending transaction (required for CONCURRENTLY)
COMMIT;

-- Step 2: Drop existing index
DROP INDEX IF EXISTS public.idx_listings_property_hash;

-- Step 3: Recreate index concurrently (zero-downtime)
CREATE INDEX CONCURRENTLY idx_listings_property_hash 
ON public.listings USING btree (property_hash);

-- Step 4: Verify and analyze
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'listings' AND indexname = 'idx_listings_property_hash'
  ) THEN
    RAISE NOTICE '✅ Index idx_listings_property_hash created successfully';
  END IF;
END $$;

ANALYZE public.listings;
`);
  console.log('═'.repeat(60));
  
  // Check current index status
  const indexExists = await checkIndexStatus();
  
  console.log('\n📊 Current Index Status:', indexExists ? 'EXISTS' : 'MISSING');
  
  console.log('\n📋 Next Steps:');
  console.log('1. Copy the SQL above');
  console.log('2. Go to: https://supabase.com/dashboard/project/pyzgnivilxhnwzfrdkiq/sql');
  console.log('3. Paste and execute in the SQL Editor');
  console.log('4. Return here and run: npx tsx scripts/worker/ingester.ts sync');
  
  console.log('\n============================================');
  console.log('✅ Migration instructions generated');
  console.log('============================================\n');
  
  process.exit(0);
}

runMigration().catch(err => {
  console.error('❌ Migration script failed:', err.message);
  process.exit(1);
});