/**
 * Read-only validator/monitor for the Query B2 sold-media reconciliation
 * candidate set. Exactly mirrors reconcileMissingSoldMedia's candidate step:
 * export the in-window `sold_listings` Typesense docs and count the ones with no
 * `primaryImageUrl` (= no photo). Typesense-only — no Supabase IO, no writes.
 *
 * Usage: npx tsx scripts/admin/checkSoldMissingPhotos.ts
 */
import 'dotenv/config';
import { getSoldAdminClient } from '../worker/soldIndexer';
import { SOLD_LISTINGS_COLLECTION } from '../../src/lib/typesense/soldListingsSchema';

(async () => {
  const ts = getSoldAdminClient();
  const exported = (await ts
    .collections(SOLD_LISTINGS_COLLECTION)
    .documents()
    .export({ include_fields: 'id,primaryImageUrl,PurchaseContractDate' })) as unknown as string;

  let total = 0;
  const missing: Array<{ id: string; pcd: number }> = [];
  for (const line of String(exported).split('\n')) {
    if (!line) continue;
    let d: any;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    total++;
    if (d?.id && !d.primaryImageUrl) missing.push({ id: d.id, pcd: Number(d.PurchaseContractDate) || 0 });
  }
  missing.sort((a, b) => b.pcd - a.pcd);

  console.log(`sold_listings in-window docs : ${total}`);
  console.log(`missing primaryImageUrl      : ${missing.length} (${total ? Math.round((missing.length / total) * 100) : 0}%)`);
  console.log('freshest 10 photo-less sold  :');
  for (const c of missing.slice(0, 10)) {
    console.log(`  ${c.id}  sold=${c.pcd ? new Date(c.pcd).toISOString().slice(0, 10) : '?'}`);
  }
  process.exit(0);
})();
