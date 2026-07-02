/**
 * Walkability hub — /lifestyle/{city}/most-walkable (Phase 2g).
 *
 * The "lifestyle / walkable buyer" persona hub: active For-Sale listings in a city,
 * filtered to those within a short walk of a grocery store and SORTED by that distance
 * (closest first). Targets "walkable homes in {city}" / "homes near grocery stores {city}"
 * lifestyle queries.
 *
 * NOT velvet-rope. Amenity proximity is PUBLIC open data (Overture Maps / OpenStreetMap),
 * already shown un-gated on the listing page (NearbyAmenities) — so the hub shows the
 * grocery distance on each card, with the same attribution + "straight-line, not walking
 * distance" caveat.
 *
 * Walkable cutoff: NearestGroceryKm <= WALKABLE_KM. The field is the real straight-line km
 * up to MAX_AMENITY_KM (15), else the NO_AMENITY_KM (99) sentinel — so a tight cutoff is
 * required (a bare `< 99` would include homes 15 km from a grocery). MUST stay in sync
 * with the sitemap's walkable filter.
 *
 * COVERAGE: the amenity dataset (data/gta-amenities.json) is GTA-scoped, so listings in
 * non-GTA cities resolve to the 99 sentinel — their hubs render empty + noindex, and the
 * sitemap only lists cities with real walkable inventory. Extending the dataset
 * Ontario-wide (build-amenities-dataset.ts) would light up the rest. The city-hub link to
 * this hub is unconditional (like the investor/school links); for non-GTA cities it lands
 * on the graceful empty state.
 *
 * Compliance mirrors the other hubs: ≤100 per query (§4), brokerage per card (§6.3c),
 * deemed-reliable + bona-fide notice (§6.3 i/k), active IDX only, deterministic, noindex
 * when thin. Static + 1h revalidate (public, no auth gating).
 */

import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";
import { Footprints } from "lucide-react";
import { searchListings, type ListingDocument } from "@/lib/typesense/client";
import { PropertyCard, type PropertyCardData } from "@/components/PropertyCard";
import { toCardData } from "@/lib/listings/listingCardData";
import ListingComplianceNotice from "@/components/legal/ListingComplianceNotice";
import HubFaq from "@/components/seo/HubFaq";
import { deslugCity } from "@/lib/listings/listingPath";
import { citiesForHubSlug, cityFilterClause } from "@/lib/listings/cityHubs";
import { ogImageUrl } from "@/lib/og/ogImageUrl";

export const revalidate = 3600;
export const dynamicParams = true;

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");
const PER_PAGE = 48;
const MIN_INDEXABLE = 3;
// Walkable = grocery within this many km (~18-min walk). KEEP IN SYNC with sitemap.ts.
const WALKABLE_KM = 1.5;

/** Card data + the public grocery-proximity badge (set only here). */
function toWalkableCardData(doc: ListingDocument): PropertyCardData {
  return { ...toCardData(doc), nearestGroceryKm: doc.NearestGroceryKm };
}

/** Active listings within WALKABLE_KM of a grocery, ranked closest-first. */
const getWalkableHub = cache(async (slug: string) => {
  const { cities } = await citiesForHubSlug(slug);
  if (cities.length === 0) return { listings: [] as ListingDocument[], totalFound: 0 };
  try {
    const res = await searchListings({
      query: "*",
      rawFilterBy: `${cityFilterClause(cities)} && TransactionType:=\`For Sale\` && PropertyType:!=Commercial && NearestGroceryKm:<=${WALKABLE_KM}`,
      perPage: PER_PAGE,
      sortBy: "NearestGroceryKm",
      sortOrder: "asc",
    });
    return { listings: res.listings, totalFound: res.totalFound };
  } catch (err) {
    console.error(`[WalkableHub] query failed for "${slug}":`, err);
    return { listings: [] as ListingDocument[], totalFound: 0 };
  }
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ city: string }>;
}): Promise<Metadata> {
  const { city } = await params;
  const cityName = deslugCity(city);
  const { totalFound } = await getWalkableHub(city);
  const canonical = `${SITE_URL}/lifestyle/${city}/most-walkable`;

  const title = `Most Walkable Homes for Sale in ${cityName}, ON | PureProperty`;
  const description =
    totalFound > 0
      ? `${totalFound} ${cityName} homes for sale within a short walk of a grocery store, ranked closest-first. Compare prices, beds, baths, and brokerage details.`
      : `Walkable homes for sale in ${cityName}, ON, ranked by distance to the nearest grocery store.`;

  return {
    metadataBase: new URL(SITE_URL),
    title,
    description,
    alternates: { canonical },
    robots: totalFound >= MIN_INDEXABLE ? undefined : { index: false, follow: true },
    openGraph: {
      title,
      description,
      url: canonical,
      siteName: "PureProperty",
      type: "website",
      images: [ogImageUrl({ eyebrow: "Most Walkable", title: `${cityName}, ON`, subtitle: "Homes within a short walk of groceries." })],
    },
  };
}

