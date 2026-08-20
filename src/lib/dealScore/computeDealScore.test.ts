import { describe, it, expect } from 'vitest';
import { computeDealScore } from './computeDealScore';

describe('computeDealScore (v2 pillar/persona)', () => {
  it('returns null when no input has data', () => {
    const r = computeDealScore({ listPrice: null });
    expect(r.score).toBeNull();
    expect(r.grade).toBeNull();
    expect(r.components).toEqual([]);
    expect(r.pillars).toEqual([]);
  });

  it('returns null when listPrice is 0 or negative', () => {
    expect(computeDealScore({ listPrice: 0 }).score).toBeNull();
    expect(computeDealScore({ listPrice: -100 }).score).toBeNull();
  });

  it('A+ when listed well below a HIGH-confidence estimate (homebuyer lens)', () => {
    const r = computeDealScore({
      listPrice: 800_000,
      avmEstimate: { estimatedValue: 1_000_000, confidence: 'HIGH' },
    });
    // discount = (1M - 800k) / 1M = 20% → Price pillar maxes to 100; only pillar → score 100
    expect(r.score).toBeGreaterThanOrEqual(85);
    expect(r.grade).toBe('A+');
    expect(r.components[0].direction).toBe('up');
  });

  it('penalizes a listing priced above estimate', () => {
    const r = computeDealScore({
      listPrice: 1_200_000,
      avmEstimate: { estimatedValue: 1_000_000, confidence: 'HIGH' },
    });
    // discount = -20% → 0 points → F
    expect(r.score).toBeLessThanOrEqual(45);
    expect(['D', 'F']).toContain(r.grade);
  });

  it('a fairly-priced home is no longer an F (the v1 regression we fixed)', () => {
    // Listed ~2.7% above comps, fresh-ish, thin cap — the Strathmore case. Homebuyer lens
    // drops Yield, so the thin cap no longer tanks it.
    const r = computeDealScore({
      listPrice: 1_149_900,
      avmEstimate: { estimatedValue: 1_119_365, confidence: 'HIGH' },
      domDays: 26,
      capRatePct: 2.75,
      subType: 'Detached',
    });
    expect(r.persona).toBe('smart');
    // Yield is NOT part of the homebuyer blend.
    expect(r.components.find((c) => c.key === 'yield')).toBeUndefined();
    expect(['C', 'D']).toContain(r.grade);
    expect(r.grade).not.toBe('F');
  });

  it('weights the Price pillar DOWN when AVM confidence is LOW', () => {
    // Two-pillar case (price + terms) so the confidence multiplier surfaces.
    const high = computeDealScore({
      listPrice: 800_000,
      avmEstimate: { estimatedValue: 1_000_000, confidence: 'HIGH' },
      domDays: 30,
    });
    const low = computeDealScore({
      listPrice: 800_000,
      avmEstimate: { estimatedValue: 1_000_000, confidence: 'LOW' },
      domDays: 30,
    });
    expect(high.score!).toBeGreaterThan(low.score!);
    // Single-pillar runs are identical (nothing to dilute).
    const highSolo = computeDealScore({ listPrice: 800_000, avmEstimate: { estimatedValue: 1_000_000, confidence: 'HIGH' } });
    const lowSolo = computeDealScore({ listPrice: 800_000, avmEstimate: { estimatedValue: 1_000_000, confidence: 'LOW' } });
    expect(highSolo.score).toBe(lowSolo.score);
  });

  it('Price pillar: relative $-free detail (for The Read) + comp-value dollar (breakdown only)', () => {
    const r = computeDealScore({
      listPrice: 1_200_000,
      avmEstimate: { estimatedValue: 1_000_000, confidence: 'HIGH' },
    });
    const v = r.components.find((c) => c.key === 'price')!;
    expect(v.label).toBe('Value vs Comps');
    expect(v.compValue).toBe(1_000_000);
    expect(v.detail).toMatch(/comparable sales/i);
    expect(v.detail).not.toMatch(/\$/);
  });

  it('Terms pillar rewards bigger price cuts', () => {
    const noCut = computeDealScore({ listPrice: 1_000_000, originalListPrice: 1_000_000 });
    const bigCut = computeDealScore({ listPrice: 850_000, originalListPrice: 1_000_000 });
    expect(bigCut.score!).toBeGreaterThan(noCut.score!);
  });

  it('Terms pillar rewards longer days-on-market', () => {
    const fresh = computeDealScore({ listPrice: 1_000_000, domDays: 1 });
    const stale = computeDealScore({ listPrice: 1_000_000, domDays: 90 });
    expect(stale.score!).toBeGreaterThan(fresh.score!);
  });

  it('Yield is excluded from the homebuyer lens but included for cashflow', () => {
    const input = { listPrice: 1_000_000, domDays: 30, capRatePct: 8, subType: 'Detached' as const };
    const homebuyer = computeDealScore(input, 'smart');
    const cashflow = computeDealScore(input, 'cashflow');
    expect(homebuyer.components.find((c) => c.key === 'yield')).toBeUndefined();
    expect(cashflow.components.find((c) => c.key === 'yield')).toBeDefined();
  });

  it('Yield is asset-class-relative: a cap well above the type baseline scores high', () => {
    // Default baseline ~3.2%; 8% cap → far above → near max.
    const r = computeDealScore({ listPrice: 1_000_000, capRatePct: 8 }, 'cashflow');
    const y = r.components.find((c) => c.key === 'yield')!;
    expect(y.points).toBeGreaterThan(85);
  });

  it('renormalizes — a single high-scoring pillar yields a high final score', () => {
    const r = computeDealScore({ listPrice: 1_000_000, domDays: 90 });
    expect(r.score).toBe(100);
  });

  it('produces all four pillars for the flipper lens when every input is present', () => {
    const r = computeDealScore(
      {
        listPrice: 850_000,
        originalListPrice: 1_000_000,
        avmEstimate: { estimatedValue: 1_000_000, confidence: 'HIGH' },
        domDays: 60,
        capRatePct: 7,
        subType: 'Detached',
        lotSqft: 6000,
        suitePotential: true,
      },
      'flippers'
    );
    expect(r.components.map((c) => c.key).sort()).toEqual(['price', 'terms', 'upside', 'yield']);
  });

  it('always returns all four persona headlines', () => {
    const r = computeDealScore({
      listPrice: 1_000_000,
      avmEstimate: { estimatedValue: 1_050_000, confidence: 'HIGH' },
      domDays: 40,
      capRatePct: 6,
      subType: 'Detached',
    });
    expect(Object.keys(r.personaScores).sort()).toEqual(['builders', 'cashflow', 'flippers', 'smart']);
    for (const k of ['smart', 'cashflow', 'flippers', 'builders'] as const) {
      expect(typeof r.personaScores[k].score).toBe('number');
    }
  });

  it('offer band: anchors the likely close to the expected sale and offers below it', () => {
    const r = computeDealScore({
      listPrice: 1_000_000,
      avmEstimate: { estimatedValue: 1_100_000, confidence: 'HIGH' },
      domDays: 40,
      expectedSalePrice: 980_000,
      closeListRatio: 0.98,
    });
    expect(r.offerBand).not.toBeNull();
    expect(r.offerBand!.likelyClose).toBe(980_000);
    expect(r.offerBand!.aggressive).toBeLessThanOrEqual(980_000);
    expect(r.offerBand!.hotMarket).toBe(false);
  });

  it('offer band: flags a hot market when the cohort closes above ask', () => {
    const r = computeDealScore({
      listPrice: 1_000_000,
      avmEstimate: { estimatedValue: 1_000_000, confidence: 'HIGH' },
      expectedSalePrice: 1_030_000,
      closeListRatio: 1.03,
    });
    expect(r.offerBand!.hotMarket).toBe(true);
    expect(r.offerBand!.competitive).toBe(false);
  });

  it('offer band: the competitive signal floors the band at the ask, never under', () => {
    // 79 Westhampton shape: threshold $1,199,000 ask, cohort ratio 96.8%, comps ~$1.265M.
    const r = computeDealScore({
      listPrice: 1_199_000,
      avmEstimate: { estimatedValue: 1_264_906, confidence: 'HIGH' },
      domDays: 11,
      expectedSalePrice: 1_160_199,
      closeListRatio: 0.968,
      competitive: {
        belowCompsPct: (1_264_906 - 1_199_000) / 1_264_906,
        overAskRate: 0.4,
        rangeLow: 1_199_000,
        rangeHigh: 1_264_906,
        medianCloseRatio: 0.99,
      },
    });
    const band = r.offerBand!;
    expect(band.competitive).toBe(true);
    expect(band.aggressive).toBe(1_199_000); // the ask — never an under-ask recommendation
    expect(band.likelyClose).toBe(Math.round(1_199_000 * 0.99)); // bucket median, not the cohort ratio
    expect(band.ceiling).toBe(1_264_906); // overpaying line = comps, unchanged
    expect(band.note).toMatch(/sold over ask ~40% of the time/);
    // Same phrasing The Read's price line uses for COMPETITIVE_MEDIAN_CLOSE_RATIO, so the
    // two surfaces render the same constant identically.
    expect(band.note).toMatch(/median close ≈ ask/);
    expect(band.note).toMatch(/Overpaying above ~\$1,264,906/);

    // THE INVARIANT: a "priced to compete" note may not put ANY number under the ask in
    // front of the buyer. It used to carry the cohort-ratio figure as a "quiet offer
    // night" aside, which reads as the instruction and loses on offer night.
    expect(band.note).not.toMatch(/quiet offer night/);
    expect(band.note).not.toContain('$1,160,199');
    const quoted = [...band.note.matchAll(/\$([\d,]+)/g)].map((m) => Number(m[1].replace(/,/g, '')));
    expect(quoted.length).toBeGreaterThan(0);
    expect(quoted.filter((n) => n < 1_199_000)).toEqual([]);
  });

  it('offer band: without the competitive signal the same inputs still quote the cohort ratio', () => {
    const r = computeDealScore({
      listPrice: 1_199_000,
      avmEstimate: { estimatedValue: 1_264_906, confidence: 'HIGH' },
      expectedSalePrice: 1_160_199,
      closeListRatio: 0.968,
    });
    expect(r.offerBand!.competitive).toBe(false);
    expect(r.offerBand!.likelyClose).toBe(1_160_199);
  });

  it('confidence is HIGH only with a HIGH AVM and ≥2 pillars', () => {
    const two = computeDealScore({
      listPrice: 800_000,
      avmEstimate: { estimatedValue: 1_000_000, confidence: 'HIGH' },
      domDays: 30,
    });
    expect(two.confidence).toBe('HIGH');
    const solo = computeDealScore({
      listPrice: 800_000,
      avmEstimate: { estimatedValue: 1_000_000, confidence: 'HIGH' },
    });
    expect(solo.confidence).toBe('LOW'); // single pillar
  });
});
