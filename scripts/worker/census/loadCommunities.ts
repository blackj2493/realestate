/**
 * loadCommunities — Census 2021 facts per TRREB community (migration 161), for the
 * neighbourhood hub pages.
 *
 *   1. Reads the profile extract (the same profile_on.ndjson as loadCensus.ts).
 *   2. Counts listing points per (DA, City, CityRegion) from listing_geo_flags.census_dauid
 *      (filled by loadCensus.ts and the nightly enrichGeoFlags).
 *   3. Gives each DA to its main community and pools the DAs (src/lib/census/communities.ts).
 *      The city baseline is the census subdivision that holds most of the community's DAs.
 *   4. Replaces census_community_area in one transaction.
 *
 * Re-run after loadCensus.ts, or when TRREB adds communities. Requires DATABASE_URL =
 * Supabase Session pooler string (§12).
 *
 *   npx tsx scripts/worker/census/loadCommunities.ts --profile profile_on.ndjson [--dry-run]
 */
import { Client } from "pg";
import dotenv from "dotenv";
import { buildAreaFacts, type AreaFacts } from "@/lib/census/areaFacts";
import { assignDas, mode, type DaCommunityCount } from "@/lib/census/communities";
import { readProfile } from "./profile";
dotenv.config({ path: [".env.local", ".env"] });

const DRY_RUN = process.argv.includes("--dry-run");
const INSERT_CHUNK = 250;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const profileFile = arg("profile");
  if (!profileFile) throw new Error("--profile <profile_on.ndjson> is required");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const { da, csd } = await readProfile(profileFile);
  console.log(`profile: ${da.size} DAs, ${csd.size} CSDs`);

  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query("SET statement_timeout = '10min'");
    // Plain columns only (city, city_region): no payload detoast.
    const { rows } = await client.query<DaCommunityCount>(
      `SELECT g.census_dauid AS dauid, l.city, l.city_region AS community, count(*)::int AS n
         FROM listing_geo_flags g
         JOIN listings l USING (listing_key)
        WHERE g.census_dauid IS NOT NULL
          AND coalesce(l.city, '') <> ''
          AND coalesce(l.city_region, '') <> ''
        GROUP BY 1, 2, 3`,
    );
    console.log(`points: ${rows.length} (DA, community) pairs`);

    const assigned = assignDas(rows);
    const out: Array<{ city: string; community: string; csd: string; das: number; facts: AreaFacts }> = [];
    for (const [key, dauids] of assigned) {
      const [city, community] = key.split("\u0000");
      const known = dauids.filter((d) => da.has(d));
      const csdUid = mode(known.map((d) => da.get(d)!.csd));
      if (!csdUid || known.length < 2) continue;
      const c = csd.get(csdUid);
      if (!c) continue;
      const facts = buildAreaFacts(known.map((d) => da.get(d)!.v), c.v, c.name);
      if (facts.here.households == null) continue;
      out.push({ city, community, csd: csdUid, das: known.length, facts });
    }
    console.log(`communities: ${out.length} with facts (of ${assigned.size} with 2+ DAs)`);

    for (const s of out.filter((o) => ["Annex", "Leslieville", "Port Credit", "Old Oakville"].includes(o.community))) {
      const h = s.facts.here;
      console.log(
        `  ${s.city} / ${s.community}: ${s.das} DAs, pop ${s.facts.pop}, rent ${h.rentPct}% (${s.facts.cityName} ${s.facts.city.rentPct}%), commute ${h.medianCommuteMin} min, income $${h.medianIncome}`,
      );
    }
    if (DRY_RUN) {
      console.log("dry run: nothing written");
      return;
    }

    await client.query("BEGIN");
    await client.query("DELETE FROM census_community_area");
    for (let i = 0; i < out.length; i += INSERT_CHUNK) {
      const chunk = out.slice(i, i + INSERT_CHUNK);
      const vals: unknown[] = [];
      const tuples = chunk.map((o, j) => {
        vals.push(o.city, o.community, o.csd, o.das, JSON.stringify(o.facts));
        const b = j * 5;
        return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}::jsonb)`;
      });
      await client.query(
        `INSERT INTO census_community_area (city, city_region, csd_uid, das, facts) VALUES ${tuples.join(", ")}`,
        vals,
      );
    }
    await client.query("COMMIT");
    console.log(`written: ${out.length} rows`);
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
    console.error("failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
