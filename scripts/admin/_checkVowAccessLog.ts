// Scratch probe: is migration 053 (public.vow_access_log) applied in prod? Selects from the
// table — PostgREST returns 42P01 (undefined_table) if it's missing. Read-only.
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Missing Supabase env');

const supabase = createClient(url, key);

async function main() {
  const { error, count } = await supabase
    .from('vow_access_log')
    .select('id', { count: 'exact', head: true });
  if (error) {
    console.log('MIGRATION 053 NOT APPLIED (or other error):', error.code, error.message);
    process.exit(1);
  }
  console.log('MIGRATION 053 APPLIED - vow_access_log exists. Row count:', count ?? 0);
}

main();
