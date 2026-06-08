import { describe, it, expect } from 'vitest';
import { mapStatus, normalizeCampaign, normalizeCampaigns, type RawVowCampaign } from './normalize';

describe('mapStatus', () => {
  it('maps the real VOW status pairs', () => {
    expect(mapStatus('Active', 'New')).toBe('Active');
    expect(mapStatus('Cancelled', 'Terminated')).toBe('Terminated');
    expect(mapStatus('Expired', 'Expired')).toBe('Expired');
    expect(mapStatus('Closed', 'Sold')).toBe('Sold');
    expect(mapStatus('Suspended', 'Suspended')).toBe('Suspended');
  });
  it('treats Sold/Closed with highest precedence', () => {
    expect(mapStatus('Closed', 'Terminated')).toBe('Sold');
  });
});

describe('normalizeCampaign', () => {
  it('normalizes a terminated sale with a real end date', () => {
    const raw: RawVowCampaign = {
      ListingKey: 'N13135326', StandardStatus: 'Cancelled', MlsStatus: 'Terminated',
      TransactionType: 'For Sale', OriginalEntryTimestamp: '2026-05-15T17:38:46Z',
      ListPrice: 1850000, OriginalListPrice: 1699900, TerminatedDate: '2026-06-04',
      PriceChangeTimestamp: '2026-05-27T12:53:06Z', ListOfficeName: 'ACME REALTY',
      UnparsedAddress: '363 Maria Antonia Road, Vaughan, ON L4H 0X5',
    };
    const e = normalizeCampaign(raw)!;
    expect(e.transaction_type).toBe('Sale');
    expect(e.status).toBe('Terminated');
    expect(e.end_date).toBe('2026-06-04');
    expect(e.end_reason).toBe('Terminated');
    expect(e.original_list_price).toBe(1699900);
    expect(e.price_change_date).toBe('2026-05-27T12:53:06Z');
    expect(e.brokerage).toBe('ACME REALTY');
  });

  it('emits no price_change_date when list == original', () => {
    const e = normalizeCampaign({
      ListingKey: 'X', StandardStatus: 'Active', MlsStatus: 'New', TransactionType: 'For Sale',
      ListPrice: 500000, OriginalListPrice: 500000,
    })!;
    expect(e.price_change_date).toBeNull();
    expect(e.end_date).toBeNull();
    expect(e.end_reason).toBeNull();
  });

  it('returns null when ListingKey is missing, never throws on sparse input', () => {
    expect(normalizeCampaign({})).toBeNull();
    expect(() => normalizeCampaign({ ListingKey: 'Y' })).not.toThrow();
  });

  it('classifies For Lease as Lease', () => {
    const e = normalizeCampaign({ ListingKey: 'L', TransactionType: 'For Lease', StandardStatus: 'Expired', MlsStatus: 'Expired', ExpirationDate: '2025-10-30' })!;
    expect(e.transaction_type).toBe('Lease');
    expect(e.status).toBe('Expired');
    expect(e.end_date).toBe('2025-10-30');
  });
});

describe('normalizeCampaigns', () => {
  it('drops unkeyed rows and sorts newest-first by entry_date', () => {
    const out = normalizeCampaigns([
      { ListingKey: 'A', TransactionType: 'For Sale', StandardStatus: 'Active', MlsStatus: 'New', OriginalEntryTimestamp: '2025-01-01T00:00:00Z' },
      {},
      { ListingKey: 'B', TransactionType: 'For Sale', StandardStatus: 'Active', MlsStatus: 'New', OriginalEntryTimestamp: '2026-01-01T00:00:00Z' },
    ]);
    expect(out.map((e) => e.listing_key)).toEqual(['B', 'A']);
  });
});
