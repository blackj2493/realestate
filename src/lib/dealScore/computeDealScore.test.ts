import { describe, it, expect } from 'vitest';
import { computeDealScore } from './computeDealScore';

describe('computeDealScore', () => {
  it('returns null when no input has data', () => {
    const r = computeDealScore({ listPrice: null });
    expect(r.score).toBeNull();
    expect(r.grade).toBeNull();
    expect(r.components).toEqual([]);
  });

  it('returns null when listPrice is 0 or negative', () => {
    expect(computeDealScore({ listPrice: 0 }).score).toBeNull();
    expect(computeDealScore({ listPrice: -100 }).score).toBeNull();
  });

  it('A+ when listed well below a HIGH-confidence estimate', () => {
    const r = computeDealScore({
      listPrice: 800_000,
      avmEstimate: { estimatedValue: 1_000_000, confidence: 'HIGH' },
    });
    // discount = (1M - 800k) / 1M = 20% → anchor extrapolates to 100
    expect(r.score).toBeGreaterThanOrEqual(85);
    expect(r.grade).toBe('A+');
    expect(r.components[0].direction).toBe('up');
  });

  it('penalizes a listing priced above estimate', () => {
    const r = computeDealScore({
      listPrice: 1_200_000,
      avmEstimate: { estimatedValue: 1_000_000, confidence: 'HIGH' },
    });
    // discount = -20% → 0 points
    expect(r.score).toBeLessThanOrEqual(45);
    expect(['D', 'F']).toContain(r.grade);
  });

  it('weights the value component DOWN when AVM confidence is LOW', () => {
    const high = computeDealScore({
      listPrice: 800_000,
      avmEstimate: { estimatedValue: 1_000_000, confidence: 'HIGH' },
    });
    const low = computeDealScore({
      listPrice: 800_000,
      avmEstimate: { estimatedValue: 1_000_000, confidence: 'LOW' },
    });
    // Same points, but lower-confidence weight pulls the renormalized average toward
    // a balanced 50 (single-component case keeps points the same, so add a
    // second component to surface the effect).
    const highMulti = computeDealScore({
      listPrice: 800_000,
      avmEstimate: { estimatedValue: 1_000_000, confidence: 'HIGH' },
      capRatePct: 4, // neutral-ish yield component pulls the average down
    });
    const lowMulti = computeDealScore({
      listPrice: 800_000,
      avmEstimate: { estimatedValue: 1_000_000, confidence: 'LOW' },
      capRatePct: 4,
    });
    // The HIGH-confidence run gives the (high-points) value component MORE weight,
    // so its final score must exceed the LOW-confidence run's.
    expect(highMulti.score!).toBeGreaterThan(lowMulti.score!);
    // Sanity: the single-component runs are identical because there's nothing else to dilute.
    expect(high.score).toBe(low.score);
  });

  it('motivation component rewards bigger price cuts', () => {
    const noCut = computeDealScore({
      listPrice: 1_000_000,
      originalListPrice: 1_000_000,
    });
    const bigCut = computeDealScore({
      listPrice: 850_000,
      originalListPrice: 1_000_000,
    });
    expect(bigCut.score!).toBeGreaterThan(noCut.score!);
  });

  it('leverage component rewards longer days-on-market', () => {
    const fresh = computeDealScore({ listPrice: 1_000_000, domDays: 1 });
    const stale = computeDealScore({ listPrice: 1_000_000, domDays: 90 });
    expect(stale.score!).toBeGreaterThan(fresh.score!);
  });

  it('yield component is included only when capRatePct > 0', () => {
    const without = computeDealScore({ listPrice: 1_000_000, domDays: 30 });
    const withYield = computeDealScore({
      listPrice: 1_000_000,
      domDays: 30,
      capRatePct: 8,
    });
    expect(without.components.find((c) => c.key === 'yield')).toBeUndefined();
    expect(withYield.components.find((c) => c.key === 'yield')).toBeDefined();
  });

  it('renormalizes — a single high-scoring component yields a high final score', () => {
    const r = computeDealScore({ listPrice: 1_000_000, domDays: 90 });
    // 100-point leverage with no other dimensions to dilute → score = 100
    expect(r.score).toBe(100);
  });

  it('produces all 4 components when every input is present', () => {
    const r = computeDealScore({
      listPrice: 850_000,
      originalListPrice: 1_000_000,
      avmEstimate: { estimatedValue: 1_000_000, confidence: 'HIGH' },
      domDays: 60,
      capRatePct: 7,
    });
    expect(r.components.map((c) => c.key).sort()).toEqual([
      'leverage',
      'motivation',
      'value',
      'yield',
    ]);
  });
});
