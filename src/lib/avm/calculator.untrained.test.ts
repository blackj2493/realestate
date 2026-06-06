import { describe, it, expect } from "vitest";
import { shouldEvaluatePeers } from "./calculator";
import type { AVMInput } from "./types";

const subject = (over: Partial<AVMInput> = {}): AVMInput => ({
  cityRegion: "Aurora Estates", city: "Aurora", propertySubType: "Detached",
  rawPropertySubType: "Detached", buildingAreaTotal: 2226, lotWidth: 30, lotDepth: 132,
  bedroomsAboveGrade: 4, bathroomsTotalInteger: 3, parkingTotal: 2,
  interiorTier: 3, exteriorTier: 3, basementTier: 5, ...over,
});

describe("shouldEvaluatePeers", () => {
  it("always evaluates peers for untrained cohorts (no coefficients)", () => {
    expect(shouldEvaluatePeers(subject(), [])).toBe(true); // the Aurora case — under all old thresholds
  });
  it("leaves trained cohorts gated on the Σβz outlier signal", () => {
    const coeffs = [{ featureName: "bedrooms_above_grade", beta: 0.05, mean: 4, std: 1 }];
    // a typical trained home (z≈0) is NOT an outlier → no peer pull
    expect(shouldEvaluatePeers(subject(), coeffs)).toBe(false);
  });
});
