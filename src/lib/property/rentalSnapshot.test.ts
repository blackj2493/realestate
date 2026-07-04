import { describe, it, expect } from "vitest";
import { buildRentalSnapshot, buildRentalGlance, petsFromRemarks } from "./rentalSnapshot";

/**
 * The Rental Snapshot replaces the buy-and-hold Underwriting Sandbox on lease
 * listings, where ListPrice is the monthly rent (the bug: a $2,700 rent became a
 * $2,700 "purchase" → 516% cap rate). These tests pin the lease economics and the
 * "never fabricate a denominator" rule for rent-$/sqft.
 */
describe("buildRentalSnapshot", () => {
  it("annualizes the monthly rent", () => {
    const s = buildRentalSnapshot({ monthlyRent: 2700 });
    expect(s.monthlyRent).toBe(2700);
    expect(s.annualRent).toBe(32400);
  });

  it("computes exact rent/sqft from a concrete BuildingAreaTotal", () => {
    const s = buildRentalSnapshot({ monthlyRent: 2700, buildingAreaTotal: 900 });
    expect(s.rentPerSqft).toEqual({ kind: "exact", low: 3, high: 3 });
  });

  it("computes a rent/sqft RANGE from a banded LivingAreaRange (smaller area → higher rate)", () => {
    const s = buildRentalSnapshot({ monthlyRent: 2700, livingAreaRange: "700-899" });
    // high uses the smaller area (700), low uses the larger (899)
    expect(s.rentPerSqft).toEqual({ kind: "range", low: 3, high: 3.86 });
  });

  it("prefers the concrete area over the banded range when both exist", () => {
    const s = buildRentalSnapshot({
      monthlyRent: 2700,
      buildingAreaTotal: 900,
      livingAreaRange: "700-899",
    });
    expect(s.rentPerSqft).toEqual({ kind: "exact", low: 3, high: 3 });
  });

  it("treats a degenerate band like '0-499' as a single positive bound (no divide-by-zero)", () => {
    const s = buildRentalSnapshot({ monthlyRent: 2700, livingAreaRange: "0-499" });
    expect(s.rentPerSqft).toEqual({ kind: "exact", low: 5.41, high: 5.41 });
  });

  it("strips commas from area strings", () => {
    const s = buildRentalSnapshot({ monthlyRent: 3000, livingAreaRange: "1,200" });
    expect(s.rentPerSqft).toEqual({ kind: "exact", low: 2.5, high: 2.5 });
  });

  it("omits rent/sqft (never guesses) when no area is known", () => {
    expect(buildRentalSnapshot({ monthlyRent: 2700 }).rentPerSqft).toBeNull();
    expect(buildRentalSnapshot({ monthlyRent: 2700, livingAreaRange: "" }).rentPerSqft).toBeNull();
    expect(buildRentalSnapshot({ monthlyRent: 2700, livingAreaRange: "N/A" }).rentPerSqft).toBeNull();
  });

  it("omits rent/sqft when rent is non-positive", () => {
    expect(buildRentalSnapshot({ monthlyRent: 0, buildingAreaTotal: 900 }).rentPerSqft).toBeNull();
  });

  it("normalizes lease term and included-in-rent, and passes through deposit", () => {
    const s = buildRentalSnapshot({
      monthlyRent: 2700,
      leaseTerm: "  12 Months  ",
      depositRequired: true,
      rentIncludes: ["Building Insurance", "  ", "Parking"],
    });
    expect(s.leaseTerm).toBe("12 Months");
    expect(s.depositRequired).toBe(true);
    expect(s.rentIncludes).toEqual(["Building Insurance", "Parking"]);
  });

  it("guards against non-finite or missing fields", () => {
    const s = buildRentalSnapshot({ monthlyRent: Number.NaN, leaseTerm: "   " });
    expect(s.monthlyRent).toBe(0);
    expect(s.annualRent).toBe(0);
    expect(s.leaseTerm).toBeNull();
    expect(s.depositRequired).toBeNull();
    expect(s.rentIncludes).toEqual([]);
  });

  // ── tenant affordability guidelines ──

  it("estimates move-in as first + last month (2× rent) and income at the 30% screen", () => {
    const s = buildRentalSnapshot({ monthlyRent: 2700 });
    expect(s.moveInEstimate).toBe(5400); // 2 × 2700
    expect(s.incomeToQualify).toBe(108000); // 32400 / 0.30
  });

  it("zeroes the guidelines when rent is unknown (never fabricates a number)", () => {
    const s = buildRentalSnapshot({ monthlyRent: Number.NaN });
    expect(s.moveInEstimate).toBe(0);
    expect(s.incomeToQualify).toBe(0);
  });

  it("lists core utilities NOT included as the tenant's extra cost", () => {
    const s = buildRentalSnapshot({ monthlyRent: 2700, rentIncludes: ["Heat", "Water"] });
    expect(s.utilitiesExtra).toEqual(["Hydro"]); // heat+water covered → hydro remains
  });

  it("treats 'Electricity' as covering Hydro", () => {
    const s = buildRentalSnapshot({ monthlyRent: 2700, rentIncludes: ["Heat", "Water", "Electricity"] });
    expect(s.utilitiesExtra).toEqual([]);
  });

  it("does not assert extra utilities when nothing is listed as included (no signal)", () => {
    expect(buildRentalSnapshot({ monthlyRent: 2700 }).utilitiesExtra).toEqual([]);
    expect(buildRentalSnapshot({ monthlyRent: 2700, rentIncludes: [] }).utilitiesExtra).toEqual([]);
  });

  it("treats an all-inclusive listing as no extra utilities", () => {
    const s = buildRentalSnapshot({ monthlyRent: 2700, rentIncludes: ["All Inclusive"] });
    expect(s.utilitiesExtra).toEqual([]);
  });
});

