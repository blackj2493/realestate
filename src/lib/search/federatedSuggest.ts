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
import {
  ROW_STATUS_LABEL,
  SECTION_TITLE,
  activeRowStatus,
  formatRecordDate,
  formatRowPrice,
  campaignSpanLabel,
  shouldProbeRecords,
  listingMetaLine,
  listingSpecs,
  localityLabel,
} from "./searchRows";
import { groupByProperty } from "./sameProperty";
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

// Section titles and row-status presentation both live in searchRows.ts, shared with the
// header bar. Group headings deliberately no longer name a STATUS: the old "For sale"
// heading sat above lease listings too (every lease has been eligible since the
// price-floor fix), so the heading was lying about a large slice of the index. Status now
// rides on each row instead.

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
          meta: listingMetaLine(doc),
          listing: doc,
          geo: geoOf(doc),
          provenance: "MLS#",
          status: activeRowStatus(doc.TransactionType),
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
          sublabel: listingSpecs(doc),
          meta: listingMetaLine(doc),
          thumbUrl: doc.primaryImageUrl,
          listing: doc,
          geo: geoOf(doc),
          provenance: "address",
          status: activeRowStatus(doc.TransactionType),
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
  if (!structured && shouldProbeRecords(q)) {
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
        meta: [r.soldDateMs ? formatRecordDate(r.soldDateMs) : null, r.key, r.brokerage]
          .filter(Boolean)
          .join("  ·  "),
        provenance: "record",
        sold: {
          priceMasked: !r.closePrice,
          priceLabel: r.closePrice
            ? formatRowPrice(r.closePrice, r.dealKind === "leased")
            : undefined,
          dateLabel: r.soldDateMs ? formatRecordDate(r.soldDateMs) : undefined,
          href: r.href,
          kind: r.dealKind,
          kindLabel: ROW_STATUS_LABEL[r.dealKind],
          mls: r.key,
          brokerage: r.brokerage,
          liveKey: r.liveKey,
          livePrice: r.livePrice,
          liveTransactionType: r.liveTransactionType,
          hasPhoto: r.hasPhoto,
          // Consumer-only; absent on an anonymous response, where the row falls back to
          // the server-side blur.
          thumbUrl: r.thumbUrl,
        },
      });
    }
    // The map row is now UNCONDITIONAL for an address-shaped query. It used to render
    // only when `records.length === 0 && !typedAddressCovered` — i.e. only for addresses
    // we knew nothing about — so the map option vanished the moment a home had any
    // history or a live listing, which is exactly when someone wants to see where it is.
    if (hit) {
      // Name it from the FEED when we have a row for this address; the geocoder answers
      // with its own municipal naming ("Dundas" where the feed says City=Hamilton,
      // CityRegion=Dundas). Only feed vocabulary exists in our region taxonomy and in the
      // /address URLs already in the sitemap, so a geocoder name here would mint a second
      // identity for one home. Geocoder → coordinates; feed → every label. (searchRows.ts)
      const named = records[0] ?? null;
      const feedLabel = named ? localityLabel(named.city, named.cityRegion) : "";
      const placeLabel = named ? `${named.address.split(",")[0]}, ${feedLabel}` : hit.label;
      geo.push({
        id: `geo:${hit.lat},${hit.lng}`,
        category: "geo",
        label: placeLabel,
        sublabel:
          records.length === 0 && !typedAddressCovered
            ? "Not on the market — centre the map here, or view the address profile"
            : "Centre the map here and search this area",
        geo: { lat: hit.lat, lng: hit.lng, zoom: 16 },
        provenance: "geocoded",
      });
    }
  }

  // Re-rank address hits by closeness to the typed string before slicing: Typesense's
  // typo-tolerant order otherwise floats lookalikes (same civic number, wrong street;
  // or a shared street-name word) above the address the user actually typed.
  const rankedAddresses = rankAddressSuggestions(q, addresses, (a) => a.label);

  // Within Listings: an exact MLS# always leads. Then live listings BEFORE history —
  // "what can I buy now" is the commoner intent — except when no active row genuinely
  // matches what was typed. In that case the actives are all fuzzy lookalikes and the
  // record IS the typed address, so it must not sit below them (the original intent of
  // the old record-first ordering, kept but made conditional).
  const actives = rankedAddresses.slice(0, 5);
  const flatListings = typedAddressCovered
    ? [...mls, ...actives, ...soldAddress]
    : [...mls, ...soldAddress, ...actives];
  const listings = stackByProperty(flatListings);

  // Places first: the map exit must never sit below a long list of listings.
  const bySection: Array<[SuggestItem[], SuggestGroup["section"], boolean]> = [
    [[...geo, ...communities.slice(0, 6)], "places", false],
    [listings, "listings", soldAddress.length > 0],
  ];
  return bySection
    .filter(([items]) => items.length > 0)
    .map(([items, section, vow]) => ({ section, title: SECTION_TITLE[section], items, vow }));
}

/**
 * Fold every campaign at one address into a single row.
 *
 * A home that was listed, terminated and relisted arrives here as two or three unrelated
 * rows — different MLS keys, identical address — which reads as several houses on the same
 * lot. The FIRST row for an address becomes the lead (the caller has already ordered live
 * listings ahead of history) and the rest nest underneath as its campaign history.
 *
 * The lead also gains the span label: a relist resets the visible clock, so a 250-day-old
 * home shows as "20 days" on every other portal. Because we stitch the campaigns we can
 * say what actually happened.
 */
export function stackByProperty(items: SuggestItem[]): SuggestItem[] {
  return groupByProperty(items, (i) => i.listing?.UnparsedAddress ?? i.label).map(({ lead, history }) => {
    if (history.length) lead.children = history;
    const campaigns = 1 + history.length;
    if (lead.listing) lead.spanLabel = campaignSpanLabel(lead.listing, campaigns) ?? undefined;
    return lead;
  });
}
