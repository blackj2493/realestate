/**
 * Investor hub — /investments/{city}/highest-cap-rate (Phase 2c).
 *
 * The "Cashflow Investor" persona hub: active For-Sale listings in a city, filtered to
 * those with a computed cap rate and SORTED by it (highest first). Targets the
 * zero-competition "highest cap rate {city}" investor query that the consumer portals
 * don't serve.
 *
 * VELVET ROPE: the page ranks BY cap rate but never renders the number — the cards are
 * the same public IDX cards as the city hub (price/beds/baths/brokerage). The actual
 * yield is revealed on the listing page behind the VOW signup, so the proprietary metric
 * never enters public HTML (not even blurred). The hub is the SEO funnel; the reveal is
 * the conversion.
 *
 * Compliance mirrors the city hub: ≤100 per query (§4), brokerage per card (§6.3c),
 * deemed-reliable + bona-fide notice (§6.3 i/k), active IDX only, deterministic, noindex
 * when thin. Static + 1h revalidate (public, no auth gating).
 */

import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";
import { TrendingUp, Lock } from "lucide-react";
import { searchListings, type ListingDocument } from "@/lib/typesense/client";
import { PropertyCard } from "@/components/PropertyCard";
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

/** Active listings in the city WITH a computed cap rate, ranked highest-first. */
const getCapRateHub = cache(async (slug: string) => {
  const { cities } = await citiesForHubSlug(slug);
  if (cities.length === 0) return { listings: [] as ListingDocument[], totalFound: 0 };
  try {
    const res = await searchListings({
      query: "*",
      rawFilterBy: `${cityFilterClause(cities)} && TransactionType:=\`For Sale\` && PropertyType:!=Commercial && ExtrapolatedCapRate:>0`,
      perPage: PER_PAGE,
      sortBy: "ExtrapolatedCapRate",
      sortOrder: "desc",
    });
    return { listings: res.listings, totalFound: res.totalFound };
  } catch (err) {
    console.error(`[CapRateHub] query failed for "${slug}":`, err);
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
  const { totalFound } = await getCapRateHub(city);
  const canonical = `${SITE_URL}/investments/${city}/highest-cap-rate`;

  const title = `Highest Cap Rate Homes for Sale in ${cityName}, ON | PureProperty`;
  const description =
    totalFound > 0
      ? `${totalFound} ${cityName} properties for sale ranked by estimated cap rate — the highest-yield listings for cash-flow investors.`
      : `Cash-flow investment properties for sale in ${cityName}, ON, ranked by estimated cap rate.`;

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
      images: [ogImageUrl({ eyebrow: "Highest Cap Rate", title: `${cityName}, ON`, subtitle: "Investment properties ranked by estimated yield." })],
    },
  };
}

export default async function CapRateHubPage({
  params,
}: {
  params: Promise<{ city: string }>;
}) {
  const { city } = await params;
  const cityName = deslugCity(city);
  const { listings, totalFound } = await getCapRateHub(city);
  const canonical = `${SITE_URL}/investments/${city}/highest-cap-rate`;
  const cityHubPath = `/property/on/${city}`;

  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
      { "@type": "ListItem", position: 2, name: "Properties", item: `${SITE_URL}/properties` },
      { "@type": "ListItem", position: 3, name: `${cityName}, ON`, item: `${SITE_URL}${cityHubPath}` },
      { "@type": "ListItem", position: 4, name: "Highest Cap Rate", item: canonical },
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
          <span className="text-slate-300">Highest Cap Rate</span>
        </nav>

        <header className="mb-6">
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-100 sm:text-3xl">
            <TrendingUp className="h-6 w-6 text-emerald-400" />
            Highest Cap Rate Homes for Sale in {cityName}, ON
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            {totalFound > 0
              ? `${totalFound.toLocaleString()} ${totalFound === 1 ? "property" : "properties"} ranked by estimated cap rate — highest yield first.`
              : `No cash-flow listings with a computed cap rate in ${cityName} right now.`}
          </p>
          {totalFound > 0 && (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-slate-800 bg-slate-900/40 px-3 py-1.5 text-xs text-slate-400">
              <Lock className="h-3.5 w-3.5 text-cyan-400" />
              Ranked by our estimated cap rate. Open a listing and sign in to see each property&apos;s projected yield.
            </p>
          )}
        </header>

        {listings.length > 0 ? (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {listings.map((doc) => (
              <PropertyCard key={doc.id} property={toCardData(doc)} showSaveButton={false} />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-8 text-center text-slate-400">
            <p>No ranked cash-flow listings here right now.</p>
            <Link href={cityHubPath} className="mt-3 inline-block text-sm text-cyan-400 hover:text-cyan-300">
              See all homes for sale in {cityName} →
            </Link>
          </div>
        )}

        {totalFound > 0 && (
          <HubFaq
            faqs={[
              { q: `What is a cap rate?`, a: `A capitalization (cap) rate estimates a rental property's annual return as a percentage of its price. A higher cap rate generally signals stronger cash-flow potential.` },
              { q: `How does PureProperty rank cap-rate homes in ${cityName}?`, a: `PureProperty estimates each ${cityName} property's cap rate from its list price and market rent, then ranks them highest-first. Open a listing and sign in to see its projected yield.` },
              { q: `How many cash-flow properties are for sale in ${cityName}?`, a: `${totalFound.toLocaleString()} ${cityName} properties with a computed cap rate are currently listed for sale on PureProperty.` },
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
