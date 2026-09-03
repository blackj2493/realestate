/**
 * The <title> / og:title for a listing page — and the rule about when a price may
 * appear in it.
 *
 * A listing payload's ListPrice is the ASK. While the listing is live that is the
 * number a reader expects. Once it closes, the ask is stale and the title used to
 * print it anyway, right beside the resolved status:
 *
 *   "12310 Highway 41, Addington Highlands, ON K0H 2G0 — $299,900 — SOLD"
 *
 * It closed at $250,000. Sampled four recent sold pages and all four were wrong the
 * same way, by 5% to 18%. A reader cannot parse that string as anything but the sale
 * price, so the page states a sale figure that is not the sale figure.
 *
 * The close price cannot simply replace it. A close price is VOW Listing Information;
 * this metadata is built from the UNGATED detail, is shared by every request, and is
 * what a scraper reads. Putting the real number there would trade a wrong price for a
 * compliance breach.
 *
 * So a non-active listing's title carries NO price. "<address> — SOLD" says exactly
 * what we know and are allowed to say. The number stays behind the VOW gate on the
 * page itself, where a registered consumer sees it with its date and provenance.
 */

/** The status kinds ListingDetail resolves. Only "active" has a meaningful ask. */
export type ListingStatusKind = "active" | "sold" | "delisted" | "unavailable";

/**
 * Show the ask ONLY on a live listing. Any closed, off-market or feed-absent record
 * returns false — including the case where the payload still says Active but the
 * resolved status does not, which is the frozen-payload shape a terminated listing
 * takes in our vault.
 */
export function showsListPrice(statusKind: ListingStatusKind, listPrice: number): boolean {
  return statusKind === "active" && listPrice > 0;
}

/** The suffix that names a non-active state, or "" while the listing is live. */
export function statusSuffix(statusKind: ListingStatusKind, statusLabel: string): string {
  switch (statusKind) {
    case "sold":
      return ` — ${statusLabel}`;
    case "delisted":
      return " — Off Market";
    case "unavailable":
      return " — No Longer Available";
    default:
      return "";
  }
}

export interface ListingMetaTitleInput {
  address: string;
  listPrice: number;
  statusKind: ListingStatusKind;
  /** status.label — "SOLD" or "LEASED". Only read when statusKind is "sold". */
  statusLabel: string;
  /** Injected so the caller keeps one price formatter for the whole page. */
  formatPrice: (n: number) => string;
}

export function buildListingMetaTitle({
  address,
  listPrice,
  statusKind,
  statusLabel,
  formatPrice,
}: ListingMetaTitleInput): string {
  const price = showsListPrice(statusKind, listPrice) ? ` — ${formatPrice(listPrice)}` : "";
  return `${address}${price}${statusSuffix(statusKind, statusLabel)} | PureProperty`;
}
