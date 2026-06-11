import { describe, it, expect } from "vitest";
import { buildSoldFilter, type SoldParams } from "./soldFilter";

const base: SoldParams = {
  area: { kind: "region", region: "Mississauga" },
  windowDays: 90,
  typeKeys: [],
  minBeds: 0,
  minBaths: 0,
  minGarage: 0,
  basementFinished: false,
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
