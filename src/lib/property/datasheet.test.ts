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
    // count > 1 prefixes the features
    expect(
      rowValue({ FireplacesTotal: 2, FireplaceFeatures: ["Natural Gas"] }, "interior", "Fireplace"),
    ).toBe("2 · Natural Gas");
    // FireplaceYN true + count > 1 → count alone
    expect(rowValue({ FireplaceYN: true, FireplacesTotal: 2 }, "interior", "Fireplace")).toBe("2");
    // count alone (no features, no YN) still renders the row
    expect(rowValue({ FireplacesTotal: 2 }, "interior", "Fireplace")).toBe("2");
    // features win even when FireplaceYN is explicitly false
    expect(
      rowValue({ FireplaceFeatures: ["Wood"], FireplaceYN: false }, "interior", "Fireplace"),
    ).toBe("Wood");
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
    // Bare scheme with no host → dead link suppressed entirely
    expect(rows({ VirtualTourURLUnbranded: "https://" }, "transaction")).toEqual([]);
    // Branded tour renders its own labelled link row
    const branded = rows({ VirtualTourURLBranded: "https://tour.example.com/b" }, "transaction");
    const brandedRow = branded.find((r) => r.label === "Virtual Tour (branded)");
    expect(brandedRow?.value).toBe("View tour");
    expect(brandedRow?.href).toBe("https://tour.example.com/b");
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
    // "Unknown" asserts nothing — suppressed entirely (tranche 2), unlike "None"
    expect(b.find((x) => x.label === "Special Designation")).toBeUndefined();
    // Mixed array: ANY concerning member flags the row (.some semantics)
    const mixed = rows({ Disclosures: ["None", "Easement"] }, "risk");
    expect(mixed.find((x) => x.label === "Easements / Restrictions")).toMatchObject({
      value: "None · Easement",
      flagged: true,
    });
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
    // Sold/expiry dates are as compliance-sensitive as sold prices
    expect(allText).not.toContain("2026-01-01");
    expect(allText).not.toContain("2026-09-01");
  });

  it("order param puts requested groups first (append-remainder)", () => {
    const p: RawPayload = { ...DETACHED, TaxAnnualAmount: 5000 };
    const reordered = buildDatasheet(p, ["taxes", "vitals"]);
    expect(reordered.map((g) => g.group.id)).toEqual(["taxes", "vitals"]);
    const defaultIds = buildDatasheet(p).map((g) => g.group.id);
    expect(defaultIds).toEqual(["vitals", "taxes"]);
  });
});

