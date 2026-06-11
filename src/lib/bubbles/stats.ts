/**
 * Compute live stats for one saved market bubble, server-side.
 *
 * Query path by area_type (per user's design clarification 2026-05-26):
 *   - draw / commute → Typesense polygon filter `location:(lat,lng,lat,lng,...)`
 *   - school         → `NearbySchools:=<schoolKey>` membership filter, NOT the
 *     synthesized circle polygon. The ETL precomputes NearbySchools at the
 *     existing 2.5 km radius (src/lib/schools/nearestSchools.ts NEARBY_RADIUS_KM),
 *     so this is an exact match — the same one the live SchoolFilter uses on
 *     /properties — rather than a polygon approximation.
 *
 * What we return — ACTIVE-side metrics only (sold-comp polygon queries require
 * adding `location` + `NearbySchools` to the `sold_listings` collection schema;
 * tracked as Phase 2B):
 *
 *   { activeCount, medianListPrice, minListPrice, maxListPrice,
 *     medianCapRate, capRateSample, staleCount, sampled }
 *
 * `sampled: true` when activeCount > MEDIAN_SAMPLE_CAP and the median is taken
 * from the middle row of a paginated re-query (one extra round trip), not the
 * 250-row sample. The min/max are always exact (Typesense :asc / :desc sort).
 *
 * §4 compliance: all aggregation is deterministic JS math on Typesense scalars,
 * no LLM. §6.3(b): no listing rows are returned to the client — only scalars.
 */

import Typesense, { Client } from "typesense";
import type { Bubble } from "./serialize";
import { CAP_RATE_BAND } from "@/lib/metrics/sanityBand";

const TYPESENSE_HOST = "9uyapwh6e5qmvl34p-1.a1.typesense.net";
const TYPESENSE_PORT = 443;
const PROPERTIES_COLLECTION = "properties";

/** Excludes rental noise that occasionally leaks into the active feed. */
const SALES_FLOOR = "ListPrice:>=100000";
/** Max rows pulled in the count+sample search; above this we re-query for the median. */
const MEDIAN_SAMPLE_CAP = 250;

let adminClient: Client | null = null;

/**
 * Server-only Typesense client (admin key). Used for stats so we can read the
 * full document count even on RAM-limited collections; mirrors the sold-route
 * pattern. Must never run in the browser.
 */
function getAdminClient(): Client {
  if (!adminClient) {
    const key = process.env.TYPESENSE_ADMIN_API_KEY;
    if (!key) throw new Error("TYPESENSE_ADMIN_API_KEY is not set");
    adminClient = new Typesense.Client({
      nodes: [{ host: TYPESENSE_HOST, port: TYPESENSE_PORT, protocol: "https" }],
      apiKey: key,
      connectionTimeoutSeconds: 10,
    });
  }
  return adminClient;
}

export interface BubbleStats {
  activeCount: number;
  medianListPrice: number | null;
  minListPrice: number | null;
  maxListPrice: number | null;
  medianCapRate: number | null;
  capRateSample: number;
  staleCount: number;
  /** True when activeCount > MEDIAN_SAMPLE_CAP — medians come from a paginated probe. */
  sampled: boolean;
}

const EMPTY: BubbleStats = {
  activeCount: 0,
  medianListPrice: null,
  minListPrice: null,
  maxListPrice: null,
  medianCapRate: null,
  capRateSample: 0,
  staleCount: 0,
  sampled: false,
};

/**
 * Build the area-scoping clause for the Typesense `properties` collection.
 * Returns the string fragment that scopes documents to the bubble's area;
 * the caller AND-joins it with SALES_FLOOR and any persona/saved-filter clauses.
 * Exported for the nightly alerts worker (scripts/worker/alerts.ts), which
 * scopes its new-listing search with the exact same clause.
 */
export function buildAreaClause(
  bubble: Pick<Bubble, "area_type" | "polygon" | "source">
): string | null {
  if (bubble.area_type === "school" && bubble.source.kind === "school") {
    // Backticks because school ids contain hyphens/colons.
    return `NearbySchools:=\`${bubble.source.schoolKey}\``;
  }
  // draw / commute — polygon ring in [lat, lng] order, flattened.
  if (!bubble.polygon || bubble.polygon.length < 3) return null;
  const coords = bubble.polygon.map(([lat, lng]) => `${lat}, ${lng}`).join(", ");
  return `location:(${coords})`;
}

