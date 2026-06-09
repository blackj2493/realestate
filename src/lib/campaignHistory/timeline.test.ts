import { describe, it, expect } from 'vitest';
import { buildEventRows, buildSaleChartSeries } from './timeline';
import type { CampaignEvent } from './types';

const NOW = Date.parse('2026-06-08T18:00:00Z');
const ev = (p: Partial<CampaignEvent>): CampaignEvent => ({
  listing_key: 'k', transaction_type: 'Sale', status: 'Terminated',
  entry_date: null, end_date: null, end_reason: null, list_price: null,
  original_list_price: null, close_price: null, brokerage: null,
  price_change_date: null, address: null, ...p,
});

const chain363: CampaignEvent[] = [
  ev({ listing_key: 'N13410488', status: 'Active', entry_date: '2026-06-06T14:46:17Z', list_price: 1729000, original_list_price: 1729000 }),
  ev({ listing_key: 'N13135326', status: 'Terminated', entry_date: '2026-05-15T17:38:46Z', end_date: '2026-06-04', list_price: 1850000, original_list_price: 1699900, price_change_date: '2026-05-27T12:53:06Z' }),
  ev({ listing_key: 'N12409326', status: 'Terminated', entry_date: '2025-09-17T15:32:06Z', end_date: '2025-10-15', list_price: 1990000, original_list_price: 1990000 }),
  ev({ listing_key: 'N12656610', transaction_type: 'Lease', status: 'Expired', entry_date: '2026-01-02T17:40:02Z', end_date: '2026-03-02', list_price: 5000 }),
];

describe('buildEventRows', () => {
  const rows = buildEventRows(chain363);
  it('explodes campaigns into newest-first timeline rows', () => {
    expect(rows[0].listingKey).toBe('N13410488');
    expect(rows[0].kind).toBe('Listed for Sale');
  });
  it('emits a Price Changed row when a campaign changed price', () => {
    const pc = rows.find((r) => r.listingKey === 'N13135326' && r.kind === 'Price Changed');
    expect(pc).toBeTruthy();
    expect(pc!.price).toBe(1850000);
  });
  it('emits a terminal row (Terminated) with the end date', () => {
    const term = rows.find((r) => r.listingKey === 'N12409326' && r.kind === 'Terminated');
    expect(term).toBeTruthy();
    expect(term!.date.slice(0, 10)).toBe('2025-10-15');
  });
  it('labels lease listings as Listed for Lease', () => {
    expect(rows.some((r) => r.listingKey === 'N12656610' && r.kind === 'Listed for Lease')).toBe(true);
  });
});

describe('buildSaleChartSeries', () => {
  const s = buildSaleChartSeries(chain363, { nowMs: NOW });
  it('marks the stitched current-campaign window (2026-05-15 → now)', () => {
    expect(s.stitchStartT).toBe(Date.parse('2026-05-15T17:38:46Z'));
    expect(s.stitchEndT).toBe(NOW);
  });
  it('inserts an off-market gap (null price) between the 2025 and 2026 sale efforts', () => {
    expect(s.points.some((p) => p.price === null)).toBe(true);
  });
  it('excludes lease prices from the price points (scale separation)', () => {
    expect(s.points.every((p) => p.price === null || p.price >= 1000000)).toBe(true);
    expect(s.leasePeriods.length).toBe(1);
  });
  it('emits event markers for listed/terminated', () => {
    expect(s.markers.length).toBeGreaterThan(0);
  });
});
