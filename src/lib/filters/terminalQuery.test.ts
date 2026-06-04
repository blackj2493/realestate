import { describe, it, expect } from "vitest";
import { buildTerminalCoreClauses } from "./terminalQuery";
import { makeDefaultUniversalFilters } from "./filterRegistry";
import { defaultTerminalFilters } from "@/lib/personas/personaConfig";

const noopPersona = { buildFilterString: () => "" };

describe("buildTerminalCoreClauses", () => {
  it("residential sale defaults → floor + sale + not-commercial", () => {
    const clauses = buildTerminalCoreClauses({
      transactionMode: "sale",
      propertyClass: "residential",
      universalFilters: makeDefaultUniversalFilters(),
      filters: defaultTerminalFilters,
      persona: noopPersona,
    });
    expect(clauses).toEqual([
      "ListPrice:>=100000",
      "TransactionType:=`For Sale`",
      "PropertyType:!=Commercial",
    ]);
  });

  it("rent flips the floor + transaction and keeps commercial gating", () => {
    const clauses = buildTerminalCoreClauses({
      transactionMode: "rent",
      propertyClass: "commercial",
      universalFilters: makeDefaultUniversalFilters(),
      filters: defaultTerminalFilters,
      persona: { buildFilterString: () => "ExtrapolatedCapRate:>=5" },
    });
    // commercial+rent ⇒ investor layer off ⇒ persona clause omitted
    expect(clauses).toEqual([
      "ListPrice:>=1",
      "TransactionType:=`For Lease`",
      "PropertyType:=Commercial",
    ]);
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
      persona: noopPersona,
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
      persona: noopPersona,
      excludeUniversalKey: "price",
    });
    expect(minusPrice.some((c) => c.includes("ListPrice:>=600000"))).toBe(false);
    expect(minusPrice).toContain(
      "(BedroomsAboveGrade:>=3 || (BedroomsAboveGrade:=0 && BedroomsTotal:>=3))"
    ); // other filters survive
  });
});
