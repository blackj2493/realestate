/**
 * Backfill listings.cap_rate_est from the Typesense `properties` index (Migration 031).
 *
 * The real IDX-derived cap rate is computed in financialMetrics and already lives on the
 * Typesense docs (~47% of For-Sale). This copies the in-band [1,15]% values into the new
 * listings.cap_rate_est column so region_active_aggregates (de-fake §6.2) aggregates the
 * real value over the full active set. One-time for existing rows; the ETL (transformer.ts)
 * keeps new/updated rows fresh on each sync.
 *
 * Dry-run by default (reports counts, writes nothing). Pass --apply to write.
 * Idempotent / resumable: UPDATEs by listing_key; safe to re-run.
 *
 * Run: npx tsx scripts/admin/backfill031.ts            (dry run)
 *      npx tsx scripts/admin/backfill031.ts --apply    (write)
 * Needs DATABASE_URL (Session pooler, §12) + TYPESENSE_NODES + TYPESENSE_ADMIN_API_KEY
 * (or NEXT_PUBLIC_TYPESENSE_SEARCH_ONLY_API_KEY).
 */

import { Client } from 'pg';
import dotenv from 'dotenv';
dotenv.config({ path: ['.env.local', '.env'] });

const APPLY = process.argv.includes('--apply');
const DATABASE_URL = process.env.DATABASE_URL || process.env.DIRECT_DB_URL;
const TS_NODE = (process.env.TYPESENSE_NODES || '').split(',')[0].trim();
const [TS_HOST, TS_PORT] = TS_NODE.split(':');
const TS_PROTO = process.env.NEXT_PUBLIC_TYPESENSE_PROTOCOL || 'https';
const TS_KEY =
  process.env.TYPESENSE_ADMIN_API_KEY || process.env.NEXT_PUBLIC_TYPESENSE_SEARCH_ONLY_API_KEY;
const CHUNK = 1000;

// Must match the RPC band (migration 031) so Postgres and Typesense agree exactly.
const BAND = 'cap_rate_est:>=1 && cap_rate_est:<=15';

if (!DATABASE_URL) {
  console.error('❌ Set DATABASE_URL (Session pooler, §12)');
  process.exit(1);
}
if (!TS_HOST || !TS_KEY) {
  console.error('❌ Missing Typesense host/key (TYPESENSE_NODES + TYPESENSE_ADMIN_API_KEY)');
  process.exit(1);
}

/** Stream every in-band For-Sale doc from Typesense → Map<ListingKey, cap_rate_est>. */
async function fetchCapRates(): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const url = `${TS_PROTO}://${TS_HOST}:${TS_PORT}/collections/properties/documents/export`;
  const params = new URLSearchParams({
    filter_by: `TransactionType:=\`For Sale\` && ${BAND}`,
    include_fields: 'id,cap_rate_est',
  });
  const res = await fetch(`${url}?${params.toString()}`, {
    headers: { 'X-TYPESENSE-API-KEY': TS_KEY as string },
  });
  if (!res.ok) throw new Error(`Typesense export ${res.status}: ${await res.text()}`);
  const jsonl = await res.text(); // newline-delimited JSON, one doc per line
  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue;
    const d = JSON.parse(line) as { id: string; cap_rate_est?: number };
    const cr = Number(d.cap_rate_est);
    if (d.id && Number.isFinite(cr) && cr >= 1 && cr <= 15) out.set(d.id, cr);
  }
  return out;
}

async function main() {
  console.log(`\n🔧 Backfill 031: listings.cap_rate_est from Typesense  (${APPLY ? 'APPLY' : 'DRY RUN'})`);
  console.log('==================================================================\n');

  console.log('📥 Exporting in-band For-Sale cap_rate_est from Typesense...');
  const caps = await fetchCapRates();
  console.log(`   ✅ ${caps.size.toLocaleString()} listings have an in-band cap_rate_est\n`);

  const client = new Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 15000 });
  await client.connect();
  await client.query("SET statement_timeout TO '0'");
  console.log('   ✅ Connected (statement_timeout disabled)\n');

  try {
    const keys = [...caps.keys()];
    let processed = 0;
    let matched = 0;

    for (let i = 0; i < keys.length; i += CHUNK) {
      const batch = keys.slice(i, i + CHUNK);
      const params: (string | number)[] = [];
      const tuples: string[] = [];
      batch.forEach((k, j) => {
        const b = j * 2;
        params.push(k, caps.get(k) as number);
        tuples.push(`($${b + 1}::text, $${b + 2}::numeric)`);
      });

      if (APPLY) {
        const r = await client.query(
          `UPDATE listings AS l SET cap_rate_est = v.cr
           FROM (VALUES ${tuples.join(',')}) AS v(listing_key, cr)
           WHERE l.listing_key = v.listing_key`,
          params
        );
        matched += r.rowCount ?? 0;
      }
      processed += batch.length;
      if ((i / CHUNK) % 10 === 0) {
        console.log(`   … ${processed.toLocaleString()} / ${keys.length.toLocaleString()} keys`);
      }
    }

    console.log(
      `\n   ${APPLY ? '✅ Updated' : '🔎 Would update'} up to ${keys.length.toLocaleString()} rows by listing_key.`
    );
    if (APPLY) {
      console.log(`   📊 Rows actually matched/written: ${matched.toLocaleString()}`);
      const chk = await client.query(
        `SELECT count(*) FILTER (WHERE cap_rate_est IS NOT NULL AND cap_rate_est BETWEEN 1 AND 15) AS n FROM listings`
      );
      console.log(`   📊 listings with in-band cap_rate_est now: ${Number(chk.rows[0].n).toLocaleString()}`);
      console.log(`   Verify: SELECT * FROM region_active_aggregates('Oakville');`);
    } else {
      console.log('   (dry run — pass --apply to write)');
    }
    console.log('\n==================================================================\n');
  } catch (err: unknown) {
    const e = err as { message?: string };
    console.error('\n❌ Backfill failed:', e.message);
    console.error('   (Safe to re-run — UPDATEs by listing_key are idempotent.)');
    throw err;
  } finally {
    await client.end();
    console.log('🔌 Connection closed.\n');
  }
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
