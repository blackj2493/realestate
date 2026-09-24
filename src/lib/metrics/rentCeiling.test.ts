import { describe, it, expect } from "vitest";
import {
  livingAreaMidpoint,
  rentCeilingForSize,
  rentImplausibleForSize,
  RENT_CEILING_BY_SIZE,
} from "./sanityBand";

describe("livingAreaMidpoint", () => {
  it("reads a TRREB band string", () => {
    expect(livingAreaMidpoint("600-699")).toBe(649.5);
    expect(livingAreaMidpoint("1400-1599")).toBe(1499.5);
    expect(livingAreaMidpoint("0-499")).toBe(249.5);
  });
  it("passes a bare midpoint through — raw_vow_sold already stores one", () => {
    expect(livingAreaMidpoint(650)).toBe(650);
    expect(livingAreaMidpoint("650")).toBe(650);
  });
  it("returns null on junk", () => {
    expect(livingAreaMidpoint(null)).toBeNull();
    expect(livingAreaMidpoint(undefined)).toBeNull();
    expect(livingAreaMidpoint("")).toBeNull();
    expect(livingAreaMidpoint(0)).toBeNull();
    expect(livingAreaMidpoint("unknown")).toBeNull();
  });
});

describe("rentImplausibleForSize", () => {
  it("rejects the rent that prompted this — 130 River St #1508", () => {
    // 650 sqft unit handed a cohort of 1,900 sqft penthouses. Two units in the same
    // building, same size, leased that month for $2,900 and $3,000.
    expect(rentImplausibleForSize(5_200, "600-699")).toBe(true);
    // The rung below it returned $2,600, which must survive.
    expect(rentImplausibleForSize(2_600, "600-699")).toBe(false);
    expect(rentImplausibleForSize(3_000, "600-699")).toBe(false);
  });

  it("does NOT punish a small unit for a high rent per square foot", () => {
    // The guard a flat $/sqft rule would have got wrong: 8.3% of real leases clear
    // $5/sqft, and a 250 sqft studio at $2,100 ($8.40/sqft) is an ordinary listing.
    expect(rentImplausibleForSize(2_100, "0-499")).toBe(false);
    expect(rentImplausibleForSize(2_800, "0-499")).toBe(false);
  });

  it("lets a genuinely large home carry a genuinely large rent", () => {
    expect(rentImplausibleForSize(15_000, 1_900)).toBe(false);
    expect(rentImplausibleForSize(18_000, 2_375)).toBe(false);
  });

  it("never gates on unknown size or unknown rent", () => {
    // Absence of evidence is not evidence — a missing size must not blank a rent.
    expect(rentImplausibleForSize(99_000, null)).toBe(false);
    expect(rentImplausibleForSize(99_000, undefined)).toBe(false);
    expect(rentImplausibleForSize(null, "600-699")).toBe(false);
    expect(rentImplausibleForSize(undefined, "600-699")).toBe(false);
  });

  it("has no ceiling above the largest band, rather than a wrong one", () => {
    expect(rentCeilingForSize(9_999)).toBeNull();
    expect(rentImplausibleForSize(40_000, 9_999)).toBe(false);
  });

  it("keeps the table ascending in size, so lookup is well defined", () => {
    for (let i = 1; i < RENT_CEILING_BY_SIZE.length; i++) {
      expect(RENT_CEILING_BY_SIZE[i].sqft).toBeGreaterThan(RENT_CEILING_BY_SIZE[i - 1].sqft);
      expect(RENT_CEILING_BY_SIZE[i].max).toBeGreaterThan(0);
    }
  });

  it("picks the first band at or above the size", () => {
    expect(rentCeilingForSize("600-699")).toBe(3_400); // 649.5 -> the 650 band
    expect(rentCeilingForSize(650)).toBe(3_400);
    expect(rentCeilingForSize(651)).toBe(4_750); // just over -> next band up
  });
});
