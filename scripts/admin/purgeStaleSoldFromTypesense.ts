/**
 * Typesense — Backfill purge of STALE sold/leased docs from `properties`.
 *
 * Why: Query A (IDX) only fetches StandardStatus eq 'Active', so a listing that
 * sells leaves the delta forever and its `properties` doc freezes at its last
 * Active state ("New" / "Price Change" at the old list price). Query B (VOW)
 * skips the Typesense write (RAM policy) and — before the staleSearchDocs fix —
 * never deleted the old doc. Result: thousands of sold listings still shown as
 * For Sale (repro: W13164912, sold 2026-06-05, still live 2026-06-09; probe
 * found 3,467 stale among sales since 2026-04-01 alone).
 *
 * purgeSoldFromTypesense.ts can NOT find these docs — they kept their
 * Active-era Status, so its Status:=[Closed,Sold,Leased] filter misses them.
 *
 * Method:
 *   1. Export every doc id from `properties` (one streaming call).
 *   2. Membership check against raw_vow_sold.listing_key (PK, chunked .in()).
 *   3. Guard: drop keys whose vault `listings.full_payload` says the listing is
 *      Active again (deal fell through → re-listed under the same key) — those
 *      are legitimately live and must stay.
 *   4. Dry-run prints counts + samples; --apply deletes in chunked id filters.
 *
 * Run:  npx tsx scripts/admin/purgeStaleSoldFromTypesense.ts            (dry-run)
 *       npx tsx scripts/admin/purgeStaleSoldFromTypesense.ts --apply    (live delete)
 */

import 'dotenv/config';
import Typesense, { Client } from 'typesense';
import { createClient } from '@supabase/supabase-js';
import { buildIdDeleteFilters } from '../worker/staleSearchDocs';

const TYPESENSE_HOST = '9uyapwh6e5qmvl34p-1.a1.typesense.net';
const COLLECTION_NAME = 'properties';
const SUPABASE_CHUNK = 500;

const ADMIN_KEY = process.env.TYPESENSE_ADMIN_API_KEY;
if (!ADMIN_KEY) {
  console.error('❌ TYPESENSE_ADMIN_API_KEY is not set');
  process.exit(1);
}

function getTypesense(): Client {
  return new Typesense.Client({
    nodes: [{ host: TYPESENSE_HOST, port: 443, protocol: 'https' }],
    apiKey: ADMIN_KEY!,
    connectionTimeoutSeconds: 120,
  });
}

async function main() {
  const apply = process.argv.includes('--apply');
  const ts = getTypesense();
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // 1. Export all live doc ids from `properties`
  console.log(`🔍 Exporting doc ids from "${COLLECTION_NAME}" ...`);
  const exported = await ts
    .collections(COLLECTION_NAME)
    .documents()
    .export({ include_fields: 'id' } as any);
  const liveIds = (exported as string)
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line).id as string);
  console.log(`📊 Live docs: ${liveIds.length}`);

  // 2. Which of these ids have a sold/leased record in raw_vow_sold?
  console.log('🔎 Checking membership against raw_vow_sold (chunked) ...');
  const soldKeys: string[] = [];
  for (let i = 0; i < liveIds.length; i += SUPABASE_CHUNK) {
    const chunk = liveIds.slice(i, i + SUPABASE_CHUNK);
    const { data, error } = await supabase
      .from('raw_vow_sold')
      .select('listing_key')
      .in('listing_key', chunk);
    if (error) throw new Error(`raw_vow_sold membership check failed: ${error.message}`);
    soldKeys.push(...(data ?? []).map((r: any) => r.listing_key));
    if ((i / SUPABASE_CHUNK) % 20 === 0 && i > 0) {
      console.log(`   ... ${i}/${liveIds.length} checked, ${soldKeys.length} matches so far`);
    }
  }
  console.log(`🏷️  Docs with a sold/leased record: ${soldKeys.length}`);

  if (soldKeys.length === 0) {
    console.log('\n✅ Nothing to purge.');
    return;
  }

  // 3. Guard: a deal that fell through re-activates under the SAME ListingKey.
  //    The vault `listings.full_payload` tracks the latest status from both
  //    feeds — keep any key whose payload says Active (legitimately live).
  console.log('🛡️  Checking vault status for matched keys (deal-fell-through guard) ...');
  const reactivated = new Set<string>();
  for (let i = 0; i < soldKeys.length; i += SUPABASE_CHUNK) {
    const chunk = soldKeys.slice(i, i + SUPABASE_CHUNK);
    const { data, error } = await supabase
      .from('listings')
      .select('listing_key, standard_status:full_payload->>StandardStatus')
      .in('listing_key', chunk);
    if (error) throw new Error(`vault status check failed: ${error.message}`);
    for (const row of (data ?? []) as any[]) {
      if (String(row.standard_status ?? '').trim().toLowerCase() === 'active') {
        reactivated.add(row.listing_key);
      }
    }
  }
  const purgeIds = soldKeys.filter((k) => !reactivated.has(k));
  console.log(`   ${reactivated.size} key(s) re-activated in the vault — KEPT`);
  console.log(`\n🗑️  Stale docs to purge: ${purgeIds.length}`);

  // Sample what we're about to delete, with their frozen statuses.
  const sample = purgeIds.slice(0, 10);
  if (sample.length > 0) {
    const probe: any = await ts.multiSearch.perform({
      searches: [
        {
          collection: COLLECTION_NAME,
          q: '*',
          query_by: 'UnparsedAddress',
          filter_by: `id:=[${sample.join(',')}]`,
          per_page: 10,
          include_fields: 'id,Status,TransactionType,ListPrice',
        },
      ],
    } as any);
    console.log('\n📋 Sample:');
    for (const h of probe.results?.[0]?.hits ?? []) {
      const d = h.document;
      console.log(`   ${d.id}  Status=${d.Status}  TT=${d.TransactionType}  $${d.ListPrice}`);
    }
  }

  if (!apply) {
    console.log(`\nDry-run only. Re-run with \`--apply\` to DELETE ${purgeIds.length} document(s).`);
    return;
  }

  console.log(`\n🚀 Deleting ${purgeIds.length} document(s) in chunks ...`);
  let deleted = 0;
  for (const filter of buildIdDeleteFilters(purgeIds)) {
    const res: any = await ts
      .collections(COLLECTION_NAME)
      .documents()
      .delete({ filter_by: filter } as any);
    deleted += res?.num_deleted ?? 0;
  }
  console.log(`✅ Done. Typesense reported num_deleted=${deleted}.`);
}

main().catch((err) => {
  console.error('❌ Failed:', err?.message || err);
  process.exit(1);
});
