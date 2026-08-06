import { describe, it, expect } from "vitest";
import {
  ACTIVE_DATASETS,
  DESCRIPTOR_DATASETS,
  GEO_DATASETS,
  buildGeoFlag,
  describeFeature,
} from "./geoDatasets";

const devDs = ACTIVE_DATASETS.find((d) => d.kind === "dev_application")!;
const mcDs = ACTIVE_DATASETS.find((d) => d.kind === "major_construction")!;

describe("DESCRIPTOR_DATASETS registry", () => {
  it("is exactly the two distance datasets that carry a descriptor", () => {
    expect(DESCRIPTOR_DATASETS.map((d) => d.kind).sort()).toEqual([
      "dev_application",
      "major_construction",
    ]);
  });

  it("every descriptor dataset is a distance predicate with a derive fn", () => {
    for (const d of DESCRIPTOR_DATASETS) {
      expect(d.predicate.type).toBe("distance");
      expect(d.descriptor).toBeTruthy();
      expect(typeof d.descriptor!.derive).toBe("function");
    }
  });

  it("no intersect dataset accidentally carries a descriptor", () => {
    for (const d of GEO_DATASETS) {
      if (d.predicate.type === "intersect") expect(d.descriptor).toBeUndefined();
    }
  });
});

describe("describeFeature — major_construction work types (all live cities)", () => {
  const c = (attrs: Record<string, unknown>) => describeFeature("major_construction", attrs);

  it("Waterloo / Burlington WORKDESC", () => {
    expect(c({ WORKDESC: "New" })).toBe("New building");
    expect(c({ WORKDESC: "Demolition" })).toBe("Demolition");
    expect(c({ WORKDESC: "FoundationOnly" })).toBe("New building");
    expect(c({ WORKDESC: "Addition" })).toBe("Building addition");
    expect(c({ WORKDESC: "ResidentialAddition" })).toBe("Building addition");
    expect(c({ WORKDESC: "NonResidentialAddition" })).toBe("Building addition");
    expect(c({ WORKDESC: "Demolition -Building" })).toBe("Demolition");
  });

  it("Mississauga SCOPE", () => {
    expect(c({ SCOPE: "NEW BUILDING" })).toBe("New building");
    expect(c({ SCOPE: "DEMOLITION" })).toBe("Demolition");
    expect(c({ SCOPE: "ADDITION AND ALTERATION" })).toBe("Building addition");
    expect(c({ SCOPE: "ADDITION TO EXISTING BLDG" })).toBe("Building addition");
  });

  it("Kitchener PERMIT_TYPE (building categories, conservatively NOT asserted 'new')", () => {
    expect(c({ PERMIT_TYPE: "Residential Building (Multi)" })).toBe("Multi-unit building");
    expect(c({ PERMIT_TYPE: "Commercial Building" })).toBe("Commercial building");
    expect(c({ PERMIT_TYPE: "Industrial Building" })).toBe("Industrial building");
    expect(c({ PERMIT_TYPE: "Industrial/Commercial/Institutional Building Permit" })).toBe("Commercial building");
    expect(c({ PERMIT_TYPE: "Residential Demolition" })).toBe("Demolition");
    expect(c({ PERMIT_TYPE: "Non-Residential Demolition" })).toBe("Demolition");
    // A plain single-family house permit isn't described (→ generic title).
    expect(c({ PERMIT_TYPE: "Residential Building (House)" })).toBeNull();
    expect(c({ PERMIT_TYPE: "Residential Building Permit" })).toBeNull();
  });

  it("asserts 'New' only when the value explicitly says so", () => {
    expect(c({ SCOPE: "NEW BUILDING" })).toBe("New building");
    // a category WITH an explicit new token composes to "New <category>"
    expect(c({ PERMIT_TYPE: "New Commercial Building" })).toBe("New commercial building");
  });

  it("Oakville Worktype", () => {
    expect(c({ Worktype: "New Const." })).toBe("New building");
    expect(c({ Worktype: "New Construction" })).toBe("New building");
    expect(c({ Worktype: "Demolition" })).toBe("Demolition");
    expect(c({ Worktype: "Addition" })).toBe("Building addition");
    expect(c({ Worktype: "Addition to an existing building" })).toBe("Building addition");
  });

  it("Toronto PERMIT_TYPE (harvested)", () => {
    expect(c({ PERMIT_TYPE: "New Building" })).toBe("New building");
    expect(c({ PERMIT_TYPE: "New Houses" })).toBe("New building");
    expect(c({ PERMIT_TYPE: "Demolition Folder (DM)" })).toBe("Demolition");
    expect(c({ PERMIT_TYPE: "Building Additions/Alterations" })).toBe("Building addition");
    expect(c({ PERMIT_TYPE: "Non-Residential Building Permit" })).toBeNull();
  });
});

