/**
 * Add one field to the live `properties` collection schema.
 *
 * WHY THIS EXISTS
 * ───────────────
 * The collection has 83 explicit fields and NO `.*` fallback, so a field that is not
 * in the schema is not indexed. A document write carrying an unknown field is stored
 * but the value cannot be filtered, faceted or relied on. Migration 124 introduces
 * `rent_match_tier`, which the recompute job patches onto every active document — so
 * the field has to exist first, or the job writes values into a hole.
 *
 * Typesense supports additive schema changes in place (PATCH /collections/:name), so
 * this needs no reindex and no downtime. Existing documents simply have no value for
 * the new field until something writes one; `optional: true` is what makes that legal.
 *
 * SAFETY
 *  • ADDITIVE ONLY. This script refuses to drop or retype a field — pass a name that
 *    already exists and it exits without touching anything.
 *  • Dry-run by default; nothing is sent without --apply.
 *  • The field definition is read from typesenseSchema.ts rather than typed here, so
 *    the live collection and the code cannot describe the field differently.
 *
 * Usage:
 *   npx tsx scripts/admin/add-typesense-field.ts rent_match_tier
 *   npx tsx scripts/admin/add-typesense-field.ts rent_match_tier --apply
 * Env: TYPESENSE_ADMIN_API_KEY.
 */

import 'dotenv/config';
import { indexedFields } from '@/lib/typesense/typesenseSchema';

const TYPESENSE_HOST = '9uyapwh6e5qmvl34p-1.a1.typesense.net';
const COLLECTION = 'properties';

function apiKey(): string {
  const key = process.env.TYPESENSE_ADMIN_API_KEY;
  if (!key) {
    console.error('❌ TYPESENSE_ADMIN_API_KEY is not set — a schema change requires the admin key.');
    process.exit(1);
  }
  return key;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const name = process.argv.slice(2).find((a) => !a.startsWith('--'));
  if (!name) {
    console.error('❌ Pass the field name, e.g. `rent_match_tier`.');
    process.exit(1);
  }

  const field = indexedFields.find((f) => f.name === name);
  if (!field) {
    console.error(`❌ "${name}" is not in indexedFields (src/lib/typesense/typesenseSchema.ts).`);
    console.error('   Add it to the code first, so the schema and the collection agree.');
    process.exit(1);
  }

  console.log(`\n🧩 Add field to the live ${COLLECTION} collection`);
  console.log(`  ${apply ? 'APPLY' : 'DRY-RUN'}\n`);

  const head = await fetch(`https://${TYPESENSE_HOST}/collections/${COLLECTION}`, {
    headers: { 'X-TYPESENSE-API-KEY': apiKey() },
  });
  if (!head.ok) {
    console.error(`❌ Could not read the collection: ${head.status} ${await head.text()}`);
    process.exit(1);
  }
  const live = (await head.json()) as { fields: Array<{ name: string; type: string }> };

  const existing = live.fields.find((f) => f.name === name);
  if (existing) {
    console.log(`✅ Already present as ${existing.type} — nothing to do. (${live.fields.length} fields.)`);
    return;
  }

  console.log(`   live collection: ${live.fields.length} fields`);
  console.log(`   adding:          ${JSON.stringify(field)}`);

  if (!apply) {
    console.log('\nDRY-RUN — re-run with --apply to send the PATCH.');
    return;
  }

  const res = await fetch(`https://${TYPESENSE_HOST}/collections/${COLLECTION}`, {
    method: 'PATCH',
    headers: { 'X-TYPESENSE-API-KEY': apiKey(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: [field] }),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`❌ PATCH failed: ${res.status} ${text}`);
    process.exit(1);
  }
  console.log(`\n✅ Added. ${text.slice(0, 300)}`);
}

main().catch((err) => {
  console.error('❌ Fatal:', err);
  process.exit(1);
});
