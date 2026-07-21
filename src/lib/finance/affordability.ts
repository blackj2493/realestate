/**
 * Affordability engine (#2) — "what income would you need to qualify for this?"
 *
 * The mirror image of the mortgage calculator: given the loan and the listing's
 * carrying costs, it back-solves the household income a lender's debt-service
 * rules require. Deterministic and pure.
 *
 * Method: qualify at the OSFI stress rate (`max(contract + 2%, 5.25%)`), then
 * apply the GDS and TDS ratio limits. The BINDING (higher) of the two income
 * requirements is what actually gates approval.
 *   GDS = (P&I + property tax + heat + 50%·condo fees) / gross income ≤ 39%
 *   TDS = (GDS costs + other monthly debts)             / gross income ≤ 44%
 *
 * Compliance (CLAUDE.md §4): pure arithmetic on the listing + user inputs. No LLM.
 */

import { calculateCanadianMonthlyMortgage } from "./canadianMortgage";
import {
  MORTGAGE_STRESS_TEST_FLOOR_PCT,
  STRESS_TEST_BUFFER_PCT,
  GDS_LIMIT_RATIO,
  TDS_LIMIT_RATIO,
  QUALIFY_MONTHLY_HEAT,
  QUALIFY_CONDO_FEE_FACTOR,
} from "./mortgageRates";

function num(v: number, fallback = 0): number {
  return Number.isFinite(v) ? v : fallback;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** OSFI qualifying rate: the greater of (contract + buffer) and the floor. */
export function qualifyingRatePct(
  contractRatePct: number,
  floorPct: number = MORTGAGE_STRESS_TEST_FLOOR_PCT,
  bufferPct: number = STRESS_TEST_BUFFER_PCT
): number {
  return Math.max(num(contractRatePct) + bufferPct, floorPct);
}

export interface AffordabilityInput {
  /** Mortgage principal (after down payment; include CMHC premium if financed). */
  loanAmount: number;
  /** The rate the buyer is actually offered (NOT the stress rate). */
  contractRatePct: number;
  amortYears: number;
  annualPropertyTax: number;
  /** Monthly condo/association fees (50% counts toward debt service). */
  monthlyCondoFees?: number;
  /** Monthly heating cost; defaults to a standard lender figure. */
  monthlyHeat?: number;
  /** Other monthly debt payments (car, cards, loans) — drives TDS. */
  monthlyOtherDebt?: number;
  /** Override the GDS/TDS ratio limits (defaults: 39% / 44%). */
  gdsLimit?: number;
  tdsLimit?: number;
}

export interface AffordabilityResult {
  qualifyingRatePct: number;
  /** Monthly P&I at the qualifying (stress) rate. */
  qualifyingMonthlyPayment: number;
  /** Monthly housing cost counted in GDS (P&I + tax + heat + 50%·fees). */
  monthlyHousingCost: number;
  /** Income the GDS limit alone would require. */
  incomeForGds: number;
  /** Income the TDS limit alone would require. */
  incomeForTds: number;
  /** The binding requirement — the higher of GDS/TDS. This is the headline. */
  requiredAnnualIncome: number;
  /** Which limit is binding — the constraint the buyer must clear. */
  bindingRatio: "gds" | "tds";
}

/**
 * Back-solve the household income needed to qualify. Deterministic and pure.
 */
export function incomeToQualify(input: AffordabilityInput): AffordabilityResult {
  const loan = Math.max(0, num(input.loanAmount));
  const amortMonths = Math.max(0, num(input.amortYears)) * 12;
  const annualTax = Math.max(0, num(input.annualPropertyTax));
  const condoFees = Math.max(0, num(input.monthlyCondoFees ?? 0));
  const heat = Math.max(0, num(input.monthlyHeat ?? QUALIFY_MONTHLY_HEAT));
  const otherDebt = Math.max(0, num(input.monthlyOtherDebt ?? 0));
  const gds = input.gdsLimit ?? GDS_LIMIT_RATIO;
  const tds = input.tdsLimit ?? TDS_LIMIT_RATIO;

  const qRate = qualifyingRatePct(input.contractRatePct);
  const payment = calculateCanadianMonthlyMortgage(loan, qRate / 100, amortMonths);

  const housing = payment + annualTax / 12 + heat + QUALIFY_CONDO_FEE_FACTOR * condoFees;

  const incomeForGds = gds > 0 ? (housing * 12) / gds : 0;
  const incomeForTds = tds > 0 ? ((housing + otherDebt) * 12) / tds : 0;
  const requiredAnnualIncome = Math.max(incomeForGds, incomeForTds);

  return {
    qualifyingRatePct: round2(qRate),
    qualifyingMonthlyPayment: round2(payment),
    monthlyHousingCost: round2(housing),
    incomeForGds: Math.round(incomeForGds),
    incomeForTds: Math.round(incomeForTds),
    requiredAnnualIncome: Math.round(requiredAnnualIncome),
    bindingRatio: incomeForTds > incomeForGds ? "tds" : "gds",
  };
}
