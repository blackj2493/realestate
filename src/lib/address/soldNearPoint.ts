/**
 * Recently-sold context around a point — for the address-profile Home Pulse page.
 *
 * SERVER-ONLY: reads the `sold_listings` Typesense collection with the ADMIN key
 * (VOW data; the public browser key must never read it — see soldListingsSchema.ts).
 *
 * THE GATE IS STRUCTURAL, mirroring soldByKey.ts / the market-activity route:
 *  - getSoldNearSummary() is the ONLY function the anonymous path may call. It returns
 *    aggregate teasers — counts and bare coordinate points (rounded to ~110 m, postal-
 *    centroid-derived to begin with). No address, price, date, or media is fetched:
 *    `include_fields` restricts the response to `location`, so VOW Listing Information
 *    never even leaves Typesense for anon. (Counts are the established anon teaser —
 *    VowGateOverlay; the market-activity route withholds even addresses from anon, and
 *    so do we.)
 *  - getSoldNearGated() returns full rows + stats and must be called ONLY after
 *    getConsumer() confirms a registered consumer (the caller's branch, like page.tsx).
 */
import Typesense, { Client } from "typesense";
import { SOLD_LISTINGS_COLLECTION } from "@/lib/typesense/soldListingsSchema";

const TYPESENSE_HOST = "9uyapwh6e5qmvl34p-1.a1.typesense.net";
const TYPESENSE_PORT = 443;

let soldClient: Client | null = null;

/** Server-only Typesense client (admin key) — throws in the browser (no admin key there). */
function getSoldClient(): Client {
  if (!soldClient) {
    const key = process.env.TYPESENSE_ADMIN_API_KEY;
    if (!key) throw new Error("TYPESENSE_ADMIN_API_KEY is not set");
    soldClient = new Typesense.Client({
      nodes: [{ host: TYPESENSE_HOST, port: TYPESENSE_PORT, protocol: "https" }],
      apiKey: key,
      connectionTimeoutSeconds: 10,
    });
  }
  return soldClient;
}

const RADIUS_KM = 2;
const FEED_WINDOW_DAYS = 30;
const STATS_WINDOW_DAYS = 90;
const MAX_FEED_EVENTS = 6;
const MAX_ANON_POINTS = 20;

/** Anonymous-safe: counts + bare map points. NO address/price/date/media. */
export interface SoldNearSummary {
  /** Sales within the feed window (30d). */
  count30: number;
  /** Sales within the stats window (90d). */
  count90: number;
  /** [lat, lng] rounded to 3 decimals (~110 m) — radar dots only, no identity. */
  points: Array<[number, number]>;
}

/** CONSUMER-ONLY sold row (VOW Listing Information). */
export interface SoldNearEvent {
  id: string;
  address: string;
  closePrice: number;
  /** Sold-firm date as epoch ms (UTC-midnight date-only value — render with timeZone:'UTC'). */
  soldDateMs: number;
  subType: string | null;
  beds: number | null;
  baths: number | null;
  /** Mandatory display with listing details (TRREB §6.3(c)). */
  brokerage: string | null;
  imageUrl: string | null;
  lat: number | null;
  lng: number | null;
}

/** CONSUMER-ONLY aggregate + rows. */
export interface SoldNearGated {
  events: SoldNearEvent[];
  count30: number;
  count90: number;
  medianClose90: number | null;
  /** Median close/list ratio over 90d, as a percent (e.g. 99.1). */
  closeToAskPct90: number | null;
}

