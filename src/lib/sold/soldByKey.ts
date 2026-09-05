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
import { parseAddress, addressesMatch, streetNamesMatchPrefix, unitsMatch, type ParsedAddress } from "@/lib/watchlist/disposition";
import { deriveDealType } from "@/lib/sold/dealType";
import { isOptedOutValue } from "@/lib/compliance/internetDisplay";
import { loadPostalCodes, getCoordinates } from "@/lib/postalCodes";
import { primaryImageFromPhotos } from "@/lib/etl/selectPrimaryImage";
import { bedSplit } from "@/lib/listings/bedSplit";
import { cityFilterClause } from "@/lib/listings/cityHubs";

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

// ── raw_vow_sold archive fallback (records older than the 180-day Typesense cache) ────────
// The `sold_listings` collection is a rolling 180-day cache (soldIndexer's SOLD_WINDOW_DAYS,
// pruned nightly). A home that sold 6 mo–2 yr ago is pruned from it, so a by-key or by-address
// lookup here missed — and the search dropdown / keyed /address page fell through to a geocoded
// lookalike ("41 Duggan Drive" resolved to "41 Duggan Avenue"). The full ~2 yr+ record still
// lives in Supabase `raw_vow_sold`, so we probe it when the cache misses. The archive is the
// SAME source the /address street-ledger and sale-record cards already read.
//
// GATE is preserved: the PUBLIC helpers select address/status fields only (no price/date); the
// VOW figures are read solely by the GATED helper, called only inside a getConsumer() branch.

