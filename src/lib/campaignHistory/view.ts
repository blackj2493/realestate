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
