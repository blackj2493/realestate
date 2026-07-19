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
import type { SuggestGroup, SuggestItem } from "./types";

const SALES_FLOOR = "ListPrice:>=100000";
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
  address: "Addresses",
  sold: "Recent solds · nearby",
  community: "Communities",
  school: "Schools",
  geo: "Address",
};

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
    filter_by: SALES_FLOOR,
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

  // 3) Geo fallback — typed address with no matching active listing still resolves.
  //    Fires when it looks like a street address (number + a name word) AND no returned
  //    suggestion GENUINELY matches what was typed — typo-tolerant fuzzy hits
  //    ("758 Coldstream" for "758 cappamore") must not suppress the real address.
  const typedAddressCovered = addresses.some((a) => matchesTypedAddress(q, a.label));
  if (!structured && !typedAddressCovered && /\d+\s+[a-zA-Z]{3,}/.test(q)) {
    const hit = await geocodeAddress(q, signal);
    if (hit) {
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
  // lookalikes, so the geo row renders ABOVE the address group.
  const order: Array<[SuggestItem[], SuggestGroup["category"]]> = [
    [mls, "mls"],
    [geo, "geo"],
    [addresses.slice(0, 5), "address"],
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
