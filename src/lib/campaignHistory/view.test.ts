import { describe, it, expect } from 'vitest';
import { toCampaignHistoryView, gateCampaignHistory } from './view';
import type { CampaignHistoryRow } from './store';
import type { CampaignEvent } from './types';

const events: CampaignEvent[] = [
  { listing_key: 'A', transaction_type: 'Sale', status: 'Active', entry_date: '2026-06-06T00:00:00Z', end_date: null, end_reason: null, list_price: 800000, original_list_price: 800000, close_price: null, brokerage: 'ACME', price_change_date: null, address: '1 Main St' },
];
const row: CampaignHistoryRow = {
  property_hash: 'h', events, true_dom: 24, total_price_drop: 50000,
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
