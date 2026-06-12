import { describe, expect, it } from "vitest";
import { buildDatasheet, type RawPayload } from "./datasheet";

/** Realistic detached-house payload (subset of a real IDX response shape). */
const DETACHED: RawPayload = {
  PropertySubType: "Detached",
  PropertyType: "Residential",
  ArchitecturalStyle: ["2-Storey"],
  ApproximateAge: "16-30",
  LotWidth: 46,
  LotDepth: 117.25,
  LotSizeUnits: "Feet",
  DirectionFaces: "West",
  HeatType: "Forced Air",
  HeatSource: "Electric",
  Cooling: ["Central Air"],
  Basement: ["Full", "Finished"],
  KitchensTotal: 1,
  KitchensAboveGrade: 1,
  KitchensBelowGrade: 0,
  RoomsAboveGrade: 10,
  RoomsBelowGrade: 4,
  BedroomsTotal: 4,
  BedroomsAboveGrade: 4,
  BedroomsBelowGrade: 0,
};

function rows(payload: RawPayload, groupId: string) {
  const g = buildDatasheet(payload).find((x) => x.group.id === groupId);
  return g ? g.rows : [];
}

function rowValue(payload: RawPayload, groupId: string, label: string) {
  return rows(payload, groupId).find((r) => r.label === label)?.value;
}

describe("buildDatasheet — vitals", () => {
  it("renders the absorbed Structural Vitals / Property Summary rows", () => {
    expect(rowValue(DETACHED, "vitals", "Property Type")).toBe("Detached");
    expect(rowValue(DETACHED, "vitals", "Style")).toBe("2-Storey");
    expect(rowValue(DETACHED, "vitals", "Property Age")).toBe("16-30");
    expect(rowValue(DETACHED, "vitals", "Lot Dimensions")).toBe("46 x 117.25 Feet");
    expect(rowValue(DETACHED, "vitals", "Direction Faces")).toBe("West");
    expect(rowValue(DETACHED, "vitals", "Heating")).toBe("Forced Air · Electric");
    expect(rowValue(DETACHED, "vitals", "Cooling")).toBe("Central Air");
    expect(rowValue(DETACHED, "vitals", "Basement")).toBe("Full · Finished");
    expect(rowValue(DETACHED, "vitals", "Kitchens")).toBe("1 (1 above · 0 below)");
    expect(rowValue(DETACHED, "vitals", "Rooms")).toBe("10 above · 4 below");
    expect(rowValue(DETACHED, "vitals", "Bedrooms")).toBe("4 above · 0 below");
  });

  it("omits rows for missing values and drops empty groups entirely", () => {
    const sheet = buildDatasheet({});
    expect(sheet).toEqual([]);
  });

  it("never throws on garbage payloads", () => {
    const garbage: RawPayload = {
      Cooling: [null, 42, { nested: true }, "Central Air", ""],
      Basement: "Finished",
      LotWidth: "not-a-number",
      ArchitecturalStyle: 7,
      KitchensTotal: null,
    };
    const sheet = buildDatasheet(garbage);
    expect(rowValue(garbage, "vitals", "Cooling")).toBe("42 · Central Air");
    expect(rowValue(garbage, "vitals", "Basement")).toBe("Finished");
    expect(rowValue(garbage, "vitals", "Lot Dimensions")).toBeUndefined();
    expect(sheet.every((g) => g.rows.length > 0)).toBe(true);
  });

  it("passes values through verbatim (odd casing/spacing preserved modulo trim)", () => {
    const p: RawPayload = { ApproximateAge: "  New  ", DirectionFaces: "wEsT" };
    expect(rowValue(p, "vitals", "Property Age")).toBe("New");
    expect(rowValue(p, "vitals", "Direction Faces")).toBe("wEsT");
  });
});

