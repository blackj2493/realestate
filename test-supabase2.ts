import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;

console.log('Testing Supabase with JS client...');
console.log('URL:', url);

async function test() {
  try {
    const client = createClient(url, key, {
      auth: { persistSession: false }
    });
    
    // Try a simple query
    const { data, error } = await client
      .from('listings')
      .select('count', { count: 'exact', head: true });
    
    if (error) {
      console.log('❌ Error:', error.message);
      console.log('Code:', error.code);
    } else {
      console.log('✅ Count:', data);
    }
  } catch (err: any) {
    console.log('❌ Exception:', err.message);
    console.log('Stack:', err.stack?.split('\n').slice(0, 5).join('\n'));
  }
}

test();