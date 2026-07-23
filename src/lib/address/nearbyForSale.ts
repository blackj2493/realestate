/**
 * Nearby active listings for the address-profile page (ADDRESS_PROFILES_PLAN P1).
 *
 * IDX actives are the one fully anon-displayable content class (photos, prices,
 * brokerage — public by design), so this is the profile page's hero section. Native
 * Typesense geo-radius on the public `properties` collection — first use of the radius
 * syntax in the repo, smoke-tested live 2026-07-18 (Typesense returns
 * `geo_distance_meters` per hit when sorting by distance).
 *
 * Home Pulse (2026-07-23) additions — still 100% asking-side/IDX:
 *  - per-listing coords + entry date + DOM + total price drop (radar pins, feed events)
 *  - per-type asking band (p25-p75) + the nearest live listing of each type
 *    (the "if it listed today" range + next-door anchor)
 *  - a merged NEW/CUT event list for the activity feed & ticker
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
  /** Coords for the street-radar pins (public IDX docs carry their geopoint). */
  lat: number | null;
  lng: number | null;
  /** Campaign entry as epoch ms; null when the doc lacks it. */
  entryMs: number | null;
  /** Days listed (this campaign — not stitched True DOM, which is gated). */
  dom: number | null;
  /** Total price cut this campaign ($); 0 = never cut. */
  dropAmount: number;
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

/** Per-property-type slice of the live inventory (count + asking band + nearest comp). */
export interface TypeSlice {
  label: string;
  count: number;
  medianAsking: number | null;
  /** 25th/75th-percentile asking — the "homes like this ask $X–$Y" band (n≥3 only). */
  p25: number | null;
  p75: number | null;
  /** Nearest live listing of this type — the "your next-door comp" anchor card. */
  nearest: NearbyListing | null;
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

/** One asking-side feed event. `new` = listed within the event window (dated by entry);
 *  `cut` = live listing with a price drop (cuts carry no event date in the feed doc, so
 *  the row shows "-$X · Nd on market" and sorts on campaign entry — conservative). */
export interface ActiveEvent {
  kind: "new" | "cut";
  listing: NearbyListing;
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
  /** NEW (≤30d) + CUT events for the activity feed/ticker, feed-ready order. */
  events: ActiveEvent[];
  /** All fetched actives with coords — the street-radar pin set (≤100 by construction). */
  pins: Array<{ lat: number; lng: number; cut: boolean }>;
}

const FIELDS =
  "id,UnparsedAddress,City,CityRegion,ListPrice,BedroomsTotal,BathroomsTotalInteger,PropertySubType,primaryImageUrl,ListOfficeName,BuildingAreaTotal,calculatedDOM,TotalPriceDrop,EntryTimestamp,location";

const NEW_EVENT_DAYS = 30;
const MAX_NEW_EVENTS = 8;
const MAX_CUT_EVENTS = 6;

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[idx];
}

