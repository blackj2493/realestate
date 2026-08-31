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
import { CONVERSION_COSTS } from "@/lib/avm/valueAdd/moveCatalog";

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
  /**
   * One-time capital to CREATE a suite. Optional and zero on every strategy but
   * "Add a suite" — it enters totalCashInvested, so cash-on-cash reflects money that
   * has to be spent before the income arrives. Showing suite rent without it is the
   * same fabrication as the $1,500 constant, one step later.
   */
  suiteCapex?: number;
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
  const suiteCapex = Math.max(0, num(input.suiteCapex ?? 0));
  const totalCashInvested = downPayment + price * (closingCostPct / 100) + suiteCapex;

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

/**
 * How the reader intends to run the property. Each one is a different business, and
 * the sandbox used to mix two of them: it took the whole-home comp AND added a flat
 * $1,500 of "other income", which charges for the basement twice.
 *
 *   whole-home  one tenant, the entire house. Suite income zero.
 *   split       main unit + in-home suite, both from comps. What an investor buying a
 *               home with a second kitchen actually does — it beats the whole-home
 *               lease on 94.5% of them, median +31.9%.
 *   add-suite   there is no suite yet. Suite rent from comps, MINUS the conversion
 *               cost, which lands in cash invested rather than being waved away.
 */
export type UnderwritingStrategy = "whole-home" | "split" | "add-suite";

/**
 * Fallback cost to build a legal secondary suite, when nothing more specific is known
 * about the basement. Re-exported from the value-add catalog so the sandbox and the
 * reno tool cannot price the same renovation differently.
 *
 * The sandbox PREFERS the per-listing band from suiteConversion(), which adds
 * finishing and an entrance allowance when the basement needs them — a finished
 * walk-out and an unfinished basement with no side door are not the same job. This
 * bare band is what remains when the caller supplies no listing detail.
 */
export const SUITE_CONVERSION_COST = CONVERSION_COSTS.legalSuite;

export interface SeedInput {
  listPrice?: number | null;
  annualTaxes?: number | null;
  monthlyFees?: number | null;
  hasSuitePotential?: boolean;
  /** Rent from the comp ladder (src/lib/metrics/compRent.ts). Null when no comp exists.
   *  Where a suite is observed this is already the MAIN-UNIT comp, not the whole home. */
  compMonthlyRent?: number | null;
  /** Measured in-home suite rent (125). Null when no suite is observed or no cohort. */
  suiteMonthlyRent?: number | null;
  /** Which business this seed is for. Defaults to the one the home already runs. */
  strategy?: UnderwritingStrategy;
}

/**
 * Which strategy a listing opens on.
 *
 * A home with a second kitchen opens on the SPLIT, because that is what the property
 * is — and the reader is in the investor lens by definition. Everything else opens
 * whole-home. "Add a suite" is never a default: it costs $50k-$120k and a permit, and
 * defaulting to it would publish a return on capital nobody has spent.
 */
export function defaultStrategy(suiteMonthlyRent?: number | null): UnderwritingStrategy {
  return typeof suiteMonthlyRent === "number" && suiteMonthlyRent > 0 ? "split" : "whole-home";
}

/** Which anchor the Monthly Rent field got — the UI must say, they differ a lot. */
export type RentSeedBasis = "comps" | "rule-of-thumb";

/**
 * Rent anchor for the sandbox.
 *
 * PREFERS A REAL COMP. `compMonthlyRent` comes off the rent ladder (via the listing's
 * gross_yield_est — see src/lib/metrics/compRent.ts), matched on municipality or
 * neighbourhood, property sub-type, bed split and bath count.
 *
 * The price × 0.004 rule is the FALLBACK, for the listings with no comp at any rung —
 * a township with no rental market at all. It is arithmetic on the ask, not a rent: it
 * knows nothing about where the home is, how many bedrooms it has, or what it is. Its
 * tell showed on every listing at once — Gross Yield printed exactly 4.80% everywhere,
 * because 0.004 × 12 IS 4.8%, so the tile restated the constant instead of measuring.
 *
 * On X12909812 the rule said $1,516 and the comps said $2,300, and the page's own VOW
 * lease grid agreed with the comps. Callers must label which one they got.
 */
export function seedMonthlyRent(price: number, compMonthlyRent?: number | null): number {
  if (typeof compMonthlyRent === "number" && Number.isFinite(compMonthlyRent) && compMonthlyRent > 0) {
    return Math.round(compMonthlyRent);
  }
  const anchor = Math.round((price || 0) * RENT_SEED_FRACTION);
  return Math.min(RENT_SEED_MAX, Math.max(RENT_SEED_MIN, anchor || RENT_SEED_MIN));
}

/** Suite income for a strategy. Whole-home earns none; the other two earn the comp. */
export function suiteIncomeFor(
  strategy: UnderwritingStrategy,
  suiteMonthlyRent?: number | null
): number {
  if (strategy === "whole-home") return 0;
  return typeof suiteMonthlyRent === "number" && suiteMonthlyRent > 0 ? Math.round(suiteMonthlyRent) : 0;
}

