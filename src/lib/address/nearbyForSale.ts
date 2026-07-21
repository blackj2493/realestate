/**
 * Nearby active listings for the address-profile page (ADDRESS_PROFILES_PLAN P1).
 *
 * IDX actives are the one fully anon-displayable content class (photos, prices,
 * brokerage — public by design), so this is the profile page's hero section. Native
 * Typesense geo-radius on the public `properties` collection — first use of the radius
 * syntax in the repo, smoke-tested live 2026-07-18 (Typesense returns
 * `geo_distance_meters` per hit when sorting by distance).
 *
 * Search-only key; runs in server components. Per-query cap far below the 100-listing
 * display limit (CLAUDE.md §4).
 */
import { getTypesenseClient } from "@/lib/typesense/client";

export interface NearbyListing {
  id: string;
  address: string;
  cityRegion: string | null;
  price: number;
  beds: number | null;
  baths: number | null;
  subType: string | null;
  imageUrl: string | null;
  /** Mandatory display (CLAUDE.md §4) — null renders the "Brokerage unavailable" fallback. */
  brokerage: string | null;
  distanceM: number | null;
}

/** Anonymous-safe market context computed from IDX ACTIVES only (asking prices +
 *  listing age of live inventory) — never sold/VOW data. */
export interface NearbyAskingStats {
  medianAsking: number | null;
  medianPsf: number | null;
  medianDaysListed: number | null;
}

/** Equal-width asking-price buckets over [min, max] (5th–95th percentile when n≥20,
 *  so one mansion doesn't flatten the histogram). */
export interface AskingHistogram {
  min: number;
  max: number;
  buckets: number[];
}

/** Per-property-type slice of the live inventory (count + median asking). */
export interface TypeSlice {
  label: string;
  count: number;
  medianAsking: number | null;
}

/** Momentum signals — ALL derived from the active IDX feed (campaign price cuts,
 *  listing age, entry date). Sold-side momentum stays behind the consumer gate. */
export interface MomentumStats {
  /** Actives whose campaign has at least one price cut. */
  cutCount: number;
  cutShare: number;
  medianCut: number | null;
  /** Listed within the last 7 days. */
  newThisWeek: number;
  /** Sitting 30+ days (this campaign's age — not stitched True DOM, which is gated). */
  sitting30: number;
}

export interface NearbyForSale {
  listings: NearbyListing[];
  totalFound: number;
  radiusKm: number;
  stats: NearbyAskingStats;
  histogram: AskingHistogram | null;
  /** Property-type breakdown of the fetched actives, largest first. */
  typeMix: TypeSlice[];
  momentum: MomentumStats;
}

