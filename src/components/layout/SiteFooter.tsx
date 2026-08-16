import Link from "next/link";
import { LIVE_TRACKERS } from "@/lib/data/trackers";

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
 */

const COMPANY = [
  { label: "Operated under licence", href: "/operated-by" },
  { label: "Privacy", href: "/privacy" },
  { label: "Terms", href: "/terms" },
  { label: "Glossary", href: "/glossary" },
];

const headingCls =
  "terminal-font text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground";
const linkCls =
  "text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline";

export default function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="mt-16 border-t border-border bg-background">
      <div className="mx-auto max-w-[1100px] px-4 py-10">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <h2 className={headingCls}>Free Market Data</h2>
            <ul className="mt-3 space-y-2">
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
            </ul>
          </div>

          <div>
            <h2 className={headingCls}>For Media</h2>
            <ul className="mt-3 space-y-2">
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
            </ul>
          </div>

          <div>
            <h2 className={headingCls}>Explore</h2>
            <ul className="mt-3 space-y-2">
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
            </ul>
          </div>

          <div>
            <h2 className={headingCls}>Company</h2>
            <ul className="mt-3 space-y-2">
              {COMPANY.map((c) => (
                <li key={c.href}>
                  <Link href={c.href} className={linkCls}>
                    {c.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-10 border-t border-border pt-6">
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
