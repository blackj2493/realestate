import { describe, it, expect, vi } from 'vitest';

// The module builds a Supabase client at import time. Nothing here may reach the
// network: the paths under test are the ones that must answer WITHOUT a query, and a
// throwing stub is what proves it.
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => {
      throw new Error('fetchMainUnitRent must not query on this path');
    },
  }),
}));

import { fetchMainUnitRent } from './rentAVM';

const wholeHome = {
  annual_rent: 63_000, // $5,250/mo
  annual_rent_p10: 54_000,
  has_data: true,
  match_tier: 'city_bath' as const,
  plus_room_aware: true,
};

const base = {
  city: 'Vaughan',
  cityRegion: 'Vellore Village',
  propertySubType: 'Detached',
  bathroomsTotal: 5,
  wholeHome,
};

describe('fetchMainUnitRent', () => {
  /**
   * The regression this file exists for. A home with a below-grade KITCHEN but no
   * below-grade BEDROOM has no "+1" to strip, so the whole-home comp already IS the
   * main unit. It used to return has_data:false, which the callers' all-or-nothing
   * rule read as "no main-unit cohort" and used to discard the suite line entirely —
   * N13698568 is 4+0 with a $1,700 suite comp and published no suite income at all.
   */
  it('returns the whole-home comp when there is no plus-room to strip', async () => {
    const r = await fetchMainUnitRent({
      ...base, bedroomsTotal: 4, bedroomsAboveGrade: 4, bedroomsBelowGrade: null,
    });
    expect(r).toBe(wholeHome);
    expect(r.has_data).toBe(true);
  });

  it('treats an explicit zero below-grade the same way', async () => {
    const r = await fetchMainUnitRent({
      ...base, bedroomsTotal: 4, bedroomsAboveGrade: 4, bedroomsBelowGrade: 0,
    });
    expect(r).toBe(wholeHome);
  });

  it('returns the whole-home comp when the listing has no bed data at all', async () => {
    const r = await fetchMainUnitRent({
      ...base, bedroomsTotal: 0, bedroomsAboveGrade: null, bedroomsBelowGrade: null,
    });
    expect(r).toBe(wholeHome);
  });

  it('carries a no-comp whole-home result through unchanged', async () => {
    // has_data:false must stay false. The caller's all-or-nothing rule depends on it,
    // and inventing a comp here is the exact failure mode migration 125 removed.
    const none = {
      annual_rent: 0, annual_rent_p10: 0, has_data: false,
      match_tier: null, plus_room_aware: false,
    };
    const r = await fetchMainUnitRent({
      ...base, bedroomsTotal: 3, bedroomsAboveGrade: 3, bedroomsBelowGrade: 0, wholeHome: none,
    });
    expect(r).toBe(none);
  });

  it('DOES look up a separate cohort when a plus-room exists', async () => {
    // 3+1: the "+1" is the basement, so the main unit is a genuinely different cohort
    // and the function must go and fetch it. The throwing stub is the assertion.
    await expect(
      fetchMainUnitRent({ ...base, bedroomsTotal: 4, bedroomsAboveGrade: 3, bedroomsBelowGrade: 1 })
    ).rejects.toThrow('must not query on this path');
  });
});
