// scripts/worker/delistedMapper.test.ts
import { describe, it, expect } from 'vitest';
import {
  delistedEventDate,
  extractDelistedRecord,
  toDelistedDocument,
  type DelistedRecord,
} from './delistedMapper';

const NOW = new Date('2026-06-09T12:00:00Z').getTime();

describe('delistedEventDate', () => {
  it('prefers the status-specific date field', () => {
    expect(
      delistedEventDate(
        { MlsStatus: 'Terminated', TerminatedDate: '2026-05-22', ModificationTimestamp: '2026-05-23T10:00:00Z' },
        NOW
      )
    ).toBe('2026-05-22');
    expect(
      delistedEventDate(
        { MlsStatus: 'Expired', ExpirationDate: '2026-04-30', ModificationTimestamp: '2026-05-01T05:15:22Z' },
        NOW
      )
    ).toBe('2026-04-30');
    expect(
      delistedEventDate(
        { MlsStatus: 'Suspended', SuspendedDate: '2026-04-07', ModificationTimestamp: '2026-04-07T22:52:33Z' },
        NOW
      )
    ).toBe('2026-04-07');
  });

  it('falls back to the ModificationTimestamp date when the specific field is missing', () => {
    expect(
      delistedEventDate({ MlsStatus: 'Terminated', ModificationTimestamp: '2026-06-03T17:21:00Z' }, NOW)
    ).toBe('2026-06-03');
  });

  it('rejects a FUTURE specific date (e.g. Suspended rows carry a future ExpirationDate) in favour of the mod date', () => {
    expect(
      delistedEventDate(
        { MlsStatus: 'Suspended', SuspendedDate: '2026-12-31', ModificationTimestamp: '2026-04-21T18:58:39Z' },
        NOW
      )
    ).toBe('2026-04-21');
  });

  it('returns null when nothing parses', () => {
    expect(delistedEventDate({ MlsStatus: 'Terminated' }, NOW)).toBeNull();
  });
});

const RAW_TERMINATED = {
  ListingKey: 'X12886256',
  MlsStatus: 'Terminated',
  StandardStatus: 'Active Under Contract',
  TransactionType: 'For Sale',
  TerminatedDate: '2026-05-22',
  ExpirationDate: '2026-08-31',
  ModificationTimestamp: '2026-05-22T20:29:14Z',
  ListingContractDate: '2026-03-01',
  ListPrice: 899000,
  OriginalListPrice: 949000,
  DaysOnMarket: 47,
  UnparsedAddress: '19 Hossie Terrace, Stratford, ON N5A 8B6',
  City: 'Stratford',
  CityRegion: 'Downtown',
  PostalCode: 'N5A',
  PropertySubType: 'Detached',
  BedroomsAboveGrade: 3,
  BathroomsTotalInteger: 2.5,
  ParkingTotal: 4,
  ListOfficeName: 'Acme Realty',
};

