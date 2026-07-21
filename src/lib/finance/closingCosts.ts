/**
 * Cash-to-close engine — pure, deterministic Ontario closing-cost math.
 *
 * Answers the question every buyer underestimates: "how much cash do I actually
 * need on closing day?" It sums the down payment, land transfer tax (provincial
 * + Toronto MLTT) net of the first-time-buyer rebate, the RST on any CMHC
 * premium, and typical legal/title costs. The CMHC premium itself is financed
 * (added to the mortgage), so it feeds `totalMortgage`, not the cash figure.
 *
 * Every statutory rate comes from `closingCostRates.ts` (dated + sourced).
 * Compliance (CLAUDE.md §4): pure arithmetic on public rates + the listing
 * price. No LLM, no VOW/MLS data.
 */

import {
  ONTARIO_LTT_BRACKETS,
  TORONTO_MLTT_BRACKETS,
  FIRST_TIME_BUYER_REBATE,
  CMHC_PREMIUM_TIERS,
  CMHC_PREMIUM_PST_RATE,
  MIN_DOWN,
  DEFAULT_OTHER_COSTS,
  type TaxBracket,
} from "./closingCostRates";

function num(v: number, fallback = 0): number {
  return Number.isFinite(v) ? v : fallback;
}

function roundDollar(n: number): number {
  return Math.round(n);
}

/**
 * Apply a marginal bracket table to an amount: each bracket's rate is charged
 * only on the slice of `amount` that falls within it (never the whole value).
 */
export function marginalTax(amount: number, brackets: TaxBracket[]): number {
  const price = Math.max(0, num(amount));
  let tax = 0;
  let lower = 0;
  for (const b of brackets) {
    const upper = b.upTo ?? Infinity;
    if (price <= lower) break;
    const taxable = Math.min(price, upper) - lower;
    if (taxable > 0) tax += taxable * b.rate;
    lower = upper;
  }
  return tax;
}

/** Ontario provincial Land Transfer Tax on a purchase price. */
export function ontarioLandTransferTax(price: number): number {
  return marginalTax(price, ONTARIO_LTT_BRACKETS);
}

/** Toronto Municipal LTT (City of Toronto only) — levied on top of provincial. */
export function torontoMunicipalLandTransferTax(price: number): number {
  return marginalTax(price, TORONTO_MLTT_BRACKETS);
}

/**
 * Legal minimum down payment for a purchase price under the federal tiered rule
 * (5% to $500k, 10% on $500k–$1.5M, 20% at/above $1.5M).
 */
export function minimumDownPayment(price: number): number {
  const p = Math.max(0, num(price));
  if (p === 0) return 0;
  if (p >= MIN_DOWN.insuredCap) return p * MIN_DOWN.highTierRate;
  if (p <= MIN_DOWN.lowTierCap) return p * MIN_DOWN.lowTierRate;
  return (
    MIN_DOWN.lowTierCap * MIN_DOWN.lowTierRate +
    (p - MIN_DOWN.lowTierCap) * MIN_DOWN.midTierRate
  );
}

/**
 * CMHC premium rate for a loan-to-value ratio. Returns 0 outside the insurable
 * band (≤80% LTV = 20%+ down, or >95% LTV = below the legal minimum down).
 */
export function cmhcPremiumRate(ltv: number): number {
  const v = num(ltv);
  if (v <= 0.8 || v > 0.95) return 0;
  for (const t of CMHC_PREMIUM_TIERS) {
    if (v <= t.maxLtv + 1e-9) return t.rate;
  }
  return 0;
}

export interface ClosingCostInput {
  /** Purchase price. */
  price: number;
  /** Down payment in dollars. */
  downPayment: number;
  /** City of Toronto property → the municipal LTT applies. */
  isToronto: boolean;
  /** Apply the first-time-buyer LTT rebate(s). */
  firstTimeBuyer: boolean;
  /** Override the default legal fee estimate. */
  legalFees?: number;
  /** Override the default title-insurance estimate. */
  titleInsurance?: number;
}

export interface ClosingCostResult {
  price: number;
  downPayment: number;
  downPaymentPct: number;
  /** Loan before any CMHC premium is added. */
  loanBeforeInsurance: number;
  ltv: number;
  minDownPayment: number;
  /** Down payment is below the legal minimum for this price. */
  belowMinDown: boolean;

