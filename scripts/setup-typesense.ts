/**
 * Shadow MLS - Typesense V1 Schema Setup
 * 
 * Initializes the 'listings' collection with a lean index strategy.
 * This schema is optimized for <30ms search responses and minimal RAM.
 * 
 * Run: npx tsx scripts/setup-typesense.ts
 */

import Typesense from 'typesense';

// Typesense configuration from environment
const TYPESENSE_HOST = process.env.TYPESENSE_NODES || 'https://9uyapwh6e5qmvl34p-1.a1.typesense.net';
const TYPESENSE_PORT = 443;
const TYPESENSE_API_KEY = process.env.TYPESENSE_ADMIN_API_KEY || 'Ke8EhmC9c1Qm6JbttPt0rzSnvXa26Yxy';

// V1 Schema Definition
const listingsSchema = {
  name: 'listings',
  
  // Core Render Fields
  fields: [
    { name: 'id', type: 'string' as const, facet: false },  // Maps to ListingKey
    
    { name: 'ListPrice', type: 'float' as const, sort: true },
    
    { name: 'UnparsedAddress', type: 'string' as const, facet: false },
    { name: 'City', type: 'string' as const, facet: true, optional: true },
    
    // Property Specifications
    { name: 'BedroomsTotal', type: 'int32' as const, facet: true, optional: true },
    // FIX: BathroomsTotalInteger changed from int32 to float (API sends floats like "14.5")
    { name: 'BathroomsTotalInteger', type: 'float' as const, facet: true, optional: true },
    { name: 'PropertySubType', type: 'string' as const, facet: true, optional: true },
    { name: 'PropertyType', type: 'string' as const, facet: true, optional: true },
    
    // CRITICAL: Geopoint for mapbox bounding box queries
    // Format: [lat, lng] - latitude first, longitude second
    { name: 'location', type: 'geopoint' as const, facet: false },
    
    // Transaction Context
    { name: 'TransactionType', type: 'string' as const, facet: true, optional: true },
    
    // Financial Filters
    { name: 'TaxAnnualAmount', type: 'float' as const, sort: true, optional: true },
    { name: 'AssociationFee', type: 'float' as const, sort: true, optional: true },
    
    // Lot Dimensions
    { name: 'LotWidth', type: 'float' as const, sort: true, optional: true },
    { name: 'LotDepth', type: 'float' as const, sort: true, optional: true },
    
    // Building Specs
    { name: 'ApproximateAge', type: 'string' as const, facet: true, optional: true },
    { name: 'ParkingTotal', type: 'int32' as const, facet: true, sort: true, optional: true },
    { name: 'BuildingAreaTotal', type: 'int32' as const, sort: true, optional: true },
    
    // Derived Persona Metrics (Pre-computed by ETL Worker)
    { name: 'isDistressed', type: 'bool' as const, facet: true },
    
    { name: 'targetGrossYield', type: 'float' as const, sort: true, optional: true },
    
    { name: 'hasSecondarySuitePotential', type: 'bool' as const, facet: true },
    
    { name: 'calculatedDOM', type: 'int32' as const, sort: true },
    
    // Primary thumbnail for frontend UI cards (extracted from first media item)
    { name: 'primaryImageUrl', type: 'string' as const, optional: true },
    
    // Brokerage for attribution
    { name: 'ListOfficeName', type: 'string' as const, facet: false, optional: true }
  ],
  
  // Default sort: freshest inventory first
  default_sorting_field: 'calculatedDOM'
};

async function setupTypesense() {
  console.log('🚀 Shadow MLS - Typesense V1 Schema Setup');
  console.log('==========================================\n');
  
  const client = new Typesense.Client({
    nodes: [
      {
        host: '9uyapwh6e5qmvl34p-1.a1.typesense.net',
        port: 443,
        protocol: 'https'
      }
    ],
    apiKey: TYPESENSE_API_KEY,
    connectionTimeoutSeconds: 10
  });
  
  try {
    // Check connection
    console.log('📡 Testing connection to Typesense Cloud...');
    const health = await client.health.retrieve();
    console.log(`   ✅ Connected: Typesense\n`);
    
    // Check if collection exists and delete for fresh start
    console.log('🔄 Checking for existing collection...');
    try {
      const existing = await client.collections('listings').retrieve();
      if (existing) {
        console.log('   ⚠️  Found existing "listings" collection');
        console.log('   🗑️  Deleting for fresh schema deployment...');
        await client.collections('listings').delete();
        console.log('   ✅ Deleted existing collection\n');
      }
    } catch (collectionError: any) {
      if (collectionError.httpStatus === 404) {
        console.log('   ℹ️  No existing collection found - will create fresh\n');
      } else {
        throw collectionError;
      }
    }
    
    // Create new collection with schema
    console.log('📦 Creating "listings" collection with V1 schema...');
    console.log('   Schema fields:');
    listingsSchema.fields.forEach(field => {
      const optional = field.optional ? ' (optional)' : '';
      const sort = field.sort ? ' [sort]' : '';
      const facet = field.facet ? ' [facet]' : '';
      console.log(`   - ${field.name}: ${field.type}${optional}${sort}${facet}`);
    });
    console.log('');
    
    const collection = await client.collections().create(listingsSchema);
    console.log(`   ✅ Created collection: ${collection.name}`);
    console.log(`   📊 Fields configured: ${listingsSchema.fields.length}`);
    console.log(`   📁 Default sorting field: ${collection.default_sorting_field}\n`);
    
    // Display geopoint field requirements
    console.log('🗺️  Geopoint Field Specification:');
    console.log('   - Type: location (geopoint)');
    console.log('   - Format: [latitude, longitude] array');
    console.log('   - Source: Postal code lookup (priority) → API Latitude/Longitude (fallback) → Toronto center (last resort)');
    console.log('   - Supports: Mapbox bounding box queries via filter_by location:...[REPLACE_WITH_GEO_QUERY]\n');
    
    // Create indexes for common queries (Typesense auto-indexes, but explicit)
    console.log('⚡ Indexing Strategy:');
    console.log('   - Facets enabled: City, PropertySubType, PropertyType, TransactionType, ApproximateAge');
    console.log('   - Sort enabled: ListPrice, TaxAnnualAmount, AssociationFee, LotWidth, LotDepth, ParkingTotal, BuildingAreaTotal, targetGrossYield, calculatedDOM');
    console.log('   - Geospatial: location field for bounding box queries\n');
    
    console.log('🎯 ETL Worker will use this schema for:');
    console.log('   1. Delta sync ingestion (24hr window)');
    console.log('   2. Geopoint resolution from postal codes');
    console.log('   3. Derived metric computation (isDistressed, targetGrossYield, hasSecondarySuitePotential)\n');
    
    console.log('==========================================');
    console.log('✅ Typesense V1 Schema Setup Complete');
    console.log('==========================================\n');
    
    console.log('Next steps:');
    console.log('1. Run: npx tsx scripts/worker/sync.ts  (initial delta sync)');
    console.log('2. Update: src/app/properties/page.tsx   (integrate Typesense search)');
    console.log('3. Update: src/app/properties/[id]/page.tsx (integrate Supabase detail fetch)\n');
    
  } catch (error) {
    console.error('❌ Typesense setup failed:', error);
    throw error;
  }
}

// Run if executed directly
setupTypesense().catch(console.error);