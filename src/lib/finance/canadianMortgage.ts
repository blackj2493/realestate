/**
 * Canadian mortgage payment math.
 *
 * The Interest Act of Canada (s.6) prohibits residential mortgage interest
 * from being compounded more frequently than semi-annually. Stated annual
 * rates are therefore semi-annual nominal — the effective monthly rate used
 * for amortization is:
 *
 *     r_monthly = (1 + annualRate / 2)^(1/6) − 1
 *
 * This is the formula CMHC, RBC, TD, etc. all use. Using `annualRate / 12`
 * (US convention) over-charges; using `annualRate / 24` (the prior bug in
 * transformer.ts) under-charges by ~23% on typical inputs.
 *
 * All shipped carry-cost / burn-rate / cashflow / cap-rate numbers derive
 * from this function — it's the single source of truth.
 */

/** Effective monthly rate from a stated annual rate under semi-annual compounding. */
export function canadianEffectiveMonthlyRate(annualRate: number): number {
  return Math.pow(1 + annualRate / 2, 1 / 6) - 1;
}

/**
 * Level monthly payment that fully amortizes `principal` over `months` at the
 * given stated annual rate, using Canadian semi-annual compounding.
 *
 * Returns 0 for any non-positive input (defensive: many call sites pass null
 * data through).
 */
export function calculateCanadianMonthlyMortgage(
  principal: number,
  annualRate: number,
  months: number
): number {
  if (principal <= 0 || annualRate <= 0 || months <= 0) return 0;

  const r = canadianEffectiveMonthlyRate(annualRate);
  const factor = Math.pow(1 + r, months);
  return (principal * (r * factor)) / (factor - 1);
}
