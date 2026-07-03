import { describe, it, expect } from "vitest";
import { buildRentalSnapshot } from "./rentalSnapshot";

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
