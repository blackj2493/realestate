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
}

/** Build the route query string. Empty string = no area resolvable (caller shows empty state). */
export function buildSoldQuery({ mapBounds, location, windowDays, limit }: SoldQueryArgs): string {
  const p = new URLSearchParams();
  if (mapBounds) {
    const { north: N, south: S, east: E, west: W } = mapBounds;
    p.set("polygon", `${S},${W},${S},${E},${N},${E},${N},${W}`);
  } else if (location.trim()) {
    p.set("region", location.trim());
  } else {
    return "";
  }
  p.set("windowDays", String(clampWindowDays(windowDays)));
  p.set("limit", String(limit));
  return p.toString();
}

export interface SoldCompsResult {
  docs: ListingDocument[];
  count: number;
  locked: boolean;
}

export async function fetchSoldComps(args: SoldQueryArgs): Promise<SoldCompsResult> {
  const qs = buildSoldQuery(args);
  if (!qs) return { docs: [], count: 0, locked: false };
  const res = await fetch(`/api/market/activity/sold?${qs}`);
  if (!res.ok) throw new Error(`sold fetch failed: ${res.status}`);
  const data = (await res.json()) as { count?: number; listings?: SoldListing[]; locked?: boolean };
  return {
    docs: (data.listings ?? []).map(soldToListingDocument),
    count: data.count ?? 0,
    locked: !!data.locked,
  };
}
