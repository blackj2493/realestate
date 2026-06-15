import { describe, it, expect } from 'vitest';
import { assignAmenities, NO_AMENITY_KM, type AmenityRecord } from './nearestAmenities';

// Downtown-Toronto-ish anchor for the listing.
const HERE: [number, number] = [43.6532, -79.3832];

const FIXTURE: AmenityRecord[] = [
  // ~0.6 km grocery
  { id: 'g-near', name: 'Near Grocer', type: 'grocery', lat: 43.6585, address: '', lng: -79.3832 },
  // ~3 km grocery (should lose to g-near)
  { id: 'g-far', name: 'Far Grocer', type: 'grocery', lat: 43.68, address: '', lng: -79.40 },
  // ~1.1 km recreation centre
  { id: 'r-near', name: 'Near Rec Centre', type: 'recreation', lat: 43.6632, address: '', lng: -79.3832 },
];

describe('assignAmenities', () => {
  it('picks the nearest of each type and rounds the distance', () => {
    const out = assignAmenities(HERE, FIXTURE);
    expect(out.NearestGroceryName).toBe('Near Grocer');
    expect(out.NearestGroceryKm).toBeGreaterThan(0);
    expect(out.NearestGroceryKm).toBeLessThan(1);
    expect(out.NearestRecCentreName).toBe('Near Rec Centre');
    expect(out.NearestRecCentreKm).toBeCloseTo(1.1, 0);
  });

  it('returns the NO_AMENITY_KM sentinel (not 0) for an invalid location', () => {
    const out = assignAmenities(null);
    expect(out.NearestGroceryKm).toBe(NO_AMENITY_KM);
    expect(out.NearestRecCentreKm).toBe(NO_AMENITY_KM);
    expect(out.NearestGroceryName).toBe('');
    // Sentinel must exceed any realistic walkability threshold so `<=X` never matches it.
    expect(NO_AMENITY_KM).toBeGreaterThan(15);
  });

  it('reports the sentinel when a type has nothing within MAX_AMENITY_KM', () => {
    // Only a grocery 80+ km away → out of range for both types.
    const farOnly: AmenityRecord[] = [
      { id: 'g', name: 'Distant Grocer', type: 'grocery', lat: 44.5, address: '', lng: -78.6 },
    ];
    const out = assignAmenities(HERE, farOnly);
    expect(out.NearestGroceryKm).toBe(NO_AMENITY_KM);
    expect(out.NearestGroceryName).toBe('');
    expect(out.NearestRecCentreKm).toBe(NO_AMENITY_KM);
  });
});