describe("buildDatasheet — composite rows render known segments only", () => {
  it("Rooms: only the segments the feed asserted, no fabricated zeros", () => {
    expect(rowValue({ RoomsAboveGrade: 10 }, "vitals", "Rooms")).toBe("10 above");
    expect(rowValue({ RoomsBelowGrade: 4 }, "vitals", "Rooms")).toBe("4 below");
  });

  it("Bedrooms: plain BedroomsTotal fallback gets no above/below labels", () => {
    expect(rowValue({ BedroomsTotal: 5, BedroomsBelowGrade: 1 }, "vitals", "Bedrooms")).toBe("5");
    expect(rowValue({ BedroomsAboveGrade: 3 }, "vitals", "Bedrooms")).toBe("3 above");
  });

  it("Kitchens: parenthetical lists only known segments; all-zero row is dropped", () => {
    expect(rowValue({ KitchensTotal: 2, KitchensAboveGrade: 2 }, "vitals", "Kitchens")).toBe(
      "2 (2 above)",
    );
    expect(
      rowValue(
        { KitchensTotal: 0, KitchensAboveGrade: 0, KitchensBelowGrade: 0 },
        "vitals",
        "Kitchens",
      ),
    ).toBeUndefined();
  });
});

describe("buildDatasheet — order normalization (append-remainder)", () => {
  it("a partial order never removes unlisted groups", () => {
    // "taxes" has no registry fields yet (Task 2), so it resolves empty and is
    // dropped — but vitals must still render via the appended remainder.
    const ids = buildDatasheet(DETACHED, ["taxes"]).map((g) => g.group.id);
    expect(ids).toEqual(["vitals"]);
  });

  it("duplicate ids in order render the group only once", () => {
    const ids = buildDatasheet(DETACHED, ["vitals", "vitals"]).map((g) => g.group.id);
    expect(ids).toEqual(["vitals"]);
  });
});

const CONDO: RawPayload = {
  PropertySubType: "Condo Apartment",
  AssociationAmenities: ["Gym", "Concierge", "Visitor Parking"],
  BalconyType: "Open",
  Exposure: "Se",
  Locker: "Owned",
  LockerLevel: "B",
  LockerUnit: "27",
  PetsAllowed: ["Restricted"],
  AssociationFeeIncludes: ["Heat Included", "Water Included"],
  CondoCorpNumber: 1234,
  AssociationName: "TSCC",
  PropertyManagementCompany: "Crossbridge",
  LegalStories: "12",
};

