/**
 * Financial Metrics Calculator
 * Phase 3: Complete cap rate, yield, cashflow, and tax burden calculations
 * 
 * All calculations follow Decision 4: Every field output unconditionally.
 * No field throws - fallbacks to 0 or computed defaults.
 */

import 'dotenv/config';
import { calculateCanadianMonthlyMortgage } from '@/lib/finance/canadianMortgage';

export interface FinancialMetricsInput {
  // From AVM
  annual_rent: number;
  annual_rent_p10: number;
  has_rent_data: boolean;

  // Purchase-price basis for the ratio metrics below (cap rate / yield / tax burden):
  // the list price, or a city-region average for sub-$200K "$1 bidding-war" listings.
  // NOT the AVM / "True Value" — see services/ratioPriceCalculator.ts.
  calculation_price: number;
  is_price_discovery: boolean;

  // Property Details
  propertySubType: string;
  listPrice: number;
  // TRREB TransactionType ("For Sale" / "For Lease" / "For Sub-Lease"). For a lease
  // listing, listPrice is the MONTHLY RENT, not a purchase price — so cap rate / yield
  // / cashflow are undefined and must be zeroed (see the guard below). Optional:
  // a missing value is treated as a sale (no regression for sale listings).
  transactionType?: string;
  taxAnnualAmount: number | null;
  associationFee: number | null;
  maintenanceExpense: number | null;
  insuranceExpense: number | null;
  baseMillRate: number;
  isCondo: boolean;
  /**
   * MEASURED monthly rent for an observed in-home suite (125), or 0. The caller gates
   * this on hasObservedSuite() — this engine never infers a suite from a score.
   * Zero here means "no suite, or no comp for one", and both must produce the same
   * result: no suite income at all.
   */
  suite_monthly_rent?: number;
  suite_monthly_rent_p10?: number;
}

export interface FinancialMetrics {
  // Cap Rate
  cap_rate_est: number;
  cap_rate_floor: number;

  // Yield
  gross_yield_est: number;
  price_discovery_flag: boolean;

  // Cashflow
  net_monthly_cashflow: number;
  cashflow_floor: number;

  // Tax Burden
  tax_burden_ratio: number;
  assessment_status: string;

  // Raw for Pro Forma
  annual_opex: number;
  annual_revenue: number;
  vacancy_loss: number;
  mortgage_monthly: number;
}

