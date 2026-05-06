/**
 * Shadow MLS - Typesense Collection Initialization
 * 
 * Initializes the 'properties' collection with Phase 3/4 schema.
 * Uses the master schema from src/lib/typesense/typesenseSchema.ts.
 * 
 * Run: npx tsx scripts/admin/initTypesense.ts
 */

import Typesense, { Client } from 'typesense';
import { typesenseSchema } from '../../src/lib/typesense/typesenseSchema';

// Load environment variables
import dotenv from 'dotenv';
dotenv.config();

// Typesense configuration
const TYPESENSE_HOST = '9uyapwh6e5qmvl34p-1.a1.typesense.net';
const TYPESENSE_PORT = 443;
const TYPESENSE_ADMIN_KEY = process.env.TYPESENSE_ADMIN_API_KEY || 'Ke8EhmC9c1Qm6JbttPt0rzSnvXa26Yxy';

const COLLECTION_NAME = 'properties';

async function initTypesense() {
  console.log('\n🚀 Shadow MLS - Typesense Collection Initialization');
  console.log('==================================================\n');

  const client = new Client({
    nodes: [
      {
        host: TYPESENSE_HOST,
        port: TYPESENSE_PORT,
        protocol: 'https'
      }
    ],
    apiKey: TYPESENSE_ADMIN_KEY,
    connectionTimeoutSeconds: 10
  });

  try {
    // Check connection
    console.log('📡 Testing connection to Typesense Cloud...');
    const health = await client.health.retrieve();
    console.log(`   ✅ Connected: Typesense (status: ${health.ok ? 'OK' : 'degraded'})\n`);

    // Check if collection exists
    console.log(`🔍 Checking for existing '${COLLECTION_NAME}' collection...`);
    let collectionExists = false;
    let existingSchema: any = null;

    try {
      existingSchema = await client.collections(COLLECTION_NAME).retrieve();
      collectionExists = true;
      console.log('   ⚠️  Collection exists\n');
    } catch (error: any) {
      if (error.httpStatus === 404) {
        console.log('   ℹ️  Collection does not exist - will create fresh\n');
      } else {
        throw error;
      }
    }

    // If collection exists, analyze and potentially recreate
    if (collectionExists && existingSchema) {
      console.log('📊 Current schema fields:');
      for (const field of existingSchema.fields || []) {
        console.log(`   - ${field.name}: ${field.type}${field.index === false ? ' [stored]' : ''}`);
      }

      // Check if it has Phase 3/4 fields
      const fieldNames = new Set((existingSchema.fields || []).map((f: any) => f.name));
      const hasPropertyHash = fieldNames.has('property_hash');
      const hasTrueDom = fieldNames.has('true_dom');
      const hasExtrapolatedCapRate = fieldNames.has('extrapolated_cap_rate');

      if (hasPropertyHash && hasTrueDom && hasExtrapolatedCapRate) {
        console.log('\n   ✅ Collection has Phase 3/4 fields - no recreation needed.\n');
        console.log('==================================================');
        console.log('✅ Typesense Collection Ready!');
        console.log('==================================================\n');
        return;
      } else {
        console.log('\n   ⚠️  Collection missing Phase 3/4 fields - recreating with full schema...\n');
        
        console.log('🗑️  Deleting existing collection...');
        await client.collections(COLLECTION_NAME).delete();
        console.log('   ✅ Deleted\n');
        collectionExists = false;
      }
    }

    // Create new collection
    console.log(`📦 Creating '${COLLECTION_NAME}' collection with Phase 3/4 schema...`);
    console.log('\n   Schema fields:');
    
    for (const field of typesenseSchema.fields) {
      const facet = field.facet ? ' [facet]' : '';
      const sort = (field as any).sort ? ' [sort]' : '';
      const index = field.index === false ? ' [stored-only]' : '';
      console.log(`   - ${field.name}: ${field.type}${facet}${sort}${index}`);
    }
    console.log('');

    const collection = await client.collections().create(typesenseSchema as any);
    
    console.log('✅ Collection created successfully!');
    console.log(`   Name: ${collection.name}`);
    console.log(`   Fields: ${typesenseSchema.fields.length}`);
    console.log(`   Default sorting field: ${collection.default_sorting_field}`);

    // Display Phase 3/4 field groups
    console.log('\n📊 Phase 3/4 Features Enabled:');
    console.log('   - Extrapolated Cap Rate (total_capital_basis, extrapolated_cap_rate, capital_burn_rate_monthly)');
    console.log('   - Temporal Distress Engine (property_hash, true_dom, total_price_drop)');
    console.log('   - ADU/Suite Potential (eligibility filters, distress scoring)');

    console.log('\n==================================================');
    console.log('✅ Typesense Collection Initialization Complete!');
    console.log('==================================================\n');

    console.log('Next step: Run sync test');
    console.log('   npx tsx scripts/worker/sync.ts test\n');

  } catch (error: any) {
    console.error('\n❌ Typesense initialization failed!');
    console.error('   Error:', error.message);
    
    if (error.httpStatus === 401 || error.message?.includes('API key')) {
      console.error('   → Authentication failed. Check TYPESENSE_ADMIN_API_KEY.');
    } else if (error.httpStatus === 404) {
      console.error('   → Collection not found (should not happen here).');
    } else if (error.httpStatus === 409) {
      console.error('   → Collection already exists with different schema.');
    } else if (error.code === 'ECONNREFUSED' || error.message?.includes('ENOTFOUND')) {
      console.error('   → Connection failed. Check TYPESENSE_HOST and network access.');
    }
    
    throw error;
  }
}

initTypesense()
  .then(() => {
    console.log('✅ Init script completed successfully.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Init script failed:', error.message);
    process.exit(1);
  });