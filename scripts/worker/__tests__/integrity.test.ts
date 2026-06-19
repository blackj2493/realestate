/**
 * ETL integrity test: locks the transformer → Typesense schema contract.
 *
 * CLAUDE.md §6 hazard: "Typesense will reject entire batches if a single
 * object is missing a declared key." Every field declared in
 * `typesenseSchema.fields` MUST be present (or be `optional: true`) on the
 * document `transformListing()` produces, with the correct type. Without this
 * test, a future change to transformer.ts that drops a field — or that emits
 * `null` where Typesense expects `int32` — silently fails the nightly sync
 * (or worse, drops half a batch and leaves the index inconsistent).
 *
 * The validator walks the live schema, so adding a non-optional field to
 * typesenseSchema.ts WITHOUT updating transformer.ts will turn this test red
 * immediately on the PR that introduces the schema drift.
 */

import { describe, it, expect, vi } from 'vitest';
import vowSample from '../__fixtures__/vow-sample.json' assert { type: 'json' };

// Heavy worker dependencies that transformListing pulls in at import time —
// stubbed so the test runs without env / network / postal-code CSVs.
vi.mock('@/lib/supabase/client', () => ({ getServiceRoleClient: vi.fn() }));
vi.mock('@/lib/typesense/client', () => ({
  indexListing: vi.fn(),
  deleteListing: vi.fn(),
}));
vi.mock('@/lib/postalCodes', () => ({
  loadPostalCodes: vi.fn(),
  isDataLoaded: () => true,
}));
vi.mock('@/services/BuilderAnalyticsEngine', () => ({
  processBuilderMetrics: vi.fn(() => ({
    lot_width_ft: 46,
    lot_depth_ft: 117.25,
    lot_area_sqft: 46 * 117.25,
    is_covered_land: false,
    severance_candidate: false,
    infrastructure_flag: '',
    density_play: '',
    price_per_sqft: 0,
    multiplexByRight: false,
    zoningDesignation: '',
  })),
}));
vi.mock('@/lib/amenities/nearestAmenities', () => ({
  assignAmenities: vi.fn(() => ({
    NearestGroceryKm: 99,
    NearestGroceryName: '',
    NearestRecCentreKm: 99,
    NearestRecCentreName: '',
  })),
}));
vi.mock('@/lib/schools/nearestSchools', () => ({
  // Realistic shape: cargo strings + numeric scores + ids array. Optional
  // fields per schema, but the transformer copies every key through.
  assignSchools: vi.fn(() => ({
    ElemPublicScore: 0,
    ElemPublicSchool: '',
    ElemPublicDistanceKm: 0,
    ElemCatholicScore: 0,
    ElemCatholicSchool: '',
    ElemCatholicDistanceKm: 0,
    SecPublicScore: 0,
    SecPublicSchool: '',
    SecPublicDistanceKm: 0,
    SecCatholicScore: 0,
    SecCatholicSchool: '',
    SecCatholicDistanceKm: 0,
    BestElementaryScore: 0,
    BestSecondaryScore: 0,
    BestSchoolScoreNearby: 0,
    NearbySchools: [],
  })),
}));
vi.mock('../resolveLocation', () => ({
  resolveLocation: vi.fn(() => ({
    location: [43.74, -79.78],
    needsGeocoding: false,
  })),
}));
vi.mock('../services/rentAVM', () => ({
  fetchRentAVM: vi.fn(async () => ({
    annual_rent: 0,
    annual_rent_p10: 0,
    has_data: false,
  })),
}));
vi.mock('../services/ratioPriceCalculator', () => ({
  resolveRatioPrice: vi.fn(async () => ({
    calculation_price: 1_699_900,
    is_price_discovery: false,
  })),
  fetchMillRate: vi.fn(async () => ({ base_mill_rate: 0.010, city: 'Brampton' })),
}));

import { transformListing } from '../transformer';
import { typesenseSchema } from '@/lib/typesense/typesenseSchema';

// ───────────────────────────────────────────────────────────────────────────
// Runtime schema validator: walks the live typesenseSchema.fields and checks
// the transformer's output. Returns a list of human-readable error strings.
// ───────────────────────────────────────────────────────────────────────────

type SchemaField = { name: string; type: string; optional?: boolean };