function toInt(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
}
function toFloat(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Postal-centroid location for an archive record — raw_vow_sold stores no rooftop lat/lng,
 *  so resolve the full 6-char postal (from the address, else the postal_code column) through
 *  the Ontario LDU library. Precise enough for the /address radius features (nearest school,
 *  walkability, nearby homes). Null when no postal resolves → the page degrades to no geo block. */
function archiveLocation(address: string, postalCol: string | null): [number, number] | null {
  const postal = parseAddress(address).postal || (postalCol ?? "").trim();
  if (!postal) return null;
  loadPostalCodes();
  const c = getCoordinates(postal);
  return c ? [c.lat, c.lng] : null;
}

/** PUBLIC archive record by key — address + status KIND + geo/photo-existence bit (no
 *  price/date). listing_key is the raw_vow_sold PK, so this is an index lookup, never a scan.
 *  `location` comes from the postal centroid (raw_vow_sold has no rooftop lat/lng) so the keyed
 *  /address page still gets its schools / walkability / nearby-homes context. */
async function getSoldArchivePublicByKey(key: string): Promise<SoldPublic | null> {
  try {
    const { data } = await getServiceRoleClient()
      .from("raw_vow_sold")
      .select(
        "listing_key, unparsed_address, city, city_region, postal_code, photos, mls_status:raw_payload->>MlsStatus, txn_type:raw_payload->>TransactionType, " +
          // Seller opt-out. Purging the Typesense doc does NOT take this page down: the
          // archive fallback re-serves it straight from raw_vow_sold, so the gate has to
          // sit on the read, not only on the index.
          "internet_display:raw_payload->>InternetEntireListingDisplayYN, " +
          "internet_address_display:raw_payload->>InternetAddressDisplayYN"
      )
      .eq("listing_key", key)
      .maybeSingle();
    const row = data as Record<string, unknown> | null;
    if (!row?.listing_key) return null;
    // Either switch removes this page — it exists to publish an address.
    if (isOptedOutValue(row.internet_display) || isOptedOutValue(row.internet_address_display)) {
      return null;
    }
    const address = (row.unparsed_address as string | null) ?? "";
    return {
      id: String(row.listing_key),
      address,
      city: (row.city as string | null) ?? "",
      cityRegion: (row.city_region as string | null) ?? "",
      location: archiveLocation(address, row.postal_code as string | null),
      hasPhoto: !!primaryImageFromPhotos(row.photos),
      dealKind: deriveDealKind(deriveDealType(row.mls_status as string | null, row.txn_type as string | null)),
    };
  } catch (err) {
    console.error(`[soldByKey] archive public-by-key failed for "${key}":`, err);
    return null;
  }
}

/** GATED archive record by key — the VOW figures (close price, sold date, beds/baths/size)
 *  from raw_vow_sold flat columns. CONSUMER-ONLY: call solely inside a getConsumer()-confirmed
 *  branch, exactly like getSoldGatedByKey. Shaped as the SoldListingDocument fields its callers
 *  read; ParkingTotal/LotWidth/BasementTier default 0 (never read on the gated dropdown / sale
 *  card paths). */
async function getSoldArchiveGatedByKey(key: string): Promise<SoldListingDocument | null> {
  try {
    const { data } = await getServiceRoleClient()
      .from("raw_vow_sold")
      .select(
        "listing_key, unparsed_address, city, city_region, close_price, list_price, purchase_contract_date, photos, " +
          "bedrooms_above_grade, bedrooms_below_grade, bathrooms_total_integer, building_area_total, property_sub_type, " +
          "office:raw_payload->>ListOfficeName, mls_status:raw_payload->>MlsStatus, txn_type:raw_payload->>TransactionType, " +
          // Seller opt-out — the gated archive read needs the same gate as the public
          // one. A registered consumer is not an exemption: the seller told the board
          // to stop distributing, and that instruction is not conditional on who looks.
          "internet_display:raw_payload->>InternetEntireListingDisplayYN, " +
          "internet_address_display:raw_payload->>InternetAddressDisplayYN"
      )
      .eq("listing_key", key)
      .maybeSingle();
    const row = data as Record<string, unknown> | null;
    if (!row?.listing_key) return null;
    if (isOptedOutValue(row.internet_display) || isOptedOutValue(row.internet_address_display)) {
      return null;
    }
    // Mirror the indexer: date-only value → epoch ms (rendered with timeZone:'UTC').
    const ms = row.purchase_contract_date ? new Date(row.purchase_contract_date as string).getTime() : 0;
    const above = toInt(row.bedrooms_above_grade);
    const below = toInt(row.bedrooms_below_grade);
    const primaryImageUrl = primaryImageFromPhotos(row.photos);
    return {
      id: String(row.listing_key),
      ClosePrice: toInt(row.close_price),
      ListPrice: toInt(row.list_price),
      City: (row.city as string | null) ?? "",
      CityRegion: (row.city_region as string | null) ?? "",
      UnparsedAddress: (row.unparsed_address as string | null) ?? "",
      PropertySubType: (row.property_sub_type as string | null) ?? "",
      BedroomsTotal: above + below,
      BedroomsAboveGrade: above,
      BedroomsBelowGrade: below,
      BathroomsTotalInteger: toFloat(row.bathrooms_total_integer),
      BuildingAreaTotal: toInt(row.building_area_total),
      ParkingTotal: 0,
      LotWidth: 0,
      BasementTier: 0,
      ListOfficeName: (row.office as string | null) ?? "",
      PurchaseContractDate: Number.isFinite(ms) ? ms : 0,
      DealType: deriveDealType(row.mls_status as string | null, row.txn_type as string | null),
      ...(primaryImageUrl ? { primaryImageUrl } : {}),
    };
  } catch (err) {
    console.error(`[soldByKey] archive gated-by-key failed for "${key}":`, err);
    return null;
  }
}

/** PUBLIC archive record by address — the by-address fallback for the search dropdown and the
 *  /address resolver. Light probe (flat columns, no raw_payload → no detoast), civic-number
 *  anchored + prefix street-name match (mirrors getSoldPublicByAddressLoose), newest first;
 *  then one PK read to build the record. The anchored ILIKE mirrors the sale-record probe
 *  (saleRecord.ts) that already runs on raw_vow_sold in production. */
async function getSoldArchivePublicByAddress(
  parsed: ParsedAddress,
  opts?: { ignoreUnit?: boolean }
): Promise<SoldPublic | null> {
  if (!parsed.streetNumber || parsed.streetName.length < 3) return null;
  const token = parsed.streetName.split(/\s+/).sort((a, b) => b.length - a.length)[0];
  if (!token || token.length < 3) return null;
  const safeToken = token.replace(/[%_,()]/g, "");
  try {
    const { data } = await getServiceRoleClient()
      .from("raw_vow_sold")
      .select("listing_key, unparsed_address, purchase_contract_date")
      .ilike("unparsed_address", `${parsed.streetNumber}%${safeToken}%`)
      .order("purchase_contract_date", { ascending: false })
      .limit(25);
    for (const r of (data ?? []) as Array<Record<string, unknown>>) {
      const cand = parseAddress((r.unparsed_address as string | null) ?? "");
      if (cand.streetNumber !== parsed.streetNumber) continue;
      // Unit first. Rows arrive newest-first, so without this the fallback handed back
      // the most recent sale in the BUILDING as if it were the subject's own.
      if (!opts?.ignoreUnit && !unitsMatch(parsed, cand)) continue;
      if (!streetNamesMatchPrefix(parsed.streetName, cand.streetName)) continue;
      if (parsed.postal && cand.postal && parsed.postal !== cand.postal) continue;
      // Ordered newest-first → the first genuine match is the most recent sale.
      return await getSoldArchivePublicByKey(String(r.listing_key));
    }
    return null;
  } catch (err) {
    console.error(`[soldByKey] archive by-address failed:`, err);
    return null;
  }
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
    // Cache miss → the record may be older than the 180-day window; try the archive.
    if (!d?.id) return await getSoldArchivePublicByKey(key);
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
export async function getSoldPublicByAddress(
  parsed: ParsedAddress,
  opts?: { ignoreUnit?: boolean }
): Promise<SoldPublic | null> {
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
      if (!d.id || !addressesMatch(parsed, parseAddress(d.UnparsedAddress ?? ""), opts)) continue;
      const date = typeof d.PurchaseContractDate === "number" ? d.PurchaseContractDate : 0;
      if (!best || date > best.date) best = { d, date };
    }
    if (!best) return await getSoldArchivePublicByAddress(parsed, opts);
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

/**
 * PREFIX-TOLERANT public sold lookup — for the search dropdown's type-ahead, where the
 * street name is usually mid-keystroke ("127 via to"). Same structural gate as
 * getSoldPublicByAddress (PUBLIC fields only; PurchaseContractDate fetched solely to
 * rank candidates server-side and never returned). Matching: civic number equal +
 * prefix street-name match (+ postal equality when both sides have one); the strict
 * city check is intentionally dropped — a typed fragment rarely carries a city, and the
 * newest-first ranking absorbs lookalikes. NEVER use for canonical resolution.
 *
 * Deliberately UNIT-BLIND, unlike getSoldPublicByAddress. A suggestion row renders its
 * own full address ("2945 Thomas Street 62"), so the reader sees exactly which unit they
 * are being offered; nothing here claims to be the subject's own record. Requiring a unit
 * would just delete every condo from the dropdown for anyone who typed a street.
 */
export async function getSoldPublicByAddressLoose(parsed: ParsedAddress): Promise<SoldPublic | null> {
  if (!parsed.streetNumber || parsed.streetName.length < 3) return null;
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
      if (!d.id) continue;
      const cand = parseAddress(d.UnparsedAddress ?? "");
      if (cand.streetNumber !== parsed.streetNumber) continue;
      if (!streetNamesMatchPrefix(parsed.streetName, cand.streetName)) continue;
      if (parsed.postal && cand.postal && parsed.postal !== cand.postal) continue;
      const date = typeof d.PurchaseContractDate === "number" ? d.PurchaseContractDate : 0;
      if (!best || date > best.date) best = { d, date };
    }
    // Unit-blind here too, so the archive leg can't be stricter than the index leg above
    // and make the same typed fragment resolve differently depending on which one answers.
    if (!best) return await getSoldArchivePublicByAddress(parsed, { ignoreUnit: true });
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
    console.error(`[soldByKey] loose address lookup failed:`, err);
    return null;
  }
}

