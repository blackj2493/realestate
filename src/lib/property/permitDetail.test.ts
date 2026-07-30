import { describe, it, expect } from "vitest";
import {
  permitDetailLine,
  permitTypeLabel,
  formatPermitValue,
  formatPermitIssued,
} from "./permitDetail";

describe("permitTypeLabel — per-city work codes → one vocabulary", () => {
  it("maps each live source's new-build codes", () => {
    for (const raw of ["New", "NEW BUILDING", "New Const.", "New Houses", "New Construction"]) {
      expect(permitTypeLabel(raw)).toBe("new build");
    }
  });

  it("reads demolition before anything else in the code", () => {
    expect(permitTypeLabel("Residential Demolition")).toBe("demolition");
    expect(permitTypeLabel("DEMOLITION")).toBe("demolition");
    expect(permitTypeLabel("Demolition Folder (DM)")).toBe("demolition");
  });

  it("maps additions and alterations", () => {
    expect(permitTypeLabel("Building Additions/Alterations")).toBe("major addition");
    expect(permitTypeLabel("ADDITION AND ALTERATION")).toBe("major addition");
    expect(permitTypeLabel("NonResidentialAddition")).toBe("major addition"); // camelCase source code
  });

  it("maps the multi/commercial/industrial buckets", () => {
    expect(permitTypeLabel("Residential Building (Multi)")).toBe("multi-residential build");
    expect(permitTypeLabel("Commercial Building")).toBe("commercial build");
    expect(permitTypeLabel("Industrial Building")).toBe("industrial build");
    expect(permitTypeLabel("FoundationOnly")).toBe("foundation-only build");
  });

  it("falls back to the city's own words, and drops junk", () => {
    expect(permitTypeLabel("Solar Panel Install")).toBe("solar panel install");
    expect(permitTypeLabel("UNKNOWN")).toBeNull();
    expect(permitTypeLabel("")).toBeNull();
    expect(permitTypeLabel(null)).toBeNull();
    expect(permitTypeLabel(42)).toBeNull();
  });
});

describe("formatPermitValue", () => {
  it("formats millions and thousands", () => {
    expect(formatPermitValue(4_200_000)).toBe("~$4.2M");
    expect(formatPermitValue(4_000_000)).toBe("~$4M");
    expect(formatPermitValue(42_000_000)).toBe("~$42M");
    expect(formatPermitValue(850_000)).toBe("~$850K");
  });

  it("parses dirty string values", () => {
    expect(formatPermitValue("1200000")).toBe("~$1.2M");
    expect(formatPermitValue("$1,200,000")).toBe("~$1.2M");
  });

  it("drops absent, trivial and absurd values (Toronto redacts the field)", () => {
    expect(formatPermitValue(null)).toBeNull();
    expect(formatPermitValue(0)).toBeNull();
    expect(formatPermitValue(-5)).toBeNull();
    expect(formatPermitValue(20_000)).toBeNull(); // below the $50k floor
    expect(formatPermitValue(1e12)).toBeNull();
    expect(formatPermitValue("REDACTED")).toBeNull();
  });
});

describe("formatPermitIssued", () => {
  it("formats ISO dates, ArcGIS epoch ms and bare years", () => {
    expect(formatPermitIssued("2026-03-14")).toBe("Mar 2026");
    expect(formatPermitIssued("2026-03-14T00:00:00Z")).toBe("Mar 2026");
    expect(formatPermitIssued(Date.UTC(2026, 2, 14))).toBe("Mar 2026");
    expect(formatPermitIssued(2024)).toBe("2024");
    expect(formatPermitIssued("2024")).toBe("2024");
  });

  it("rejects implausible or unparseable dates", () => {
    expect(formatPermitIssued("not a date")).toBeNull();
    expect(formatPermitIssued(null)).toBeNull();
    expect(formatPermitIssued("1875-01-01")).toBeNull();
  });
});

describe("permitDetailLine — real per-city attribute shapes", () => {
  it("Toronto (value redacted, units + type + full date)", () => {
    expect(
      permitDetailLine({
        PERMIT_TYPE: "New Building",
        STRUCTURE_TYPE: "Apartment",
        STATUS: "Inspection",
        ISSUED_DATE: "2026-03-14",
        DWELLING_UNITS_CREATED: 12,
        DESCRIPTION: "Proposal to construct a 4-storey apartment building",
        ADDRESS: "142 MAIN ST W",
      }),
    ).toBe("12-unit new build · issued Mar 2026");
  });

  it("Mississauga (SCOPE / EST_CON_VALUE / RES_UNITS)", () => {
    expect(
      permitDetailLine({
        SCOPE: "NEW BUILDING",
        EST_CON_VALUE: 4_200_000,
        RES_UNITS: 12,
        ISSUE_DATE: "2026-02-02",
        STATUS: "ISSUED",
      }),
    ).toBe("12-unit new build · ~$4.2M · issued Feb 2026");
  });

  it("Waterloo (WORKDESC / CONTRVALUE / UNITS, year only)", () => {
    expect(
      permitDetailLine({ WORKDESC: "Addition", PERMITDESC: "Building", CONTRVALUE: 1_200_000, UNITS: 0, ISSUE_YEAR: "2025" }),
    ).toBe("Major addition · ~$1.2M · issued 2025");
  });

  it("Oakville (mixed-case keys resolve the same)", () => {
    expect(
      permitDetailLine({
        Worktype: "New Const.",
        Subtype: "Dwelling",
        Construction_Value: 980_000,
        Dwelling_Units_Created: 1,
        ISSUEDATE: Date.UTC(2025, 10, 3),
      }),
    ).toBe("New build · ~$980K · issued Nov 2025");
  });

  it("Burlington (CONSTRUCTVALUE / RESUNITS)", () => {
    expect(
      permitDetailLine({ WORKDESC: "New", CONSTRUCTVALUE: 6_500_000, RESUNITS: 40, ISSUEDATE: "2025-06-01" }),
    ).toBe("40-unit new build · ~$6.5M · issued Jun 2025");
  });

  it("names the scale even when the work type is unrecognized", () => {
    expect(permitDetailLine({ RES_UNITS: 8, ISSUE_YEAR: 2024 })).toBe("8-unit development · issued 2024");
  });

  it("never surfaces the permit's street address or free-text description", () => {
    const line = permitDetailLine({
      PERMIT_TYPE: "New Building",
      ADDRESS: "142 MAIN ST W",
      DESCRIPTION: "Interior work at 142 Main St W",
      ISSUED_DATE: "2026-03-14",
    });
    expect(line).toBe("New build · issued Mar 2026");
    expect(line).not.toMatch(/142|main st/i);
  });

  it("degrades to null when the source carries nothing worth showing", () => {
    expect(permitDetailLine({})).toBeNull();
    expect(permitDetailLine({ OBJECTID: 7, _match_radius_m: 100 })).toBeNull();
    expect(permitDetailLine(null)).toBeNull();
    expect(permitDetailLine("nope")).toBeNull();
    expect(permitDetailLine([1, 2])).toBeNull();
  });
});
