/**
 * The cohort ladder in the LIVE estimate — community → postal FSA → city — and the one
 * rule that makes it safe: a coarse rung supplies coefficients for the ADJUSTMENT but
 * never for ROUTING.
 *
 * #452 let a coarse rung route as trained and measured 25% of Waterloo Region suppressed
 * on the floor branch and 25 of 40 listings MEDIUM → LOW (#458). Every test here pins a
 * behaviour that revert relied on.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import * as auditService from './auditService';
import * as matrixService from './matrixService';
import * as siblingModel from './siblingModel';
import { estimateFromMarketData, marketDataOf, resolveModel, shouldEvaluatePeers } from './calculator';
import type { AnchorResult } from './anchorService';
import type { CoefficientRow } from './matrixService';
import type { AVMInput } from './types';
import { CONFIDENCE_HIGH, CONFIDENCE_LOW, CONFIDENCE_MEDIUM, ENGINE_MODE_ANCHOR_ONLY, ENGINE_MODE_COEFFICIENT_ADJUSTED } from './types';

const stubClient = {} as unknown as SupabaseClient;

/** A Kitchener subject: blank CityRegion, city + FSA present (the Waterloo Region shape). */
const KITCHENER: AVMInput = {
  cityRegion: '',
  city: 'Kitchener',
  propertySubType: 'Detached',
  rawPropertySubType: 'Detached',
  buildingAreaTotal: 1750,
  lotWidth: 26,
  lotDepth: 142,
  bedroomsAboveGrade: 3,
  bedroomsBelowGrade: 2,
  bathroomsTotalInteger: 4,
  parkingTotal: 4,
  interiorTier: 3,
  exteriorTier: 3,
  basementTier: 3,
  postalCode: 'N2N 3P4',
};

const row = (featureName: string, beta: number, mean: number, std: number): CoefficientRow => ({
  featureName,
  beta,
  mean,
  std,
});
const FSA_ROWS = [row('bathrooms_total_integer', 0.06, 2.8, 0.8), row('bedrooms_above_grade', 0.02, 3.3, 0.6)];
const CITY_ROWS = [row('bathrooms_total_integer', 0.13, 2.8, 1.0)];
const COMMUNITY_ROWS = [row('bathrooms_total_integer', 0.05, 3.0, 0.9)];

