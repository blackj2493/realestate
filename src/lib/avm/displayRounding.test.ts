import { describe, it, expect } from "vitest";
import { roundToStep, ESTIMATE_DISPLAY_STEP, OFFER_BAND_DISPLAY_STEP } from "./displayRounding";

describe("roundToStep", () => {
  it("rounds to the nearest step ($1,000 estimate figures)", () => {
    expect(roundToStep(1_932_977, ESTIMATE_DISPLAY_STEP)).toBe(1_933_000);
    expect(roundToStep(1_934_869, ESTIMATE_DISPLAY_STEP)).toBe(1_935_000);
    expect(roundToStep(116_023, ESTIMATE_DISPLAY_STEP)).toBe(116_000);
    expect(roundToStep(116_500, ESTIMATE_DISPLAY_STEP)).toBe(117_000); // half rounds up
  });

  it("collapses a sub-step divergence to one displayed figure", () => {
    // The bug: two surfaces computed $1,932,977 vs $1,934,869 for the same estimate. On a
    // $1,000 step they differ by one increment; but the delta figures the ticket flagged
    // (e.g. two ask-deltas a few hundred dollars apart) collapse to the same rendered value.
    expect(roundToStep(116_023, ESTIMATE_DISPLAY_STEP)).toBe(roundToStep(115_800, ESTIMATE_DISPLAY_STEP));
  });

  it("rounds the suggested-offer band to the coarser $5,000", () => {
    expect(roundToStep(1_836_328, OFFER_BAND_DISPLAY_STEP)).toBe(1_835_000);
    expect(roundToStep(1_932_977, OFFER_BAND_DISPLAY_STEP)).toBe(1_935_000);
    expect(OFFER_BAND_DISPLAY_STEP).toBeGreaterThan(ESTIMATE_DISPLAY_STEP);
  });

  it("is a no-op on already-round values and never fabricates precision", () => {
    expect(roundToStep(2_000_000, ESTIMATE_DISPLAY_STEP)).toBe(2_000_000);
    expect(roundToStep(2_000_000, OFFER_BAND_DISPLAY_STEP)).toBe(2_000_000);
  });

  it("degrades safely on a non-positive step or non-finite input", () => {
    expect(roundToStep(1_932_977, 0)).toBe(1_932_977);
    expect(roundToStep(1_932_977.4, -5)).toBe(1_932_977);
    expect(Number.isNaN(roundToStep(NaN, ESTIMATE_DISPLAY_STEP))).toBe(true);
  });
});
