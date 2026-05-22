/**
 * Read-only probe of the live Typesense `properties` collection to inspect the
 * stored `location` order and demonstrate how AlphaMap's validity gate behaves
 * before vs. after the reindex.
 *
 * Run: npx tsx scripts/probe-typesense-geo.ts
 */
import "dotenv/config";
import { getTypesenseClient } from "../src/lib/typesense/client";
import { isValidLocation, toDeckPosition } from "../src/components/Map/mapLogic";

async function main() {
  const client = getTypesenseClient();
  let res: any;
  try {
    res = await client
      .collections("properties")
      .documents()
      .search({
        q: "*",
        query_by: "City",
        per_page: 8,
        include_fields: "id,City,ListPrice,location",
        filter_by: "ListPrice:>=100000",
      });
  } catch (err) {
    console.error("[probe] Typesense query failed (network blocked or schema change?):", (err as Error).message);
    console.error("[probe] Skipping live probe — logic tests above remain authoritative.");
    process.exit(0);
  }

  const hits = (res.hits || []).map((h: any) => h.document);
  console.log(`\n[probe] fetched ${hits.length} of ${res.found} matching docs\n`);

  let asStoredValid = 0;
  let asFlippedValid = 0;

  for (const d of hits) {
    const loc = d.location as [number, number] | undefined;
    const storedOk = isValidLocation(loc);
    const flippedOk = loc ? isValidLocation([loc[1], loc[0]]) : false;
    if (storedOk) asStoredValid++;
    if (flippedOk) asFlippedValid++;
    console.log(
      `${(d.id || "?").padEnd(12)} ${(d.City || "?").padEnd(16)} ` +
        `loc=${JSON.stringify(loc)}  validAsStored=${storedOk}  validIfFlipped=${flippedOk}` +
        (storedOk ? `  deckPos=${JSON.stringify(toDeckPosition(loc!))}` : "")
    );
  }

  console.log(
    `\n[probe] valid as-stored: ${asStoredValid}/${hits.length}   valid if flipped: ${asFlippedValid}/${hits.length}`
  );
  console.log("\n[probe] interpretation:");
  if (asStoredValid === 0 && asFlippedValid > 0) {
    console.log("  → Live data is still [lng, lat]. The new AlphaMap reads [lat, lng], so it");
    console.log("    REJECTS every current doc → map shows the empty state until the reindex.");
    console.log("    This is the expected pre-reindex state (safe: empty, not mislocated).");
  } else if (asStoredValid > 0 && asFlippedValid === 0) {
    console.log("  → Live data is already [lat, lng]. AlphaMap will render pins correctly NOW.");
  } else if (asStoredValid > 0 && asFlippedValid > 0) {
    console.log("  → Ambiguous: some docs pass both orders (near-diagonal coords). Inspect manually.");
  } else {
    console.log("  → No docs passed either order — unexpected; inspect the raw location values above.");
  }
}

main();
