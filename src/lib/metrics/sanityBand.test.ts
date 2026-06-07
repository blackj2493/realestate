import { describe, it, expect } from "vitest";
import {
  CAP_RATE_BAND, GROSS_YIELD_BAND,
  capRateOrNull, grossYieldOrNull, hasRentEstimate,
} from "./sanityBand";

describe("capRateOrNull", () => {
  it("passes in-band values", () => {
    expect(capRateOrNull(CAP_RATE_BAND.min)).toBe(CAP_RATE_BAND.min);
    expect(capRateOrNull(6.5)).toBe(6.5);
    expect(capRateOrNull(CAP_RATE_BAND.max)).toBe(CAP_RATE_BAND.max);
  });
  it("nulls out-of-band, zero, negative, and nullish", () => {
    expect(capRateOrNull(0)).toBeNull();
    expect(capRateOrNull(0.9)).toBeNull();
    expect(capRateOrNull(15.1)).toBeNull();
    expect(capRateOrNull(-3)).toBeNull(); // opex>rent: real but not displayable
    expect(capRateOrNull(null)).toBeNull();
    expect(capRateOrNull(undefined)).toBeNull();
  });
});

describe("grossYieldOrNull", () => {
  it("passes in-band, nulls outside [1.5,18]", () => {
    expect(grossYieldOrNull(GROSS_YIELD_BAND.min)).toBe(GROSS_YIELD_BAND.min);
    expect(grossYieldOrNull(5.2)).toBe(5.2);
    expect(grossYieldOrNull(GROSS_YIELD_BAND.max)).toBe(GROSS_YIELD_BAND.max);
    expect(grossYieldOrNull(1.49)).toBeNull();
    expect(grossYieldOrNull(18.1)).toBeNull();
    expect(grossYieldOrNull(0)).toBeNull();
  });
  it("nulls zero, negative, and nullish", () => {
    expect(grossYieldOrNull(0)).toBeNull();
    expect(grossYieldOrNull(-3)).toBeNull();
    expect(grossYieldOrNull(null)).toBeNull();
    expect(grossYieldOrNull(undefined)).toBeNull();
  });
});

describe("hasRentEstimate", () => {
  it("true when either real field is > 0", () => {
    expect(hasRentEstimate({ cap_rate_est: 5 })).toBe(true);
    expect(hasRentEstimate({ gross_yield_est: 4 })).toBe(true);
    expect(hasRentEstimate({ cap_rate_est: 5, gross_yield_est: 0 })).toBe(true);
  });
  it("false when both absent/zero", () => {
    expect(hasRentEstimate({})).toBe(false);
    expect(hasRentEstimate({ cap_rate_est: 0, gross_yield_est: 0 })).toBe(false);
    expect(hasRentEstimate({ cap_rate_est: null })).toBe(false);
  });
});
