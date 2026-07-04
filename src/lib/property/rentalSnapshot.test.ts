import { describe, it, expect } from "vitest";
import { buildRentalSnapshot, buildRentalGlance } from "./rentalSnapshot";

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

  it("reads furnished, in-suite laundry, and parking", () => {
    const g = buildRentalGlance({
      Furnished: "Furnished",
      EnsuiteLaundryYN: true,
      ParkingTotal: 1,
    });
    expect(g.furnished).toBe("Furnished");
    expect(g.laundry).toBe("In-suite");
    expect(g.parking).toBe(1);
  });

  it("falls back to LaundryFeatures when not ensuite, and CoveredSpaces for parking", () => {
    const g = buildRentalGlance({ LaundryFeatures: ["Coin Operated"], CoveredSpaces: 2 });
    expect(g.laundry).toBe("Coin Operated");
    expect(g.parking).toBe(2);
  });

  it("formats an ISO possession date, else passes possession type/notes through", () => {
    expect(buildRentalGlance({ PossessionDate: "2026-08-01" }).available).toBe("Aug 1, 2026");
    expect(buildRentalGlance({ PossessionType: "Immediate" }).available).toBe("Immediate");
    expect(buildRentalGlance({}).available).toBeNull();
  });

  it("surfaces which portion of the property is for lease (array-joined)", () => {
    expect(buildRentalGlance({ PortionPropertyLease: ["Basement"] }).portion).toBe("Basement");
    expect(buildRentalGlance({ PortionPropertyLease: ["Entire Property"] }).portion).toBe("Entire Property");
    expect(buildRentalGlance({}).portion).toBeNull();
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

  it("returns all-empty on an empty payload (component renders nothing)", () => {
    const g = buildRentalGlance({});
    expect(g).toEqual({
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
