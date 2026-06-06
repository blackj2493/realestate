import { describe, it, expect } from "vitest";
import { estimateFromMarketData } from "./calculator";
import type { AVMInput } from "./types";

const AURORA: AVMInput = {
  cityRegion: "Aurora Estates", city: "Aurora", propertySubType: "Detached",
  rawPropertySubType: "Detached", buildingAreaTotal: 2226, lotWidth: 30.18, lotDepth: 132.87,
  bedroomsAboveGrade: 4, bathroomsTotalInteger: 3, parkingTotal: 2,
  interiorTier: 3, exteriorTier: 3, basementTier: 5,
};

it("prices the Aurora subject below the blind cohort mean, not HIGH", () => {
  // A matched/borrowed anchor centered near the same-size comps (~$1.4M), borrowed basis.
  const anchor = { anchorLevel: Math.log(1_420_000), predSD: 0.07, nEff: 9, comps: 13, basis: "borrowed" as const };
  const r = estimateFromMarketData(AURORA, { anchor, r2: 0.6, basePrice: null, coefficients: [], n: 180, peer: anchor });
  expect(r.estimatedValue).toBeLessThan(1_650_000); // well under the $1.73M blind-average miss
  expect(r.confidence).not.toBe("HIGH");
  expect(r.basis).toBe("borrowed");
});