function windowFilter(lat: number, lng: number, days: number): string {
  const cutoff = Date.now() - days * 86_400_000;
  return `location:(${lat}, ${lng}, ${RADIUS_KM} km) && DealType:=sold && ClosePrice:>=1 && PurchaseContractDate:>=${cutoff}`;
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Anonymous path. Fetches `location` ONLY — VOW fields never leave Typesense here. */
export async function getSoldNearSummary(lat: number, lng: number): Promise<SoldNearSummary | null> {
  try {
    const docs = getSoldClient().collections(SOLD_LISTINGS_COLLECTION).documents();
    const [w30, w90] = await Promise.all([
      docs.search({
        q: "*",
        query_by: "UnparsedAddress", // required syntactically; ignored for q:"*"
        filter_by: windowFilter(lat, lng, FEED_WINDOW_DAYS),
        include_fields: "location",
        per_page: MAX_ANON_POINTS,
      }),
      docs.search({
        q: "*",
        query_by: "UnparsedAddress",
        filter_by: windowFilter(lat, lng, STATS_WINDOW_DAYS),
        include_fields: "location",
        per_page: 1,
      }),
    ]);
    const points: Array<[number, number]> = [];
    for (const h of w30.hits ?? []) {
      const loc = (h.document as { location?: [number, number] }).location;
      if (Array.isArray(loc) && loc.length === 2) {
        // ~110 m grid — coarse enough that a dot is a neighbourhood signal, not a rooftop.
        points.push([Math.round(loc[0] * 1000) / 1000, Math.round(loc[1] * 1000) / 1000]);
      }
    }
    return { count30: w30.found ?? 0, count90: w90.found ?? 0, points };
  } catch (err) {
    console.error("[soldNearPoint] summary failed:", err);
    return null;
  }
}

/** Consumer path — call ONLY inside a getConsumer()-confirmed branch. */
export async function getSoldNearGated(lat: number, lng: number): Promise<SoldNearGated | null> {
  try {
    const res = await getSoldClient()
      .collections(SOLD_LISTINGS_COLLECTION)
      .documents()
      .search({
        q: "*",
        query_by: "UnparsedAddress",
        filter_by: windowFilter(lat, lng, STATS_WINDOW_DAYS),
        sort_by: "PurchaseContractDate:desc",
        include_fields:
          "id,UnparsedAddress,ClosePrice,ListPrice,PurchaseContractDate,PropertySubType,BedroomsTotal,BathroomsTotalInteger,ListOfficeName,primaryImageUrl,location",
        per_page: 100, // TRREB §6.3(b) display cap; stats use the same page
      });

    const closes: number[] = [];
    const ratios: number[] = [];
    const events: SoldNearEvent[] = [];
    const feedCutoff = Date.now() - FEED_WINDOW_DAYS * 86_400_000;
    let count30 = 0;

    for (const h of res.hits ?? []) {
      const d = h.document as Record<string, unknown>;
      const close = typeof d.ClosePrice === "number" ? d.ClosePrice : 0;
      const list = typeof d.ListPrice === "number" ? d.ListPrice : 0;
      const dateMs = typeof d.PurchaseContractDate === "number" ? d.PurchaseContractDate : 0;
      if (close > 0) closes.push(close);
      if (close > 0 && list > 0) {
        const r = close / list;
        if (r > 0.5 && r < 2) ratios.push(r); // guard mis-keyed rows
      }
      if (dateMs >= feedCutoff) {
        count30++;
        if (events.length < MAX_FEED_EVENTS) {
          const loc = Array.isArray(d.location) && d.location.length === 2 ? (d.location as [number, number]) : null;
          events.push({
            id: String(d.id ?? ""),
            address: typeof d.UnparsedAddress === "string" ? d.UnparsedAddress.split(",")[0] : "",
            closePrice: close,
            soldDateMs: dateMs,
            subType: typeof d.PropertySubType === "string" && d.PropertySubType ? d.PropertySubType : null,
            beds: typeof d.BedroomsTotal === "number" && d.BedroomsTotal > 0 ? d.BedroomsTotal : null,
            baths:
              typeof d.BathroomsTotalInteger === "number" && d.BathroomsTotalInteger > 0
                ? d.BathroomsTotalInteger
                : null,
            brokerage: typeof d.ListOfficeName === "string" && d.ListOfficeName ? d.ListOfficeName : null,
            imageUrl: typeof d.primaryImageUrl === "string" && d.primaryImageUrl ? d.primaryImageUrl : null,
            lat: loc ? loc[0] : null,
            lng: loc ? loc[1] : null,
          });
        }
      }
    }

    const ratioMed = median(ratios);
    return {
      events: events.filter((e) => e.id && e.closePrice > 0),
      count30,
      count90: res.found ?? closes.length,
      medianClose90: median(closes),
      closeToAskPct90: ratioMed !== null ? Math.round(ratioMed * 1000) / 10 : null,
    };
  } catch (err) {
    console.error("[soldNearPoint] gated failed:", err);
    return null;
  }
}

/**
 * AREA RESOLUTION (server-only). Returns the CityRegion of the nearest SOLD
 * records to a point, nearest-first — for pinning an address to its MLS community
 * using DENSE per-house sold data (far denser than live inventory, so it resolves
 * boundaries reliably). Restricted to `CityRegion,location`: no price/address/date
 * leaves Typesense, and a community NAME is public taxonomy, not VOW Listing
 * Information. Not gated — it discloses nothing about any individual sale.
 */
export async function getSoldAreaVotes(
  lat: number,
  lng: number,
  radiusKm = 1.5,
  limit = 20,
): Promise<string[]> {
  try {
    const res = await getSoldClient()
      .collections(SOLD_LISTINGS_COLLECTION)
      .documents()
      .search({
        q: "*",
        query_by: "UnparsedAddress", // syntactic; ignored for q:"*"
        filter_by: `location:(${lat}, ${lng}, ${radiusKm} km) && DealType:=sold`,
        sort_by: `location(${lat}, ${lng}):asc`,
        include_fields: "CityRegion,location",
        per_page: limit,
      });
    const out: string[] = [];
    for (const h of res.hits ?? []) {
      const cr = (h.document as { CityRegion?: string }).CityRegion;
      if (cr) out.push(cr);
    }
    return out;
  } catch (err) {
    console.error("[soldNearPoint] area votes failed:", err);
    return [];
  }
}
