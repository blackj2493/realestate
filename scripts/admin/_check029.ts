// Scratch probe: is migration 029 (profiles.terms_accepted_at / terms_version /
// bona_fide_attested) applied in prod? Selects the columns — PostgREST returns a
// 42703 error if any is missing. Read-only.
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Missing Supabase env');

const supabase = createClient(url, key);

async function main() {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, terms_accepted_at, terms_version, bona_fide_attested')
    .limit(1);
  if (error) {
    console.log('MIGRATION 029 NOT APPLIED (or other error):', error.code, error.message);
    process.exit(1);
  }
  console.log('MIGRATION 029 APPLIED — columns exist. Sample rows returned:', data?.length ?? 0);

  const { count, error: cntErr } = await supabase
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .not('terms_accepted_at', 'is', null);
  if (!cntErr) console.log('Profiles with terms accepted:', count);
}

main();