describe('extractDelistedRecord', () => {
  it('maps a terminated raw listing to a slim record', () => {
    const r = extractDelistedRecord(RAW_TERMINATED, NOW)!;
    expect(r).not.toBeNull();
    expect(r.listing_key).toBe('X12886256');
    expect(r.mls_status).toBe('Terminated');
    expect(r.deal_type).toBe('terminated');
    expect(r.delisted_date).toBe('2026-05-22');
    expect(r.list_price).toBe(899000);
    expect(r.original_list_price).toBe(949000);
    expect(r.days_on_market).toBe(47);
    expect(r.transaction_type).toBe('For Sale');
    expect(r.list_office_name).toBe('Acme Realty');
    // Full postal parsed from the address, not the FSA-only PostalCode field.
    expect(r.postal_code).toBe('N5A 8B6');
  });

  it('maps an expired raw listing — deal_type expired, delisted_date = ExpirationDate', () => {
    const r = extractDelistedRecord(
      {
        ...RAW_TERMINATED,
        MlsStatus: 'Expired',
        TerminatedDate: undefined,
        ExpirationDate: '2026-04-30',
        ModificationTimestamp: '2026-05-01T05:15:22Z',
      },
      NOW
    )!;
    expect(r).not.toBeNull();
    expect(r.deal_type).toBe('expired');
    expect(r.delisted_date).toBe('2026-04-30');
  });

  it('expired with a FUTURE ExpirationDate falls back to the ModificationTimestamp date', () => {
    const r = extractDelistedRecord(
      {
        ...RAW_TERMINATED,
        MlsStatus: 'Expired',
        TerminatedDate: undefined,
        ExpirationDate: '2026-12-31',
        ModificationTimestamp: '2026-05-18T09:30:00Z',
      },
      NOW
    )!;
    expect(r).not.toBeNull();
    expect(r.deal_type).toBe('expired');
    expect(r.delisted_date).toBe('2026-05-18');
  });

  it('maps a suspended raw listing — deal_type suspended, delisted_date = SuspendedDate', () => {
    const r = extractDelistedRecord(
      {
        ...RAW_TERMINATED,
        MlsStatus: 'Suspended',
        TerminatedDate: undefined,
        SuspendedDate: '2026-04-07',
        ModificationTimestamp: '2026-04-07T22:52:33Z',
      },
      NOW
    )!;
    expect(r).not.toBeNull();
    expect(r.deal_type).toBe('suspended');
    expect(r.delisted_date).toBe('2026-04-07');
  });

  it('falls back to ListingId when ListingKey is missing', () => {
    const r = extractDelistedRecord(
      { ...RAW_TERMINATED, ListingKey: undefined, ListingId: 'W99887766' },
      NOW
    )!;
    expect(r).not.toBeNull();
    expect(r.listing_key).toBe('W99887766');
  });

  it('joins the address from street components when UnparsedAddress is null', () => {
    const r = extractDelistedRecord(
      {
        ...RAW_TERMINATED,
        UnparsedAddress: null,
        StreetNumber: '19',
        StreetName: 'Hossie Terrace',
        UnitNumber: undefined,
      },
      NOW
    )!;
    expect(r).not.toBeNull();
    expect(r.unparsed_address).toBe('19 Hossie Terrace');
  });

  it('returns null for non-delisted statuses and for missing event dates', () => {
    expect(extractDelistedRecord({ ...RAW_TERMINATED, MlsStatus: 'Sold' }, NOW)).toBeNull();
    expect(
      extractDelistedRecord(
        { ...RAW_TERMINATED, TerminatedDate: undefined, ModificationTimestamp: undefined },
        NOW
      )
    ).toBeNull();
  });
});

describe('toDelistedDocument', () => {
  const record: DelistedRecord = extractDelistedRecord(RAW_TERMINATED, NOW)!;

  it('builds a strict-schema sold_listings doc with DealType = reason and ClosePrice 0', () => {
    const doc = toDelistedDocument(record)!;
    expect(doc.id).toBe('X12886256');
    expect(doc.DealType).toBe('terminated');
    expect(doc.ClosePrice).toBe(0);
    expect(doc.ListPrice).toBe(899000);
    expect(doc.OriginalListPrice).toBe(949000);
    expect(doc.DaysOnMarket).toBe(47);
    expect(doc.TransactionType).toBe('For Sale');
    // Brokerage display is a TRREB §4 compliance field — pin it.
    expect(doc.ListOfficeName).toBe('Acme Realty');
    expect(doc.PurchaseContractDate).toBe(new Date('2026-05-22').getTime());
    // Strict-schema required fields all present with fallbacks:
    expect(doc.BuildingAreaTotal).toBe(0);
    expect(doc.LotWidth).toBe(0);
    expect(doc.BasementTier).toBe(0);
  });

  it('returns null without a listing key', () => {
    expect(toDelistedDocument({ ...record, listing_key: '' })).toBeNull();
  });
});
