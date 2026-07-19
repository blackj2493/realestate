/**
 * Address-watch delivery classifier — pure (§4: deterministic). The confirmation email
 * promises exactly one thing: "We'll email you if this address hits the market." This
 * module decides, per nightly snapshot, whether that promise fires.
 *
 * Baseline contract (address_watches.last_listing_key, migration 083):
 *   NULL  never baselined — first worker sight of this row.
 *   ''    baselined; the address had NO active listing at last sight.
 *   key   the active MLS key we last saw (or alerted) at the address.
 *
 * First-sight rule: a listing already active when the worker first sees the watch only
 * alerts when it ENTERED the market after the watch was created — an active listing
 * that predates the subscription was visible on the address page when they subscribed,
 * so alerting it would be backlog noise (same no-backlog convention as every phase).
 */

export interface AddressWatchCurrent {
  listingKey: string;
  /** Listing OriginalEntryTimestamp (epoch ms); 0/unknown when the doc lacks it. */
  entryMs: number;
}

export interface AddressWatchDecision {
  /** Email a "hit the market" alert for this row tonight. */
  alert: boolean;
  /** New last_listing_key baseline (undefined = leave the row untouched). */
  baseline?: string;
  /** True when the baseline may be written regardless of email outcome. */
  silent?: boolean;
}

export function classifyAddressWatch(input: {
  lastListingKey: string | null;
  /** address_watches.created_at as epoch ms. */
  createdAtMs: number;
  /** Best active-index match for the address, or null when none. */
  current: AddressWatchCurrent | null;
}): AddressWatchDecision {
  const { lastListingKey, createdAtMs, current } = input;

  // First sight — seed the baseline; alert only a listing newer than the subscription.
  if (lastListingKey === null) {
    if (!current) return { alert: false, baseline: "", silent: true };
    if (current.entryMs > createdAtMs) return { alert: true, baseline: current.listingKey };
    return { alert: false, baseline: current.listingKey, silent: true };
  }

  // Baselined — a NEW active key (different campaign, or first listing after a
  // no-listing baseline) is exactly "the address hit the market".
  if (current && current.listingKey !== lastListingKey) {
    return { alert: true, baseline: current.listingKey };
  }

  // Listing left the market → quietly reset to the no-listing baseline, so the NEXT
  // campaign at this address alerts. (Leaving the dead key would also alert — but a
  // stale key baseline breaks the relist-vs-same-campaign distinction on re-syncs.)
  if (!current && lastListingKey !== "") {
    return { alert: false, baseline: "", silent: true };
  }

  return { alert: false };
}
