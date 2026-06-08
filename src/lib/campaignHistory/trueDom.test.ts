import { describe, it, expect } from 'vitest';
import { computeTrueDomFromCampaigns } from './trueDom';
import type { CampaignEvent } from './types';

const NOW = Date.parse('2026-06-08T18:00:00Z'); // past the 17:38Z entry-of-day so 363 floors to exactly 24
const ev = (p: Partial<CampaignEvent>): CampaignEvent => ({
  listing_key: 'k', transaction_type: 'Sale', status: 'Terminated',
  entry_date: null, end_date: null, end_reason: null, list_price: null,
  original_list_price: null, close_price: null, brokerage: null,
  price_change_date: null, address: null, ...p,
});

// The real 363 Maria Antonia chain (sale + lease), newest-first.
const chain363: CampaignEvent[] = [
  ev({ listing_key: 'N13410488', status: 'Active', entry_date: '2026-06-06T14:46:17Z', end_date: null, end_reason: null, list_price: 1729000, original_list_price: 1729000 }),
  ev({ listing_key: 'N13135326', status: 'Terminated', entry_date: '2026-05-15T17:38:46Z', end_date: '2026-06-04', list_price: 1850000, original_list_price: 1699900 }),
  ev({ listing_key: 'N12656610', transaction_type: 'Lease', status: 'Expired', entry_date: '2026-01-02T17:40:02Z', end_date: '2026-03-02', list_price: 5000 }),
  ev({ listing_key: 'N12500658', transaction_type: 'Lease', status: 'Expired', entry_date: '2025-11-02T16:02:46Z', end_date: '2025-12-31', list_price: 5000 }),
  ev({ listing_key: 'N12409326', status: 'Terminated', entry_date: '2025-09-17T15:32:06Z', end_date: '2025-10-15', list_price: 1990000, original_list_price: 1990000 }),
  ev({ listing_key: 'N12343968', transaction_type: 'Lease', status: 'Expired', entry_date: '2025-08-14T14:08:06Z', end_date: '2025-10-30', list_price: 5300 }),
  ev({ listing_key: 'N12209050', transaction_type: 'Lease', status: 'Terminated', entry_date: '2025-06-10T13:28:48Z', end_date: '2025-08-07', list_price: 5300 }),
];

describe('computeTrueDomFromCampaigns — 363 Maria Antonia', () => {
  const r = computeTrueDomFromCampaigns(chain363, { nowMs: NOW });

  it('stitches the current sale campaign (05-15 -> now), not the 2025 effort', () => {
    expect(r.true_dom).toBe(24); // 2026-05-15 -> 2026-06-08
  });
  it('counts every campaign for the "listed N times" signal', () => {
    expect(r.campaign_count).toBe(7);
  });
  it('reports no drop (they raised the ask)', () => {
    expect(r.total_price_drop).toBe(0);
  });
  it('is not stale below 60 days', () => {
    expect(r.is_stale).toBe(false);
  });
});

describe('computeTrueDomFromCampaigns — edges', () => {
  it('a fresh active listing with no prior ≈ its own age', () => {
    const r = computeTrueDomFromCampaigns(
      [ev({ listing_key: 'F', status: 'Active', entry_date: '2026-06-06T00:00:00Z', list_price: 800000 })],
      { nowMs: NOW }
    );
    expect(r.true_dom).toBe(2);
    expect(r.campaign_count).toBe(1);
  });

  it('breaks the chain when the gap exceeds the window', () => {
    const r = computeTrueDomFromCampaigns(
      [
        ev({ listing_key: 'N', status: 'Active', entry_date: '2026-06-06T00:00:00Z', list_price: 900000, original_list_price: 900000 }),
        ev({ listing_key: 'O', status: 'Terminated', entry_date: '2026-01-01T00:00:00Z', end_date: '2026-02-01', list_price: 950000, original_list_price: 950000 }),
      ],
      { nowMs: NOW }
    );
    expect(r.true_dom).toBe(2); // prior ended 2026-02-01, gap > 35d -> not stitched
  });

  it('stitches a prior within the window and surfaces the drop', () => {
    const r = computeTrueDomFromCampaigns(
      [
        ev({ listing_key: 'N', status: 'Active', entry_date: '2026-06-06T00:00:00Z', list_price: 800000, original_list_price: 800000 }),
        ev({ listing_key: 'O', status: 'Terminated', entry_date: '2026-05-10T00:00:00Z', end_date: '2026-05-20', list_price: 900000, original_list_price: 900000 }),
      ],
      { nowMs: NOW }
    );
    expect(r.true_dom).toBe(29);            // 2026-05-10 -> 2026-06-08
    expect(r.total_price_drop).toBe(100000); // 900k -> 800k
  });

  it('excludes lease campaigns from the sale True DOM', () => {
    const r = computeTrueDomFromCampaigns(
      [
        ev({ listing_key: 'S', status: 'Active', entry_date: '2026-06-06T00:00:00Z', list_price: 800000 }),
        ev({ listing_key: 'L', transaction_type: 'Lease', status: 'Expired', entry_date: '2026-05-01T00:00:00Z', end_date: '2026-05-30', list_price: 3000 }),
      ],
      { nowMs: NOW }
    );
    expect(r.true_dom).toBe(2);       // lease ignored for the number
    expect(r.campaign_count).toBe(2); // but still counted in the timeline tally
  });

  it('returns zero true_dom when there is no sale campaign', () => {
    const r = computeTrueDomFromCampaigns(
      [ev({ listing_key: 'L', transaction_type: 'Lease', status: 'Active', entry_date: '2026-06-01T00:00:00Z', list_price: 3000 })],
      { nowMs: NOW }
    );
    expect(r.true_dom).toBe(0);
    expect(r.campaign_count).toBe(1);
  });
});
