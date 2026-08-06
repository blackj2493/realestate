/**
 * Address-profile resolution ladder for KEY-LESS /address slugs (ADDRESS_PROFILES_PLAN P1).
 *
 * A key-less slug means a visitor typed/followed an address we have no sold record key
 * for. Instead of 404ing (the old behavior — exactly where a HouseSigma-habituated
 * visitor bounces), resolve it:
 *
 *   1. ACTIVE listing at that address      → redirect to /properties/{id} (IDX, public)
 *   2. SOLD/off-market record (VOW window) → redirect to the keyed, gated /address page
 *   3. Geocode (Mapbox, 24h-cached) or postal-code DB → renderable AddressProfile
 *   4. null → notFound()
 *
 * SERVER-ONLY: step 2 uses the admin sold client (via soldByKey). Steps 1/3 use public
 * keys. Nothing here touches VOW display fields — matching reads UnparsedAddress only.
 */
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { getTypesenseClient } from "@/lib/typesense/client";
import { getSoldPublicByAddress } from "@/lib/sold/soldByKey";
import { parseAddress, addressesMatch } from "@/lib/watchlist/disposition";
import { slugify, deslugCity } from "@/lib/listings/listingPath";
import { loadPostalCodes, getCoordinates } from "@/lib/postalCodes";

export interface AddressProfile {
  /** Display address, e.g. "142 Maplewood Avenue". */
  address: string;
  city: string;
  cityRegion: string | null;
  postal: string | null;
  location: [number, number] | null;
  /** Where the pin came from — shown as the map caption ("approximate" for postal). */
  provenance: "geocoded" | "postal";
}

export type AddressResolution =
  | { kind: "active"; id: string }
  | { kind: "sold"; slug: string }
  | { kind: "profile"; profile: AddressProfile }
  | null;

