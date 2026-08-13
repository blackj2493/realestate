import { describe, it, expect } from 'vitest';
import { calibrationRegionKey } from './livingArea';

/**
 * The avm_sqft_calibration cohort key. Build script and every lookup site share this
 * function; the regression it guards is the one-line key pattern from PR #324 —
 * `if (!cityRegion) continue` silently excluded all of Waterloo Region + Brantford
 * (feed ships no CityRegion there) from both contributing and looking up calibration,
 * leaving every banded listing on the naive range midpoint.
 */
describe('calibrationRegionKey', () => {
  it('prefers CityRegion when present (unchanged behaviour for keyed municipalities)', () => {
    expect(calibrationRegionKey('Bedford Park-Nortown', 'Toronto C04')).toBe('Bedford Park-Nortown');
    // Municipalities where city_region equals the city name have the field POPULATED —
    // they key as themselves and never take the fallback.
    expect(calibrationRegionKey('Blue Mountains', 'Blue Mountains')).toBe('Blue Mountains');
  });

  it('falls back to City when the feed ships no CityRegion (Waterloo Region, Brantford)', () => {
    expect(calibrationRegionKey('', 'Kitchener')).toBe('Kitchener');
    expect(calibrationRegionKey(null, 'Brantford')).toBe('Brantford');
    expect(calibrationRegionKey(undefined, 'Waterloo')).toBe('Waterloo');
    expect(calibrationRegionKey('   ', 'Cambridge')).toBe('Cambridge');
  });

  it('returns "" when no geographic key survives — callers must skip, not key on junk', () => {
    expect(calibrationRegionKey('', '')).toBe('');
    expect(calibrationRegionKey(null, null)).toBe('');
    expect(calibrationRegionKey('  ', undefined)).toBe('');
  });

  it('trims both inputs', () => {
    expect(calibrationRegionKey(' Rural King ', null)).toBe('Rural King');
    expect(calibrationRegionKey(null, ' Kitchener ')).toBe('Kitchener');
  });
});
