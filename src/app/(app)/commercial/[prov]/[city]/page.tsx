/**
 * Commercial city hub — /commercial/{prov}/{city} (commercial-gap Phase 2).
 *
 * The commercial counterpart of /property/{prov}/{city}: a server-rendered, crawlable
 * page listing active Commercial-class For-Sale listings in a city. Before this page
 * existed, the ~7k commercial detail pages were sitemap-emitted ORPHANS — indexed and
 * receiving organic traffic, but with zero internal links pointing at them (the
 * residential hub tree excludes PropertyType=Commercial). This hub closes the
 * hub→listing→hub crawl loop for the commercial inventory.
 *
 * Population: COMMERCIAL_ACTIVE_FILTER — the exact inverse of the residential hubs'
 * class clause, so the two trees partition For-Sale inventory without overlap.
 *
 * Compliance: mirrors the residential hub — ≤100 listings per query (§4); brokerage on
 * every card (§6.3c); IDX notice below (§6.3 i/k); active IDX feed only; deterministic
 * (§4); thin hubs (< MIN_INDEXABLE) are noindexed (doorway/thin-content guard).
 */

import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";
import { Building2, Home } from "lucide-react";
import { searchListings, type ListingDocument } from "@/lib/typesense/client";
import { PropertyCard } from "@/components/PropertyCard";
import { toCardData } from "@/lib/listings/listingCardData";
import ListingComplianceNotice from "@/components/legal/ListingComplianceNotice";
import HubFaq from "@/components/seo/HubFaq";
import { deslugCity } from "@/lib/listings/listingPath";
import {
  citiesForHubSlug,
  cityFilterClause,
  COMMERCIAL_ACTIVE_FILTER,
} from "@/lib/listings/cityHubs";
import { ogImageUrl } from "@/lib/og/ogImageUrl";

export const revalidate = 3600; // hourly — public category page, no auth gating
export const dynamicParams = true;

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");
const PER_PAGE = 48; // well under the §4 cap of 100
const MIN_INDEXABLE = 3; // fewer than this → noindex (thin-content / doorway guard)

/**
 * Resolve a hub SLUG → its commercial listings + PropertySubType breakdown, grouping
 * all TRREB City values that normalize to it. Shared by generateMetadata + the page
 * (React-cache deduped). The subtype facet rides the same query for free.
 */
const getCommercialCityHub = cache(async (slug: string) => {
  const { cities } = await citiesForHubSlug(slug, COMMERCIAL_ACTIVE_FILTER);
  if (cities.length === 0) {
    return { listings: [] as ListingDocument[], totalFound: 0, subTypes: {} as Record<string, number> };
  }
  try {
    const res = await searchListings({
      query: "*",
      rawFilterBy: `${cityFilterClause(cities)} && ${COMMERCIAL_ACTIVE_FILTER}`,
      perPage: PER_PAGE,
      sortBy: "ListPrice",
      sortOrder: "desc",
      facetBy: "PropertySubType",
      maxFacetValues: 20,
    });
    return {
      listings: res.listings,
      totalFound: res.totalFound,
      subTypes: (res.facetDistribution?.PropertySubType ?? {}) as Record<string, number>,
    };
  } catch (err) {
    console.error(`[CommercialCityHub] listing query failed for "${slug}":`, err);
    return { listings: [] as ListingDocument[], totalFound: 0, subTypes: {} as Record<string, number> };
  }
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ prov: string; city: string }>;
}): Promise<Metadata> {
  const { prov, city } = await params;
  const cityName = deslugCity(city);
  const { totalFound } = await getCommercialCityHub(city);
  const canonical = `${SITE_URL}/commercial/${prov.toLowerCase()}/${city}`;
  const provLabel = prov.toUpperCase();

  const title = `Commercial Properties for Sale in ${cityName}, ${provLabel} | PureProperty`;
  const description =
    totalFound > 0
      ? `Browse ${totalFound} active commercial listings for sale in ${cityName} — retail, office, industrial and businesses — with prices, areas and brokerage details on PureProperty.`
      : `Active commercial real estate listings for sale in ${cityName}, ${provLabel}.`;

  return {
    metadataBase: new URL(SITE_URL),
    title,
    description,
    alternates: { canonical },
    // Thin hubs must not be indexed (Google doorway/thin-content policy).
    robots: totalFound >= MIN_INDEXABLE ? undefined : { index: false, follow: true },
    openGraph: {
      title,
      description,
      url: canonical,
      siteName: "PureProperty",
      type: "website",
      images: [
        ogImageUrl({
          eyebrow: "Commercial for Sale",
          title: `${cityName}, ${provLabel}`,
          subtitle: "Retail, office, industrial & businesses.",
        }),
      ],
    },
  };
}

