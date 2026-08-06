import { describe, it, expect } from 'vitest';
import { pickCohortCell, cohortLabel, bedsLabel } from './cohort';
import type { AskingMatrix } from '@/lib/address/nearbyForSale';

/** beds × type grid shaped like the live one near Northwest Brampton. */
const MATRIX: AskingMatrix = {
  bedCols: [1, 2, 3, 4, 5],
  rows: [
    {
      label: 'Detached',
      count: 60,
      cells: [
        { median: null, count: 0 },
        { median: null, count: 0 },
        { median: 905_000, count: 18, p25: 860_000, p75: 965_000 },
        { median: 1_050_000, count: 24, p25: 985_000, p75: 1_180_000 },
        { median: 1_240_000, count: 12, p25: 1_150_000, p75: 1_360_000 },
      ],
    },
    {
      label: 'Att/Row/Townhouse',
      count: 20,
      cells: [
        { median: null, count: 0 },
        { median: null, count: 0 },
        { median: 760_000, count: 14, p25: 720_000, p75: 800_000 },
        { median: 830_000, count: 6, p25: null, p75: null },
        { median: null, count: 0 },
      ],
    },
  ],
  sample: 80,
};

describe('pickCohortCell', () => {
  it('returns the exact beds × type cell with its middle-50% band', () => {
    const c = pickCohortCell(MATRIX, 'Detached', 5)!;
    expect(c.basis).toBe('exact');
    expect(c.median).toBe(1_240_000);
    expect(c.p25).toBe(1_150_000);
    expect(c.count).toBe(12);
    expect(c.beds).toBe(5);
  });

  it('matches the type through board spelling variants', () => {
    // The funnel says "Townhouse"; the board files "Att/Row/Townhouse".
    const c = pickCohortCell(MATRIX, 'Townhouse', 3)!;
    expect(c.median).toBe(760_000);
    expect(c.typeLabel).toBe('Att/Row/Townhouse');
  });

  it('falls back one bedroom over, preferring the larger home on a tie', () => {
    const c = pickCohortCell(MATRIX, 'Att/Row/Townhouse', 5)!;
    expect(c.basis).toBe('nearest-beds');
    expect(c.beds).toBe(4); // 4 bd exists, 5 bd is empty
  });

  it('pools the whole type when no bedroom count is close', () => {
    const c = pickCohortCell(MATRIX, 'Detached', 1)!;
    expect(c.basis).toBe('type');
    expect(c.p25).toBeNull(); // a pooled number gets no fake band
    expect(c.count).toBe(54); // 18 + 24 + 12
    // count-weighted, so it sits between the 3 bd and 5 bd medians
    expect(c.median).toBeGreaterThan(905_000);
    expect(c.median).toBeLessThan(1_240_000);
  });

  it('says nothing rather than quoting a different kind of home', () => {
    expect(pickCohortCell(MATRIX, 'Condo Apartment', 2)).toBeNull();
  });

  it('is null-safe on a missing or empty matrix', () => {
    expect(pickCohortCell(null, 'Detached', 3)).toBeNull();
    expect(pickCohortCell({ bedCols: [], rows: [], sample: 0 }, 'Detached', 3)).toBeNull();
  });

  it('caps the bedroom bucket at the 6+ column', () => {
    const big: AskingMatrix = {
      bedCols: [6],
      rows: [{ label: 'Detached', count: 4, cells: [{ median: 1_500_000, count: 4 }] }],
      sample: 4,
    };
    expect(pickCohortCell(big, 'Detached', 9)!.basis).toBe('exact');
  });
});

describe('labels', () => {
  it('reads bedroom buckets the way the grid does', () => {
    expect(bedsLabel(0)).toBe('Studio');
    expect(bedsLabel(3)).toBe('3 bed');
    expect(bedsLabel(7)).toBe('6+ bed');
  });

  it('marks a pooled cell as size-agnostic', () => {
    const pooled = pickCohortCell(MATRIX, 'Detached', 1)!;
    expect(cohortLabel(pooled, 'Detached')).toBe('Detached (any size)');
    const exact = pickCohortCell(MATRIX, 'Detached', 4)!;
    expect(cohortLabel(exact, 'Detached')).toBe('4 bed detached');
  });
});
