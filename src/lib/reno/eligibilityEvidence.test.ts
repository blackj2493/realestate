import { describe, it, expect } from 'vitest';
import { deriveEligibilityEvidence } from './eligibilityEvidence';
import { IN_HOME_UNIT_LABEL, type AskingMatrix } from '@/lib/address/nearbyForSale';

/** Leased grid shaped like the live Northwest Brampton one (1 bd $1,350 ×6, 2 bd $1,700 ×13). */
const RENTS: AskingMatrix = {
  bedCols: ['1', '2', '3'],
  rows: [
    {
      label: 'Condo Apartment',
      count: 17,
      cells: [
        { median: 1_925, count: 3 },
        { median: 2_325, count: 14 },
        { median: null, count: 0 },
      ],
    },
    {
      label: IN_HOME_UNIT_LABEL,
      count: 19,
      cells: [
        { median: 1_350, count: 6 },
        { median: 1_700, count: 13 },
        { median: null, count: 0 },
      ],
    },
  ],
  sample: 36,
};

const SALES: AskingMatrix = {
  bedCols: ['3', '4'],
  rows: [
    { label: 'Detached', count: 40, cells: [{ median: 905_000, count: 18 }, { median: 1_050_000, count: 22 }] },
    { label: 'Duplex', count: 3, cells: [{ median: 1_100_000, count: 2 }, { median: 1_250_000, count: 1 }] },
  ],
  sample: 43,
};

describe('deriveEligibilityEvidence', () => {
  it('reports the suite RANGE across sizes — never one blended figure', () => {
    const ev = deriveEligibilityEvidence({
      rentMatrix: RENTS,
      rentSource: 'leased',
      sellMatrix: SALES,
      sellSource: 'sold',
      radiusKm: 2,
    })!;
    expect(ev.suiteLeases).toBe(19);
    expect(ev.suiteRentLow).toBe(1_350);
    expect(ev.suiteRentHigh).toBe(1_700);
    expect(ev.suiteSource).toBe('leased');
    expect(ev.radiusKm).toBe(2);
  });

  it('counts only in-home units, never whole-home rentals', () => {
    const ev = deriveEligibilityEvidence({ rentMatrix: RENTS, rentSource: 'leased' })!;
    expect(ev.suiteLeases).toBe(19); // not 36 — the condo row is not a second unit
    expect(ev.suiteRentHigh).toBeLessThan(1_925);
  });

  it('counts plex-type sales for the units-by-right row', () => {
    const ev = deriveEligibilityEvidence({ sellMatrix: SALES, sellSource: 'sold' })!;
    expect(ev.plexSales).toBe(3);
    expect(ev.plexSource).toBe('sold');
    expect(ev.suiteLeases).toBe(0);
  });

  it('drops room-priced cells from the range', () => {
    const withRoom: AskingMatrix = {
      ...RENTS,
      rows: [
        RENTS.rows[0],
        {
          label: IN_HOME_UNIT_LABEL,
          count: 25,
          cells: [
            { median: 500, count: 6 }, // a room, not a unit
            { median: 1_700, count: 13 },
            { median: null, count: 0 },
          ],
        },
      ],
    };
    const ev = deriveEligibilityEvidence({ rentMatrix: withRoom, rentSource: 'leased' })!;
    expect(ev.suiteLeases).toBe(13);
    expect(ev.suiteRentLow).toBe(1_700);
  });

  it('labels anon figures as asking, not achieved', () => {
    const ev = deriveEligibilityEvidence({
      rentMatrix: RENTS,
      rentSource: 'asking',
      sellMatrix: SALES,
      sellSource: 'asking',
    })!;
    expect(ev.suiteSource).toBe('asking');
    expect(ev.plexSource).toBe('asking');
  });

  it('returns null when neither side has anything to prove', () => {
    const noEvidence: AskingMatrix = { ...RENTS, rows: [RENTS.rows[0]] };
    expect(deriveEligibilityEvidence({ rentMatrix: noEvidence, sellMatrix: { ...SALES, rows: [SALES.rows[0]] } })).toBeNull();
    expect(deriveEligibilityEvidence({})).toBeNull();
  });
});
