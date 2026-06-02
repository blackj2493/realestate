import { describe, it, expect } from 'vitest';
import { shouldRender, buildView, suppressReasonCopy } from './forceAppreciationView';
import type { ValueAddReport, ValueAddMove, SuppressReason } from '@/lib/avm/valueAdd/types';

const priced = (key: string, netGainTyp: number, over: Partial<ValueAddMove> = {}): ValueAddMove => ({
  key: key as ValueAddMove['key'], label: key, status: 'priced',
  valueAddLow: 0, valueAddTyp: 50000, valueAddHigh: 0,
  costLow: 0, costTyp: 20000, costHigh: 0,
  netGainTyp, paybackRatio: 2.5, confidence: 'HIGH', ...over,
});
const suppressedMove = (key: string, reason: SuppressReason): ValueAddMove => ({
  key: key as ValueAddMove['key'], label: key, status: 'suppressed', suppressReason: reason,
  valueAddLow: 0, valueAddTyp: 0, valueAddHigh: 0, costLow: 0, costTyp: 0, costHigh: 0,
  netGainTyp: 0, paybackRatio: 0, confidence: 'LOW',
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
    moves: [priced('m1', 90), priced('m2', 80), priced('m3', 70), priced('m4', 60),
            suppressedMove('s1', 'negative_beta')],
  }));
  it('takes the top 3 priced moves as headline rows, rest into moreRows', () => {
    expect(v.topRows.map((r) => r.key)).toEqual(['m1', 'm2', 'm3']);
    expect(v.moreRows.map((r) => r.key)).toEqual(['m4']);
  });
  it('maps suppressed moves to human copy', () => {
    expect(v.suppressed).toEqual([
      { key: 's1', label: 's1', reason: "the local market doesn't pay extra for this" },
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