describe("buildRentalGlance", () => {
  it("surfaces pets from any lease (array-joined), independent of property type", () => {
    expect(buildRentalGlance({ PetsAllowed: ["Restricted"] }).pets).toBe("Restricted");
    expect(buildRentalGlance({ PetsAllowed: "Yes" }).pets).toBe("Yes");
    expect(buildRentalGlance({}).pets).toBeNull();
  });

  it("falls back to the description for pets when PetsAllowed is empty; structured wins", () => {
    expect(buildRentalGlance({ PublicRemarks: "Bright unit. Pet friendly!" }).pets).toBe("Yes");
    expect(buildRentalGlance({ PublicRemarks: "Sorry, no pets." }).pets).toBe("No");
    // Structured field takes precedence over the remarks inference.
    expect(buildRentalGlance({ PetsAllowed: ["Yes"], PublicRemarks: "no pets" }).pets).toBe("Yes");
  });

  describe("petsFromRemarks (description fallback)", () => {
    it("classifies clear positive / negative / conditional phrasings", () => {
      expect(petsFromRemarks("Pet friendly building")).toBe("Yes");
      expect(petsFromRemarks("Pets welcome")).toBe("Yes");
      expect(petsFromRemarks("Cats ok")).toBe("Yes");
      expect(petsFromRemarks("No pets please")).toBe("No");
      expect(petsFromRemarks("Pets are not allowed")).toBe("No");
      expect(petsFromRemarks("Pet-free home")).toBe("No");
      expect(petsFromRemarks("Pets negotiable")).toBe("Negotiable");
      expect(petsFromRemarks("Pets allowed with restrictions")).toBe("Negotiable");
      expect(petsFromRemarks("Small pets only")).toBe("Negotiable");
      expect(petsFromRemarks("Pets on approval")).toBe("Negotiable");
    });

    it("reads negated 'allowed' / 'friendly' as No, not a mixed Negotiable", () => {
      // "allowed" / "friendly" negated by a leading no/not must not read as positive.
      expect(petsFromRemarks("No pets allowed")).toBe("No");
      expect(petsFromRemarks("No smoking and no pets permitted")).toBe("No");
      expect(petsFromRemarks("Not pet friendly")).toBe("No");
      expect(petsFromRemarks("*Two Car Garage* No Smokers - No Pets Please")).toBe("No");
    });

    it("degrades genuinely conflicting yes+no signals to Negotiable", () => {
      expect(petsFromRemarks("Cats ok, no dogs")).toBe("Negotiable");
    });

    it("does not trigger on 'pet' inside another word, or when pets aren't mentioned", () => {
      expect(petsFromRemarks("New carpet and fresh paint throughout")).toBeNull();
      expect(petsFromRemarks("Spacious 3-bedroom with parking")).toBeNull();
      expect(petsFromRemarks("")).toBeNull();
      expect(petsFromRemarks(null)).toBeNull();
      expect(petsFromRemarks(undefined)).toBeNull();
    });
  });

  it("surfaces which portion of the property is for lease (array-joined)", () => {
    expect(buildRentalGlance({ PortionPropertyLease: ["Basement"] }).portion).toBe("Basement");
    expect(buildRentalGlance({ PortionPropertyLease: ["Entire Property"] }).portion).toBe("Entire Property");
    expect(buildRentalGlance({}).portion).toBeNull();
  });

  it("reads furnished, in-suite laundry, and parking", () => {
    const g = buildRentalGlance({ Furnished: "Furnished", EnsuiteLaundryYN: true, ParkingTotal: 1 });
    expect(g.furnished).toBe("Furnished");
    expect(g.laundry).toBe("In-suite");
    expect(g.parking).toBe(1);
  });

  it("falls back to LaundryFeatures when not ensuite, and CoveredSpaces for parking", () => {
    const g = buildRentalGlance({ LaundryFeatures: ["Coin Operated"], CoveredSpaces: 2 });
    expect(g.laundry).toBe("Coin Operated");
    expect(g.parking).toBe(2);
  });

  it("combines payment frequency and method, else either alone, else null", () => {
    expect(buildRentalGlance({ PaymentFrequency: "Monthly", PaymentMethod: "Cheque" }).payment).toBe("Monthly · Cheque");
    expect(buildRentalGlance({ PaymentFrequency: "Monthly" }).payment).toBe("Monthly");
    expect(buildRentalGlance({}).payment).toBeNull();
  });

  it("flags a private entrance only when strictly true", () => {
    expect(buildRentalGlance({ PrivateEntranceYN: true }).privateEntrance).toBe(true);
    expect(buildRentalGlance({ PrivateEntranceYN: false }).privateEntrance).toBe(false);
    expect(buildRentalGlance({}).privateEntrance).toBe(false);
  });

  it("lists the tenant's application requirements from the YN flags", () => {
    const g = buildRentalGlance({
      RentalApplicationYN: true,
      CreditCheckYN: true,
      ReferencesRequiredYN: false,
      EmploymentLetterYN: true,
    });
    expect(g.applyRequirements).toEqual(["Application", "Credit check", "Employment letter"]);
    expect(buildRentalGlance({}).applyRequirements).toEqual([]);
  });

  it("formats an ISO possession date, else passes possession type/notes through", () => {
    expect(buildRentalGlance({ PossessionDate: "2026-08-01" }).available).toBe("Aug 1, 2026");
    expect(buildRentalGlance({ PossessionType: "Immediate" }).available).toBe("Immediate");
    expect(buildRentalGlance({}).available).toBeNull();
  });

  it("returns all-empty on an empty payload (component renders nothing)", () => {
    expect(buildRentalGlance({})).toEqual({
      pets: null,
      portion: null,
      furnished: null,
      laundry: null,
      available: null,
      parking: null,
      payment: null,
      privateEntrance: false,
      applyRequirements: [],
    });
  });
});

