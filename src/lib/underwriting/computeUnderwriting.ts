/**
 * Underwriting Sandbox engine (P6) — pure, deterministic buy-and-hold underwrite.
 *
 * The single source of truth for the right-rail Underwriting Sandbox. Given a set
 * of fully user-controlled assumptions it returns the cashflow / cap rate /
 * cash-on-cash / DSCR / carry an investor needs to actually underwrite a deal.
 *
 * Why a NEW engine (not calculateProForma): the cap-rate engine is a *value-add*
 * model — it bakes in $120k basement-conversion capex, 9% bridge debt, and a fixed
 * $5,500 gross rent. That's a flipper/BRRRR lens, not a transparent, user-tunable
 * buy-and-hold underwrite. Deal Score keeps using calculateProForma; the Sandbox
 * needs every input exposed and editable.
 *
 * Compliance (CLAUDE.md §4): pure arithmetic only. No LLM, no VOW data — uses
 * active-listing fields plus the user's own inputs.
 */

import { calculateMonthlyMortgage } from "@/lib/typesense/ExtrapolatedCapRateEngine";

// ── Defaults (one place to tune) ─────────────────────────────────────────────
export const UW_DEFAULTS = {
  downPaymentPct: 20,
  interestRatePct: 5.5,
  amortYears: 30,
  vacancyPct: 5,
  /** management + maintenance + reserves, applied to effective gross income */
  opexPct: 8,
  insuranceMonthly: 150,
  closingCostPct: 2,
  otherMonthlyIncome: 0,
} as const;

/** Suite-income default that preserves the old CarryCostCalculator "Suite Offset". */
export const SUITE_INCOME_DEFAULT = 1500;

/** Rent seed anchor as a fraction of purchase price (the "1% rule", quartered). */
const RENT_SEED_FRACTION = 0.004;
const RENT_SEED_MIN = 1500;
const RENT_SEED_MAX = 12000;

export interface UnderwritingAssumptions {
  purchasePrice: number;
  downPaymentPct: number;
  interestRatePct: number;
  amortYears: number;
  annualTaxes: number;
  monthlyFees: number;
  monthlyRent: number;
  otherMonthlyIncome: number;
  vacancyPct: number;
  opexPct: number;
  insuranceMonthly: number;
  closingCostPct: number;
}

export interface UnderwritingResult {
  downPayment: number;
  loanAmount: number;
  monthlyMortgage: number;
  monthlyTax: number;
  monthlyOpex: number;
  /** out-of-pocket monthly cost: mortgage + tax + fees + insurance (no rent offset) */
  monthlyCarry: number;
  grossMonthlyIncome: number;
  effectiveGrossIncome: number;
  monthlyNOI: number;
  annualNOI: number;
  monthlyCashflow: number;
  annualCashflow: number;
  capRatePct: number;
  cashOnCashPct: number;
  grossYieldPct: number;
  /** debt-service coverage ratio; null when there is no debt service */
  dscr: number | null;
  totalCashInvested: number;
}

