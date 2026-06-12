import { describe, it, expect } from 'vitest';
import {
  generatePropertyHash,
  unitsMatchForMerge,
  parseTimestamp,
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
    const h2 = generatePropertyHash({
      UnparsedAddress: '40 Rampart Drive, Brampton, ON L6P 2Z1',
      City: 'Brampton',
    });
    expect(h1).toBe(h2);
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

describe('constants', () => {
  it('exposes the documented stitch + stale thresholds', () => {
    expect(STITCH_WINDOW_DAYS).toBe(35);
    expect(STALE_THRESHOLD_DAYS).toBe(60);
  });

  // Suppress unused-variable warning — DAY_MS is a useful constant in test helpers
  it('DAY_MS sanity', () => {
    expect(DAY_MS).toBe(86_400_000);
  });
});