// ── Commercial lease economics (commercial-gap Phase 1) ──
import { buildCommercialLeaseSnapshot, classifyLeaseBasis } from "./rentalSnapshot";

describe("classifyLeaseBasis", () => {
  it("maps TRREB ListPriceUnit spellings to a basis", () => {
    expect(classifyLeaseBasis("Month")).toBe("month");
    expect(classifyLeaseBasis("Per Sq Ft")).toBe("psf-year");
    expect(classifyLeaseBasis("Sq Ft Net")).toBe("psf-year");
    expect(classifyLeaseBasis("Sq Ft Gross")).toBe("psf-year");
    expect(classifyLeaseBasis("Year")).toBe("year");
    expect(classifyLeaseBasis("Per Square Foot")).toBe("psf-year");
    expect(classifyLeaseBasis("For Sale")).toBe("unknown");
    expect(classifyLeaseBasis(undefined)).toBe("unknown");
    expect(classifyLeaseBasis("")).toBe("unknown");
  });

  it("gross/net lease name the inclusions, not the period — must stay unknown", () => {
    // "Gross Lease" / "Net Lease" say WHAT the rent covers, not whether the figure
    // is monthly or annual — deriving either way risks a 12× fabrication.
    expect(classifyLeaseBasis("Gross Lease")).toBe("unknown");
    expect(classifyLeaseBasis("Net Lease")).toBe("unknown");
    expect(classifyLeaseBasis("Plus Stock")).toBe("unknown");
  });
});