function num(v: number, fallback = 0): number {
  return Number.isFinite(v) ? v : fallback;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Underwrite a deal from a complete set of assumptions. Deterministic and pure —
 * the same inputs always yield the same outputs.
 *
 * Model (no double-counting): opexPct covers management/maintenance/reserves and
 * is applied to effective gross income; property tax, insurance, and condo fees
 * are explicit line items on top.
 */
export function computeUnderwriting(input: UnderwritingAssumptions): UnderwritingResult {
  const price = Math.max(0, num(input.purchasePrice));
  const dpPct = Math.min(100, Math.max(0, num(input.downPaymentPct)));
  const ratePct = Math.max(0, num(input.interestRatePct));
  const years = Math.max(0, num(input.amortYears));
  const annualTaxes = Math.max(0, num(input.annualTaxes));
  const monthlyFees = Math.max(0, num(input.monthlyFees));
  const monthlyRent = Math.max(0, num(input.monthlyRent));
  const otherIncome = Math.max(0, num(input.otherMonthlyIncome));
  const vacancyPct = Math.min(100, Math.max(0, num(input.vacancyPct)));
  const opexPct = Math.min(100, Math.max(0, num(input.opexPct)));
  const insuranceMonthly = Math.max(0, num(input.insuranceMonthly));
  const closingCostPct = Math.max(0, num(input.closingCostPct));

  const downPayment = price * (dpPct / 100);
  const loanAmount = price - downPayment;
  const monthlyMortgage = calculateMonthlyMortgage(loanAmount, ratePct / 100, years);

  const monthlyTax = annualTaxes / 12;

  const grossMonthlyIncome = monthlyRent + otherIncome;
  const effectiveGrossIncome = grossMonthlyIncome * (1 - vacancyPct / 100);
  const monthlyOpex = effectiveGrossIncome * (opexPct / 100);

  const monthlyNOI = effectiveGrossIncome - (monthlyTax + insuranceMonthly + monthlyFees + monthlyOpex);
  const annualNOI = monthlyNOI * 12;

  const monthlyCashflow = monthlyNOI - monthlyMortgage;
  const annualCashflow = monthlyCashflow * 12;

  const annualDebtService = monthlyMortgage * 12;
  const totalCashInvested = downPayment + price * (closingCostPct / 100);

  const capRatePct = price > 0 ? (annualNOI / price) * 100 : 0;
  const cashOnCashPct = totalCashInvested > 0 ? (annualCashflow / totalCashInvested) * 100 : 0;
  // Industry definition: annual gross RENT / price. otherIncome (e.g. hypothetical suite)
  // stays in NOI/cashflow but must not inflate the headline yield (audit MEDIUM-12).
  const grossYieldPct = price > 0 ? (monthlyRent * 12 / price) * 100 : 0;
  const dscr = annualDebtService > 0 ? annualNOI / annualDebtService : null;

  const monthlyCarry = monthlyMortgage + monthlyTax + monthlyFees + insuranceMonthly;

  return {
    downPayment: round2(downPayment),
    loanAmount: round2(loanAmount),
    monthlyMortgage: round2(monthlyMortgage),
    monthlyTax: round2(monthlyTax),
    monthlyOpex: round2(monthlyOpex),
    monthlyCarry: round2(monthlyCarry),
    grossMonthlyIncome: round2(grossMonthlyIncome),
    effectiveGrossIncome: round2(effectiveGrossIncome),
    monthlyNOI: round2(monthlyNOI),
    annualNOI: round2(annualNOI),
    monthlyCashflow: round2(monthlyCashflow),
    annualCashflow: round2(annualCashflow),
    capRatePct: round2(capRatePct),
    cashOnCashPct: round2(cashOnCashPct),
    grossYieldPct: round2(grossYieldPct),
    dscr: dscr === null ? null : round2(dscr),
    totalCashInvested: round2(totalCashInvested),
  };
}

export interface SeedInput {
  listPrice?: number | null;
  annualTaxes?: number | null;
  monthlyFees?: number | null;
  hasSuitePotential?: boolean;
}

/** Conservative, transparent rent anchor surfaced to the user as "estimate — adjust". */
export function seedMonthlyRent(price: number): number {
  const anchor = Math.round((price || 0) * RENT_SEED_FRACTION);
  return Math.min(RENT_SEED_MAX, Math.max(RENT_SEED_MIN, anchor || RENT_SEED_MIN));
}

/**
 * Build a default assumption set from a listing. Everything here is immediately
 * editable in the UI — these are starting points, not claims.
 */
export function seedAssumptions(listing: SeedInput): UnderwritingAssumptions {
  const purchasePrice = Math.max(0, num(Number(listing.listPrice)));
  return {
    purchasePrice,
    downPaymentPct: UW_DEFAULTS.downPaymentPct,
    interestRatePct: UW_DEFAULTS.interestRatePct,
    amortYears: UW_DEFAULTS.amortYears,
    annualTaxes: Math.max(0, num(Number(listing.annualTaxes))),
    monthlyFees: Math.max(0, num(Number(listing.monthlyFees))),
    monthlyRent: seedMonthlyRent(purchasePrice),
    otherMonthlyIncome: listing.hasSuitePotential ? SUITE_INCOME_DEFAULT : UW_DEFAULTS.otherMonthlyIncome,
    vacancyPct: UW_DEFAULTS.vacancyPct,
    opexPct: UW_DEFAULTS.opexPct,
    insuranceMonthly: UW_DEFAULTS.insuranceMonthly,
    closingCostPct: UW_DEFAULTS.closingCostPct,
  };
}

/**
 * Whether the rental-income side of the underwrite (rent → cap rate, gross
 * yield, cashflow) is meaningful for a property. False for non-dwelling parcels
 * — vacant land, raw land, parking spaces, lockers — where seeding a monthly
 * rent and reporting a cap rate is a fabrication, not an estimate.
 *
 * Audit finding C2 (2026-06-13): the sandbox showed "-$311/mo cashflow" on a
 * vacant-land parcel. Callers gate the income display on this.
 *
 * Commercial-gap Phase 0 (2026-07-03): the residential rent seed ("1% rule"
 * scaled) is equally a fabrication on Commercial-class subtypes — Office,
 * Commercial Retail, Industrial, Sale Of Business, Investment, Farm, Store W
 * Apt/Office — which are valued on their own income statements (NOI, TMI),
 * not a seeded dwelling rent. Word-boundaries where a bare substring could
 * trip on community/style strings (Highland, Businessman's Corner — none live,
 * but the feed is untrusted).
 */
export function isIncomeProperty(propertySubType?: string | null): boolean {
  const t = (propertySubType || "").toLowerCase();
  return !/vacant|\bland\b|parking|locker|office|retail|industrial|commercial|\bbusiness\b|investment|\bfarm\b/.test(t);
}
