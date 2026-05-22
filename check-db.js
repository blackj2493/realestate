// Shadow MLS - Direct Supabase Connection Check
const { Client } = require('pg');
require('dotenv').config();

async function checkConnection() {
  console.log('🔍 Testing direct PostgreSQL connection to Supabase...');
  
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 15000,
  });

  try {
    await client.connect();
    console.log('✅ Connected to PostgreSQL');
    
    // Check current database and schema
    const dbResult = await client.query('SELECT current_database(), current_schema()');
    console.log('   Database:', dbResult.rows[0].current_database);
    console.log('   Schema:', dbResult.rows[0].current_schema);
    
    // Check indexes on listings table
    console.log('\n📊 Indexes on listings table:');
    const indexResult = await client.query(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'listings'
      AND schemaname = 'public'
      ORDER BY indexname
    `);
    
    if (indexResult.rows.length === 0) {
      console.log('   No indexes found');
    } else {
      for (const idx of indexResult.rows) {
        console.log(`   - ${idx.indexname}`);
        console.log(`     ${idx.indexdef}`);
      }
    }
    
    // Check if property_hash column exists
    console.log('\n📊 Checking property_hash column:');
    const colResult = await client.query(`
      SELECT column_name, data_type, character_maximum_length
      FROM information_schema.columns
      WHERE table_name = 'listings'
      AND column_name = 'property_hash'
    `);
    
    if (colResult.rows.length === 0) {
      console.log('   property_hash column NOT FOUND');
    } else {
      console.log(`   property_hash: ${colResult.rows[0].data_type}(${colResult.rows[0].character_maximum_length})`);
    }
    
    // Check table row count estimate
    console.log('\n📊 Table statistics:');
    const statsResult = await client.query(`
      SELECT relname, n_live_tup, n_dead_tup, last_analyze
      FROM pg_stat_user_tables
      WHERE relname = 'listings'
    `);
    
    if (statsResult.rows.length > 0) {
      console.log(`   Estimated rows: ${statsResult.rows[0].n_live_tup}`);
      console.log(`   Dead rows: ${statsResult.rows[0].n_dead_tup}`);
      console.log(`   Last analyze: ${statsResult.rows[0].last_analyze || 'never'}`);
    }
    
    console.log('\n✅ Connection test complete');
    
  } catch (err) {
    console.error('❌ Connection failed:', err.message);
    console.error('   Code:', err.code);
  } finally {
    await client.end();
    console.log('🔌 Connection closed');
    process.exit(0);
  }
}

checkConnection();