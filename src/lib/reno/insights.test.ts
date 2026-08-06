import { describe, it, expect } from 'vitest';
import { deriveRenoInsights, roiDecode, roiTier, roiCents, moveFlag, type RenoMoveLike } from './insights';

/** A representative ranked move set (Northwest Brampton detached, from the live tool). */
const MOVES: RenoMoveLike[] = [
  { key: 'add_parking', label: 'Add a parking space', paybackRatio: 3.1, valueAddTyp: 15271, costLow: 2500, costHigh: 10000, recommended: true },
  { key: 'add_bathroom', label: 'Add a full bathroom', paybackRatio: 2.7, valueAddTyp: 37661, costLow: 8000, costHigh: 22000, recommended: true },
  { key: 'add_bedroom', label: 'Add a bedroom', paybackRatio: 1.8, valueAddTyp: 21527, costLow: 6000, costHigh: 22000, recommended: true },
  { key: 'build_garage', label: 'Build a detached garage', paybackRatio: 0.8, valueAddTyp: 30808, costLow: 22000, costHigh: 60000, recommended: false },
  { key: 'legal_suite', label: 'Add a legal basement suite', paybackRatio: 0.6, valueAddTyp: 43195, costLow: 50000, costHigh: 120000, recommended: false },
  { key: 'finish_basement', label: 'Finish the basement', paybackRatio: 0.1, valueAddTyp: 3976, costLow: 25000, costHigh: 65000, recommended: false },
];

describe('roiTier / roiDecode / roiCents', () => {
  it('splits payback into pays-back vs loses-money tiers', () => {
    expect(roiTier(3.1)).toBe('strong');
    expect(roiTier(1.2)).toBe('good');
    expect(roiTier(0.6)).toBe('weak');
    expect(roiTier(0.1)).toBe('poor');
  });
  it('decodes the multiple in plain language, both directions', () => {
    expect(roiDecode(3.1)).toContain('$3.10');
    expect(roiDecode(0.6)).toContain('60¢');
    expect(roiCents(0.1)).toBe(10);
  });
});

describe('moveFlag', () => {
  it('flags cheap high-ROI winners as overlooked', () => {
    expect(moveFlag(MOVES[0])?.label).toBe('Overlooked'); // parking 3.1×
  });
  it('flags a legal suite as a rent play, not resale', () => {
    expect(moveFlag(MOVES[4])?.label).toBe('Rent play, not resale'); // suite 0.6×
  });
  it('flags a popular-but-weak move', () => {
    expect(moveFlag(MOVES[5])?.tone).toBe('weak'); // finish basement 0.1×
  });
  it('leaves ordinary paying moves unflagged', () => {
    expect(moveFlag(MOVES[2])).toBeNull(); // bedroom 1.8× (not in the overlooked set)
  });
});

describe('deriveRenoInsights', () => {
  const ins = deriveRenoInsights(MOVES);
  it('returns up to three distinct insights', () => {
    expect(ins).toHaveLength(3);
    const kickers = new Set(ins.map((i) => i.kicker));
    expect(kickers.size).toBe(3);
  });
  it('leads with the overlooked winner', () => {
    expect(ins[0].kicker).toBe('Most-overlooked win');
    expect(ins[0].tone).toBe('good');
    expect(ins[0].headline).toContain('parking');
  });
  it('surfaces the popular-but-weak trap with a plain decode', () => {
    expect(ins[1].kicker).toBe('Don’t be fooled');
    expect(ins[1].headline).toContain('basement');
    expect(ins[1].detail).toContain('10¢');
  });
  it('closes with the concentration lesson when there is a real split', () => {
    expect(ins[2].kicker).toBe('The real lesson');
  });
  it('turns honest when nothing pays back', () => {
    const allLosers = MOVES.map((m) => ({ ...m, paybackRatio: 0.4 }));
    const out = deriveRenoInsights(allLosers);
    expect(out[0].kicker).toBe('The honest read');
    expect(out[0].tone).toBe('watch');
  });
  it('returns nothing when no move is priced', () => {
    expect(deriveRenoInsights(MOVES.map((m) => ({ ...m, paybackRatio: undefined })))).toHaveLength(0);
  });
});