describe("buildDatasheet — group coverage", () => {
  it("building & construction", () => {
    const p: RawPayload = {
      ConstructionMaterials: ["Brick", "Stone"],
      FoundationDetails: ["Concrete"],
      Roof: ["Shingles"],
      StructureType: ["House"],
      PropertyAttachedYN: false,
      NewConstructionYN: true,
      LivingAreaRange: "2000-2500",
      SquareFootSource: "MPAC",
    };
    expect(rowValue(p, "building", "Construction")).toBe("Brick · Stone");
    expect(rowValue(p, "building", "Foundation")).toBe("Concrete");
    expect(rowValue(p, "building", "Roof")).toBe("Shingles");
    expect(rowValue(p, "building", "New Construction")).toBe("Yes");
    // boolean false → row omitted (only-true policy)
    expect(rowValue(p, "building", "Attached")).toBeUndefined();
    expect(rowValue(p, "building", "Approx. Square Footage")).toBe("2000-2500");
    expect(rowValue(p, "building", "Sqft Source")).toBe("MPAC");
  });

  it("interior", () => {
    const p: RawPayload = {
      InteriorFeatures: ["Built-In Oven", "Central Vacuum"],
      FireplaceYN: true,
      FireplaceFeatures: ["Natural Gas"],
      CentralVacuumYN: true,
      EnsuiteLaundryYN: true,
      LaundryFeatures: ["Ensuite"],
      DenFamilyroomYN: true,
      ElevatorYN: true,
      Furnished: "Unfurnished",
      AccessibilityFeatures: ["Ramped Entrance"],
      SeniorCommunityYN: true,
    };
    expect(rowValue(p, "interior", "Interior Features")).toBe("Built-In Oven · Central Vacuum");
    expect(rowValue(p, "interior", "Fireplace")).toBe("Natural Gas");
    expect(rowValue(p, "interior", "Central Vacuum")).toBe("Yes");
    expect(rowValue(p, "interior", "Family Room")).toBe("Yes");
    expect(rowValue(p, "interior", "Furnished")).toBe("Unfurnished");
    // FireplaceYN true with no features still shows "Yes"
    expect(rowValue({ FireplaceYN: true }, "interior", "Fireplace")).toBe("Yes");
  });

  it("exterior, lot & land", () => {
    const p: RawPayload = {
      ExteriorFeatures: ["Awnings", "Patio"],
      LotShape: "Pie",
      LotIrregularities: "Widens at rear",
      LotFeatures: ["Cul de Sac/Dead End"],
      LotSizeRangeAcres: "< .50",
      PoolFeatures: ["Inground"],
      SpaYN: true,
      View: ["Pond"],
      WaterfrontYN: true,
      Waterfront: ["Direct"],
      WaterBodyName: "Lake Simcoe",
      Topography: ["Flat"],
      OtherStructures: ["Garden Shed"],
      GarageType: "Attached",
      CoveredSpaces: 2,
      ParkingSpaces: 4,
      ParkingFeatures: ["Private Double"],
    };
    expect(rowValue(p, "exterior", "Exterior Features")).toBe("Awnings · Patio");
    expect(rowValue(p, "exterior", "Lot Shape")).toBe("Pie");
    expect(rowValue(p, "exterior", "Pool")).toBe("Inground");
    expect(rowValue(p, "exterior", "Waterfront")).toBe("Direct");
    expect(rowValue(p, "exterior", "Body of Water")).toBe("Lake Simcoe");
    expect(rowValue(p, "exterior", "Garage Type")).toBe("Attached");
    expect(rowValue(p, "exterior", "Garage Spaces")).toBe("2");
    expect(rowValue(p, "exterior", "Drive Parking")).toBe("4");
  });

  it("condo group renders for condo-class subtypes only", () => {
    expect(rowValue(CONDO, "condo", "Building Amenities")).toBe("Gym · Concierge · Visitor Parking");
    expect(rowValue(CONDO, "condo", "Balcony")).toBe("Open");
    expect(rowValue(CONDO, "condo", "Exposure")).toBe("Se");
    expect(rowValue(CONDO, "condo", "Locker")).toBe("Owned · Level B · Unit 27");
    expect(rowValue(CONDO, "condo", "Pets")).toBe("Restricted");
    expect(rowValue(CONDO, "condo", "Fee Includes")).toBe("Heat Included · Water Included");
    expect(rowValue(CONDO, "condo", "Condo Corp #")).toBe("1234");
    expect(rowValue(CONDO, "condo", "Level")).toBe("12");
    // Detached payload with condo fields present → condo group still suppressed
    const detachedWithNoise: RawPayload = { ...CONDO, PropertySubType: "Detached" };
    expect(rows(detachedWithNoise, "condo")).toEqual([]);
  });

  it("utilities & systems", () => {
    const p: RawPayload = {
      WaterSource: ["Municipal"],
      Sewer: ["Sewer"],
      ElectricYNA: "Available",
      CableYNA: "Available",
      GasYNA: "Available",
      AlternativePower: ["Solar"],
      Amps: 200,
      Volts: 240,
      RuralUtilities: ["Internet High Speed"],
      SecurityFeatures: ["Alarm System"],
    };
    expect(rowValue(p, "utilities", "Water")).toBe("Municipal");
    expect(rowValue(p, "utilities", "Sewer")).toBe("Sewer");
    expect(rowValue(p, "utilities", "Hydro")).toBe("Available");
    expect(rowValue(p, "utilities", "Amps")).toBe("200");
    expect(rowValue(p, "utilities", "Volts")).toBe("240");
    // VOW-only scalar fallback: Water string when WaterSource array missing
    expect(rowValue({ Water: "Municipal" }, "utilities", "Water")).toBe("Municipal");
  });

  it("taxes & assessment", () => {
    const p: RawPayload = {
      TaxAnnualAmount: 8456.34,
      TaxYear: 2024,
      TaxAssessedValue: 910000,
      AssessmentYear: 2024,
      TaxType: "Annual",
      RollNumber: "211012000123400",
      TaxLegalDescription: "LOT 12, PLAN 43M-1234",
      AdditionalMonthlyFee: 120,
      AdditionalMonthlyFeeFrequency: "Monthly",
    };
    expect(rowValue(p, "taxes", "Annual Taxes")).toMatch(/8,456/);
    expect(rowValue(p, "taxes", "Annual Taxes")).toContain("(2024)");
    expect(rowValue(p, "taxes", "Assessed Value")).toMatch(/910,000/);
    expect(rowValue(p, "taxes", "Assessed Value")).toContain("(2024)");
    expect(rowValue(p, "taxes", "Assessment Roll #")).toBe("211012000123400");
    expect(rowValue(p, "taxes", "Legal Description")).toBe("LOT 12, PLAN 43M-1234");
    expect(rowValue(p, "taxes", "POTL Monthly Fee")).toMatch(/120.*Monthly/);
  });

  it("transaction & possession (incl. virtual tour link rows)", () => {
    const p: RawPayload = {
      PossessionType: "Flexible",
      PossessionDetails: "TBA 30-60 days",
      OccupantType: "Tenant",
      HSTApplication: ["Included"],
      ChattelsYN: true,
      VirtualTourURLUnbranded: "https://tour.example.com/abc",
    };
    expect(rowValue(p, "transaction", "Possession")).toBe("Flexible");
    expect(rowValue(p, "transaction", "Possession Notes")).toBe("TBA 30-60 days");
    expect(rowValue(p, "transaction", "Occupancy")).toBe("Tenant");
    expect(rowValue(p, "transaction", "Chattels Included")).toBe("Yes");
    const tour = rows(p, "transaction").find((r) => r.label === "Virtual Tour");
    expect(tour?.href).toBe("https://tour.example.com/abc");
    expect(tour?.value).toBe("View tour");
    // Non-http(s) URL → link suppressed entirely
    expect(rows({ VirtualTourURLUnbranded: "javascript:alert(1)" }, "transaction")).toEqual([]);
  });

  it("risk & disclosures with flag semantics", () => {
    const risky: RawPayload = {
      UFFI: "Yes",
      Disclosures: ["Easement", "Right Of Way"],
      LocalImprovements: true,
      LocalImprovementsComments: "Road paving levy until 2027",
      SpecialDesignation: ["Heritage"],
      SeasonalDwelling: true,
    };
    const r = rows(risky, "risk");
    expect(r.find((x) => x.label === "UFFI")).toMatchObject({ value: "Yes", flagged: true });
    expect(r.find((x) => x.label === "Easements / Restrictions")).toMatchObject({
      value: "Easement · Right Of Way",
      flagged: true,
    });
    expect(r.find((x) => x.label === "Local Improvements")).toMatchObject({ value: "Yes", flagged: true });
    expect(r.find((x) => x.label === "Local Improvements Notes")).toMatchObject({
      value: "Road paving levy until 2027",
    });
    expect(r.find((x) => x.label === "Special Designation")).toMatchObject({ flagged: true });
    // Benign values render unflagged ("None" is useful affirmative absence)
    const benign: RawPayload = { UFFI: "No", Disclosures: ["None"], SpecialDesignation: ["Unknown"] };
    const b = rows(benign, "risk");
    expect(b.find((x) => x.label === "UFFI")).toMatchObject({ value: "No", flagged: false });
    expect(b.find((x) => x.label === "Easements / Restrictions")).toMatchObject({ flagged: false });
    expect(b.find((x) => x.label === "Special Designation")).toMatchObject({ flagged: false });
  });
});