/** One disposition (campaign) at a typed address for the HouseSigma-style multi-record search
 *  dropdown. PUBLIC fields only — status KIND, address, MLS#, and brokerage (brokerage is public
 *  per TRREB §6.3(c)). Price/date/beds stay VOW-gated and are attached per-key by the route's
 *  getConsumer() branch, never here. */
export interface AddressRecord {
  id: string;
  address: string;
  city: string;
  cityRegion: string;
  dealKind: SoldPublic["dealKind"];
  brokerage: string | null;
  /** EXISTENCE bit only — a record's photo URL is VOW and never leaves this module on the
   *  public path. Lets a search row show a locked thumbnail rather than a false promise. */
  hasPhoto: boolean;
}

/**
 * ALL dispositions at a typed address (HouseSigma-style), newest-first, deduped by MLS#. Same
 * loose match + gate as getSoldPublicByAddressLoose, but returns EVERY campaign instead of
 * collapsing to the newest — so a terminated original AND its sold relist both surface as
 * distinct rows. `sold_listings` already indexes sold/leased AND terminated/expired/suspended
 * (by DealType), so one query covers every state. Falls back to the raw_vow_sold archive (single
 * record) when the 180-day cache misses. NEVER use for canonical resolution.
 */
export async function getAddressRecordsLoose(parsed: ParsedAddress): Promise<AddressRecord[]> {
  if (!parsed.streetNumber || parsed.streetName.length < 3) return [];
  try {
    const res = await getSoldClient()
      .collections(SOLD_LISTINGS_COLLECTION)
      .documents()
      .search({
        q: `${parsed.streetNumber} ${parsed.streetName}`.trim(),
        query_by: "UnparsedAddress",
        include_fields: `${PUBLIC_STATUS_FIELDS},ListOfficeName,PurchaseContractDate`,
        per_page: 25,
      });
    const byId = new Map<string, { rec: AddressRecord; date: number }>();
    for (const h of res.hits ?? []) {
      const d = h.document as Partial<SoldListingDocument> & { ListOfficeName?: string };
      if (!d.id || byId.has(d.id)) continue;
      const cand = parseAddress(d.UnparsedAddress ?? "");
      if (cand.streetNumber !== parsed.streetNumber) continue;
      if (!streetNamesMatchPrefix(parsed.streetName, cand.streetName)) continue;
      if (parsed.postal && cand.postal && parsed.postal !== cand.postal) continue;
      byId.set(d.id, {
        rec: {
          id: d.id,
          address: d.UnparsedAddress ?? "",
          city: d.City ?? "",
          cityRegion: d.CityRegion ?? "",
          dealKind: deriveDealKind(d.DealType),
          brokerage: d.ListOfficeName?.trim() || null,
          hasPhoto: !!d.primaryImageUrl,
        },
        date: typeof d.PurchaseContractDate === "number" ? d.PurchaseContractDate : 0,
      });
    }
    const records = [...byId.values()].sort((a, b) => b.date - a.date).map((x) => x.rec);
    if (records.length > 0) return records;
    const archive = await getSoldArchivePublicByAddress(parsed);
    return archive
      ? [{ id: archive.id, address: archive.address, city: archive.city, cityRegion: archive.cityRegion, dealKind: archive.dealKind, brokerage: null, hasPhoto: archive.hasPhoto }]
      : [];
  } catch (err) {
    console.error(`[soldByKey] address records lookup failed:`, err);
    return [];
  }
}