describe("describeFeature — dev_application types (all live cities)", () => {
  const d = (attrs: Record<string, unknown>) => describeFeature("dev_application", attrs);

  it("Hamilton FILE_TYPE", () => {
    expect(d({ FILE_TYPE: "Official Plan Amendment" })).toBe("Official Plan amendment");
    expect(d({ FILE_TYPE: "Zoning Amendment" })).toBe("Zoning amendment");
    expect(d({ FILE_TYPE: "Subdivision" })).toBe("Plan of subdivision");
    expect(d({ FILE_TYPE: "Condominium" })).toBe("Plan of condominium");
  });

  it("Ottawa APPLICATION_TYPE_EN (padded to 25 chars → trimmed)", () => {
    expect(d({ APPLICATION_TYPE_EN: "Official Plan Amendment  " })).toBe("Official Plan amendment");
    expect(d({ APPLICATION_TYPE_EN: "Zoning By-law Amendment  " })).toBe("Zoning amendment");
    expect(d({ APPLICATION_TYPE_EN: "Plan of Subdivision      " })).toBe("Plan of subdivision");
    expect(d({ APPLICATION_TYPE_EN: "Plan of Condominium      " })).toBe("Plan of condominium");
  });

  it("York APPL_TYPE (local/regional/draft/registered variants collapse)", () => {
    expect(d({ APPL_TYPE: "Local Official Plan Amendment" })).toBe("Official Plan amendment");
    expect(d({ APPL_TYPE: "Regional Official Plan Amendment" })).toBe("Official Plan amendment");
    expect(d({ APPL_TYPE: "Zoning By-law Amendment" })).toBe("Zoning amendment");
    expect(d({ APPL_TYPE: "Draft Plan of Subdivision" })).toBe("Plan of subdivision");
    expect(d({ APPL_TYPE: "Registered Plan of Condominium" })).toBe("Plan of condominium");
    expect(d({ APPL_TYPE: "Draft Vacant Land Plan of Condominium" })).toBe("Plan of condominium");
  });

  it("Toronto APPLICATION_TYPE short codes (whole-string, no substring collisions)", () => {
    expect(d({ APPLICATION_TYPE: "OZ" })).toBe("Official Plan amendment & rezoning");
    expect(d({ APPLICATION_TYPE: "OP" })).toBe("Official Plan amendment");
    expect(d({ APPLICATION_TYPE: "ZR" })).toBe("Zoning amendment");
    expect(d({ APPLICATION_TYPE: "ZBL" })).toBe("Zoning amendment");
    expect(d({ APPLICATION_TYPE: "SB" })).toBe("Plan of subdivision");
    expect(d({ APPLICATION_TYPE: "CD" })).toBe("Plan of condominium");
    expect(d({ APPLICATION_TYPE: "RH" })).toBe("Rental-housing demolition/conversion");
  });

  it("Mississauga LAYER titles (readable) — unknown 'Approved' → generic", () => {
    expect(d({ LAYER: "Rezoning" })).toBe("Zoning amendment");
    expect(d({ LAYER: "Subdivision" })).toBe("Plan of subdivision");
    expect(d({ LAYER: "Condominium" })).toBe("Plan of condominium");
    expect(d({ LAYER: "Approved Applications (past 18 months)" })).toBeNull();
  });

  it("Waterloo — one populated file-number column PER kind (presence, not value)", () => {
    // Real shape: OPA/ZBA/SUBDIVISION/CONDO columns always present, populated selectively.
    expect(d({ OPA: "OPA 60", ZBA: "Z-24-18", SUBDIVISION: null, CONDO: null })).toBe(
      "Official Plan amendment & rezoning",
    );
    expect(d({ OPA: "OPA 62", ZBA: "Z-24-21", SUBDIVISION: "30T-24401", CONDO: null })).toBe(
      "Plan of subdivision",
    );
    expect(d({ OPA: null, ZBA: "Z-18-11", SUBDIVISION: null, CONDO: null })).toBe("Zoning amendment");
    expect(d({ OPA: "OPA 61", ZBA: null, SUBDIVISION: null, CONDO: null })).toBe("Official Plan amendment");
    // Waterloo-shaped but empty → generic.
    expect(d({ OPA: null, ZBA: null, SUBDIVISION: null, CONDO: null })).toBeNull();
  });

  it("Brampton — APPLICATION_TYPE is the constant layer name; real type is in DESCRIPTION", () => {
    // The bug this guards against: APPLICATION_TYPE='OPA ZBA Subdivision' for EVERY row would
    // mislabel them all "Plan of subdivision". We read DESCRIPTION instead.
    expect(
      d({
        APPLICATION_TYPE: "OPA ZBA Subdivision",
        DESCRIPTION: "Draft Plan of Subdivision | Official Plan Amendment | Zoning By Law Amendment",
      }),
    ).toBe("Official Plan amendment");
    expect(d({ APPLICATION_TYPE: "OPA ZBA Subdivision", DESCRIPTION: "Official Plan Amendment" })).toBe(
      "Official Plan amendment",
    );
    expect(
      d({ APPLICATION_TYPE: "OPA ZBA Subdivision", DESCRIPTION: "Lifting of Hold | Zoning By Law Amendment" }),
    ).toBe("Zoning amendment");
    // A procedural-only Brampton item with no recognizable type → generic (not mislabeled).
    expect(d({ APPLICATION_TYPE: "OPA ZBA Subdivision", DESCRIPTION: "Lifting of Hold" })).toBeNull();
  });
});

