/**
 * loadCensus — load Census 2021 area facts for Ontario (migration 160).
 *
 *   1. Reads the profile extract (extractProfile.ts output): DA and CSD rows, in the file's
 *      nesting order, so each DA belongs to the CSD row above it.
 *   2. Reads the DA boundary shapefile (lda_000b21a_e, EPSG:3347 Lambert metres), keeps
 *      Ontario (PRUID 35), simplifies each ring (Douglas-Peucker, SIMPLIFY_M) and writes
 *      census_da in 4326.
 *   3. Pools each DA with its up-to-4 nearest DAs in the same CSD (centroids within
 *      POOL_RADIUS_M) and writes census_da_area.facts (src/lib/census/areaFacts.ts).
 *   4. Backfills listing_geo_flags.census_dauid from the cached listing points.
 *
 * Idempotent: each table is replaced in one transaction; the backfill only touches rows
 * whose DA changed. Requires DATABASE_URL = Supabase Session pooler string (§12).
 *
 * Get the two files (Statistics Canada, Open Licence; the site blocks scripted downloads,
 * so download them in a browser):
 *   98-401-X2021006_eng_CSV.zip   Census Profile 2021, DAs (comprehensive CSV)
 *   lda_000b21a_e.zip             2021 DA boundary file (digital, shapefile)
 * Then:
 *   unzip -p 98-401-X2021006_eng_CSV.zip 98-401-X2021006_English_CSV_data_Ontario.csv \
 *     | npx tsx scripts/worker/census/extractProfile.ts > profile_on.ndjson
 *   unzip lda_000b21a_e.zip -d bnd
 *   npx tsx scripts/worker/census/loadCensus.ts --profile profile_on.ndjson --shp bnd/lda_000b21a_e [--dry-run]
 *   backfill only:  npx tsx scripts/worker/census/loadCensus.ts --backfill-only
 */
import { Client } from "pg";
import * as fs from "fs";
import { readProfile } from "./profile";
import dotenv from "dotenv";
import { buildAreaFacts, type AreaFacts, type ProfileValues } from "@/lib/census/areaFacts";
dotenv.config({ path: [".env.local", ".env"] });

const DRY_RUN = process.argv.includes("--dry-run");
const BACKFILL_ONLY = process.argv.includes("--backfill-only");
const SIMPLIFY_M = 10;
const POOL_SIZE = 5; // the DA itself + 4 neighbours
const POOL_RADIUS_M = 1500;
const INSERT_CHUNK = 250;
const BACKFILL_BATCH = 5000;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

// ── shapefile (polygon, type 5) + dbf ───────────────────────────────────────────────────
type Ring = [number, number][];

function readDbf(file: string): Array<{ DAUID: string; PRUID: string }> {
  const b = fs.readFileSync(file);
  const n = b.readUInt32LE(4);
  const headerLen = b.readUInt16LE(8);
  const recLen = b.readUInt16LE(10);
  const fields: Array<{ name: string; len: number; off: number }> = [];
  let o = 32;
  let off = 1; // deletion flag
  while (b[o] !== 0x0d) {
    const name = b.toString("latin1", o, o + 11).replace(/\0.*$/, "");
    const len = b[o + 16];
    fields.push({ name, len, off });
    off += len;
    o += 32;
  }
  const get = (rec: number, name: string) => {
    const f = fields.find((x) => x.name === name)!;
    const p = headerLen + rec * recLen + f.off;
    return b.toString("latin1", p, p + f.len).trim();
  };
  const out: Array<{ DAUID: string; PRUID: string }> = [];
  for (let i = 0; i < n; i++) out.push({ DAUID: get(i, "DAUID"), PRUID: get(i, "PRUID") });
  return out;
}

function* readShpPolygons(file: string): Generator<Ring[]> {
  const b = fs.readFileSync(file);
  let o = 100;
  while (o < b.length) {
    const contentLen = b.readInt32BE(o + 4) * 2;
    const c = o + 8;
    const type = b.readInt32LE(c);
    if (type === 0) {
      yield [];
    } else {
      if (type !== 5) throw new Error(`unexpected shape type ${type}`);
      const numParts = b.readInt32LE(c + 36);
      const numPoints = b.readInt32LE(c + 40);
      const parts: number[] = [];
      for (let i = 0; i < numParts; i++) parts.push(b.readInt32LE(c + 44 + 4 * i));
      const pts = c + 44 + 4 * numParts;
      const rings: Ring[] = [];
      for (let i = 0; i < numParts; i++) {
        const end = i + 1 < numParts ? parts[i + 1] : numPoints;
        const ring: Ring = [];
        for (let j = parts[i]; j < end; j++) ring.push([b.readDoubleLE(pts + 16 * j), b.readDoubleLE(pts + 16 * j + 8)]);
        rings.push(ring);
      }
      yield rings;
    }
    o = c + contentLen;
  }
}

