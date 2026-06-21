import { describe, it, expect } from "vitest";
import { buildRentalSnapshot } from "./rentalSnapshot";

/**
 * The Rental Snapshot replaces the buy-and-hold Underwriting Sandbox on lease
 * listings, where ListPrice is the monthly rent (the bug: a $2,700 rent became a
 * $2,700 "purchase" → 516% cap rate). These tests pin the lease economics and the
 * "never fabricate a denominator" rule for rent-$/sqft.
 */
describe("buildRentalSnapshot", () => {
  it("annualizes the monthly rent", () => {
    const s = buildRentalSnapshot({ monthlyRent: 2700 });
    expect(s.monthlyRent).toBe(2700);
    expect(s.annualRent).toBe(32400);
  });

  it("computes exact rent/sqft from a concrete BuildingAreaTotal", () => {
    const s = buildRentalSnapshot({ monthlyRent: 2700, buildingAreaTotal: 900 });
    expect(s.rentPerSqft).toEqual({ kind: "exact", low: 3, high: 3 });
  });

  it("computes a rent/sqft RANGE from a banded LivingAreaRange (smaller area → higher rate)", () => {
    const s = buildRentalSnapshot({ monthlyRent: 2700, livingAreaRange: "700-899" });
    // high uses the smaller area (700), low uses the larger (899)
    expect(s.rentPerSqft).toEqual({ kind: "range", low: 3, high: 3.86 });
  });

  it("prefers the concrete area over the banded range when both exist", () => {
    const s = buildRentalSnapshot({
      monthlyRent: 2700,
      buildingAreaTotal: 900,
      livingAreaRange: "700-899",
    });
    expect(s.rentPerSqft).toEqual({ kind: "exact", low: 3, high: 3 });
  });

  it("treats a degenerate band like '0-499' as a single positive bound (no divide-by-zero)", () => {
    const s = buildRentalSnapshot({ monthlyRent: 2700, livingAreaRange: "0-499" });
    expect(s.rentPerSqft).toEqual({ kind: "exact", low: 5.41, high: 5.41 });
  });

  it("strips commas from area strings", () => {
    const s = buildRentalSnapshot({ monthlyRent: 3000, livingAreaRange: "1,200" });
    expect(s.rentPerSqft).toEqual({ kind: "exact", low: 2.5, high: 2.5 });
  });

  it("omits rent/sqft (never guesses) when no area is known", () => {
    expect(buildRentalSnapshot({ monthlyRent: 2700 }).rentPerSqft).toBeNull();
    expect(buildRentalSnapshot({ monthlyRent: 2700, livingAreaRange: "" }).rentPerSqft).toBeNull();
    expect(buildRentalSnapshot({ monthlyRent: 2700, livingAreaRange: "N/A" }).rentPerSqft).toBeNull();
  });

  it("omits rent/sqft when rent is non-positive", () => {
    expect(buildRentalSnapshot({ monthlyRent: 0, buildingAreaTotal: 900 }).rentPerSqft).toBeNull();
  });

  it("normalizes lease term and included-in-rent, and passes through deposit", () => {
    const s = buildRentalSnapshot({
      monthlyRent: 2700,
      leaseTerm: "  12 Months  ",
      depositRequired: true,
      rentIncludes: ["Building Insurance", "  ", "Parking"],
    });
    expect(s.leaseTerm).toBe("12 Months");
    expect(s.depositRequired).toBe(true);
    expect(s.rentIncludes).toEqual(["Building Insurance", "Parking"]);
  });

  it("guards against non-finite or missing fields", () => {
    const s = buildRentalSnapshot({ monthlyRent: Number.NaN, leaseTerm: "   " });
    expect(s.monthlyRent).toBe(0);
    expect(s.annualRent).toBe(0);
    expect(s.leaseTerm).toBeNull();
    expect(s.depositRequired).toBeNull();
    expect(s.rentIncludes).toEqual([]);
  });
});
