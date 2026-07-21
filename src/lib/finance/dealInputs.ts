/**
 * The trio of mortgage inputs the buyer and investor lenses SHARE. Lifting these
 * to the calculator shell (rather than each lens owning its own) is what lets a
 * user set a down payment / rate / amortization once and have it carry across the
 * lens toggle. Everything else (rent, vacancy, opex on the investor side) stays
 * local to its lens.
 */
export interface SharedDealInputs {
  downPaymentPct: number;
  interestRatePct: number;
  amortYears: number;
}

/** Cold-start defaults for the shared inputs (rate is overridden by the live seed). */
export const DEFAULT_DOWN_PCT = 20;
export const DEFAULT_AMORT_YEARS = 25;
