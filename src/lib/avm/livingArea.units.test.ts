import { describe, it, expect } from 'vitest';
import { resolveDimensionUnit, roomSumSqft, resolveLivingArea, MIN_DIM_ROOMS } from './livingArea';
import type { RoomData } from '@/lib/room-utils';

const room = (l: number, w: number, units?: string | null, level = 'Main'): RoomData => ({
  RoomLength: l,
  RoomWidth: w,
  RoomLevel: level,
  ...(units === undefined ? {} : { RoomLengthWidthUnits: units }),
});

/** A believable metric main floor: edges 3–6 m. */
const metricRooms = (extra: RoomData[] = []): RoomData[] => [
  room(5.54, 4.2),
  room(4.1, 3.6),
  room(3.9, 3.2),
  room(4.8, 3.1),
  ...extra,
];

describe('resolveDimensionUnit — the feed decides when it says so', () => {
  it('takes a declared unit as authoritative', () => {
    expect(resolveDimensionUnit(metricRooms().map((r) => ({ ...r, RoomLengthWidthUnits: 'Meters' }))))
      .toEqual({ unit: 'meters', source: 'declared' });
    expect(resolveDimensionUnit(metricRooms().map((r) => ({ ...r, RoomLengthWidthUnits: 'Feet' }))))
      .toEqual({ unit: 'feet', source: 'declared' });
  });

  it('accepts a declaration on only some rooms (the feed populates it sparsely)', () => {
    const rooms = [...metricRooms()];
    rooms[2] = { ...rooms[2], RoomLengthWidthUnits: 'Meters' };
    expect(resolveDimensionUnit(rooms)).toEqual({ unit: 'meters', source: 'declared' });
  });

  it('ignores contradictory declarations rather than picking a side', () => {
    const rooms = [...metricRooms()];
    rooms[0] = { ...rooms[0], RoomLengthWidthUnits: 'Meters' };
    rooms[1] = { ...rooms[1], RoomLengthWidthUnits: 'Feet' };
    expect(resolveDimensionUnit(rooms).source).toBe('default');
  });

  it('is case- and spacing-insensitive', () => {
    for (const v of ['meters', ' METERS ', 'Metres', 'M']) {
      expect(resolveDimensionUnit([room(4, 3, v)]).unit).toBe('meters');
    }
    for (const v of ['feet', 'FEET', 'Ft']) {
      expect(resolveDimensionUnit([room(12, 10, v)]).unit).toBe('feet');
    }
  });
});

describe('resolveDimensionUnit — no declaration', () => {
  it('defaults to metres', () => {
    // Of 250 ground-truth listings that declare a unit, 250 declare metres and
    // none declare feet (scripts/admin/calibrateRoomUnits.ts).
    expect(resolveDimensionUnit(metricRooms())).toEqual({ unit: 'meters', source: 'default' });
  });

  /**
   * THE PRODUCTION BUG. `max(edge) > 25 => feet` flipped a whole listing on one
   * outlier row, dividing its living area by 10.76. Real example X13613956:
   * edges 2.29–25.11, and the feed declares Meters.
   */
  it('is NOT flipped by a single oversized room', () => {
    const rooms = metricRooms([room(25.11, 4.0)]);
    expect(Math.max(...rooms.map((r) => Math.max(r.RoomLength!, r.RoomWidth!)))).toBeGreaterThan(25);
    expect(resolveDimensionUnit(rooms)).toEqual({ unit: 'meters', source: 'default' });
  });

  it('is not flipped even by several oversized rooms, while the median holds', () => {
    const rooms = metricRooms([room(25.1, 5), room(30, 6), room(28, 4)]);
    expect(resolveDimensionUnit(rooms).unit).toBe('meters');
  });

  it('falls back to feet only where metres is physically impossible', () => {
    // Every room ~25 m across => a 66 ft typical room. Not a dwelling.
    const rooms = [room(24, 22), room(26, 24), room(25, 20), room(28, 26)];
    expect(resolveDimensionUnit(rooms)).toEqual({ unit: 'feet', source: 'implausible-as-metric' });
  });

  it('treats an empty or dimensionless list as metres', () => {
    expect(resolveDimensionUnit([]).unit).toBe('meters');
    expect(resolveDimensionUnit(null).unit).toBe('meters');
    expect(resolveDimensionUnit([{ RoomLevel: 'Main' }]).unit).toBe('meters');
  });
});

