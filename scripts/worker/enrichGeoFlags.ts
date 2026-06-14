/**
 * enrichGeoFlags — precompute per-listing geo "Things to Know" flags into
 * listing_geo_flags (Phase 2, migration 037).
 *
 * For each coord-bearing listing we resolve a BLOCK-LEVEL point and run the PostGIS
 * predicates (flood now; rail/traffic as follow-ups), map the result to
 * DiligenceFlag[] via the pure geoFlagsFor(), and upsert one JSONB row. The read
 * path (getListingDetail) then does a single indexed PK lookup — no spatial query
 * at request time (§5 Disk-IO budget).
 *
 * COORDINATES (no lat/lng in the IDX feed): mirror the ETL (transformer.ts →
 * resolveLocation) — resolve from the postal code. The feed's PostalCode is often
 * FSA-only, so we prefer a full 6-char PostalCode, else parse the full code from
 * UnparsedAddress (parsePostal.ts). We then REJECT FSA-centroid fallbacks: a flood
 * flag (severity 70) must never fire off a town-centroid blob. Postal-centroid
 * precision is the known limitation (rooftop geocoding is a future enhancement).
 *
 * COMPLIANCE: deterministic spatial SQL over PUBLIC data; no LLM (§4). Output is
 * NOT VOW-gated. Idempotent upserts — safe to re-run.
 *
 * Requires DATABASE_URL = Supabase Session pooler string (CLAUDE.md §12).
 *
 * Run (full backfill):  npx tsx scripts/worker/enrichGeoFlags.ts
 *   delta (nightly):    npx tsx scripts/worker/enrichGeoFlags.ts --since 2026-06-13T03:00:00Z
 *   dry run:            npx tsx scripts/worker/enrichGeoFlags.ts --dry-run
 */

import { Client } from 'pg';
import dotenv from 'dotenv';
import { getCoordinates, getFsaCentroid, loadPostalCodes, isDataLoaded } from '@/lib/postalCodes';
import { parsePostalFromAddress } from './parsePostal';
import { geoFlagsFor } from '@/lib/property/geoFlags';
dotenv.config({ path: ['.env.local', '.env'] });

const DRY_RUN = process.argv.includes('--dry-run');
const SINCE = argValue('since');
const BATCH = Number(argValue('batch') ?? 1000);

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const FULL_POSTAL = /^[A-Z]\d[A-Z]\d[A-Z]\d$/;

