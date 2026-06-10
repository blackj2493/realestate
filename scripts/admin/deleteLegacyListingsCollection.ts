/**
 * Delete the ORPHANED legacy `listings` Typesense collection (~95k docs).
 * Its only consumer was the dead src/services/metrics stack (removed in the
 * same commit). Frees more RAM than the De-listed window consumes — the
 * "net $0" of the De-listed design (spec 2026-06-09).
 *
 * NOTE: the Supabase TABLE `listings` (the vault) is a completely different
 * thing and is NOT touched — this deletes only the Typesense collection.
 *
 * Run:  npx tsx scripts/admin/deleteLegacyListingsCollection.ts          (dry-run)
 *       npx tsx scripts/admin/deleteLegacyListingsCollection.ts --apply
 */
import 'dotenv/config';
import Typesense from 'typesense';

if (!process.env.TYPESENSE_ADMIN_API_KEY) {
  console.error('❌ TYPESENSE_ADMIN_API_KEY not set');
  process.exit(1);
}

async function main() {
  const apply = process.argv.includes('--apply');
  const client = new Typesense.Client({
    nodes: [{ host: '9uyapwh6e5qmvl34p-1.a1.typesense.net', port: 443, protocol: 'https' }],
    apiKey: process.env.TYPESENSE_ADMIN_API_KEY!,
    connectionTimeoutSeconds: 60,
  });
  const c: any = await client.collections('listings').retrieve();
  console.log(`Collection "listings": ${c.num_documents} docs, ${c.fields?.length} fields, created ${c.created_at}`);
  if (!apply) return console.log('Dry-run. Re-run with --apply to DELETE the collection.');
  await client.collections('listings').delete();
  console.log('✅ Deleted.');
}

main().catch((e) => { console.error('❌', e?.message || e); process.exit(1); });