/**
 * Every home on a STREET that has a record, newest campaign first — the street-name query
 * ("cappam") that used to return nothing because the record probe demanded a civic number.
 *
 * Reads the `sold_listings` Typesense cache, NOT the raw_vow_sold archive. That matters:
 * the archive holds ~2yr+ but only answers an ilike flat-column scan, which is expensive
 * enough that streetLedger caps it at 200 rows and caches it for six hours. A typeahead
 * cannot afford that per keystroke, so street history is deliberately limited to the
 * rolling ~180-day cache — recent, cheap and bounded.
 *
 * Collapsed to ONE row per address (its newest campaign): a street query answers "which
 * homes here have history", and the per-address ladder answers "what happened at this one".
 */
export async function getStreetRecordsLoose(street: string, max = 12): Promise<AddressRecord[]> {
  const token = street.trim().toLowerCase();
  if (token.length < 4) return [];
  try {
    const res = await getSoldClient()
      .collections(SOLD_LISTINGS_COLLECTION)
      .documents()
      .search({
        q: token,
        query_by: "UnparsedAddress",
        include_fields: `${PUBLIC_STATUS_FIELDS},ListOfficeName,PurchaseContractDate`,
        per_page: 40,
      });
    const byAddress = new Map<string, { rec: AddressRecord; date: number }>();
    for (const h of res.hits ?? []) {
      const d = h.document as Partial<SoldListingDocument> & { ListOfficeName?: string };
      if (!d.id || !d.UnparsedAddress) continue;
      const cand = parseAddress(d.UnparsedAddress);
      // The typed fragment must genuinely appear in the street name — Typesense's
      // typo-tolerance otherwise floats unrelated streets that merely rhyme.
      if (!cand.streetNumber || !cand.streetName.includes(token.split(/\s+/)[0])) continue;
      const key = `${cand.streetNumber}|${cand.streetName}|${cand.postal || cand.city}`;
      const date = typeof d.PurchaseContractDate === "number" ? d.PurchaseContractDate : 0;
      const prev = byAddress.get(key);
      if (prev && prev.date >= date) continue;
      byAddress.set(key, {
        rec: {
          id: d.id,
          address: d.UnparsedAddress,
          city: d.City ?? "",
          cityRegion: d.CityRegion ?? "",
          dealKind: deriveDealKind(d.DealType),
          brokerage: d.ListOfficeName?.trim() || null,
          hasPhoto: !!d.primaryImageUrl,
        },
        date,
      });
    }
    return [...byAddress.values()].sort((a, b) => b.date - a.date).slice(0, max).map((x) => x.rec);
  } catch (err) {
    console.error(`[soldByKey] street records lookup failed for "${street}":`, err);
    return [];
  }
}