describe('resolveModel — the ladder', () => {
  afterEach(() => vi.restoreAllMocks());

  it('takes the FSA rung for a blank-CityRegion subject and routes it as UNTRAINED', async () => {
    const coeff = vi.spyOn(matrixService, 'fetchCohortCoefficients').mockResolvedValue([
      { rung: 'fsa', rows: FSA_ROWS },
      { rung: 'city', rows: CITY_ROWS },
    ]);
    vi.spyOn(auditService, 'fetchCohortAudit').mockResolvedValue([
      { rung: 'fsa', r2: 0.66, basePrice: 793_625, n: 219 },
      { rung: 'city', r2: 0.49, basePrice: 805_930, n: 2122 },
    ]);
    const sibling = vi.spyOn(siblingModel, 'fetchSiblingModel');

    const m = await resolveModel(stubClient, KITCHENER);

    expect(m.rung).toBe('fsa');
    expect(m.effectiveCoefficients).toBe(FSA_ROWS);
    expect(m.nativeCoefficients).toEqual([]); // routing: untrained
    expect(m.r2).toBe(0.66); // the FSA's own audit, not the city's
    expect(m.basePrice).toBe(793_625);
    expect(m.borrowed).toBe(false);
    expect(sibling).not.toHaveBeenCalled(); // own market beats a neighbour's community
    // The ladder handed to the lookups carries the FSA and the city, no community.
    expect(coeff.mock.calls[0][1].map((r) => r.rung)).toEqual(['fsa', 'city']);
    // And it routes exactly like any untrained cohort: peers are always evaluated.
    expect(shouldEvaluatePeers(KITCHENER, m.nativeCoefficients)).toBe(true);
  });

  it('skips a coarse rung that fails the fallback gate and takes the next one', async () => {
    vi.spyOn(matrixService, 'fetchCohortCoefficients').mockResolvedValue([
      { rung: 'fsa', rows: FSA_ROWS },
      { rung: 'city', rows: CITY_ROWS },
    ]);
    vi.spyOn(auditService, 'fetchCohortAudit').mockResolvedValue([
      { rung: 'fsa', r2: 0.43, basePrice: 715_837, n: 40 }, // weak fit — same bar a sibling must clear
      { rung: 'city', r2: 0.62, basePrice: 700_000, n: 900 },
    ]);
    vi.spyOn(siblingModel, 'fetchSiblingModel');

    const m = await resolveModel(stubClient, KITCHENER);
    expect(m.rung).toBe('city');
    expect(m.effectiveCoefficients).toBe(CITY_ROWS);
    expect(m.r2).toBe(0.62);
  });

  it('falls through to the sibling borrow, with ONLY the community audit, when no coarse rung clears the gate', async () => {
    vi.spyOn(matrixService, 'fetchCohortCoefficients').mockResolvedValue([{ rung: 'city', rows: CITY_ROWS }]);
    vi.spyOn(auditService, 'fetchCohortAudit').mockResolvedValue([
      { rung: 'city', r2: 0.13, basePrice: 500_000, n: 3000 }, // Kitchener condos: r2 0.13
    ]);
    const siblingRows = [row('bathrooms_total_integer', 0.04, 2.5, 0.7)];
    vi.spyOn(siblingModel, 'fetchSiblingModel').mockResolvedValue({
      coefficients: siblingRows,
      r2: 0.7,
      n: 80,
      siblingCityRegion: 'Elsewhere',
    });

    const m = await resolveModel(stubClient, { ...KITCHENER, propertySubType: 'Condo Apartment' });
    expect(m.rung).toBeNull();
    expect(m.borrowed).toBe(true);
    expect(m.effectiveCoefficients).toBe(siblingRows);
    // The unused city rung's Base_Price must not become the anchor's prior.
    expect(m.basePrice).toBeNull();
  });

  it('is byte-for-byte the pre-ladder shape for a trained community', async () => {
    vi.spyOn(matrixService, 'fetchCohortCoefficients').mockResolvedValue([
      { rung: 'community', rows: COMMUNITY_ROWS },
      { rung: 'fsa', rows: FSA_ROWS },
    ]);
    vi.spyOn(auditService, 'fetchCohortAudit').mockResolvedValue([
      { rung: 'community', r2: 0.31, basePrice: 900_000, n: 45 }, // a weak community still ROUTES as trained
      { rung: 'fsa', r2: 0.66, basePrice: 793_625, n: 219 },
    ]);
    const sibling = vi.spyOn(siblingModel, 'fetchSiblingModel');

    const m = await resolveModel(stubClient, { ...KITCHENER, cityRegion: 'Brampton West', city: 'Brampton' });
    expect(m).toEqual({
      nativeCoefficients: COMMUNITY_ROWS,
      effectiveCoefficients: COMMUNITY_ROWS,
      r2: 0.31,
      basePrice: 900_000,
      n: 45,
      borrowed: false,
      rung: 'community',
    });
    expect(sibling).not.toHaveBeenCalled();
    expect(marketDataOf(m).coarseCoefficients).toBeUndefined();
  });

  it('with no model on any rung and no sibling, keeps the community audit and nothing else', async () => {
    vi.spyOn(matrixService, 'fetchCohortCoefficients').mockResolvedValue([]);
    vi.spyOn(auditService, 'fetchCohortAudit').mockResolvedValue([
      { rung: 'community', r2: 0.2, basePrice: 650_000, n: 12 },
      { rung: 'city', r2: 0.6, basePrice: 700_000, n: 500 },
    ]);
    vi.spyOn(siblingModel, 'fetchSiblingModel').mockResolvedValue(null);

    const m = await resolveModel(stubClient, { ...KITCHENER, cityRegion: 'Aurora Estates', city: 'Aurora' });
    expect(m.rung).toBeNull();
    expect(m.effectiveCoefficients).toEqual([]);
    expect(m.basePrice).toBe(650_000);
    expect(m.r2).toBe(0.2);
  });
});

describe('marketDataOf', () => {
  it('exposes a coarse rung as coarseCoefficients and keeps routing coefficients empty', () => {
    const md = marketDataOf({
      nativeCoefficients: [],
      effectiveCoefficients: FSA_ROWS,
      r2: 0.66,
      basePrice: 793_625,
      n: 219,
      borrowed: false,
      rung: 'fsa',
    });
    expect(md.coefficients).toEqual([]);
    expect(md.coarseCoefficients).toBe(FSA_ROWS);
    expect(md.r2).toBe(0.66);
  });

  it('never exposes a borrowed sibling as coarse', () => {
    const md = marketDataOf({
      nativeCoefficients: [],
      effectiveCoefficients: FSA_ROWS,
      r2: 0.7,
      basePrice: null,
      n: 80,
      borrowed: true,
      rung: null,
    });
    expect(md.coarseCoefficients).toBeUndefined();
  });
});

// ── The pure estimate with coarse coefficients ────────────────────────────────

const anchorOf = (over: Partial<AnchorResult> = {}): AnchorResult => ({
  anchorLevel: Math.log(800_000),
  predSD: 0.09, // tight enough for HIGH on its own
  nEff: 40,
  comps: 60,
  basis: 'local',
  ...over,
});