describe("describeFeature — edge cases (bulletproofing)", () => {
  it("returns null for a kind with no descriptor config, even with attrs", () => {
    expect(describeFeature("hydro", { WORKDESC: "New" })).toBeNull();
    expect(describeFeature("flood", { FILE_TYPE: "Zoning Amendment" })).toBeNull();
  });

  it("returns null for an unknown kind", () => {
    expect(describeFeature("not_a_dataset", { SCOPE: "NEW BUILDING" })).toBeNull();
  });

  it("returns null on missing / empty / non-object attrs", () => {
    expect(describeFeature("major_construction", null)).toBeNull();
    expect(describeFeature("major_construction", undefined)).toBeNull();
    expect(describeFeature("major_construction", {})).toBeNull();
    // A jsonb that somehow parsed to a non-object must not throw.
    expect(describeFeature("major_construction", "NEW BUILDING" as unknown as Record<string, unknown>)).toBeNull();
  });

  it("skips empty / whitespace / unrecognized field values", () => {
    expect(describeFeature("major_construction", { WORKDESC: "" })).toBeNull();
    expect(describeFeature("major_construction", { WORKDESC: "   " })).toBeNull();
    expect(describeFeature("major_construction", { WORKDESC: "Plumbing" })).toBeNull();
    expect(describeFeature("dev_application", { FILE_TYPE: "Some Unknown Thing" })).toBeNull();
  });

  it("ignores the internal _match_radius_m and other non-descriptor keys", () => {
    expect(describeFeature("major_construction", { _match_radius_m: 150, SCOPE: "NEW BUILDING" })).toBe(
      "New building",
    );
  });

  it("coerces a numeric field value and falls back to generic when unrecognized", () => {
    expect(describeFeature("major_construction", { WORKDESC: 42 })).toBeNull();
  });

  it("honors field PRIORITY — the first recognized field wins", () => {
    // A readable type field should win over a trailing generic TYPE holding noise.
    expect(
      describeFeature("dev_application", { APPLICATION_TYPE_EN: "Zoning By-law Amendment", TYPE: "misc" }),
    ).toBe("Zoning amendment");
    // A non-matching early field must not block a matching later field.
    expect(describeFeature("dev_application", { APPLICATION_TYPE_EN: "  ", APPL_TYPE: "Draft Plan of Subdivision" })).toBe(
      "Plan of subdivision",
    );
  });
});

describe("buildGeoFlag — title with / without descriptor", () => {
  it("major_construction uses the descriptor when present", () => {
    expect(buildGeoFlag(mcDs, 120, "New building").title).toBe("New building permit issued ~120 m away");
    expect(buildGeoFlag(mcDs, 84.6, "Demolition").title).toBe("Demolition permit issued ~85 m away");
  });

  it("major_construction falls back to the generic title without a descriptor", () => {
    expect(buildGeoFlag(mcDs, 120).title).toBe("Recent major construction permit issued ~120 m away");
    expect(buildGeoFlag(mcDs, 120, null).title).toBe("Recent major construction permit issued ~120 m away");
  });

  it("dev_application uses the descriptor when present", () => {
    expect(buildGeoFlag(devDs, 180, "Zoning amendment").title).toBe("Zoning amendment filed ~180 m away");
  });

  it("dev_application falls back to the generic title without a descriptor", () => {
    expect(buildGeoFlag(devDs, 180).title).toBe("Major development application filed ~180 m away");
  });

  it("keeps id / kind / severity / source / ask intact regardless of descriptor", () => {
    const withDesc = buildGeoFlag(mcDs, 100, "New building");
    const without = buildGeoFlag(mcDs, 100);
    for (const k of ["id", "kind", "severity", "source", "ask"] as const) {
      expect(withDesc[k]).toEqual(without[k]);
    }
  });
});
