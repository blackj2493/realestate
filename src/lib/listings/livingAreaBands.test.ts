import { describe, it, expect } from 'vitest';
import {
  FREEHOLD_BANDS,
  CONDO_BANDS,
  SQFT_OPEN_MAX,
  SQFT_UNKNOWN,
  parseLivingAreaBand,
  sqftBoundsFor,
  scaleForSubType,
  hasSqft,
  withinRange,
  overlapsRange,
} from './livingAreaBands';

describe('band vocabularies', () => {
  // The whole "certain vs possible" split rests on each vocabulary tiling the
  // axis with no gap and no overlap. A gap would silently drop listings from
  // both counts; an overlap would double-count them.
  it.each([
    ['freehold', FREEHOLD_BANDS],
    ['condo', CONDO_BANDS],
  ])('%s bands tile the axis with no gap or overlap', (_name, bands) => {
    for (let i = 0; i < bands.length - 1; i++) {
      expect(bands[i].hi).toBe(bands[i + 1].lo);
    }
    expect(bands[0].lo).toBe(0);
    for (const b of bands) expect(b.hi).toBeGreaterThan(b.lo);
  });

  it('only the freehold scale is open-ended at the top', () => {
    expect(FREEHOLD_BANDS[FREEHOLD_BANDS.length - 1].hi).toBe(SQFT_OPEN_MAX);
    expect(CONDO_BANDS[CONDO_BANDS.length - 1].hi).toBe(4500);
  });

  it('every declared label parses back to its own bounds', () => {
    for (const b of [...FREEHOLD_BANDS, ...CONDO_BANDS]) {
      expect(parseLivingAreaBand(b.label)).toEqual({ lo: b.lo, hi: b.hi });
    }
  });
});

describe('parseLivingAreaBand', () => {
  it('reads a freehold upper as already-exclusive', () => {
    // TRREB writes "1100-1500" then "1500-2000" — 1500 is the next band's floor.
    expect(parseLivingAreaBand('1100-1500')).toEqual({ lo: 1100, hi: 1500 });
  });

  it('reads a condo upper as inclusive and bumps it', () => {
    // TRREB writes "1000-1199" then "1200-1399" — 1199 is inside the band.
    expect(parseLivingAreaBand('1000-1199')).toEqual({ lo: 1000, hi: 1200 });
  });

  // Both of these used to fall through to NaN in the ingester's copy of the
  // parser and store null — 5,607 sold rows and 5,748 active listings.
  it('handles the open-ended top band', () => {
    expect(parseLivingAreaBand('5000 +')).toEqual({ lo: 5000, hi: SQFT_OPEN_MAX });
    expect(parseLivingAreaBand('5000+')).toEqual({ lo: 5000, hi: SQFT_OPEN_MAX });
  });

  it('handles the open-ended bottom band', () => {
    expect(parseLivingAreaBand('< 700')).toEqual({ lo: 0, hi: 700 });
    expect(parseLivingAreaBand('<700')).toEqual({ lo: 0, hi: 700 });
    expect(parseLivingAreaBand('under 700')).toEqual({ lo: 0, hi: 700 });
  });

  it('tolerates whitespace around the separator', () => {
    expect(parseLivingAreaBand('  1500 - 2000 ')).toEqual({ lo: 1500, hi: 2000 });
  });

  it('treats a bare number as a point, not a band', () => {
    expect(parseLivingAreaBand('850')).toEqual({ lo: 850, hi: 851 });
  });

  it('returns null for absent or unusable values', () => {
    for (const v of [null, undefined, '', '   ', 'N/A', 'TBD', '-', 0, false]) {
      expect(parseLivingAreaBand(v)).toBeNull();
    }
  });

  it('degrades gracefully on a band TRREB has not shipped yet', () => {
    expect(parseLivingAreaBand('6000-6999')).toEqual({ lo: 6000, hi: 7000 });
    expect(parseLivingAreaBand('6000-7000')).toEqual({ lo: 6000, hi: 7000 });
  });
});

describe('sqftBoundsFor', () => {
  it('prefers an exact BuildingAreaTotal, collapsed to a one-wide interval', () => {
    expect(sqftBoundsFor({ BuildingAreaTotal: 1847, LivingAreaRange: '1500-2000' }))
      .toEqual({ lo: 1847, hi: 1848 });
  });

  it('falls back to the band when there is no exact value', () => {
    expect(sqftBoundsFor({ LivingAreaRange: '1500-2000' })).toEqual({ lo: 1500, hi: 2000 });
    expect(sqftBoundsFor({ BuildingAreaTotal: 0, LivingAreaRange: '1500-2000' }))
      .toEqual({ lo: 1500, hi: 2000 });
  });

  it('ignores an out-of-range exact value rather than indexing it', () => {
    // A 5-sqft or 99,999-sqft "exact" is a data-entry error; one such row would
    // otherwise dominate every range query it landed in.
    expect(sqftBoundsFor({ BuildingAreaTotal: 5, LivingAreaRange: '700-1100' }))
      .toEqual({ lo: 700, hi: 1100 });
    expect(sqftBoundsFor({ BuildingAreaTotal: 99999, LivingAreaRange: '700-1100' }))
      .toEqual({ lo: 700, hi: 1100 });
  });

  it('marks a listing with no size at all', () => {
    const b = sqftBoundsFor({});
    expect(b).toEqual({ lo: SQFT_UNKNOWN, hi: SQFT_UNKNOWN });
    expect(hasSqft(b)).toBe(false);
  });
});

describe('scaleForSubType', () => {
  it('puts condo subtypes on the fine scale', () => {
    expect(scaleForSubType('Condo Apartment')).toBe('condo');
    expect(scaleForSubType('Condo Townhouse')).toBe('condo');
  });
  it('puts everything else on the coarse scale', () => {
    for (const t of ['Detached', 'Semi-Detached', 'Att/Row/Townhouse', '', null, undefined]) {
      expect(scaleForSubType(t)).toBe('freehold');
    }
  });
});

describe('certain vs possible', () => {
  const houseBand = { lo: 1100, hi: 1500 };   // freehold "1100-1500"
  const condoBand = { lo: 1000, hi: 1200 };   // condo "1000-1199"

  it('counts a fully-contained band as certain', () => {
    expect(withinRange(houseBand, 1100, 2000)).toBe(true);
    expect(overlapsRange(houseBand, 1100, 2000)).toBe(true);
  });

  // The reason the split exists: ~2,100 non-condo listings are filed on the
  // condo scale, whose edges cut across the freehold edges.
  it('counts a cross-scale straddler as possible but not certain', () => {
    expect(withinRange(condoBand, 1100, 2000)).toBe(false);
    expect(overlapsRange(condoBand, 1100, 2000)).toBe(true);
  });

  it('excludes a band that merely abuts the range', () => {
    // [1500,2000) starts exactly where [1100,1500) ends — no shared sqft.
    expect(overlapsRange({ lo: 1500, hi: 2000 }, 1100, 1500)).toBe(false);
  });

  it('never matches a listing with no size reported', () => {
    const none = { lo: SQFT_UNKNOWN, hi: SQFT_UNKNOWN };
    expect(withinRange(none, 0, SQFT_OPEN_MAX)).toBe(false);
    expect(overlapsRange(none, 0, SQFT_OPEN_MAX)).toBe(false);
  });

  it('within implies overlaps for every real band', () => {
    for (const b of [...FREEHOLD_BANDS, ...CONDO_BANDS]) {
      if (withinRange(b, 900, 3000)) expect(overlapsRange(b, 900, 3000)).toBe(true);
    }
  });
});
