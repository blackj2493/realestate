import { describe, it, expect } from 'vitest';
import { buildCampaignFilter, filterEventsToSubjectUnit } from './fetch';
import type { RawVowCampaign } from './normalize';

describe('buildCampaignFilter', () => {
  it('builds an OData filter from street + city', () => {
    expect(buildCampaignFilter({ StreetNumber: '363', StreetName: 'Maria Antonia', City: 'Vaughan' }))
      .toBe("StreetNumber eq '363' and StreetName eq 'Maria Antonia' and City eq 'Vaughan'");
  });
  it('escapes single quotes', () => {
    expect(buildCampaignFilter({ StreetNumber: '1', StreetName: "O'Connor", City: 'Toronto' }))
      .toBe("StreetNumber eq '1' and StreetName eq 'O''Connor' and City eq 'Toronto'");
  });
  it('returns null without a usable street', () => {
    expect(buildCampaignFilter({ City: 'Vaughan' })).toBeNull();
  });
});

describe('filterEventsToSubjectUnit', () => {
  const sale = (UnitNumber: string | undefined, PropertySubType: string): RawVowCampaign =>
    ({ ListingKey: 'k' + UnitNumber, UnitNumber, PropertySubType } as RawVowCampaign);

  it('keeps freehold rows with no unit', () => {
    const subject = { PropertySubType: 'Detached' };
    const rows = [sale(undefined, 'Detached'), sale(undefined, 'Detached')];
    expect(filterEventsToSubjectUnit(rows, subject)).toHaveLength(2);
  });

  it('keeps only the matching condo unit', () => {
    const subject = { UnitNumber: '1605', PropertySubType: 'Condo Apartment' };
    const rows = [sale('1605', 'Condo Apartment'), sale('1606', 'Condo Apartment')];
    const out = filterEventsToSubjectUnit(rows, subject);
    expect(out.map((r) => r.UnitNumber)).toEqual(['1605']);
  });
});
