import { describe, it, expect } from 'vitest';
import { deriveSuiteEconomics, paybackRange } from './suiteEconomics';
import { IN_HOME_UNIT_LABEL, type AskingMatrix } from '@/lib/address/nearbyForSale';
import type { RenoMoveLike } from './insights';

const MOVES: RenoMoveLike[] = [
  { key: 'add_parking', label: 'Add a parking space', paybackRatio: 3.1, costLow: 2500, costHigh: 10000 },
  {
    key: 'legal_suite',
    label: 'Add a legal basement suite',
    paybackRatio: 0.6,
    valueAddTyp: 43195,
    costLow: 50000,
    costHigh: 120000,
  },
];

/** Leased grid with a real in-home-unit row (1 bd × 10 @ $1,800, 2 bd × 10 @ $2,000). */
const RENTS: AskingMatrix = {
  bedCols: [1, 2, 3],
  rows: [
    {
      label: 'Detached',
      count: 12,
      cells: [
        { median: null, count: 0 },
        { median: null, count: 0 },
        { median: 3_400, count: 12 },
      ],
    },
    {
      label: IN_HOME_UNIT_LABEL,
      count: 20,
      cells: [
        { median: 1_800, count: 10 },
        { median: 2_000, count: 10 },
        { median: null, count: 0 },
      ],
    },
  ],
  sample: 32,
};

describe('deriveSuiteEconomics', () => {
  it('reads the in-home-unit row, not the whole-home row', () => {
    const s = deriveSuiteEconomics({ rentMatrix: RENTS, rentSource: 'leased', moves: MOVES })!;
    expect(s.monthlyRent).toBe(1_900); // count-weighted across 1 bd + 2 bd, NOT the $3,400 detached
    expect(s.annualRent).toBe(22_800);
    expect(s.sampleCount).toBe(20);
    expect(s.rentSource).toBe('leased');
  });

  it('turns build cost into a payback period at both ends of the range', () => {
    const s = deriveSuiteEconomics({ rentMatrix: RENTS, rentSource: 'leased', moves: MOVES })!;
    expect(s.costLow).toBe(50_000);
    expect(s.paybackFastYears).toBeCloseTo(50_000 / 22_800, 4);
    expect(s.paybackSlowYears).toBeCloseTo(120_000 / 22_800, 4);
    expect(paybackRange(s)).toBe('2.2–5.3 years');
  });

  it('carries the resale value the engine attributes to the suite', () => {
    expect(deriveSuiteEconomics({ rentMatrix: RENTS, rentSource: 'leased', moves: MOVES })!.resaleAdd).toBe(43195);
  });

  it('leaves resale null when the move is locked (anon — no VOW value)', () => {
    const locked = MOVES.map((m) => ({ ...m, valueAddTyp: undefined }));
    expect(deriveSuiteEconomics({ rentMatrix: RENTS, rentSource: 'asking', moves: locked })!.resaleAdd).toBeNull();
  });

  it('self-hides when the area has no in-home-unit rentals', () => {
    const noSuites: AskingMatrix = { ...RENTS, rows: [RENTS.rows[0]] };
    expect(deriveSuiteEconomics({ rentMatrix: noSuites, rentSource: 'leased', moves: MOVES })).toBeNull();
    expect(deriveSuiteEconomics({ rentMatrix: null, rentSource: 'leased', moves: MOVES })).toBeNull();
  });

  it('self-hides when no legal-suite move is priced', () => {
    const noSuiteMove = MOVES.filter((m) => m.key !== 'legal_suite');
    expect(deriveSuiteEconomics({ rentMatrix: RENTS, rentSource: 'leased', moves: noSuiteMove })).toBeNull();
  });

  it('ignores implausibly cheap cells (rooms mis-filed as units)', () => {
    const withRoom: AskingMatrix = {
      ...RENTS,
      rows: [
        RENTS.rows[0],
        {
          label: IN_HOME_UNIT_LABEL,
          count: 30,
          cells: [
            { median: 500, count: 10 }, // a room, not a suite — must not drag the median
            { median: 2_000, count: 10 },
            { median: null, count: 0 },
          ],
        },
      ],
    };
    const s = deriveSuiteEconomics({ rentMatrix: withRoom, rentSource: 'leased', moves: MOVES })!;
    expect(s.monthlyRent).toBe(2_000);
    expect(s.sampleCount).toBe(10);
  });
});

describe('paybackRange', () => {
  it('collapses to a single figure when the cost range is tight', () => {
    const s = deriveSuiteEconomics({
      rentMatrix: RENTS,
      rentSource: 'leased',
      moves: [{ key: 'legal_suite', label: 'suite', costLow: 70_000, costHigh: 72_000, valueAddTyp: 1 }],
    })!;
    expect(paybackRange(s)).toMatch(/^about 3\.[01] years$/);
  });
});
