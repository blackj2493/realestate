require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log('Testing Supabase connection...');
console.log('URL:', url ? 'Set' : 'MISSING');

async function test() {
  if (!url || !key) {
    console.log('❌ Missing environment variables');
    return;
  }
  
  try {
    const client = createClient(url, key, {
      auth: { persistSession: false }
    });
    
    // Count listings
    const { data, error, count } = await client
      .from('listings')
      .select('*', { count: 'exact', head: true })
      .limit(5);
    
    if (error) {
      console.log('❌ Supabase Error:', error.message);
    } else {
      console.log('✅ Supabase connected! Count:', count);
      if (data && data.length > 0) {
        console.log('Sample listing lat/lng:', data[0].Latitude, data[0].Longitude);
      }
    }
  } catch (err) {
    console.log('❌ Exception:', err.message);
  }
}

test();