// scripts/admin/cleanIndexCuts.ts
/**
 * One-time clean of impossible price cuts already in the Typesense `properties` index
 * (2026-11). sync.ts and reindex-from-vault.ts now store 0 for a cut over 25% of the
 * original ask (indexCut), but the delta sync only rewrites listings that change, so
 * docs written before that fix keep the bad value until this runs.
 *
 * Measured 2026-11-12: 2,649 of 21,718 TotalPriceDrop values and 124 of 3,321
 * LeaseTotalPriceDrop values were over 25%.
 *
 * Touches only TotalPriceDrop / LeaseTotalPriceDrop (partial update). The DB keeps the
 * raw values. Prints counts only, unless --apply.
 *
 * Run: npx tsx scripts/admin/cleanIndexCuts.ts [--apply]
 */
import dotenv from 'dotenv';
dotenv.config({ path: ['.env.local', '.env'] });
import { indexCut } from '@/lib/listings/plausibleCuts';

const HOST = 'https://9uyapwh6e5qmvl34p-1.a1.typesense.net';
const KEY = process.env.TYPESENSE_ADMIN_API_KEY;
if (!KEY) { console.error('TYPESENSE_ADMIN_API_KEY is not set'); process.exit(1); }
const APPLY = process.argv.includes('--apply');
const FIELDS = ['TotalPriceDrop', 'LeaseTotalPriceDrop'] as const;
const BATCH = 500;

type Doc = { id: string; ListPrice?: number } & Partial<Record<(typeof FIELDS)[number], number>>;

async function exportDocs(field: string): Promise<Doc[]> {
  const url = `${HOST}/collections/properties/documents/export?include_fields=id,ListPrice,${field}&filter_by=${encodeURIComponent(`${field}:>0`)}`;
  const r = await fetch(url, { headers: { 'X-TYPESENSE-API-KEY': KEY! }, signal: AbortSignal.timeout(180_000) });
  if (!r.ok) throw new Error(`export ${field}: HTTP ${r.status}`);
  return (await r.text()).split('\n').filter(Boolean).map((l) => JSON.parse(l) as Doc);
}

async function main() {
  const patches = new Map<string, Record<string, number | string>>();
  for (const field of FIELDS) {
    const docs = await exportDocs(field);
    let bad = 0;
    for (const d of docs) {
      const clean = indexCut(d[field], d.ListPrice);
      if (clean !== d[field]) {
        bad++;
        patches.set(d.id, { ...(patches.get(d.id) ?? { id: d.id }), [field]: clean });
      }
    }
    console.log(`${field}: ${docs.length} with a cut, ${bad} to fix`);
  }
  console.log(`${patches.size} docs to update${APPLY ? '' : ' (dry run — pass --apply to write)'}`);
  if (!APPLY || patches.size === 0) return;

  const rows = [...patches.values()];
  let ok = 0, failed = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const body = rows.slice(i, i + BATCH).map((r) => JSON.stringify(r)).join('\n');
    const r = await fetch(`${HOST}/collections/properties/documents/import?action=update`, {
      method: 'POST',
      headers: { 'X-TYPESENSE-API-KEY': KEY!, 'Content-Type': 'text/plain' },
      body,
      signal: AbortSignal.timeout(120_000),
    });
    if (!r.ok) throw new Error(`import: HTTP ${r.status}`);
    for (const line of (await r.text()).split('\n').filter(Boolean)) {
      if ((JSON.parse(line) as { success?: boolean }).success) ok++; else failed++;
    }
  }
  console.log(`updated ${ok}, failed ${failed}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error('failed:', e?.message || e); process.exit(1); });
