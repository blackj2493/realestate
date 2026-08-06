import { describe, it, expect } from 'vitest';
import { bandPct, buildMethodRows } from './methodStats';

/** Diagnostics shaped like a live Barrhaven detached run. */
const FULL = {
  r2Score: 0.86,
  comps: 412,
  nEff: 96.4,
  confidence: 'HIGH' as const,
  estimatedValue: 639_017,
  lowBand: 591_984,
  highBand: 689_788,
};

describe('bandPct', () => {
  it('is the half-width of the predictive band as a % of the estimate', () => {
    expect(bandPct(FULL)!).toBeCloseTo(((689_788 - 591_984) / 2 / 639_017) * 100, 6);
  });
  it('is null unless the estimate and both bounds are real', () => {
    expect(bandPct({ ...FULL, estimatedValue: 0 })).toBeNull();
    expect(bandPct({ ...FULL, lowBand: null })).toBeNull();
    expect(bandPct({ ...FULL, highBand: 500_000 })).toBeNull(); // inverted band
  });
});

describe('buildMethodRows', () => {
  it('reports comparables raw and effective, fit, band and freshness', () => {
    const rows = buildMethodRows(FULL);
    expect(rows.map((r) => r.label)).toEqual(['Comparable sales', 'Model fit', 'Range shown', 'Data']);
    expect(rows[0].value).toBe('412 weighted → 96 effective');
    expect(rows[1].value).toBe('R² 0.86 · high confidence');
    expect(rows[2].value).toBe('±7.7%');
    expect(rows[3].value).toContain('24h');
  });

  it('omits any diagnostic the engine did not produce — never invents one', () => {
    const rows = buildMethodRows({ estimatedValue: 500_000 });
    expect(rows.map((r) => r.label)).toEqual(['Data']); // the only always-true row
  });

  it('drops the effective-sample clause when weighting produced no nEff', () => {
    expect(buildMethodRows({ ...FULL, nEff: null })[0].value).toBe('412 weighted');
  });

  it('drops the confidence clause when the engine assigned none', () => {
    const rows = buildMethodRows({ ...FULL, confidence: null });
    expect(rows[1].value).toBe('R² 0.86');
  });

  it('always states the source is closed sales, not asking prices', () => {
    const data = buildMethodRows(FULL).at(-1)!;
    expect(data.note).toMatch(/closes, not asking prices/i);
  });
});
