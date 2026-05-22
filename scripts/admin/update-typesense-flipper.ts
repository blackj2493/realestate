/**
 * Shadow MLS - Flipper Metrics Typesense Schema Update
 * 
 * This script updates the Typesense "listings" collection to add
 * flipper-specific fields for the Flipper & Deal Hunter persona.
 * 
 * Run: npx tsx scripts/admin/update-typesense-flipper.ts
 */

import { Client } from 'typesense';

// Load environment variables
import dotenv from 'dotenv';
dotenv.config();

const TYPESENSE_HOST = process.env.NEXT_PUBLIC_TYPESENSE_HOST || '9uyapwh6e5qmvl34p-1.a1.typesense.net';
const TYPESENSE_PORT = parseInt(process.env.NEXT_PUBLIC_TYPESENSE_PORT || '443');
const TYPESENSE_PROTOCOL = process.env.NEXT_PUBLIC_TYPESENSE_PROTOCOL || 'https';
const TYPESENSE_API_KEY = process.env.TYPESENSE_ADMIN_API_KEY || process.env.TYPESENSE_API_KEY || 'Ke8EhmC9c1Qm6JbttPt0rzSnvXa26Yxy';

const COLLECTION_NAME = 'listings';

async function updateFlipperFields(): Promise<void> {
  const client = new Client({
    nodes: [
      {
        host: TYPESENSE_HOST,
        port: TYPESENSE_PORT,
        protocol: TYPESENSE_PROTOCOL as 'http' | 'https',
      }
    ],
    apiKey: TYPESENSE_API_KEY,
    connectionTimeoutSeconds: 10,
  });

  try {
    const health = await client.health.retrieve();
    console.log('[FlipperSchema] Connected to Typesense (status: ' + (health.ok ? 'OK' : 'degraded') + ')');
  } catch (err) {
    console.error('[FlipperSchema] Typesense is not available:', err);
    process.exit(1);
  }

  // Check if collection exists
  let collection;
  try {
    collection = await client.collections(COLLECTION_NAME).retrieve();
    console.log(`[FlipperSchema] Found existing collection "${COLLECTION_NAME}"`);
  } catch (err: any) {
    if (err.httpStatus === 404) {
      console.error(`[FlipperSchema] Collection "${COLLECTION_NAME}" does not exist. Run initTypesense.ts first.`);
      process.exit(1);
    }
    throw err;
  }

  // New flipper fields to add
  const newFlipperFields = [
    { name: 'distress_score', type: 'int32' as const },
    { name: 'deal_type_flag', type: 'string' as const, facet: true as const },
    { name: 'max_holding_cost', type: 'int32' as const },
    { name: 'true_price_drop_pct', type: 'float' as const },
    { name: 'price_drop_velocity', type: 'float' as const },
  ];

  // deal_type_flag options for reference:
  // ['STANDARD', 'LEGAL_DISTRESS', 'FIXER_UPPER', 'MOTIVATED_SELLER', 'ASSIGNMENT_SALE']

  console.log('[FlipperSchema] Adding flipper fields to collection...');
  console.log('[FlipperSchema] Fields:', JSON.stringify(newFlipperFields, null, 2));

  try {
    const response = await client.collections(COLLECTION_NAME).update({
      fields: newFlipperFields,
    });

    console.log('[FlipperSchema] Update response:', JSON.stringify(response, null, 2));
    console.log('[FlipperSchema] SUCCESS: Flipper fields added to Typesense collection');
  } catch (err: any) {
    console.error('[FlipperSchema] Failed to update collection:', err.message);
    if (err.response?.data?.message) {
      console.error('[FlipperSchema] Typesense error:', err.response.data.message);
    }
    process.exit(1);
  }

  // Verify the update
  try {
    const updated = await client.collections(COLLECTION_NAME).retrieve();
    console.log('[FlipperSchema] Verified - collection now has', updated.num_documents, 'documents');
    
    // Check if new fields are present
    const fieldNames = updated.fields.map((f: any) => f.name);
    const missingFields = newFlipperFields.map(f => f.name).filter(n => !fieldNames.includes(n));
    if (missingFields.length > 0) {
      console.error('[FlipperSchema] WARNING: Fields not found after update:', missingFields);
    } else {
      console.log('[FlipperSchema] All flipper fields verified in schema');
    }
  } catch (err) {
    console.error('[FlipperSchema] Failed to verify update:', err);
    process.exit(1);
  }
}

updateFlipperFields().catch((err) => {
  console.error('[FlipperSchema] Unhandled error:', err);
  process.exit(1);
});