function validateAgainstSchema(
  doc: Record<string, unknown>,
  fields: readonly SchemaField[]
): string[] {
  const errors: string[] = [];

  for (const field of fields) {
    const present = Object.prototype.hasOwnProperty.call(doc, field.name);
    if (!present) {
      if (!field.optional) errors.push(`missing required field: ${field.name}`);
      continue;
    }
    const value = doc[field.name];

    // `null` and `undefined` count as missing — Typesense rejects them when the
    // field is non-optional.
    if (value === null || value === undefined) {
      if (!field.optional) {
        errors.push(`field ${field.name} is null/undefined but schema marks it required`);
      }
      continue;
    }

    switch (field.type) {
      case 'int32':
      case 'int64':
      case 'float':
        if (typeof value !== 'number' || Number.isNaN(value)) {
          errors.push(`field ${field.name}: expected ${field.type} (number), got ${typeof value}`);
        }
        break;
      case 'string':
        if (typeof value !== 'string') {
          errors.push(`field ${field.name}: expected string, got ${typeof value}`);
        }
        break;
      case 'bool':
        if (typeof value !== 'boolean') {
          errors.push(`field ${field.name}: expected bool, got ${typeof value}`);
        }
        break;
      case 'string[]':
        if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
          errors.push(`field ${field.name}: expected string[], got ${Array.isArray(value) ? 'mixed array' : typeof value}`);
        }
        break;
      case 'geopoint':
        if (
          !Array.isArray(value) ||
          value.length !== 2 ||
          typeof value[0] !== 'number' ||
          typeof value[1] !== 'number'
        ) {
          errors.push(`field ${field.name}: expected geopoint [lat,lng]`);
        }
        break;
      case 'auto':
        // `auto` lets Typesense infer — no constraint to enforce here.
        break;
      default:
        errors.push(`field ${field.name}: unknown schema type "${field.type}"`);
    }
  }

  return errors;
}

describe('ETL integrity — transformer output matches Typesense schema', () => {
  it('validates the transformed VOW fixture against every declared field', async () => {
    const raw = (vowSample as { property: Record<string, unknown> }).property;
    const result = await transformListing(raw);

    const errors = validateAgainstSchema(
      result.typesensePayload as unknown as Record<string, unknown>,
      typesenseSchema.fields as unknown as SchemaField[]
    );

    // Surface the actual list of errors if this ever regresses — a future
    // schema drift PR should see EXACTLY which key is missing or mis-typed.
    expect(errors, errors.join('\n')).toEqual([]);
  });

  it('produces a non-empty PropertyHash + numeric ListPrice (sanity)', async () => {
    const raw = (vowSample as { property: Record<string, unknown> }).property;
    const result = await transformListing(raw);
    const doc = result.typesensePayload as unknown as Record<string, unknown>;

    expect(typeof doc.PropertyHash).toBe('string');
    expect((doc.PropertyHash as string).length).toBeGreaterThan(0);
    expect(typeof doc.ListPrice).toBe('number');
    expect(doc.ListPrice).toBeGreaterThan(0);
  });

  it('emits a valid 2-element geopoint for `location`', async () => {
    const raw = (vowSample as { property: Record<string, unknown> }).property;
    const result = await transformListing(raw);
    const loc = (result.typesensePayload as unknown as { location: unknown }).location;
    expect(Array.isArray(loc)).toBe(true);
    expect((loc as number[]).length).toBe(2);
    for (const n of loc as number[]) expect(typeof n).toBe('number');
  });
});

describe('ETL integrity — the validator itself', () => {
  // The validator is the safety net; if it fails to flag a synthetic missing
  // field, the schema-drift test above is meaningless.
  const fields: SchemaField[] = [
    { name: 'a', type: 'int32' },
    { name: 'b', type: 'string', optional: true },
  ];

  it('flags a missing required field', () => {
    expect(validateAgainstSchema({ b: 'x' }, fields)).toContain(
      'missing required field: a'
    );
  });

  it('flags a null on a required field', () => {
    expect(validateAgainstSchema({ a: null, b: 'x' }, fields)).toEqual([
      'field a is null/undefined but schema marks it required',
    ]);
  });

  it('allows an optional field to be absent', () => {
    expect(validateAgainstSchema({ a: 1 }, fields)).toEqual([]);
  });

  it('flags a type mismatch on a number field', () => {
    expect(validateAgainstSchema({ a: 'oops' }, fields)).toContain(
      'field a: expected int32 (number), got string'
    );
  });
});
