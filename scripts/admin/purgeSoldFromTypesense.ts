/**
 * Typesense — Purge sold listings from the live `properties` collection.
 *
 * Why: nothing in the frontend (`src/`) searches sold listings — sold data is
 * served from Supabase `raw_vow_sold` (the AVM anchor), not Typesense. Indexing
 * sold listings into `properties` only consumes RAM on a memory-constrained
 * Typesense Cloud node (prior alert: "Low Free Memory (41MB free, p95)") and was
 * a cause of the OUT_OF_MEMORY write rejections during bulk sync.
 *
 * The ingester no longer pushes sold batches into Typesense (see
 * scripts/worker/sync.ts — Typesense write is skipped when options.isSold). This
 * one-off script removes the sold documents indexed before that change.
 *
 * NOTE: the live collection has NO `IsSold` field, so sold docs are identified by
 * their `Status` field (Closed / Sold). The dry-run prints the live field list and
 * the full Status distribution so you can confirm exactly what will be deleted.
 *
 * Run:  npx tsx scripts/admin/purgeSoldFromTypesense.ts            (dry-run: inspect + count)
 *       npx tsx scripts/admin/purgeSoldFromTypesense.ts --apply    (live delete)
 */

import 'dotenv/config';
import Typesense, { Client } from 'typesense';

const TYPESENSE_HOST = '9uyapwh6e5qmvl34p-1.a1.typesense.net';
const TYPESENSE_PORT = 443;
const COLLECTION_NAME = 'properties';

// Non-active statuses to purge from the search index. These listings are no longer
// available inventory and nothing in the frontend (src/) searches them:
//   Sold / Closed → served from Supabase raw_vow_sold (AVM anchor)
//   Leased        → a rented-out lease listing; not available, not searched
// KEPT (active / available): New, Price Change, Extension, Active, Deal Fell Through.
const PURGE_STATUS_VALUES = ['Closed', 'Sold', 'Leased'];
const PURGE_FILTER = `Status:=[${PURGE_STATUS_VALUES.map((v) => `\`${v}\``).join(',')}]`;

const ADMIN_KEY = process.env.TYPESENSE_ADMIN_API_KEY;
if (!ADMIN_KEY) {
  console.error('❌ TYPESENSE_ADMIN_API_KEY is not set');
  process.exit(1);
}

function getClient(): Client {
  return new Typesense.Client({
    nodes: [{ host: TYPESENSE_HOST, port: TYPESENSE_PORT, protocol: 'https' }],
    apiKey: ADMIN_KEY!,
    connectionTimeoutSeconds: 120,
  });
}

async function main() {
  const apply = process.argv.includes('--apply');
  const client = getClient();

  console.log(`🔍 Inspecting "${COLLECTION_NAME}" ...`);
  const collection = await client.collections(COLLECTION_NAME).retrieve();
  console.log(`📊 Total documents: ${collection.num_documents}`);

  const fieldNames = collection.fields.map((f: any) => f.name);
  const hasStatus = fieldNames.includes('Status');
  console.log(`🧩 Live fields (${fieldNames.length}): ${fieldNames.join(', ')}`);

  if (!hasStatus) {
    console.error('\n❌ No `Status` field in the live collection — cannot identify sold docs by status.');
    console.error('   Inspect the field list above and choose another discriminator before purging.');
    process.exit(1);
  }

  // Show the full Status distribution so we know exactly what exists.
  const facetProbe = await client
    .collections(COLLECTION_NAME)
    .documents()
    .search({ q: '*', query_by: 'Status', facet_by: 'Status', max_facet_values: 50, per_page: 0 } as any);

  const statusCounts = (facetProbe as any).facet_counts?.[0]?.counts ?? [];
  console.log('\n📋 Status distribution:');
  for (const c of statusCounts) {
    const mark = PURGE_STATUS_VALUES.includes(c.value) ? '  ← will purge' : '';
    console.log(`   ${String(c.count).padStart(7)}  ${c.value}${mark}`);
  }

  // Count documents matching the purge filter.
  const probe = await client
    .collections(COLLECTION_NAME)
    .documents()
    .search({ q: '*', query_by: 'Status', filter_by: PURGE_FILTER, per_page: 0 } as any);
  const purgeCount = (probe as any).found ?? 0;

  console.log(`\n🏷️  Documents matching ${PURGE_FILTER}: ${purgeCount}`);

  if (purgeCount === 0) {
    console.log('\n✅ Nothing to purge.');
    return;
  }

  if (!apply) {
    console.log(`\nDry-run only. Confirm the Status values above, then re-run with \`--apply\` to DELETE ${purgeCount} document(s).`);
    return;
  }

  console.log(`\n🚀 Deleting ${purgeCount} document(s) where ${PURGE_FILTER} ...`);
  const result = await client
    .collections(COLLECTION_NAME)
    .documents()
    .delete({ filter_by: PURGE_FILTER } as any);
  console.log(`✅ Done. Typesense reported num_deleted=${(result as any).num_deleted ?? 'unknown'}.`);
}

main().catch((err) => {
  console.error('❌ Failed:', err?.message || err);
  process.exit(1);
});
