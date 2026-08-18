/**
 * Shared frame for a public /data tracker page: breadcrumb (visible + JSON-LD),
 * header (eyebrow / h1 / description / embed control / data-as-of stamp), the tracker
 * body, an optional methodology disclosure, an optional FAQ (with FAQPage schema), and
 * the mandatory IDX compliance notice. Server component — pages own generateMetadata.
 *
 * Findings that read from this tracker are linked automatically from the registry, so
 * a new piece wires itself into its tracker with no page edit. The pairing is the
 * point: the tracker is the current number, the finding is what it meant on a date,
 * and each is worth much less to a reader who cannot reach the other.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import ListingComplianceNotice from "@/components/legal/ListingComplianceNotice";
import HubFaq, { type Faq } from "@/components/seo/HubFaq";
import { EmbedBar } from "@/components/data/EmbedBar";
import { findingsForTracker } from "@/lib/data/findings";
import { LIVE_TRACKERS } from "@/lib/data/trackers";
import { TrackerAttributionProvider } from "@/components/data/TrackerAttribution";
import { attributionLabel } from "@/lib/data/attribution";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");

export interface Crumb {
  name: string;
  href?: string;
}

export function TrackerShell({
  eyebrow,
  title,
  description,
  crumbs,
  dataAsOf,
  slug,
  children,
  faqs,
  methodology,
}: {
  eyebrow: string;
  title: string;
  description: string;
  crumbs: Crumb[];
  dataAsOf: string | null;
  slug: string;
  children: ReactNode;
  faqs?: Faq[];
  methodology?: ReactNode;
}) {
  const canonical = `${SITE_URL}/data/${slug}`;
  const embedUrl = `${SITE_URL}/embed/${slug}`;
  const relatedFindings = findingsForTracker(slug);
  const siblings = LIVE_TRACKERS.filter((t) => t.slug !== slug);
  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      item: c.href ? `${SITE_URL}${c.href}` : canonical,
    })),
  };
  const asOf = dataAsOf ? new Date(dataAsOf) : null;

  // Formatted here, on the server, and handed to the client strip as a string. The
  // same date rendered client-side would risk a locale/timezone hydration mismatch on
  // every tracker page.
  const asOfLabel = asOf
    ? asOf.toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" })
    : null;

  return (
    <main className="min-h-app bg-background text-foreground">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }} />
      <div className="mx-auto max-w-[1100px] px-4 py-8">
        <nav className="mb-4 text-sm text-muted-foreground">
          {crumbs.map((c, i) => (
            <span key={c.name}>
              {i > 0 && <span className="mx-2">/</span>}
              {c.href ? (
                <Link href={c.href} className="hover:text-cyan-600 dark:hover:text-cyan-400">
                  {c.name}
                </Link>
              ) : (
                <span className="text-foreground">{c.name}</span>
              )}
            </span>
          ))}
        </nav>

        <header className="mb-6">
          <p className="terminal-font text-xs font-bold uppercase tracking-[0.14em] text-cyan-700 dark:text-cyan-400">
            {eyebrow}
          </p>
          <h1 className="mt-1 text-2xl font-bold text-foreground sm:text-3xl">{title}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">{description}</p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <EmbedBar embedUrl={embedUrl} pageUrl={canonical} title={title} />
            {asOf && (
              <span className="terminal-font text-[11px] uppercase tracking-wider text-muted-foreground">
                Data as of{" "}
                {asOf.toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" })}
              </span>
            )}
          </div>
        </header>

        {/* Every RankingTable inside renders the source line under its column headers,
            so a screenshot of the table carries the URL and the date wherever it goes. */}
        <TrackerAttributionProvider
          value={{ label: attributionLabel(SITE_URL, slug), asOfLabel }}
        >
          {children}
        </TrackerAttributionProvider>

        {/* Sibling trackers. Until this shipped, the only route from one tracker to
            another was the site footer — below the table, the methodology, the findings,
            the FAQ and the compliance notice. On a phone that is a very long scroll, so a
            visitor arriving from a shared link read one table and left without learning
            the other seven existed. Derived from LIVE_TRACKERS, so a new tracker joins
            every strip with no page edit. */}
        {siblings.length > 0 && (
          <nav aria-label="Other data trackers" className="mt-8 border-t border-border pt-5">
            <p className="terminal-font text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
              More Ontario housing data
            </p>
            <ul className="mt-3 flex flex-wrap gap-2">
              {siblings.map((t) => (
                <li key={t.slug}>
                  <Link
                    href={`/data/${t.slug}`}
                    className="terminal-font block border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-cyan-600 hover:text-cyan-700 dark:hover:border-cyan-400 dark:hover:text-cyan-400"
                  >
                    {t.navLabel}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}

        {methodology && (
          <details className="mt-8 rounded-md border border-border bg-card/40 p-4 text-sm text-muted-foreground">
            <summary className="cursor-pointer font-semibold text-foreground">How this is calculated</summary>
            <div className="mt-3 space-y-2 leading-relaxed">{methodology}</div>
          </details>
        )}

        {relatedFindings.length > 0 && (
          <section className="mt-8 rounded-md border border-border bg-card/40 p-5">
            <p className="terminal-font text-[11px] font-bold uppercase tracking-[0.14em] text-cyan-700 dark:text-cyan-400">
              {relatedFindings.length === 1 ? "Analysis from this data" : "Analyses from this data"}
            </p>
            <ul className="mt-3 space-y-3">
              {relatedFindings.map((f) => (
                <li key={f.slug}>
                  <Link
                    href={`/data/findings/${f.slug}`}
                    className="font-semibold text-cyan-700 underline underline-offset-2 dark:text-cyan-400"
                  >
                    {f.title}
                  </Link>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{f.standfirst}</p>
                </li>
              ))}
            </ul>
          </section>
        )}

        {faqs && faqs.length > 0 && <HubFaq faqs={faqs} />}

        <div className="mt-8">
          <ListingComplianceNotice />
        </div>
      </div>
    </main>
  );
}
