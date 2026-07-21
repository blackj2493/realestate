import { describe, it, expect } from "vitest";
import {
  marginalTax,
  ontarioLandTransferTax,
  torontoMunicipalLandTransferTax,
  minimumDownPayment,
  cmhcPremiumRate,
  computeClosingCosts,
} from "./closingCosts";
import { ONTARIO_LTT_BRACKETS } from "./closingCostRates";

describe("ontarioLandTransferTax", () => {
  // Well-known published figures (ontario.ca LTT calculator).
  it("charges $6,475 on a $500,000 home", () => {
    expect(ontarioLandTransferTax(500_000)).toBe(6_475);
  });

  it("charges $16,475 on a $1,000,000 home", () => {
    expect(ontarioLandTransferTax(1_000_000)).toBe(16_475);
  });

  it("charges $8,475 on a $600,000 home", () => {
    expect(ontarioLandTransferTax(600_000)).toBe(8_475);
  });

  it("is 0.5% flat within the first bracket", () => {
    expect(ontarioLandTransferTax(50_000)).toBe(250);
  });

  it("returns 0 for non-positive / non-finite prices", () => {
    expect(ontarioLandTransferTax(0)).toBe(0);
    expect(ontarioLandTransferTax(-100)).toBe(0);
    expect(ontarioLandTransferTax(NaN)).toBe(0);
  });

  it("applies the 2.5% top tier only to the slice over $2M", () => {
    // $2M LTT = 275 + 1950 + 2250 + 32000 = 36,475; +2.5% of the next $500k.
    expect(ontarioLandTransferTax(2_000_000)).toBe(36_475);
    expect(ontarioLandTransferTax(2_500_000)).toBe(36_475 + 12_500);
  });
});

describe("torontoMunicipalLandTransferTax", () => {
  it("mirrors the provincial tax up to $2M (doubling the total)", () => {
    expect(torontoMunicipalLandTransferTax(500_000)).toBe(6_475);
    expect(torontoMunicipalLandTransferTax(600_000)).toBe(8_475);
  });

  it("adds the 2024 luxury tiers above $2M", () => {
    // Provincial-style base to $2M = 36,475; the $2M–$3M slice is 2.5% (not 2%).
    expect(torontoMunicipalLandTransferTax(3_000_000)).toBe(36_475 + 25_000);
  });
});

describe("marginalTax", () => {
  it("never charges a bracket rate on the whole amount", () => {
    // A naive (non-marginal) calc would give 2% of 600k = 12,000; correct is 8,475.
    expect(marginalTax(600_000, ONTARIO_LTT_BRACKETS)).toBe(8_475);
  });
});

describe("minimumDownPayment", () => {
  it("is 5% up to $500k", () => {
    expect(minimumDownPayment(400_000)).toBe(20_000);
    expect(minimumDownPayment(500_000)).toBe(25_000);
  });

  it("is 5% on the first $500k + 10% on the portion above", () => {
    expect(minimumDownPayment(700_000)).toBe(45_000); // 25,000 + 20,000
    expect(minimumDownPayment(1_000_000)).toBe(75_000); // 25,000 + 50,000
  });

  it("is a flat 20% at/above the $1.5M insured cap", () => {
    expect(minimumDownPayment(1_500_000)).toBe(300_000);
    expect(minimumDownPayment(2_000_000)).toBe(400_000);
  });
});

describe("cmhcPremiumRate", () => {
  it("returns the tier rate by loan-to-value", () => {
    expect(cmhcPremiumRate(0.95)).toBe(0.04); //  5% down
    expect(cmhcPremiumRate(0.9)).toBe(0.031); // 10% down
    expect(cmhcPremiumRate(0.85)).toBe(0.028); // 15% down
  });

  it("is 0 outside the insurable band (20%+ down, or below min down)", () => {
    expect(cmhcPremiumRate(0.8)).toBe(0);
    expect(cmhcPremiumRate(0.75)).toBe(0);
    expect(cmhcPremiumRate(0.98)).toBe(0);
  });
});

describe("computeClosingCosts", () => {
  it("first-time buyer pays $0 provincial LTT on a home fully within the rebate", () => {
    const r = computeClosingCosts({
      price: 350_000,
      downPayment: 70_000,
      isToronto: false,
      firstTimeBuyer: true,
    });
    expect(r.provincialLtt).toBe(3_725);
    expect(r.firstTimeBuyerRebate).toBe(3_725);
    expect(r.landTransferTaxNet).toBe(0);
  });

  it("caps each first-time rebate at its statutory max (Toronto)", () => {
    const r = computeClosingCosts({
      price: 600_000,
      downPayment: 120_000, // 20% → not insured
      isToronto: true,
      firstTimeBuyer: true,
    });
    expect(r.provincialLtt).toBe(8_475);
    expect(r.municipalLtt).toBe(8_475);
    expect(r.firstTimeBuyerRebate).toBe(4_000 + 4_475); // capped, not full
    expect(r.landTransferTaxNet).toBe(8_475);
    expect(r.insured).toBe(false);
    expect(r.cmhcPremium).toBe(0);
  });

  it("finances the CMHC premium and charges only its RST in cash", () => {
    const r = computeClosingCosts({
      price: 600_000,
      downPayment: 60_000, // 10% down → insured at 3.1%
      isToronto: false,
      firstTimeBuyer: false,
    });
    expect(r.insured).toBe(true);
    expect(r.loanBeforeInsurance).toBe(540_000);
    expect(r.cmhcPremium).toBe(16_740); // 540,000 × 3.1%
    expect(r.cmhcPremiumTax).toBe(1_339); // 16,740 × 8%
    expect(r.totalMortgage).toBe(556_740); // premium is financed
    // Cash = down + net LTT + premium RST + legal + title.
    // 60,000 + 8,475 + 1,339 + 1,800 + 400 = 72,014
    expect(r.cashToClose).toBe(72_014);
  });

  it("omits the municipal LTT outside Toronto", () => {
    const r = computeClosingCosts({
      price: 600_000,
      downPayment: 120_000,
      isToronto: false,
      firstTimeBuyer: false,
    });
    expect(r.municipalLtt).toBe(0);
    expect(r.landTransferTaxGross).toBe(8_475);
  });

  it("flags a down payment below the legal minimum", () => {
    const r = computeClosingCosts({
      price: 600_000,
      downPayment: 20_000, // min is 35,000
      isToronto: false,
      firstTimeBuyer: false,
    });
    expect(r.minDownPayment).toBe(35_000);
    expect(r.belowMinDown).toBe(true);
  });

  it("does not insure above the $1.5M cap even under 20% down", () => {
    const r = computeClosingCosts({
      price: 1_600_000,
      downPayment: 160_000, // 10% — but price is over the insurable cap
      isToronto: false,
      firstTimeBuyer: false,
    });
    expect(r.insured).toBe(false);
    expect(r.cmhcPremium).toBe(0);
    expect(r.belowMinDown).toBe(true); // min here is 20% = 320,000
  });
});