describe('resolveLivingArea — the room sum must match the declared band', () => {
  /** Rooms summing to roughly the declared band: trusted. */
  it('uses measured rooms when they agree with the band', () => {
    const r = resolveLivingArea({ LivingAreaRange: '700-1100' }, { rooms: metricRooms() });
    expect(r.source).toBe('rooms');
  });

  it('rejects a room sum far BELOW the band (incomplete room list)', () => {
    // Four tiny rooms against a 3500-5000 band.
    const rooms = [room(2.0, 2.0), room(2.1, 2.0), room(2.0, 2.2), room(2.3, 2.0)];
    const r = resolveLivingArea({ LivingAreaRange: '3500-5000' }, { rooms });
    expect(r.source).not.toBe('rooms');
  });

  /**
   * The guard that was missing. 4,132 production listings feed the AVM a room sum
   * more than double their declared band, and 2,144 more than 4x — lot dimensions
   * or decimal slips in the room fields, not large homes.
   */
  it('rejects a room sum far ABOVE the band (dimensions are not room dimensions)', () => {
    const rooms = [room(30, 25), room(28, 24), room(26, 22), room(31, 20)];
    const r = resolveLivingArea({ LivingAreaRange: '700-1100' }, { rooms });
    expect(r.source).not.toBe('rooms');
  });

  it('still trusts rooms when no band is declared to check against', () => {
    const r = resolveLivingArea({}, { rooms: metricRooms() });
    expect(r.source).toBe('rooms');
  });

  it('prefers an exact BuildingAreaTotal over everything', () => {
    const r = resolveLivingArea(
      { BuildingAreaTotal: 1847, LivingAreaRange: '700-1100' },
      { rooms: metricRooms() }
    );
    expect(r).toEqual({ sqft: 1847, source: 'exact' });
  });
});

describe('roomSumSqft', () => {
  it('converts metric rooms to square feet', () => {
    const r = roomSumSqft(metricRooms())!;
    expect(r).not.toBeNull();
    expect(r.unit).toBe('meters');
    expect(r.roomCount).toBe(4);
    // 5.54*4.2 + 4.1*3.6 + 3.9*3.2 + 4.8*3.1 = 65.87 m² -> ~709 sqft
    expect(r.rawSqft).toBeGreaterThan(650);
    expect(r.rawSqft).toBeLessThan(750);
  });

  it('does not convert when the feed declares feet', () => {
    const r = roomSumSqft(metricRooms().map((x) => ({ ...x, RoomLengthWidthUnits: 'Feet' })))!;
    expect(r.unit).toBe('feet');
    expect(r.unitSource).toBe('declared');
    expect(r.rawSqft).toBeLessThan(100); // same numbers, read as feet
  });

  /** The regression this whole change exists for. */
  it('keeps a metric listing metric despite one 25m+ room', () => {
    const withOutlier = roomSumSqft(metricRooms([room(25.11, 4.0, undefined, 'Basement')]))!;
    const without = roomSumSqft(metricRooms())!;
    expect(withOutlier.unit).toBe('meters');
    // The outlier is below grade, so it must not change the above-grade sum at all.
    expect(withOutlier.rawSqft).toBeCloseTo(without.rawSqft, 5);
  });

  it('ignores 1x1 placeholder rows when deciding the unit', () => {
    const rooms = [...metricRooms(), room(1, 1), room(1, 1), room(1, 1), room(1, 1)];
    const r = roomSumSqft(rooms)!;
    expect(r.unit).toBe('meters');
    expect(r.roomCount).toBe(4); // placeholders dropped from the sum too
  });

  it('returns null below the minimum dimensioned-room count', () => {
    const rooms = Array.from({ length: MIN_DIM_ROOMS - 1 }, () => room(4, 3));
    expect(roomSumSqft(rooms)).toBeNull();
  });

  it('counts only above-grade rooms', () => {
    const rooms = [...metricRooms(), room(5, 4, undefined, 'Basement')];
    expect(roomSumSqft(rooms)!.roomCount).toBe(4);
  });
});
