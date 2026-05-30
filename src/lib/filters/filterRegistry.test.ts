import { describe, it, expect } from "vitest";
import {
  FILTERS_BY_KEY,
  buildUniversalFilterString,
  makeDefaultUniversalFilters,
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
  it("beds emits a >= clause, null at 0", () => {
    expect(FILTERS_BY_KEY.beds.buildClause(3)).toBe("BedroomsTotal:>=3");
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
      "ListPrice:>=500000 && ListPrice:<=800000 && BedroomsTotal:>=3 && (PropertySubType:=`Detached`)"
    );
  });
});
