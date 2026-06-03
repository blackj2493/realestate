import { describe, it, expect } from 'vitest';
import { shouldRender, buildView, suppressReasonCopy } from './forceAppreciationView';
import type { ValueAddReport, ValueAddMove, SuppressReason } from '@/lib/avm/valueAdd/types';

const priced = (key: string, netGainTyp: number, over: Partial<ValueAddMove> = {}): ValueAddMove => ({
  key: key as ValueAddMove['key'], label: key, status: 'priced',
  valueAddLow: 0, valueAddTyp: 50000, valueAddHigh: 0,
  costLow: 0, costTyp: 20000, costHigh: 0,
  netGainTyp, paybackRatio: 2.5, confidence: 'HIGH', recommended: false, ...over,
});
const suppressedMove = (key: string, reason: SuppressReason): ValueAddMove => ({
  key: key as ValueAddMove['key'], label: key, status: 'suppressed', suppressReason: reason,
  valueAddLow: 0, valueAddTyp: 0, valueAddHigh: 0, costLow: 0, costTyp: 0, costHigh: 0,
  netGainTyp: 0, paybackRatio: 0, confidence: 'LOW', recommended: false,
});
const report = (over: Partial<ValueAddReport> = {}): ValueAddReport => ({
  cityRegion: 'Brampton West', propertySubType: 'Detached',
  subjectEstimate: 800000, headlineUpsideGross: 140000, headlineUpside: 58000,
  valueAddScore: 72, moves: [], neighbourhoodInsight: 'pays most for: finish the basement.',
  basis: 'Based on 117 Brampton West Detached sales', disclaimer: 'x', ...over,
});

describe('shouldRender', () => {
  it('is false for null, zero estimate, or no priced move', () => {
    expect(shouldRender(null)).toBe(false);
    expect(shouldRender(report({ subjectEstimate: 0, moves: [priced('a', 1)] }))).toBe(false);
    expect(shouldRender(report({ moves: [suppressedMove('a', 'at_ceiling')] }))).toBe(false);
  });
  it('is true with a positive estimate and ≥1 priced move', () => {
    expect(shouldRender(report({ moves: [priced('a', 1)] }))).toBe(true);
  });
});

describe('buildView', () => {
  const v = buildView(report({
    moves: [
      priced('m1', 90, { recommended: true }),
      priced('m2', 80, { recommended: false }),
      priced('m3', 70, { recommended: true, costTyp: 10000 }),
      priced('m4', 60, { recommended: false }),
      suppressedMove('s1', 'negative_beta'),
    ],
  }));
  it('partitions priced moves by the engine flag, not a slice', () => {
    expect(v.recommendedRows.map((r) => r.key)).toEqual(['m1', 'm3']);
    expect(v.moreRows.map((r) => r.key)).toEqual(['m2', 'm4']);
  });
  it('sums the recommended costs for the Total row', () => {
    expect(v.totalCosts).toBe(30000); // 20000 (m1 default) + 10000 (m3 override)
  });
  it('maps suppressed moves to the softened copy', () => {
    expect(v.suppressed).toEqual([
      { key: 's1', label: 's1', reason: "local sales don't show a reliable premium" },
    ]);
  });
  it('wires headline, score, insight and basis', () => {
    expect(v.score).toBe(72);
    expect(v.headlineGross).toBe(140000);
    expect(v.headlineNet).toBe(58000);
    expect(v.basis).toBe('Based on 117 Brampton West Detached sales · modeled, not appraised');
    expect(v.insight).toContain('finish the basement');
  });
});

describe('suppressReasonCopy', () => {
  it('covers every SuppressReason', () => {
    const reasons: SuppressReason[] = ['negative_beta', 'placeholder', 'low_r2', 'thin_cohort',
      'at_ceiling', 'null_baseline', 'already_present', 'no_estimate'];
    for (const r of reasons) expect(suppressReasonCopy(r).length).toBeGreaterThan(0);
  });
});
