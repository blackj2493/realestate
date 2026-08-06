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
 * The block-level point is ALSO cached in listing_geo_flags.geom (migration 063), so a
 * single-dataset refresh (--dataset) can recompute just that flag against only the
 * listings near a changed feature — a set-based spatial join keyed on geom — without
 * re-scanning every listing's (large, TOASTed) full_payload or re-running all 11
 * predicates. That's what makes the weekly dev_application refresh cheap enough to run
 * weekly without depleting the Disk-IO budget.
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
 *   bootstrap geom:     npx tsx scripts/worker/enrichGeoFlags.ts --geom-only        (one-time, after migration 055)
 *   single-dataset:     npx tsx scripts/worker/enrichGeoFlags.ts --dataset dev_application   (cheap; needs geom cached)
 */

import { Client } from "pg";
import dotenv from "dotenv";
import { getCoordinates, getFsaCentroid, loadPostalCodes, isDataLoaded } from "@/lib/postalCodes";
import { parsePostalFromAddress } from "./parsePostal";
import { geoFlagsFor, mergeDatasetFlag, type GeoSignals } from "@/lib/property/geoFlags";
import { ACTIVE_DATASETS, DESCRIPTOR_DATASETS, buildGeoFlag, describeFeature } from "@/lib/property/geoDatasets";
import type { DiligenceFlag } from "@/lib/property/diligence";
dotenv.config({ path: [".env.local", ".env"] });

const DRY_RUN = process.argv.includes("--dry-run");
const GEOM_ONLY = process.argv.includes("--geom-only"); // bootstrap listing_geo_flags.geom only
const DATASET = argValue("dataset"); // targeted single-dataset merge refresh (needs geom cached)
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
    // Index-optimized: ST_DWithin with the CONSTANT dataset radius prunes candidates through
    // the geography GIST index; the explicit ST_Distance filter then applies any tighter
    // per-source radius (attrs._match_radius_m, e.g. dense Toronto ≤150 m). A VARIABLE distance
    // inside ST_DWithin defeats the index (seq scan over all geo_features → ~100x slower, CI
    // timeout) — so the index bound stays constant and the per-feature radius refines it.
    // predicate.meters must be >= the largest per-source radius (it's the index superset).
    return `(SELECT MIN(ST_Distance(f.geom::geography, p.geom::geography))
               FROM geo_features f
              WHERE f.kind='${ds.kind}'
                AND ST_DWithin(f.geom::geography, p.geom::geography, ${m})
                AND ST_Distance(f.geom::geography, p.geom::geography)
                    <= COALESCE((f.attrs->>'_match_radius_m')::float8, ${m})) AS m_${ds.kind}`;
  }).join(",\n         ");
}

/**
 * Extra SELECT columns for descriptor datasets (permits / dev apps): the NEAREST matched
 * feature's attrs, so geoFlagsFor can say WHAT the nearby activity is. Uses the SAME
 * match predicate as spatialColumns' distance branch (index-driven ST_DWithin superset +
 * exact per-source _match_radius_m refine), so `attrs_<kind>` describes exactly the feature
 * that produced `m_<kind>`. Deterministic tiebreak on f.id for stable re-runs. Purely
 * additive — the distance computation in spatialColumns() is untouched. Empty when no
 * descriptor datasets are active. */