export default async function WalkableHubPage({
  params,
}: {
  params: Promise<{ city: string }>;
}) {
  const { city } = await params;
  const cityName = deslugCity(city);
  const { listings, totalFound } = await getWalkableHub(city);
  const canonical = `${SITE_URL}/lifestyle/${city}/most-walkable`;
  const cityHubPath = `/property/on/${city}`;

  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
      { "@type": "ListItem", position: 2, name: "Properties", item: `${SITE_URL}/properties` },
      { "@type": "ListItem", position: 3, name: `${cityName}, ON`, item: `${SITE_URL}${cityHubPath}` },
      { "@type": "ListItem", position: 4, name: "Most Walkable", item: canonical },
    ],
  };

  return (
    <main className="min-h-app bg-background text-foreground">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }} />

      <div className="mx-auto max-w-[1400px] px-4 py-8">
        <nav className="mb-4 text-sm text-muted-foreground">
          <Link href="/properties" className="hover:text-cyan-400">Properties</Link>
          <span className="mx-2">/</span>
          <Link href={cityHubPath} className="hover:text-cyan-400">{cityName}</Link>
          <span className="mx-2">/</span>
          <span className="text-foreground">Most Walkable</span>
        </nav>

        <header className="mb-6">
          <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground sm:text-3xl">
            <Footprints className="h-6 w-6 text-sky-400" />
            Most Walkable Homes for Sale in {cityName}, ON
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {totalFound > 0
              ? `${totalFound.toLocaleString()} ${totalFound === 1 ? "home" : "homes"} within a short walk of a grocery store — closest first.`
              : `No walkable listings (grocery within ${WALKABLE_KM} km) in ${cityName} right now.`}
          </p>
        </header>

        {listings.length > 0 ? (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {listings.map((doc) => (
              <PropertyCard key={doc.id} property={toWalkableCardData(doc)} showSaveButton={false} />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-card/40 p-8 text-center text-muted-foreground">
            <Footprints className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <p>No walkable listings here right now.</p>
            <Link href={cityHubPath} className="mt-3 inline-block text-sm text-cyan-400 hover:text-cyan-300">
              See all homes for sale in {cityName} →
            </Link>
          </div>
        )}

        {/* Amenity-data attribution + caveat — mirrors the listing page's NearbyAmenities. */}
        {totalFound > 0 && (
          <p className="mt-6 text-[11px] leading-relaxed text-muted-foreground">
            Ranked by straight-line distance to the nearest grocery store. Places ©
            OpenStreetMap contributors, © Overture Maps Foundation. Distances are
            straight-line, not walking distance. Open a listing to see all nearby groceries
            and recreation.
          </p>
        )}

        {totalFound > 0 && (
          <HubFaq
            faqs={[
              { q: `What makes a home "walkable" on PureProperty?`, a: `PureProperty flags homes within a short walk (about 1.5 km) of a grocery store and ranks them closest-first. ${totalFound.toLocaleString()} ${cityName} homes currently qualify.` },
              { q: `How is walking distance measured?`, a: `As straight-line distance to the nearest grocery store (Overture Maps / OpenStreetMap), not exact walking-route distance.` },
            ]}
          />
        )}

        <div className="mt-8">
          <ListingComplianceNotice />
        </div>
      </div>
    </main>
  );
}
