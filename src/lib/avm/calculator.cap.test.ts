import { it, expect } from "vitest";
import { estimateFromMarketData } from "./calculator";
import type { AVMInput } from "./types";

const SUBJECT: AVMInput = {
  cityRegion: "Aurora Estates", city: "Aurora", propertySubType: "Detached",
  rawPropertySubType: "Detached", buildingAreaTotal: 2226, lotWidth: 30, lotDepth: 132,
  bedroomsAboveGrade: 4, bedroomsBelowGrade: 0, bathroomsTotalInteger: 3, parkingTotal: 2,
  interiorTier: 3, exteriorTier: 3, basementTier: 5,
};

it("never labels a borrowed-basis estimate HIGH, even with a tight band", () => {
  const tightAnchor = { anchorLevel: Math.log(1_400_000), predSD: 0.05, nEff: 12, comps: 12, basis: "borrowed" as const };
  const result = estimateFromMarketData(SUBJECT, {
    anchor: tightAnchor, r2: null, basePrice: null, coefficients: [], n: 30, peer: tightAnchor,
  });
  expect(result.basis).toBe("borrowed");
  expect(result.confidence).not.toBe("HIGH");
});
