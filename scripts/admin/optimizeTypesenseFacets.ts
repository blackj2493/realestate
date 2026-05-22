/**
 * Typesense — Demote unnecessary facets on the live `properties` collection.
 *
 * Why: alert "Low Free Memory (41MB free, p95)" on cluster
 * 9uyapwh6e5qmvl34p. Audit (2026-05-19) found ~23 numeric fields declared
 * `facet: true` that are only ever consumed as range filters (>=, <=, [a..b])
 * in `queryBuilder.ts` and `commandCenterStore.ts` — facets on those fields
 * are pure RAM waste. PostalCode facet is also dropped (high cardinality).
 *
 * Typesense field facet/index attributes are immutable after creation, so the
 * supported way to change them is the alter-collection PATCH endpoint: drop
 * the field, then re-add it with the new attributes. This rebuilds the
 * in-memory structures for that field but does NOT re-ingest documents.
 *
 *   PATCH /collections/properties
 *   { "fields": [ { "name": "X", "drop": true }, { "name": "X", "type": ..., facet: false, ... } ] }
 *
 * Run:  npx tsx scripts/admin/optimizeTypesenseFacets.ts
 *       npx tsx scripts/admin/optimizeTypesenseFacets.ts --apply   (live)
 *
 * Without --apply this is a dry-run that prints the diff and exits.
 */

import 'dotenv/config';
import Typesense, { Client } from 'typesense';

const TYPESENSE_HOST = '9uyapwh6e5qmvl34p-1.a1.typesense.net';
const TYPESENSE_PORT = 443;
const COLLECTION_NAME = 'properties';

const ADMIN_KEY = process.env.TYPESENSE_ADMIN_API_KEY;
if (!ADMIN_KEY) {
  console.error('❌ TYPESENSE_ADMIN_API_KEY is not set');
  process.exit(1);
}

// (fieldName, newFacet) — only fields whose facet flag should change.
// `null` for newFacet means "don't touch". Booleans/enums kept faceted; numerics demoted.
type Demotion = { name: string; type: string; facet: boolean; sort?: boolean; optional?: boolean };

const DEMOTIONS: Demotion[] = [
  // Price + bed/bath/parking — range sliders
  { name: 'ListPrice',              type: 'int32',  facet: false, sort: true },
  { name: 'BedroomsTotal',          type: 'int32',  facet: false, sort: true },
  { name: 'BathroomsTotalInteger',  type: 'int32',  facet: false, sort: true },
  { name: 'ParkingTotal',           type: 'int32',  facet: false, sort: true },

  // High-cardinality dropdown — not useful as facet at this volume
  { name: 'PostalCode',             type: 'string', facet: false },

  // Kitchens / lot dimensions — sliders
  { name: 'KitchensTotal',          type: 'int32',  facet: false },
  { name: 'LotWidth',               type: 'float',  facet: false, sort: true },
  { name: 'LotDepth',               type: 'float',  facet: false, sort: true },
  { name: 'LotSqftTotal',           type: 'float',  facet: false, sort: true },

  // Pro Forma metrics — sliders
  { name: 'TotalCapitalBasis',      type: 'float',  facet: false, sort: true },
  { name: 'ExtrapolatedCapRate',    type: 'float',  facet: false, sort: true },
  { name: 'CapitalBurnRateMonthly', type: 'float',  facet: false, sort: true },

  // True carry cost rollup — slider
  { name: 'MonthlyCarryCost',       type: 'float',  facet: false, sort: true },

  // Temporal + suite — sliders
  { name: 'TrueDom',                type: 'int32',  facet: false, sort: true },
  { name: 'SuiteScore',             type: 'int32',  facet: false, sort: true },

  // Cashflow Investor — sliders
  { name: 'cap_rate_est',           type: 'float',  facet: false, sort: true },
  { name: 'cap_rate_floor',         type: 'float',  facet: false, sort: true },
  { name: 'gross_yield_est',        type: 'float',  facet: false, sort: true },
  { name: 'net_monthly_cashflow',   type: 'int32',  facet: false, sort: true },
  { name: 'cashflow_floor',         type: 'int32',  facet: false },
  { name: 'tax_burden_ratio',       type: 'float',  facet: false },

  // Parking surplus — slider
  { name: 'surplus_parking_count',  type: 'int32',  facet: false, sort: true },
];

function getClient(): Client {
  return new Typesense.Client({
    nodes: [{ host: TYPESENSE_HOST, port: TYPESENSE_PORT, protocol: 'https' }],
    apiKey: ADMIN_KEY!,
    connectionTimeoutSeconds: 60,
  });
}

async function main() {
  const apply = process.argv.includes('--apply');
  const client = getClient();

  console.log(`🔍 Reading current schema for "${COLLECTION_NAME}" ...`);
  const current = await client.collections(COLLECTION_NAME).retrieve();
  const currentByName = new Map<string, any>(current.fields.map((f: any) => [f.name, f]));

  console.log(`📊 Collection has ${current.num_documents} documents across ${current.fields.length} fields.`);

  const plan: Demotion[] = [];
  for (const target of DEMOTIONS) {
    const existing = currentByName.get(target.name);
    if (!existing) {
      console.log(`   skip ${target.name} — not present in live schema`);
      continue;
    }
    if (!!existing.facet === target.facet) {
      console.log(`   ok   ${target.name} — already facet=${target.facet}`);
      continue;
    }
    console.log(`   diff ${target.name} — facet ${existing.facet} → ${target.facet}`);
    plan.push(target);
  }

  if (plan.length === 0) {
    console.log('\n✅ Nothing to do — live schema already matches desired facet policy.');
    return;
  }

  console.log(`\n📋 Plan: ${plan.length} field(s) to demote.`);
  if (!apply) {
    console.log('\nDry-run only. Re-run with `--apply` to PATCH the live collection.');
    return;
  }

  // Build the alter body: drop + re-add for each field, in a single PATCH.
  const fields: any[] = [];
  for (const f of plan) {
    fields.push({ name: f.name, drop: true });
    const recreate: any = { name: f.name, type: f.type, facet: f.facet };
    if (f.sort !== undefined) recreate.sort = f.sort;
    if (f.optional !== undefined) recreate.optional = f.optional;
    fields.push(recreate);
  }

  console.log('\n🚀 Sending PATCH /collections/properties ...');
  // typesense-js exposes alter via collections(name).update()
  const result = await client.collections(COLLECTION_NAME).update({ fields } as any);
  console.log('✅ Done. Server responded with updated fields:');
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error('❌ Failed:', err?.message || err);
  if (err?.importResults) console.error(JSON.stringify(err.importResults, null, 2));
  process.exit(1);
});
