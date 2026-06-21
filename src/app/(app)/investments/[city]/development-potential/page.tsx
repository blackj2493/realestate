/**
 * Builder / development-potential hub — /investments/{city}/development-potential (Phase 2j).
 *
 * The "builder / developer" persona hub (the 4th in the strategy persona map): active
 * For-Sale listings flagged a PRIME multi-unit/density candidate, ranked by lot size
 * (largest first). Targets "development potential {city}" / "multiplex lots {city}" /
 * "development land {city}" developer queries the consumer portals don't serve.
 *
 * VELVET ROPE: the page RANKS by the proprietary multi_unit_status verdict but never
 * renders it — the cards show only public IDX data (price/beds/baths/brokerage + lot
 * size). The multiplex / density analysis is revealed on the listing page behind the VOW
 * signup. multi_unit_status is derived from PUBLIC fields (lot, parking, subtype), so
 * using it as a ranking signal is compliant; we gate the VERDICT, not display public data.
 *
 * Compliance mirrors the cap-rate hub: ≤100 per query (§4), brokerage per card (§6.3c),
 * deemed-reliable + bona-fide notice (§6.3 i/k), active IDX only, deterministic, noindex
 * when thin. Static + 1h revalidate. PRIME_FILTER MUST stay in sync with the sitemap.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";
import { LandPlot, Lock } from "lucide-react";
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
// Proprietary multi-unit verdict used ONLY to filter/rank — never displayed.
// KEEP IN SYNC with sitemap.ts.
const PRIME_FILTER = "multi_unit_status:=`PRIME_CANDIDATE`";

/** Card data + the PUBLIC lot-size badge (the gated verdict is never mapped). */
function toDevCardData(doc: ListingDocument): PropertyCardData {
  return { ...toCardData(doc), lotSqftTotal: doc.LotSqftTotal };
}

/** Active prime-development-candidate listings in the city, biggest lot first. */
const getDevHub = cache(async (slug: string) => {
  const { cities } = await citiesForHubSlug(slug);
  if (cities.length === 0) return { listings: [] as ListingDocument[], totalFound: 0 };
  try {
    const res = await searchListings({
      query: "*",
      rawFilterBy: `${cityFilterClause(cities)} && TransactionType:=\`For Sale\` && PropertyType:!=Commercial && ${PRIME_FILTER}`,
      perPage: PER_PAGE,
      sortBy: "LotSqftTotal",
      sortOrder: "desc",
    });
    return { listings: res.listings, totalFound: res.totalFound };
  } catch (err) {
    console.error(`[DevHub] query failed for "${slug}":`, err);
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
  const { totalFound } = await getDevHub(city);
  const canonical = `${SITE_URL}/investments/${city}/development-potential`;

  const title = `Homes with Development Potential for Sale in ${cityName}, ON | PureProperty`;
  const description =
    totalFound > 0
      ? `${totalFound} ${cityName} properties for sale flagged as prime multi-unit / density candidates, ranked by lot size — for builders and developers.`
      : `Development and multiplex-potential properties for sale in ${cityName}, ON.`;

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
      images: [ogImageUrl({ eyebrow: "Development Potential", title: `${cityName}, ON`, subtitle: "Prime multi-unit & density candidates." })],
    },
  };
}

export default async function DevHubPage({
  params,
}: {
  params: Promise<{ city: string }>;
}) {
  const { city } = await params;
  const cityName = deslugCity(city);
  const { listings, totalFound } = await getDevHub(city);
  const canonical = `${SITE_URL}/investments/${city}/development-potential`;
  const cityHubPath = `/property/on/${city}`;

  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
      { "@type": "ListItem", position: 2, name: "Properties", item: `${SITE_URL}/properties` },
      { "@type": "ListItem", position: 3, name: `${cityName}, ON`, item: `${SITE_URL}${cityHubPath}` },
      { "@type": "ListItem", position: 4, name: "Development Potential", item: canonical },
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
          <span className="text-slate-300">Development Potential</span>
        </nav>

        <header className="mb-6">
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-100 sm:text-3xl">
            <LandPlot className="h-6 w-6 text-orange-400" />
            Homes with Development Potential in {cityName}, ON
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            {totalFound > 0
              ? `${totalFound.toLocaleString()} ${totalFound === 1 ? "property" : "properties"} flagged as prime multi-unit / density candidates — largest lots first.`
              : `No prime development-candidate listings in ${cityName} right now.`}
          </p>
          {totalFound > 0 && (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-slate-800 bg-slate-900/40 px-3 py-1.5 text-xs text-slate-400">
              <Lock className="h-3.5 w-3.5 text-cyan-400" />
              Ranked by our multi-unit / density analysis. Open a listing and sign in to see each property&apos;s development potential.
            </p>
          )}
        </header>

        {listings.length > 0 ? (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {listings.map((doc) => (
              <PropertyCard key={doc.id} property={toDevCardData(doc)} showSaveButton={false} />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-8 text-center text-slate-400">
            <LandPlot className="mx-auto mb-3 h-8 w-8 text-slate-600" />
            <p>No prime development-candidate listings here right now.</p>
            <Link href={cityHubPath} className="mt-3 inline-block text-sm text-cyan-400 hover:text-cyan-300">
              See all homes for sale in {cityName} →
            </Link>
          </div>
        )}

        {totalFound > 0 && (
          <HubFaq
            faqs={[
              { q: `What makes a property a development candidate?`, a: `PureProperty flags properties as prime multi-unit / density candidates based on lot size, parking, and property type. ${totalFound.toLocaleString()} qualify in ${cityName}.` },
              { q: `How can I see the development analysis for a property?`, a: `Open any listing and sign in to see its multi-unit / density potential. This page ranks candidates by lot size, largest first.` },
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