describe("buildDatasheet — policy & ordering", () => {
  it("never renders excluded VOW-sold or broker-workflow fields", () => {
    const hostile: RawPayload = {
      ...DETACHED,
      ClosePrice: 999999,
      CloseDate: "2026-01-01",
      ClosePriceHold: 999999,
      PurchaseContractDate: "2026-01-01",
      SoldEntryTimestamp: "2026-01-01T00:00:00Z",
      ShowingRequirements: ["Lockbox"],
      ShowingAppointments: "Call LBO",
      PrivateRemarks: "seller motivated",
      ExpirationDate: "2026-09-01",
      HoldoverDays: 90,
    };
    const allText = JSON.stringify(buildDatasheet(hostile));
    expect(allText).not.toContain("999999");
    expect(allText).not.toContain("999,999");
    expect(allText).not.toContain("Lockbox");
    expect(allText).not.toContain("seller motivated");
    expect(allText).not.toContain("Call LBO");
  });

  it("order param puts requested groups first (append-remainder)", () => {
    const p: RawPayload = { ...DETACHED, TaxAnnualAmount: 5000 };
    const reordered = buildDatasheet(p, ["taxes", "vitals"]);
    expect(reordered.map((g) => g.group.id)).toEqual(["taxes", "vitals"]);
    const defaultIds = buildDatasheet(p).map((g) => g.group.id);
    expect(defaultIds).toEqual(["vitals", "taxes"]);
  });
});
