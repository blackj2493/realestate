import { Client } from 'pg';

// EXPLICIT SNI BYPASS
// Host: aws-0-ca-central-1.pooler.supabase.com (IPv4 Pooler)
// Port: 5432
// Role: postgres.[project_ref] uses project reference in username for tenant routing
const CONNECTION_STRING = "postgresql://postgres.pyzgnivilxhnwzfrdkiq:Tanshal4002%21@aws-0-ca-central-1.pooler.supabase.com:5432/postgres?sslmode=require";

async function buildIndexes() {
  console.log("🔌 Connecting to Supabase Pooler with Explicit Routing...");
  
  const client = new Client({ 
    connectionString: CONNECTION_STRING,
    ssl: { rejectUnauthorized: false } // Required for pooler TLS handshake
  });
  try {
    await client.connect();
    console.log("✅ Connected securely.");
    console.log("🔨 Building idx_listings_payload_hash_nonnull...");
    await client.query(`CREATE INDEX IF NOT EXISTS idx_listings_payload_hash_nonnull ON listings(payload_hash) WHERE payload_hash IS NOT NULL;`);

    console.log("🔨 Building idx_listings_last_seen...");
    await client.query(`CREATE INDEX IF NOT EXISTS idx_listings_last_seen ON listings(last_seen_at);`);

    console.log("🔨 Building idx_listings_orphaned...");
    await client.query(`CREATE INDEX IF NOT EXISTS idx_listings_orphaned ON listings(orphan_confirmations) WHERE is_orphaned = TRUE;`);
    console.log("🔍 Verifying Indexes...");
    const result = await client.query(`
      SELECT indexname 
      FROM pg_indexes 
      WHERE tablename = 'listings' 
      AND indexname IN ('idx_listings_payload_hash_nonnull', 'idx_listings_last_seen', 'idx_listings_orphaned');
    `);

    console.log("✅ Target Indexes Confirmed in Database:", result.rows.map(r => r.indexname));

  } catch (error) {
    console.error("❌ Execution failed:", error);
  } finally {
    await client.end();
    console.log("🔌 Connection closed.");
  }
}

buildIndexes();
