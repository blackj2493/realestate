/**
 * New-construction hub — /lifestyle/{city}/new-construction (Phase 2h).
 *
 * The "new-home / move-in-ready buyer" persona hub: active For-Sale listings whose TRREB
 * ApproximateAge is "New" or "0-5" (built within the last ~5 years), freshest-listed
 * first. Targets "new construction homes {city}" / "newly built homes for sale {city}"
 * queries.
 *
 * ApproximateAge is a standard PUBLIC IDX field (covered by the IDX notice), so the age
 * shows on each card — no velvet rope, and Ontario-wide coverage (unlike the GTA-only
 * amenity data). NEW_BUILD_FILTER MUST stay in sync with the sitemap's filter.
 *
 * Compliance mirrors the other hubs: ≤100 per query (§4), brokerage per card (§6.3c),
 * deemed-reliable + bona-fide notice (§6.3 i/k), active IDX only, deterministic, noindex
 * when thin. Static + 1h revalidate (public, no auth gating).
 */

import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";
import { Sparkles } from "lucide-react";
import { searchListings, type ListingDocument } from "@/lib/typesense/client";
import { PropertyCard, type PropertyCardData } from "@/components/PropertyCard";
import { toCardData } from "@/lib/listings/listingCardData";
import ListingComplianceNotice from "@/components/legal/ListingComplianceNotice";
import { deslugCity } from "@/lib/listings/listingPath";
import { citiesForHubSlug, cityFilterClause } from "@/lib/listings/cityHubs";
import { ogImageUrl } from "@/lib/og/ogImageUrl";

export const revalidate = 3600;
export const dynamicParams = true;

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");
const PER_PAGE = 48;
const MIN_INDEXABLE = 3;
// TRREB ApproximateAge buckets that count as "new construction / newly built".
// KEEP IN SYNC with sitemap.ts.
const NEW_BUILD_FILTER = "(ApproximateAge:=`New` || ApproximateAge:=`0-5`)";

/** Card data + the public age badge (set only here). */
function toNewBuildCardData(doc: ListingDocument): PropertyCardData {
  return { ...toCardData(doc), approximateAge: doc.ApproximateAge };
}

/** Active newly-built listings in the city, freshest-listed first. */
const getNewBuildHub = cache(async (slug: string) => {
  const { cities } = await citiesForHubSlug(slug);
  if (cities.length === 0) return { listings: [] as ListingDocument[], totalFound: 0 };
  try {
    const res = await searchListings({
      query: "*",
      rawFilterBy: `${cityFilterClause(cities)} && TransactionType:=\`For Sale\` && PropertyType:!=Commercial && ${NEW_BUILD_FILTER}`,
      perPage: PER_PAGE,
      sortBy: "EntryTimestamp",
      sortOrder: "desc",
    });
    return { listings: res.listings, totalFound: res.totalFound };
  } catch (err) {
    console.error(`[NewBuildHub] query failed for "${slug}":`, err);
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
  const { totalFound } = await getNewBuildHub(city);
  const canonical = `${SITE_URL}/lifestyle/${city}/new-construction`;

  const title = `New Construction & Newly Built Homes for Sale in ${cityName}, ON | PureProperty`;
  const description =
    totalFound > 0
      ? `${totalFound} new construction and newly built (≤5 yr) homes for sale in ${cityName}, ON. Compare prices, beds, baths, and brokerage details on PureProperty.`
      : `New construction and newly built homes for sale in ${cityName}, ON.`;

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
      images: [ogImageUrl({ eyebrow: "New Construction", title: `${cityName}, ON`, subtitle: "Newly built homes for sale." })],
    },
  };
}

export default async function NewBuildHubPage({
  params,
}: {
  params: Promise<{ city: string }>;
}) {
  const { city } = await params;
  const cityName = deslugCity(city);
  const { listings, totalFound } = await getNewBuildHub(city);
  const canonical = `${SITE_URL}/lifestyle/${city}/new-construction`;
  const cityHubPath = `/property/on/${city}`;

  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
      { "@type": "ListItem", position: 2, name: "Properties", item: `${SITE_URL}/properties` },
      { "@type": "ListItem", position: 3, name: `${cityName}, ON`, item: `${SITE_URL}${cityHubPath}` },
      { "@type": "ListItem", position: 4, name: "New Construction", item: canonical },
    ],
  };

  return (
    <main className="min-h-app bg-slate-950 text-slate-200">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }} />

      <div className="mx-auto max-w-[1400px] px-4 py-8">
        <nav className="mb-4 text-sm text-slate-500">
          <Link href="/properties" className="hover:text-cyan-400">Properties</Link>
          <span className="mx-2">/</span>
          <Link href={cityHubPath} className="hover:text-cyan-400">{cityName}</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-300">New Construction</span>
        </nav>

        <header className="mb-6">
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-100 sm:text-3xl">
            <Sparkles className="h-6 w-6 text-violet-400" />
            New Construction &amp; Newly Built Homes in {cityName}, ON
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            {totalFound > 0
              ? `${totalFound.toLocaleString()} newly built ${totalFound === 1 ? "home" : "homes"} (built new or within ~5 years) — freshest listings first.`
              : `No new construction or newly built listings in ${cityName} right now.`}
          </p>
        </header>

        {listings.length > 0 ? (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {listings.map((doc) => (
              <PropertyCard key={doc.id} property={toNewBuildCardData(doc)} showSaveButton={false} />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-8 text-center text-slate-400">
            <Sparkles className="mx-auto mb-3 h-8 w-8 text-slate-600" />
            <p>No newly built listings here right now.</p>
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