/** ±1 bath around the mean → Σβz = 0.06 × 1.25 ≈ 0.075 (typical, well under the peer trigger). */
const TYPICAL: AVMInput = { ...KITCHENER, bathroomsTotalInteger: 3.8, bedroomsAboveGrade: 3.3 };
/** +4 baths → z clamps at +3 → Σβz = 0.06 × 3 + 0.02 × 3 = 0.24; push beds too → saturating. */
const OUTLIER: AVMInput = { ...KITCHENER, bathroomsTotalInteger: 9, bedroomsAboveGrade: 8 };
const BIG_BETAS = [row('bathrooms_total_integer', 0.2, 2.8, 0.8), row('bedrooms_above_grade', 0.15, 3.3, 0.6)];

describe('estimateFromMarketData — coarse coefficients', () => {
  it('adjusts the subject on the normal path with the coarse model, engine on, never HIGH', () => {
    const r = estimateFromMarketData(TYPICAL, {
      anchor: anchorOf(),
      r2: 0.66,
      basePrice: null,
      coefficients: [],
      coarseCoefficients: FSA_ROWS,
      n: 219,
    });
    expect(r.engineMode).toBe(ENGINE_MODE_COEFFICIENT_ADJUSTED);
    expect(r.totalAdjustmentPct).toBeGreaterThan(0);
    expect(r.estimatedValue).toBeGreaterThan(r.anchorPrice);
    expect(r.confidence).toBe(CONFIDENCE_MEDIUM); // band says HIGH; a coarse rung is capped
  });

  it('stays anchor-only, still capped, when the coarse r2 is under the engine gate', () => {
    const r = estimateFromMarketData(TYPICAL, {
      anchor: anchorOf(),
      r2: 0.4,
      basePrice: null,
      coefficients: [],
      coarseCoefficients: FSA_ROWS,
      n: 219,
    });
    expect(r.engineMode).toBe(ENGINE_MODE_ANCHOR_ONLY);
    expect(r.totalAdjustmentPct).toBe(0);
    expect(r.confidence).toBe(CONFIDENCE_MEDIUM);
  });

  it('is unchanged when no coarse coefficients are supplied (the untrained path of today)', () => {
    const market = { anchor: anchorOf(), r2: 0.66, basePrice: null, coefficients: [], n: 219 };
    const before = estimateFromMarketData(TYPICAL, market);
    const after = estimateFromMarketData(TYPICAL, { ...market, coarseCoefficients: undefined });
    expect(after).toEqual(before);
    expect(before.engineMode).toBe(ENGINE_MODE_ANCHOR_ONLY);
    expect(before.confidence).toBe(CONFIDENCE_HIGH); // today's untrained normal path is not capped
  });

  it('PUBLISHES on the floor branch — the #452 suppression must not come back', () => {
    // peer === null: too few peers anywhere. A trained cohort is suppressed here; a coarse
    // one routes as untrained and keeps its number with a capped tier.
    const r = estimateFromMarketData(TYPICAL, {
      anchor: anchorOf(),
      r2: 0.66,
      basePrice: null,
      coefficients: [],
      coarseCoefficients: FSA_ROWS,
      n: 219,
      peer: null,
    });
    expect(r.estimatedValue).toBeGreaterThan(0);
    expect(r.basis).toBe('local'); // not relabelled: a typical home, just thin peers
    expect(r.confidence).toBe(CONFIDENCE_MEDIUM);
    expect(r.engineMode).toBe(ENGINE_MODE_COEFFICIENT_ADJUSTED); // and it still gets its adjustment
  });

  it('labels a coarse-model OUTLIER with too few peers as a floor at LOW, still published', () => {
    const r = estimateFromMarketData(OUTLIER, {
      anchor: anchorOf(),
      r2: 0.66,
      basePrice: null,
      coefficients: [],
      coarseCoefficients: BIG_BETAS,
      n: 219,
      peer: null,
    });
    expect(r.estimatedValue).toBeGreaterThan(0);
    expect(r.basis).toBe('floor');
    expect(r.confidence).toBe(CONFIDENCE_LOW);
  });

  it('leaves the same outlier at the untrained cap when there is NO coarse model to judge it', () => {
    const r = estimateFromMarketData(OUTLIER, {
      anchor: anchorOf(),
      r2: null,
      basePrice: null,
      coefficients: [],
      n: null,
      peer: null,
    });
    expect(r.basis).toBe('local');
    expect(r.confidence).toBe(CONFIDENCE_MEDIUM);
  });

  it('prices off the peer grid, capped, exactly as an untrained cohort does', () => {
    const peer = anchorOf({ anchorLevel: Math.log(950_000), predSD: 0.05, nEff: 12, basis: 'peer' });
    const r = estimateFromMarketData(OUTLIER, {
      anchor: anchorOf(),
      r2: 0.66,
      basePrice: null,
      coefficients: [],
      coarseCoefficients: BIG_BETAS,
      n: 219,
      peer,
    });
    expect(r.estimatedValue).toBe(950_000);
    expect(r.basis).toBe('peer');
    expect(r.confidence).toBe(CONFIDENCE_MEDIUM);
  });
});
