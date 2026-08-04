import type { CampaignHistoryRow } from './store';
import type { CampaignEvent, TransactionKind } from './types';

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
 * is the NEWEST campaign at the property (not superseded by a later re-listing) AND it
 * settles the SAME transaction the viewed campaign was running.
 *
 * Reconciles the terminate→relist→sold case: a listing terminates, the property is
 * relisted under a NEW key, and that relist SELLS. The close lives only in the
 * address-stitched campaign history (fetched by address, not key), so the original key's
 * own status resolves to "delisted" while the property actually sold. Returning the newest
 * campaign only when it is itself a close inherently rejects "sold-then-relisted-active"
 * (the newest campaign would be Active → null). Pure; no VOW IO.
 *
 * `forKind` is REQUIRED because a close of the other transaction type does not settle this
 * campaign — it is a different deal on the same bricks. A For-Sale campaign that terminated
 * at a property later LEASED did NOT sell: the owner still owns it. Without this guard the
 * caller promoted that page to "LEASED <monthly rent>", putting the rent in the sale-price
 * slot — struck through against the sale ask ("0.1% of ask") and feeding the "Our Call vs.
 * The Sale" accuracy receipt a ~$560k estimate against a $1,900 rent. 2,879 listing pages
 * across 1,525 properties were rendering that when measured 2026-08-04. Same bug class as
 * the AVM lease contamination: sale and lease values sharing a field with no type guard.
 *
 * A property that genuinely sold still promotes — a sale close matches a sale campaign.
 * The rejected lease is not lost to the reader; it remains a row in the campaign timeline.
 *
 * FEED QUIRK: some LEASE campaigns arrive stamped `status: 'Sold'` (verified 2026-08-04 —
 * e.g. X13131816, a $2,800 lease at 618 Taliesin Cres, marked Sold). Those were promoting
 * sale pages to "SOLD $2,800" with no LEASED label at all — 178 pages. `transaction_type`
 * is therefore the trustworthy discriminator and `status` is not; the kind check below
 * rejects any campaign whose two disagree. Cost of that strictness: a Lease page whose
 * close carries the bad stamp reads OFF MARKET rather than LEASED. That is an information
 * gap on a low-stakes surface, deliberately preferred over inferring kind from the type and
 * risking a rent in a sale slot again — the very bug this guard exists to kill.
 */
export interface LatestClose {
  listingKey: string;
  kind: 'sold' | 'leased';
  closePrice: number;
  closeDateISO: string;
}

/** The close kind that settles each transaction type. */
const CLOSE_KIND_FOR: Record<TransactionKind, LatestClose['kind']> = {
  Sale: 'sold',
  Lease: 'leased',
};

export function latestCloseFromCampaigns(
  events: CampaignEvent[],
  forKind: TransactionKind
): LatestClose | null {
  // Scope FIRST, then apply the newest-must-be-a-close rule within that transaction's own
  // campaign line. Filtering (rather than merely rejecting a mismatched newest close) keeps
  // an unrelated lease from masking a real sale: sold Jun 12 then rented out Jun 20 still
  // reads SOLD, because the lease was never part of the sale's story.
  const scoped = events.filter((e) => e.transaction_type === forKind);
  if (scoped.length === 0) return null;
  const ms = (e: CampaignEvent) => {
    const t = Date.parse(e.end_date ?? e.entry_date ?? '');
    return Number.isNaN(t) ? 0 : t;
  };
  const newest = [...scoped].sort((a, b) => ms(b) - ms(a))[0];
  const status = (newest.end_reason ?? newest.status).toLowerCase();
  const kind = status === 'sold' ? 'sold' : status === 'leased' ? 'leased' : null;
  if (!kind) return null; // newest campaign isn't a close — property is active/off-market
  if (kind !== CLOSE_KIND_FOR[forKind]) return null; // defensive: feed status vs type mismatch
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
