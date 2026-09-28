import { describe, expect, it } from "vitest";
import { buildAreaClause } from "./stats";

const schoolBubble = (schoolKey: string) =>
  ({
    area_type: "school" as const,
    polygon: [],
    source: { kind: "school" as const, schoolKey },
  }) as unknown as Parameters<typeof buildAreaClause>[0];

/**
 * A school bubble means "the homes that feed this school". It scoped to a 2.5 km circle,
 * which is not that: a home 2.75 km from St Cyril sits inside its catchment and outside the
 * circle. These 6 bubbles also drive nightly alert email, so the clause decides what four
 * people are mailed.
 */
describe("buildAreaClause — school bubbles", () => {
  it("scopes to the attendance boundary when the board publishes one", () => {
    const clause = buildAreaClause(schoolBubble("B67059-785563"), {
      catchmentPrograms: ["regular", "french_immersion"],
    });
    expect(clause).toBe("SchoolCatchments:=`B67059-785563|regular`");
  });

  it("uses the home catchment, not a program zone — the bubble names a school", () => {
    // An immersion zone is a different, much larger area; choosing it is a filter-panel
    // decision, not something a saved school area should silently become.
    const clause = buildAreaClause(schoolBubble("B1"), {
      catchmentPrograms: ["regular", "french_immersion"],
    });
    expect(clause).toContain("|regular");
    expect(clause).not.toContain("french_immersion");
  });

  describe("falls back to the 2.5 km radius", () => {
    it("when the board publishes no regular boundary", () => {
      expect(
        buildAreaClause(schoolBubble("B1"), { catchmentPrograms: ["french_immersion"] })
      ).toBe("NearbySchools:=`B1`");
    });

    it("when the school publishes nothing at all", () => {
      expect(buildAreaClause(schoolBubble("B1"), { catchmentPrograms: [] })).toBe(
        "NearbySchools:=`B1`"
      );
    });

    it("when the caller did not look it up — absent means unknown, not none", () => {
      // A caller that has not been updated, or a lookup that failed, must degrade to the
      // behaviour that existed before catchments rather than filter on a token that may
      // match nothing.
      expect(buildAreaClause(schoolBubble("B1"))).toBe("NearbySchools:=`B1`");
      expect(buildAreaClause(schoolBubble("B1"), {})).toBe("NearbySchools:=`B1`");
    });
  });

  it("strips backticks, which would otherwise close the quoted value", () => {
    const clause = buildAreaClause(schoolBubble("A`B || ListPrice:>0"), {
      catchmentPrograms: ["regular"],
    })!;
    expect(clause.match(/`/g)).toHaveLength(2);
  });
});

describe("buildAreaClause — every other area type is untouched", () => {
  it("draws a polygon for a drawn bubble", () => {
    const clause = buildAreaClause({
      area_type: "draw",
      polygon: [
        [43.7, -79.5],
        [43.8, -79.5],
        [43.8, -79.4],
      ],
      source: { kind: "draw" },
    } as unknown as Parameters<typeof buildAreaClause>[0]);
    expect(clause).toBe("location:(43.7, -79.5, 43.8, -79.5, 43.8, -79.4)");
  });

  it("ignores catchmentPrograms for a non-school bubble", () => {
    const bubble = {
      area_type: "draw",
      polygon: [
        [43.7, -79.5],
        [43.8, -79.5],
        [43.8, -79.4],
      ],
      source: { kind: "draw" },
    } as unknown as Parameters<typeof buildAreaClause>[0];
    expect(buildAreaClause(bubble, { catchmentPrograms: ["regular"] })).toBe(
      buildAreaClause(bubble)
    );
  });

  it("returns null for a degenerate polygon", () => {
    expect(
      buildAreaClause({
        area_type: "draw",
        polygon: [[43.7, -79.5]],
        source: { kind: "draw" },
      } as unknown as Parameters<typeof buildAreaClause>[0])
    ).toBeNull();
  });
});
