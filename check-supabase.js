// Shadow MLS - Check Supabase via Supabase-js client
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log('🔍 Testing Supabase connection via client library...');
console.log('   URL:', supabaseUrl ? '✅ set' : '❌ missing');
console.log('   Key:', supabaseKey ? '✅ set' : '❌ missing');

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase configuration');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkSupabase() {
  try {
    // Query information schema to check property_hash column
    console.log('\n📊 Checking property_hash column...');
    const { data: colData, error: colError } = await supabase
      .from('information_schema.columns')
      .select('column_name, data_type, character_maximum_length')
      .eq('table_name', 'listings')
      .eq('column_name', 'property_hash')
      .single();
    
    if (colError) {
      console.log('   ⚠️  Columns query error (may need RPC):', colError.message);
    } else if (colData) {
      console.log(`   ✅ property_hash: ${colData.data_type}(${colData.character_maximum_length})`);
    } else {
      console.log('   ❌ property_hash column NOT FOUND');
    }
    
    // Check indexes via pg_indexes view (requires RPC or direct query)
    console.log('\n📊 Checking indexes on listings...');
    
    // Use a raw query through the REST API
    const { data: indexData, error: indexError } = await supabase.rpc('pg_catalog', {
      query: "SELECT indexname FROM pg_indexes WHERE tablename = 'listings' AND schemaname = 'public'"
    });
    
    console.log('   Index query result:', indexData, indexError);
    
    // Simple test - count listings to verify connection works
    console.log('\n📊 Testing basic query (count listings)...');
    const { count, error: countError } = await supabase
      .from('listings')
      .select('*', { count: 'exact', head: true });
    
    if (countError) {
      console.log('   ❌ Count query failed:', countError.message);
    } else {
      console.log(`   ✅ Connection works! Listings count: ${count}`);
    }
    
  } catch (err) {
    console.error('❌ Supabase check failed:', err.message);
  }
  
  process.exit(0);
}

checkSupabase();