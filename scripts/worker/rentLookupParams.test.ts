import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { rentLookupParamsFromFeed } from './services/rentAVM';

/**
 * Guards the rent lookup's inputs against call-site drift.
 *
 * This exists because that drift shipped twice, silently, in the same week:
 *
 *   1. The recompute job's `fetchMainUnitRent` call omitted `livingAreaRange`, so a
 *      recomputed listing skipped the per-size rent ceiling that a freshly-synced one
 *      applied — the two disagreed about the same property.
 *   2. Migration 151 added `postalCode` to `fetchRentAVM` but not to `fetchMainUnitRent`.
 *      Wherever a suite is OBSERVED it is the main-unit result that gets published, so the
 *      FSA cross-check was silently disabled on ~20% of the book. Nothing errored; the
 *      field simply came back -1, which reads as "unknown, do not flag".
 *
 * Neither had a failing test to catch it, because both were a missing LINE rather than a
 * wrong one. A shared mapper turns that class of bug into a compile error; these tests
 * keep the call sites using it.
 */
const SRC = (rel: string) => fs.readFileSync(path.join(__dirname, rel), 'utf8');
const RENT_AVM = SRC('services/rentAVM.ts');

describe('rentLookupParamsFromFeed', () => {
  it('maps every field the lookup keys on', () => {
    const p = rentLookupParamsFromFeed({
      City: 'Toronto C02',
      CityRegion: 'Annex',
      PropertySubType: 'Condo Apartment',
      BedroomsTotal: 2,
      BedroomsAboveGrade: 2,
      BedroomsBelowGrade: 0,
      BathroomsTotalInteger: 3,
      CountyOrParish: 'Toronto',
      LivingAreaRange: '1400-1599',
      PostalCode: 'M6G 1Y6',
    });
    expect(p).toEqual({
      city: 'Toronto C02',
      cityRegion: 'Annex',
      propertySubType: 'Condo Apartment',
      bedroomsTotal: 2,
      bedroomsAboveGrade: 2,
      bedroomsBelowGrade: 0,
      bathroomsTotal: 3,
      county: 'Toronto',
      livingAreaRange: '1400-1599',
      postalCode: 'M6G 1Y6',
    });
  });

  it('carries the postal code, which is what 151 needs', () => {
    // Named explicitly: dropping it is not an error, it just turns the cross-check off.
    expect(rentLookupParamsFromFeed({ PostalCode: 'M6N 3B4' }).postalCode).toBe('M6N 3B4');
  });

  it('carries the size band, which is what the rent ceiling needs', () => {
    expect(rentLookupParamsFromFeed({ LivingAreaRange: '700-1100' }).livingAreaRange).toBe('700-1100');
  });

  it('falls back to the city when the feed has no CityRegion', () => {
    // The pre-existing idiom at every call site; the mapper must preserve it.
    expect(rentLookupParamsFromFeed({ City: 'Barrie' }).cityRegion).toBe('Barrie');
  });

  it('never emits undefined for the string keys the lookup trims', () => {
    const p = rentLookupParamsFromFeed({});
    expect(p.city).toBe('');
    expect(p.cityRegion).toBe('');
    expect(p.propertySubType).toBe('');
    expect(p.bedroomsTotal).toBe(0);
    expect(p.bathroomsTotal).toBe(0);
  });

  it('offers every optional input fetchRentAVM declares', () => {
    // Reads the param list off the source: a field added to fetchRentAVM but not to the
    // mapper is exactly how postalCode came to be missing from the main-unit path.
    const decl = RENT_AVM.slice(
      RENT_AVM.indexOf('export async function fetchRentAVM(params: {'),
      RENT_AVM.indexOf('}): Promise<RentAVMResult> {', RENT_AVM.indexOf('export async function fetchRentAVM')),
    );
    const declared = [...decl.matchAll(/^\s{2}(\w+)\??:/gm)].map((m) => m[1]);
    expect(declared.length).toBeGreaterThan(5);
    const mapped = Object.keys(rentLookupParamsFromFeed({
      City: 'x', CityRegion: 'y', PropertySubType: 'z', BedroomsTotal: 1,
      BedroomsAboveGrade: 1, BedroomsBelowGrade: 0, BathroomsTotalInteger: 1,
      CountyOrParish: 'c', LivingAreaRange: '1', PostalCode: 'M1M 1M1',
    }));
    for (const field of declared) expect(mapped).toContain(field);
  });
});

describe('the rent lookup call sites use the shared mapper', () => {
  const CALLERS = [
    ['../worker/transformer.ts', 'transformer'],
    ['../admin/recompute-rent-derived-metrics.ts', 'recompute job'],
  ] as const;

  for (const [rel, label] of CALLERS) {
    it(`${label} builds no rent lookup params by hand`, () => {
      const src = fs.readFileSync(path.join(__dirname, rel), 'utf8');
      // The tell of a hand-built object: `bedroomsAboveGrade:` appearing outside the
      // mapper. fetchSuiteRent takes a different, smaller shape and does not use it.
      expect(src).not.toMatch(/bedroomsAboveGrade:\s*raw\./);
      expect(src).toContain('rentLookupParamsFromFeed');
    });

    it(`${label} passes the mapper's output to BOTH lookups`, () => {
      const src = fs.readFileSync(path.join(__dirname, rel), 'utf8');
      // fetchMainUnitRent is the one that publishes wherever a suite is observed, so it
      // is the one whose omission is invisible.
      expect(src).toMatch(/fetchRentAVM\(\s*rentLookupParamsFromFeed\(raw\)\s*\)/);
      expect(src).toMatch(/fetchMainUnitRent\(\{\s*\.\.\.rentLookupParamsFromFeed\(raw\)/);
    });
  }
});
