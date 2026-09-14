"use client";

import { useSyncExternalStore } from "react";
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
 */
export const marketMapHref = (region: string) => `/properties?city=${encodeURIComponent(region)}`;

/** Whether we are rendered inside an iframe. Fixed for the life of the document. */
const subscribeNever = () => () => {};
const isFramed = () => window.self !== window.top;
const notFramedOnServer = () => false;

export function MarketLink({ region }: { region: string }) {
  /**
   * These tables also render inside /embed/[tracker], which publishers iframe into their
   * own pages. Navigating our map *inside* someone else's iframe is the wrong outcome —
   * a cramped frame, their chrome, and a frame-ancestors policy that may refuse it
   * outright. So when we are framed, open in a new tab, which is what the embed's own
   * footer anchor already does.
   *
   * Read from the browser rather than passed as a prop: RankingTable's column API gives
   * render() the row only, so threading `embed` through would change that contract and
   * every board using it. The server snapshot is `false`, so the markup ships the plain
   * in-tab link — the correct default un-framed and with no JS.
   */
  const framed = useSyncExternalStore(subscribeNever, isFramed, notFramedOnServer);

  const className =
    "font-semibold text-[color:var(--dt-sig)] underline decoration-[color:var(--dt-sig)]/40 underline-offset-2 hover:decoration-[color:var(--dt-sig)] dark:text-cyan-400 dark:decoration-cyan-400/40 dark:hover:decoration-cyan-400";

  return (
    <Link
      href={marketMapHref(region)}
      className={className}
      {...(framed ? { target: "_blank", rel: "noopener" } : {})}
    >
      {region}
    </Link>
  );
}
