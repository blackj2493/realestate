/**
 * GET /api/dashboard/neighbourhood-heat?region=Brampton
 *
 * Per-community (CityRegion) medians for the dashboard's Neighbourhood Heat
 * leaderboard, computed over the region's FULL active inventory server-side —
 * replaces the old 100-listing browser sample that gave big-city communities
 * 1–3 listings each (ranked noise).
 *
 * Derived STATISTICS only (no listing rows) — the §6.3(b) display cap does not
 * apply (same rationale as /api/market/region-scores). All aggregated fields
 * (cap_rate_est, TrueDom, TotalPriceDrop) are already public in the browser
 * search index, so this exposes nothing new — it just aggregates more of it.
 *
 * Cached 1h per region via unstable_cache; inventory churns slowly enough that
 * a stale hour is invisible on a ranking of medians.
 */

import { NextRequest, NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { getTypesenseClient } from "@/lib/typesense/client";
import { locationFilter } from "@/lib/dashboard/queries";
import { capRateOrNull } from "@/lib/metrics/sanityBand";
import { aggregateCommunities, type HeatInput, type HeatStats } from "@/lib/dashboard/neighbourhoodHeat";

export const dynamic = "force-dynamic"; // per-region caching handled by unstable_cache

// Same region grammar as the market endpoints.
const REGION_RE = /^[\p{L}\p{N}\s\-'.]{1,60}$/u;

const PER_PAGE = 250;
// 12 pages = 3,000 actives — covers every watched city comfortably (Brampton ~2k);
// a Toronto-sized region gets a large honest sample, reported via `analyzed`.
const MAX_PAGES = 12;

const ACTIVE_FILTER = "TransactionType:=`For Sale` && PropertyType:!=Commercial";

async function computeHeat(region: string): Promise<HeatStats> {
  const client = getTypesenseClient();
  const items: HeatInput[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await client
      .collections("properties")
      .documents()
      .search({
        q: "*",
        query_by: "City",
        filter_by: `${locationFilter(region)} && ${ACTIVE_FILTER}`,
        include_fields: "CityRegion,cap_rate_est,TrueDom,TotalPriceDrop,location",
        per_page: PER_PAGE,
        page,
      });
    const hits = res.hits ?? [];
    for (const h of hits) {
      const d = h.document as {
        CityRegion?: string;
        cap_rate_est?: number;
        TrueDom?: number;
        TotalPriceDrop?: number;
        location?: [number, number];
      };
      const loc = Array.isArray(d.location) && d.location.length === 2 ? d.location : null;
      items.push({
        region: d.CityRegion,
        cap: capRateOrNull(d.cap_rate_est),
        dom: d.TrueDom,
        drop: d.TotalPriceDrop,
        lat: loc ? loc[0] : null,
        lng: loc ? loc[1] : null,
      });
    }
    if (hits.length < PER_PAGE) break;
  }
  return aggregateCommunities(items);
}

const getHeatCached = unstable_cache(computeHeat, ["dashboard-neighbourhood-heat"], {
  revalidate: 3600,
});

export async function GET(req: NextRequest) {
  const region = (new URL(req.url).searchParams.get("region") || "").trim();
  if (!region || !REGION_RE.test(region)) {
    return NextResponse.json({ error: "invalid region" }, { status: 400 });
  }
  try {
    const heat = await getHeatCached(region);
    return NextResponse.json({ heat });
  } catch (err) {
    console.error(`[neighbourhood-heat] failed for "${region}":`, err);
    return NextResponse.json({ error: "aggregation failed" }, { status: 500 });
  }
}