/** Shoelace; shapefile outer rings are clockwise → negative here. */
function signedArea(r: Ring): number {
  let s = 0;
  for (let i = 0; i < r.length - 1; i++) s += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1];
  return s / 2;
}

function simplify(r: Ring, tol: number): Ring {
  if (r.length <= 4) return r;
  const keep = new Uint8Array(r.length);
  keep[0] = keep[r.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, r.length - 1]];
  while (stack.length) {
    const [a, z] = stack.pop()!;
    const [ax, ay] = r[a];
    const [zx, zy] = r[z];
    const dx = zx - ax;
    const dy = zy - ay;
    const len2 = dx * dx + dy * dy;
    let best = -1;
    let bestD = 0;
    for (let i = a + 1; i < z; i++) {
      const [px, py] = r[i];
      let d: number;
      if (len2 === 0) d = Math.hypot(px - ax, py - ay);
      else d = Math.abs(dy * px - dx * py + zx * ay - zy * ax) / Math.sqrt(len2);
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best > 0 && bestD > tol) {
      keep[best] = 1;
      stack.push([a, best], [best, z]);
    }
  }
  const out = r.filter((_, i) => keep[i]);
  return out.length >= 4 ? out : r;
}

/** Rings → MultiPolygon coordinates: each clockwise ring starts a polygon, holes follow it. */
function toMultiPolygon(rings: Ring[]): Ring[][] {
  const polys: Ring[][] = [];
  for (const raw of rings) {
    if (raw.length < 4) continue;
    const r = simplify(raw, SIMPLIFY_M);
    if (signedArea(raw) <= 0 || polys.length === 0) polys.push([r]);
    else if (r.length >= 4) polys[polys.length - 1].push(r);
  }
  return polys;
}

function centroid(rings: Ring[]): [number, number] {
  // Area-weighted centroid of the outer rings (good enough to rank neighbours).
  let ax = 0;
  let ay = 0;
  let at = 0;
  for (const r of rings) {
    const a = signedArea(r);
    if (a >= 0) continue;
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < r.length - 1; i++) {
      const f = r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1];
      cx += (r[i][0] + r[i + 1][0]) * f;
      cy += (r[i][1] + r[i + 1][1]) * f;
    }
    ax += cx / 6;
    ay += cy / 6;
    at += a;
  }
  return at === 0 ? rings[0][0] : [ax / at, ay / at];
}

// ── main ──────────────────────────────────────────────────────────────────────────────────
async function backfill(client: Client) {
  // Keyset batches, not one UPDATE: ~340k listing points, and a single statement would
  // rewrite the whole 185 MB table in one burst (§5 Disk-IO budget). Rows already on the
  // right DA are skipped, so a re-run only writes what changed.
  console.log("   🔗 backfilling listing_geo_flags.census_dauid …");
  let after = "";
  let updated = 0;
  let scanned = 0;
  for (;;) {
    const r = await client.query<{ last: string | null; n: string; up: string }>(
      `WITH batch AS (
         SELECT listing_key, geom FROM listing_geo_flags
          WHERE listing_key > $1 AND geom IS NOT NULL
          ORDER BY listing_key LIMIT $2
       ), hit AS (
         SELECT b.listing_key,
                (SELECT d.dauid FROM census_da d WHERE ST_Intersects(d.geom, b.geom) LIMIT 1) AS dauid
           FROM batch b
       ), up AS (
         UPDATE listing_geo_flags g SET census_dauid = h.dauid
           FROM hit h
          WHERE g.listing_key = h.listing_key AND g.census_dauid IS DISTINCT FROM h.dauid
         RETURNING 1
       )
       SELECT (SELECT max(listing_key) FROM batch) AS last,
              (SELECT count(*) FROM batch) AS n,
              (SELECT count(*) FROM up) AS up`,
      [after, BACKFILL_BATCH],
    );
    const row = r.rows[0];
    if (!row.last) break;
    after = row.last;
    scanned += Number(row.n);
    updated += Number(row.up);
    if ((scanned / BACKFILL_BATCH) % 10 === 0) console.log(`   … scanned ${scanned} · updated ${updated}`);
    if (Number(row.n) < BACKFILL_BATCH) break;
  }
  console.log(`   ✅ scanned ${scanned} listing points · ${updated} got a new DA`);
}