/** Did this listing's rent seed come from comps, or from the price rule? */
export function rentSeedBasis(compMonthlyRent?: number | null): RentSeedBasis {
  return typeof compMonthlyRent === "number" && Number.isFinite(compMonthlyRent) && compMonthlyRent > 0
    ? "comps"
    : "rule-of-thumb";
}

/**
 * Build a default assumption set from a listing. Everything here is immediately
 * editable in the UI — these are starting points, not claims.
 */
export function seedAssumptions(listing: SeedInput): UnderwritingAssumptions {
  const purchasePrice = Math.max(0, num(Number(listing.listPrice)));
  const strategy = listing.strategy ?? defaultStrategy(listing.suiteMonthlyRent);
  return {
    purchasePrice,
    downPaymentPct: UW_DEFAULTS.downPaymentPct,
    interestRatePct: UW_DEFAULTS.interestRatePct,
    amortYears: UW_DEFAULTS.amortYears,
    annualTaxes: Math.max(0, num(Number(listing.annualTaxes))),
    monthlyFees: Math.max(0, num(Number(listing.monthlyFees))),
    monthlyRent: seedMonthlyRent(purchasePrice, listing.compMonthlyRent),
    // Suite income is a MEASURED comp or nothing. The SUITE_INCOME_DEFAULT constant
    // that used to sit here was $1,500 flat on every listing in Ontario, switched on
    // by KitchensBelowGrade alone: measured 21% off the local median, and more than
    // 25% off on 143 of 331 city cohorts.
    otherMonthlyIncome: suiteIncomeFor(strategy, listing.suiteMonthlyRent),
    suiteCapex: strategy === "add-suite" ? SUITE_CONVERSION_COST.typical : 0,
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

/**
 * THE RENT A STRATEGY IS ACTUALLY WORTH.
 *
 * Each strategy leases a different thing, so each has its own comp:
 *
 *   whole-home  ONE tenant, the entire house — `wholeHomeMonthlyRent`.
 *   split       the MAIN UNIT only; the suite is a separate line — `compMonthlyRent`.
 *   add-suite   the house as it stands today, with the new suite added beside it.
 *
 * `compMonthlyRent` is the main-unit comp wherever a suite is observed (the detail page
 * subtracts the measured suite back out of `gross_yield_est`). That is correct for
 * Split and WRONG for Whole home, and until now Whole home had nothing else to reach
 * for: switching strategy deleted the suite income and left the rent field alone, so a
 * 7-bed / 5-bath / 3-kitchen house was underwritten at its 4-bed comp. On W13714292
 * that published -$1,733/mo and DSCR 0.61 on a home the ladder prices at $4,800.
 *
 * Falls back to `compMonthlyRent` when no whole-home figure exists — a document that
 * predates the field, or a listing with no comp at all. Never invents one, and in
 * particular never derives it from the "median +31.9%" figure in the comments above:
 * no script in this repo reproduces that measurement, and a rent computed from a
 * remembered ratio is the $1,500 suite constant with extra steps.
 */
export function rentSeedForStrategy(
  strategy: UnderwritingStrategy,
  input: {
    purchasePrice: number;
    compMonthlyRent?: number | null;
    wholeHomeMonthlyRent?: number | null;
  }
): number {
  const { purchasePrice, compMonthlyRent, wholeHomeMonthlyRent } = input;
  if (strategy === "whole-home" && typeof wholeHomeMonthlyRent === "number" && wholeHomeMonthlyRent > 0) {
    return Math.round(wholeHomeMonthlyRent);
  }
  return seedMonthlyRent(purchasePrice, compMonthlyRent);
}

/**
 * What Monthly Rent should read after the reader switches strategy.
 *
 * A TUNED RENT SURVIVES THE SWITCH. `pickStrategy` was built to rewrite only the lines
 * a strategy owns, so that comparing two strategies compares the strategies instead of
 * discarding the reader's work — and that principle is right. The bug was that rent was
 * never recognised as a line the strategy owns: it means a different thing on each one.
 *
 * So: re-seed ONLY when the field still holds the outgoing strategy's seed. A reader
 * who typed their own number keeps it, because they know something the ladder does not;
 * a reader who never touched it gets the comp for the business they just switched to.
 *
 * Toggling back and forth is stable — each hop leaves the field on the new strategy's
 * seed, which the next hop recognises.
 */
export function rentOnStrategySwitch(input: {
  from: UnderwritingStrategy;
  to: UnderwritingStrategy;
  currentRent: number;
  purchasePrice: number;
  compMonthlyRent?: number | null;
  wholeHomeMonthlyRent?: number | null;
}): number {
  const { from, to, currentRent, ...seed } = input;
  const outgoing = rentSeedForStrategy(from, seed);
  // Whole dollars on both sides: the seeds are rounded and the input is numeric, so an
  // exact compare is the honest test of "untouched" without a tolerance to tune.
  if (Math.round(currentRent) !== outgoing) return currentRent;
  return rentSeedForStrategy(to, seed);
}
