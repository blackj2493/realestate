/**
 * Smart-Homebuyer hub — /family/{city}/top-rated-schools (Phase 2d).
 *
 * The "family / school-first buyer" persona hub: active For-Sale listings in a city,
 * filtered to those with a rated school nearby and SORTED by that score (best first).
 * Targets the high-intent "homes near top schools in {city}" / "best school areas
 * {city}" family queries that the consumer portals serve poorly.
 *
 * NOT velvet-rope. Unlike the cap-rate hub (which hides the proprietary number), the
 * PureProperty School Score is PUBLIC open data (EQAO via the Government of Ontario,
 * OGL-Ontario) — it's already shown un-gated on the listing page (NearbySchools), so we
 * show it here too: richer, unique, crawlable content that genuinely helps the persona.
 * Attribution + the catchment caveat ride with it, matching the listing page.
 *
 * Compliance mirrors the other hubs: ≤100 per query (§4), brokerage per card (§6.3c),
 * deemed-reliable + bona-fide notice (§6.3 i/k), active IDX only, deterministic (no LLM),
 * noindex when thin. Static + 1h revalidate (public, no auth gating).
 *
 * Scope note: schools only. We have indexed per-listing school scores but NO indexed
 * transit score — so the hub claims schools (real signal), not "schools + transit".
 */

import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";
import { GraduationCap, TrendingUp } from "lucide-react";
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

/**
 * Card data + the public school-score badge. The score is open data (shown, not gated),
 * so it's safe to carry onto the card here — and ONLY here (toCardData stays score-free
 * so the city/investor hubs don't sprout school badges).
 */
function toSchoolCardData(doc: ListingDocument): PropertyCardData {
  return { ...toCardData(doc), topSchoolScore: doc.BestSchoolScoreNearby };
}

/** Active listings in the city WITH a rated school nearby, ranked best-school-first. */
const getSchoolHub = cache(async (slug: string) => {
  const { cities } = await citiesForHubSlug(slug);
  if (cities.length === 0) return { listings: [] as ListingDocument[], totalFound: 0 };
  try {
    const res = await searchListings({
      query: "*",
      rawFilterBy: `${cityFilterClause(cities)} && TransactionType:=\`For Sale\` && PropertyType:!=Commercial && BestSchoolScoreNearby:>0`,
      perPage: PER_PAGE,
      sortBy: "BestSchoolScoreNearby",
      sortOrder: "desc",
    });
    return { listings: res.listings, totalFound: res.totalFound };
  } catch (err) {
    console.error(`[SchoolHub] query failed for "${slug}":`, err);
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
  const { totalFound } = await getSchoolHub(city);
  const canonical = `${SITE_URL}/family/${city}/top-rated-schools`;

  const title = `Homes for Sale Near Top-Rated Schools in ${cityName}, ON | PureProperty`;
  const description =
    totalFound > 0
      ? `${totalFound} ${cityName} homes for sale near top-rated schools, ranked by our PureProperty School Score (EQAO). Compare prices, beds, baths, and brokerage details.`
      : `Homes for sale near top-rated schools in ${cityName}, ON, ranked by the PureProperty School Score.`;

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
      images: [ogImageUrl({ eyebrow: "Top-Rated Schools", title: `${cityName}, ON`, subtitle: "Homes near the best-rated schools." })],
    },
  };
}

export default async function SchoolHubPage({
  params,
}: {
  params: Promise<{ city: string }>;
}) {
  const { city } = await params;
  const cityName = deslugCity(city);
  const { listings, totalFound } = await getSchoolHub(city);
  const canonical = `${SITE_URL}/family/${city}/top-rated-schools`;
  const cityHubPath = `/property/on/${city}`;
  const investorHubPath = `/investments/${city}/highest-cap-rate`;

  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
      { "@type": "ListItem", position: 2, name: "Properties", item: `${SITE_URL}/properties` },
      { "@type": "ListItem", position: 3, name: `${cityName}, ON`, item: `${SITE_URL}${cityHubPath}` },
      { "@type": "ListItem", position: 4, name: "Top-Rated Schools", item: canonical },
    ],
  };

  return (
    <main className="min-h-app bg-background text-foreground">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }} />

      <div className="mx-auto max-w-[1400px] px-4 py-8">
        <nav className="mb-4 text-sm text-muted-foreground">
          <Link href="/properties" className="hover:text-cyan-600 dark:hover:text-cyan-400">Properties</Link>
          <span className="mx-2">/</span>
          <Link href={cityHubPath} className="hover:text-cyan-600 dark:hover:text-cyan-400">{cityName}</Link>
          <span className="mx-2">/</span>
          <span className="text-foreground">Top-Rated Schools</span>
        </nav>

        <header className="mb-6">
          <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground sm:text-3xl">
            <GraduationCap className="h-6 w-6 text-emerald-700 dark:text-emerald-400" />
            Homes for Sale Near Top-Rated Schools in {cityName}, ON
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {totalFound > 0
              ? `${totalFound.toLocaleString()} ${totalFound === 1 ? "home" : "homes"} ranked by the best-rated school nearby — highest first.`
              : `No listings with a rated school nearby in ${cityName} right now.`}
          </p>
          {totalFound > 0 && (
            <Link
              href={investorHubPath}
              className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700 dark:text-emerald-400 transition-colors hover:text-emerald-300"
            >
              <TrendingUp className="h-4 w-4" /> Highest cap-rate investments in {cityName} →
            </Link>
          )}
        </header>

        {listings.length > 0 ? (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {listings.map((doc) => (
              <PropertyCard key={doc.id} property={toSchoolCardData(doc)} showSaveButton={false} />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-card/40 p-8 text-center text-muted-foreground">
            <GraduationCap className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <p>No school-ranked listings here right now.</p>
            <Link href={cityHubPath} className="mt-3 inline-block text-sm text-cyan-700 dark:text-cyan-400 hover:text-cyan-300">
              See all homes for sale in {cityName} →
            </Link>
          </div>
        )}

        {/* School-data attribution + catchment caveat — mirrors the listing page's
            NearbySchools footnote (EQAO / OGL-Ontario). */}
        {totalFound > 0 && (
          <p className="mt-6 text-[11px] leading-relaxed text-muted-foreground">
            Ranked by the PureProperty School Score (0–10), derived from EQAO data —
            Government of Ontario, OGL-Ontario. The score reflects the best-rated school
            within ~2.5&nbsp;km; proximity is straight-line and is not a guaranteed
            catchment. Open a listing to see every nearby school and its score.
          </p>
        )}

        {totalFound > 0 && (
          <HubFaq
            faqs={[
              { q: `What is the PureProperty School Score?`, a: `A 0–10 rating of a school's performance derived from EQAO data published by the Government of Ontario (OGL-Ontario).` },
              { q: `How do I find homes near top-rated schools in ${cityName}?`, a: `This page ranks ${cityName} homes by the best-rated school within about 2.5 km. ${totalFound.toLocaleString()} homes currently qualify.` },
              { q: `Does living near a school guarantee enrolment?`, a: `No. Proximity is straight-line distance and is not a guaranteed catchment — confirm boundaries with the local school board.` },
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