/** One sold record reduced to the PUBLIC fields needed to build an /address URL. */
export interface SoldSitemapEntry {
  id: string;
  city: string;
  address: string;
}

/** Sales only. raw_vow_sold mixes sales and leases; migration 104 exists so this is a
 *  stated category and never a price threshold. */
const SALE_TRANSACTION_TYPE = "For Sale";
/** PostgREST hard-caps one response at 1000 rows. */
const SITEMAP_PAGE = 1000;

/**
 * One shard of the /address sitemap, read from the PERMANENT archive.
 *
 * This used to `.export()` the Typesense sold_listings collection and take the first
 * `max` lines. Three things were wrong with that, measured 2026-09-02:
 *   - `.export()` has no ordering and the route applied no filter, so the 45,000 URLs
 *     it emitted were an arbitrary 23% slice of 199,253 documents, mixing sold, leased,
 *     terminated, expired and suspended records. Not a recency window — just whatever
 *     came out of the collection first.
 *   - That collection is pruned to 180 days (SOLD_WINDOW_DAYS), while raw_vow_sold holds
 *     268,510 sales permanently. Sold pages are meant to live forever and the read path
 *     already resolves them (getSoldArchivePublicByKey); only DISCOVERY was bounded.
 *   - It could not check the seller's internet-display opt-out at all.
 *
 * COMPLIANCE — the reason this reads flat columns and requires an explicit `false`:
 * a sitemap entry publishes an address. Either opt-out switch forbids that. The flags
 * live in raw_payload too, but reading them there is a detoast per row that STATEMENT
 * TIMEOUTs past the first page, so migration 137 promoted them to columns. `.eq(col,
 * false)` also excludes NULL, so a row the backfill has not reached yet is dropped
 * rather than published — the safe direction to fail.
 *
 * Paging: the first request pays an offset to reach the shard's start, then walks by
 * keyset on listing_key. Offsets on flat columns are cheap (~1.4s at 45,000) but they
 * are O(offset), so only one per shard is worth paying.
 *
 * Best-effort: returns what it managed to read, [] on failure. A sitemap that renders
 * short beats a route that 500s.
 */
