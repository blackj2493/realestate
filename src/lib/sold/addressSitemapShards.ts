/**
 * Shape of the sharded /address sitemap — shared by the route that RENDERS the shards
 * and by robots.ts, which has to name every one of them.
 *
 * These two must never disagree. A shard robots.txt names but the route doesn't render
 * is a 404 in Search Console; one the route renders but robots.txt omits is invisible.
 * Hence one module, two importers.
 */

/** URLs per shard. The sitemap protocol caps a single file at 50,000. */
export const SHARD_URLS = 20_000;

/**
 * Fixed shard count → 140,000 URLs of headroom.
 *
 * Sized against the measured population (2026-09-02): raw_vow_sold holds 268,510 sales
 * all-time and 122,866 inside the 12-month window below, so this covers the window with
 * room to grow and leaves the older 145,644 for a later, deliberate widening.
 *
 * The cap is a CRAWL-BUDGET choice, not a technical limit. The address pages only became
 * crawlable at all on 2026-09-02 (#473, #482) and rank on roughly nothing today, so
 * declaring the whole archive before any of it is known to index would spend the budget
 * on pages Google has given no signal about. Raise this constant once Search Console
 * shows what the first tranche does.
 */
export const ADDRESS_SITEMAP_SHARDS = 7;

/** Months of sold history the sitemap declares. See ADDRESS_SITEMAP_SHARDS. */
export const ADDRESS_SITEMAP_WINDOW_MONTHS = 12;

/**
 * Start of the sitemap window as a YYYY-MM-DD date string.
 *
 * purchase_contract_date is a `date` column, so this compares date-to-date and never
 * drags a timezone into the boundary.
 */
export function addressSitemapWindowStart(now: Date = new Date()): string {
  const d = new Date(now);
  d.setUTCMonth(d.getUTCMonth() - ADDRESS_SITEMAP_WINDOW_MONTHS);
  return d.toISOString().slice(0, 10);
}
