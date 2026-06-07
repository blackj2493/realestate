import { describe, it, expect } from "vitest";
import { clusterRadiusForZoom, hasMetricValue, scatterColorFor, NO_DATA_COLOR } from "./mapLogic";
describe("clusterRadiusForZoom", () => {
  it("is tighter when zoomed out (don't blob a city), looser when zoomed in", () => {
    expect(clusterRadiusForZoom(11)).toBeLessThan(64);
    expect(clusterRadiusForZoom(11)).toBeLessThanOrEqual(clusterRadiusForZoom(16));
  });
});

const RANGE: [number, number, number][] = [
  [13, 42, 33], [6, 78, 59], [4, 120, 87], [16, 185, 129], [52, 211, 153], [134, 239, 172],
];

describe("hasMetricValue", () => {
  it("non-sparse: any finite value counts (0 is legitimate)", () => {
    expect(hasMetricValue(0, false)).toBe(true);
    expect(hasMetricValue(5, false)).toBe(true);
    expect(hasMetricValue(0, undefined)).toBe(true);
  });
  it("sparse: only positive finite values count (0/NaN = no estimate)", () => {
    expect(hasMetricValue(5, true)).toBe(true);
    expect(hasMetricValue(0, true)).toBe(false);
    expect(hasMetricValue(NaN, true)).toBe(false);
    expect(hasMetricValue(-2, true)).toBe(false);
  });
});

describe("scatterColorFor", () => {
  it("sparse no-estimate → NO_DATA_COLOR (not the low band)", () => {
    expect(scatterColorFor(0, [0, 10], RANGE, true)).toBe(NO_DATA_COLOR);
  });
  it("sparse with a real value → ramp color", () => {
    expect(scatterColorFor(6, [0, 10], RANGE, true)).toBe(RANGE[3]); // colorIndexFor(6,[0,10],6)=3
  });
  it("non-sparse value 0 → ramp low band (unchanged behavior)", () => {
    expect(scatterColorFor(0, [0, 10], RANGE, false)).toBe(RANGE[0]);
  });
});