function descriptorColumns(): string {
  return DESCRIPTOR_DATASETS.map((ds) => {
    const m = (ds.predicate as { type: "distance"; meters: number }).meters;
    return `(SELECT f.attrs
               FROM geo_features f
              WHERE f.kind='${ds.kind}'
                AND ST_DWithin(f.geom::geography, p.geom::geography, ${m})
                AND ST_Distance(f.geom::geography, p.geom::geography)
                    <= COALESCE((f.attrs->>'_match_radius_m')::float8, ${m})
              ORDER BY ST_Distance(f.geom::geography, p.geom::geography), f.id
              LIMIT 1) AS attrs_${ds.kind}`;
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
  // Nearest-feature attrs for descriptor datasets (pg parses jsonb → object).
  const nearestAttrs: Record<string, Record<string, unknown> | null> = {};
  for (const ds of DESCRIPTOR_DATASETS) {
    const a = row[`attrs_${ds.kind}`];
    nearestAttrs[ds.kind] = a != null && typeof a === "object" ? (a as Record<string, unknown>) : null;
  }
  return { inside, distanceM, nearestAttrs };
}

interface ListingRow {
  listing_key: string;
  postal_code: string | null;
  address: string | null;
}

/** Stamp a geo flag's provenance date (asOf) from geo_sources, matching the full sweep. */
function withAsOf(flag: DiligenceFlag, sourceDates: Record<string, string>): DiligenceFlag {
  return sourceDates[flag.id] ? { ...flag, asOf: sourceDates[flag.id] } : flag;
}

/** Read the geo_sources retrieval date per dataset kind → the card's "as of <month>". */
async function loadSourceDates(client: Client): Promise<Record<string, string>> {
  const { rows } = await client.query<{ kind: string | null; retrieved_on: string | null }>(
    "SELECT kind, MAX(retrieved_on)::text AS retrieved_on FROM geo_sources GROUP BY kind",
  );
  const out: Record<string, string> = {};
  for (const r of rows) if (r.kind && r.retrieved_on) out[r.kind] = r.retrieved_on;
  return out;
}

// ── FULL / DELTA / GEOM-ONLY: scan listings, geocode, compute + upsert ─────────
async function runScanSweep(client: Client, sourceDates: Record<string, string>) {
  const cols = spatialColumns();
  const descCols = descriptorColumns();
  const flagCounts: Record<string, number> = {};
  let scanned = 0;
  let geocoded = 0;
  let written = 0;
  let cursor = argValue("after") ?? ""; // resume a killed sweep from a listing_key

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

    // Geocode this batch. `coordByKey` lets us attach each geocoded row's point to the
    // spatial-result rows (whose order need not match the input) when we upsert geom.
    const keys: string[] = [];
    const lngs: number[] = [];
    const lats: number[] = [];
    const coordByKey = new Map<string, { lng: number; lat: number }>();
    const upKeys: string[] = [];
    const upFlags: string[] = [];
    const upChecked: boolean[] = [];
    const upLng: (number | null)[] = [];
    const upLat: (number | null)[] = [];
    for (const r of rows) {
      const coord = preciseCoord(bestPostal(r.postal_code, r.address));
      if (!coord) {
        // GEOM-ONLY bootstrap only SETS geom for geocoded rows — leave no-coord rows'
        // flags/checked exactly as they are (don't create or clear anything).
        if (GEOM_ONLY) continue;
        // Full/delta: write an empty row so any PRIOR flags are CLEARED (a listing whose
        // coord becomes rejected later must not keep stale flags at the wrong location),
        // and NULL geom for the same reason. checked=false: [] here means "couldn't
        // check", NOT "checked & clear".
        upKeys.push(r.listing_key);
        upFlags.push("[]");
        upChecked.push(false);
        upLng.push(null);
        upLat.push(null);
        continue;
      }
      keys.push(r.listing_key);
      lngs.push(coord.lng);
      lats.push(coord.lat);
      coordByKey.set(r.listing_key, coord);
    }
    geocoded += keys.length;

    // GEOM-ONLY: just cache the point (no spatial predicates, no flag changes).
    if (GEOM_ONLY) {
      if (!DRY_RUN && keys.length) {
        const up = await client.query(
          `INSERT INTO listing_geo_flags (listing_key, geom)
           SELECT k, ST_SetSRID(ST_MakePoint(lng, lat), 4326)
           FROM unnest($1::text[], $2::float8[], $3::float8[]) AS t(k, lng, lat)
           ON CONFLICT (listing_key) DO UPDATE SET geom = EXCLUDED.geom`,
          [keys, lngs, lats],
        );
        written += up.rowCount ?? 0;
      }
      console.log(`   … scanned ${scanned} · geocoded ${geocoded} · geom-written ${written}`);
      if (rows.length < BATCH) break;
      continue;
    }

    // Full/delta: one set-based query — every active predicate per point, GIST-indexed.
    if (keys.length > 0) {
      const spatial = await client.query<Record<string, unknown>>(
        `WITH pts AS (
           SELECT k, ST_SetSRID(ST_MakePoint(lng, lat), 4326) AS geom
           FROM unnest($1::text[], $2::float8[], $3::float8[]) AS u(k, lng, lat)
         )
         SELECT p.k AS listing_key,
         ${cols}${descCols ? `,\n         ${descCols}` : ""}
         FROM pts p`,
        [keys, lngs, lats],
      );
      for (const row of spatial.rows) {
        const key = row.listing_key as string;
        const flags = geoFlagsFor(rowToSignals(row)).map((f) => withAsOf(f, sourceDates));
        for (const f of flags) flagCounts[f.id] = (flagCounts[f.id] ?? 0) + 1;
        const c = coordByKey.get(key);
        upKeys.push(key);
        upFlags.push(JSON.stringify(flags));
        upChecked.push(true);
        upLng.push(c ? c.lng : null);
        upLat.push(c ? c.lat : null);
      }
    }

    if (!DRY_RUN && upKeys.length) {
      const up = await client.query(
        `INSERT INTO listing_geo_flags (listing_key, flags, checked, computed_at, geom)
         SELECT k, f::jsonb, c, now(),
                CASE WHEN lng IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint(lng, lat), 4326) END
         FROM unnest($1::text[], $2::text[], $3::boolean[], $4::float8[], $5::float8[]) AS t(k, f, c, lng, lat)
         ON CONFLICT (listing_key) DO UPDATE
           SET flags = EXCLUDED.flags, checked = EXCLUDED.checked,
               computed_at = EXCLUDED.computed_at, geom = EXCLUDED.geom`,
        [upKeys, upFlags, upChecked, upLng, upLat],
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
  if (!GEOM_ONLY) console.log(`   📊 flags: ${summary || "(none)"}`);
  console.log(
    `   ${DRY_RUN ? "🔎 (dry run — nothing written)" : `✅ upserted ${written} listing_geo_flags rows`}`,
  );
}

// ── TARGETED: recompute ONE dataset's flag, merge into existing rows (no full scan) ──
async function runTargetedRefresh(client: Client, kind: string, sourceDates: Record<string, string>) {
  const ds = ACTIVE_DATASETS.find((d) => d.kind === kind);
  if (!ds) {
    throw new Error(
      `--dataset ${kind}: not an active dataset (active: ${ACTIVE_DATASETS.map((d) => d.kind).join(", ")})`,
    );
  }
  if (ds.predicate.type !== "distance") {
    // Only distance datasets carry the per-feature _match_radius_m + point geometry the
    // candidate join relies on. Intersect datasets can be added here if ever needed.
    throw new Error(`--dataset targeted refresh supports 'distance' datasets only (${kind} is intersect)`);
  }
  const meters = ds.predicate.meters;
  const probe = JSON.stringify([{ id: ds.flag.id }]); // flags @> [{"id": kind}] → "currently flagged"

  console.log(
    `\n🎯 targeted refresh: dataset=${kind} (radius ${meters} m) — recompute ONLY this flag and merge into existing listing_geo_flags rows.`,
  );

  // Candidate listings = those NEAR a current feature (join from the small, kind-filtered
  // feature set — index-probes listing_geo_flags.geom) UNION those that currently carry the
  // flag (so a removed / aged-out feature CLEARS the stale flag). For each, recompute the
  // per-feature-radius min distance (COALESCE mirrors the full sweep). geom NULL → excluded
  // (a listing with no trustworthy coord is correctly never flagged).
  const { rows } = await client.query<{
    listing_key: string;
    flags: unknown;
    dist: string | null;
    attrs: Record<string, unknown> | null;
  }>(
    `WITH near AS (
        SELECT DISTINCT g.listing_key
        FROM geo_features f
        JOIN listing_geo_flags g
          ON ST_DWithin(f.geom::geography, g.geom::geography, $1)
        WHERE f.kind = $2 AND g.geom IS NOT NULL
     ),
     flagged AS (
        SELECT listing_key FROM listing_geo_flags WHERE flags @> $3::jsonb
     ),
     cand AS (
        SELECT listing_key FROM near
        UNION
        SELECT listing_key FROM flagged
     )
     SELECT lgf.listing_key, lgf.flags,
            (SELECT MIN(ST_Distance(f.geom::geography, lgf.geom::geography))
               FROM geo_features f
              WHERE f.kind = $2
                AND ST_DWithin(f.geom::geography, lgf.geom::geography, $1)
                AND ST_Distance(f.geom::geography, lgf.geom::geography)
                    <= COALESCE((f.attrs->>'_match_radius_m')::float8, $1)) AS dist,
            -- Nearest feature's attrs → the "what is it" descriptor, computed with the SAME
            -- predicate as dist so the two agree; f.id tiebreak = deterministic (matches the
            -- full sweep's descriptorColumns, so a targeted refresh reproduces the identical
            -- flag and doesn't churn). Null for non-descriptor datasets → describeFeature null.
            (SELECT f.attrs
               FROM geo_features f
              WHERE f.kind = $2
                AND ST_DWithin(f.geom::geography, lgf.geom::geography, $1)
                AND ST_Distance(f.geom::geography, lgf.geom::geography)
                    <= COALESCE((f.attrs->>'_match_radius_m')::float8, $1)
              ORDER BY ST_Distance(f.geom::geography, lgf.geom::geography), f.id
              LIMIT 1) AS attrs
     FROM cand c
     JOIN listing_geo_flags lgf ON lgf.listing_key = c.listing_key
     WHERE lgf.geom IS NOT NULL`,
    [meters, kind, probe],
  );

  console.log(`   candidates: ${rows.length}`);

  const upKeys: string[] = [];
  const upFlags: string[] = [];
  let flaggedNew = 0;
  let clearedOld = 0;
  const eq = (a: DiligenceFlag | null, b: DiligenceFlag | null) =>
    JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

  for (const row of rows) {
    const existing: DiligenceFlag[] = Array.isArray(row.flags) ? (row.flags as DiligenceFlag[]) : [];
    const dist = row.dist == null ? null : Number(row.dist);
    const matched = dist != null && Number.isFinite(dist) && dist <= meters;
    const descriptor = describeFeature(kind, row.attrs);
    const newFlag = matched ? withAsOf(buildGeoFlag(ds, dist as number, descriptor), sourceDates) : null;

    const before = existing.find((f) => f && f.id === ds.flag.id) ?? null;
    if (eq(before, newFlag)) continue; // nothing about this flag changed → skip the write

    upKeys.push(row.listing_key);
    upFlags.push(JSON.stringify(mergeDatasetFlag(existing, ds.flag.id, newFlag)));
    if (newFlag && !before) flaggedNew++;
    else if (!newFlag && before) clearedOld++;
  }

  if (!DRY_RUN && upKeys.length) {
    for (let i = 0; i < upKeys.length; i += BATCH) {
      await client.query(
        `INSERT INTO listing_geo_flags (listing_key, flags, computed_at)
         SELECT k, f::jsonb, now()
         FROM unnest($1::text[], $2::text[]) AS t(k, f)
         ON CONFLICT (listing_key) DO UPDATE
           SET flags = EXCLUDED.flags, computed_at = EXCLUDED.computed_at`,
        [upKeys.slice(i, i + BATCH), upFlags.slice(i, i + BATCH)],
      );
    }
  }

  console.log(
    `   ${DRY_RUN ? "🔎 dry run —" : "✅"} candidates=${rows.length} · changed=${upKeys.length} ` +
      `(newly flagged ${flaggedNew}, cleared ${clearedOld}, rest = asOf/distance refresh)`,
  );
}

async function main() {
  const DATABASE_URL = process.env.DATABASE_URL || process.env.DIRECT_DB_URL;
  if (!DATABASE_URL) {
    console.error("❌ Set DATABASE_URL (Session pooler, §12)");
    process.exit(1);
  }
  // Targeted mode is pure SQL over cached geom — no geocoding needed.
  if (!DATASET && !isDataLoaded()) loadPostalCodes();

  const mode = DATASET
    ? `TARGETED dataset=${DATASET}`
    : GEOM_ONLY
      ? "GEOM-ONLY bootstrap"
      : SINCE
        ? `delta since ${SINCE}`
        : "full backfill";
  console.log(`\n🌍 enrichGeoFlags → listing_geo_flags  (${DRY_RUN ? "DRY RUN — " : ""}${mode})`);
  if (!DATASET) console.log(`   datasets: ${ACTIVE_DATASETS.map((d) => d.kind).join(", ")}`);
  console.log("==================================================================\n");

  const client = new Client({
    connectionString: DATABASE_URL,
    connectionTimeoutMillis: 15000,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  await client.query("SET statement_timeout TO '0'");

  // A freshly-loaded geo_features has NO planner statistics and no metric-distance index,
  // so the spatial joins pick terrible plans and crawl. Build the geography GISTs (so
  // ST_DWithin(::geography) is indexed on BOTH sides — geo_features and the cached listing
  // points) + the flags GIN (containment clear-set) and ANALYZE. All idempotent — cheap on
  // re-runs; the migration creates the same indexes, this just guarantees them at runtime.
  console.log("   ⚙️  ensuring geography indexes + fresh statistics…");
  await client.query(
    "CREATE INDEX IF NOT EXISTS geo_features_geog_gix ON geo_features USING GIST ((geom::geography))",
  );
  await client.query(
    "CREATE INDEX IF NOT EXISTS listing_geo_flags_geog_gix ON listing_geo_flags USING GIST ((geom::geography))",
  );
  await client.query(
    "CREATE INDEX IF NOT EXISTS listing_geo_flags_flags_gin ON listing_geo_flags USING GIN (flags jsonb_path_ops)",
  );
  await client.query("ANALYZE geo_features");
  await client.query("ANALYZE listing_geo_flags");

  // Provenance: stamp each geo flag with its dataset's retrieval date so the card can
  // render "as of <month year>". MAX() because multi-source datasets (e.g.
  // conservation_regulated) may have been retrieved on different days.
  const sourceDates = await loadSourceDates(client);

  try {
    if (DATASET) await runTargetedRefresh(client, DATASET, sourceDates);
    else await runScanSweep(client, sourceDates);
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
