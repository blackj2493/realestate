/**
 * "Could this basement BECOME a suite, and what would it cost?"
 *
 * Distinct from hasObservedSuite() (src/lib/listings/observedSuite.ts), which asks
 * whether one exists TODAY. That one gates published income; this one gates a
 * scenario, and a scenario is allowed to cost money.
 *
 * WHY IT WIDENED
 * ──────────────
 * The first cut only offered the scenario when the feed already showed a separate
 * entrance or walk-out. Measured over 88,470 active freehold listings:
 *
 *   observed suite         → Split          11,076   12.5%
 *   entrance, no kitchen   → Add a suite    14,508   16.4%
 *   basement, no entrance  → NOTHING        44,804   50.6%
 *   unfinished basement    → NOTHING        16,431   18.6%
 *   no basement / crawl    → nothing         10,014   11.3%   (correct)
 *
 * 69% of freehold listings got no suite scenario at all, including homes with a full
 * basement whose only fault was that the feed did not mention a side door. Showing
 * nothing is not the conservative choice there — it just withholds the arithmetic.
 * The honest fix is to offer it and let the COST carry the difficulty.
 *
 * COST MODEL — compositional, from the value-add catalog rather than invented:
 *
 *   legal_suite      50k / 75k / 120k   (src/lib/avm/valueAdd/moveCatalog.ts)
 *   + finish_basement 25k / 40k /  65k   when the basement is unfinished
 *   + entrance allowance                 when no entrance is described
 *
 * The entrance allowance is the one figure NOT in the catalog — it is a stated
 * allowance for cutting, underpinning and waterproofing a below-grade entrance, not a
 * measured median. That uncertainty is exactly why the UI shows a RANGE with a
 * draggable slider instead of a single number, and why the copy says the scenario
 * ASSUMES an entrance can be added. On some lots, grading or setbacks make it
 * impossible and no field in the feed can tell us that.
 */

import { CONVERSION_COSTS } from "@/lib/avm/valueAdd/moveCatalog";

/** Basement descriptors that rule a conversion out entirely. */
const FATAL = ["none", "crawl space", "half"];
/** Descriptors that mean a separate way in already exists. */
const ENTRANCE = ["separate entrance", "walk-out", "walk out", "walk-up", "walk up", "apartment"];

export interface SuiteConversionInput {
  PropertyType?: string | null;
  PropertySubType?: string | null;
  CondoCorpNumber?: string | number | null;
  KitchensBelowGrade?: number | string | null;
  Basement?: unknown;
}

export interface SuiteConversion {
  /** Cost to create the suite, in dollars. Seeded at `typical`, slider-bounded by the pair. */
  low: number;
  typical: number;
  high: number;
  /** True when no entrance is described, so the estimate carries an allowance for one. */
  needsEntrance: boolean;
  /** True when the basement is unfinished, so finishing is in the estimate too. */
  needsFinishing: boolean;
}

const has = (list: string[], needles: string[]) =>
  list.some((b) => needles.some((n) => b.includes(n)));

/**
 * The conversion scenario for a listing, or null when it does not apply — a condo, a
 * home that already HAS a suite (that one gets Split instead), or no real basement.
 */
export function suiteConversion(listing: SuiteConversionInput): SuiteConversion | null {
  const subType = (listing.PropertySubType ?? "").toString().trim();
  const propertyType = (listing.PropertyType ?? "").toString();
  if (propertyType.includes("Condo") || listing.CondoCorpNumber || subType === "Condo Townhouse") {
    return null;
  }
  // A home with a second kitchen already has the suite; Split is its scenario.
  const kitchens = Number(listing.KitchensBelowGrade ?? 0);
  if (Number.isFinite(kitchens) && kitchens > 0) return null;

  if (!Array.isArray(listing.Basement)) return null;
  const basement = listing.Basement
    .filter((b): b is string => typeof b === "string")
    .map((b) => b.toLowerCase().trim());
  if (basement.length === 0) return null;
  // Same fatal set calculateMultiUnitPotential uses — nothing to convert.
  if (has(basement, FATAL)) return null;

  const needsEntrance = !has(basement, ENTRANCE);
  const needsFinishing = basement.some((b) => b.includes("unfinished"));

  const base = CONVERSION_COSTS.legalSuite;
  const finish = needsFinishing ? CONVERSION_COSTS.finishBasement : { low: 0, typical: 0, high: 0 };
  const entrance = needsEntrance ? CONVERSION_COSTS.entranceAllowance : { low: 0, typical: 0, high: 0 };

  return {
    low: base.low + finish.low + entrance.low,
    typical: base.typical + finish.typical + entrance.typical,
    high: base.high + finish.high + entrance.high,
    needsEntrance,
    needsFinishing,
  };
}

/** One line saying what the estimate assumes. The reader has to be able to disagree. */
export function suiteConversionNote(c: SuiteConversion): string {
  const parts: string[] = [];
  if (c.needsFinishing) parts.push("finishing the basement");
  if (c.needsEntrance) parts.push("adding a separate entrance");
  if (parts.length === 0) return "Assumes a legal second unit built into the existing basement.";
  return `Includes ${parts.join(" and ")}. Some lots cannot take an entrance — check before you count on it.`;
}
