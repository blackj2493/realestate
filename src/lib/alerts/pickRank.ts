/**
 * Which of tonight's new listings earn the six rows in an area section — pure (§4).
 *
 * The section used to be the six NEWEST, which is close to random on quality. Measured on
 * one night of Toronto (268 new listings, 2026-09-12), the six newest included a
 * LOW-confidence estimate, a home asking 31% ABOVE its estimate, and a "Sale Of Business".
 * Over the same night, only 6 of the 20 best-priced listings sat inside the newest 100 —
 * recency and value are close to independent, so ordering by one discards the other.
 *
 * COMPLIANCE — the estimate ORDERS the rows and never appears in them. The AVM is
 * VOW-derived (property_estimates is built from closed sales), and the audit's rule is the
 * one digest.ts already follows for sold prices: tease in the email, disclose behind the
 * authenticated session. So this module returns a sort key, the email prints address,
 * price, beds and brokerage exactly as before, and the only per-row line it adds is an
 * IDX-safe one (a price cut, whose magnitude and direction the audit clears for email).
 */

/** Estimates we will rank on. LOW confidence is noise at this sample size — 284 of 1,598 rows. */
export const PICK_CONFIDENCE: ReadonlySet<string> = new Set(["HIGH", "MEDIUM"]);

/**
 * Largest gap we treat as a price signal rather than a data fault.
 *
 * The night's gap distribution tops out at p99 = 25.8%, so a third under the estimate is
 * already far into the tail, and what lives out there is mostly the AVM meeting something
 * it cannot model — a leasehold, a co-op, an estate sale, a tear-down priced as land.
 * Those are not the homes to lead a stranger's inbox with.
 */
export const PICK_GAP_CEILING = 0.35;

/** A cut worth printing. Below this it is a rounding change, not news. */
export const PICK_MIN_CUT = 10_000;
/**
 * Above this share of the ask, `TotalPriceDrop` is not a cut.
 *
 * The field carries relist artifacts: across one night's 526 cut listings the magnitude
 * runs to 164% of the ask, and 48 of them clear 25%. p90 is 23%, so this keeps the real
 * distribution and drops the impossible tail.
 */
export const PICK_MAX_CUT_SHARE = 0.25;

export interface PickEstimate {
  estimatedValue: number | null;
  confidence: string | null;
}

/**
 * Sort key for one listing: how far under its estimate it is asking, as a share of the
 * estimate. Null means "do not rank this one" — no estimate, confidence we don't trust,
 * asking at or above the estimate, or a gap too wide to believe. A null-scored listing
 * still reaches the email; it just sorts behind every scored one.
 */
export function pickScore(
  listPrice: number | null | undefined,
  est: PickEstimate | null | undefined
): number | null {
  const value = Number(est?.estimatedValue);
  const price = Number(listPrice);
  if (!est || !PICK_CONFIDENCE.has(est.confidence ?? "")) return null;
  if (!Number.isFinite(value) || value <= 0) return null;
  if (!Number.isFinite(price) || price <= 0) return null;
  const gap = (value - price) / value;
  if (gap <= 0 || gap > PICK_GAP_CEILING) return null;
  return gap;
}

/** The cut to print beside a row, or null when there is nothing trustworthy to say. */
export function sanePriceCut(
  cut: number | null | undefined,
  listPrice: number | null | undefined
): number | null {
  const amount = Number(cut);
  const price = Number(listPrice);
  if (!Number.isFinite(amount) || amount < PICK_MIN_CUT) return null;
  if (!Number.isFinite(price) || price <= 0) return null;
  if (amount > price * PICK_MAX_CUT_SHARE) return null;
  return Math.round(amount);
}

/**
 * Newest-first inside the ranking, so an unscored area (no estimates at all — commercial,
 * land, a thin rural cohort) keeps exactly the order it has today.
 */
export function comparePicks(
  a: { score?: number | null; entryMs: number },
  b: { score?: number | null; entryMs: number }
): number {
  const sa = a.score ?? -1;
  const sb = b.score ?? -1;
  return sb !== sa ? sb - sa : b.entryMs - a.entryMs;
}
