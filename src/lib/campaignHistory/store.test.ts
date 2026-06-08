import { describe, it, expect } from 'vitest';
import { mergeSubjectEvent, buildCampaignHistoryRow } from './store';
import type { CampaignEvent } from './types';

const NOW = Date.parse('2026-06-08T18:00:00Z');
const ev = (p: Partial<CampaignEvent>): CampaignEvent => ({
  listing_key: 'k', transaction_type: 'Sale', status: 'Terminated',
  entry_date: null, end_date: null, end_reason: null, list_price: null,
  original_list_price: null, close_price: null, brokerage: null,
  price_change_date: null, address: null, ...p,
});

describe('mergeSubjectEvent', () => {
  it('adds the subject when absent and sorts newest-first', () => {
    const subject = ev({ listing_key: 'NEW', entry_date: '2026-06-06T00:00:00Z' });
    const out = mergeSubjectEvent([ev({ listing_key: 'OLD', entry_date: '2026-01-01T00:00:00Z' })], subject);
    expect(out.map((e) => e.listing_key)).toEqual(['NEW', 'OLD']);
  });
  it('lets the subject win over a duplicate listing_key from the feed', () => {
    const subject = ev({ listing_key: 'X', list_price: 999, entry_date: '2026-06-06T00:00:00Z' });
    const feed = ev({ listing_key: 'X', list_price: 111, entry_date: '2026-06-06T00:00:00Z' });
    const out = mergeSubjectEvent([feed], subject);
    expect(out).toHaveLength(1);
    expect(out[0].list_price).toBe(999);
  });
  it('returns feed events unchanged when subject is null', () => {
    const out = mergeSubjectEvent([ev({ listing_key: 'A', entry_date: '2026-01-01T00:00:00Z' })], null);
    expect(out.map((e) => e.listing_key)).toEqual(['A']);
  });
});

describe('buildCampaignHistoryRow', () => {
  const chain363: CampaignEvent[] = [
    ev({ listing_key: 'N13410488', status: 'Active', entry_date: '2026-06-06T14:46:17Z', list_price: 1729000, original_list_price: 1729000 }),
    ev({ listing_key: 'N13135326', status: 'Terminated', entry_date: '2026-05-15T17:38:46Z', end_date: '2026-06-04', list_price: 1850000, original_list_price: 1699900 }),
    ev({ listing_key: 'N12209050', transaction_type: 'Lease', status: 'Terminated', entry_date: '2025-06-10T13:28:48Z', end_date: '2025-08-07', list_price: 5300 }),
  ];
  const row = buildCampaignHistoryRow('hash363', chain363, { nowMs: NOW });

  it('keys the row and carries the event array', () => {
    expect(row.property_hash).toBe('hash363');
    expect(row.events).toHaveLength(3);
  });
  it('computes the engine metrics (sale-only true_dom, all-campaign count)', () => {
    expect(row.true_dom).toBe(24);
    expect(row.campaign_count).toBe(3);
    expect(row.total_price_drop).toBe(0);
    expect(row.is_stale).toBe(false);
  });
  it('sets first_seen_date to the oldest entry (date only)', () => {
    expect(row.first_seen_date).toBe('2025-06-10');
  });
  it('stamps fetched_at from the injected now', () => {
    expect(row.fetched_at).toBe('2026-06-08T18:00:00.000Z');
  });
});
