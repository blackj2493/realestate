/**
 * Shadow MLS - `sold_listings` Typesense Collection Initialization
 *
 * Creates (drop + recreate) the bounded recently-SOLD (VOW) collection that powers
 * the dashboard Market Activity "Sold" column. Drop+recreate is safe: the collection
 * is fully rebuildable from Supabase `raw_vow_sold` via `soldIndexer.ts backfill`.
 *
 * Run:  npx tsx scripts/admin/initSoldListings.ts
 * Then: npx tsx scripts/worker/soldIndexer.ts backfill
 */

import Typesense, { Client } from 'typesense';
import { soldListingsSchema, SOLD_LISTINGS_COLLECTION } from '../../src/lib/typesense/soldListingsSchema';

import dotenv from 'dotenv';
dotenv.config();

const TYPESENSE_HOST = '9uyapwh6e5qmvl34p-1.a1.typesense.net';
const TYPESENSE_PORT = 443;
const TYPESENSE_ADMIN_KEY = process.env.TYPESENSE_ADMIN_API_KEY || 'Ke8EhmC9c1Qm6JbttPt0rzSnvXa26Yxy';

async function initSoldListings() {
  console.log('\n🚀 Shadow MLS - sold_listings Collection Initialization');
  console.log('======================================================\n');

  const client = new Client({
    nodes: [{ host: TYPESENSE_HOST, port: TYPESENSE_PORT, protocol: 'https' }],
    apiKey: TYPESENSE_ADMIN_KEY,
    connectionTimeoutSeconds: 10,
  });

  try {
    console.log('📡 Testing connection to Typesense Cloud...');
    const health = await client.health.retrieve();
    console.log(`   ✅ Connected (status: ${health.ok ? 'OK' : 'degraded'})\n`);

    console.log(`🔍 Checking for existing '${SOLD_LISTINGS_COLLECTION}' collection...`);
    try {
      await client.collections(SOLD_LISTINGS_COLLECTION).retrieve();
      console.log('   ⚠️  Collection exists — deleting to recreate fresh\n');
      await client.collections(SOLD_LISTINGS_COLLECTION).delete();
      console.log('   ✅ Deleted\n');
    } catch (error: any) {
      if (error.httpStatus === 404) {
        console.log('   ℹ️  Collection does not exist - will create fresh\n');
      } else {
        throw error;
      }
    }

    console.log(`📦 Creating '${SOLD_LISTINGS_COLLECTION}' collection...`);
    for (const field of soldListingsSchema.fields) {
      const facet = field.facet ? ' [facet]' : '';
      const sort = (field as any).sort ? ' [sort]' : '';
      const index = (field as any).index === false ? ' [stored-only]' : '';
      console.log(`   - ${field.name}: ${field.type}${facet}${sort}${index}`);
    }
    console.log('');

    const collection = await client.collections().create(soldListingsSchema as any);
    console.log('✅ Collection created successfully!');
    console.log(`   Name: ${collection.name}`);
    console.log(`   Fields: ${soldListingsSchema.fields.length}`);
    console.log(`   Default sorting field: ${collection.default_sorting_field}\n`);

    console.log('Next step: seed the 180-day window');
    console.log('   npx tsx scripts/worker/soldIndexer.ts backfill\n');
  } catch (error: any) {
    console.error('\n❌ sold_listings initialization failed!');
    console.error('   Error:', error.message);
    if (error.httpStatus === 401 || error.message?.includes('API key')) {
      console.error('   → Authentication failed. Check TYPESENSE_ADMIN_API_KEY.');
    }
    throw error;
  }
}

initSoldListings()
  .then(() => {
    console.log('✅ Init script completed successfully.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Init script failed:', error.message);
    process.exit(1);
  });
