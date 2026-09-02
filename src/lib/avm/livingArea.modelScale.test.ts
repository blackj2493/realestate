import { describe, it, expect } from 'vitest';
import { resolveLivingArea, resolveModelSqft } from './livingArea';
import { mapListingToAVMInput } from './mapListingToAVMInput';
import type { RoomData } from '@/lib/room-utils';

/**
 * The scale bug: the AVM's square-footage COEFFICIENT is fitted on
 * raw_vow_sold.building_area_total, which is the seller-declared MLS band (it equals
 * living_area_range on 171,608 of the 180,619 sale rows that carry it). Production fed
 * the subject a grossed room-dimension sum instead — a sharper number on a DIFFERENT
 * scale — so every subject was compared against comps measured a different way.
 *
 * The residual shears with size rather than cancelling (avm_sqft_calibration, Detached,
 * median room-sum ÷ band midpoint: 1.27 at 700-1100 falling monotonically to 0.83 at
 * 3500-5000), so the AVM read large homes as smaller than their comps and small homes
 * as larger.
 *
 * N13545488 (55 Headwind Blvd, Vaughan) is the case that surfaced it: a declared
 * 2500-3000 home whose room list omits the family room and breakfast area. It reached
 * the coefficients as 2,354 sqft against 26 same-band comps carrying 2,750, which took
 * 4.9 points off the estimate and left it below all but 2 of 39 comparable sales.
 *
 * raw_vow_sold stores no room dimensions at all, so avm-backtest.ts builds its subjects
 * straight from building_area_total and has only ever scored the band scale. Nothing in
 * the gate could see the substitution — hence this test, at the seam itself.
 */

/** The subject's above-grade rooms, metres, as the feed shipped them. */
const HEADWIND_ROOMS: RoomData[] = [
  { RoomType: 'Bedroom 3', RoomLevel: 'Second', RoomLength: 4.75, RoomWidth: 3.03, RoomLengthWidthUnits: 'Meters' },
  { RoomType: 'Bedroom 4', RoomLevel: 'Second', RoomLength: 5.63, RoomWidth: 3.11, RoomLengthWidthUnits: 'Meters' },
  { RoomType: 'Bedroom 2', RoomLevel: 'Second', RoomLength: 3.04, RoomWidth: 5, RoomLengthWidthUnits: 'Meters' },
  { RoomType: 'Laundry', RoomLevel: 'Main', RoomLength: 5, RoomWidth: 1.1, RoomLengthWidthUnits: 'Meters' },
  { RoomType: 'Primary Bedroom', RoomLevel: 'Second', RoomLength: 4.64, RoomWidth: 5.06, RoomLengthWidthUnits: 'Meters' },
  { RoomType: 'Dining Room', RoomLevel: 'Main', RoomLength: 3.41, RoomWidth: 3.11, RoomLengthWidthUnits: 'Meters' },
  { RoomType: 'Living Room', RoomLevel: 'Main', RoomLength: 4.96, RoomWidth: 5.75, RoomLengthWidthUnits: 'Meters' },
  { RoomType: 'Bathroom', RoomLevel: 'Second', RoomLength: 3.15, RoomWidth: 1.8 },
  { RoomType: 'Kitchen', RoomLevel: 'Main', RoomLength: 5.03, RoomWidth: 4.96, RoomLengthWidthUnits: 'Meters' },
  // Below grade — excluded from the sum, but they carry the listing's room count.
  { RoomType: 'Exercise Room', RoomLevel: 'Basement', RoomLength: 7.22, RoomWidth: 4.76 },
  { RoomType: 'Utility Room', RoomLevel: 'Basement', RoomLength: 1.97, RoomWidth: 1.36 },
];

const headwind = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  CityRegion: 'Vellore Village',
  City: 'Vaughan',
  PostalCode: 'L4H 3R9',
  PropertySubType: 'Detached',
  LivingAreaRange: '2500-3000',
  BuildingAreaTotal: null,
  BedroomsAboveGrade: 4,
  BathroomsTotalInteger: 4,
  ParkingTotal: 4,
  LotWidth: 40.03,
  LotDepth: 104.99,
  ...over,
});

describe('resolveModelSqft — the subject is measured the way the comps were', () => {
  it('feeds the declared band, not the room-dimension sum', () => {
    const payload = headwind();

    // The measurement is still available, and still the better answer to "how big".
    const measured = resolveLivingArea(payload, { rooms: HEADWIND_ROOMS });
    expect(measured.source).toBe('rooms');
    expect(measured.sqft).toBe(2354);

    // The model sees the band midpoint — what an identical comp carries.
    expect(resolveModelSqft(payload)).toEqual({ sqft: 2750, source: 'range_midpoint' });
  });

  it('prefers an exact BuildingAreaTotal, which the comps also carry when the feed sends one', () => {
    expect(resolveModelSqft(headwind({ BuildingAreaTotal: 2900 }))).toEqual({
      sqft: 2900,
      source: 'exact',
    });
  });

  it('never returns the calibrated bucket median — that table is built from room sums too', () => {
    // refresh-sqft-calibration.ts fills median_gla from roomSumSqft, so the calibrated
    // rung carries the same shear as the rooms rung. It is not an escape hatch.
    const payload = headwind({ LivingAreaRange: '' });
    expect(resolveLivingArea(payload, {
      rooms: HEADWIND_ROOMS,
      bucketCalibration: { medianGla: 2595, sampleCount: 40 },
    }).source).toBe('rooms');
    expect(resolveModelSqft(payload)).toEqual({ sqft: null, source: 'none' });
  });

  it('reports no size rather than a mis-scaled one when the feed declares neither', () => {
    // Measured at 1 listing in 8,000 priced actives. Null means mean-imputation
    // (z = 0, "average for the cohort"), which beats a number on the wrong scale.
    expect(resolveModelSqft(headwind({ LivingAreaRange: '', BuildingAreaTotal: null }))).toEqual({
      sqft: null,
      source: 'none',
    });
  });
});

describe('mapListingToAVMInput — room dimensions cannot reach the coefficients', () => {
  it('carries the band midpoint into buildingAreaTotal', () => {
    expect(mapListingToAVMInput(headwind())?.buildingAreaTotal).toBe(2750);
  });

  it('gives the same answer no matter what the room list says', () => {
    // The mapper takes no rooms argument any more. This is the guard against
    // re-introducing one: the model feature is a property of the payload alone.
    const withRooms = { ...headwind(), rooms: HEADWIND_ROOMS };
    const withoutRooms = headwind();
    expect(mapListingToAVMInput(withRooms)?.buildingAreaTotal).toBe(
      mapListingToAVMInput(withoutRooms)?.buildingAreaTotal
    );
  });

  it('does not shear with size across the band ladder', () => {
    // Each band must land on its own midpoint. Under the room-sum scale these came in
    // at roughly 1.27x / 1.12x / 1.05x / 1.00x / 0.94x / 0.90x / 0.83x of these values.
    const bands: [string, number][] = [
      ['700-1100', 900],
      ['1100-1500', 1300],
      ['1500-2000', 1750],
      ['2000-2500', 2250],
      ['2500-3000', 2750],
      ['3000-3500', 3250],
      ['3500-5000', 4250],
    ];
    for (const [band, mid] of bands) {
      expect(mapListingToAVMInput(headwind({ LivingAreaRange: band }))?.buildingAreaTotal).toBe(mid);
    }
  });
});
