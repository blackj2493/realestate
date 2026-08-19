import { it, expect } from "vitest";
import { similarityWeight, type CompRow } from "./anchorService";
import type { AVMInput } from "./types";

const S: AVMInput = {
  cityRegion: "Aurora Estates", city: "Aurora", propertySubType: "Detached",
  rawPropertySubType: "Detached", buildingAreaTotal: 2250, lotWidth: 30, lotDepth: 132,
  bedroomsAboveGrade: 4, bedroomsBelowGrade: 0, bathroomsTotalInteger: 4, parkingTotal: 2,
  interiorTier: 3, exteriorTier: 3, basementTier: 5,
};
const comp = (sqft: number | null): CompRow => ({
  close_price: 1, purchase_contract_date: "2026-01-01", close_date: null,
  building_area_total: sqft, lot_width: 30, lot_depth: 132,
  bedrooms_above_grade: 4, bedrooms_below_grade: 0, bathrooms_total_integer: 4, parking_total: 2,
  interior_tier: 3, exterior_tier: 3, basement_tier: 5,
});

it("weights a same-size comp above a much larger one", () => {
  expect(similarityWeight(S, comp(2250))).toBeGreaterThan(similarityWeight(S, comp(4250)));
});
it("ignores sqft when the comp lacks it (neutral, no penalty)", () => {
  // Missing sqft must equal the pre-sqft weight for an otherwise-identical comp.
  // Both subject and comp at exactly the same sqft → ratio = 1 → log = 0 → factor 1.
  // Missing comp sqft also contributes factor 1 (same as perfect match).
  expect(similarityWeight(S, comp(null))).toBeCloseTo(similarityWeight(S, comp(2250)), 5);
});
