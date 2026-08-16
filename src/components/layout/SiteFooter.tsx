import Link from "next/link";
import { LIVE_TRACKERS } from "@/lib/data/trackers";
import FooterSection from "./FooterSection";

/**
 * Site-wide footer.
 *
 * WHY IT EXISTS: /data had NO internal links pointing at it from anywhere on the site —
 * verified 2026-08-14, zero `href="/data"` outside the section itself. It was reachable
 * only via the sitemap or a direct URL. That is a poor foundation for a campaign whose
 * whole point is earning EXTERNAL links to those pages: search engines weigh what a site
 * says about its own content, and we were saying nothing.
 *
 * The "More" dropdown cannot fix this. Its Popover renders `{open && coords && children}`
 * into a portal, so those links are absent from the served HTML and are never crawled —
 * fine for a human clicking around, worth nothing for internal link equity. A footer is
 * in the markup on every render, which is the entire point.
 *
 * Tracker links are derived from LIVE_TRACKERS rather than hardcoded, so a new tracker
 * appears here the moment it ships — the same registry the sitemap and hub read.
 *
 * DELIBERATELY NOT on the homepage (a full-bleed hero over a Mapbox canvas), the
 * /properties terminal (own full-height chrome), or /embed/* (must stay chrome-free for
 * iframing). It renders on the (app) group and the /data tree, which is every page with
 * ordinary document flow.
 *
 * On a phone the four columns become closed disclosures — see FooterSection for why the
 * links stay in the markup regardless. Desktop keeps the four-column grid unchanged.
 */

const COMPANY = [
  { label: "Operated under licence", href: "/operated-by" },
  { label: "Privacy", href: "/privacy" },
  { label: "Terms", href: "/terms" },
  { label: "Glossary", href: "/glossary" },
];

const linkCls =
  "text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline";

export default function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="mt-12 border-t border-border bg-background sm:mt-16">
      <div className="mx-auto max-w-[1100px] px-4 py-4 sm:py-10">
        <div className="grid gap-0 sm:grid-cols-2 sm:gap-8 lg:grid-cols-4">
          <FooterSection title="Free Market Data">
            <li>
              <Link href="/data" className={linkCls}>
                All data trackers
              </Link>
            </li>
            {LIVE_TRACKERS.map((t) => (
              <li key={t.slug}>
                <Link href={`/data/${t.slug}`} className={linkCls}>
                  {t.navLabel}
                </Link>
              </li>
            ))}
          </FooterSection>

          <FooterSection title="For Media">
            <li>
              <Link href="/data/for-journalists" className={linkCls}>
                For journalists
              </Link>
            </li>
            <li>
              {/* The press desk promises a custom pull within one business day; a mailto
                  here is the shortest path from "I need a number" to asking for it. */}
              <a href="mailto:tanmay@pureproperty.ca" className={linkCls}>
                Request a custom cut
              </a>
            </li>
          </FooterSection>

          <FooterSection title="Explore">
            <li>
              <Link href="/properties" className={linkCls}>
                Map search
              </Link>
            </li>
            <li>
              <Link href="/analytics" className={linkCls}>
                Market trends
              </Link>
            </li>
            <li>
              <Link href="/whats-my-home-hiding" className={linkCls}>
                Reno upside
              </Link>
            </li>
          </FooterSection>

          <FooterSection title="Company">
            {COMPANY.map((c) => (
              <li key={c.href}>
                <Link href={c.href} className={linkCls}>
                  {c.label}
                </Link>
              </li>
            ))}
          </FooterSection>
        </div>

        <div className="mt-6 border-t border-border pt-5 sm:mt-10 sm:pt-6">
          <p className="text-xs leading-relaxed text-muted-foreground">
            © {year} PureProperty.ca. Market statistics on this site are aggregates derived from
            MLS® data, deemed reliable but not guaranteed accurate. Figures are medians unless
            stated otherwise and are free to cite with attribution.
          </p>
        </div>
      </div>
    </footer>
  );
}
