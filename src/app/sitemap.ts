import type { MetadataRoute } from "next";
import { getServiceRoleClient } from "@/lib/supabase/client";
import {
  cityHubsWithInventory,
  neighbourhoodHubsForSitemap,
  COMMERCIAL_ACTIVE_FILTER,
} from "@/lib/listings/cityHubs";
import { buildListingPath } from "@/lib/listings/listingPath";
import { LIVE_TRACKERS } from "@/lib/data/trackers";
import { LIVE_FINDINGS } from "@/lib/data/findings";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");

// Refresh daily (matches the ETL cadence). NOTE: `listings` is NOT active-only — Query B
// upserts Closed (sold) payloads here, and Terminated/Expired/Suspended rows stay
// frozen-Active — so this sitemap DOES emit their listing URLs. That is safe:
// the listing page resolves the TRUE status and sets robots:noindex for every non-active
// listing (see properties/[id] generateMetadata), so sold/off-market pages are
// discoverable but never indexed, and all VOW numbers (close price, sold DOM) are gated
// at render. If you ever need to stop emitting them entirely, filter here by resolved
// status (anti-join raw_vow_delisted for the frozen-Active terminated rows).
export const revalidate = 86400;

const PAGE = 1000; // PostgREST hard-caps a single response at 1000 rows — must paginate
const MAX_URLS = 45_000; // headroom under the 50k-URL sitemap protocol limit
const HUB_MIN = 5; // don't sitemap a city hub that would render thin (the hub noindexes < 3)

/**
 * Crawlable city-hub URLs (/property/on/{city}) — the internal-link entry points to
 * listings (the Command Center is a client-only WebGL map Googlebot can't crawl).
 * cityHubsWithInventory groups the Typesense City facet by normalized slug, so
 * district-split cities (Toronto C0x, London S/N/E) consolidate into one hub each, with
 * only hubs that clear HUB_MIN active listings emitted. Best-effort ([] on any Typesense
 * failure), so the listing sitemap below is never affected.
 */
async function cityHubRoutes(): Promise<MetadataRoute.Sitemap> {
  // City hubs + the persona hubs (cap-rate investor 2c, top-schools 2d) + the
  // neighbourhood hubs (2e). City/persona hubs are each counted over their OWN
  // sub-population so we never sitemap a hub that would render thin/noindex; the
  // neighbourhood enumeration applies the same >= HUB_MIN floor per (city, region).
  const [cityHubs, capRateHubs, schoolHubs, walkableHubs, newBuildHubs, devHubs, hoodHubs, commercialHubs] = await Promise.all([
    cityHubsWithInventory(HUB_MIN),
    cityHubsWithInventory(HUB_MIN, "ExtrapolatedCapRate:>0"),
    cityHubsWithInventory(HUB_MIN, "BestSchoolScoreNearby:>0"),
    // Walkable filter MUST match the hub page's WALKABLE_KM (most-walkable/page.tsx).
    cityHubsWithInventory(HUB_MIN, "NearestGroceryKm:<=1.5"),
    // New-build filter MUST match NEW_BUILD_FILTER (new-construction/page.tsx).
    cityHubsWithInventory(HUB_MIN, "(ApproximateAge:=`New` || ApproximateAge:=`0-5`)"),
    // Dev filter MUST match PRIME_FILTER (development-potential/page.tsx).
    cityHubsWithInventory(HUB_MIN, "multi_unit_status:=`PRIME_CANDIDATE`"),
    neighbourhoodHubsForSitemap(HUB_MIN),
    // Commercial hub tree (commercial-gap Phase 2) — counted over its OWN population.
    cityHubsWithInventory(HUB_MIN, "", COMMERCIAL_ACTIVE_FILTER),
  ]);
  return [
    ...cityHubs.map(({ slug }) => ({
      url: `${SITE_URL}/property/on/${slug}`,
      changeFrequency: "daily" as const,
      priority: 0.8,
    })),
    ...capRateHubs.map(({ slug }) => ({
      url: `${SITE_URL}/investments/${slug}/highest-cap-rate`,
      changeFrequency: "daily" as const,
      priority: 0.7,
    })),
    ...schoolHubs.map(({ slug }) => ({
      url: `${SITE_URL}/family/${slug}/top-rated-schools`,
      changeFrequency: "daily" as const,
      priority: 0.7,
    })),
    ...walkableHubs.map(({ slug }) => ({
      url: `${SITE_URL}/lifestyle/${slug}/most-walkable`,
      changeFrequency: "daily" as const,
      priority: 0.7,
    })),
    ...newBuildHubs.map(({ slug }) => ({
      url: `${SITE_URL}/lifestyle/${slug}/new-construction`,
      changeFrequency: "daily" as const,
      priority: 0.7,
    })),
    ...devHubs.map(({ slug }) => ({
      url: `${SITE_URL}/investments/${slug}/development-potential`,
      changeFrequency: "daily" as const,
      priority: 0.7,
    })),
    ...hoodHubs.map(({ citySlug, hoodSlug }) => ({
      url: `${SITE_URL}/property/on/${citySlug}/${hoodSlug}`,
      changeFrequency: "daily" as const,
      priority: 0.6,
    })),
    ...commercialHubs.map(({ slug }) => ({
      url: `${SITE_URL}/commercial/on/${slug}`,
      changeFrequency: "daily" as const,
      priority: 0.7,
    })),
  ];
}

