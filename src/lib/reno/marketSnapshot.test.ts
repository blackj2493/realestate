import { describe, it, expect } from 'vitest';
import {
  computeMedianPrice,
  computeYoyPct,
  snapshotHeadline,
  snapshotPressure,
  type RenoMarketSnapshot,
  type SnapshotTrendPoint,
} from './marketSnapshot';

/** 15 monthly points: 2025-06..2026-08 — enough for a 3-month window plus its year-ago pair. */
function points(overrides: Partial<Record<string, Partial<SnapshotTrendPoint>>> = {}): SnapshotTrendPoint[] {
  const months = [
    '2025-06', '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12',
    '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08',
  ];
  return months.map((month) => ({
    month,
    medianPrice: month.startsWith('2025') ? 1_000_000 : 950_000,
    sales: 10,
    ...(overrides[month] ?? {}),
  }));
}

const BASE: RenoMarketSnapshot = {
  region: 'Northwest Brampton',
  label: 'Northwest Brampton',
  scope: 'community',
  medianPrice: 950_000,
  yoyPct: -5,
  sales90: 85,
  medianDom: 21,
  soldToListPct: 98.4,
  cutShare: null,
  underAskShare: null,
};

describe('computeYoyPct', () => {
  it('compares the trailing 3 months with the same 3 a year earlier', () => {
    expect(computeYoyPct(points())).toBeCloseTo(-5, 5); // 950k vs 1.0M
  });

  it('is null when fewer than two year-ago pairs exist', () => {
    const short: SnapshotTrendPoint[] = [
      { month: '2026-07', medianPrice: 900_000, sales: 5 },
      { month: '2026-08', medianPrice: 910_000, sales: 5 },
      { month: '2025-08', medianPrice: 1_000_000, sales: 5 },
    ];
    expect(computeYoyPct(short)).toBeNull();
  });

  it('is null with no history at all', () => {
    expect(computeYoyPct([])).toBeNull();
  });

  it('ignores zero-sale months instead of treating them as a crash', () => {
    const withGap = points({ '2026-07': { medianPrice: 0, sales: 0 } });
    expect(computeYoyPct(withGap)).toBeCloseTo(-5, 5);
  });

  it('weights each month by its sale count', () => {
    const skewed = points({
      '2026-08': { medianPrice: 800_000, sales: 90 },
      '2026-07': { medianPrice: 1_000_000, sales: 5 },
      '2026-06': { medianPrice: 1_000_000, sales: 5 },
    });
    // the 90-sale month dominates → well below the unweighted −5%
    expect(computeYoyPct(skewed)!).toBeLessThan(-10);
  });
});

describe('computeMedianPrice', () => {
  it('returns the sales-weighted trailing-3-month median', () => {
    expect(computeMedianPrice(points())).toBe(950_000);
  });
  it('is null when nothing sold', () => {
    expect(computeMedianPrice(points().map((p) => ({ ...p, sales: 0 })))).toBeNull();
  });
});

describe('snapshotHeadline', () => {
  it('names the area, the direction and the time to sell', () => {
    const h = snapshotHeadline(BASE);
    expect(h).toContain('Northwest Brampton');
    expect(h).toContain('down 5.0%');
    expect(h).toContain('21 days');
  });

  it('reads a sub-1% move as flat', () => {
    expect(snapshotHeadline({ ...BASE, yoyPct: 0.4 })).toContain('flat on the year');
  });

  it('falls back to the price level, then to sales volume, when yoy is unknown', () => {
    const h = snapshotHeadline({ ...BASE, yoyPct: null, medianDom: null });
    expect(h).toContain('$950,000');
    expect(h).toContain('85 sales');
  });

  it('never renders an empty sentence with no data at all', () => {
    const h = snapshotHeadline({ ...BASE, yoyPct: null, medianPrice: null, medianDom: null, sales90: 0 });
    expect(h).toBe('Here is how Northwest Brampton is actually trading.');
  });
});

describe('snapshotPressure', () => {
  it('leads with price cuts when a quarter of listings have cut', () => {
    expect(snapshotPressure({ ...BASE, cutShare: 0.31 })).toContain('31%');
  });
  it('otherwise reports under-ask closes', () => {
    expect(snapshotPressure({ ...BASE, cutShare: 0.1, underAskShare: 0.62 })).toContain('62%');
  });
  it('flags a seller market at or above asking', () => {
    expect(snapshotPressure({ ...BASE, soldToListPct: 101.2 })).toContain('sellers hold the edge');
  });
  it('is null when every signal is missing', () => {
    expect(snapshotPressure({ ...BASE, soldToListPct: null })).toBeNull();
  });
});
