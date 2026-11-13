// scripts/admin/fixNonHomeSubtypes.ts
/**
 * One-time fix for parking spots / storage units that the listing agent filed as homes
 * (2026-11). The writers (transformer, soldIndexer, delistedMapper) now apply
 * nonHomeFromAddress, but rows already stored keep the feed's home subtype.
 *
 * Measured 2026-11-12: 10 rows in `properties` and 10 in `sold_listings`, e.g.
 * "1 Gloucester Street 2 Parking Tandem" filed as a 3-bed Condo Apartment at $150,000.
 *
 * Updates PropertySubType in both Typesense collections (partial update) and the flat
 * listings.property_sub_type column for the same keys. full_payload keeps the feed value.
 * Prints the rows only, unless --apply.
 *
 * Run: npx tsx scripts/admin/fixNonHomeSubtypes.ts [--apply]
 */
import dotenv from 'dotenv';
dotenv.config({ path: ['.env.local', '.env'] });
import { createClient } from '@supabase/supabase-js';
import { nonHomeFromAddress } from '@/lib/listings/nonHomeFromAddress';

const HOST = 'https://9uyapwh6e5qmvl34p-1.a1.typesense.net';
const KEY = process.env.TYPESENSE_ADMIN_API_KEY;
if (!KEY) { console.error('TYPESENSE_ADMIN_API_KEY is not set'); process.exit(1); }
const APPLY = process.argv.includes('--apply');

interface Doc { id: string; UnparsedAddress?: string; PropertySubType?: string; PropertyType?: string }

async function flagged(collection: string): Promise<Array<{ id: string; from: string; to: string; address: string }>> {
  const fields = collection === 'properties' ? 'id,UnparsedAddress,PropertySubType,PropertyType' : 'id,UnparsedAddress,PropertySubType';
  const r = await fetch(`${HOST}/collections/${collection}/documents/export?include_fields=${fields}`, {
    headers: { 'X-TYPESENSE-API-KEY': KEY! },
    signal: AbortSignal.timeout(300_000),
  });
  if (!r.ok) throw new Error(`export ${collection}: HTTP ${r.status}`);
  const out: Array<{ id: string; from: string; to: string; address: string }> = [];
  for (const line of (await r.text()).split('\n')) {
    if (!line) continue;
    const d = JSON.parse(line) as Doc;
    const to = nonHomeFromAddress(d.UnparsedAddress, d.PropertySubType, d.PropertyType);
    if (to) out.push({ id: d.id, from: d.PropertySubType ?? '', to, address: String(d.UnparsedAddress ?? '').split(',')[0] });
  }
  return out;
}

async function update(collection: string, rows: Array<{ id: string; to: string }>): Promise<number> {
  if (!rows.length) return 0;
  const body = rows.map((r) => JSON.stringify({ id: r.id, PropertySubType: r.to })).join('\n');
  const r = await fetch(`${HOST}/collections/${collection}/documents/import?action=update`, {
    method: 'POST',
    headers: { 'X-TYPESENSE-API-KEY': KEY!, 'Content-Type': 'text/plain' },
    body,
    signal: AbortSignal.timeout(120_000),
  });
  if (!r.ok) throw new Error(`import ${collection}: HTTP ${r.status}`);
  return (await r.text()).split('\n').filter((l) => l && (JSON.parse(l) as { success?: boolean }).success).length;
}

async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  for (const collection of ['properties', 'sold_listings']) {
    const rows = await flagged(collection);
    console.log(`${collection}: ${rows.length} to fix`);
    for (const r of rows) console.log(`  ${r.id} | ${r.from} -> ${r.to} | ${r.address}`);
    if (!APPLY) continue;
    console.log(`  index updated: ${await update(collection, rows)}`);
    let dbRows = 0;
    for (const r of rows) {
      const { data, error } = await db.from('listings').update({ property_sub_type: r.to }).eq('listing_key', r.id).select('listing_key');
      if (error) console.log(`  db ${r.id}: ${error.message}`);
      else dbRows += data?.length ?? 0;
    }
    console.log(`  listings rows updated: ${dbRows}`);
  }
  if (!APPLY) console.log('(dry run — pass --apply to write)');
}

main().then(() => process.exit(0)).catch((e) => { console.error('failed:', e?.message || e); process.exit(1); });
