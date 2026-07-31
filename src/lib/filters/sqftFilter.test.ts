import { describe, it, expect } from 'vitest';
import {
  FILTERS_BY_KEY,
  readBandRange,
  sqftRangeClause,
  cloneFilterValue,
  makeDefaultUniversalFilters,
  moreFiltersForClass,
} from './filterRegistry';
import { SQFT_OPEN_MAX, SQFT_UNKNOWN } from '@/lib/listings/livingAreaBands';
import type { BandRangeValue } from './types';

const sqft = FILTERS_BY_KEY.sqft;
const range = (p: Partial<BandRangeValue>): BandRangeValue =>
  ({ lo: 0, hi: SQFT_OPEN_MAX, loose: true, unsized: false, ...p });

/**
 * Minimal stand-in for Typesense's evaluation of an `&&` chain of numeric
 * comparisons. Enough to prove which documents a clause actually admits — which
 * is the only way to be sure the unknown sentinel can't slip through.
 */
function matches(clause: string, doc: Record<string, number>): boolean {
  return clause.split('&&').every((part) => {
    const m = part.trim().match(/^(\w+):(>=|<=|>|<|=)(-?\d+)$/);
    if (!m) throw new Error(`unparsed clause fragment: ${part}`);
    const [, field, op, rhs] = m;
    const v = doc[field];
    const n = Number(rhs);
    switch (op) {
      case '>=': return v >= n;
      case '<=': return v <= n;
      case '>': return v > n;
      case '<': return v < n;
      default: return v === n;
    }
  });
}

/** A listing reporting no size at all. */
const UNSIZED = { sqft_min: SQFT_UNKNOWN, sqft_max: SQFT_UNKNOWN };

describe('sqft filter definition', () => {
  it('is registered and offered to residential but not commercial', () => {
    expect(sqft).toBeDefined();
    expect(sqft.control).toBe('bands');
    expect(moreFiltersForClass('residential').some((f) => f.key === 'sqft')).toBe(true);
    // Commercial carries exact values, not bands — a band control there would be
    // the wrong instrument, so it's excluded until it gets its own.
    expect(moreFiltersForClass('commercial').some((f) => f.key === 'sqft')).toBe(false);
  });

  it('is inactive and clause-free at its default', () => {
    expect(sqft.isActive(sqft.defaultValue)).toBe(false);
    expect(sqft.buildClause(sqft.defaultValue)).toBeNull();
  });

  it('treats loose and unsized as modifiers, not as an active filter', () => {
    // A wide-open range with a toggle flipped must not light up the chip.
    expect(sqft.isActive(range({ loose: false }))).toBe(false);
    expect(sqft.isActive(range({ unsized: true }))).toBe(false);
    expect(sqft.isActive(range({ lo: 1100 }))).toBe(true);
    expect(sqft.isActive(range({ hi: 2000 }))).toBe(true);
  });
});

describe('strict vs loose', () => {
  const contained = { sqft_min: 1100, sqft_max: 1500 };  // freehold "1100-1500"
  const straddler = { sqft_min: 1000, sqft_max: 1200 };  // condo "1000-1199"
  const outside = { sqft_min: 2500, sqft_max: 3000 };

  it('strict admits only bands wholly inside the range', () => {
    const c = sqftRangeClause(1100, 2000, false)!;
    expect(matches(c, contained)).toBe(true);
    expect(matches(c, straddler)).toBe(false);
    expect(matches(c, outside)).toBe(false);
  });

  it('loose also admits a band that straddles a limit', () => {
    const c = sqftRangeClause(1100, 2000, true)!;
    expect(matches(c, contained)).toBe(true);
    expect(matches(c, straddler)).toBe(true);
    expect(matches(c, outside)).toBe(false);
  });

  it('does not admit a band that merely abuts the range', () => {
    // [2000,2500) starts exactly where the range ends — no shared square footage.
    const c = sqftRangeClause(1100, 2000, true)!;
    expect(matches(c, { sqft_min: 2000, sqft_max: 2500 })).toBe(false);
  });

  it('is null when the range is wide open', () => {
    expect(sqftRangeClause(0, SQFT_OPEN_MAX, true)).toBeNull();
    expect(sqftRangeClause(0, SQFT_OPEN_MAX, false)).toBeNull();
  });
});

describe('the unknown sentinel never leaks', () => {
  // -1/-1 satisfies a one-sided clause like `sqft_min:<2000`, so every clause
  // must constrain BOTH bounds. These cover the one-sided cases specifically,
  // because those are where a half-written clause would go unnoticed.
  const cases: [string, number, number][] = [
    ['open bottom', 0, 2000],
    ['open top', 1100, SQFT_OPEN_MAX],
    ['both bounded', 1100, 2000],
  ];

  for (const [name, lo, hi] of cases) {
    for (const loose of [true, false]) {
      it(`${name}, ${loose ? 'loose' : 'strict'}`, () => {
        const c = sqftRangeClause(lo, hi, loose)!;
        expect(c).toBeTruthy();
        expect(matches(c, UNSIZED)).toBe(false);
      });
    }
  }

  it('only appears when explicitly asked for', () => {
    const without = sqft.buildClause(range({ lo: 1100 }))!;
    expect(without).not.toContain(String(SQFT_UNKNOWN));

    const withIt = sqft.buildClause(range({ lo: 1100, unsized: true }))!;
    expect(withIt).toContain(`sqft_min:=${SQFT_UNKNOWN}`);
    expect(withIt.startsWith('((')).toBe(true);
    expect(withIt).toContain('||');
  });
});

describe('readBandRange', () => {
  it('defaults loose ON — straddlers are included until excluded on purpose', () => {
    expect(readBandRange({} as never).loose).toBe(true);
    expect(readBandRange(undefined as never).loose).toBe(true);
    expect(readBandRange({ loose: false } as never).loose).toBe(false);
  });

  it('fills missing bounds with the wide-open range', () => {
    expect(readBandRange({} as never)).toEqual({
      lo: 0, hi: SQFT_OPEN_MAX, loose: true, unsized: false,
    });
  });
});

describe('chip label', () => {
  it.each([
    [range({ lo: 1100, hi: 2000 }), '1.1k–2k sf'],
    [range({ lo: 1100 }), '1.1k+ sf'],
    [range({ hi: 2000 }), '≤2k sf'],
    [range({}), 'Size'],
    [range({ lo: 500, hi: 900 }), '500–900 sf'],
  ])('%o → %s', (v, expected) => {
    expect(sqft.chipLabel(v)).toBe(expected);
  });
});

describe('default values are never shared', () => {
  // The band range is an object; before cloneFilterValue only arrays were copied,
  // so every store instance would have shared one mutable default.
  it('gives each caller its own object', () => {
    const a = makeDefaultUniversalFilters();
    const b = makeDefaultUniversalFilters();
    expect(a.sqft).not.toBe(b.sqft);
    expect(a.sqft).toEqual(b.sqft);
    expect(a.sqft).not.toBe(sqft.defaultValue);
  });

  it('clones objects, arrays and primitives alike', () => {
    const obj = { lo: 1, hi: 2, loose: true, unsized: false };
    expect(cloneFilterValue(obj)).not.toBe(obj);
    expect(cloneFilterValue(obj)).toEqual(obj);
    const arr: [number, number] = [1, 2];
    expect(cloneFilterValue(arr)).not.toBe(arr);
    expect(cloneFilterValue(5)).toBe(5);
  });
});
