import "dotenv/config";
import { getTypesenseClient } from "../../src/lib/typesense/client";

(async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r: any = await getTypesenseClient()
    .collections("properties")
    .documents()
    .search({
      q: "*",
      query_by: "City",
      filter_by: "ListPrice:>=100000",
      facet_by: "PropertySubType",
      max_facet_values: 50,
      per_page: 1,
    });
  const counts = r.facet_counts?.[0]?.counts ?? [];
  for (const c of counts) console.log(`${String(c.count).padStart(6)}  ${JSON.stringify(c.value)}`);
})();
