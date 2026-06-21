/**
 * City hub — /property/{prov}/{city} (Phase 2a).
 *
 * Server-rendered, crawlable HTML page listing active For-Sale listings in a city,
 * each linking to its listing page. This is the crawl path Googlebot lacks today (the
 * Command Center is a client-only WebGL map), AND it targets "homes for sale in {city}"
 * searches the address pages can't.
 *
 * Public + anon-only → statically generated + revalidated (no per-request auth, unlike
 * the listing page). Queries Typesense exclusively (CLAUDE.md §3B/§5).
 *
 * Compliance: ≤100 listings per query (§4); each card shows the listing brokerage in the
 * same size as other details (§6.3c, baked into PropertyCard); the IDX deemed-reliable +
 * bona-fide notice renders below (§6.3 i/k); active IDX feed data only; deterministic
 * (no LLM, §4); thin hubs (< MIN_INDEXABLE listings) are noindexed to avoid doorway/thin
 * pages.
 *
 * NOTE (2a scope): city is matched by de-slugifying the URL to the TRREB City value, so
 * only clean single-token cities (London, Brampton, …) resolve. Toronto's district codes
 * ("Toronto C06") need the normalized CitySlug field added in 2b to consolidate.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";
import { Building2, TrendingUp, GraduationCap, Footprints, Sparkles, LandPlot } from "lucide-react";
import { searchListings, type ListingDocument } from "@/lib/typesense/client";
import { PropertyCard } from "@/components/PropertyCard";
import { toCardData } from "@/lib/listings/listingCardData";
import ListingComplianceNotice from "@/components/legal/ListingComplianceNotice";
import HubFaq from "@/components/seo/HubFaq";
import { deslugCity } from "@/lib/listings/listingPath";
import { citiesForHubSlug, cityFilterClause, neighbourhoodsForCity } from "@/lib/listings/cityHubs";
import { ogImageUrl } from "@/lib/og/ogImageUrl";

export const revalidate = 3600; // hourly — public category page, no auth gating
export const dynamicParams = true;

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");
const PER_PAGE = 48; // well under the §4 cap of 100
const MIN_INDEXABLE = 3; // fewer than this → noindex (thin-content / doorway guard)

/**
 * Resolve a hub SLUG → its listings, grouping all TRREB City values that normalize to it
 * (so /property/on/toronto gathers every "Toronto C0x"/"W0x" district). Shared by
 * generateMetadata + the page (React-cache deduped).
 */
const getCityHub = cache(async (slug: string) => {
  const { cities } = await citiesForHubSlug(slug);
  if (cities.length === 0) return { listings: [] as ListingDocument[], totalFound: 0 };
  try {
    const res = await searchListings({
      query: "*",
      rawFilterBy: `${cityFilterClause(cities)} && TransactionType:=\`For Sale\` && PropertyType:!=Commercial`,
      perPage: PER_PAGE,
      sortBy: "ListPrice",
      sortOrder: "desc",
    });
    return { listings: res.listings, totalFound: res.totalFound };
  } catch (err) {
    console.error(`[CityHub] listing query failed for "${slug}":`, err);
    return { listings: [] as ListingDocument[], totalFound: 0 };
  }
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ prov: string; city: string }>;
}): Promise<Metadata> {
  const { prov, city } = await params;
  const cityName = deslugCity(city);
  const { totalFound } = await getCityHub(city);
  const canonical = `${SITE_URL}/property/${prov.toLowerCase()}/${city}`;
  const provLabel = prov.toUpperCase();

  const title = `Homes for Sale in ${cityName}, ${provLabel} | PureProperty`;
  const description =
    totalFound > 0
      ? `Browse ${totalFound} active ${cityName} listings for sale. Compare prices, beds, baths, and brokerage details on PureProperty.`
      : `Active real estate listings for sale in ${cityName}, ${provLabel}.`;

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
          eyebrow: "Homes for Sale",
          title: `${cityName}, ${provLabel}`,
          subtitle: "Listings, schools, walkability & investment potential.",
        }),
      ],
    },
  };
}