  provincialLtt: number;
  /** Toronto MLTT — 0 when the property is not in the City of Toronto. */
  municipalLtt: number;
  landTransferTaxGross: number;
  firstTimeBuyerRebate: number;
  landTransferTaxNet: number;

  /** Whether the mortgage is CMHC-insured (<20% down, price under the cap). */
  insured: boolean;
  /** CMHC premium — financed into the mortgage, NOT part of cash to close. */
  cmhcPremium: number;
  /** RST on the CMHC premium — payable in cash at closing. */
  cmhcPremiumTax: number;

  legalFees: number;
  titleInsurance: number;

  /** Total cash required on closing day. */
  cashToClose: number;
  /** Amount financed (loan + CMHC premium) — feeds the monthly-payment calc. */
  totalMortgage: number;
}

/**
 * Compute the full cash-to-close breakdown. Deterministic and pure — the same
 * inputs always yield the same outputs.
 */
export function computeClosingCosts(input: ClosingCostInput): ClosingCostResult {
  const price = Math.max(0, num(input.price));
  const downPayment = Math.min(price, Math.max(0, num(input.downPayment)));
  const downPaymentPct = price > 0 ? (downPayment / price) * 100 : 0;

  const minDown = minimumDownPayment(price);
  const belowMinDown = downPayment + 1e-6 < minDown;

  const loanBeforeInsurance = Math.max(0, price - downPayment);
  const ltv = price > 0 ? loanBeforeInsurance / price : 0;

  // Land transfer tax (marginal), provincial + Toronto municipal.
  const provincialLtt = ontarioLandTransferTax(price);
  const municipalLtt = input.isToronto ? torontoMunicipalLandTransferTax(price) : 0;
  const landTransferTaxGross = provincialLtt + municipalLtt;

  // First-time-buyer rebates: provincial offsets provincial LTT; Toronto offsets
  // MLTT. Each caps at both its statutory max and the tax actually owed.
  const rebate = input.firstTimeBuyer
    ? Math.min(provincialLtt, FIRST_TIME_BUYER_REBATE.ontarioMax) +
      (input.isToronto ? Math.min(municipalLtt, FIRST_TIME_BUYER_REBATE.torontoMax) : 0)
    : 0;
  const landTransferTaxNet = Math.max(0, landTransferTaxGross - rebate);

  // CMHC insurance: only when 5–19.99% down AND price under the insurable cap.
  const insured = ltv > 0.8 && ltv <= 0.95 && price < MIN_DOWN.insuredCap;
  const premiumRate = insured ? cmhcPremiumRate(ltv) : 0;
  const cmhcPremium = loanBeforeInsurance * premiumRate;
  const cmhcPremiumTax = cmhcPremium * CMHC_PREMIUM_PST_RATE;

  const legalFees = Math.max(0, num(input.legalFees ?? DEFAULT_OTHER_COSTS.legalFees));
  const titleInsurance = Math.max(0, num(input.titleInsurance ?? DEFAULT_OTHER_COSTS.titleInsurance));

  const cashToClose =
    downPayment + landTransferTaxNet + cmhcPremiumTax + legalFees + titleInsurance;
  const totalMortgage = loanBeforeInsurance + cmhcPremium;

  return {
    price: roundDollar(price),
    downPayment: roundDollar(downPayment),
    downPaymentPct: Math.round(downPaymentPct * 10) / 10,
    loanBeforeInsurance: roundDollar(loanBeforeInsurance),
    ltv: Math.round(ltv * 1000) / 1000,
    minDownPayment: roundDollar(minDown),
    belowMinDown,

    provincialLtt: roundDollar(provincialLtt),
    municipalLtt: roundDollar(municipalLtt),
    landTransferTaxGross: roundDollar(landTransferTaxGross),
    firstTimeBuyerRebate: roundDollar(rebate),
    landTransferTaxNet: roundDollar(landTransferTaxNet),

    insured,
    cmhcPremium: roundDollar(cmhcPremium),
    cmhcPremiumTax: roundDollar(cmhcPremiumTax),

    legalFees: roundDollar(legalFees),
    titleInsurance: roundDollar(titleInsurance),

    cashToClose: roundDollar(cashToClose),
    totalMortgage: roundDollar(totalMortgage),
  };
}
