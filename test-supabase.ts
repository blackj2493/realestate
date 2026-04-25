import 'dotenv/config';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log('Testing Supabase connection...');
console.log('URL:', SUPABASE_URL);
console.log('Key exists:', !!SERVICE_KEY);

async function test() {
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/`, {
      headers: {
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`
      }
    });
    console.log('Status:', response.status);
    if (response.ok) {
      console.log('✅ Supabase connection OK');
    } else {
      const text = await response.text();
      console.log('❌ Error:', text.substring(0, 200));
    }
  } catch (err: any) {
    console.log('❌ Fetch error:', err.message);
  }
}

test();