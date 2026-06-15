/**
 * enrichGeoFlags — precompute per-listing geo "Things to Know" flags into
 * listing_geo_flags (Phase 2, migration 037). Registry-driven: the spatial
 * predicates are generated from src/lib/property/geoDatasets.ts, so adding a
 * dataset there automatically adds its predicate here.
 *
 * For each coord-bearing listing we resolve a BLOCK-LEVEL point and run every
 * active dataset's predicate (polygon intersect / nearest-within-N-metres) in one
 * set-based query against geo_features, map the result to DiligenceFlag[] via the
 * pure geoFlagsFor(), and upsert one JSONB row. The read path then does a single
 * indexed PK lookup — no spatial query at request time (§5 Disk-IO budget).
 *
 * COORDINATES (no lat/lng in the IDX feed): mirror the ETL (transformer.ts →
 * resolveLocation) — resolve from the postal code. The feed's PostalCode is often
 * FSA-only, so we prefer a full 6-char PostalCode, else parse the full code from
 * UnparsedAddress (parsePostal.ts), and REJECT FSA-centroid fallbacks so a flag
 * never fires off a town-centroid blob. Postal/block-level precision is the known
 * limitation (rooftop geocoding is a future enhancement).
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

import { Client } from "pg";
import dotenv from "dotenv";
import { getCoordinates, getFsaCentroid, loadPostalCodes, isDataLoaded } from "@/lib/postalCodes";
import { parsePostalFromAddress } from "./parsePostal";
import { geoFlagsFor, type GeoSignals } from "@/lib/property/geoFlags";
import { ACTIVE_DATASETS } from "@/lib/property/geoDatasets";
dotenv.config({ path: [".env.local", ".env"] });

const DRY_RUN = process.argv.includes("--dry-run");
const SINCE = argValue("since");
const BATCH = Number(argValue("batch") ?? 1000);

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const FULL_POSTAL = /^[A-Z]\d[A-Z]\d[A-Z]\d$/;

/** Best full 6-char postal: a complete PostalCode field, else parsed from the address. */
function bestPostal(postalCode: string | null, address: string | null): string | null {
  const pc = (postalCode ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (FULL_POSTAL.test(pc)) return `${pc.slice(0, 3)} ${pc.slice(3)}`;
  return parsePostalFromAddress(address);
}

/** A full-postal coord farther than this from its own FSA centroid is a corrupt
 *  source row (the postal data has bad rows, e.g. M5B 0C1 → 28 km north of M5B). */
const MAX_FSA_DEVIATION_KM = 20;

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Resolve a block-level coordinate, or null if it's untrustworthy:
 *   - a coarse FSA-centroid fallback (too imprecise for a containment flag), or
 *   - a full-postal coord implausibly far from its own FSA centroid (a corrupt
 *     source row — reject rather than emit a flag at the wrong location).
 */
function preciseCoord(postal: string | null): { lat: number; lng: number } | null {
  if (!postal) return null;
  const c = getCoordinates(postal);
  if (!c) return null;
  const fsa = getFsaCentroid(postal.slice(0, 3));
  if (fsa) {
    if (c.lat === fsa.lat && c.lng === fsa.lng) return null; // FSA-centroid fallback → too coarse
    if (haversineKm(c.lat, c.lng, fsa.lat, fsa.lng) > MAX_FSA_DEVIATION_KM) return null; // corrupt row
  }
  return c;
}

/** Build the per-point spatial SELECT columns from the active dataset registry. */
function spatialColumns(): string {
  return ACTIVE_DATASETS.map((ds) => {
    if (ds.predicate.type === "intersect") {
      return `EXISTS (SELECT 1 FROM geo_features f WHERE f.kind='${ds.kind}'
                AND ST_Intersects(f.geom, p.geom)) AS in_${ds.kind}`;
    }
    const m = ds.predicate.meters;
    return `(SELECT MIN(ST_Distance(f.geom::geography, p.geom::geography))
               FROM geo_features f
              WHERE f.kind='${ds.kind}'
                AND ST_DWithin(f.geom::geography, p.geom::geography, ${m})) AS m_${ds.kind}`;
  }).join(",\n         ");
}

/** Map a spatial result row → GeoSignals for geoFlagsFor. */
function rowToSignals(row: Record<string, unknown>): GeoSignals {
  const inside: Record<string, boolean> = {};
  const distanceM: Record<string, number | null> = {};
  for (const ds of ACTIVE_DATASETS) {
    if (ds.predicate.type === "intersect") {
      inside[ds.kind] = row[`in_${ds.kind}`] === true;
    } else {
      const v = row[`m_${ds.kind}`];
      distanceM[ds.kind] = v == null ? null : Number(v);
    }
  }
  return { inside, distanceM };
}

interface ListingRow {
  listing_key: string;
  postal_code: string | null;
  address: string | null;
}

async function main() {
  const DATABASE_URL = process.env.DATABASE_URL || process.env.DIRECT_DB_URL;
  if (!DATABASE_URL) {
    console.error("❌ Set DATABASE_URL (Session pooler, §12)");
    process.exit(1);
  }
  if (!isDataLoaded()) loadPostalCodes();

  console.log(
    `\n🌍 enrichGeoFlags → listing_geo_flags  (${DRY_RUN ? "DRY RUN" : "APPLY"}${SINCE ? `, since ${SINCE}` : ", full backfill"})`,
  );
  console.log(`   datasets: ${ACTIVE_DATASETS.map((d) => d.kind).join(", ")}`);
  console.log("==================================================================\n");

  const client = new Client({
    connectionString: DATABASE_URL,
    connectionTimeoutMillis: 15000,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  await client.query("SET statement_timeout TO '0'");

  // A freshly-loaded geo_features has NO planner statistics and no metric-distance
  // index, so the spatial joins pick terrible plans and crawl. Build a geography
  // GIST (so ST_DWithin(::geography) is indexed) and ANALYZE so ST_Intersects /
  // ST_DWithin use the GIST indexes. Both idempotent — cheap on re-runs.
  console.log("   ⚙️  ensuring geography index + fresh statistics on geo_features…");
  await client.query(
    "CREATE INDEX IF NOT EXISTS geo_features_geog_gix ON geo_features USING GIST ((geom::geography))",
  );
  await client.query("ANALYZE geo_features");

  const cols = spatialColumns();
  const flagCounts: Record<string, number> = {};
  let scanned = 0;
  let geocoded = 0;
  let written = 0;
  let cursor = "";

  try {
    for (;;) {
      const where = ["listing_key > $1"];
      const params: (string | number)[] = [cursor];
      if (SINCE) {
        where.push(`synced_at > $${params.length + 1}`);
        params.push(SINCE);
      }
      params.push(BATCH);
      const { rows } = await client.query<ListingRow>(
        `SELECT listing_key,
                full_payload->>'PostalCode'      AS postal_code,
                full_payload->>'UnparsedAddress' AS address
         FROM listings
         WHERE ${where.join(" AND ")}
         ORDER BY listing_key
         LIMIT $${params.length}`,
        params,
      );
      if (rows.length === 0) break;
      cursor = rows[rows.length - 1].listing_key;
      scanned += rows.length;

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
        console.log(`   … scanned ${scanned} (no block-level coords in this batch)`);
        continue;
      }

      // One set-based query: every active predicate per point, GIST-indexed.
      const spatial = await client.query<Record<string, unknown>>(
        `WITH pts AS (
           SELECT k, ST_SetSRID(ST_MakePoint(lng, lat), 4326) AS geom
           FROM unnest($1::text[], $2::float8[], $3::float8[]) AS u(k, lng, lat)
         )
         SELECT p.k AS listing_key,
         ${cols}
         FROM pts p`,
        [keys, lngs, lats],
      );

      const upKeys: string[] = [];
      const upFlags: string[] = [];
      for (const row of spatial.rows) {
        const flags = geoFlagsFor(rowToSignals(row));
        for (const f of flags) flagCounts[f.id] = (flagCounts[f.id] ?? 0) + 1;
        upKeys.push(row.listing_key as string);
        upFlags.push(JSON.stringify(flags));
      }

      if (!DRY_RUN && upKeys.length) {
        const up = await client.query(
          `INSERT INTO listing_geo_flags (listing_key, flags, computed_at)
           SELECT k, f::jsonb, now()
           FROM unnest($1::text[], $2::text[]) AS t(k, f)
           ON CONFLICT (listing_key) DO UPDATE
             SET flags = EXCLUDED.flags, computed_at = EXCLUDED.computed_at`,
          [upKeys, upFlags],
        );
        written += up.rowCount ?? 0;
      }

      console.log(`   … scanned ${scanned} · geocoded ${geocoded} · written ${written}`);
      if (rows.length < BATCH) break;
    }

    const summary = Object.entries(flagCounts)
      .map(([id, n]) => `${id}=${n}`)
      .join(" · ");
    console.log(`\n   📊 scanned=${scanned} · block-level geocoded=${geocoded}`);
    console.log(`   📊 flags: ${summary || "(none)"}`);
    console.log(`   ${DRY_RUN ? "🔎 (dry run — nothing written)" : `✅ upserted ${written} listing_geo_flags rows`}`);
    console.log("\n==================================================================\n");
  } catch (err) {
    const e = err as { message?: string };
    console.error("\n❌ enrichGeoFlags failed:", e.message);
    console.error("   (Safe to re-run — upserts by listing_key are idempotent.)");
    throw err;
  } finally {
    await client.end();
    console.log("🔌 Connection closed.\n");
  }
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
