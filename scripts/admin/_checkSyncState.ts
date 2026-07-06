/**
 * One-off: dump the sync_state master row so we can see exactly what set status='failed'
 * (status, cursor, updated_at, and any error/detail columns). READ-ONLY. Native fetch;
 * *.supabase.co has a valid cert so no TLS bypass.
 *
 *   npx.cmd tsx --env-file=.env scripts/admin/_checkSyncState.ts
 */
import { createClient } from '@supabase/supabase-js';

const URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
if (!URL || !KEY) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const sb = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });

async function main() {
  const { data, error } = await sb.from('sync_state').select('*').eq('id', 'master').single();
  if (error) {
    console.error('read error:', error.message);
    process.exit(1);
  }
  const now = Date.now();
  const ageH = (iso: string | null) =>
    iso ? `${((now - new Date(iso).getTime()) / 3_600_000).toFixed(1)}h ago` : 'null';
  console.log('=== sync_state.master ===');
  console.log(JSON.stringify(data, null, 2));
  console.log('\n=== derived ages ===');
  console.log('last_sync_timestamp:', (data as Record<string, unknown>).last_sync_timestamp, '·', ageH((data as Record<string, string | null>).last_sync_timestamp));
  console.log('updated_at        :', (data as Record<string, unknown>).updated_at, '·', ageH((data as Record<string, string | null>).updated_at));
  console.log('status            :', (data as Record<string, unknown>).status);
}
main().catch((e) => {
  console.error('crash:', e instanceof Error ? e.message : e);
  process.exit(1);
});
