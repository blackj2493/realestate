import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import ListingComplianceNotice from "@/components/legal/ListingComplianceNotice";
import { TRACKERS } from "@/lib/data/trackers";
import { ogImageUrl } from "@/lib/og/ogImageUrl";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");
export const revalidate = 3600;

const TITLE = "Toronto & GTA Real Estate Data Trackers | PureProperty";
const DESCRIPTION =
  "Free, neighbourhood-level real-estate data for Toronto, Ottawa and the GTA — price cuts, condo fees, days on market, market temperature and more. Updated nightly from live MLS® data. Free to cite and embed.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/data` },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: `${SITE_URL}/data`,
    siteName: "PureProperty",
    type: "website",
    images: [
      ogImageUrl({
        eyebrow: "Market Data",
        title: "GTA Real Estate Trackers",
        subtitle: "Price cuts, condo fees, days on market & more.",
      }),
    ],
  },
};

export default function DataHubPage() {
  const collection = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: TITLE,
    description: DESCRIPTION,
    url: `${SITE_URL}/data`,
  };
  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
      { "@type": "ListItem", position: 2, name: "Data", item: `${SITE_URL}/data` },
    ],
  };

  return (
    <main className="min-h-app bg-background text-foreground">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(collection) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }} />
      <div className="mx-auto max-w-[1100px] px-4 py-10">
        <header className="mb-8">
          <p className="terminal-font text-xs font-bold uppercase tracking-[0.14em] text-cyan-700 dark:text-cyan-400">
            Market Data
          </p>
          <h1 className="mt-1 text-3xl font-bold text-foreground sm:text-4xl">
            GTA &amp; Ottawa Real Estate Data Trackers
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            Free, always-current market data for Toronto, Ottawa and the Greater Toronto Area — cut deeper
            than the board headlines. Every figure is a full-population aggregate from live MLS® data. Free to
            cite and embed.
          </p>
        </header>

        <div className="grid gap-4 sm:grid-cols-2">
          {TRACKERS.map((t) => {
            const live = t.status === "live";
            const card = (
              <div
                className={cn(
                  "group flex h-full flex-col justify-between rounded-lg border border-border bg-card/40 p-5 transition-colors",
                  live ? "hover:border-cyan-500/50" : "opacity-70"
                )}
              >
                <div>
                  <div className="flex items-center gap-2">
                    <p className="terminal-font text-[11px] font-bold uppercase tracking-wider text-cyan-700 dark:text-cyan-400">
                      {t.eyebrow}
                    </p>
                    {!live && (
                      <span className="terminal-font rounded border border-border px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">
                        Soon
                      </span>
                    )}
                  </div>
                  <h2 className="mt-1.5 text-lg font-bold text-foreground">{t.title}</h2>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{t.tagline}</p>
                </div>
                {live && (
                  <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-cyan-700 dark:text-cyan-400">
                    View tracker
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                  </span>
                )}
              </div>
            );
            return live ? (
              <Link key={t.slug} href={`/data/${t.slug}`} className="block">
                {card}
              </Link>
            ) : (
              <div key={t.slug}>{card}</div>
            );
          })}
        </div>

        <div className="mt-10">
          <ListingComplianceNotice />
        </div>
      </div>
    </main>
  );
}
