import { describe, it, expect } from 'vitest';
import { buildEventRows, buildSaleChartSeries, buildCampaignBars, buildSalePricePath, summarizeSaleHistory } from './timeline';
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

describe('buildCampaignBars', () => {
  const bars = buildCampaignBars(chain363, { nowMs: NOW });
  it('emits one bar per campaign, oldest → newest', () => {
    expect(bars.map((b) => b.listingKey)).toEqual(['N12409326', 'N12656610', 'N13135326', 'N13410488']);
  });
  it('flags the stitched recent sale campaigns as current, and the lone 2025 effort as not', () => {
    const current = new Set(bars.filter((b) => b.isCurrent).map((b) => b.listingKey));
    expect(current).toEqual(new Set(['N13135326', 'N13410488']));
    expect(bars.find((b) => b.listingKey === 'N12409326')!.isCurrent).toBe(false);
  });
  it('keeps the lease campaign as its own kind (not current)', () => {
    const lease = bars.find((b) => b.listingKey === 'N12656610')!;
    expect(lease.kind).toBe('Lease');
    expect(lease.isCurrent).toBe(false);
  });
  it('captures a price change as start→end on the bar', () => {
    const b = bars.find((b) => b.listingKey === 'N13135326')!;
    expect(b.priceChanged).toBe(true);
    expect(b.startPrice).toBe(1699900);
    expect(b.endPrice).toBe(1850000);
  });
  it('extends an Active campaign to nowMs', () => {
    expect(bars.find((b) => b.listingKey === 'N13410488')!.endMs).toBe(NOW);
  });
});

describe('buildSalePricePath', () => {
  const path = buildSalePricePath(chain363, { nowMs: NOW });
  it('excludes lease prices entirely', () => {
    expect(path.every((p) => p.price >= 1000000)).toBe(true);
  });
  it('orders sale price events: $1.99M → $1.6999M → $1.85M → $1.729M', () => {
    expect(path.map((p) => p.price)).toEqual([1990000, 1699900, 1850000, 1729000]);
  });
  it('dashes across the long off-market gap, but keeps the stitched relist continuous', () => {
    const byKey = (k: string) => path.filter((p) => p.listingKey === k);
    // first point of the May campaign follows the ~7-month lease gap → dashed
    expect(byKey('N13135326')[0].offMarketBefore).toBe(true);
    // the Jun relist is stitched to it (2-day gap, same True DOM span) → solid
    expect(byKey('N13410488')[0].offMarketBefore).toBe(false);
  });
  it("decorates each campaign's last point with its end status", () => {
    expect(path[0].endStatus).toBe('Terminated');        // 2025 effort
    expect(path[2].endStatus).toBe('Terminated');        // May campaign (after the +9% change)
    expect(path[3].endStatus).toBe('Active');            // current
    expect(path[1].endStatus).toBeNull();                // mid-campaign listed point
  });
});

describe('summarizeSaleHistory', () => {
  it('reports original (first sale list) → current (latest sale list) and the % cut', () => {
    const s = summarizeSaleHistory(chain363);
    expect(s.originalSalePrice).toBe(1990000);
    expect(s.currentSalePrice).toBe(1729000);
    expect(s.dropPct).toBeCloseTo((1729000 - 1990000) / 1990000, 5);
  });
  it('returns nulls when there are no sale campaigns', () => {
    expect(summarizeSaleHistory([])).toEqual({ originalSalePrice: null, currentSalePrice: null, dropPct: null });
  });
});