export async function getSoldSitemapShard(
  offset: number,
  limit: number,
  windowStartIso: string
): Promise<SoldSitemapEntry[]> {
  const out: SoldSitemapEntry[] = [];
  let cursor: string | null = null;

  try {
    // INSIDE the try: getServiceRoleClient THROWS when SUPABASE_SERVICE_ROLE_KEY is
    // absent, and generateSitemaps prerenders all seven shards at build. One throw out
    // here would fail the whole build rather than yield an empty sitemap. app/sitemap.ts
    // has always called it inside its try for the same reason.
    const supabase = getServiceRoleClient();
    while (out.length < limit) {
      const want = Math.min(SITEMAP_PAGE, limit - out.length);
      let q = supabase
        .from("raw_vow_sold")
        .select("listing_key, unparsed_address, city")
        .eq("transaction_type", SALE_TRANSACTION_TYPE)
        .gte("purchase_contract_date", windowStartIso)
        // Explicit false only — NULL is "not backfilled", not "not opted out".
        .eq("internet_display_optout", false)
        .eq("internet_address_optout", false)
        .order("listing_key");

      // First page seeks to this shard's slice; the rest walk forward from the cursor.
      q = cursor === null ? q.range(offset, offset + want - 1) : q.gt("listing_key", cursor).limit(want);

      const { data, error } = await q;
      if (error) {
        // NEVER as if the table simply ended. This exact conflation shipped seven EMPTY
        // sitemap shards to production on 2026-09-05: the build timed out on the first
        // page, `break` returned [], and the route rendered valid XML with no URLs — so
        // the build went green and nothing reported it.
        console.error(`[soldByKey] sitemap shard offset=${offset} failed after ${out.length} rows: ${error.message}`);
        break;
      }
      if (!data || data.length === 0) break;

      for (const row of data as { listing_key: string; unparsed_address: string | null; city: string | null }[]) {
        out.push({ id: row.listing_key, address: row.unparsed_address ?? "", city: row.city ?? "" });
      }
      cursor = (data[data.length - 1] as { listing_key: string }).listing_key;
      if (data.length < want) break; // exhausted
    }
  } catch (err) {
    console.error("[soldByKey] sitemap shard read failed:", err);
  }
  return out;
}

/** A sold/off-market record reduced to what a public LINK needs. No VOW values. */
export interface SoldPublicLink {
  id: string;
  address: string;
  city: string;
  cityRegion: string;
}

/**
 * Public sold records matching a Typesense filter, newest first.
 *
 * ANONYMOUS-SAFE by construction: `include_fields: PUBLIC_FIELDS` is the same structural
 * gate the address page's own anon path uses, so no price, date, photo or brokerage can
 * be returned — only the address, which is public record and which
 * /addresses/sitemap.xml already publishes for every one of these records.
 *
 * "Newest first" is free: the collection's default_sorting_field is PurchaseContractDate
 * and q:"*" orders on it descending. The DATE ITSELF IS NEVER FETCHED — ordering by a
 * field is not returning it. Best-effort ([] on failure); a link block is never worth
 * failing a page render over.
 */
async function searchSoldPublicLinks(filterBy: string, max: number): Promise<SoldPublicLink[]> {
  try {
    const res = await getSoldClient()
      .collections(SOLD_LISTINGS_COLLECTION)
      .documents()
      .search({
        q: "*",
        query_by: "UnparsedAddress", // required syntactically; ignored for q:"*"
        filter_by: filterBy,
        include_fields: PUBLIC_FIELDS,
        per_page: Math.min(Math.max(max, 1), 100), // §4 caps a public result set at 100
      });
    return (res.hits ?? [])
      .map((h) => h.document as Partial<SoldListingDocument>)
      .filter((d): d is Partial<SoldListingDocument> & { id: string } => Boolean(d.id && d.UnparsedAddress))
      .map((d) => ({
        id: d.id,
        address: d.UnparsedAddress ?? "",
        city: d.City ?? "",
        cityRegion: d.CityRegion ?? "",
      }));
  } catch (err) {
    console.error("[soldByKey] public link query failed:", err);
    return [];
  }
}

