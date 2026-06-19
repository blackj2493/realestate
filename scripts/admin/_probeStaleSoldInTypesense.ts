/**
 * Scale probe: how many listings that SOLD (raw_vow_sold) still exist as
 * live docs in the Typesense `properties` (For Sale) collection?
 *
 * Method: pull raw_vow_sold keys sold since a cutoff, then check existence
 * in `properties` via chunked multi_search id filters.
 *
 * Run: npx.cmd tsx scripts/admin/_probeStaleSoldInTypesense.ts
 */
import 'dotenv/config';
import Typesense from 'typesense';
import { createClient } from '@supabase/supabase-js';

const TYPESENSE_HOST = '9uyapwh6e5qmvl34p-1.a1.typesense.net';
const SOLD_SINCE = '2026-04-01';

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const ts = new Typesense.Client({
    nodes: [{ host: TYPESENSE_HOST, port: 443, protocol: 'https' }],
    apiKey: process.env.TYPESENSE_ADMIN_API_KEY!,
    connectionTimeoutSeconds: 120,
  });

  // Page raw_vow_sold keys (PostgREST caps at 1000/page)
  const keys: string[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('raw_vow_sold')
      .select('listing_key')
      .gte('purchase_contract_date', SOLD_SINCE)
      .order('listing_key')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    keys.push(...(data ?? []).map((r: any) => r.listing_key));
    if (!data || data.length < PAGE) break;
  }
  console.log(`raw_vow_sold keys sold since ${SOLD_SINCE}: ${keys.length}`);

  // Chunked existence check in `properties`
  let stale = 0;
  const sampleStale: string[] = [];
  const CHUNK = 80;
  for (let i = 0; i < keys.length; i += CHUNK) {
    const chunk = keys.slice(i, i + CHUNK);
    const filter = `id:=[${chunk.join(',')}]`;
    const res: any = await ts.multiSearch.perform({
      searches: [
        {
          collection: 'properties',
          q: '*',
          query_by: 'UnparsedAddress',
          filter_by: filter,
          per_page: 250,
          include_fields: 'id,Status,TransactionType',
        },
      ],
    } as any);
    const r = res.results?.[0];
    if (r?.error) {
      console.warn(`chunk ${i}: ${r.error}`);
      continue;
    }
    const hits = r?.hits ?? [];
    stale += r?.found ?? hits.length;
    for (const h of hits.slice(0, 3)) {
      if (sampleStale.length < 15)
        sampleStale.push(`${h.document.id}  Status=${h.document.Status}  TT=${h.document.TransactionType}`);
    }
  }

  console.log(`\nSTALE: ${stale} of ${keys.length} sold-since-${SOLD_SINCE} listings still live in 'properties' (For Sale index)`);
  console.log('\nSample:');
  sampleStale.forEach((s) => console.log('  ' + s));
}

main().catch((e) => {
  console.error('probe failed:', e?.message || e);
  process.exit(1);
});
