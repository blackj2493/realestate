/**
 * Monthly cashflow at the READER'S OWN financing, computed client-side per listing.
 *
 * WHY THIS EXISTS
 * ───────────────
 * The Cashflow Investor lens showed Cap Rate, Yield and Carry Cost — an unlevered
 * ratio and a cost with no rent in it. It never showed cashflow, the one number the
 * lens is named after. `net_monthly_cashflow` was computed by the ETL, stored in
 * Postgres, indexed in Typesense and marked sortable, and then displayed nowhere.
 *
 * Surfacing the stored field would not have been enough, for two reasons:
 *
 *   1. It is baked at 80% LTV / 4.04% / 30yr. The sandbox defaults to 5.5%, so the
 *      same listing could read positive in the ledger and negative in the calculator,
 *      with nothing on screen explaining the gap.
 *   2. Cashflow is not a property of the property. 20% down and 35% down give
 *      different answers on the same home, and the sign flips. A precomputed column
 *      can only ever be right for one reader.
 *
 * So it is derived here instead, from two numbers already on every document:
 *
 *     NOI/yr   = ListPrice × cap_rate_est / 100     (cap rate is NOI over price)
 *     cashflow = NOI/12 − mortgage(price, down, rate, amort)
 *
 * Cap rate already nets out taxes, insurance, maintenance, condo fees, management and
 * vacancy — everything EXCEPT debt service, which is exactly what it excludes by
 * definition and exactly what this adds back.
 *
 * COMPLIANCE: pure arithmetic over fields already served (CLAUDE.md §4). cap_rate_est
 * is IDX-derived, so nothing here is VOW-gated.
 */

import { calculateCanadianMonthlyMortgage } from "@/lib/finance/canadianMortgage";
import { capRateOrNull } from "@/lib/metrics/sanityBand";
import type { SharedDealInputs } from "@/lib/finance/dealInputs";

/** Everything the calculation needs from a listing document. */
export interface CashflowInput {
  listPrice?: number | null;
  capRatePct?: number | null;
}

/**
 * Monthly cashflow in dollars, or null when the listing has no usable cap rate.
 *
 * NULL IS A REAL ANSWER. A listing with no rent comp has no cashflow we can state,
 * and returning 0 would put it in the middle of a sort between the properties that
 * lose money and the ones that make it — the same class of error as the fabricated
 * negative cap rates that CAP_RATE_BAND now filters out.
 */
export function monthlyCashflow(
  listing: CashflowInput,
  inputs: SharedDealInputs
): number | null {
  const price = Number(listing.listPrice);
  if (!Number.isFinite(price) || price <= 0) return null;

  // Through the sanity band, so an out-of-range or sentinel cap rate reads as "no
  // estimate" here exactly as it does everywhere else on the page.
  const cap = capRateOrNull(listing.capRatePct);
  if (cap == null) return null;

  const down = Math.min(100, Math.max(0, inputs.downPaymentPct));
  const loan = price * (1 - down / 100);
  const months = Math.max(1, Math.round(inputs.amortYears * 12));
  const mortgage = calculateCanadianMonthlyMortgage(loan, inputs.interestRatePct / 100, months);

  const monthlyNOI = (price * (cap / 100)) / 12;
  return Math.round(monthlyNOI - mortgage);
}

/**
 * The cap rate at which cashflow turns positive for a given financing — the number
 * that turns "show me positive listings" into a server-side filter.
 *
 * Solving cashflow = 0 for cap:
 *     NOI/12 = mortgage            ⇒  price × cap/1200 = mortgage
 *     cap    = 1200 × mortgage / price
 *
 * The price cancels: a mortgage is linear in the loan and the loan is linear in the
 * price, so the break-even cap rate is the SAME for every listing at these terms.
 * That is what makes the filter a single clause rather than a per-listing scan.
 *
 * At 20% down / 5.5% / 25yr this is about 5.85%; at the ETL's old 4.04% / 30yr
 * assumption it was about 4.59%, which is why the stored column and the calculator
 * disagreed about the sign.
 */
export function breakEvenCapRate(inputs: SharedDealInputs): number {
  const down = Math.min(100, Math.max(0, inputs.downPaymentPct));
  const months = Math.max(1, Math.round(inputs.amortYears * 12));
  // Any price works — it cancels. 1,000,000 keeps the arithmetic away from rounding.
  const price = 1_000_000;
  const mortgage = calculateCanadianMonthlyMortgage(price * (1 - down / 100), inputs.interestRatePct / 100, months);
  return (1200 * mortgage) / price;
}
