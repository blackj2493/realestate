import { describe, it, expect } from "vitest";
import { isIncomeProperty } from "./computeUnderwriting";

/**
 * Audit C2: the underwriting sandbox must not fabricate a rent (and therefore a
 * cap rate / gross yield / cashflow) on non-dwelling parcels. isIncomeProperty
 * gates the income display.
 */
describe("isIncomeProperty — C2 vacant-land gate", () => {
  it("returns false for non-income parcels", () => {
    for (const t of ["Vacant Land", "Land", "Raw Land", "Parking Space", "Locker"]) {
      expect(isIncomeProperty(t), t).toBe(false);
    }
  });

  it("returns true for rentable dwellings", () => {
    for (const t of [
      "Detached",
      "Semi-Detached",
      "Condo Apartment",
      "Att/Row/Townhouse",
      "Multiplex",
      "Duplex",
    ]) {
      expect(isIncomeProperty(t), t).toBe(true);
    }
  });

  it("does not false-match dwellings that merely contain the letters 'land'", () => {
    // word-boundary on \bland\b must not trip on Highland/Island in a community/style string
    expect(isIncomeProperty("Highland Estate Home")).toBe(true);
    expect(isIncomeProperty("Island Cottage")).toBe(true);
  });

  it("returns false for Commercial-class subtypes (commercial-gap Phase 0)", () => {
    // The residential rent seed is a fabrication on commercial assets — the sandbox
    // must show carry-cost only (fundamentals.ts COMMERCIAL_TYPE_OPTIONS spellings).
    for (const t of [
      "Commercial Retail",
      "Office",
      "Industrial",
      "Sale Of Business",
      "Investment",
      "Farm",
      "Store W Apt/Office",
    ]) {
      expect(isIncomeProperty(t), t).toBe(false);
    }
  });

  it("defaults to income-applicable when subtype is missing", () => {
    expect(isIncomeProperty(undefined)).toBe(true);
    expect(isIncomeProperty(null)).toBe(true);
    expect(isIncomeProperty("")).toBe(true);
  });
});