/** Best full 6-char postal: a complete PostalCode field, else parsed from the address. */
function bestPostal(postalCode: string | null, address: string | null): string | null {
  const pc = (postalCode ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (FULL_POSTAL.test(pc)) return `${pc.slice(0, 3)} ${pc.slice(3)}`;
  return parsePostalFromAddress(address);
}

/**
 * Resolve a block-level coordinate, or null if only a coarse (FSA-centroid)
 * approximation is available. getCoordinates falls back to the FSA centroid when
 * the full postal isn't in the LDU/Canada libraries; we detect that by comparing
 * against the FSA centroid and reject it — too coarse for floodplain containment.
 */
function preciseCoord(postal: string | null): { lat: number; lng: number } | null {
  if (!postal) return null;
  const c = getCoordinates(postal);
  if (!c) return null;
  const fsa = getFsaCentroid(postal.slice(0, 3));
  if (fsa && c.lat === fsa.lat && c.lng === fsa.lng) return null; // FSA-centroid fallback → reject
  return c;
}

interface ListingRow {
  listing_key: string;
  postal_code: string | null;
  address: string | null;
}

async function main() {
  const DATABASE_URL = process.env.DATABASE_URL || process.env.DIRECT_DB_URL;
  if (!DATABASE_URL) {
    console.error('❌ Set DATABASE_URL (Session pooler, §12)');
    process.exit(1);
  }
  if (!isDataLoaded()) loadPostalCodes();

  console.log(`\n🌊 enrichGeoFlags → listing_geo_flags  (${DRY_RUN ? 'DRY RUN' : 'APPLY'}${SINCE ? `, since ${SINCE}` : ', full backfill'})`);
  console.log('==================================================================\n');

  const client = new Client({
    connectionString: DATABASE_URL,
    connectionTimeoutMillis: 15000,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  await client.query("SET statement_timeout TO '0'");
  console.log('   ✅ Connected (statement_timeout disabled)\n');

  let scanned = 0;
  let geocoded = 0;
  let flooded = 0;
  let written = 0;
  let cursor = ''; // listing_key cursor (text, ascending)

  try {
    for (;;) {
      // Page listings by listing_key. Pull only the two payload fields we need
      // (detoasts JSONB per row, but batched + statement_timeout=0 → fine, §12).
      const where = ['listing_key > $1'];
      const params: (string | number)[] = [cursor];
      if (SINCE) {
        where.push(`synced_at > $${params.length + 1}`);
        params.push(SINCE);
      }
      params.push(BATCH);
      const { rows } = await client.query<ListingRow>(
        `SELECT listing_key,
                full_payload->>'PostalCode'     AS postal_code,
                full_payload->>'UnparsedAddress' AS address
         FROM listings
         WHERE ${where.join(' AND ')}
         ORDER BY listing_key
         LIMIT $${params.length}`,
        params
      );
      if (rows.length === 0) break;
      cursor = rows[rows.length - 1].listing_key;
      scanned += rows.length;

      // Resolve block-level points in TS (mirrors the ETL geocoder).
      const keys: string[] = [];
      const lngs: number[] = [];
      const lats: number[] = [];
      for (const r of rows) {
        const coord = preciseCoord(bestPostal(r.postal_code, r.address));
        if (!coord) continue;
        keys.push(r.listing_key);
        lngs.push(coord.lng);
        lats.push(coord.lat);
      }
      geocoded += keys.length;
      if (keys.length === 0) {
        if (scanned % (BATCH * 10) === 0) console.log(`   … scanned ${scanned}`);
        continue;
      }

      // One set-based spatial query: each point gets a GIST-indexed flood probe.
      const spatial = await client.query<{ listing_key: string; in_flood: boolean }>(
        `SELECT t.k AS listing_key,
                EXISTS (
                  SELECT 1 FROM geo_floodplain f
                  WHERE ST_Intersects(f.geom, ST_SetSRID(ST_MakePoint(t.lng, t.lat), 4326))
                ) AS in_flood
         FROM unnest($1::text[], $2::float8[], $3::float8[]) AS t(k, lng, lat)`,
        [keys, lngs, lats]
      );

      // Map → DiligenceFlag[] (pure) and build upsert arrays.
      const upKeys: string[] = [];
      const upFlags: string[] = [];
      for (const row of spatial.rows) {
        const flags = geoFlagsFor({ in_flood: row.in_flood });
        if (row.in_flood) flooded += 1;
        upKeys.push(row.listing_key);
        upFlags.push(JSON.stringify(flags));
      }

      if (!DRY_RUN && upKeys.length) {
        const up = await client.query(
          `INSERT INTO listing_geo_flags (listing_key, flags, computed_at)
           SELECT k, f::jsonb, now()
           FROM unnest($1::text[], $2::text[]) AS t(k, f)
           ON CONFLICT (listing_key) DO UPDATE
             SET flags = EXCLUDED.flags, computed_at = EXCLUDED.computed_at`,
          [upKeys, upFlags]
        );
        written += up.rowCount ?? 0;
      }

      if (scanned % (BATCH * 10) === 0 || rows.length < BATCH) {
        console.log(`   … scanned ${scanned} · geocoded ${geocoded} · flood ${flooded}`);
      }
      if (rows.length < BATCH) break;
    }

    console.log(`\n   📊 scanned=${scanned} · block-level geocoded=${geocoded} · in floodplain=${flooded}`);
    console.log(`   ${DRY_RUN ? '🔎 (dry run — nothing written)' : `✅ upserted ${written} listing_geo_flags rows`}`);
    console.log('\n==================================================================\n');
  } catch (err) {
    const e = err as { message?: string };
    console.error('\n❌ enrichGeoFlags failed:', e.message);
    console.error('   (Safe to re-run — upserts by listing_key are idempotent.)');
    throw err;
  } finally {
    await client.end();
    console.log('🔌 Connection closed.\n');
  }
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