describe("buildDatasheet — tranche 2", () => {
  it("washroom breakdown from WashroomsTypeN composites", () => {
    const p: RawPayload = {
      WashroomsType1: 2,
      WashroomsType1Pcs: 4,
      WashroomsType1Level: "Second",
      WashroomsType2: 1,
      WashroomsType2Pcs: 2,
      WashroomsType2Level: "Main",
      WashroomsType3: 0, // zero-count slot omitted
      WashroomsType3Pcs: 3,
    };
    expect(rowValue(p, "vitals", "Washrooms")).toBe("2 × 4-pc (Second) · 1 × 2-pc (Main)");
    // count without pieces still renders; level optional
    expect(rowValue({ WashroomsType1: 1 }, "vitals", "Washrooms")).toBe("1");
    expect(rowValue({}, "vitals", "Washrooms")).toBeUndefined();
  });

  it("cross street and area influences (deduped union)", () => {
    const p: RawPayload = {
      CrossStreet: "Mavis Rd & Eglinton Ave",
      CommunityFeatures: ["Park", "Public Transit"],
      PropertyFeatures: ["Park", "School", "Ravine"],
    };
    expect(rowValue(p, "vitals", "Cross Street")).toBe("Mavis Rd & Eglinton Ave");
    expect(rowValue(p, "exterior", "Area Influences")).toBe("Park · Public Transit · School · Ravine");
    // either source alone works
    expect(rowValue({ PropertyFeatures: ["Fenced Yard"] }, "exterior", "Area Influences")).toBe("Fenced Yard");
  });

  it("builder fields: zoning fallback, PIN, development charges, survey composite", () => {
    const p: RawPayload = {
      ZoningDesignation: "R4-21",
      ParcelNumber: "134250123",
      DevelopmentChargesPaid: ["Yes"],
      SurveyAvailableYN: true,
      SurveyType: "Boundary Only",
    };
    expect(rowValue(p, "exterior", "Zoning")).toBe("R4-21");
    expect(rowValue({ Zoning: "C2" }, "exterior", "Zoning")).toBe("C2");
    expect(rowValue(p, "taxes", "PIN #")).toBe("134250123");
    expect(rowValue(p, "taxes", "Development Charges Paid")).toBe("Yes");
    expect(rowValue(p, "transaction", "Survey")).toBe("Yes · Boundary Only");
    expect(rowValue({ SurveyType: "Up-to-Date" }, "transaction", "Survey")).toBe("Up-to-Date");
    expect(rowValue({ SurveyAvailableYN: true }, "transaction", "Survey")).toBe("Yes");
  });

  it("carrying-cost gotchas land flagged in the risk group", () => {
    const p: RawPayload = {
      UnderContract: ["Hot Water Tank"],
      LeaseToOwnEquipment: ["Furnace"],
      RentalItems: "HWT rental $35/mo",
    };
    const r = rows(p, "risk");
    expect(r.find((x) => x.label === "Items Under Contract")).toMatchObject({
      value: "Hot Water Tank",
      flagged: true,
    });
    expect(r.find((x) => x.label === "Lease-To-Own Equipment")).toMatchObject({
      value: "Furnace",
      flagged: true,
    });
    expect(r.find((x) => x.label === "Rental Items")).toMatchObject({
      value: "HWT rental $35/mo",
      flagged: true,
    });
    // "None" renders unflagged (affirmative absence)
    const none = rows({ UnderContract: ["None"] }, "risk");
    expect(none.find((x) => x.label === "Items Under Contract")).toMatchObject({
      value: "None",
      flagged: false,
    });
  });

  it("suppresses Unknown-only disclosure values (noise, not information)", () => {
    expect(rows({ SpecialDesignation: ["Unknown"] }, "risk")).toEqual([]);
    expect(rows({ Disclosures: ["Unknown"] }, "risk")).toEqual([]);
    // Unknown alongside a real value: real value survives, row flagged
    const mixed = rows({ SpecialDesignation: ["Unknown", "Heritage"] }, "risk");
    expect(mixed.find((x) => x.label === "Special Designation")).toMatchObject({
      value: "Heritage",
      flagged: true,
    });
    // "None" is still informative and still renders
    expect(rows({ Disclosures: ["None"] }, "risk").length).toBe(1);
  });

  it("lease group renders for lease transactions only", () => {
    const lease: RawPayload = {
      TransactionType: "For Lease",
      RentIncludes: ["Heat", "Water"],
      LeaseTerm: "12 Months",
      MinimumRentalTermMonths: 12,
      MaximumRentalMonthsTerm: 24,
      DepositRequired: true,
      RentalApplicationYN: true,
      CreditCheckYN: true,
      ReferencesRequiredYN: true,
      EmploymentLetterYN: true,
      PortionPropertyLease: ["Basement"],
      PortionLeaseComments: "Lower level only",
      PrivateEntranceYN: true,
    };
    expect(rowValue(lease, "lease", "Included in Rent")).toBe("Heat · Water");
    expect(rowValue(lease, "lease", "Lease Term")).toBe("12 Months");
    expect(rowValue(lease, "lease", "Min. Term (months)")).toBe("12");
    expect(rowValue(lease, "lease", "Max. Term (months)")).toBe("24");
    expect(rowValue(lease, "lease", "Deposit Required")).toBe("Yes");
    expect(rowValue(lease, "lease", "Application Required")).toBe("Yes");
    expect(rowValue(lease, "lease", "Credit Check")).toBe("Yes");
    expect(rowValue(lease, "lease", "References Required")).toBe("Yes");
    expect(rowValue(lease, "lease", "Employment Letter")).toBe("Yes");
    expect(rowValue(lease, "lease", "Portion for Lease")).toBe("Basement");
    expect(rowValue(lease, "lease", "Portion Notes")).toBe("Lower level only");
    expect(rowValue(lease, "lease", "Private Entrance")).toBe("Yes");
    // For Sale payload with lease fields present → group suppressed
    const sale: RawPayload = { ...lease, TransactionType: "For Sale" };
    expect(rows(sale, "lease")).toEqual([]);
  });

  it("waterfront extras", () => {
    const p: RawPayload = {
      WaterFrontageFt: "30.5",
      Shoreline: ["Sandy", "Shallow"],
      ShorelineAllowance: "Owned",
      AccessToProperty: ["Year Round Municipal Road"],
      Winterized: "Fully",
      IslandYN: true,
    };
    expect(rowValue(p, "exterior", "Water Frontage (m)")).toBe("30.5");
    expect(rowValue(p, "exterior", "Shoreline")).toBe("Sandy · Shallow");
    expect(rowValue(p, "exterior", "Shoreline Allowance")).toBe("Owned");
    expect(rowValue(p, "exterior", "Access")).toBe("Year Round Municipal Road");
    expect(rowValue(p, "exterior", "Winterized")).toBe("Fully");
    expect(rowValue(p, "exterior", "Island")).toBe("Yes");
  });

  it("VOW-payload extras (sold pages): inclusions/exclusions, assignment, SPIS", () => {
    const p: RawPayload = {
      Inclusions: "Fridge, stove, washer",
      Exclusions: "Dining chandelier",
      AssignmentYN: true,
      FractionalOwnershipYN: true,
      VendorPropertyInfoStatement: true,
    };
    expect(rowValue(p, "transaction", "Inclusions")).toBe("Fridge, stove, washer");
    expect(rowValue(p, "transaction", "Exclusions")).toBe("Dining chandelier");
    expect(rowValue(p, "transaction", "Assignment")).toBe("Yes");
    expect(rowValue(p, "transaction", "Fractional Ownership")).toBe("Yes");
    expect(rowValue(p, "transaction", "Seller Property Info Statement")).toBe("Yes");
  });
});