function toListing(d: Record<string, unknown>, dist: number | undefined): NearbyListing {
  const loc = Array.isArray(d.location) && d.location.length === 2 ? (d.location as [number, number]) : null;
  const entry = typeof d.EntryTimestamp === "number" ? d.EntryTimestamp : 0;
  // EntryTimestamp is epoch ms; tolerate a seconds-scale value defensively.
  const entryMs = entry > 1e12 ? entry : entry > 0 ? entry * 1000 : null;
  const dom = typeof d.calculatedDOM === "number" && d.calculatedDOM >= 0 ? d.calculatedDOM : null;
  return {
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
    lat: loc ? loc[0] : null,
    lng: loc ? loc[1] : null,
    entryMs,
    dom,
    dropAmount: typeof d.TotalPriceDrop === "number" && d.TotalPriceDrop > 0 ? d.TotalPriceDrop : 0,
  };
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
    const all: NearbyListing[] = (res.hits ?? [])
      .map((h) =>
        toListing(
          h.document as Record<string, unknown>,
          (h as { geo_distance_meters?: { location?: number } }).geo_distance_meters?.location
        )
      )
      .filter((l) => l.id);

    const listings = all.slice(0, limit);

    // Asking stats over ALL fetched actives (IDX only): price always; $/sqft and
    // days-listed only from listings that carry the field.
    const prices: number[] = [];
    const psfs: number[] = [];
    const doms: number[] = [];
    const cuts: number[] = [];
    const byType = new Map<string, NearbyListing[]>();
    let newThisWeek = 0;
    let sitting30 = 0;
    const weekAgoMs = Date.now() - 7 * 86_400_000;
    for (const l of all) {
      if (l.price > 0) prices.push(l.price);
      if (l.dom !== null) doms.push(l.dom);
      if (l.dom !== null && l.dom >= 30) sitting30++;
      if (l.dropAmount > 0) cuts.push(l.dropAmount);
      if (l.entryMs !== null && l.entryMs >= weekAgoMs) newThisWeek++;
      if (l.subType) {
        const arr = byType.get(l.subType.trim()) ?? [];
        arr.push(l);
        byType.set(l.subType.trim(), arr);
      }
    }
    // $/sqft from the raw hits (BuildingAreaTotal isn't kept on NearbyListing).
    for (const h of res.hits ?? []) {
      const d = h.document as Record<string, unknown>;
      const price = typeof d.ListPrice === "number" ? d.ListPrice : 0;
      const sqft = typeof d.BuildingAreaTotal === "number" ? d.BuildingAreaTotal : 0;
      if (price > 0 && sqft >= 200) psfs.push(price / sqft);
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

    // Per-type slice: count + median + p25-p75 band + the nearest listing of that type
    // (docs arrive distance-sorted, so byType arrays are nearest-first already).
    const typeMix: TypeSlice[] = [...byType.entries()]
      .map(([label, ls]) => {
        const ps = ls.map((l) => l.price).filter((p) => p > 0).sort((a, b) => a - b);
        return {
          label,
          count: ls.length,
          medianAsking: median(ps),
          p25: ps.length >= 3 ? percentile(ps, 0.25) : null,
          p75: ps.length >= 3 ? percentile(ps, 0.75) : null,
          nearest: ls[0] ?? null,
        };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Feed events: NEW (entered ≤30d, newest first) then CUT (biggest cut first —
    // cuts have no event date on the doc, so they sort below the dated rows).
    const newCutoff = Date.now() - NEW_EVENT_DAYS * 86_400_000;
    const newEvents: ActiveEvent[] = all
      .filter((l) => l.entryMs !== null && l.entryMs >= newCutoff)
      .sort((a, b) => (b.entryMs ?? 0) - (a.entryMs ?? 0))
      .slice(0, MAX_NEW_EVENTS)
      .map((listing) => ({ kind: "new" as const, listing }));
    const newIds = new Set(newEvents.map((e) => e.listing.id));
    const cutEvents: ActiveEvent[] = all
      .filter((l) => l.dropAmount > 0 && !newIds.has(l.id))
      .sort((a, b) => b.dropAmount - a.dropAmount)
      .slice(0, MAX_CUT_EVENTS)
      .map((listing) => ({ kind: "cut" as const, listing }));

    return {
      listings,
      totalFound: res.found ?? listings.length,
      radiusKm,
      stats: {
        medianAsking: median(prices),
        medianPsf: median(psfs),
        medianDaysListed: median(doms),
      },
      histogram,
      typeMix,
      momentum: {
        cutCount: cuts.length,
        cutShare: all.length ? cuts.length / all.length : 0,
        medianCut: median(cuts),
        newThisWeek,
        sitting30,
      },
      events: [...newEvents, ...cutEvents],
      pins: all
        .filter((l) => l.lat !== null && l.lng !== null)
        .map((l) => ({ lat: l.lat as number, lng: l.lng as number, cut: l.dropAmount > 0 })),
    };
  } catch (err) {
    console.error("[nearbyForSale] search failed:", err);
    return null;
  }
}