/**
 * Recently SOLD homes in a city — the crawl path from the (indexable, sitemapped) city
 * hub into the /address tree. Until 2026-09-02 not one server-rendered link pointed at
 * that tree, so the sitemap was its only way in and every address page sat at crawl
 * depth infinity with no internal PageRank.
 *
 * `cities` is the TRREB City list a hub slug resolves to (Toronto = ~36 district codes),
 * filtered with the hub's own cityFilterClause so the two agree. DealType:=sold keeps
 * leases and de-listed campaigns out of a block headed "sold" — legacy docs that predate
 * the field simply don't appear, which is the right trade for an honest heading.
 */
export function getRecentSoldPublicForCity(cities: string[], max = 24): Promise<SoldPublicLink[]> {
  const clause = cityFilterClause(cities);
  if (!clause) return Promise.resolve([]);
  return searchSoldPublicLinks(`${clause} && DealType:=sold`, max);
}

/**
 * Recently SOLD homes near a point, excluding the subject — the sibling links that give
 * the /address tree internal depth instead of 45,000 leaves hanging off a sitemap.
 * Needs the subject's geo; records whose postal code never resolved have no `location`
 * and simply don't match.
 */
export async function getRecentSoldPublicNearPoint(
  lat: number,
  lng: number,
  radiusKm: number,
  excludeKey: string,
  max = 8
): Promise<SoldPublicLink[]> {
  // Over-fetch by one and drop the subject HERE rather than with an `id:!=` filter: `id`
  // is Typesense's reserved document key, and a self-link on every address page is a
  // silly thing to make depend on how a reserved field negates.
  const rows = await searchSoldPublicLinks(`location:(${lat}, ${lng}, ${radiusKm} km) && DealType:=sold`, max + 1);
  return rows.filter((r) => r.id !== excludeKey).slice(0, max);
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
    // Cache miss (record older than the 180-day window) → gated archive read.
    return (res.hits?.[0]?.document as SoldListingDocument | undefined) ?? (await getSoldArchiveGatedByKey(key));
  } catch (err) {
    console.error(`[soldByKey] gated fetch failed for "${key}":`, err);
    return null;
  }
}

/** One closed deal near a point — the actual close price (VOW). Shared by the leased
 *  (monthly rent) and sold (sale price) fetchers; same shape, different price scale. */
export interface LeasedRentItem {
  /** BedroomsTotal — the SUM of above- and below-grade. Display only; never bucket on it. */
  beds: number | null;
  /** Whole bedrooms above grade — the grid's bedroom axis. */
  bedsAbove: number | null;
  /** Capped plus-room flag ("+1"). A den in a condo, a basement bedroom in a house. */
  bedsDen: 0 | 1;
  /** False when the doc omitted BedroomsBelowGrade entirely — absent is not zero. */
  bedsDenKnown: boolean;
  subType: string | null;
  /** ClosePrice = what the home ACTUALLY leased/sold for. */
  price: number;
  /** Full address string — the in-home-unit classifier reads its markers ("Bsmt", "(Lower)"). */
  address: string | null;
  /** BathroomsTotalInteger. Feeds the grid's Rule C, which drops a home carrying far
   *  more bathrooms than its cell's typical one — the grid has no bath axis, so this
   *  is the only thing keeping a nine-bath estate out of a five-bath cell. Null when
   *  the doc omits it; absent must never be read as a value. */
  baths: number | null;
}

/**
 * Closed deals of one kind near a point from the rolling ~180-day sold_listings
 * window. VOW DATA: call ONLY inside a getConsumer()-confirmed branch (close prices
 * are gated whether the deal was a sale or a lease). The sanity band keeps data-entry
 * garbage out of the medians. 250 docs max — with q:"*" Typesense orders on the
 * collection's default sorting field, so a dense downtown cell samples recent deals.
 */