/** Median of a numeric array, ignoring nulls. Returns null when empty. */
function medianOf(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/** Sample-aware median for the active set's ListPrice. */
async function computeMedianListPrice(
  client: Client,
  filterBy: string,
  total: number,
  sampleAsc: Array<{ ListPrice?: number }>
): Promise<{ median: number | null; sampled: boolean }> {
  if (total === 0) return { median: null, sampled: false };

  if (total <= MEDIAN_SAMPLE_CAP) {
    const prices = sampleAsc
      .map((d) => Number(d.ListPrice))
      .filter((n) => Number.isFinite(n) && n > 0);
    return { median: medianOf(prices), sampled: false };
  }

  // Paginated probe: fetch the row at position ceil(total/2) under :asc sort.
  // That row's ListPrice is the median (or upper-of-two-middle for even counts —
  // close enough for a dashboard headline number).
  const midPage = Math.max(1, Math.ceil(total / 2));
  const probe = await client.collections(PROPERTIES_COLLECTION).documents().search({
    q: "*",
    query_by: "City",
    filter_by: filterBy,
    sort_by: "ListPrice:asc",
    per_page: 1,
    page: midPage,
    include_fields: "ListPrice",
  });
  const doc = probe.hits?.[0]?.document as { ListPrice?: number } | undefined;
  const median = doc?.ListPrice && doc.ListPrice > 0 ? doc.ListPrice : null;
  return { median, sampled: true };
}

/**
 * Compute the bubble's live active-side stats. Two Typesense searches in
 * parallel (sample-asc + stale-count facet); a third only when activeCount
 * exceeds the sample cap and the median needs a paginated probe.
 *
 * NOTE: bubble.filters (persona/beds/price snapshot) is NOT applied here yet.
 * Phase 2 ships with area-only stats so a card always shows the area's true
 * inventory size; we can layer the saved filters back on once we surface a
 * "view filtered stats" toggle on the card.
 */
export async function computeBubbleStats(bubble: Bubble): Promise<BubbleStats> {
  const areaClause = buildAreaClause(bubble);
  if (!areaClause) return EMPTY;

  const baseFilter = `${SALES_FLOOR} && ${areaClause}`;
  const client = getAdminClient();

  // Parallel: (1) count + sample sorted asc for median/min, (2) sample sorted
  // desc for max + cap-rate distribution, (3) stale subset count.
  const [ascRes, descRes, staleRes] = await Promise.all([
    client.collections(PROPERTIES_COLLECTION).documents().search({
      q: "*",
      query_by: "City",
      filter_by: baseFilter,
      sort_by: "ListPrice:asc",
      per_page: MEDIAN_SAMPLE_CAP,
      include_fields: "ListPrice,cap_rate_est",
    }),
    client.collections(PROPERTIES_COLLECTION).documents().search({
      q: "*",
      query_by: "City",
      filter_by: baseFilter,
      sort_by: "ListPrice:desc",
      per_page: 1,
      include_fields: "ListPrice",
    }),
    client.collections(PROPERTIES_COLLECTION).documents().search({
      q: "*",
      query_by: "City",
      filter_by: `${baseFilter} && IsStale:=true`,
      per_page: 0, // headcount only — we just want `found`
    }),
  ]);

  const activeCount = ascRes.found ?? 0;
  if (activeCount === 0) return EMPTY;

  const ascDocs = (ascRes.hits ?? []).map(
    (h) => h.document as { ListPrice?: number; cap_rate_est?: number }
  );

  const ascPrices = ascDocs
    .map((d) => Number(d.ListPrice))
    .filter((n) => Number.isFinite(n) && n > 0);

  const minListPrice = ascPrices[0] ?? null;
  const maxListPrice = (() => {
    const top = descRes.hits?.[0]?.document as { ListPrice?: number } | undefined;
    return top?.ListPrice && top.ListPrice > 0 ? top.ListPrice : null;
  })();

  const { median: medianListPrice, sampled } = await computeMedianListPrice(
    client,
    baseFilter,
    activeCount,
    ascDocs
  );

  // Cap rate: the sample (≤250) is the best we can do without indexing
  // cap_rate_est as sortable too. Good enough for a headline — the
  // sample is large enough to be representative for typical bubble sizes.
  const capRates = ascDocs
    .map((d) => Number(d.cap_rate_est))
    .filter((n) => Number.isFinite(n) && n >= CAP_RATE_BAND.min && n <= CAP_RATE_BAND.max);

  return {
    activeCount,
    medianListPrice,
    minListPrice,
    maxListPrice,
    medianCapRate: medianOf(capRates),
    capRateSample: capRates.length,
    staleCount: staleRes.found ?? 0,
    sampled,
  };
}
