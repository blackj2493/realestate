import type { CampaignHistoryRow } from './store';
import type { CampaignEvent } from './types';

/**
 * Listing-page shape for campaign history. `campaignCount` + `firstSeenDate` are the
 * teaser hooks that survive gating (analogous to SaleHistory.saleCount); `events`,
 * `trueDom`, `totalPriceDrop` are VOW-derived and stripped for anonymous users.
 */
export interface CampaignHistoryView {
  available: boolean;        // there is a renderable timeline (events present)
  campaignCount: number;     // "listed N times" — survives gating
  trueDom: number | null;    // VOW-derived → null for anon
  totalPriceDrop: number;    // VOW-derived → 0 for anon
  firstSeenDate: string | null;
  events: CampaignEvent[];   // VOW-sensitive → [] for anon
}

/** Map a persisted ledger row (or null) to the client view. */
export function toCampaignHistoryView(row: CampaignHistoryRow | null): CampaignHistoryView {
  if (!row) {
    return { available: false, campaignCount: 0, trueDom: null, totalPriceDrop: 0, firstSeenDate: null, events: [] };
  }
  return {
    available: row.events.length > 0,
    campaignCount: row.campaign_count,
    trueDom: row.true_dom,
    totalPriceDrop: row.total_price_drop,
    firstSeenDate: row.first_seen_date,
    events: row.events,
  };
}

/**
 * The most-recent closed sale/lease across stitched campaigns — but ONLY when that close
 * is the NEWEST campaign at the property (not superseded by a later re-listing).
 *
 * Reconciles the terminate→relist→sold case: a listing terminates, the property is
 * relisted under a NEW key, and that relist SELLS. The close lives only in the
 * address-stitched campaign history (fetched by address, not key), so the original key's
 * own status resolves to "delisted" while the property actually sold. Returning the newest
 * campaign only when it is itself a close inherently rejects "sold-then-relisted-active"
 * (the newest campaign would be Active → null). Pure; no VOW IO.
 */
export interface LatestClose {
  listingKey: string;
  kind: 'sold' | 'leased';
  closePrice: number;
  closeDateISO: string;
}

export function latestCloseFromCampaigns(events: CampaignEvent[]): LatestClose | null {
  if (events.length === 0) return null;
  const ms = (e: CampaignEvent) => {
    const t = Date.parse(e.end_date ?? e.entry_date ?? '');
    return Number.isNaN(t) ? 0 : t;
  };
  const newest = [...events].sort((a, b) => ms(b) - ms(a))[0];
  const status = (newest.end_reason ?? newest.status).toLowerCase();
  const kind = status === 'sold' ? 'sold' : status === 'leased' ? 'leased' : null;
  if (!kind) return null; // newest campaign isn't a close — property is active/off-market
  if ((newest.close_price ?? 0) <= 0) return null; // no disclosed close price
  if (!newest.end_date) return null;
  return { listingKey: newest.listing_key, kind, closePrice: newest.close_price as number, closeDateISO: newest.end_date };
}

/** VOW gate (CLAUDE.md §4): anon keeps only the count + first-seen teaser. */
export function gateCampaignHistory(view: CampaignHistoryView, isAuthed: boolean): CampaignHistoryView {
  if (isAuthed) return view;
  return {
    available: view.available,
    campaignCount: view.campaignCount,
    trueDom: null,
    totalPriceDrop: 0,
    firstSeenDate: view.firstSeenDate,
    events: [],
  };
}