const FIELDS =
  "id,UnparsedAddress,City,CityRegion,ListPrice,BedroomsTotal,BathroomsTotalInteger,PropertySubType,primaryImageUrl,ListOfficeName,BuildingAreaTotal,calculatedDOM,TotalPriceDrop,EntryTimestamp";

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export async function getNearbyForSale(
  lat: number,
  lng: number,
  opts: { radiusKm?: number; limit?: number; transactionType?: "sale" | "lease" } = {}
): Promise<NearbyForSale | null> {
  const radiusKm = opts.radiusKm ?? 2;
  const limit = Math.min(opts.limit ?? 12, 12);
  // Default is FOR SALE (the profile hero). Lease rents sit far below the sale floor, so the
  // $100k sanity floor would drop nearly every rental — use a small floor for lease instead.
  const isLease = opts.transactionType === "lease";
  const txnType = isLease ? "For Lease" : "For Sale";
  const priceFloor = isLease ? 500 : 100000;
  try {
    // Fetch up to the 100 nearest (display cap, CLAUDE.md §4): first `limit` become
    // carousel cards; asking-price stats are computed over the whole page.
    const res = await getTypesenseClient()
      .collections("properties")
      .documents()
      .search({
        q: "*",
        query_by: "City",
        // Exclude commercial so the "homes for sale/rent" rows are actually homes (mirrors the
        // city hubs' ACTIVE_FILTER — otherwise "Sale Of Business"/"Store-Office" bleed in).
        filter_by: `location:(${lat}, ${lng}, ${radiusKm} km) && TransactionType:=\`${txnType}\` && ListPrice:>=${priceFloor} && PropertyType:!=Commercial`,
        sort_by: `location(${lat}, ${lng}):asc`,
        include_fields: FIELDS,
        per_page: 100,
      });
    const docs = (res.hits ?? []).map((h) => ({
      d: h.document as Record<string, unknown>,
      dist: (h as { geo_distance_meters?: { location?: number } }).geo_distance_meters?.location,
    }));

    const listings: NearbyListing[] = docs.slice(0, limit).map(({ d, dist }) => ({
      id: String(d.id ?? ""),
      address: typeof d.UnparsedAddress === "string" ? d.UnparsedAddress.split(",")[0] : "",
      cityRegion: typeof d.CityRegion === "string" && d.CityRegion ? d.CityRegion : null,
      price: typeof d.ListPrice === "number" ? d.ListPrice : 0,
      beds: typeof d.BedroomsTotal === "number" && d.BedroomsTotal > 0 ? d.BedroomsTotal : null,
      baths: typeof d.BathroomsTotalInteger === "number" && d.BathroomsTotalInteger > 0 ? d.BathroomsTotalInteger : null,
      subType: typeof d.PropertySubType === "string" && d.PropertySubType ? d.PropertySubType : null,
      imageUrl: typeof d.primaryImageUrl === "string" && d.primaryImageUrl ? d.primaryImageUrl : null,
      brokerage: typeof d.ListOfficeName === "string" && d.ListOfficeName ? d.ListOfficeName : null,
      distanceM: typeof dist === "number" ? Math.round(dist) : null,
    }));

    // Asking stats over ALL fetched actives (IDX only): price always; $/sqft and
    // days-listed only from listings that carry the field.
    const prices: number[] = [];
    const psfs: number[] = [];
    const doms: number[] = [];
    const cuts: number[] = [];
    const typePrices = new Map<string, number[]>();
    let newThisWeek = 0;
    let sitting30 = 0;
    const weekAgoMs = Date.now() - 7 * 86_400_000;
    for (const { d } of docs) {
      const price = typeof d.ListPrice === "number" ? d.ListPrice : 0;
      if (price > 0) prices.push(price);
      const sqft = typeof d.BuildingAreaTotal === "number" ? d.BuildingAreaTotal : 0;
      if (price > 0 && sqft >= 200) psfs.push(price / sqft);
      const dom = typeof d.calculatedDOM === "number" ? d.calculatedDOM : -1;
      if (dom >= 0) doms.push(dom);
      if (dom >= 30) sitting30++;
      const drop = typeof d.TotalPriceDrop === "number" ? d.TotalPriceDrop : 0;
      if (drop > 0) cuts.push(drop);
      const entry = typeof d.EntryTimestamp === "number" ? d.EntryTimestamp : 0;
      // EntryTimestamp is epoch ms; tolerate a seconds-scale value defensively.
      const entryMs = entry > 1e12 ? entry : entry * 1000;
      if (entryMs >= weekAgoMs) newThisWeek++;
      const t = typeof d.PropertySubType === "string" ? d.PropertySubType.trim() : "";
      if (t) {
        const arr = typePrices.get(t) ?? [];
        if (price > 0) arr.push(price);
        else arr.push(0); // keep the count even when the price is unusable
        typePrices.set(t, arr);
      }
    }

    // Price histogram: 8 equal-width buckets, percentile-clipped against outliers.
    let histogram: AskingHistogram | null = null;
    if (prices.length >= 8) {
      const sorted = [...prices].sort((a, b) => a - b);
      const clip = sorted.length >= 20;
      const lo = clip ? sorted[Math.floor(sorted.length * 0.05)] : sorted[0];
      const hi = clip ? sorted[Math.ceil(sorted.length * 0.95) - 1] : sorted[sorted.length - 1];
      if (hi > lo) {
        const buckets = new Array(8).fill(0) as number[];
        for (const p of sorted) {
          if (p < lo || p > hi) continue;
          buckets[Math.min(7, Math.floor(((p - lo) / (hi - lo)) * 8))]++;
        }
        histogram = { min: lo, max: hi, buckets };
      }
    }

    return {
      listings: listings.filter((l) => l.id),
      totalFound: res.found ?? listings.length,
      radiusKm,
      stats: {
        medianAsking: median(prices),
        medianPsf: median(psfs),
        medianDaysListed: median(doms),
      },
      histogram,
      typeMix: [...typePrices.entries()]
        .map(([label, ps]) => ({
          label,
          count: ps.length,
          medianAsking: median(ps.filter((p) => p > 0)),
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5),
      momentum: {
        cutCount: cuts.length,
        cutShare: docs.length ? cuts.length / docs.length : 0,
        medianCut: median(cuts),
        newThisWeek,
        sitting30,
      },
    };
  } catch (err) {
    console.error("[nearbyForSale] search failed:", err);
    return null;
  }
}
