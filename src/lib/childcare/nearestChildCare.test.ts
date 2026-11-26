import { describe, it, expect } from 'vitest';
import { assignChildCare, inOntarioBbox, inTorontoBbox, MAX_CHILD_CARE_KM, NO_CHILD_CARE_KM } from './nearestChildCare';
import type { ChildCareCentre } from './torontoChildCare';
import type { OntarioChildCareCentre } from './ontarioChildCare';

const HERE: [number, number] = [43.6532, -79.3832];

function centre(p: Partial<ChildCareCentre> & { id: number; lat: number; lng: number }): ChildCareCentre {
  return { name: `C${p.id}`, infant: 0, toddler: 0, preschool: 0, kindergarten: 0, schoolAge: 0, cwelcc: false, ...p };
}

const FIXTURE: ChildCareCentre[] = [
  // ~0.33 km, school-age only — counts for nothing (not young, not CWELCC)
  centre({ id: 1, lat: 43.6562, lng: -79.3832, schoolAge: 30 }),
  // ~0.6 km, toddler only, CWELCC
  centre({ id: 2, lat: 43.6586, lng: -79.3832, toddler: 10, cwelcc: true }),
  // ~1.1 km, infant spaces, not CWELCC
  centre({ id: 3, lat: 43.6632, lng: -79.3832, infant: 10 }),
];

describe('assignChildCare', () => {
  it('finds the nearest centre per kind and rounds to 2 decimals', () => {
    const out = assignChildCare(HERE, FIXTURE, []);
    expect(out.NearestChildCareKm).toBeCloseTo(0.6, 1);
    expect(out.NearestCwelccKm).toBe(out.NearestChildCareKm);
    expect(out.NearestInfantCareKm).toBeCloseTo(1.11, 1);
    expect(Math.round(out.NearestInfantCareKm * 100) / 100).toBe(out.NearestInfantCareKm);
  });

  it('ignores a school-age-only centre for "any" care', () => {
    const out = assignChildCare(HERE, [FIXTURE[0]], []);
    expect(out.NearestChildCareKm).toBe(NO_CHILD_CARE_KM);
  });

  it('returns the sentinel for an invalid location', () => {
    expect(assignChildCare(null, FIXTURE, [])).toEqual({
      NearestChildCareKm: NO_CHILD_CARE_KM,
      NearestInfantCareKm: NO_CHILD_CARE_KM,
      NearestCwelccKm: NO_CHILD_CARE_KM,
    });
    expect(assignChildCare([NaN, -79.4], FIXTURE, []).NearestInfantCareKm).toBe(NO_CHILD_CARE_KM);
    expect(NO_CHILD_CARE_KM).toBeGreaterThan(MAX_CHILD_CARE_KM);
  });

  it('returns the sentinel beyond MAX_CHILD_CARE_KM (listing outside Toronto)', () => {
    // Oakville-ish: ~25 km from downtown.
    const out = assignChildCare([43.4675, -79.6877], FIXTURE, []);
    expect(out.NearestChildCareKm).toBe(NO_CHILD_CARE_KM);
    expect(out.NearestInfantCareKm).toBe(NO_CHILD_CARE_KM);
    expect(out.NearestCwelccKm).toBe(NO_CHILD_CARE_KM);
  });

  it('gives a real distance just inside the radius and the sentinel just outside', () => {
    // 0.04° lat ≈ 4.45 km; 0.05° ≈ 5.56 km
    const near = centre({ id: 9, lat: HERE[0] + 0.04, lng: HERE[1], infant: 5 });
    const far = centre({ id: 10, lat: HERE[0] + 0.05, lng: HERE[1], infant: 5 });
    expect(assignChildCare(HERE, [near], []).NearestInfantCareKm).toBeCloseTo(4.45, 1);
    expect(assignChildCare(HERE, [far], []).NearestInfantCareKm).toBe(NO_CHILD_CARE_KM);
  });

  it('works on the committed dataset for a downtown point', () => {
    const out = assignChildCare(HERE);
    expect(out.NearestChildCareKm).toBeLessThan(1);
    expect(out.NearestInfantCareKm).toBeLessThan(2);
    expect(out.NearestCwelccKm).toBeLessThan(2);
  });
});

