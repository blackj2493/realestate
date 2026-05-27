import { describe, it, expect } from 'vitest';
import {
  generatePropertyHash,
  generateLooseKey,
  unitsMatchForMerge,
  resolveHistoricalCandidates,
  parseTimestamp,
  daysBetween,
  calculateTrueDOM,
  groupHistoricalByHash,
  type HistoricalListing,
  type CurrentListingInput,
  type LooseCandidate,
  STITCH_WINDOW_DAYS,
  STALE_THRESHOLD_DAYS,
} from './TemporalDistressEngine';

const DAY_MS = 86_400_000;

describe('generatePropertyHash', () => {
  it('is deterministic — same address yields identical hash', () => {
    const a = {
      UnitNumber: '1605',
      StreetNumber: '12',
      StreetName: 'King Street West',
      City: 'Toronto',
    };
    expect(generatePropertyHash(a)).toBe(generatePropertyHash({ ...a }));
  });

  it('returns a 64-char SHA-256 hex digest', () => {
    const h = generatePropertyHash({ StreetNumber: '12', StreetName: 'Main', City: 'Toronto' });
    expect(h).toMatch(/^[a-f0-9]{64}$/);
  });

  it('is case-insensitive across street name + city', () => {
    const lower = {
      UnitNumber: '1605',
      StreetNumber: '12',
      StreetName: 'king street west',
      City: 'toronto',
    };
    const upper = {
      UnitNumber: '1605',
      StreetNumber: '12',
      StreetName: 'KING STREET WEST',
      City: 'TORONTO',
    };
    expect(generatePropertyHash(lower)).toBe(generatePropertyHash(upper));
  });

  it('different unit at the same address → different hash', () => {
    const base = {
      StreetNumber: '12',
      StreetName: 'King Street West',
      City: 'Toronto',
    };
    expect(generatePropertyHash({ ...base, UnitNumber: '1605' })).not.toBe(
      generatePropertyHash({ ...base, UnitNumber: '1606' })
    );
  });

  it('falls back to UnparsedAddress when street components are missing', () => {
    const h1 = generatePropertyHash({
      UnparsedAddress: '40 Rampart Drive, Brampton, ON L6P 2Z1',
      City: 'Brampton',
    });
    expect(h1).toMatch(/^[a-f0-9]{64}$/);
    // Same listing, same hash.
    const h2 = generatePropertyHash({
      UnparsedAddress: '40 Rampart Drive, Brampton, ON L6P 2Z1',
      City: 'Brampton',
    });
    expect(h1).toBe(h2);
  });
});

describe('generateLooseKey', () => {
  it('strips the unit from the canonical key', () => {
    const a = generateLooseKey({
      UnitNumber: '1605',
      StreetNumber: '12',
      StreetName: 'King Street West',
      City: 'Toronto',
    });
    const b = generateLooseKey({
      UnitNumber: '1606',
      StreetNumber: '12',
      StreetName: 'King Street West',
      City: 'Toronto',
    });
    expect(a).toBe(b);
  });
});

describe('unitsMatchForMerge', () => {
  it('two condos with the same unit → match', () => {
    expect(
      unitsMatchForMerge(
        { UnitNumber: '1605', PropertySubType: 'Condo Apartment' },
        { UnitNumber: '1605', PropertySubType: 'Condo Apartment' }
      )
    ).toBe(true);
  });

  it('two condos with different units → must not merge', () => {
    expect(
      unitsMatchForMerge(
        { UnitNumber: '1605', PropertySubType: 'Condo Apartment' },
        { UnitNumber: '1606', PropertySubType: 'Condo Apartment' }
      )
    ).toBe(false);
  });

  it('condo with a unit + freehold without unit → must not merge', () => {
    expect(
      unitsMatchForMerge(
        { UnitNumber: '1605', PropertySubType: 'Condo Apartment' },
        { PropertySubType: 'Detached' }
      )
    ).toBe(false);
  });

  it('two freeholds with no unit on either side → compatible', () => {
    expect(
      unitsMatchForMerge(
        { PropertySubType: 'Detached' },
        { PropertySubType: 'Detached' }
      )
    ).toBe(true);
  });
});

