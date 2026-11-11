import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/typesense/client", () => ({ searchListings: vi.fn() }));

import { buildLensClauses } from "./queries";
import { DEFAULT_ACTIVITY_LENS } from "./config";
import { homesOnlyClause, soldHomesOnlyClause } from "./propertyTypes";

describe("homes only", () => {
  it("the shared lens filter (New, boards, area alerts) drops commercial by default", () => {
    expect(buildLensClauses(DEFAULT_ACTIVITY_LENS)).toContain("PropertyType:!=Commercial");
    expect(buildLensClauses({ ...DEFAULT_ACTIVITY_LENS, transactionType: "lease" })).toContain(
      "PropertyType:!=Commercial"
    );
  });

  it("adds nothing once a type is picked (the picked list already decides)", () => {
    expect(homesOnlyClause(["condo"])).toBeUndefined();
    expect(soldHomesOnlyClause(["vacant"])).toBeUndefined();
  });

  it("the sold twin excludes the same population by sub-type", () => {
    const c = soldHomesOnlyClause([])!;
    for (const t of ["Sale Of Business", "Commercial Retail", "Office", "Parking Space", "Locker"]) {
      expect(c).toContain(`\`${t}\``);
    }
    expect(c).not.toContain("Farm");
  });
});
