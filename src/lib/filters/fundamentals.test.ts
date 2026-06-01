import { describe, it, expect } from "vitest";
import {
  buildTransactionClause,
  buildClassClause,
  priceFloorClause,
  isInvestorLayerActive,
  priceConfig,
  RESIDENTIAL_TYPE_OPTIONS,
  COMMERCIAL_TYPE_OPTIONS,
  typeOptionsForClass,
} from "./fundamentals";
import { makePriceDef } from "./filterRegistry";

describe("fundamentals — transaction clause", () => {
  it("backtick-quotes the sale value (space inside)", () => {
    expect(buildTransactionClause("sale")).toBe("TransactionType:=`For Sale`");
  });
  it("backtick-quotes the rent value", () => {
    expect(buildTransactionClause("rent")).toBe("TransactionType:=`For Lease`");
  });
});

describe("fundamentals — class clause", () => {
  // Live PropertyType facet = {Residential Freehold, Residential Condo & Other,
  // Commercial, Residential}. Residential = "not Commercial" so it stays correct
  // no matter which residential spelling a doc carries (drift-proof).
  it("commercial matches the single Commercial PropertyType value", () => {
    expect(buildClassClause("commercial")).toBe("PropertyType:=Commercial");
  });
  it("residential is the negation of Commercial", () => {
    expect(buildClassClause("residential")).toBe("PropertyType:!=Commercial");
  });
});

describe("fundamentals — price floor", () => {
  it("keeps the $100k junk floor for sales", () => {
    expect(priceFloorClause("sale")).toBe("ListPrice:>=100000");
  });
  it("drops to $1 for rentals (ListPrice is monthly rent)", () => {
    expect(priceFloorClause("rent")).toBe("ListPrice:>=1");
  });
});

describe("fundamentals — investor layer gate", () => {
  it("is active only for residential sales", () => {
    expect(isInvestorLayerActive("sale", "residential")).toBe(true);
    expect(isInvestorLayerActive("rent", "residential")).toBe(false);
    expect(isInvestorLayerActive("sale", "commercial")).toBe(false);
    expect(isInvestorLayerActive("rent", "commercial")).toBe(false);
  });
});

describe("fundamentals — transaction-aware price", () => {
  it("uses sale bounds 0–3M / $25k", () => {
    expect(priceConfig("sale")).toEqual({ min: 0, max: 3_000_000, step: 25_000 });
  });
  it("uses rent bounds 0–$12k / $100 (ListPrice is monthly rent)", () => {
    expect(priceConfig("rent")).toEqual({ min: 0, max: 12_000, step: 100 });
  });
  it("rent price def emits real rent bounds and is null at default", () => {
    const rent = makePriceDef(priceConfig("rent"));
    expect(rent.buildClause([1800, 3500])).toBe("ListPrice:>=1800 && ListPrice:<=3500");
    expect(rent.buildClause([0, 12_000])).toBeNull();
    expect(rent.chipLabel([1800, 3500])).toBe("$1,800–$3,500"); // not "$2k–$4k"
  });
});

describe("fundamentals — scoped type options", () => {
  it("residential carries the exact trailing-space Semi-Detached spelling", () => {
    expect(RESIDENTIAL_TYPE_OPTIONS.map((o) => o.value)).toContain("Semi-Detached ");
  });
  it("commercial uses the live spelling 'Commercial Retail' (space, not slash)", () => {
    expect(COMMERCIAL_TYPE_OPTIONS.map((o) => o.value)).toContain("Commercial Retail");
  });
  it("typeOptionsForClass switches the set by class", () => {
    expect(typeOptionsForClass("commercial")).toBe(COMMERCIAL_TYPE_OPTIONS);
    expect(typeOptionsForClass("residential")).toBe(RESIDENTIAL_TYPE_OPTIONS);
  });
});
