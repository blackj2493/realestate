/**
 * The comp-derived monthly rent for a listing, recovered from `gross_yield_est`.
 *
 * WHY THIS EXISTS
 * ───────────────
 * The Underwriting Sandbox seeded its Monthly Rent from `seedMonthlyRent(price)` —
 * list price × 0.004, "the 1% rule, quartered". That is arithmetic on the ask, not a
 * rent: no location, no bedrooms, no property type. Its tell was visible on every
 * listing at once — Gross Yield printed exactly 4.80% everywhere, because 0.004 × 12
 * IS 4.8%. The tile restated the constant instead of measuring anything.
 *
 * Measured on X12909812, a 2bd Condo Townhouse in Barrhaven asking $379,000:
 *
 *   seedMonthlyRent (price × 0.004)      $1,516/mo    gross yield 4.80%
 *   rent ladder, `nbhd` rung             $2,300/mo    gross yield 7.28%
 *   the page's own VOW lease grid        $2,300 ×7    91 signed leases within 2km
 *
 * The ladder and the closed-lease grid agreed independently, 34% above the seed. The
 * error then cascaded: cashflow read −$1,178/mo and DSCR 0.30, so a listing whose own
 * data says it roughly covers itself presented as uninvestable.
 *
 * WHY INVERT THE YIELD RATHER THAN REFETCH
 * `gross_yield_est` is annual RENT / price × 100 and is rent-only by construction
 * (computeUnderwriting.ts, audit MEDIUM-12) — hypothetical suite income is deliberately
 * excluded from it. That is exactly the figure the Monthly Rent field wants, and it is
 * already on the listing document the detail page fetches for the cap rate. Inverting
 * costs nothing; a second rent lookup would cost a round trip and could disagree with
 * the cap rate sitting beside it.
 *
 * Stored to 2 decimal places, so the recovered rent is exact to well under a dollar at
 * any realistic price — and the user can edit it anyway. It is a seed, not a claim.
 */
import { grossYieldOrNull } from "./sanityBand";

/**
 * Monthly rent implied by a listing's gross yield, or null when there is no trustworthy
 * yield to invert. Band-guarded: an out-of-band yield is "no estimate", never a number.
 */
export function compMonthlyRentFrom(
  grossYieldPct: number | null | undefined,
  listPrice: number | null | undefined
): number | null {
  const gy = grossYieldOrNull(grossYieldPct);
  if (gy === null) return null;
  if (typeof listPrice !== "number" || !Number.isFinite(listPrice) || listPrice <= 0) return null;
  const monthly = (gy / 100) * listPrice / 12;
  if (!Number.isFinite(monthly) || monthly <= 0) return null;
  return Math.round(monthly);
}
