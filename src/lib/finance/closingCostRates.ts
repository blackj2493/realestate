/**
 * Statutory closing-cost rate tables for Ontario residential purchases.
 *
 * These rates are set by legislation and DO change (Toronto added the MLTT
 * luxury tiers in 2024; the federal insured-mortgage cap moved to $1.5M on
 * 2024-12-15). Every rate lives HERE — dated and sourced — so an update is a
 * one-line edit in one obvious place, never scattered through the code.
 *
 * ⚠️  LAST VERIFIED: 2026-07-20. Re-check against the linked sources before
 * relying on these for a real transaction; treat all outputs as estimates.
 *
 * Compliance: pure public rate data. No VOW/MLS data, no LLM.
 */

/** One marginal bracket: `rate` applies to the slice of price within it. */
export interface TaxBracket {
  /** Upper bound of this bracket. `null` = top tier (no upper bound). */
  upTo: number | null;
  /** Marginal rate on the portion of price falling inside this bracket. */
  rate: number;
}

/**
 * Ontario Land Transfer Tax — marginal brackets for 1–2 single-family
 * residences. The 2.5% tier over $2M applies to that class since 2017-01-01.
 * Source: https://www.ontario.ca/document/land-transfer-tax
 */
export const ONTARIO_LTT_BRACKETS: TaxBracket[] = [
  { upTo: 55_000, rate: 0.005 },
  { upTo: 250_000, rate: 0.01 },
  { upTo: 400_000, rate: 0.015 },
  { upTo: 2_000_000, rate: 0.02 },
  { upTo: null, rate: 0.025 },
];

/**
 * Toronto Municipal Land Transfer Tax (MLTT) — levied ON TOP of the provincial
 * LTT, City of Toronto only. Mirrors the provincial brackets up to $2M, then
 * adds the luxury tiers introduced by the 2024 by-law (effective 2024-01-01).
 * Source: https://www.toronto.ca/services-payments/property-taxes-utilities/municipal-land-transfer-tax-mltt/
 */
export const TORONTO_MLTT_BRACKETS: TaxBracket[] = [
  { upTo: 55_000, rate: 0.005 },
  { upTo: 250_000, rate: 0.01 },
  { upTo: 400_000, rate: 0.015 },
  { upTo: 2_000_000, rate: 0.02 },
  { upTo: 3_000_000, rate: 0.025 },
  { upTo: 4_000_000, rate: 0.035 },
  { upTo: 5_000_000, rate: 0.045 },
  { upTo: 10_000_000, rate: 0.055 },
  { upTo: 20_000_000, rate: 0.065 },
  { upTo: null, rate: 0.075 },
];

/**
 * First-time buyer LTT rebate maximums. Provincial rebate offsets the Ontario
 * LTT; the Toronto rebate offsets the MLTT. Each is capped and cannot exceed
 * the tax actually owed. (Eligibility: 18+, has never owned a home anywhere,
 * occupies as principal residence within 9 months — surfaced as a toggle.)
 * Sources: ontario.ca + toronto.ca (links above).
 */
export const FIRST_TIME_BUYER_REBATE = {
  ontarioMax: 4_000,
  torontoMax: 4_475,
} as const;

/**
 * CMHC mortgage default-insurance premium tiers (standard purchase, amortization
 * ≤ 25 yrs). Premium = rate × loan and is ADDED TO THE MORTGAGE PRINCIPAL
 * (financed) — it is NOT paid in cash at closing. Keyed by loan-to-value
 * (LTV = loan ÷ price). Insurance is unavailable at ≤ 80% LTV (20%+ down) and
 * above 95% LTV (below the legal minimum down payment).
 * Source: https://www.cmhc-schl.gc.ca/consumers/home-buying/mortgage-loan-insurance-for-consumers
 */
export const CMHC_PREMIUM_TIERS: { maxLtv: number; rate: number }[] = [
  { maxLtv: 0.85, rate: 0.028 }, // 15.00–19.99% down
  { maxLtv: 0.9, rate: 0.031 }, //  10.00–14.99% down
  { maxLtv: 0.95, rate: 0.04 }, //   5.00– 9.99% down
];

/**
 * Ontario RST charged on the CMHC premium — payable IN CASH at closing (the
 * premium itself is financed, but the 8% tax on it is not). Source: ontario.ca.
 */
export const CMHC_PREMIUM_PST_RATE = 0.08;

/**
 * Federal minimum down payment rule. Since 2024-12-15 the insured-mortgage cap
 * (above which 20% down is required) is $1.5M.
 * Source: https://www.canada.ca/en/financial-consumer-agency/services/mortgages/down-payment.html
 */
export const MIN_DOWN = {
  /** 5% on the price up to this. */
  lowTierCap: 500_000,
  lowTierRate: 0.05,
  /** 10% on the portion between lowTierCap and insuredCap. */
  midTierRate: 0.1,
  /** At/above this price, insured mortgages are unavailable → 20% minimum. */
  insuredCap: 1_500_000,
  highTierRate: 0.2,
} as const;

/**
 * Typical fixed cash closing costs — ESTIMATES, not statutory. Ranges vary by
 * lawyer and insurer; these are mid-range Ontario figures and are editable
 * defaults, surfaced to the user as "estimate — adjust".
 */
export const DEFAULT_OTHER_COSTS = {
  legalFees: 1_800,
  titleInsurance: 400,
} as const;
