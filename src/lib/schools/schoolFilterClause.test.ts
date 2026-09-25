import { describe, expect, it } from "vitest";
import { buildSchoolFilterClause, type TargetSchool } from "./schoolFilterClause";

const stCyril: TargetSchool = {
  id: "B67059-785563",
  name: "St Cyril Catholic School",
  programs: ["regular", "french_immersion"],
};

describe("buildSchoolFilterClause — catchment", () => {
  it("filters by the boundary when the school publishes one for that program", () => {
    const r = buildSchoolFilterClause(stCyril, "french_immersion");
    expect(r.mode).toBe("catchment");
    expect(r.clause).toBe("SchoolCatchments:=`B67059-785563|french_immersion`");
  });

  it("keys the token on the program the reader picked, not the school's default", () => {
    expect(buildSchoolFilterClause(stCyril, "regular").clause).toBe(
      "SchoolCatchments:=`B67059-785563|regular`"
    );
  });

  it("says it is a catchment, and which one", () => {
    expect(buildSchoolFilterClause(stCyril, "french_immersion").label).toBe(
      "In St Cyril Catholic School's French Immersion catchment"
    );
    expect(buildSchoolFilterClause(stCyril, "regular").label).toBe(
      "In St Cyril Catholic School's catchment"
    );
  });
});

describe("buildSchoolFilterClause — radius fallback", () => {
  it("falls back when the school publishes no catchment for that program", () => {
    // St Cyril has no Extended French zone. Returning nothing would be a worse answer
    // than a radius, so this degrades rather than empties.
    const r = buildSchoolFilterClause(stCyril, "extended_french");
    expect(r.mode).toBe("radius");
    expect(r.clause).toBe("NearbySchools:=`B67059-785563`");
  });

  it("falls back for a school with no catchments at all", () => {
    const none: TargetSchool = { id: "B1-2", name: "Somewhere PS", programs: [] };
    expect(buildSchoolFilterClause(none, "regular").mode).toBe("radius");
  });

  it("falls back when programs is absent — a stale client, or a chip saved before this shipped", () => {
    const legacy: TargetSchool = { id: "B1-2", name: "Somewhere PS" };
    const r = buildSchoolFilterClause(legacy, "regular");
    expect(r.mode).toBe("radius");
    // Exactly the clause the app emitted before catchments existed.
    expect(r.clause).toBe("NearbySchools:=`B1-2`");
  });

  it("names the radius, not the school, so it cannot be read as an attendance claim", () => {
    const r = buildSchoolFilterClause(stCyril, "extended_french");
    expect(r.label).toBe("Within 2.5 km of St Cyril Catholic School");
    expect(r.label).not.toContain("catchment");
  });
});

describe("injection", () => {
  it("strips backticks from the id, which would otherwise close the quoted value", () => {
    const nasty: TargetSchool = {
      id: "A`B || ListPrice:>0",
      name: "Nasty",
      programs: ["regular"],
    };
    const r = buildSchoolFilterClause(nasty, "regular");
    expect(r.clause).not.toContain("`A`");
    expect(r.clause.match(/`/g)).toHaveLength(2);
  });
});
