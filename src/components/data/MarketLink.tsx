import Link from "next/link";

/**
 * Where a market name in a /data tracker table sends you: the map terminal, seeded
 * with that city.
 *
 * `city` is chipUrl's existing place param — a plain place link with no structured
 * filters, documented there as a stable contract. Verified live 2026-08-17:
 * `?city=Toronto` returns 9,336 active listings and `?city=Richmond+Hill` returns 984,
 * so the TRREB district-code split ("Toronto C06") is already handled on this path.
 *
 * The map rather than the /property/{prov}/{city} hub, deliberately. The hub is a static
 * list; the map carries the same per-listing figures these tables are about. A reader who
 * has just learned that Richmond Hill listings sit 73 days lands on the individual homes
 * doing the sitting. The hub is still linked below each table, where it does the crawl
 * job the map cannot.
 *
 * Only for rows keyed by a CITY. The neighbourhood-keyed boards (condo fees, over-asking,
 * rents) must not use this — `?city=` takes a municipality, not a neighbourhood.
 *
 * A plain in-tab link is right here, and the iframe case does not arise: each *Board is
 * rendered by exactly one page — its own /data route — and nothing passes their `embed`
 * prop. /embed/[tracker] does not use these components at all; it builds its own table
 * from EmbedColumn value functions whose Market column is a plain string. Confirmed
 * against the live embed HTML 2026-09-14: zero /properties?city= links in it. If that
 * ever changes, a framed link would want target="_blank", the way the embed's own footer
 * anchor already does.
 */
export const marketMapHref = (region: string) => `/properties?city=${encodeURIComponent(region)}`;

export function MarketLink({ region }: { region: string }) {
  return (
    <Link
      href={marketMapHref(region)}
      className="font-semibold text-[color:var(--dt-sig)] underline decoration-[color:var(--dt-sig)]/40 underline-offset-2 hover:decoration-[color:var(--dt-sig)] dark:text-cyan-400 dark:decoration-cyan-400/40 dark:hover:decoration-cyan-400"
    >
      {region}
    </Link>
  );
}