/**
 * Fields the beds x type grid needs from a closed-deal doc.
 *
 * BedroomsAboveGrade/BelowGrade are LOAD-BEARING, not extras. Drop either one and
 * every doc reads as "no plus-room", which silently folds 1+den units back into the
 * 2 bedroom median — the exact bug the split exists to fix, and one that leaves the
 * grid looking perfectly healthy. `soldByKey.fields.test.ts` guards this list.
 */
export const CLOSED_NEAR_POINT_FIELDS =
  "ClosePrice,BedroomsTotal,BedroomsAboveGrade,BedroomsBelowGrade,BathroomsTotalInteger,PropertySubType,UnparsedAddress";

/**
 * What a closed-deal query found, separated from what it fetched.
 *
 * `found` is the TRUE population inside the radius; `items` is the capped page. They
 * were conflated until the grid header on N13718184 printed "250 leases" — the value
 * of `per_page`, while 266 leases actually matched. A page size rendered as a count
 * reads as full coverage when it is a sample.
 */
export interface ClosedNearPoint {
  items: LeasedRentItem[];
  /** Total matching the filter, ignoring the page cap. 0 when the query failed. */
  found: number;
}

async function getClosedNearPoint(
  lat: number,
  lng: number,
  radiusKm: number,
  deal: "sold" | "leased",
  priceMin: number,
  priceMax: number
): Promise<ClosedNearPoint> {
  try {
    const res = await getSoldClient()
      .collections(SOLD_LISTINGS_COLLECTION)
      .documents()
      .search({
        q: "*",
        query_by: "UnparsedAddress",
        filter_by: `location:(${lat}, ${lng}, ${radiusKm} km) && DealType:=${deal} && ClosePrice:>=${priceMin} && ClosePrice:<=${priceMax}`,
        include_fields: CLOSED_NEAR_POINT_FIELDS,
        per_page: 250,
      });
    const items = (res.hits ?? []).map((h) => {
      const d = h.document as Partial<SoldListingDocument>;
      const split = bedSplit(d);
      return {
        beds: typeof d.BedroomsTotal === "number" && d.BedroomsTotal >= 0 ? d.BedroomsTotal : null,
        bedsAbove: split ? split.above : null,
        bedsDen: split ? split.den : 0,
        bedsDenKnown: split ? split.denKnown : false,
        subType: typeof d.PropertySubType === "string" && d.PropertySubType ? d.PropertySubType : null,
        price: typeof d.ClosePrice === "number" ? d.ClosePrice : 0,
        address: typeof d.UnparsedAddress === "string" && d.UnparsedAddress ? d.UnparsedAddress : null,
        baths: typeof d.BathroomsTotalInteger === "number" ? d.BathroomsTotalInteger : null,
      };
    });
    return { items, found: typeof res.found === "number" ? res.found : items.length };
  } catch (err) {
    console.error(`[soldByKey] ${deal}-near-point failed:`, err);
    return { items: [], found: 0 };
  }
}

/**
 * Closed leases near a point — the ground truth for "what do homes here actually rent
 * for". Sanity band 500–20,000 $/mo. VOW — consumer branch only.
 */
export function getLeasedNearPoint(lat: number, lng: number, radiusKm: number): Promise<ClosedNearPoint> {
  return getClosedNearPoint(lat, lng, radiusKm, "leased", 500, 20_000);
}

/**
 * Closed SALES near a point — the ground truth for "what do homes here actually sell
 * for" (the sell-side twin of the rents grid). Sanity band $100k–$30M. VOW — consumer
 * branch only.
 */
export function getSoldNearPoint(lat: number, lng: number, radiusKm: number): Promise<ClosedNearPoint> {
  return getClosedNearPoint(lat, lng, radiusKm, "sold", 100_000, 30_000_000);
}

/**
 * Whether /properties/{key} still renders — the listings row is the detail page's data
 * source (sold rows stay in the table; only records older than the archive lose theirs).
 * One indexed PK existence check; best-effort false on failure. Server-only.
 */
export async function hasFullListingRow(key: string): Promise<boolean> {
  try {
    const { data } = await getServiceRoleClient().from("listings").select("listing_key").eq("listing_key", key).maybeSingle();
    return !!data;
  } catch {
    return false;
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
