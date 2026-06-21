/**
 * City directory — /property (Phase 2i).
 *
 * The top-down crawl backbone for the whole hub tree. The consumer-facing /properties
 * route is a client-only WebGL terminal Googlebot can't crawl, so the city/neighbourhood/
 * persona hubs had no entry point above them except the XML sitemap + bottom-up listing
 * breadcrumbs. This server-rendered directory lists every city hub, so a single crawlable
 * page (linked from the homepage) flows site authority down into the entire tree:
 *   /property → /property/on/{city} → {neighbourhoods, persona hubs} → listings.
 *
 * Compliance: links only; the IDX deemed-reliable + bona-fide notice still renders (the
 * page references active IDX inventory counts). Deterministic, static + 1h revalidate.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { Building2 } from "lucide-react";
import { cityHubsWithInventory } from "@/lib/listings/cityHubs";
import { ogImageUrl } from "@/lib/og/ogImageUrl";
import { deslugCity } from "@/lib/listings/listingPath";
import ListingComplianceNotice from "@/components/legal/ListingComplianceNotice";

export const revalidate = 3600;

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");
const DIR_MIN = 5; // mirror the sitemap's HUB_MIN — don't list a city that renders thin

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Homes for Sale by City in Ontario | PureProperty",
  description:
    "Browse homes for sale across every Ontario city on PureProperty — compare active listings, prices, schools, walkability, and cash-flow potential by city.",
  alternates: { canonical: `${SITE_URL}/property` },
  openGraph: {
    title: "Homes for Sale by City in Ontario | PureProperty",
    description: "Browse active real estate listings by city across Ontario.",
    url: `${SITE_URL}/property`,
    siteName: "PureProperty",
    type: "website",
    images: [ogImageUrl({ eyebrow: "Ontario Real Estate", title: "Homes for Sale by City", subtitle: "Browse active listings across every Ontario city." })],
  },
};

export default async function CityDirectoryPage() {
  const cities = (await cityHubsWithInventory(DIR_MIN)).sort((a, b) => b.count - a.count);

  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
      { "@type": "ListItem", position: 2, name: "Homes by City", item: `${SITE_URL}/property` },
    ],
  };

  return (
    <main className="min-h-app bg-slate-950 text-slate-200">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }} />

      <div className="mx-auto max-w-[1400px] px-4 py-8">
        <nav className="mb-4 text-sm text-slate-500">
          <Link href="/" className="hover:text-cyan-400">Home</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-300">Homes by City</span>
        </nav>

        <header className="mb-6">
          <h1 className="text-2xl font-bold text-slate-100 sm:text-3xl">Homes for Sale by City in Ontario</h1>
          <p className="mt-1 text-sm text-slate-400">
            {cities.length > 0
              ? `Browse active listings across ${cities.length.toLocaleString()} Ontario ${cities.length === 1 ? "city" : "cities"}. Each city opens to its neighbourhoods, school, walkability, investment, and new-construction views.`
              : "Browse active real estate listings by city across Ontario."}
          </p>
        </header>

        {cities.length > 0 ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {cities.map(({ slug, count }) => (
              <Link
                key={slug}
                href={`/property/on/${slug}`}
                className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2.5 text-sm text-slate-200 transition-colors hover:border-cyan-500/40 hover:text-cyan-300"
              >
                <span className="truncate">{deslugCity(slug)}</span>
                <span className="shrink-0 text-xs text-slate-500">{count.toLocaleString()}</span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-8 text-center text-slate-400">
            <Building2 className="mx-auto mb-3 h-8 w-8 text-slate-600" />
            <p>City listings are loading. Check back shortly.</p>
          </div>
        )}

        <div className="mt-8">
          <ListingComplianceNotice />
        </div>
      </div>
    </main>
  );
}