describe('resolveHistoricalCandidates', () => {
  const houseA = {
    StreetNumber: '45',
    StreetName: 'Main Street North',
    City: 'Brampton',
    PropertySubType: 'Detached',
  };
  const current = { looseKey: generateLooseKey(houseA), matchFields: houseA };

  const baseLooseCand: LooseCandidate = {
    listing_key: 'OLD',
    property_hash: 'different_exact_hash',
    full_payload: {
      ListPrice: 900_000,
      OriginalEntryTimestamp: new Date(Date.now() - 80 * DAY_MS).toISOString(),
    },
    created_at: '',
    looseKey: generateLooseKey(houseA),
    matchFields: houseA,
  };

  it('includes a loose candidate when the loose key matches and guards pass', () => {
    const resolved = resolveHistoricalCandidates(current, [], [baseLooseCand]);
    expect(resolved.map((r) => r.listing_key)).toEqual(['OLD']);
  });

  it('rejects a loose candidate whose FSA disagrees', () => {
    const currentWithFsa = {
      ...current,
      matchFields: { ...houseA, PostalCode: 'L6P 2Z1' },
    };
    const candFarFsa: LooseCandidate = {
      ...baseLooseCand,
      matchFields: { ...houseA, PostalCode: 'L9X 1A1' },
    };
    expect(
      resolveHistoricalCandidates(currentWithFsa, [], [candFarFsa])
    ).toEqual([]);
  });

  it('preserves exact-hash matches and de-duplicates by listing_key', () => {
    const exact: HistoricalListing = {
      listing_key: 'EXACT',
      property_hash: 'whatever',
      full_payload: {},
      created_at: '',
    };
    const resolved = resolveHistoricalCandidates(
      current,
      [exact],
      [{ ...baseLooseCand, listing_key: 'EXACT' }] // same key as exact → must not duplicate
    );
    expect(resolved).toHaveLength(1);
    expect(resolved[0].listing_key).toBe('EXACT');
  });
});

describe('parseTimestamp', () => {
  it('parses ISO 8601 strings', () => {
    expect(parseTimestamp('2024-01-15T10:30:00Z')).toBe(
      Date.parse('2024-01-15T10:30:00Z')
    );
  });

  it('treats a 10-digit numeric string as Unix seconds', () => {
    expect(parseTimestamp('1705315800')).toBe(1705315800 * 1000);
  });

  it('treats a 13-digit numeric string as Unix milliseconds', () => {
    expect(parseTimestamp('1705315800000')).toBe(1705315800000);
  });

  it('returns null for garbage input', () => {
    expect(parseTimestamp('not-a-date')).toBeNull();
    expect(parseTimestamp(null)).toBeNull();
    expect(parseTimestamp(undefined)).toBeNull();
    expect(parseTimestamp('')).toBeNull();
  });
});

describe('daysBetween', () => {
  it('returns floored day count between two timestamps', () => {
    const now = Date.now();
    expect(daysBetween(now - 5 * DAY_MS, now)).toBe(5);
  });

  it('returns null when startMs is null', () => {
    expect(daysBetween(null)).toBeNull();
  });
});

