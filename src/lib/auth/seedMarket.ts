/**
 * What property (or failing that, what city) a signup was looking at when it signed up.
 *
 * A visitor who signs up from a listing is deliberately NOT asked to pick a market — they
 * already told us, by reading that home, and interrupting the highest-intent moment we get
 * with a setup question is the behaviour we removed. But skipping the question leaves
 * config.regions empty, so their dashboard is bare the first time they open it — the same
 * dead end, moved one screen later.
 *
 * So we infer it instead. The destination they're being returned to already names the
 * property; resolving its city server-side in /welcome means no CTA has to carry a market
 * prop, and every entry point into a listing — teaser, sold-comp card, header sign-in —
 * is covered by construction rather than one at a time.
 *
 * This half is pure URL parsing (no I/O, so it is testable on its own); /welcome does the
 * lookup and hands the result to AcceptTermsForm.
 */

import { extractListingKey, deslugCity } from "@/lib/listings/listingPath";

export type MarketSource =
  /** Look this listing up — its City is the seed. */
  | { kind: "listing"; listingKey: string }
  /** No listing key in the URL, but the path names a city (address hub pages). */
  | { kind: "city"; city: string };

/** Strip query/hash — "/properties/X12639568?lens=cashflow" still names a listing. */
function pathOf(dest: string): string {
  const cut = dest.search(/[?#]/);
  return cut === -1 ? dest : dest.slice(0, cut);
}

/**
 * @param next The validated relative destination from /welcome, or null for a signup with
 *   no destination (which takes the first-run market picker instead — nothing to infer).
 * @returns What to resolve a market from, or null when the destination says nothing about
 *   a place. Returning null is the normal case for /dashboard, /analytics and the like.
 */
export function marketSourceFromNext(next: string | null | undefined): MarketSource | null {
  if (!next || !next.startsWith("/")) return null;
  const segments = pathOf(next).split("/").filter(Boolean);

  // /properties/{key} — but NOT /properties (the terminal) or /properties/compare, which
  // is a shortlist spanning several cities and so names no single market.
  if (segments[0] === "properties" && segments.length === 2) {
    const listingKey = extractListingKey(segments[1]);
    return listingKey ? { kind: "listing", listingKey } : null;
  }

  // /address/{prov}/{city}/{street-slug}-{KEY}
  if (segments[0] === "address" && segments.length === 4) {
    const listingKey = extractListingKey(segments[3]);
    if (listingKey) return { kind: "listing", listingKey };
    // Key-less profile URLs still carry the city in the path, which is enough — it is the
    // same value the page itself falls back to for its heading (deslugCity).
    const city = deslugCity(segments[2]).trim();
    return city ? { kind: "city", city } : null;
  }

  return null;
}
