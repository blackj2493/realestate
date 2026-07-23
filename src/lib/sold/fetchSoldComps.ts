/**
 * Client-side fetch of gated sold comps for the terminal. Builds the query for the
 * server-only /api/market/activity/sold route (viewport → polygon, else region), then
 * adapts the rows to ListingDocument for the shared map + ledger renderers. The route
 * applies the VOW gate: anonymous callers get { count, listings: [], locked: true }.
 */
import type { MapBounds } from "@/lib/stores/commandCenterStore";
import type { ListingDocument } from "@/lib/typesense/client";
import type { SoldListing } from "@/app/api/market/activity/sold/soldMapper";
import { soldToListingDocument } from "./adapter";
import { clampWindowDays } from "./config";

export interface SoldQueryArgs {
  mapBounds: MapBounds | null;
  location: string;
  windowDays: number;
  limit: number;
  dealType: "sold" | "leased" | "delisted";
  /** Basic property filters to constrain comp results. Price/beds/baths/types only —
   *  no persona/investor metrics (comps have no forward metrics). Price maps to
   *  ClosePrice (Sold/Leased) or ListPrice (De-listed) server-side. */
  filters?: {
    minPrice?: number;
    maxPrice?: number;
    minBeds?: number;
    /** Exact-count mode for beds (matches the For Sale Min/Exact toggle). */
    bedsExact?: boolean;
    minBaths?: number;
    bathsExact?: boolean;
    /** Dashboard type keys (e.g. "detached", "semi") for variantsForKeys expansion
     *  in the sold route. Raw PropertySubType spellings are NOT accepted here. */
    types?: string[];
  };
}

/** ~Zoom-14 viewport box around a point (±~2 km at Ontario latitudes) — the
 *  first-query fallback when the camera hasn't reported bounds yet (fly-to still
 *  in transit), so comps never depend on camera timing. */
export function boundsAroundPoint(lat: number, lng: number): MapBounds {
  return { north: lat + 0.02, south: lat - 0.02, east: lng + 0.03, west: lng - 0.03 };
}

/** Build the route query string. Empty string = no area resolvable (caller shows empty state). */
export function buildSoldQuery({ mapBounds, location, windowDays, limit, dealType, filters }: SoldQueryArgs): string {
  const p = new URLSearchParams();
  if (mapBounds) {
    const { north: N, south: S, east: E, west: W } = mapBounds;
    p.set("polygon", `${S},${W},${S},${E},${N},${E},${N},${W}`);
  } else if (location.trim()) {
    p.set("region", location.trim());
  } else {
    return "";
  }
  p.set("windowDays", String(clampWindowDays(windowDays, dealType)));
  p.set("limit", String(limit));
  p.set("dealType", dealType);
  if (filters?.minPrice) p.set("minPrice", String(filters.minPrice));
  if (filters?.maxPrice) p.set("maxPrice", String(filters.maxPrice));
  if (filters?.minBeds) p.set("minBeds", String(filters.minBeds));
  if (filters?.bedsExact) p.set("bedsExact", "1");
  if (filters?.minBaths) p.set("minBaths", String(filters.minBaths));
  if (filters?.bathsExact) p.set("bathsExact", "1");
  if (filters?.types?.length) p.set("types", filters.types.join(","));
  return p.toString();
}

export interface SoldCompsResult {
  docs: ListingDocument[];
  count: number;
  locked: boolean;
}

export async function fetchSoldComps(
  args: Omit<SoldQueryArgs, "dealType"> & { kinds?: Array<"sold" | "leased" | "delisted"> }
): Promise<SoldCompsResult> {
  const kinds = args.kinds ?? ["sold"]; // default keeps existing callers working
  const results = await Promise.all(
    kinds.map(async (dealType) => {
      const qs = buildSoldQuery({ ...args, dealType, filters: args.filters });
      if (!qs) return { docs: [] as ListingDocument[], count: 0, locked: false };
      const res = await fetch(`/api/market/activity/sold?${qs}`);
      if (!res.ok) throw new Error(`sold fetch failed: ${res.status}`);
      const data = (await res.json()) as { count?: number; listings?: SoldListing[]; locked?: boolean };
      return { docs: (data.listings ?? []).map(soldToListingDocument), count: data.count ?? 0, locked: !!data.locked };
    })
  );
  return {
    docs: results.flatMap((r) => r.docs),
    count: results.reduce((n, r) => n + r.count, 0),
    locked: results.some((r) => r.locked),
  };
}