describe('calculateTrueDOM', () => {
  it('returns just the current days when there is no history', () => {
    const current: CurrentListingInput = {
      listingKey: 'CUR',
      propertyHash: 'h',
      listPrice: 800_000,
      originalEntryTimestamp: new Date(Date.now() - 30 * DAY_MS).toISOString(),
    };
    const r = calculateTrueDOM(current, []);
    expect(r.true_dom).toBeGreaterThanOrEqual(29);
    expect(r.true_dom).toBeLessThanOrEqual(31);
    expect(r.total_price_drop).toBe(0);
    expect(r.is_stale).toBe(false);
  });

  it('flags as stale when single-leg DOM exceeds the stale threshold', () => {
    const current: CurrentListingInput = {
      listingKey: 'CUR',
      propertyHash: 'h',
      listPrice: 800_000,
      originalEntryTimestamp: new Date(
        Date.now() - (STALE_THRESHOLD_DAYS + 15) * DAY_MS
      ).toISOString(),
    };
    expect(calculateTrueDOM(current, []).is_stale).toBe(true);
  });

  it('stitches a relist when the gap fits within the stitch window', () => {
    // Current campaign started 20 days ago, historical ended 20 days ago
    // (gap = 0 days, well within STITCH_WINDOW_DAYS).
    const current: CurrentListingInput = {
      listingKey: 'NEW',
      propertyHash: 'h',
      listPrice: 820_000,
      originalEntryTimestamp: new Date(Date.now() - 20 * DAY_MS).toISOString(),
    };
    const historical: HistoricalListing[] = [
      {
        listing_key: 'OLD',
        property_hash: 'h',
        full_payload: {
          ListPrice: 900_000,
          OriginalEntryTimestamp: new Date(Date.now() - 90 * DAY_MS).toISOString(),
          CancellationDate: new Date(Date.now() - 20 * DAY_MS).toISOString(),
        },
        created_at: '',
      },
    ];
    const r = calculateTrueDOM(current, historical);
    // Should sum ~20 (current) + ~70 (historical leg) = ~90 days.
    expect(r.true_dom).toBeGreaterThanOrEqual(85);
    expect(r.total_price_drop).toBe(80_000); // 900k → 820k
  });

  it('breaks the chain when the gap exceeds the stitch window', () => {
    const gapDays = STITCH_WINDOW_DAYS + 10;
    const current: CurrentListingInput = {
      listingKey: 'NEW',
      propertyHash: 'h',
      listPrice: 750_000,
      originalEntryTimestamp: new Date(Date.now() - 30 * DAY_MS).toISOString(),
    };
    const historical: HistoricalListing[] = [
      {
        listing_key: 'OLD',
        property_hash: 'h',
        full_payload: {
          ListPrice: 950_000,
          OriginalEntryTimestamp: new Date(
            Date.now() - (30 + gapDays + 60) * DAY_MS
          ).toISOString(),
          CancellationDate: new Date(
            Date.now() - (30 + gapDays) * DAY_MS
          ).toISOString(),
        },
        created_at: '',
      },
    ];
    const r = calculateTrueDOM(current, historical);
    // Chain broken — only the current leg counts.
    expect(r.true_dom).toBeGreaterThanOrEqual(29);
    expect(r.true_dom).toBeLessThanOrEqual(31);
    expect(r.total_price_drop).toBe(0);
  });

  it('never reports a negative price drop (clamped at 0)', () => {
    const current: CurrentListingInput = {
      listingKey: 'NEW',
      propertyHash: 'h',
      listPrice: 1_000_000, // price went UP from history
      originalEntryTimestamp: new Date(Date.now() - 10 * DAY_MS).toISOString(),
    };
    const historical: HistoricalListing[] = [
      {
        listing_key: 'OLD',
        property_hash: 'h',
        full_payload: {
          ListPrice: 800_000,
          OriginalEntryTimestamp: new Date(Date.now() - 30 * DAY_MS).toISOString(),
          CancellationDate: new Date(Date.now() - 10 * DAY_MS).toISOString(),
        },
        created_at: '',
      },
    ];
    expect(calculateTrueDOM(current, historical).total_price_drop).toBe(0);
  });
});

describe('groupHistoricalByHash', () => {
  it('buckets historical rows by property_hash, skipping empty hashes', () => {
    const rows: HistoricalListing[] = [
      { listing_key: 'A', property_hash: 'h1', full_payload: {}, created_at: '' },
      { listing_key: 'B', property_hash: 'h1', full_payload: {}, created_at: '' },
      { listing_key: 'C', property_hash: 'h2', full_payload: {}, created_at: '' },
      { listing_key: 'D', property_hash: '', full_payload: {}, created_at: '' },
    ];
    const grouped = groupHistoricalByHash(rows);
    expect(grouped.get('h1')).toHaveLength(2);
    expect(grouped.get('h2')).toHaveLength(1);
    expect(grouped.has('')).toBe(false);
  });
});

describe('constants', () => {
  it('exposes the documented stitch + stale thresholds', () => {
    expect(STITCH_WINDOW_DAYS).toBe(35);
    expect(STALE_THRESHOLD_DAYS).toBe(60);
  });
});
