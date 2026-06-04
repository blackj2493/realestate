import { describe, it, expect } from "vitest";
import {
  FILTERS_BY_KEY,
  buildUniversalFilterString,
  makeDefaultUniversalFilters,
  ALL_FILTERS,
  FACET_FIELDS,
} from "./filterRegistry";

describe("filterRegistry — clause builders", () => {
  it("price emits both bounds when narrowed", () => {
    expect(FILTERS_BY_KEY.price.buildClause([500_000, 800_000])).toBe(
      "ListPrice:>=500000 && ListPrice:<=800000"
    );
  });
  it("price emits only the lower bound when max is default", () => {
    expect(FILTERS_BY_KEY.price.buildClause([500_000, 3_000_000])).toBe("ListPrice:>=500000");
  });
  it("price returns null at defaults", () => {
    expect(FILTERS_BY_KEY.price.buildClause([0, 3_000_000])).toBeNull();
  });
  it("beds emits an above-grade >= clause (with total fallback), null at 0", () => {
    expect(FILTERS_BY_KEY.beds.buildClause(3)).toBe(
      "(BedroomsAboveGrade:>=3 || (BedroomsAboveGrade:=0 && BedroomsTotal:>=3))"
    );
    expect(FILTERS_BY_KEY.beds.buildClause(0)).toBeNull();
  });
  it("baths emits a >= clause", () => {
    expect(FILTERS_BY_KEY.baths.buildClause(2)).toBe("BathroomsTotalInteger:>=2");
  });
  it("homeType backtick-quotes each subtype in an OR group", () => {
    expect(FILTERS_BY_KEY.homeType.buildClause(["Detached", "Condo Apartment"])).toBe(
      "(PropertySubType:=`Detached` || PropertySubType:=`Condo Apartment`)"
    );
  });
  it("homeType returns null when empty", () => {
    expect(FILTERS_BY_KEY.homeType.buildClause([])).toBeNull();
  });
});

describe("filterRegistry — chip labels", () => {
  it("formats a price band", () => {
    expect(FILTERS_BY_KEY.price.chipLabel([500_000, 800_000])).toBe("$500k–$800k");
  });
  it("formats beds", () => {
    expect(FILTERS_BY_KEY.beds.chipLabel(3)).toBe("3+ Bd");
  });
  it("summarizes multiple home types", () => {
    expect(FILTERS_BY_KEY.homeType.chipLabel(["Detached", "Multiplex"])).toBe("2 types");
  });
});

describe("buildUniversalFilterString", () => {
  it("returns empty string at defaults", () => {
    expect(buildUniversalFilterString(makeDefaultUniversalFilters())).toBe("");
  });
  it("joins active clauses with &&", () => {
    const f = makeDefaultUniversalFilters();
    f.price = [500_000, 800_000];
    f.beds = 3;
    f.homeType = ["Detached"];
    expect(buildUniversalFilterString(f)).toBe(
      "ListPrice:>=500000 && ListPrice:<=800000 && (BedroomsAboveGrade:>=3 || (BedroomsAboveGrade:=0 && BedroomsTotal:>=3)) && (PropertySubType:=`Detached`)"
    );
  });
});

describe("MORE_FILTERS (Phase 2)", () => {
  it("registers 14 filters total (4 pinned + 10 added)", () => {
    expect(ALL_FILTERS.length).toBe(14);
    expect(ALL_FILTERS.filter((f) => f.defaultPinned).length).toBe(4);
  });
  it("basement backtick-quotes BasementType values in an OR group", () => {
    expect(FILTERS_BY_KEY.basement.buildClause(["Finished", "Separate Entrance"])).toBe(
      "(BasementType:=`Finished` || BasementType:=`Separate Entrance`)"
    );
  });
  it("occupancy emits a single-value clause", () => {
    expect(FILTERS_BY_KEY.occupancy.buildClause(["Vacant"])).toBe("(OccupantType:=`Vacant`)");
  });
  it("lotSize emits a range and null at defaults", () => {
    expect(FILTERS_BY_KEY.lotSize.buildClause([2000, 20000])).toBe("LotSqftTotal:>=2000");
    expect(FILTERS_BY_KEY.lotSize.buildClause([0, 20000])).toBeNull();
  });
  it("parking emits a >= stepper clause", () => {
    expect(FILTERS_BY_KEY.parking.buildClause(2)).toBe("ParkingTotal:>=2");
  });
  it("maintFee emits an upper bound", () => {
    expect(FILTERS_BY_KEY.maintFee.buildClause([0, 600])).toBe("AssociationFee:<=600");
  });
  it("FACET_FIELDS lists the faceted enum fields", () => {
    expect(FACET_FIELDS).toContain("BasementType");
    expect(FACET_FIELDS).toContain("PropertySubType");
  });
});
