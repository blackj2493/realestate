import { describe, it, expect } from "vitest";
import { clusterRadiusForZoom } from "./mapLogic";
describe("clusterRadiusForZoom", () => {
  it("is tighter when zoomed out (don't blob a city), looser when zoomed in", () => {
    expect(clusterRadiusForZoom(11)).toBeLessThan(64);
    expect(clusterRadiusForZoom(11)).toBeLessThanOrEqual(clusterRadiusForZoom(16));
  });
});