/**
 * A listing row, flattened for URL building. The street fields live inside `full_payload`
 * (the table denormalizes only city/sub-type/price), so they are pulled out with
 * PostgREST's `alias:col->>Key` projection rather than by selecting the whole JSONB —
 * 45,000 full payloads would be a needless detoast on every rebuild.
 */
interface ListingSitemapRow {
  listing_key: string | null;
  synced_at: string | null;
  street_number: string | null;
  street_name: string | null;
  street_suffix: string | null;
  street_dir_prefix: string | null;
  street_dir_suffix: string | null;
  unit_number: string | null;
  apartment_number: string | null;
  unparsed_address: string | null;
  payload_city: string | null;
  state_or_province: string | null;
}

const LISTING_SELECT = [
  "listing_key",
  "synced_at",
  "street_number:full_payload->>StreetNumber",
  "street_name:full_payload->>StreetName",
  "street_suffix:full_payload->>StreetSuffix",
  "street_dir_prefix:full_payload->>StreetDirPrefix",
  "street_dir_suffix:full_payload->>StreetDirSuffix",
  "unit_number:full_payload->>UnitNumber",
  "apartment_number:full_payload->>ApartmentNumber",
  "unparsed_address:full_payload->>UnparsedAddress",
  "payload_city:full_payload->>City",
  "state_or_province:full_payload->>StateOrProvince",
].join(", ");

/**
 * The URL to sitemap for one listing — the DESCRIPTIVE canonical
 * (/property/{prov}/{city}/{address}-{KEY}), which is exactly what the listing page's own
 * `alternates.canonical` and JSON-LD emit (see properties/[id] listingCanonical).
 *
 * Before 2026-09-02 this emitted the legacy /properties/{KEY} form instead. Every one of
 * those 45,000 URLs then canonicalised to a path that appeared in NEITHER sitemap, so the
 * whole listing tree was declared under URLs Google is told to discard. Fall back to the
 * legacy path only when the payload cannot form a slug — same fallback the page uses, so
 * the two can never disagree.
 */
function listingPath(row: ListingSitemapRow): string {
  return (
    buildListingPath({
      ListingKey: row.listing_key,
      StreetNumber: row.street_number,
      StreetName: row.street_name,
      StreetSuffix: row.street_suffix,
      StreetDirPrefix: row.street_dir_prefix,
      StreetDirSuffix: row.street_dir_suffix,
      UnitNumber: row.unit_number,
      ApartmentNumber: row.apartment_number,
      UnparsedAddress: row.unparsed_address,
      City: row.payload_city,
      StateOrProvince: row.state_or_province,
    }) ?? `/properties/${row.listing_key}`
  );
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, changeFrequency: "daily", priority: 1 },
    { url: `${SITE_URL}/properties`, changeFrequency: "hourly", priority: 0.9 },
    // /property = the crawlable city directory (top of the hub tree); /properties is the
    // client-only terminal Googlebot can't crawl.
    { url: `${SITE_URL}/property`, changeFrequency: "daily", priority: 0.9 },
  ];

  // Public /data trackers (hub + each live tracker). Aggregate-statistics pages, emitted
  // regardless of DB state (like the static routes).
  const dataRoutes: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/data`, changeFrequency: "daily", priority: 0.8 },
    // The press desk. Rarely changes, but it is the page we point every outreach email at,
    // so it must be indexable and discoverable rather than a hidden landing page.
    { url: `${SITE_URL}/data/for-journalists`, changeFrequency: "monthly", priority: 0.6 },
    ...LIVE_TRACKERS.map((t) => ({
      url: `${SITE_URL}/data/${t.slug}`,
      changeFrequency: "daily" as const,
      priority: 0.7,
    })),
    // Findings: dated analysis built on the trackers. lastModified is the piece's own
    // date rather than "now" — a finding is a snapshot and claiming daily freshness on
    // static analysis is the kind of thing that gets a sitemap discounted.
    { url: `${SITE_URL}/data/findings`, changeFrequency: "weekly", priority: 0.7 },
    ...LIVE_FINDINGS.map((f) => ({
      url: `${SITE_URL}/data/findings/${f.slug}`,
      lastModified: new Date(`${f.updated ?? f.published}T12:00:00Z`),
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
  ];

  const hubRoutes = await cityHubRoutes();

  try {
    const supabase = getServiceRoleClient();
    const rows: ListingSitemapRow[] = [];
    for (let from = 0; rows.length < MAX_URLS; from += PAGE) {
      const { data, error } = await supabase
        .from("listings")
        .select(LISTING_SELECT)
        .order("synced_at", { ascending: false })
        .order("listing_key") // deterministic tie-break so range pagination never skips/dups
        .range(from, from + PAGE - 1);
      if (error || !data) break;
      rows.push(...(data as unknown as ListingSitemapRow[]));
      if (data.length < PAGE) break;
    }

    const listingRoutes: MetadataRoute.Sitemap = rows
      .slice(0, MAX_URLS)
      .filter((row) => row.listing_key)
      .map((row) => ({
        url: `${SITE_URL}${listingPath(row)}`,
        lastModified: row.synced_at ? new Date(row.synced_at) : undefined,
        changeFrequency: "daily" as const,
        priority: 0.7,
      }));

    return [...staticRoutes, ...dataRoutes, ...hubRoutes, ...listingRoutes];
  } catch {
    // Missing env at build / DB unavailable — still emit the static + data + hub routes.
    return [...staticRoutes, ...dataRoutes, ...hubRoutes];
  }
}
