import { describe, it, expect } from 'vitest';
import { mapListingToAVMInput } from './mapListingToAVMInput';

/**
 * The blank-CityRegion regression (feat/avm-fsa-cohort): the mapper used to return
 * null whenever CityRegion was blank, which silently zeroed AVM coverage for every
 * municipality the feed ships without one — all of Waterloo Region and Brantford,
 * 4,155 active listings with 0 estimates while Kitchener alone had 2,433 sold comps
 * on file. The requirement is now "some geographic key survives": CityRegion, or
 * city + a valid postal FSA.
 */
const payload = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  CityRegion: '',
  City: 'Kitchener',
  PostalCode: 'N2H 5X8',
  PropertySubType: 'Detached',
  BedroomsAboveGrade: 3,
  BathroomsTotalInteger: 2,
  ...over,
});

describe('mapListingToAVMInput geographic-key guard', () => {
  it('maps a blank-CityRegion listing when city + valid FSA are present', () => {
    const input = mapListingToAVMInput(payload());
    expect(input).not.toBeNull();
    expect(input!.cityRegion).toBe('');
    expect(input!.city).toBe('Kitchener');
    expect(input!.postalCode).toBe('N2H 5X8');
  });

  it('still returns null when NO geographic key survives', () => {
    // no CityRegion, no postal
    expect(mapListingToAVMInput(payload({ PostalCode: '' }))).toBeNull();
    // no CityRegion, junk postal
    expect(mapListingToAVMInput(payload({ PostalCode: '12345' }))).toBeNull();
    // no CityRegion, no city
    expect(mapListingToAVMInput(payload({ City: '' }))).toBeNull();
  });

  it('a real CityRegion needs neither city nor postal (unchanged behaviour)', () => {
    const input = mapListingToAVMInput(
      payload({ CityRegion: 'Bedford Park-Nortown', City: '', PostalCode: '' })
    );
    expect(input).not.toBeNull();
    expect(input!.cityRegion).toBe('Bedford Park-Nortown');
  });

  it('sub-type stays non-negotiable', () => {
    expect(mapListingToAVMInput(payload({ PropertySubType: '' }))).toBeNull();
    expect(
      mapListingToAVMInput(payload({ CityRegion: 'Bedford Park-Nortown', PropertySubType: '' }))
    ).toBeNull();
  });
});
