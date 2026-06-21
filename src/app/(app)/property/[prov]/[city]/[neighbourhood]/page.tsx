/**
 * Neighbourhood hub — /property/{prov}/{city}/{neighbourhood} (Phase 2e).
 *
 * One level below the city hub: active For-Sale listings within a single TRREB CityRegion
 * (community), scoped by the city's City-group. Targets the long-tail "homes for sale in
 * {neighbourhood}, {city}" queries (e.g. "homes for sale in the Annex, Toronto") that the
 * city hub is too broad to rank for, and deepens the topical hierarchy
 * (Home → Properties → City → Neighbourhood).
 *
 * ROUTING: this 4-segment /property/... path is also the shape of a descriptive LISTING
 * URL, but src/middleware.ts rewrites those to /properties/{KEY} FIRST (only when the last
 * segment carries an MLS key). A neighbourhood slug has no key, so the middleware falls
 * through and Next routes here. See the middleware + listingPath.extractListingKey.
 *
 * Compliance mirrors the city hub: ≤100 per query (§4), brokerage per card (§6.3c),
 * deemed-reliable + bona-fide notice (§6.3 i/k), active IDX only, deterministic, noindex
 * when thin. Static + 1h revalidate (public, no auth gating). Queries Typesense only.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";
import { Building2 } from "lucide-react";
import { searchListings, type ListingDocument } from "@/lib/typesense/client";
import { PropertyCard } from "@/components/PropertyCard";
import { toCardData } from "@/lib/listings/listingCardData";
import ListingComplianceNotice from "@/components/legal/ListingComplianceNotice";
import { deslugCity } from "@/lib/listings/listingPath";
import { regionsForHoodSlug, cityFilterClause, cityRegionFilterClause } from "@/lib/listings/cityHubs";

export const revalidate = 3600;
export const dynamicParams = true;

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");
const PER_PAGE = 48;
const MIN_INDEXABLE = 3;

/**
 * Resolve a (city, neighbourhood) slug pair → its listings. Filters on the city's
 * City-group AND the matching CityRegion value(s). React-cache deduped across
 * generateMetadata + the page.
 */
const getHood = cache(async (citySlug: string, hoodSlug: string) => {
  const { cities, regions, name } = await regionsForHoodSlug(citySlug, hoodSlug);
  if (cities.length === 0 || regions.length === 0) {
    return { listings: [] as ListingDocument[], totalFound: 0, name: "" };
  }
  try {
    const res = await searchListings({
      query: "*",
      rawFilterBy: `${cityFilterClause(cities)} && ${cityRegionFilterClause(regions)} && TransactionType:=\`For Sale\` && PropertyType:!=Commercial`,
      perPage: PER_PAGE,
      sortBy: "ListPrice",
      sortOrder: "desc",
    });
    return { listings: res.listings, totalFound: res.totalFound, name };
  } catch (err) {
    console.error(`[Neighbourhood] query failed for "${citySlug}/${hoodSlug}":`, err);
    return { listings: [] as ListingDocument[], totalFound: 0, name };
  }
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ prov: string; city: string; neighbourhood: string }>;
}): Promise<Metadata> {
  const { prov, city, neighbourhood } = await params;
  const cityName = deslugCity(city);
  const { totalFound, name } = await getHood(city, neighbourhood);
  const hoodName = name || deslugCity(neighbourhood);
  const canonical = `${SITE_URL}/property/${prov.toLowerCase()}/${city}/${neighbourhood}`;
  const provLabel = prov.toUpperCase();

  const title = `Homes for Sale in ${hoodName}, ${cityName} | PureProperty`;
  const description =
    totalFound > 0
      ? `Browse ${totalFound} active listings for sale in ${hoodName}, ${cityName}, ${provLabel}. Compare prices, beds, baths, and brokerage details on PureProperty.`
      : `Active real estate listings for sale in ${hoodName}, ${cityName}, ${provLabel}.`;

  return {
    metadataBase: new URL(SITE_URL),
    title,
    description,
    alternates: { canonical },
    // Thin neighbourhoods must not be indexed (Google doorway/thin-content policy).
    robots: totalFound >= MIN_INDEXABLE ? undefined : { index: false, follow: true },
    openGraph: { title, description, url: canonical, siteName: "PureProperty", type: "website" },
  };
}

export default async function NeighbourhoodHubPage({
  params,
}: {
  params: Promise<{ prov: string; city: string; neighbourhood: string }>;
}) {
  const { prov, city, neighbourhood } = await params;
  const cityName = deslugCity(city);
  const { listings, totalFound, name } = await getHood(city, neighbourhood);
  const hoodName = name || deslugCity(neighbourhood);
  const canonical = `${SITE_URL}/property/${prov.toLowerCase()}/${city}/${neighbourhood}`;
  const cityHubPath = `/property/${prov.toLowerCase()}/${city}`;
  const provLabel = prov.toUpperCase();

  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
      { "@type": "ListItem", position: 2, name: "Properties", item: `${SITE_URL}/properties` },
      { "@type": "ListItem", position: 3, name: `${cityName}, ${provLabel}`, item: `${SITE_URL}${cityHubPath}` },
      { "@type": "ListItem", position: 4, name: hoodName, item: canonical },
    ],
  };

  return (
    <main className="min-h-app bg-slate-950 text-slate-200">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }} />

      <div className="mx-auto max-w-[1400px] px-4 py-8">
        <nav className="mb-4 text-sm text-slate-500">
          <Link href="/" className="hover:text-cyan-400">Home</Link>
          <span className="mx-2">/</span>
          <Link href="/properties" className="hover:text-cyan-400">Properties</Link>
          <span className="mx-2">/</span>
          <Link href={cityHubPath} className="hover:text-cyan-400">{cityName}</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-300">{hoodName}</span>
        </nav>

        <header className="mb-6">
          <h1 className="text-2xl font-bold text-slate-100 sm:text-3xl">
            Homes for Sale in {hoodName}, {cityName}
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            {totalFound > 0
              ? `${totalFound.toLocaleString()} active ${totalFound === 1 ? "listing" : "listings"} for sale in this ${cityName} neighbourhood`
              : `No active listings for sale in ${hoodName} right now.`}
          </p>
        </header>

        {listings.length > 0 ? (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {listings.map((doc) => (
              <PropertyCard key={doc.id} property={toCardData(doc)} showSaveButton={false} />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-8 text-center text-slate-400">
            <Building2 className="mx-auto mb-3 h-8 w-8 text-slate-600" />
            <p>Nothing active in this neighbourhood at the moment.</p>
            <Link href={cityHubPath} className="mt-3 inline-block text-sm text-cyan-400 hover:text-cyan-300">
              See all homes for sale in {cityName} →
            </Link>
          </div>
        )}

        <div className="mt-8">
          <ListingComplianceNotice />
        </div>
      </div>
    </main>
  );
}
