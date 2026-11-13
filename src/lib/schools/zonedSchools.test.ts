import { describe, expect, it } from "vitest";
import { kindsWithoutZone, orderZoned, parseZonedTokens } from "./zonedSchools";

describe("parseZonedTokens", () => {
  it("parses id|program tokens and drops bad or repeated ones", () => {
    expect(
      parseZonedTokens(["A|regular", "B|french_immersion", "A|regular", "C|nonsense", "D", 7, "|regular"])
    ).toEqual([
      { id: "A", program: "regular" },
      { id: "B", program: "french_immersion" },
    ]);
  });
  it("returns [] for a missing field", () => {
    expect(parseZonedTokens(undefined)).toEqual([]);
    expect(parseZonedTokens("A|regular")).toEqual([]);
  });
});

describe("orderZoned", () => {
  it("puts elementary, public, and the home program first", () => {
    const list = [
      { name: "Sec Cath", level: "secondary" as const, system: "catholic" as const, program: "regular" as const },
      { name: "Elem FI", level: "elementary" as const, system: "public" as const, program: "french_immersion" as const },
      { name: "Elem Cath", level: "elementary" as const, system: "catholic" as const, program: "regular" as const },
      { name: "Elem Pub", level: "elementary" as const, system: "public" as const, program: "regular" as const },
    ];
    expect(orderZoned(list).map((s) => s.name)).toEqual(["Elem Pub", "Elem FI", "Elem Cath", "Sec Cath"]);
  });
});

describe("kindsWithoutZone", () => {
  it("names each kind with no regular zone; a French program does not count", () => {
    expect(
      kindsWithoutZone([
        { level: "elementary", system: "public", program: "regular" },
        { level: "secondary", system: "public", program: "regular" },
        { level: "elementary", system: "catholic", program: "french_immersion" },
      ])
    ).toEqual(["Catholic elementary", "Catholic secondary"]);
  });
  it("names nothing when all four are zoned", () => {
    expect(
      kindsWithoutZone(
        (["public", "catholic"] as const).flatMap((system) =>
          (["elementary", "secondary"] as const).map((level) => ({ level, system, program: "regular" as const }))
        )
      )
    ).toEqual([]);
  });
});
