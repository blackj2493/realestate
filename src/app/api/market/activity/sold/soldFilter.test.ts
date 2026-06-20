import { describe, it, expect } from "vitest";
import { buildSoldFilter, type SoldParams } from "./soldFilter";

const base: SoldParams = {
  area: { kind: "region", region: "Mississauga" },
  windowDays: 90,
  typeKeys: [],
  minPrice: 0,
  maxPrice: 0,
  minBeds: 0,
  bedsExact: false,
  minBaths: 0,
  bathsExact: false,
  minGarage: 0,
  garageExact: false,
  basement: "any",
  minFrontage: 0,
  limit: 100,
  dealType: "sold",
};

describe("buildSoldFilter — dealType branches", () => {
  it("sold keeps the exact DealType + price floor", () => {
    const f = buildSoldFilter(base);
    expect(f).toContain("DealType:=sold");
    expect(f).toContain("ClosePrice:>=1");
  });

  it("delisted expands to the three reasons, drops the price floor, and pins For Sale", () => {
    const f = buildSoldFilter({ ...base, dealType: "delisted" });
    expect(f).toContain("DealType:=[terminated,expired,suspended]");
    expect(f).not.toContain("ClosePrice:>=1");
    expect(f).toContain("TransactionType:=`For Sale`");
  });

  it("delisted keeps the window + area clauses", () => {
    const f = buildSoldFilter({ ...base, dealType: "delisted" });
    expect(f).toContain("PurchaseContractDate:>=");
    expect(f).toContain("City:=`Mississauga`");
  });
});

describe("buildSoldFilter — price band", () => {
  it("omits price clauses when both bounds are 0 (full range)", () => {
    const f = buildSoldFilter(base);
    expect(f).not.toContain("ClosePrice:>=5");
    expect(f).not.toContain("ClosePrice:<=");
  });

  it("Sold/Leased filter the achieved ClosePrice", () => {
    const f = buildSoldFilter({ ...base, minPrice: 500_000, maxPrice: 800_000 });
    expect(f).toContain("ClosePrice:>=500000");
    expect(f).toContain("ClosePrice:<=800000");
  });

  it("De-listed filters the final ask (ListPrice), not ClosePrice", () => {
    const f = buildSoldFilter({ ...base, dealType: "delisted", minPrice: 500_000, maxPrice: 800_000 });
    expect(f).toContain("ListPrice:>=500000");
    expect(f).toContain("ListPrice:<=800000");
    expect(f).not.toContain("ClosePrice");
  });

  it("applies a one-sided floor when only minPrice is set", () => {
    const f = buildSoldFilter({ ...base, minPrice: 600_000 });
    expect(f).toContain("ClosePrice:>=600000");
    expect(f).not.toMatch(/ClosePrice:<=/);
  });
});

describe("buildSoldFilter — beds (grade-aware, matches For Sale)", () => {
  it("filters on ABOVE-grade beds with a total fallback, not the inflated total", () => {
    const f = buildSoldFilter({ ...base, minBeds: 3 });
    // Mirrors aboveGradeBedsClause so a 1+4 (1 above) home is excluded from "3 bd".
    expect(f).toContain("(BedroomsAboveGrade:>=3 || (BedroomsAboveGrade:=0 && BedroomsTotal:>=3))");
    expect(f).not.toContain("BedroomsTotal:>=3 &&"); // no bare total-only clause
  });

  it("omits the beds clause entirely when minBeds is 0", () => {
    expect(buildSoldFilter(base)).not.toContain("BedroomsAboveGrade");
  });

  it("applies the grade-aware beds clause on de-listed too (backfilled above-grade)", () => {
    const f = buildSoldFilter({ ...base, dealType: "delisted", minBeds: 2 });
    expect(f).toContain("(BedroomsAboveGrade:>=2 || (BedroomsAboveGrade:=0 && BedroomsTotal:>=2))");
  });

  it("uses the EXACT bed clause when bedsExact is set", () => {
    const f = buildSoldFilter({ ...base, minBeds: 5, bedsExact: true });
    expect(f).toContain("(BedroomsAboveGrade:=5 || (BedroomsAboveGrade:=0 && BedroomsTotal:=5))");
  });

  it("baths follow the same min/exact toggle", () => {
    expect(buildSoldFilter({ ...base, minBaths: 2 })).toContain("BathroomsTotalInteger:>=2");
    expect(buildSoldFilter({ ...base, minBaths: 2, bathsExact: true })).toContain("BathroomsTotalInteger:=2");
  });

  it("parking follows the same min/exact toggle", () => {
    expect(buildSoldFilter({ ...base, minGarage: 2 })).toContain("ParkingTotal:>=2");
    expect(buildSoldFilter({ ...base, minGarage: 2, garageExact: true })).toContain("ParkingTotal:=2");
  });
});

describe("buildSoldFilter — basement tier bands", () => {
  it("omits any basement clause when set to 'any'", () => {
    expect(buildSoldFilter(base)).not.toContain("BasementTier");
  });

  it("finished maps to tiers 1-5", () => {
    expect(buildSoldFilter({ ...base, basement: "finished" })).toContain("BasementTier:<=5");
  });

  it("unfinished maps to the 6-8 band (excludes no-basement tier 9)", () => {
    const f = buildSoldFilter({ ...base, basement: "unfinished" });
    expect(f).toContain("(BasementTier:>=6 && BasementTier:<=8)");
    expect(f).not.toContain("BasementTier:<=5");
  });
});