describe('inTorontoBbox', () => {
  it('accepts downtown and rejects Oakville and missing coordinates', () => {
    expect(inTorontoBbox(HERE)).toBe(true);
    expect(inTorontoBbox([43.4675, -79.6877])).toBe(false);
    expect(inTorontoBbox(null)).toBe(false);
  });

  it("does not count a $10-a-day centre that has only school-age spaces", () => {
    const only = [centre({ id: 9, lat: 43.6532, lng: -79.3832, schoolAge: 60, kindergarten: 30, cwelcc: true })];
    const r = assignChildCare([43.6532, -79.3832], only, []);
    expect(r.NearestCwelccKm).toBe(NO_CHILD_CARE_KM);
    expect(r.NearestChildCareKm).toBe(NO_CHILD_CARE_KM);
  });
});

describe('assignChildCare — Ontario centres', () => {
  const OAKVILLE: [number, number] = [43.4675, -79.6877];
  const ont = (p: Partial<OntarioChildCareCentre> & { lat: number; lng: number }): OntarioChildCareCentre => ({
    id: '0001', name: 'O', city: 'Oakville', fullDay: true, ...p,
  });

  it('gives NearestChildCareKm from an Ontario centre but keeps infant / $10-a-day Toronto only', () => {
    const out = assignChildCare(OAKVILLE, FIXTURE, [ont({ lat: OAKVILLE[0] + 0.005, lng: OAKVILLE[1] })]);
    expect(out.NearestChildCareKm).toBeCloseTo(0.56, 1);
    expect(out.NearestInfantCareKm).toBe(NO_CHILD_CARE_KM);
    expect(out.NearestCwelccKm).toBe(NO_CHILD_CARE_KM);
  });

  it('takes the nearer of a Toronto and an Ontario centre', () => {
    // Toronto toddler centre ~0.6 km; Ontario centre ~0.22 km.
    const out = assignChildCare(HERE, FIXTURE, [ont({ lat: HERE[0] - 0.002, lng: HERE[1] })]);
    expect(out.NearestChildCareKm).toBeCloseTo(0.22, 1);
    expect(out.NearestCwelccKm).toBeCloseTo(0.6, 1);
  });

  it('keeps the 5 km cap and the sentinel for Ontario centres, also far north', () => {
    expect(assignChildCare(OAKVILLE, [], [ont({ lat: OAKVILLE[0] + 0.05, lng: OAKVILLE[1] })]).NearestChildCareKm).toBe(
      NO_CHILD_CARE_KM
    );
    // Moosonee, 51.3°N: 0.07° lng ≈ 4.9 km.
    const north: [number, number] = [51.28, -80.64];
    expect(assignChildCare(north, [], [ont({ lat: 51.28, lng: -80.71 })]).NearestChildCareKm).toBeCloseTo(4.87, 1);
  });

  it('works on the committed datasets for Oakville', () => {
    const out = assignChildCare(OAKVILLE);
    expect(out.NearestChildCareKm).toBeLessThan(MAX_CHILD_CARE_KM);
    expect(out.NearestInfantCareKm).toBe(NO_CHILD_CARE_KM);
  });
});

describe('inOntarioBbox', () => {
  it('accepts Ottawa, Thunder Bay and Toronto and rejects Montreal and Winnipeg', () => {
    expect(inOntarioBbox([45.42, -75.69])).toBe(true);
    expect(inOntarioBbox([48.38, -89.25])).toBe(true);
    expect(inOntarioBbox(HERE)).toBe(true);
    expect(inOntarioBbox([45.5, -73.57])).toBe(false);
    expect(inOntarioBbox([49.9, -97.14])).toBe(false);
    expect(inOntarioBbox(null)).toBe(false);
  });
});
