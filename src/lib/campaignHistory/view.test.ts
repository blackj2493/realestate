import { describe, it, expect } from 'vitest';
import { toCampaignHistoryView, gateCampaignHistory, latestCloseFromCampaigns } from './view';
import type { CampaignHistoryRow } from './store';
import type { CampaignEvent } from './types';

const events: CampaignEvent[] = [
  { listing_key: 'A', transaction_type: 'Sale', status: 'Active', entry_date: '2026-06-06T00:00:00Z', end_date: null, end_reason: null, list_price: 800000, original_list_price: 800000, close_price: null, brokerage: 'ACME', price_change_date: null, address: '1 Main St' },
];
const row: CampaignHistoryRow = {
  property_hash: 'h', events, true_dom: 24, total_price_drop: 50000,
  lease_true_dom: 0, lease_total_price_drop: 0,
  campaign_count: 7, first_seen_date: '2025-06-10', is_stale: false, fetched_at: '2026-06-08T18:00:00.000Z',
};

describe('toCampaignHistoryView', () => {
  it('maps a row to the client view', () => {
    const v = toCampaignHistoryView(row);
    expect(v).toEqual({ available: true, campaignCount: 7, trueDom: 24, totalPriceDrop: 50000, firstSeenDate: '2025-06-10', events });
  });
  it('returns an empty view for a null row', () => {
    expect(toCampaignHistoryView(null)).toEqual({ available: false, campaignCount: 0, trueDom: null, totalPriceDrop: 0, firstSeenDate: null, events: [] });
  });
  it('available is false when there are no events', () => {
    expect(toCampaignHistoryView({ ...row, events: [] }).available).toBe(false);
  });
});

describe('gateCampaignHistory', () => {
  it('returns the full view for authed users', () => {
    const v = toCampaignHistoryView(row);
    expect(gateCampaignHistory(v, true)).toBe(v);
  });
  it('strips VOW-sensitive parts for anon, keeping the count + first-seen teaser', () => {
    const gated = gateCampaignHistory(toCampaignHistoryView(row), false);
    expect(gated).toEqual({ available: true, campaignCount: 7, trueDom: null, totalPriceDrop: 0, firstSeenDate: '2025-06-10', events: [] });
  });
});

describe('latestCloseFromCampaigns — terminate→relist→sold reconciliation', () => {
  const ev = (over: Partial<CampaignEvent>): CampaignEvent => ({
    listing_key: 'X', transaction_type: 'Sale', status: 'Active', entry_date: null, end_date: null,
    end_reason: null, list_price: null, original_list_price: null, close_price: null, brokerage: null,
    price_change_date: null, address: null, ...over,
  });

  // 7 Stemford Rd: original terminated May 31, relist sold Jun 12 $885k.
  const terminated = ev({ listing_key: 'W13090288', status: 'Terminated', end_reason: 'Terminated', entry_date: '2026-05-06', end_date: '2026-05-31', list_price: 925000 });
  const soldRelist = ev({ listing_key: 'W13224994', status: 'Sold', end_reason: 'Sold', entry_date: '2026-06-01', end_date: '2026-06-12', list_price: 910000, close_price: 885000 });

  it('returns the relist close when it is the newest campaign (order-independent)', () => {
    const expected = { listingKey: 'W13224994', kind: 'sold', closePrice: 885000, closeDateISO: '2026-06-12' };
    expect(latestCloseFromCampaigns([terminated, soldRelist])).toEqual(expected);
    expect(latestCloseFromCampaigns([soldRelist, terminated])).toEqual(expected); // sort, not input order
  });

  it('returns null when the newest campaign is not a close (sold, then relisted active)', () => {
    const activeAfterSale = ev({ listing_key: 'W99', status: 'Active', entry_date: '2026-07-01', end_date: null });
    expect(latestCloseFromCampaigns([terminated, soldRelist, activeAfterSale])).toBeNull();
  });

  it('handles leases (kind = leased)', () => {
    const leased = ev({ listing_key: 'L1', transaction_type: 'Lease', status: 'Leased', end_reason: 'Leased', end_date: '2026-06-20', close_price: 3200 });
    expect(latestCloseFromCampaigns([leased])).toMatchObject({ kind: 'leased', closePrice: 3200 });
  });

  it('returns null on no events, a lone terminated, or a close with no disclosed price', () => {
    expect(latestCloseFromCampaigns([])).toBeNull();
    expect(latestCloseFromCampaigns([terminated])).toBeNull();
    expect(latestCloseFromCampaigns([ev({ status: 'Sold', end_reason: 'Sold', end_date: '2026-06-12', close_price: 0 })])).toBeNull();
  });
});