export default async function CommercialCityHubPage({
  params,
}: {
  params: Promise<{ prov: string; city: string }>;
}) {
  const { prov, city } = await params;
  const cityName = deslugCity(city);
  const { listings, totalFound, subTypes } = await getCommercialCityHub(city);
  const canonical = `${SITE_URL}/commercial/${prov.toLowerCase()}/${city}`;
  const provLabel = prov.toUpperCase();

  // Busiest-first subtype breakdown (informational chips — the terminal's Commercial
  // toggle is the interactive drill-down; these convey the mix at a glance).
  const subTypeChips = Object.entries(subTypes)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);

  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
      { "@type": "ListItem", position: 2, name: "Properties", item: `${SITE_URL}/properties` },
      { "@type": "ListItem", position: 3, name: `Commercial — ${cityName}, ${provLabel}`, item: canonical },
    ],
  };

  return (
    // Pinned dark in both themes (see /apply for the same reasoning): the page carries no
    // design tokens of its own, so `dark` keeps any token-driven child resolving against
    // the slate ground it actually sits on rather than the app's light default.
    <main className="dark min-h-app bg-slate-950 text-slate-200">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }} />

      <div className="mx-auto max-w-[1400px] px-4 py-8">
        <nav className="mb-4 text-sm text-slate-500">
          <Link href="/" className="hover:text-cyan-400">Home</Link>
          <span className="mx-2">/</span>
          <Link href="/properties" className="hover:text-cyan-400">Properties</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-300">Commercial — {cityName}</span>
        </nav>

        <header className="mb-6">
          <h1 className="text-2xl font-bold text-slate-100 sm:text-3xl">
            Commercial Properties for Sale in {cityName}, {provLabel}
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            {totalFound > 0
              ? `${totalFound.toLocaleString()} active commercial ${totalFound === 1 ? "listing" : "listings"} for sale`
              : `No active commercial listings for sale in ${cityName} right now.`}
          </p>
          {subTypeChips.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {subTypeChips.map(([name, count]) => (
                <span
                  key={name}
                  className="inline-flex items-center gap-1.5 rounded-full border border-slate-800 bg-slate-900/40 px-3 py-1 text-xs text-slate-300"
                >
                  {name}
                  <span className="text-slate-500">{count}</span>
                </span>
              ))}
            </div>
          )}
          {/* Cross-link into the residential tree (the two hub trees partition the
              inventory; interlinking keeps both crawlable from either side). */}
          <div className="mt-3">
            <Link
              href={`/property/${prov.toLowerCase()}/${city}`}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-cyan-400 transition-colors hover:text-cyan-300"
            >
              <Home className="h-4 w-4" /> Homes for sale in {cityName} →
            </Link>
          </div>
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
            <p>Nothing active here at the moment.</p>
            <Link href="/properties" className="mt-3 inline-block text-sm text-cyan-400 hover:text-cyan-300">
              Explore the full map →
            </Link>
          </div>
        )}

        {totalFound > 0 && (
          <HubFaq
            faqs={[
              {
                q: `How many commercial properties are for sale in ${cityName}?`,
                a: `There are currently ${totalFound.toLocaleString()} active commercial listings for sale in ${cityName}, ${provLabel} on PureProperty — retail, office, industrial, investment properties and businesses — refreshed daily from the MLS®.`,
              },
              {
                q: `What types of commercial property are available in ${cityName}?`,
                a: `Active ${cityName} commercial inventory spans ${subTypeChips
                  .slice(0, 4)
                  .map(([name]) => name)
                  .join(", ")} and more, each listing showing total area, zoning or property use, and the listing brokerage.`,
              },
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
