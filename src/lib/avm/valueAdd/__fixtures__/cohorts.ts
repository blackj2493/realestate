// src/lib/avm/valueAdd/__fixtures__/cohorts.ts
import type { AVMMarketData } from '../../calculator';
import type { CoefficientRow } from '../../matrixService';
import type { AnchorResult } from '../../anchorService';
import type { AVMInput } from '../../types';

export function buildMarket(opts: {
  basePrice: number; r2: number; n: number;
  coefficients: CoefficientRow[]; predSD?: number;
}): AVMMarketData {
  const anchor: AnchorResult = {
    anchorLevel: Math.log(opts.basePrice),
    predSD: opts.predSD ?? 0.06,
    nEff: 40,
    comps: 50,
    basis: 'local',
  };
  return {
    anchor,
    r2: opts.r2,
    basePrice: opts.basePrice,
    coefficients: opts.coefficients,
    n: opts.n,
  };
}

export function subject(over: Partial<AVMInput>): AVMInput {
  return {
    cityRegion: 'Test', city: null, propertySubType: 'Detached', rawPropertySubType: 'Detached',
    buildingAreaTotal: null, lotWidth: null, lotDepth: null,
    bedroomsAboveGrade: null, bathroomsTotalInteger: null, parkingTotal: null,
    interiorTier: 3, exteriorTier: 3, basementTier: 5,
    ...over,
  };
}

// Real cohort coefficients (from the validation pass on scripts/worker/avm/data CSVs).
export const BRAMPTON_WEST_DETACHED = buildMarket({
  basePrice: 861351, r2: 0.7, n: 117,
  coefficients: [
    { featureName: 'building_area_total', beta: 0.044949, mean: 1560.5, std: 512.557 },
    { featureName: 'bathrooms_total_integer', beta: 0.039846, mean: 3.0256, std: 0.891187 },
    { featureName: 'bedrooms_above_grade', beta: 0.021938, mean: 3.1282, std: 0.722513 },
    { featureName: 'basement_score', beta: 0.020536, mean: 5.6239, std: 1.325145 },
  ],
});

export const ERIN_MILLS_CONDO = buildMarket({
  basePrice: 705579, r2: 0.91, n: 70,
  coefficients: [
    { featureName: 'building_area_total', beta: 0.234615, mean: 1168.84, std: 446.88 },
    { featureName: 'bathrooms_total_integer', beta: 0.077281, mean: 1.8571, std: 0.61611 },
    { featureName: 'bedrooms_above_grade', beta: -0.023497, mean: 1.7286, std: 0.475738 },
    { featureName: 'basement_score', beta: 0, mean: 1, std: 1 }, // placeholder stub
  ],
});

export const CHURCHILL_MEADOWS_TOWNHOUSE = buildMarket({
  basePrice: 801043, r2: 0.85, n: 172,
  coefficients: [
    { featureName: 'building_area_total', beta: 0.067605, mean: 1436.09, std: 485.507 },
    { featureName: 'bathrooms_total_integer', beta: 0.041009, mean: 3.0465, std: 0.861407 },
    { featureName: 'bedrooms_above_grade', beta: 0.076137, mean: 2.6395, std: 0.688996 },
    { featureName: 'basement_score', beta: 0.0207, mean: 3.5872, std: 2.284543 },
  ],
});
