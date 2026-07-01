import { describe, it, expect } from "vitest";
import { buildTerminalCoreClauses } from "./terminalQuery";
import { makeDefaultUniversalFilters } from "./filterRegistry";
import { defaultTerminalFilters } from "@/lib/personas/personaConfig";

describe("buildTerminalCoreClauses", () => {
  it("residential sale defaults → floor + sale + not-commercial", () => {
    const clauses = buildTerminalCoreClauses({
      transactionMode: "sale",
      propertyClass: "residential",
      universalFilters: makeDefaultUniversalFilters(),
      filters: defaultTerminalFilters,
    });
    expect(clauses).toEqual([
      "ListPrice:>=100000",
      "TransactionType:=`For Sale`",
      "PropertyType:!=Commercial",
    ]);
  });

  it("applies a set investor signal in residential-sale, persona-independent", () => {
    const clauses = buildTerminalCoreClauses({
      transactionMode: "sale",
      propertyClass: "residential",
      universalFilters: makeDefaultUniversalFilters(),
      filters: { ...defaultTerminalFilters, minPriceDrop: 50000 },
    });
    expect(clauses.some((c) => c.includes("TotalPriceDrop:>=50000"))).toBe(true);
  });

  it("commercial+rent turns the investor layer off → investor clause omitted", () => {
    const clauses = buildTerminalCoreClauses({
      transactionMode: "rent",
      propertyClass: "commercial",
      universalFilters: makeDefaultUniversalFilters(),
      filters: { ...defaultTerminalFilters, minCapRate: 5 },
    });
    expect(clauses).toEqual([
      "ListPrice:>=1",
      "TransactionType:=`For Lease`",
      "PropertyType:=Commercial",
    ]);
    expect(clauses.some((c) => c.includes("cap_rate_est"))).toBe(false);
  });

  it("excludePersona drops the investor clause (investor-chip histogram base)", () => {
    const clauses = buildTerminalCoreClauses({
      transactionMode: "sale",
      propertyClass: "residential",
      universalFilters: makeDefaultUniversalFilters(),
      filters: { ...defaultTerminalFilters, minPriceDrop: 50000 },
      excludePersona: true,
    });
    expect(clauses.some((c) => c.includes("TotalPriceDrop"))).toBe(false);
  });

  it("excludeUniversalKey drops that field's clause (histogram base)", () => {
    const uf = makeDefaultUniversalFilters();
    uf.price = [600_000, 1_200_000];
    uf.beds = 3;
    const withPrice = buildTerminalCoreClauses({
      transactionMode: "sale",
      propertyClass: "residential",
      universalFilters: uf,
      filters: defaultTerminalFilters,
    });
    expect(withPrice).toContain("ListPrice:>=600000 && ListPrice:<=1200000");
    expect(withPrice).toContain(
      "(BedroomsAboveGrade:>=3 || (BedroomsAboveGrade:=0 && BedroomsTotal:>=3))"
    );

    const minusPrice = buildTerminalCoreClauses({
      transactionMode: "sale",
      propertyClass: "residential",
      universalFilters: uf,
      filters: defaultTerminalFilters,
      excludeUniversalKey: "price",
    });
    expect(minusPrice.some((c) => c.includes("ListPrice:>=600000"))).toBe(false);
    expect(minusPrice).toContain(
      "(BedroomsAboveGrade:>=3 || (BedroomsAboveGrade:=0 && BedroomsTotal:>=3))"
    ); // other filters survive
  });
});
