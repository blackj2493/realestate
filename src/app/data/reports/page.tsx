/**
 * /data/reports — the monthly Ontario Housing Market Report: the latest edition's key findings
 * and every edition. Each edition lives at /data/reports/{YYYY-MM} and never changes; this page
 * only points at them, so it does not repeat an edition's content. Static.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CalendarDays } from "lucide-react";
import ListingComplianceNotice from "@/components/legal/ListingComplianceNotice";
import { reportPath } from "@/lib/data/reportPaths";
import { EDITIONS, latestEdition } from "@/lib/data/reportEditions";
import { metaDescription } from "@/lib/seo/metaDescription";
import { ogImageUrl } from "@/lib/og/ogImageUrl";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");
const TITLE = "Ontario Housing Market Report, Monthly";

export function generateMetadata(): Metadata {
  const d = latestEdition();
  const description = `A monthly report on Ontario home sales from MLS® data: prices against similar homes a year earlier, sales, price cuts and power of sale, for 15 cities. Latest: ${d.label}.`;
  return {
    metadataBase: new URL(SITE_URL),
    title: `${TITLE} | PureProperty`,
    description: metaDescription(description),
    alternates: { canonical: `${SITE_URL}${reportPath()}` },
    openGraph: {
      title: TITLE,
      description: metaDescription(description),
      url: `${SITE_URL}${reportPath()}`,
      siteName: "PureProperty",
      type: "website",
      images: [ogImageUrl({ eyebrow: "Monthly report", title: TITLE, subtitle: `Latest edition: ${d.label}.` })],
    },
  };
}

export default function ReportsIndexPage() {
  const d = latestEdition();
  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
      { "@type": "ListItem", position: 2, name: "Data", item: `${SITE_URL}/data` },
      { "@type": "ListItem", position: 3, name: "Monthly reports", item: `${SITE_URL}${reportPath()}` },
    ],
  };
  return (
    <main className="min-h-app bg-background text-foreground">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }} />
      <div className="mx-auto max-w-3xl px-4 py-8">
        <nav className="mb-4 text-sm text-muted-foreground">
          <Link href="/data" className="hover:text-foreground">Data</Link>
          <span className="mx-2">/</span>
          <span className="text-foreground">Monthly reports</span>
        </nav>
        <h1 className="flex items-center gap-2 text-2xl font-bold sm:text-3xl">
          <CalendarDays className="h-6 w-6 text-teal-700 dark:text-teal-400" aria-hidden="true" />
          {TITLE}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Each month, PureProperty publishes what Ontario home sales show: prices against similar homes a year earlier, the number of sales, how many sellers cut their
          price, and the share of power-of-sale sales, for 15 cities. Each edition stays at its own address and does not change, so a figure you quote keeps its source.
          PureProperty does not forecast prices.
        </p>

        <Link
          href={reportPath(d.edition)}
          className="group mt-6 block rounded-2xl border border-border bg-card/60 p-5 transition-colors hover:border-teal-600/50 sm:p-6"
        >
          <p className="terminal-font text-[11px] font-bold uppercase tracking-[0.18em] text-teal-700 dark:text-teal-400">Latest edition · {d.label}</p>
          <h2 className="mt-2 text-xl font-semibold">{d.title}</h2>
          <ul className="mt-3 space-y-1.5 text-sm text-muted-foreground">
            {d.findings.map((f) => (
              <li key={f.id}>
                <span className="font-medium text-foreground">{f.title}.</span> {f.text.split(/(?<=\.)\s+/)[0]}
              </li>
            ))}
          </ul>
          <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium underline-offset-4 group-hover:underline">
            Read the {d.label} report <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </span>
        </Link>

        <section className="mt-8" aria-labelledby="editions">
          <h2 id="editions" className="text-lg font-semibold">All editions</h2>
          <ul className="mt-3 divide-y divide-border">
            {[...EDITIONS].reverse().map((e) => (
              <li key={e.edition} className="py-3">
                <Link href={reportPath(e.edition)} className="font-medium underline-offset-4 hover:underline">{e.title}</Link>
                <p className="mt-0.5 text-xs text-muted-foreground">Sales to the end of {e.lastMonth}.</p>
              </li>
            ))}
          </ul>
        </section>

        <p className="mt-6 text-sm">
          <Link href="/data/methodology" className="underline hover:text-foreground">Methodology: our sources and how each measure is calculated →</Link>
        </p>
        <div className="mt-8">
          <ListingComplianceNotice />
        </div>
      </div>
    </main>
  );
}
