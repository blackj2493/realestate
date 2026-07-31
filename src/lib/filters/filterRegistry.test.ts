import { describe, it, expect } from "vitest";
import {
  FILTERS_BY_KEY,
  buildUniversalFilterString,
  makeDefaultUniversalFilters,
  ALL_FILTERS,
  FACET_FIELDS,
  coreFiltersForClass,
  moreFiltersForClass,
  inapplicableFilterKeysForClass,
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
  it("beds emits an exact above-grade clause in exact mode", () => {
    expect(FILTERS_BY_KEY.beds.buildClause({ n: 3, exact: true })).toBe(
      "(BedroomsAboveGrade:=3 || (BedroomsAboveGrade:=0 && BedroomsTotal:=3))"
    );
  });
  it("baths emits an exact (=) clause in exact mode", () => {
    expect(FILTERS_BY_KEY.baths.buildClause({ n: 2, exact: true })).toBe("BathroomsTotalInteger:=2");
  });
  it("a bare stepper number is still read as a minimum (back-compat)", () => {
    expect(FILTERS_BY_KEY.beds.buildClause({ n: 0, exact: true })).toBeNull();
    expect(FILTERS_BY_KEY.baths.buildClause(2)).toBe(
      FILTERS_BY_KEY.baths.buildClause({ n: 2, exact: false })
    );
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
  it("drops the + on an exact bed count", () => {
    expect(FILTERS_BY_KEY.beds.chipLabel({ n: 3, exact: true })).toBe("3 Bd");
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
  it("registers 17 filters total (4 pinned + 13 added)", () => {
    expect(ALL_FILTERS.length).toBe(17);
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
  it("parking emits an exact (=) clause in exact mode", () => {
    expect(FILTERS_BY_KEY.parking.buildClause({ n: 2, exact: true })).toBe("ParkingTotal:=2");
  });
  it("garage emits a CoveredSpaces >= stepper clause, null at 0", () => {
    expect(FILTERS_BY_KEY.garage.buildClause(2)).toBe("CoveredSpaces:>=2");
    expect(FILTERS_BY_KEY.garage.buildClause(0)).toBeNull();
  });
  it("faces backtick-quotes DirectionFaces values in an OR group", () => {
    expect(FILTERS_BY_KEY.faces.buildClause(["North", "South West"])).toBe(
      "(DirectionFaces:=`North` || DirectionFaces:=`South West`)"
    );
    expect(FILTERS_BY_KEY.faces.buildClause([])).toBeNull();
  });
  it("maintFee emits an upper bound", () => {
    expect(FILTERS_BY_KEY.maintFee.buildClause([0, 600])).toBe("AssociationFee:<=600");
  });
  it("FACET_FIELDS lists the faceted enum fields", () => {
    expect(FACET_FIELDS).toContain("BasementType");
    expect(FACET_FIELDS).toContain("PropertySubType");
    expect(FACET_FIELDS).toContain("DirectionFaces");
  });
});

describe("filterRegistry — class-scoped filter sets (commercial)", () => {
  const keys = (list: { key: string }[]) => list.map((f) => f.key);

  it("residential shows every filter and excludes nothing from the query", () => {
    expect(keys(coreFiltersForClass("residential"))).toContain("beds");
    expect(keys(coreFiltersForClass("residential"))).toContain("baths");
    expect(inapplicableFilterKeysForClass("residential")).toEqual([]);
  });

  it("commercial drops beds/baths from core but keeps price + type", () => {
    const core = keys(coreFiltersForClass("commercial"));
    expect(core).toContain("price");
    expect(core).toContain("homeType");
    expect(core).not.toContain("beds");
    expect(core).not.toContain("baths");
  });

  it("commercial keeps only commercial-relevant deep-library fields", () => {
    const more = keys(moreFiltersForClass("commercial"));
    expect(more).toEqual(expect.arrayContaining(["occupancy", "lotSize", "lotFrontage", "parking"]));
    for (const residentialOnly of ["basement", "suite", "kitchens", "faces", "garage", "multiUnit"]) {
      expect(more).not.toContain(residentialOnly);
    }
  });

  it("commercial excludes residential-only keys from the query, but not price/type/lot", () => {
    const excluded = inapplicableFilterKeysForClass("commercial");
    expect(excluded).toEqual(expect.arrayContaining(["beds", "baths", "basement", "kitchens", "faces"]));
    expect(excluded).not.toContain("price");
    expect(excluded).not.toContain("homeType");
    expect(excluded).not.toContain("occupancy");
    expect(excluded).not.toContain("lotSize");
  });
});
