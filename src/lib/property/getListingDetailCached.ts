import { unstable_cache } from "next/cache";
import { getListingDetail, DETAIL_SHAPE_VERSION, type ListingDetail } from "./getListingDetail";
import { listingCacheTag } from "./listingCacheTag";
import { isDemoListingKey, loadDemoListingDetail } from "@/lib/demo/demoListing";

/**
 * Cross-request cache of the (VOW-UNGATED) listing detail, keyed + tagged by
 * ListingKey.
 *
 *   • revalidate: 3600 (1h) keeps DISPLAYED data well inside IDX §6.3(h) (refresh
 *     ≤ 24h). A 24h TTL would sit on the boundary and — stacked on Supabase's own
 *     nightly refresh — could drift past it. 1h is a safe default even before the ETL
 *     bust hook lands; bump it up once the nightly sync calls /api/revalidate.
 *   • On-demand revalidateTag(listingCacheTag(key)) from /api/sync (and, later,
 *     the nightly ETL) keeps price-drops / sold-flips fresh between syncs.
 *
 * COMPLIANCE: this caches the UNGATED detail, but the cache is SERVER-ONLY — it is
 * never sent to a browser. gateVowDerived() still runs per-request in the page and
 * /api/property/[id] before anything reaches the client, so caching changes latency,
 * NOT what an anonymous user receives. (§4; IDX §6.2(f).)
 *
 * GOTCHA (intentional): unstable_cache will also cache a `null` (not-found) for the
 * TTL. The not-found UI triggers a quick-sync, and /api/sync busts THIS exact tag on
 * success, so a freshly-synced listing self-heals on the next load rather than waiting
 * out the 24h window.
 *
 * SHAPE VERSION in the key. Entries survive a deploy, so a release that ADDS a field to
 * ListingDetail served hour-old entries that simply did not have it — the new field read
 * `undefined` and every consumer silently fell back. It cost real debugging time when
 * `compMonthlyRent` shipped: the code was correct end to end and the page still showed
 * the old number. gateVowDerived already carries a note about this for `photoTeaser`,
 * which works around it by re-deriving per request; that only works for a field
 * computable from data already in hand. Versioning the key fixes the general case:
 * change the shape, bump the constant, and stale-shaped entries can never be read.
 */
export function getListingDetailCached(listingKey: string): Promise<ListingDetail | null> {
  // Synthetic demo listings (clip recording, dev-only — see demoListing.ts)
  // short-circuit to their fixture: no DB, no cache, impossible on Vercel.
  if (isDemoListingKey(listingKey)) return loadDemoListingDetail(listingKey);
  return unstable_cache(
    () => getListingDetail(listingKey),
    // DETAIL_SHAPE_VERSION participates in the key: a shape change makes every stale
    // entry unreadable instead of serving a field-less object for up to an hour.
    ["listing-detail", listingKey, DETAIL_SHAPE_VERSION],
    {
      tags: [listingCacheTag(listingKey)],
      revalidate: 3600,
    }
  )();
}