export function calculateFinancialMetrics(input: FinancialMetricsInput): FinancialMetrics {
  const {
    annual_rent, annual_rent_p10, has_rent_data,
    calculation_price, is_price_discovery,
    propertySubType, listPrice, transactionType, taxAnnualAmount,
    associationFee, maintenanceExpense, insuranceExpense,
    baseMillRate, isCondo,
    suite_monthly_rent, suite_monthly_rent_p10,
  } = input;

  // === FOR-LEASE GUARD ===
  // A lease listing's listPrice IS the monthly rent, not a sale price. Cap rate,
  // yield, cashflow and tax-burden are all price-relative and become absurd (1000%+)
  // when divided by a rent. Emit zeros instead. Matches rentModel.isLeaseRecord:
  // any TransactionType containing "lease"/"rent" is a lease. A missing value falls
  // through to the normal (sale) path, so sale listings are never regressed.
  const txn = (transactionType ?? '').trim().toLowerCase();
  if (txn.includes('lease') || txn.includes('rent')) {
    return {
      cap_rate_est: 0,
      cap_rate_floor: 0,
      gross_yield_est: 0,
      price_discovery_flag: is_price_discovery,
      net_monthly_cashflow: 0,
      cashflow_floor: 0,
      tax_burden_ratio: 0,
      assessment_status: 'UNASSESSED',
      annual_opex: 0,
      annual_revenue: 0,
      vacancy_loss: 0,
      mortgage_monthly: 0,
    };
  }

  // === ZERO-PRICE GUARD (audit LOW-10) ===
  // If either price is zero (e.g. a record that slipped through before the lease guard,
  // or a data-entry error), every ratio metric is undefined. Return all-zeros rather than
  // dividing by `price||1` which yields astronomical cap rates / yields.
  if (!(calculation_price > 0) || !(listPrice > 0)) {
    return {
      cap_rate_est: 0,
      cap_rate_floor: 0,
      gross_yield_est: 0,
      price_discovery_flag: is_price_discovery,
      net_monthly_cashflow: 0,
      cashflow_floor: 0,
      tax_burden_ratio: 0,
      assessment_status: 'UNASSESSED',
      annual_opex: 0,
      annual_revenue: 0,
      vacancy_loss: 0,
      mortgage_monthly: 0,
    };
  }

  const price = calculation_price;

  // === ANNUAL REVENUE ===
  //
  // Whole-home rent, plus a MEASURED suite rent where the feed observes a suite.
  //
  // What used to happen here: rentAVM multiplied annual_rent by 1.6 for anything the
  // multi-unit scorer liked, and this file declared its own unused `isSuiteCandidate`
  // on a DIFFERENT set of statuses (two, not three) — dead code that made the real
  // rule look narrower than it was. Both are gone (125).
  //
  // The suite line is additive rather than a multiplier because the two rents come
  // from different markets: whole homes and in-home units lease to different tenants
  // at different prices, and pooling them is what contaminated the cohorts in the
  // first place.
  //
  // NOTE ON THE BASIS. This adds suite rent to the WHOLE-HOME comp for the listing as
  // described, which slightly overstates the main unit when the "+1" bedroom is the
  // suite's own. The alternative — a second ladder walk for a (beds-above, den=0)
  // cohort — costs another round trip per listing in the ETL and moves the median by
  // less than the p10 band already allows. The sandbox does model both properly, and
  // cap_rate_floor below carries the conservative reading.
  const suiteMonthly = Math.max(0, suite_monthly_rent || 0);
  const suiteMonthlyP10 = Math.max(0, suite_monthly_rent_p10 || suiteMonthly * 0.85);
  const suiteAnnual = has_rent_data ? suiteMonthly * 12 : 0;
  // The floor takes a harsher view than the headline: an existing suite may be vacant,
  // unpermitted, or occupied by the seller's family, and none of those are visible in
  // the feed. 0.7 on the p10 rent is the downside reading of "it exists".
  const suiteAnnualFloor = has_rent_data ? suiteMonthlyP10 * 12 * 0.7 : 0;

  const annualRevenue = has_rent_data ? annual_rent + suiteAnnual : 0;
  const annualRevenueP10 = has_rent_data ? annual_rent_p10 + suiteAnnualFloor : annualRevenue * 0.85;
  const vacancyLoss = annualRevenue * 0.04;
  const vacancyLossFloor = annualRevenueP10 * 0.08;
  const grossRentNetVacancy = annualRevenue - vacancyLoss;
  const grossRentNetVacancyFloor = annualRevenueP10 - vacancyLossFloor;

  // === OPEX ===
  // Property Taxes
  let taxes = taxAnnualAmount || 0;
  if (taxes > 0 && taxes < 500) taxes *= 12; // monthly input fix
  if (taxes === 0 || !taxAnnualAmount) {
    // Estimate from mill rate
    taxes = price * baseMillRate;
  }
  if (taxes > listPrice * 0.05) {
    taxes = price * baseMillRate; // data error fallback
  }

  // Insurance
  const insurance = isCondo ? 480 : 1500;

  // Maintenance (% of price)
  const maintenanceRate = isCondo ? 0.005 : 0.01;
  const maintenance = price * maintenanceRate;

  // HOA / Condo Fees
  const hoa = (associationFee || 0) * 12;

  // Management Fee (8% of gross rent)
  const managementFee = annualRevenue * 0.08;
  const managementFeeFloor = annualRevenueP10 * 0.10;

  // Utilities (multi-family duplex single meter assumption: ~$3,500/yr)
  const utilities = !isCondo && propertySubType === 'Duplex' ? 3500 : 0;

  // Total Annual OpEx
  const annualOpex = taxes + insurance + maintenance + hoa + managementFee + utilities;
  const annualOpexFloor = taxes + (insurance * 1.2) + (maintenance * 1.5) + hoa + managementFeeFloor + utilities;

  // === CAP RATE ===
  // NO-RENT GUARD. Without a rent comp `annualRevenue` is 0, so NOI collapses to
  // -annualOpex and the cap rate comes out NEGATIVE — an expense ratio wearing a cap
  // rate's name. It measured 41,767 of 124,924 active for-sale listings, and only 653
  // of those negatives were real (a rent comp exists and the fees genuinely eat it).
  // "No comp" is not "loses money": emit the 0 sentinel every other guard in this file
  // already uses, which hasRentEstimate() and CAP_RATE_BAND both read as "no estimate".
  const annualNOI = grossRentNetVacancy - annualOpex;
  const annualNOIFloor = grossRentNetVacancyFloor - annualOpexFloor;
  const capRateEst = has_rent_data && price > 0 ? (annualNOI / price) * 100 : 0;
  const capRateFloor = has_rent_data && price > 0 ? (annualNOIFloor / price) * 100 : 0;

  // === GROSS YIELD ===
  const grossYieldEst = has_rent_data && price > 0 ? (annualRevenue / price) * 100 : 0;

  // === MONTHLY CASHFLOW ===
  // Mortgage: 80% LTV, 4.04%, 360 months under Canadian semi-annual compounding.
  const loanAmount = listPrice * 0.80;
  const mortgageMonthly = calculateCanadianMonthlyMortgage(loanAmount, 0.0404, 360);

  // Monthly cashflow. Same no-rent guard as the cap rate: with 0 revenue this is just
  // -(mortgage + opex), which reads as a deeply cash-negative property rather than one
  // we cannot underwrite. It measured 57,621 of the active set negative, 29,503 of them
  // for want of a comp alone.
  const monthlyGrossRent = annualRevenue / 12;
  // Insurance is already inside annualOpex / annualOpexFloor — deduct it exactly once (audit HIGH-8).
  const netMonthlyCashflow = has_rent_data
    ? (monthlyGrossRent * 0.96) - (mortgageMonthly + (annualOpex / 12))
    : 0;
  const netMonthlyCashflowFloor = has_rent_data
    ? ((annualRevenueP10 / 12) * 0.92) - (mortgageMonthly + (annualOpexFloor / 12))
    : 0;

  // === TAX BURDEN RATIO ===
  const taxBurdenRatio = price > 0 ? (taxes / price) * 100 : 0;
  const assessmentStatus = taxBurdenRatio > (baseMillRate * 100 + 0.25) ? 'OVER_ASSESSED'
    : taxBurdenRatio < (baseMillRate * 100 - 0.25) ? 'UNDER_ASSESSED_RISK'
    : 'MARKET_AVERAGE';

  return {
    cap_rate_est: Math.round(capRateEst * 100) / 100,
    cap_rate_floor: Math.round(capRateFloor * 100) / 100,
    gross_yield_est: Math.round(grossYieldEst * 100) / 100,
    price_discovery_flag: is_price_discovery,
    net_monthly_cashflow: Math.round(netMonthlyCashflow),
    cashflow_floor: Math.round(netMonthlyCashflowFloor),
    tax_burden_ratio: Math.round(taxBurdenRatio * 1000) / 1000,
    assessment_status: taxAnnualAmount === 0 ? 'UNASSESSED' : assessmentStatus,
    annual_opex: Math.round(annualOpex),
    annual_revenue: Math.round(annualRevenue),
    vacancy_loss: Math.round(vacancyLoss),
    mortgage_monthly: Math.round(mortgageMonthly),
  };
}

export default calculateFinancialMetrics;