describe("buildCommercialLeaseSnapshot", () => {
  it("month basis: monthly verbatim, annual ×12, psf/yr derived from area", () => {
    const s = buildCommercialLeaseSnapshot({
      listPrice: 1900,
      listPriceUnit: "Month",
      buildingAreaTotal: 650,
    });
    expect(s.basis).toBe("month");
    expect(s.monthlyRent).toBe(1900);
    expect(s.annualRent).toBe(22800);
    expect(s.perSqftYear).toBe(35.08);
  });

  it("psf-year basis: rate verbatim, totals derived from area", () => {
    const s = buildCommercialLeaseSnapshot({
      listPrice: 22,
      listPriceUnit: "Per Sq Ft",
      buildingAreaTotal: 3500,
    });
    expect(s.basis).toBe("psf-year");
    expect(s.perSqftYear).toBe(22);
    expect(s.annualRent).toBe(77000);
    expect(s.monthlyRent).toBe(Math.round(77000 / 12));
  });

  it("never fabricates a denominator: psf basis with no area derives no totals", () => {
    const s = buildCommercialLeaseSnapshot({ listPrice: 22, listPriceUnit: "Per Sq Ft" });
    expect(s.perSqftYear).toBe(22);
    expect(s.annualRent).toBeNull();
    expect(s.monthlyRent).toBeNull();
  });

  it("$0/$1 placeholder asks derive nothing regardless of basis (feature-sweep find)", () => {
    // Live case: a $1/sqft/yr industrial lease derived a real-looking "$52,970/mo".
    for (const listPrice of [0, 1]) {
      const s = buildCommercialLeaseSnapshot({
        listPrice,
        listPriceUnit: "Per Sq Ft",
        buildingAreaTotal: 46242,
      });
      expect(s.monthlyRent, `price=${listPrice}`).toBeNull();
      expect(s.annualRent, `price=${listPrice}`).toBeNull();
      expect(s.perSqftYear, `price=${listPrice}`).toBeNull();
      expect(s.areaSqft).toBe(46242); // area itself is still real data
    }
  });

  it("unknown basis derives nothing", () => {
    const s = buildCommercialLeaseSnapshot({
      listPrice: 4000,
      listPriceUnit: "Gross Lease",
      buildingAreaTotal: 1200,
    });
    expect(s.basis).toBe("unknown");
    expect(s.monthlyRent).toBeNull();
    expect(s.annualRent).toBeNull();
    expect(s.perSqftYear).toBeNull();
  });

  it("TMI: dedicated field verbatim wins; TaxType=TMI pair formats the tax amount", () => {
    expect(buildCommercialLeaseSnapshot({ listPrice: 1, tmi: "$4.50" }).tmiDisplay).toBe("$4.50");
    expect(
      buildCommercialLeaseSnapshot({ listPrice: 1, taxType: "TMI", taxAnnualAmount: 18.4 })
        .tmiDisplay
    ).toBe("$18.40");
    // Ordinary annual taxes are NOT TMI
    expect(
      buildCommercialLeaseSnapshot({ listPrice: 1, taxType: "Annual", taxAnnualAmount: 5000 })
        .tmiDisplay
    ).toBeNull();
  });
});
