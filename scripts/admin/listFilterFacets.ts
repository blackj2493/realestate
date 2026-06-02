import "dotenv/config";
import { getTypesenseClient } from "../../src/lib/typesense/client";

// Candidate categorical fields for the "+ Add filter" palette. Facet each one
// individually so a non-faceted field doesn't abort the whole dump.
const FIELDS = [
  "BasementType",
  "ApproximateAge",
  "Status",
  "SuiteStatus",
  "multi_unit_status",
  "OccupantType",
  "PossessionType",
];

(async () => {
  const client = getTypesenseClient();
  for (const field of FIELDS) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r: any = await client.collections("properties").documents().search({
        q: "*",
        query_by: "City",
        filter_by: "ListPrice:>=100000",
        facet_by: field,
        max_facet_values: 30,
        per_page: 1,
      });
      const counts = r.facet_counts?.[0]?.counts ?? [];
      console.log(`\n=== ${field} (${counts.length} values) ===`);
      for (const c of counts) console.log(`${String(c.count).padStart(6)}  ${JSON.stringify(c.value)}`);
    } catch (e) {
      console.log(`\n=== ${field} — NOT FACETABLE / error ===`);
      console.log(`  ${e instanceof Error ? e.message : String(e)}`);
    }
  }
})();
