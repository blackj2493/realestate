/**
 * Ontario land transfer tax and the City of Toronto municipal land transfer tax (MLTT), for a
 * home: land with one or two single family residences. Pure, so the calculator and the static
 * city pages give the same number.
 *
 * Read from the official pages on 2026-11-26:
 * - Ontario rates: ontario.ca "Calculating Land Transfer Tax" (updated April 22, 2026).
 * - Ontario first-time homebuyer refund, up to $4,000: ontario.ca "Land Transfer Tax Refunds for
 *   First-Time Homebuyers" (updated February 10, 2026).
 * - Toronto MLTT rates, with the higher luxury rates over $3,000,000 from April 1, 2026:
 *   toronto.ca "MLTT Rates and Fees" (modified April 7, 2026).
 * - Toronto first-time buyer rebate, up to $4,475: toronto.ca "MLTT Rebate Opportunities"
 *   (modified December 18, 2025).
 * Re-check these pages when a budget changes a rate; LTT_RULES_CHECKED says when we last did.
 */
export const LTT_RULES_CHECKED = "2026-11-26";

/** [upper limit of the bracket, rate]; the last bracket has no limit. */
type Brackets = [number, number][];

export const ONTARIO_BRACKETS: Brackets = [
  [55_000, 0.005],
  [250_000, 0.01],
  [400_000, 0.015],
  [2_000_000, 0.02],
  [Infinity, 0.025],
];

export const TORONTO_BRACKETS: Brackets = [
  [55_000, 0.005],
  [250_000, 0.01],
  [400_000, 0.015],
  [2_000_000, 0.02],
  [3_000_000, 0.025],
  [4_000_000, 0.044],
  [5_000_000, 0.0545],
  [10_000_000, 0.065],
  [20_000_000, 0.0755],
  [Infinity, 0.086],
];

export const ONTARIO_FIRST_TIME_MAX = 4_000;
export const TORONTO_FIRST_TIME_MAX = 4_475;

const cents = (n: number) => Math.round(n * 100) / 100;

function bracketTax(price: number, brackets: Brackets): number {
  let tax = 0;
  let floor = 0;
  for (const [limit, rate] of brackets) {
    if (price <= floor) break;
    tax += (Math.min(price, limit) - floor) * rate;
    floor = limit;
  }
  return cents(tax);
}

export const ontarioLtt = (price: number) => bracketTax(Math.max(0, price), ONTARIO_BRACKETS);
export const torontoMltt = (price: number) => bracketTax(Math.max(0, price), TORONTO_BRACKETS);

export interface LttResult {
  price: number;
  ontario: number;
  toronto: number;
  /** Ontario first-time homebuyer refund (0 when not a first-time buyer). */
  ontarioRefund: number;
  /** Toronto first-time buyer rebate (0 outside Toronto or when not a first-time buyer). */
  torontoRebate: number;
  /** What the buyer pays after the refund and rebate. */
  total: number;
}

export function landTransferTax(price: number, opts: { toronto: boolean; firstTime: boolean }): LttResult {
  const p = Math.max(0, Math.round(price));
  const ontario = ontarioLtt(p);
  const toronto = opts.toronto ? torontoMltt(p) : 0;
  const ontarioRefund = opts.firstTime ? Math.min(ontario, ONTARIO_FIRST_TIME_MAX) : 0;
  const torontoRebate = opts.firstTime && opts.toronto ? Math.min(toronto, TORONTO_FIRST_TIME_MAX) : 0;
  return { price: p, ontario, toronto, ontarioRefund, torontoRebate, total: cents(ontario + toronto - ontarioRefund - torontoRebate) };
}
