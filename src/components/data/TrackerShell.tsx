/**
 * Shared frame for a public /data tracker page: breadcrumb (visible + JSON-LD),
 * header (eyebrow / h1 / description / embed control / data-as-of stamp), the tracker
 * body, an optional methodology disclosure, an optional FAQ (with FAQPage schema), and
 * the mandatory IDX compliance notice. Server component — pages own generateMetadata.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import ListingComplianceNotice from "@/components/legal/ListingComplianceNotice";
import HubFaq, { type Faq } from "@/components/seo/HubFaq";
import { EmbedBar } from "@/components/data/EmbedBar";

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

        {children}

        {methodology && (
          <details className="mt-8 rounded-md border border-border bg-card/40 p-4 text-sm text-muted-foreground">
            <summary className="cursor-pointer font-semibold text-foreground">How this is calculated</summary>
            <div className="mt-3 space-y-2 leading-relaxed">{methodology}</div>
          </details>
        )}

        {faqs && faqs.length > 0 && <HubFaq faqs={faqs} />}

        <div className="mt-8">
          <ListingComplianceNotice />
        </div>
      </div>
    </main>
  );
}
