import { describe, it, expect } from 'vitest';
import {
  computeMedianPrice,
  computeYoyPct,
  snapshotHeadline,
  snapshotScopeLine,
  domGapDays,
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
  medianCutPct: null,
  underAskShare: null,
  activeCount: 42,
  trueDom: null,
  naiveDom: null,
  stalePct: null,
  sellThroughPct: null,
  failedMedianDom: null,
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

  it('leads with the hidden relist gap when there is one', () => {
    const h = snapshotHeadline({ ...BASE, trueDom: 47, naiveDom: 19 }, 'Detached');
    expect(h).toContain('really been sitting 47 days');
    expect(h).toContain('28 more than the board');
    expect(h).not.toContain('takes 21 days to sell'); // the sold-side line steps aside
  });

  it('ignores a gap too small to be a story', () => {
    const h = snapshotHeadline({ ...BASE, trueDom: 22, naiveDom: 19 });
    expect(h).toContain('21 days to sell');
    expect(h).not.toContain('board');
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

describe('domGapDays', () => {
  it('is how many days the board clock under-reports', () => {
    expect(domGapDays({ ...BASE, trueDom: 47, naiveDom: 19 })).toBe(28);
  });
  it('is null when there is no gap to report', () => {
    expect(domGapDays({ ...BASE, trueDom: 19, naiveDom: 19 })).toBeNull();
    expect(domGapDays({ ...BASE, trueDom: 47, naiveDom: null })).toBeNull();
    expect(domGapDays(BASE)).toBeNull();
  });
});

describe('snapshotScopeLine', () => {
  it('states what the tiles were measured over', () => {
    const line = snapshotScopeLine({ ...BASE, activeCount: 42 }, 'Detached')!;
    expect(line).toContain('85 detached sales');
    expect(line).toContain('42 listings');
  });
  it('drops a side it has no count for', () => {
    expect(snapshotScopeLine({ ...BASE, activeCount: 0 }, 'Detached')).toBe(
      'Measured across 85 detached sales in the last 90 days.',
    );
  });
  it('is null when there is nothing to measure', () => {
    expect(snapshotScopeLine({ ...BASE, sales90: 0, activeCount: 0 })).toBeNull();
  });
});