// ── Commercial groups (commercial-gap Phase 1) ──

/** Industrial-condo payload shaped like live PROPTX data (W-prefix archetype, 2026-07-03). */
const INDUSTRIAL: RawPayload = {
  PropertyType: "Commercial",
  PropertySubType: "Industrial",
  PropertyUse: "Industrial Condo",
  BuildingAreaTotal: 3500,
  BuildingAreaUnits: "Square Feet",
  OfficeApartmentArea: 100,
  OfficeApartmentAreaUnit: "%",
  ClearHeightFeet: 12,
  ClearHeightInches: 0,
  GradeLevelShippingDoors: 0,
  TruckLevelShippingDoors: 2,
  DriveInLevelShippingDoors: 1,
  DoubleManShippingDoors: 0,
  FreestandingYN: false,
  Rail: "No",
  CommercialCondoFee: 1200,
};

describe("buildDatasheet — commercial groups", () => {
  it("gates both commercial groups to the Commercial PropertyType class", () => {
    const ids = buildDatasheet(INDUSTRIAL).map((g) => g.group.id);
    expect(ids).toContain("commercial");
    expect(ids).toContain("commercialFinancials");
    // Residential payload never grows commercial groups, even with stray fields
    const res = buildDatasheet({ ...DETACHED, ClearHeightFeet: 12, CommercialCondoFee: 900 });
    expect(res.map((g) => g.group.id)).not.toContain("commercial");
    expect(res.map((g) => g.group.id)).not.toContain("commercialFinancials");
  });

  it("renders area rows with their verbatim unit codes (sqft and percent)", () => {
    expect(rowValue(INDUSTRIAL, "commercial", "Total Area")).toBe("3,500 Square Feet");
    expect(rowValue(INDUSTRIAL, "commercial", "Office / Apt Area")).toBe("100%");
    expect(
      rowValue(
        { ...INDUSTRIAL, RetailArea: 395, RetailAreaCode: "Sq Ft" },
        "commercial",
        "Retail Area"
      )
    ).toBe("395 Sq Ft");
    // Zero/absent areas self-omit
    expect(rowValue(INDUSTRIAL, "commercial", "Industrial Area")).toBeUndefined();
  });

  it("clear height renders feet with optional inches; zero suppressed", () => {
    expect(rowValue(INDUSTRIAL, "commercial", "Clear Height")).toBe("12 ft");
    expect(
      rowValue({ ...INDUSTRIAL, ClearHeightInches: 6 }, "commercial", "Clear Height")
    ).toBe("12 ft 6 in");
    expect(
      rowValue({ ...INDUSTRIAL, ClearHeightFeet: 0 }, "commercial", "Clear Height")
    ).toBeUndefined();
  });

  it("shipping doors composite lists only >0 door types; all-zero omits the row", () => {
    expect(rowValue(INDUSTRIAL, "commercial", "Shipping Doors")).toBe(
      "2 truck-level · 1 drive-in"
    );
    expect(
      rowValue(
        { ...INDUSTRIAL, TruckLevelShippingDoors: 0, DriveInLevelShippingDoors: 0 },
        "commercial",
        "Shipping Doors"
      )
    ).toBeUndefined();
  });

  it("business rows render for a Sale Of Business payload", () => {
    const biz: RawPayload = {
      PropertyType: "Commercial",
      PropertySubType: "Sale Of Business",
      BusinessType: ["Restaurant"],
      SeatingCapacity: 46,
      NumberOfFullTimeEmployees: 5,
      HoursDaysOfOperationDescription: "11-21",
      FranchiseYN: false,
      ChattelsYN: true,
    };
    expect(rowValue(biz, "commercial", "Business Type")).toBe("Restaurant");
    expect(rowValue(biz, "commercial", "Seating Capacity")).toBe("46");
    expect(rowValue(biz, "commercial", "Full-Time Employees")).toBe("5");
    expect(rowValue(biz, "commercial", "Hours of Operation")).toBe("11-21");
    // FranchiseYN=false → only-true policy omits the row
    expect(rowValue(biz, "commercial", "Franchise")).toBeUndefined();
  });

  it("commercial financials render money rows and the verbatim TMI field", () => {
    expect(rowValue(INDUSTRIAL, "commercialFinancials", "Commercial Condo Fee")).toBe("$1,200");
    const withFin: RawPayload = { ...INDUSTRIAL, GrossRevenue: 250000, TMI: "$4.50" };
    expect(rowValue(withFin, "commercialFinancials", "Gross Revenue")).toBe("$250,000");
    expect(rowValue(withFin, "commercialFinancials", "TMI")).toBe("$4.50");
  });

  it("Rail renders verbatim (a 'No' is informative on industrial)", () => {
    expect(rowValue(INDUSTRIAL, "commercial", "Rail")).toBe("No");
  });
});
