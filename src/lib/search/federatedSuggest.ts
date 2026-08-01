/**
 * federatedSuggest — one query, categorized results.
 *
 * Replaces the flat suggestSearch list with grouped, intent-ranked suggestions:
 *   MLS#  ·  Addresses (active)  ·  Sold (gated teaser)  ·  Communities  ·  Geo
 *
 * Reuses the SAME Typesense `properties` collection + faceted query the legacy bar
 * used (RAM-safe — no new facets), then layers on a geocode fallback so a typed
 * address with no active listing still resolves to a map fly-to. Sold prices are
 * never returned here (VOW): the sold row is a gated CTA, surfaced only on
 * address-intent queries.
 */

import { getTypesenseClient, type ListingDocument } from "@/lib/typesense/client";
import { parseAddress, streetNamesMatch } from "@/lib/watchlist/disposition";
import { geocodeAddress } from "./geocodeClient";
import { rankAddressSuggestions } from "./addressRank";
import { anyTransactionPriceFloor } from "@/lib/filters/fundamentals";
import type { AddressStatusResponse, SuggestGroup, SuggestItem } from "./types";

/**
 * Placeholder-price floor. Derived from each document's own `TransactionType`
 * rather than assuming a sale price — a bare `ListPrice:>=100000` here hid every
 * lease listing, because a lease's ListPrice is a monthly rent, not a sale price.
 * See anyTransactionPriceFloor.
 */
const LISTING_FLOOR = anyTransactionPriceFloor();
const MLS_RE = /^[A-Za-z]\d{6,9}$/;
const hasStreetNumber = (q: string) => /\d/.test(q);

/**
 * Whether an address suggestion GENUINELY matches the typed query — same civic number
 * AND the typed street-name tokens appear in the suggestion's street. Typesense is
 * typo-tolerant on purpose ("758 cappamore" happily returns "758 Coldstream" /
 * "758 Dovercourt"), and those fuzzy lookalikes used to suppress the geocode fallback —
 * so a real off-market address never surfaced at all. Fuzzy rows stay useful as
 * suggestions; they just must not swallow the typed address.
 */
export function matchesTypedAddress(query: string, suggestionAddress: string): boolean {
  const typed = parseAddress(query);
  if (!typed.streetNumber || typed.streetName.length < 3) return false;
  const cand = parseAddress(suggestionAddress);
  return typed.streetNumber === cand.streetNumber && streetNamesMatch(typed.streetName, cand.streetName);
}

const TITLE: Record<string, string> = {
  mls: "MLS#",
  // The address group holds LIVE listings — name it by what it is, not its lookup key
  // ("Addresses" next to the geo group's "Address" read as duplicates).
  address: "For sale",
  sold: "Recent solds · nearby",
  soldAddress: "Property records",
  community: "Communities",
  school: "Schools",
  geo: "Address",
};

/** SOLD / LEASED / OFF MARKET row chip text per the public status kind. */
const KIND_LABEL: Record<string, string> = { sold: "SOLD", leased: "LEASED", offmarket: "OFF MARKET" };

/**
 * Probe the server for a sold/leased/off-market record at the typed address. The route
 * applies the VOW gate (anon payloads carry the status KIND only — no price, no date).
 * Best-effort: any failure just means the geocode fallback renders instead. Exported
 * for the header search bar's kind-aware fallback label.
 */
export async function fetchAddressStatus(q: string, signal?: AbortSignal): Promise<AddressStatusResponse | null> {
  try {
    const res = await fetch(`/api/search/address-status?q=${encodeURIComponent(q)}`, { signal });
    if (!res.ok) return null;
    return (await res.json()) as AddressStatusResponse;
  } catch {
    return null;
  }
}

/** Epoch (UTC-midnight date-only) → "Jul 21, 2026" — audit MEDIUM-18. */
function fmtSoldDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

function geoOf(listing: ListingDocument): { lat: number; lng: number; zoom?: number } | undefined {
  const loc = listing.location;
  if (Array.isArray(loc) && loc.length === 2 && (loc[0] || loc[1])) {
    return { lat: loc[0], lng: loc[1], zoom: 16 };
  }
  return undefined;
}

