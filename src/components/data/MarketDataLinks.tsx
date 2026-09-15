import Link from "next/link";
import { BarChart3 } from "lucide-react";

/**
 * In-content links from a listing into the /data trackers.
 *
 * WHY THIS EXISTS, AND WHY THE FOOTER WAS NOT ENOUGH. SiteFooter already links every
 * tracker from every page in the (app) tree — roughly 47,000 inbound internal links. It
 * bought reachability and almost no crawl priority, because Google recognises a sitewide
 * footer as boilerplate navigation and discounts it to near nothing. Verified 2026-09-15:
 * /data/price-cuts had been in the sitemap since 2026-07-20, served Googlebot a clean 200,
 * carried `index, follow`, and was still reported "URL is unknown to Google" with no
 * recorded crawl, while /properties and /address pages indexed normally.
 *
 * An in-content link inside the page's own market section is a different signal: it sits
 * in the body, it is editorially relevant to what the reader is looking at, and its anchor
 * text describes the destination. That is what carries crawl weight.
 *
 * HONESTY ABOUT THE DESTINATION. The trackers are Ontario-wide boards that RANK every
 * market, not per-city pages. So the copy says "see how {city} compares" rather than
 * implying a city-specific page exists. If per-city tracker pages ship later, point these
 * at them and the wording still holds.
 *
 * Aggregate pages only — no listing data crosses this boundary.
 */

interface TrackerLink {
  slug: string;
  label: string;
}

/** Sale-side trackers: the questions a buyer or seller is actually holding. */
const SALE_LINKS: TrackerLink[] = [
  { slug: "price-cuts", label: "price-cut tracker" },
  { slug: "days-on-market", label: "days-on-market tracker" },
  { slug: "market-temperature", label: "buyer's or seller's market" },
  { slug: "over-asking", label: "bidding-war tracker" },
];

/** Lease-side trackers. A renter has no use for sold-price rankings. */
const LEASE_LINKS: TrackerLink[] = [
  { slug: "rents", label: "closed-rent tracker" },
  { slug: "rent-vs-buy", label: "rent-vs-buy yields" },
  { slug: "market-temperature", label: "buyer's or seller's market" },
];

export default function MarketDataLinks({
  city,
  isLease = false,
}: {
  /** Display city name. Falls back to province-wide copy when the feed has none. */
  city?: string | null;
  isLease?: boolean;
}) {
  const links = isLease ? LEASE_LINKS : SALE_LINKS;
  const where = city?.trim() || null;

  return (
    <div className="mt-6 rounded-lg border border-border bg-card/50 p-4 dark:bg-card/30">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <BarChart3 className="h-4 w-4 text-cyan-600 dark:text-cyan-400" aria-hidden="true" />
        Ontario market data
      </h3>
      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
        {where ? (
          <>
            See how <span className="font-medium text-foreground">{where}</span> compares across every
            Ontario market we track. Updated nightly from MLS&reg; data.
          </>
        ) : (
          <>Live market readings across Toronto, Ottawa and the GTA. Updated nightly from MLS&reg; data.</>
        )}
      </p>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {links.map((l) => (
          <li key={l.slug}>
            <Link
              href={`/data/${l.slug}`}
              className="text-xs font-medium text-cyan-700 underline-offset-2 hover:underline dark:text-cyan-400"
            >
              {where ? `${where} ${l.label}` : l.label}
            </Link>
          </li>
        ))}
        <li>
          <Link
            href="/data"
            className="text-xs font-medium text-muted-foreground underline-offset-2 hover:underline"
          >
            All data trackers
          </Link>
        </li>
      </ul>
    </div>
  );
}
