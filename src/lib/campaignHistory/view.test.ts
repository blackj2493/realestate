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
    expect(latestCloseFromCampaigns([terminated, soldRelist], 'Sale')).toEqual(expected);
    expect(latestCloseFromCampaigns([soldRelist, terminated], 'Sale')).toEqual(expected); // sort, not input order
  });

  it('returns null when the newest campaign is not a close (sold, then relisted active)', () => {
    const activeAfterSale = ev({ listing_key: 'W99', status: 'Active', entry_date: '2026-07-01', end_date: null });
    expect(latestCloseFromCampaigns([terminated, soldRelist, activeAfterSale], 'Sale')).toBeNull();
  });

  it('handles leases (kind = leased) for a Lease campaign', () => {
    const leased = ev({ listing_key: 'L1', transaction_type: 'Lease', status: 'Leased', end_reason: 'Leased', end_date: '2026-06-20', close_price: 3200 });
    expect(latestCloseFromCampaigns([leased], 'Lease')).toMatchObject({ kind: 'leased', closePrice: 3200 });
  });

  it('returns null on no events, a lone terminated, or a close with no disclosed price', () => {
    expect(latestCloseFromCampaigns([], 'Sale')).toBeNull();
    expect(latestCloseFromCampaigns([terminated], 'Sale')).toBeNull();
    expect(latestCloseFromCampaigns([ev({ status: 'Sold', end_reason: 'Sold', end_date: '2026-06-12', close_price: 0 })], 'Sale')).toBeNull();
  });

  // A close of the OTHER transaction type is a different deal on the same bricks. Before
  // this guard, a terminated SALE at a later-leased property rendered "LEASED $1,900" with
  // the rent in the sale-price slot ("0.1% of ask") and fed the accuracy receipt a ~$560k
  // estimate vs a $1,900 rent — 2,879 listing pages when measured 2026-08-04.
  describe('transaction-type scoping', () => {
    const leaseClose = ev({
      listing_key: 'L9', transaction_type: 'Lease', status: 'Leased', end_reason: 'Leased',
      entry_date: '2026-06-01', end_date: '2026-06-20', close_price: 1900,
    });

    it('a LEASE close never settles a terminated SALE campaign', () => {
      expect(latestCloseFromCampaigns([terminated, leaseClose], 'Sale')).toBeNull();
    });

    it('a SALE close never settles a terminated LEASE campaign', () => {
      const leaseTerminated = ev({
        listing_key: 'L8', transaction_type: 'Lease', status: 'Terminated', end_reason: 'Terminated',
        entry_date: '2026-04-01', end_date: '2026-04-30',
      });
      expect(latestCloseFromCampaigns([leaseTerminated, soldRelist], 'Lease')).toBeNull();
    });

    it('still promotes a genuine sale — the fix must not suppress the case it was built for', () => {
      expect(latestCloseFromCampaigns([terminated, soldRelist], 'Sale')).toMatchObject({
        kind: 'sold',
        closePrice: 885000,
      });
    });

    it('the SAME events resolve differently per campaign type', () => {
      const both = [terminated, leaseClose];
      expect(latestCloseFromCampaigns(both, 'Sale')).toBeNull();
      expect(latestCloseFromCampaigns(both, 'Lease')).toMatchObject({ kind: 'leased', closePrice: 1900 });
    });

    it('an unrelated later lease does NOT mask a real sale', () => {
      // Sold Jun 12, then the new owner rents it out Jun 20. Scoping to the Sale campaign
      // line keeps the page on SOLD — the lease was never part of the sale's story.
      expect(latestCloseFromCampaigns([terminated, soldRelist, leaseClose], 'Sale')).toMatchObject({
        kind: 'sold',
        closePrice: 885000,
      });
    });

    it('still rejects sold-then-relisted-active WITHIN the sale line', () => {
      const activeAgain = ev({ listing_key: 'W99', status: 'Active', entry_date: '2026-07-01', end_date: null });
      expect(
        latestCloseFromCampaigns([terminated, soldRelist, leaseClose, activeAgain], 'Sale')
      ).toBeNull();
    });

    it('returns null when the property has no campaign of the asked-for type', () => {
      expect(latestCloseFromCampaigns([leaseClose], 'Sale')).toBeNull();
      expect(latestCloseFromCampaigns([terminated, soldRelist], 'Lease')).toBeNull();
    });

    it('rejects the feed quirk: a LEASE campaign stamped "Sold" (178 pages showed a rent as SOLD)', () => {
      // Real shape — X13131816, a $2,800 lease at 618 Taliesin Cres, arrived status=Sold.
      const leaseStampedSold = ev({
        listing_key: 'X13131816', transaction_type: 'Lease', status: 'Sold', end_reason: 'Sold',
        entry_date: '2026-05-12', end_date: '2026-06-01', list_price: 2800, close_price: 2800,
      });
      const saleTerminated = ev({
        listing_key: 'X12942800', status: 'Terminated', end_reason: 'Terminated',
        entry_date: '2026-04-01', end_date: '2026-05-11', list_price: 665000,
      });
      // Never surfaces on the sale page (it is not in the Sale line at all)…
      expect(latestCloseFromCampaigns([saleTerminated, leaseStampedSold], 'Sale')).toBeNull();
      // …and the type/status contradiction is rejected on the lease side too, rather than
      // trusted enough to put 2800 in a close-price slot.
      expect(latestCloseFromCampaigns([leaseStampedSold], 'Lease')).toBeNull();
    });
  });
});
