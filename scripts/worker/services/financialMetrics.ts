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

  // True Value
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
  multiUnitStatus: string;
  isCondo: boolean;
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
    baseMillRate, multiUnitStatus, isCondo,
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

  const price = calculation_price || 1;
  const isSuiteCandidate = multiUnitStatus === 'EXISTING_MULTI_UNIT' || multiUnitStatus === 'PRIME_CANDIDATE';

  // === ANNUAL REVENUE ===
  const annualRevenue = has_rent_data ? annual_rent : 0;
  const annualRevenueP10 = has_rent_data ? annual_rent_p10 : annualRevenue * 0.85;
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
  const annualNOI = grossRentNetVacancy - annualOpex;
  const annualNOIFloor = grossRentNetVacancyFloor - annualOpexFloor;
  const capRateEst = price > 0 ? (annualNOI / price) * 100 : 0;
  const capRateFloor = price > 0 ? (annualNOIFloor / price) * 100 : 0;

  // === GROSS YIELD ===
  const grossYieldEst = price > 0 ? (annualRevenue / price) * 100 : 0;

  // === MONTHLY CASHFLOW ===
  // Mortgage: 80% LTV, 4.04%, 360 months under Canadian semi-annual compounding.
  const loanAmount = listPrice * 0.80;
  const mortgageMonthly = calculateCanadianMonthlyMortgage(loanAmount, 0.0404, 360);

  // Monthly cashflow
  const monthlyGrossRent = annualRevenue / 12;
  // Insurance is already inside annualOpex / annualOpexFloor — deduct it exactly once (audit HIGH-8).
  const netMonthlyCashflow = (monthlyGrossRent * 0.96) - (mortgageMonthly + (annualOpex / 12));
  const netMonthlyCashflowFloor = ((annualRevenueP10 / 12) * 0.92) - (mortgageMonthly + (annualOpexFloor / 12));

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