export default async function CityHubPage({
  params,
}: {
  params: Promise<{ prov: string; city: string }>;
}) {
  const { prov, city } = await params;
  const cityName = deslugCity(city);
  const { listings, totalFound } = await getCityHub(city);
  const canonical = `${SITE_URL}/property/${prov.toLowerCase()}/${city}`;
  const provLabel = prov.toUpperCase();

  // Crawlable links to this city's neighbourhood hubs (CityRegion breakout). Only those
  // clearing MIN_INDEXABLE are linked, so we never point internal links at thin/noindex
  // pages. Best-effort: [] on any Typesense failure (the city hub still renders).
  const neighbourhoods = (await neighbourhoodsForCity(city)).filter((n) => n.count >= MIN_INDEXABLE);

  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
      { "@type": "ListItem", position: 2, name: "Properties", item: `${SITE_URL}/properties` },
      { "@type": "ListItem", position: 3, name: `${cityName}, ${provLabel}`, item: canonical },
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
          <span className="text-slate-300">{cityName}</span>
        </nav>

        <header className="mb-6">
          <h1 className="text-2xl font-bold text-slate-100 sm:text-3xl">
            Homes for Sale in {cityName}, {provLabel}
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            {totalFound > 0
              ? `${totalFound.toLocaleString()} active ${totalFound === 1 ? "listing" : "listings"} for sale`
              : `No active listings for sale in ${cityName} right now.`}
          </p>
          {totalFound > 0 && (
            <div className="mt-2 flex flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:gap-x-5 sm:gap-y-1.5">
              <Link
                href={`/investments/${city}/highest-cap-rate`}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-400 transition-colors hover:text-emerald-300"
              >
                <TrendingUp className="h-4 w-4" /> Highest cap-rate investments in {cityName} →
              </Link>
              <Link
                href={`/family/${city}/top-rated-schools`}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-400 transition-colors hover:text-emerald-300"
              >
                <GraduationCap className="h-4 w-4" /> Homes near top-rated schools in {cityName} →
              </Link>
              <Link
                href={`/lifestyle/${city}/most-walkable`}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-sky-400 transition-colors hover:text-sky-300"
              >
                <Footprints className="h-4 w-4" /> Most walkable homes in {cityName} →
              </Link>
              <Link
                href={`/lifestyle/${city}/new-construction`}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-violet-400 transition-colors hover:text-violet-300"
              >
                <Sparkles className="h-4 w-4" /> New construction in {cityName} →
              </Link>
              <Link
                href={`/investments/${city}/development-potential`}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-orange-400 transition-colors hover:text-orange-300"
              >
                <LandPlot className="h-4 w-4" /> Development potential in {cityName} →
              </Link>
            </div>
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
            <Building2 className="mx-auto mb-3 h-8 w-8 text-slate-600" />
            <p>Nothing active here at the moment.</p>
            <Link href="/properties" className="mt-3 inline-block text-sm text-cyan-400 hover:text-cyan-300">
              Explore the full map →
            </Link>
          </div>
        )}

        {neighbourhoods.length > 0 && (
          <section className="mt-10" aria-labelledby="hoods-heading">
            <h2 id="hoods-heading" className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-300">
              Browse {cityName} by neighbourhood
            </h2>
            <div className="flex flex-wrap gap-2">
              {neighbourhoods.map((n) => (
                <Link
                  key={n.slug}
                  href={`/property/${prov.toLowerCase()}/${city}/${n.slug}`}
                  className="inline-flex items-center gap-1.5 rounded-full border border-slate-800 bg-slate-900/40 px-3 py-1.5 text-sm text-slate-300 transition-colors hover:border-cyan-500/40 hover:text-cyan-300"
                >
                  {n.name}
                  <span className="text-xs text-slate-500">{n.count}</span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {totalFound > 0 && (
          <HubFaq
            faqs={[
              { q: `How many homes are for sale in ${cityName}?`, a: `There are currently ${totalFound.toLocaleString()} active homes for sale in ${cityName}, ${provLabel} on PureProperty, refreshed daily from the MLS®.` },
              { q: `How can I find investment properties in ${cityName}?`, a: `PureProperty ranks ${cityName} listings by estimated cap rate so cash-flow investors can find the highest-yield homes, and flags properties with multi-unit development potential.` },
              { q: `How do I find homes near top-rated schools in ${cityName}?`, a: `PureProperty's ${cityName} school view ranks homes by the rating of nearby schools, using the PureProperty School Score derived from EQAO (Government of Ontario) data.` },
              { q: `Which ${cityName} homes are the most walkable?`, a: `PureProperty ranks ${cityName} homes by walking distance to grocery stores so you can find the most walkable listings.` },
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
