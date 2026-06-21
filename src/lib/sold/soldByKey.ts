/**
 * Single sold/off-market record fetch by listing key — for the public /address page.
 *
 * SERVER-ONLY. The `sold_listings` collection is VOW data; the public browser key must
 * NOT read it (see soldListingsSchema.ts + the /api/market/activity/sold route). This
 * module uses the Typesense ADMIN key and must only be imported from server components /
 * route handlers — never a client bundle.
 *
 * THE GATE IS STRUCTURAL: getSoldPublicByKey() passes Typesense `include_fields` so the
 * collection returns ONLY the address + geo — close price, sold date, beds/baths, photos
 * and brokerage never even leave Typesense for the anonymous path. The VOW fields are
 * fetched ONLY by getSoldGatedByKey(), which the page calls solely after getConsumer()
 * confirms a registered consumer.
 */
import Typesense, { Client } from "typesense";
import { SOLD_LISTINGS_COLLECTION, type SoldListingDocument } from "@/lib/typesense/soldListingsSchema";

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

/** PUBLIC-safe sold record: address + geo ONLY (no VOW listing information). */
export interface SoldPublic {
  id: string;
  address: string;
  city: string;
  cityRegion: string;
  /** [lat, lng] — used server-side for schools/walkability; never rendered as raw coords. */
  location: [number, number] | null;
}

// The ONLY fields the anonymous path retrieves. Anything not listed here cannot reach the
// public render because Typesense doesn't return it.
const PUBLIC_FIELDS = "id,UnparsedAddress,City,CityRegion,location";

/**
 * Address + geo for a sold/off-market listing key, or null if there's no such sold record
 * (e.g. the key is an active listing, or unknown). VOW fields are not requested.
 */
export async function getSoldPublicByKey(key: string): Promise<SoldPublic | null> {
  try {
    const res = await getSoldClient()
      .collections(SOLD_LISTINGS_COLLECTION)
      .documents()
      .search({
        q: "*",
        query_by: "UnparsedAddress", // required syntactically; ignored for q:"*"
        filter_by: `id:=${key}`,
        include_fields: PUBLIC_FIELDS,
        per_page: 1,
      });
    const d = res.hits?.[0]?.document as Partial<SoldListingDocument> | undefined;
    if (!d?.id) return null;
    const loc =
      Array.isArray(d.location) && d.location.length === 2 && Number.isFinite(d.location[0]) && Number.isFinite(d.location[1])
        ? ([d.location[0], d.location[1]] as [number, number])
        : null;
    return {
      id: d.id,
      address: d.UnparsedAddress ?? "",
      city: d.City ?? "",
      cityRegion: d.CityRegion ?? "",
      location: loc,
    };
  } catch (err) {
    console.error(`[soldByKey] public fetch failed for "${key}":`, err);
    return null;
  }
}

/** One sold/off-market record reduced to the PUBLIC fields needed to build an /address URL. */
export interface SoldSitemapEntry {
  id: string;
  city: string;
  address: string;
}

/**
 * PUBLIC-safe export of the sold_listings collection (the rolling ~180-day window) for the
 * /sitemap-addresses.xml route. include_fields pulls ONLY id/City/UnparsedAddress — no VOW
 * fields (not even the sold date) are fetched, so nothing sensitive enters sitemap
 * generation. Capped at `max`. Best-effort ([] on failure).
 */
export async function getSoldSitemapEntries(max: number): Promise<SoldSitemapEntry[]> {
  try {
    const raw = (await getSoldClient()
      .collections(SOLD_LISTINGS_COLLECTION)
      .documents()
      .export({ include_fields: "id,UnparsedAddress,City" })) as string;
    const out: SoldSitemapEntry[] = [];
    for (const line of raw.split("\n")) {
      if (out.length >= max) break;
      if (!line.trim()) continue;
      try {
        const d = JSON.parse(line) as Partial<SoldListingDocument>;
        if (d.id) out.push({ id: d.id, city: d.City ?? "", address: d.UnparsedAddress ?? "" });
      } catch {
        /* skip malformed line */
      }
    }
    return out;
  } catch (err) {
    console.error("[soldByKey] sitemap export failed:", err);
    return [];
  }
}

/**
 * FULL sold record (VOW Listing Information). Call ONLY after getConsumer() confirms a
 * registered consumer — never on the anonymous path.
 */
export async function getSoldGatedByKey(key: string): Promise<SoldListingDocument | null> {
  try {
    const res = await getSoldClient()
      .collections(SOLD_LISTINGS_COLLECTION)
      .documents()
      .search({
        q: "*",
        query_by: "UnparsedAddress",
        filter_by: `id:=${key}`,
        per_page: 1,
      });
    return (res.hits?.[0]?.document as SoldListingDocument | undefined) ?? null;
  } catch (err) {
    console.error(`[soldByKey] gated fetch failed for "${key}":`, err);
    return null;
  }
}
