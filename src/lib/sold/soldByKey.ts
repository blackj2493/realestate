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
import { getServiceRoleClient } from "@/lib/supabase/client";
import { parseAddress, addressesMatch, type ParsedAddress } from "@/lib/watchlist/disposition";

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
  /**
   * Whether this record has at least one listing photo — an EXISTENCE bit only, derived
   * server-side from primaryImageUrl. Lets the anon render decide whether to show a locked
   * "photos — sign up" teaser (never a false promise) WITHOUT ever carrying a photo URL to
   * the client. The URL itself is a VOW field and is discarded server-side (see below).
   */
  hasPhoto: boolean;
  /**
   * Transaction status KIND (not the price/date) — the one public signal on the sold record.
   * Maps DealType: sold→'sold', leased→'leased', terminated/expired/suspended→'offmarket'
   * (missing DealType = legacy sold doc → 'sold', mirroring getSoldGatedByKey's isSold).
   * Powers the SOLD / LEASED / OFF-MARKET badge, shown to anon AND consumers so both routes
   * treat the status kind the same way /properties already does (audit R24a). No price/date.
   */
  dealKind: "sold" | "leased" | "offmarket";
}

// The ONLY fields the anonymous path retrieves. Anything not listed here cannot reach the
// public render because Typesense doesn't return it.
const PUBLIC_FIELDS = "id,UnparsedAddress,City,CityRegion,location";

// Extra fields fetched ONLY to derive the public status KIND + photo-existence bit; neither
// the primaryImageUrl nor any price/date is returned. Appended to PUBLIC_FIELDS by the two
// SoldPublic fetchers so they stay in lock-step.
const PUBLIC_STATUS_FIELDS = `${PUBLIC_FIELDS},primaryImageUrl,DealType`;

/**
 * Public status KIND from the raw DealType — no price/date. Missing DealType = legacy sold
 * doc → 'sold' (mirrors getSoldGatedByKey's isSold rule); de-listed rows always carry
 * terminated/expired/suspended → collapse to 'offmarket' (the de-list REASON stays gated,
 * exactly as /properties nulls mlsStatus for anon).
 */
function deriveDealKind(dealType?: string): SoldPublic["dealKind"] {
  return !dealType || dealType === "sold" ? "sold" : dealType === "leased" ? "leased" : "offmarket";
}

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
        // primaryImageUrl + DealType are fetched ONLY to derive the hasPhoto/dealKind bits
        // below; the URL and any price/date are discarded — nothing beyond PUBLIC_FIELDS is
        // returned, so no VOW value reaches the anon path.
        include_fields: PUBLIC_STATUS_FIELDS,
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
      hasPhoto: typeof d.primaryImageUrl === "string" && d.primaryImageUrl.length > 0,
      dealKind: deriveDealKind(d.DealType),
    };
  } catch (err) {
    console.error(`[soldByKey] public fetch failed for "${key}":`, err);
    return null;
  }
}

/**
 * PUBLIC-safe sold lookup by ADDRESS — for key-less /address slugs (a visitor typed an
 * address; we don't know its ListingKey). Same structural gate as getSoldPublicByKey:
 * include_fields restricts the anonymous path to address/geo (+ PurchaseContractDate,
 * fetched ONLY to pick the most recent campaign server-side — it is not returned).
 * Matching mirrors the watchlist dispositions route: free-text UnparsedAddress query,
 * then addressesMatch (civic number + postal-or-city/street) so a neighbour never bleeds in.
 */
export async function getSoldPublicByAddress(parsed: ParsedAddress): Promise<SoldPublic | null> {
  if (!parsed.streetNumber || !parsed.streetName) return null;
  try {
    const res = await getSoldClient()
      .collections(SOLD_LISTINGS_COLLECTION)
      .documents()
      .search({
        q: `${parsed.streetNumber} ${parsed.streetName}`.trim(),
        query_by: "UnparsedAddress",
        include_fields: `${PUBLIC_STATUS_FIELDS},PurchaseContractDate`,
        per_page: 25,
      });
    let best: { d: Partial<SoldListingDocument>; date: number } | null = null;
    for (const h of res.hits ?? []) {
      const d = h.document as Partial<SoldListingDocument>;
      if (!d.id || !addressesMatch(parsed, parseAddress(d.UnparsedAddress ?? ""))) continue;
      const date = typeof d.PurchaseContractDate === "number" ? d.PurchaseContractDate : 0;
      if (!best || date > best.date) best = { d, date };
    }
    if (!best) return null;
    const d = best.d;
    const loc =
      Array.isArray(d.location) && d.location.length === 2 && Number.isFinite(d.location[0]) && Number.isFinite(d.location[1])
        ? ([d.location[0], d.location[1]] as [number, number])
        : null;
    return {
      id: d.id!,
      address: d.UnparsedAddress ?? "",
      city: d.City ?? "",
      cityRegion: d.CityRegion ?? "",
      location: loc,
      hasPhoto: typeof d.primaryImageUrl === "string" && d.primaryImageUrl.length > 0,
      dealKind: deriveDealKind(d.DealType),
    };
  } catch (err) {
    console.error(`[soldByKey] address lookup failed:`, err);
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

/**
 * Photo URLs for the AUTHED /address gallery. VOW media — call ONLY inside the
 * getConsumer()-gated branch (never on the anonymous path).
 *
 * The lean `sold_listings` collection stores just ONE `primaryImageUrl` thumbnail (RAM
 * policy), so for a real gallery we prefer the full `listings.media_urls` array when the
 * listing still has a row there, and fall back to the single thumbnail otherwise.
 * Best-effort: returns [] on failure or when the record genuinely has no media.
 *
 * @param key             listing key
 * @param primaryImageUrl the sold doc's thumbnail (already fetched by the caller), used as
 *                        the single-image fallback when the listings table has no media.
 */
export async function getSoldMediaByKey(key: string, primaryImageUrl?: string): Promise<string[]> {
  const fallback = typeof primaryImageUrl === "string" && primaryImageUrl.length > 0 ? [primaryImageUrl] : [];
  try {
    const supabase = getServiceRoleClient();
    const { data } = await supabase.from("listings").select("media_urls").eq("listing_key", key).maybeSingle();
    const urls = Array.isArray(data?.media_urls) ? (data!.media_urls as unknown[]) : [];
    const clean = urls.filter((u): u is string => typeof u === "string" && u.length > 0);
    return clean.length > 0 ? clean : fallback;
  } catch (err) {
    console.error(`[soldByKey] media fetch failed for "${key}":`, err);
    return fallback;
  }
}
