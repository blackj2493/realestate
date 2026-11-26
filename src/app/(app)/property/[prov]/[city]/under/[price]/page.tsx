/**
 * Price-band hub — /property/{prov}/{city}/under/{band}: "homes for sale in {city} under
 * $1 million". Same pattern as the city hub (src/app/(app)/property/[prov]/[city]/page.tsx):
 * server-rendered, hourly revalidate, Typesense only, ≤ PER_PAGE cards, IDX notice, thin pages
 * noindexed. The band and filter come from src/lib/listings/priceBands.ts, shared with the
 * sitemap so both count the same homes.
 *
 * Active IDX listings only; no sold data. Deterministic copy.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";
import { notFound } from "next/navigation";
import { Building2 } from "lucide-react";
import { searchListings, type ListingDocument } from "@/lib/typesense/client";
import { PropertyCard } from "@/components/PropertyCard";
import { toCardData } from "@/lib/listings/listingCardData";
import ListingComplianceNotice from "@/components/legal/ListingComplianceNotice";
import HubFaq from "@/components/seo/HubFaq";
import CityTopicLinks from "@/components/seo/CityTopicLinks";
import { deslugCity } from "@/lib/listings/listingPath";
import { citiesForHubSlug, cityFilterClause } from "@/lib/listings/cityHubs";
import { PRICE_BANDS, groupSubTypes, priceBandBySlug, priceBandFilter, priceBandPath } from "@/lib/listings/priceBands";
import { ogImageUrl } from "@/lib/og/ogImageUrl";
import { metaDescription } from "@/lib/seo/metaDescription";

export const revalidate = 3600;
export const dynamicParams = true;

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");
const PER_PAGE = 48;
const MIN_INDEXABLE = 3;

const getBand = cache(async (citySlug: string, bandSlug: string) => {
  const band = priceBandBySlug(bandSlug);
  if (!band) return null;
  const { cities } = await citiesForHubSlug(citySlug);
  if (cities.length === 0) return { band, cities, listings: [] as ListingDocument[], totalFound: 0, allFound: 0, groups: null };
  const base = `${cityFilterClause(cities)} && TransactionType:=\`For Sale\` && PropertyType:!=Commercial`;
  try {
    const [res, all] = await Promise.all([
      searchListings({ query: "*", rawFilterBy: `${base} && ${priceBandFilter(band)}`, perPage: PER_PAGE, sortBy: "ListPrice", sortOrder: "desc", facetBy: "PropertySubType", maxFacetValues: 40 }),
      searchListings({ query: "*", rawFilterBy: base, perPage: 0, countOnly: true }),
    ]);
    return {
      band,
      cities,
      listings: res.listings,
      totalFound: res.totalFound,
      allFound: all.totalFound,
      groups: groupSubTypes(res.facetDistribution?.PropertySubType ?? {}),
    };
  } catch (err) {
    console.error(`[PriceBand] query failed for "${citySlug}" ${bandSlug}:`, err);
    return { band, cities, listings: [] as ListingDocument[], totalFound: 0, allFound: 0, groups: null };
  }
});

export async function generateMetadata({ params }: { params: Promise<{ prov: string; city: string; price: string }> }): Promise<Metadata> {
  const { prov, city, price } = await params;
  const data = await getBand(city, price);
  if (!data) return {};
  const cityName = deslugCity(city);
  const canonical = `${SITE_URL}${priceBandPath(city, data.band, prov.toLowerCase())}`;
  const title = `Homes for Sale in ${cityName} Under ${data.band.label}${data.totalFound ? ` (${data.totalFound.toLocaleString("en-CA")} Listings)` : ""} | PureProperty`;
  const description =
    data.totalFound > 0
      ? `${data.totalFound.toLocaleString("en-CA")} homes for sale in ${cityName} at ${data.band.words} or less, refreshed daily from the MLS®. Detached, townhouses and condos, highest price first.`
      : `Homes for sale in ${cityName} under ${data.band.words}.`;
  return {
    metadataBase: new URL(SITE_URL),
    title,
    description: metaDescription(description),
    alternates: { canonical },
    robots: data.totalFound >= MIN_INDEXABLE ? undefined : { index: false, follow: true },
    openGraph: {
      title,
      description: metaDescription(description),
      url: canonical,
      siteName: "PureProperty",
      type: "website",
      images: [ogImageUrl({ eyebrow: "Homes for sale", title: `${cityName} under ${data.band.label}`, subtitle: "Active MLS® listings, refreshed daily." })],
    },
  };
}

export default async function PriceBandPage({ params }: { params: Promise<{ prov: string; city: string; price: string }> }) {
  const { prov, city, price } = await params;
  const data = await getBand(city, price);
  if (!data) notFound();
  const { band, listings, totalFound, allFound, groups } = data;
  const cityName = deslugCity(city);
  const p = prov.toLowerCase();
  const canonical = `${SITE_URL}${priceBandPath(city, band, p)}`;
  const share = allFound > 0 ? Math.round((totalFound / allFound) * 100) : null;
  const parts = groups
    ? ([
        ["detached houses", groups.detached],
        ["semi-detached houses and townhouses", groups.semiTown],
        ["condo townhouses", groups.condoTown],
        ["condo apartments", groups.condoApt],
      ] as const).filter(([, n]) => n > 0)
    : [];
  const mix = parts.length ? `${parts.map(([l, n]) => `${n.toLocaleString("en-CA")} ${l}`).join(", ")}` : null;
  const summary =
    totalFound > 0
      ? `${totalFound.toLocaleString("en-CA")} homes for sale in ${cityName} are listed at ${band.words} or less${share != null ? ` (${share}% of all homes for sale there)` : ""}${mix ? `: ${mix}` : ""}.`
      : `No homes are listed in ${cityName} at ${band.words} or less right now.`;

  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
      { "@type": "ListItem", position: 2, name: "Properties", item: `${SITE_URL}/properties` },
      { "@type": "ListItem", position: 3, name: cityName, item: `${SITE_URL}/property/${p}/${city}` },
      { "@type": "ListItem", position: 4, name: `Under ${band.label}`, item: canonical },
    ],
  };

  return (
    <main className="min-h-app bg-background text-foreground">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }} />
      <div className="mx-auto max-w-[1400px] px-4 py-8">
        <nav className="mb-4 text-sm text-muted-foreground">
          <Link href="/" className="hover:text-cyan-600 dark:hover:text-cyan-400">Home</Link>
          <span className="mx-2">/</span>
          <Link href={`/property/${p}/${city}`} className="hover:text-cyan-600 dark:hover:text-cyan-400">{cityName}</Link>
          <span className="mx-2">/</span>
          <span className="text-foreground">Under {band.label}</span>
        </nav>

        <header className="mb-6">
          <h1 className="text-2xl font-bold text-foreground sm:text-3xl">
            Homes for Sale in {cityName} Under {band.label}
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">{summary} Highest price first; refreshed daily from the MLS®.</p>
          <div className="mt-3 flex flex-wrap gap-2" aria-label="Other price limits">
            {PRICE_BANDS.map((b) =>
              b.slug === band.slug ? (
                <span key={b.slug} className="rounded-full border border-foreground/40 px-3 py-1 text-xs font-medium">Under {b.label}</span>
              ) : (
                <Link
                  key={b.slug}
                  href={priceBandPath(city, b, p)}
                  className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
                >
                  Under {b.label}
                </Link>
              ),
            )}
            <Link
              href={`/property/${p}/${city}`}
              className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
            >
              All homes in {cityName}
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
          <div className="rounded-lg border border-border bg-card/40 p-8 text-center text-muted-foreground">
            <Building2 className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <p>Nothing in this price range at the moment.</p>
            <Link href={`/property/${p}/${city}`} className="mt-3 inline-block text-sm text-cyan-700 dark:text-cyan-400 hover:text-cyan-600 dark:hover:text-cyan-300">
              All homes for sale in {cityName} →
            </Link>
          </div>
        )}
        {totalFound > listings.length && (
          <p className="mt-4 text-sm text-muted-foreground">
            Showing {listings.length} of {totalFound.toLocaleString("en-CA")}.{" "}
            <Link href="/properties" className="underline hover:text-foreground">See them all on the map</Link>.
          </p>
        )}

        {totalFound > 0 && (
          <HubFaq
            faqs={[
              { q: `How many homes are for sale in ${cityName} under ${band.words}?`, a: summary },
              {
                q: `What kind of home can I buy in ${cityName} under ${band.words}?`,
                a: mix ? `Right now: ${mix}. The mix changes daily as homes sell and new ones are listed.` : summary,
              },
            ]}
          />
        )}

        <div className="mx-auto max-w-3xl">
          <CityTopicLinks citySlug={city} />
        </div>
        <div className="mt-8">
          <ListingComplianceNotice />
        </div>
      </div>
    </main>
  );
}