/** "142-maplewood-avenue" → "142 maplewood avenue" (lowercase working text). */
function slugToStreetText(slug: string): string {
  return decodeURIComponent(slug).replace(/-/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

/** Title-case a street string for display ("142 maplewood avenue" → "142 Maplewood Avenue"). */
function titleCase(s: string): string {
  return s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/**
 * Find a LIVE active listing at this address (public `properties` collection,
 * search-only key). Pattern: watchlist dispositions fetchRelists — free-text
 * UnparsedAddress query then strict addressesMatch.
 */
async function findActiveByAddress(parsed: ReturnType<typeof parseAddress>): Promise<string | null> {
  try {
    const res = await getTypesenseClient()
      .collections("properties")
      .documents()
      .search({
        q: `${parsed.streetNumber} ${parsed.streetName}`.trim(),
        query_by: "UnparsedAddress",
        include_fields: "id,UnparsedAddress,PostalCode",
        per_page: 15,
      });
    for (const h of res.hits ?? []) {
      const d = h.document as { id?: string; UnparsedAddress?: string; PostalCode?: string };
      if (!d.id) continue;
      const cand = parseAddress(d.UnparsedAddress ?? "");
      if (!cand.postal && d.PostalCode) cand.postal = String(d.PostalCode).replace(/\s+/g, "").toUpperCase();
      if (addressesMatch(parsed, cand)) return d.id;
    }
    return null;
  } catch (err) {
    console.error("[resolveProfile] active lookup failed:", err);
    return null;
  }
}

interface GeocodeHit {
  label: string;
  lat: number;
  lng: number;
  postal: string | null;
  city: string | null;
  cityRegion: string | null;
}

/**
 * Server-side forward geocode (Mapbox, Ontario-biased). 24h-cached per query so repeat
 * visits to the same profile URL don't re-hit Mapbox (short-lived cache only — no
 * persistent storage of geocode results). Accepts ONLY rooftop address features (the
 * feature must carry a civic number); a city/street-level match is not a profile.
 */
export const geocodeCached = unstable_cache(
  async (query: string): Promise<GeocodeHit | null> => {
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token || token === "your-mapbox-token") return null;
    try {
      const url =
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json` +
        `?access_token=${token}&country=ca&types=address&limit=1&language=en&proximity=-79.3832,43.6532`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = (await res.json()) as {
        features?: Array<{
          place_type?: string[];
          address?: string;
          text?: string;
          place_name?: string;
          center?: [number, number];
          context?: Array<{ id: string; text: string }>;
        }>;
      };
      const f = data.features?.[0];
      if (!f?.center || !f.place_type?.includes("address") || !f.address) return null;
      const ctx = (prefix: string) => f.context?.find((c) => c.id.startsWith(prefix))?.text ?? null;
      return {
        label: `${f.address} ${f.text ?? ""}`.trim(),
        lat: f.center[1],
        lng: f.center[0],
        postal: ctx("postcode")?.replace(/\s+/g, "").toUpperCase() ?? null,
        city: ctx("place"),
        cityRegion: ctx("neighborhood") ?? ctx("locality"),
      };
    } catch (err) {
      console.error("[resolveProfile] geocode failed:", err);
      return null;
    }
  },
  ["address-profile-geocode"],
  { revalidate: 86_400 }
);

/**
 * Resolve a key-less /address/{prov}/{city}/{slug}. React-cached so generateMetadata and
 * the page render share one resolution per request.
 */
export const resolveAddressSlug = cache(async (citySlug: string, slug: string): Promise<AddressResolution> => {
  const street = slugToStreetText(slug);
  // An address needs a civic number — anything else ("foo-bar") is not resolvable.
  if (!/^\d/.test(street)) return null;

  const cityName = deslugCity(citySlug);
  const cityHint = cityName.toLowerCase() === "ontario" ? "" : cityName;
  const parsed = parseAddress(cityHint ? `${street}, ${cityHint}` : street);
  if (!parsed.streetNumber || !parsed.streetName) return null;

  // 1. Live active listing → the listing page is strictly better than any profile.
  const activeId = await findActiveByAddress(parsed);
  if (activeId) return { kind: "active", id: activeId };

  // 2. Sold/off-market record → canonical keyed page (existing VOW-gated flow).
  const sold = await getSoldPublicByAddress(parsed);
  if (sold) {
    const streetSlug = slugify(sold.address.split(",")[0] ?? "");
    return { kind: "sold", slug: streetSlug ? `${streetSlug}-${sold.id}` : sold.id };
  }

  // 3. Geocode → renderable profile.
  const geo = await geocodeCached([street, cityHint || null, "Ontario"].filter(Boolean).join(", "));
  if (geo) {
    // City-less query ("10 king st"): the active/sold match above couldn't verify a city,
    // so re-run the ladder with the geocoded city/postal before settling for a profile —
    // an address that IS on the market must land on its listing page.
    if (!cityHint && (geo.city || geo.postal)) {
      const parsed2 = { ...parsed, city: (geo.city ?? "").toLowerCase(), postal: geo.postal ?? parsed.postal };
      const activeId2 = await findActiveByAddress(parsed2);
      if (activeId2) return { kind: "active", id: activeId2 };
      const sold2 = await getSoldPublicByAddress(parsed2);
      if (sold2) {
        const streetSlug = slugify(sold2.address.split(",")[0] ?? "");
        return { kind: "sold", slug: streetSlug ? `${streetSlug}-${sold2.id}` : sold2.id };
      }
    }
    return {
      kind: "profile",
      profile: {
        address: titleCase(geo.label || street),
        city: geo.city || cityHint || "Ontario",
        cityRegion: geo.cityRegion,
        postal: geo.postal,
        location: [geo.lat, geo.lng],
        provenance: "geocoded",
      },
    };
  }

  // 3b. Postal fallback — the slug itself carried a postal code we can centroid.
  if (parsed.postal) {
    loadPostalCodes();
    const coords = getCoordinates(parsed.postal);
    if (coords) {
      return {
        kind: "profile",
        profile: {
          address: titleCase(street.replace(/\s*[a-z]\d[a-z]\s?\d[a-z]\d\s*$/i, "").trim()),
          city: cityHint || "Ontario",
          cityRegion: null,
          postal: parsed.postal,
          location: [coords.lat, coords.lng],
          provenance: "postal",
        },
      };
    }
  }

  return null;
});
