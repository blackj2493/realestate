/**
 * Shadow MLS - Supabase Migration Script
 * 
 * Applies the property_hash column and indexes to the listings table.
 * Uses raw PostgreSQL via 'pg' module to execute DDL commands.
 * 
 * Run: npx tsx scripts/admin/applyMigration.ts
 */

import { Client } from 'pg';

// Load environment variables
import dotenv from 'dotenv';
dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL not found in environment');
  process.exit(1);
}

async function applyMigration() {
  console.log('\n🔧 Shadow MLS - Supabase Migration');
  console.log('==================================\n');
  
  console.log('📡 Connecting to Supabase PostgreSQL...');
  
  const client = new Client({
    connectionString: DATABASE_URL,
    connectionTimeoutMillis: 10000, // 10 second timeout
  });

  try {
    await client.connect();
    console.log('   ✅ Connected to PostgreSQL\n');

    // Execute migration SQL
    const migrationSQL = `
-- Add property_hash column (VARCHAR for SHA-256 hex = 64 chars)
ALTER TABLE listings 
ADD COLUMN IF NOT EXISTS property_hash VARCHAR(64);

-- Create index for efficient property_hash lookups
-- Critical for ETL worker batch processing (1 query, group locally pattern)
CREATE INDEX IF NOT EXISTS idx_listings_property_hash 
ON listings(property_hash);

-- Optional: Index on (property_hash, listing_key) for exact matches
CREATE INDEX IF NOT EXISTS idx_listings_property_hash_listing_key 
ON listings(property_hash, listing_key);

-- Index on listing_key for quick current listing lookups
CREATE INDEX IF NOT EXISTS idx_listings_listing_key 
ON listings(listing_key);

COMMENT ON COLUMN listings.property_hash IS 
  'SHA-256 hash of normalized address (UnitNumber|StreetNumber|StreetName|City).
   Used for Entity Resolution to link historical listing chains and calculate True DOM.';
`;

    console.log('📝 Executing migration SQL...');
    console.log('   - Adding property_hash VARCHAR(64) column');
    console.log('   - Creating idx_listings_property_hash index');
    console.log('   - Creating idx_listings_property_hash_listing_key index');
    console.log('   - Creating idx_listings_listing_key index\n');

    await client.query(migrationSQL);
    
    console.log('✅ Migration applied successfully!\n');

    // Verify the column was added
    console.log('🔍 Verifying schema changes...');
    const result = await client.query(`
      SELECT column_name, data_type, character_maximum_length
      FROM information_schema.columns
      WHERE table_name = 'listings' AND column_name = 'property_hash';
    `);

    if (result.rows.length > 0) {
      const col = result.rows[0];
      console.log(`   ✅ property_hash column exists: ${col.data_type}(${col.character_maximum_length})`);
    } else {
      console.log('   ⚠️  property_hash column not found (may already exist)');
    }

    // List indexes
    const indexes = await client.query(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'listings' AND indexname LIKE 'idx_listings_%';
    `);
    
    console.log('\n📊 Indexes created:');
    for (const idx of indexes.rows) {
      console.log(`   - ${idx.indexname}`);
    }

    console.log('\n==================================');
    console.log('✅ Supabase Migration Complete!');
    console.log('==================================\n');

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
    // Always close the connection
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