export async function federatedSuggest(
  query: string,
  signal?: AbortSignal,
  options?: { structured?: boolean }
): Promise<SuggestGroup[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  // A structured (NL→chips) query is a DESCRIPTION, not an address: skip the address,
  // sold-teaser and geocode paths (they read the raw sentence literally and produce
  // nonsense — e.g. geocoding "…2 bedrooms…" to a street in Newfoundland). The chip
  // preview is the real answer; here we keep only community facets.
  const structured = options?.structured ?? false;
  const needle = q.toLowerCase();
  const client = getTypesenseClient();
  // Abortable so a newer keystroke cancels the in-flight request instead of
  // piling up connections (the 6-per-host browser cap is what makes a slow
  // backend feel "stuck"). typesense-js 3.x honours abortSignal.
  const opts = signal ? { abortSignal: signal } : undefined;

  const addresses: SuggestItem[] = [];
  const communities: SuggestItem[] = [];
  const mls: SuggestItem[] = [];
  const geo: SuggestItem[] = [];

  // 1) MLS# exact — the key IS the document id.
  if (MLS_RE.test(q)) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r: any = await client.collections("properties").documents().search(
        {
          q: "*",
          query_by: "City",
          filter_by: `id:=${q.toUpperCase()}`,
          per_page: 1,
        },
        opts
      );
      const doc = r.hits?.[0]?.document as ListingDocument | undefined;
      if (doc)
        mls.push({
          id: `mls:${doc.id}`,
          category: "mls",
          label: `MLS# ${doc.id}`,
          sublabel: doc.UnparsedAddress,
          listing: doc,
          geo: geoOf(doc),
          provenance: "MLS#",
        });
    } catch {
      /* fall through to address/place search */
    }
  }

  // 2) Combined address-hits + place-facets (one round-trip), with a place-only
  //    retry if UnparsedAddress isn't indexed (pre-migration safety).
  const base = {
    q,
    filter_by: LISTING_FLOOR,
    facet_by: "City,CityRegion",
    max_facet_values: 100,
    per_page: 6,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let response: any = null;
  let addressSearchable = true;
  try {
    response = await client
      .collections("properties")
      .documents()
      .search({ ...base, query_by: "UnparsedAddress,City,CityRegion" }, opts);
  } catch (err) {
    if (signal?.aborted) throw err; // a newer keystroke cancelled this — bail
    addressSearchable = false;
    try {
      response = await client
        .collections("properties")
        .documents()
        .search({ ...base, query_by: "City,CityRegion" }, opts);
    } catch {
      response = null;
    }
  }

  if (response) {
    // Communities from facet counts (matched + ranked by live active inventory).
    const facets: Array<{ field_name: string; counts: Array<{ value: string; count: number }> }> =
      response.facet_counts || [];
    const seenPlace = new Set<string>();
    for (const f of facets) {
      for (const { value, count } of f.counts || []) {
        if (!value || !value.toLowerCase().includes(needle)) continue;
        const key = value.toLowerCase();
        if (seenPlace.has(key)) continue;
        seenPlace.add(key);
        communities.push({
          id: `community:${key}`,
          category: "community",
          label: value,
          count,
          provenance: f.field_name === "City" ? "city" : "community",
        });
      }
    }
    communities.sort((a, b) => (b.count ?? 0) - (a.count ?? 0));

    // Addresses — only when the query carries a street number (address intent) or
    // there are no community matches, so a bare city name doesn't flood with its
    // own listings.
    if (!structured && addressSearchable && (hasStreetNumber(q) || communities.length === 0)) {
      const seenAddr = new Set<string>();
      for (const h of (response.hits || []) as Array<{ document: ListingDocument }>) {
        const doc = h.document;
        if (!doc?.UnparsedAddress || seenAddr.has(doc.id)) continue;
        seenAddr.add(doc.id);
        addresses.push({
          id: `address:${doc.id}`,
          category: "address",
          label: doc.UnparsedAddress,
          sublabel: addressMeta(doc),
          listing: doc,
          geo: geoOf(doc),
          provenance: "address",
        });
      }
    }
  }

  // 3) Off-market ladder — typed address with no matching active listing still resolves.
  //    Fires when it looks like a street address (number + a name word) AND no returned
  //    suggestion GENUINELY matches what was typed — typo-tolerant fuzzy hits
  //    ("758 Coldstream" for "758 cappamore") must not suppress the real address.
  //    Sold record beats geocode (one address = one row): a home that sold last week
  //    must answer with its sale, never with "Not on the market".
  // HouseSigma-style: surface EVERY disposition at the typed address as its own row (a
  // terminated original AND its sold relist both show), each with its status, VOW-gated price,
  // date, MLS# and brokerage. Fires for any address-shaped query — NOT gated on "no active
  // match" — so records show ALONGSIDE a live For-Sale row. The geocode fallback still only
  // renders when the address is genuinely unlisted (no records AND no active coverage).
  const soldAddress: SuggestItem[] = [];
  const typedAddressCovered = addresses.some((a) => matchesTypedAddress(q, a.label));
  if (!structured && /\d+\s+[a-zA-Z]{3,}/.test(q)) {
    const [status, hit] = await Promise.all([fetchAddressStatus(q, signal), geocodeAddress(q, signal)]);
    const records = status?.found ? status.records ?? [] : [];
    for (const r of records) {
      const meta = [r.subType?.trim() || null, r.beds ? `${r.beds} bd` : null, r.baths ? `${r.baths} ba` : null]
        .filter(Boolean)
        .join(" · ");
      soldAddress.push({
        id: `soldAddress:${r.key}`,
        category: "soldAddress",
        label: r.address,
        sublabel: meta || undefined,
        provenance: "record",
        sold: {
          priceMasked: !r.closePrice,
          priceLabel: r.closePrice ? `$${Math.round(r.closePrice).toLocaleString("en-CA")}` : undefined,
          dateLabel: r.soldDateMs ? fmtSoldDate(r.soldDateMs) : undefined,
          href: r.href,
          kindLabel: KIND_LABEL[r.dealKind],
          mls: r.key,
          brokerage: r.brokerage,
        },
      });
    }
    if (records.length === 0 && !typedAddressCovered && hit) {
      geo.push({
        id: `geo:${hit.lat},${hit.lng}`,
        category: "geo",
        label: hit.label,
        sublabel: "Not on the market — view the address profile, or drop a pin",
        geo: { lat: hit.lat, lng: hit.lng, zoom: 16 },
        provenance: "geocoded",
      });
    }
  }

  // The typed-but-unlisted address is the user's stated intent — it outranks fuzzy
  // lookalikes, so the sold-record/geo row renders ABOVE the address group.
  // Re-rank address hits by closeness to the typed string before slicing: Typesense's
  // typo-tolerant order otherwise floats lookalikes (same civic number, wrong street;
  // or a shared street-name word) above the address the user actually typed.
  const rankedAddresses = rankAddressSuggestions(q, addresses, (a) => a.label);
  const order: Array<[SuggestItem[], SuggestGroup["category"]]> = [
    [mls, "mls"],
    [soldAddress, "soldAddress"],
    [geo, "geo"],
    [rankedAddresses.slice(0, 5), "address"],
    [communities.slice(0, 6), "community"],
  ];
  return order
    .filter(([items]) => items.length > 0)
    .map(([items, category]) => ({ category, title: TITLE[category], items }));
}

/** "3 bd · 2 ba · Detached · $749,900" line under an address suggestion. */
function addressMeta(d: ListingDocument): string {
  const parts: string[] = [];
  const beds = d.BedroomsAboveGrade || d.BedroomsTotal;
  if (beds) parts.push(`${beds} bd`);
  if (d.BathroomsTotalInteger) parts.push(`${d.BathroomsTotalInteger} ba`);
  if (d.PropertySubType) parts.push(d.PropertySubType.trim());
  if (d.ListPrice) parts.push(`$${d.ListPrice.toLocaleString("en-US")}`);
  return parts.join(" · ");
}
