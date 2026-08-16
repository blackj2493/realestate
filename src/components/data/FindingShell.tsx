/**
 * Shared frame for a /data/findings piece: masthead, byline, the analysis body, the
 * link back to the live tracker, and the quoting terms.
 *
 * DELIBERATELY NOT TrackerShell. A tracker page is a tool — its job is to get you to
 * the number for your neighbourhood, so it is dense, filterable and undated. A
 * finding is read start to finish, so it takes a measured column, a real deck, and a
 * publication date in the byline rather than a "data as of" stamp. Same design
 * language, different reading posture.
 *
 * THE BYLINE IS A CREDIBILITY ASSET, not decoration. Reporters check who computed a
 * number and over what before they quote it, and a piece that hides its basis and
 * sample gets skipped for one that does not. Sample size, coverage and the quoting
 * terms are stated above the fold for that reason.
 *
 * Server component — pages own their own generateMetadata and JSON-LD.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import ListingComplianceNotice from "@/components/legal/ListingComplianceNotice";
import { trackerBySlug } from "@/lib/data/trackers";
import type { FindingDef } from "@/lib/data/findings";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");

/** Author of record. A dataset with no human behind it does not get quoted. */
export const DESK_AUTHOR = "Tanmay Rao";
export const DESK_AUTHOR_ROLE = "Founder, PureProperty";
export const DESK_EMAIL = "tanmay@pureproperty.ca";

function fmtDate(iso: string): string {
  // Parsed as UTC noon so a date-only string never slips a day across time zones.
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-CA", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function FindingShell({ finding, children }: { finding: FindingDef; children: ReactNode }) {
  const canonical = `${SITE_URL}/data/findings/${finding.slug}`;
  const tracker = trackerBySlug(finding.trackerSlug);

  const crumbs = [
    { name: "Home", href: "/" },
    { name: "Data", href: "/data" },
    { name: "Findings", href: "/data/findings" },
    { name: finding.title },
  ];

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

  // Article rather than NewsArticle: this is analysis of a dataset we publish, and
  // NewsArticle carries expectations (a newsroom, a masthead) we do not meet.
  const article = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: finding.title,
    description: finding.description,
    datePublished: finding.published,
    dateModified: finding.updated ?? finding.published,
    author: { "@type": "Person", name: DESK_AUTHOR, jobTitle: DESK_AUTHOR_ROLE },
    publisher: { "@type": "Organization", name: "PureProperty", url: SITE_URL },
    mainEntityOfPage: canonical,
    isAccessibleForFree: true,
    // The dataset behind the piece, so the finding and the tracker are machine-linked
    // and not merely cross-referenced in prose.
    ...(tracker
      ? {
          about: {
            "@type": "Dataset",
            name: tracker.title,
            url: `${SITE_URL}/data/${tracker.slug}`,
          },
        }
      : {}),
  };

  return (
    <main className="min-h-app bg-background text-foreground">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(article) }} />

      <div className="mx-auto max-w-[760px] px-4 py-8">
        <nav className="mb-6 text-sm text-muted-foreground">
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

        <header>
          <p className="terminal-font text-xs font-bold uppercase tracking-[0.14em] text-cyan-700 dark:text-cyan-400">
            {finding.eyebrow} · {fmtDate(finding.published)}
          </p>
          <h1 className="mt-3 text-3xl font-bold leading-tight tracking-tight text-foreground sm:text-4xl">
            {finding.title}
          </h1>
          <p className="mt-4 text-lg leading-relaxed text-muted-foreground">{finding.standfirst}</p>

          <dl className="mt-6 flex flex-wrap gap-x-8 gap-y-2 border-y border-border py-4 text-xs text-muted-foreground">
            <div>
              <dt className="inline font-semibold text-foreground">Source: </dt>
              <dd className="inline">{finding.basis}</dd>
            </div>
            <div>
              <dt className="inline font-semibold text-foreground">Coverage: </dt>
              <dd className="inline">{finding.coverage}</dd>
            </div>
            <div>
              <dt className="inline font-semibold text-foreground">By: </dt>
              <dd className="inline">
                {DESK_AUTHOR}, {DESK_AUTHOR_ROLE}
              </dd>
            </div>
            <div>
              <dt className="inline font-semibold text-foreground">Free to quote </dt>
              <dd className="inline">with credit</dd>
            </div>
          </dl>
        </header>

        <div className="finding-body mt-8">{children}</div>

        {tracker && (
          <aside className="mt-12 rounded-md border border-border bg-card/40 p-5">
            <p className="terminal-font text-[11px] font-bold uppercase tracking-[0.14em] text-cyan-700 dark:text-cyan-400">
              The live data
            </p>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              This analysis is a snapshot. The underlying figures update nightly and are searchable by
              city and neighbourhood on the{" "}
              <Link
                href={`/data/${tracker.slug}`}
                className="font-semibold text-cyan-700 underline underline-offset-2 dark:text-cyan-400"
              >
                {tracker.title}
              </Link>{" "}
              tracker, where every view is a shareable link.
            </p>
          </aside>
        )}

        <footer className="mt-8 border-t border-border pt-6 text-sm text-muted-foreground">
          <p>
            <strong className="text-foreground">Free to quote, chart and embed</strong> with a credit and
            link to PureProperty.ca. Custom cuts — a specific city, a bedroom count, a longer time series
            — within one business day:{" "}
            <a
              href={`mailto:${DESK_EMAIL}`}
              className="text-cyan-700 underline underline-offset-2 dark:text-cyan-400"
            >
              {DESK_EMAIL}
            </a>
            .
          </p>
          <p className="mt-3">
            <Link
              href="/data/for-journalists"
              className="text-cyan-700 underline underline-offset-2 dark:text-cyan-400"
            >
              Press desk and embeddable charts →
            </Link>
          </p>
        </footer>

        <div className="mt-8">
          <ListingComplianceNotice />
        </div>
      </div>
    </main>
  );
}