async function main() {
  const DATABASE_URL = process.env.DATABASE_URL || process.env.DIRECT_DB_URL;
  if (!DRY_RUN && !DATABASE_URL) throw new Error("Set DATABASE_URL (Session pooler, §12)");

  if (BACKFILL_ONLY) {
    const client = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await client.connect();
    await client.query("SET statement_timeout TO '0'");
    try {
      await backfill(client);
    } finally {
      await client.end();
    }
    return;
  }

  const profileFile = arg("profile");
  const shp = arg("shp");
  if (!profileFile || !shp) throw new Error("--profile <ndjson> and --shp <path without extension> are required");

  console.log("\n🇨🇦 loadCensus → census_da, census_da_area");
  const { da, csd } = await readProfile(profileFile);
  console.log(`   profile: ${da.size} DAs, ${csd.size} CSDs`);

  const dbf = readDbf(`${shp}.dbf`);
  const shapes: Array<{ dauid: string; csd: string; mp: Ring[][]; c: [number, number] }> = [];
  let i = 0;
  let noProfile = 0;
  for (const rings of readShpPolygons(`${shp}.shp`)) {
    const rec = dbf[i++];
    if (rec.PRUID !== "35" || rings.length === 0) continue;
    const p = da.get(rec.DAUID);
    if (!p) {
      noProfile++;
      continue;
    }
    shapes.push({ dauid: rec.DAUID, csd: p.csd, mp: toMultiPolygon(rings), c: centroid(rings) });
  }
  console.log(`   boundaries: ${shapes.length} Ontario DAs (${noProfile} without a profile row skipped)`);

  // Neighbour pools, per CSD.
  const byCsd = new Map<string, typeof shapes>();
  for (const s of shapes) {
    const list = byCsd.get(s.csd);
    if (list) list.push(s);
    else byCsd.set(s.csd, [s]);
  }
  const facts: Array<{ dauid: string; csd: string; facts: AreaFacts }> = [];
  for (const [csdCode, list] of byCsd) {
    const city = csd.get(csdCode)!;
    for (const s of list) {
      const near = list
        .filter((o) => o !== s)
        .map((o) => ({ o, d: Math.hypot(o.c[0] - s.c[0], o.c[1] - s.c[1]) }))
        .filter((x) => x.d <= POOL_RADIUS_M)
        .sort((a, b) => a.d - b.d)
        .slice(0, POOL_SIZE - 1)
        .map((x) => x.o);
      const pool = [s, ...near].map((x) => da.get(x.dauid)!.v);
      facts.push({ dauid: s.dauid, csd: csdCode, facts: buildAreaFacts(pool, city.v, city.name) });
    }
  }

  console.log(`   facts: ${facts.length} DAs, cities e.g. ${[...new Set(facts.slice(0, 2000).map((f) => f.facts.cityName))].slice(0, 5).join(" / ")}`);
  const toronto = facts.find((f) => f.csd === "3520005");
  if (toronto) console.log("   sample (Toronto DA", toronto.dauid, "):", JSON.stringify(toronto.facts.here), "\n   city:", JSON.stringify(toronto.facts.city));
  const torontoCsd = csd.get("3520005");
  if (torontoCsd) console.log(`   check: Toronto median household income, official ${torontoCsd.v[243]?.[0]} vs interpolated ${toronto?.facts.city.medianIncome}`);
  const geoBytes = shapes.reduce((a, s) => a + JSON.stringify(s.mp).length, 0);
  console.log(`   geometry text: ${(geoBytes / 1e6).toFixed(1)} MB after ${SIMPLIFY_M} m simplify`);

  if (DRY_RUN) {
    console.log("   🔎 dry run — nothing written");
    return;
  }

  const client = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  await client.query("SET statement_timeout TO '0'");
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM census_da");
    for (let k = 0; k < shapes.length; k += INSERT_CHUNK) {
      const chunk = shapes.slice(k, k + INSERT_CHUNK);
      await client.query(
        `INSERT INTO census_da (dauid, csd_uid, geom)
         SELECT d, c, ST_Multi(ST_CollectionExtract(ST_MakeValid(
                  ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(g), 3347), 4326)), 3))
         FROM unnest($1::text[], $2::text[], $3::text[]) AS t(d, c, g)`,
        [
          chunk.map((s) => s.dauid),
          chunk.map((s) => s.csd),
          chunk.map((s) => JSON.stringify({ type: "MultiPolygon", coordinates: s.mp })),
        ],
      );
      if ((k / INSERT_CHUNK) % 20 === 0) console.log(`   … census_da ${k + chunk.length}/${shapes.length}`);
    }
    await client.query("DELETE FROM census_da_area");
    for (let k = 0; k < facts.length; k += 1000) {
      const chunk = facts.slice(k, k + 1000);
      await client.query(
        `INSERT INTO census_da_area (dauid, csd_uid, facts)
         SELECT d, c, f::jsonb FROM unnest($1::text[], $2::text[], $3::text[]) AS t(d, c, f)`,
        [chunk.map((f) => f.dauid), chunk.map((f) => f.csd), chunk.map((f) => JSON.stringify(f.facts))],
      );
    }
    await client.query("COMMIT");
    console.log(`   ✅ census_da ${shapes.length} · census_da_area ${facts.length}`);
    await client.query("ANALYZE census_da");
    await backfill(client);
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    await client.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("❌ loadCensus failed:", e);
    process.exit(1);
  });
