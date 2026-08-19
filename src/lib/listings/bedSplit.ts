/**
 * Bed-count classifier — splits "2+1" into its whole-bedroom and plus-room parts.
 *
 * THE PROBLEM THIS EXISTS TO FIX. TRREB reports beds as two fields and the feed's
 * `BedroomsTotal` is their SUM (measured: 188,059 of 188,060 sold condo apartments).
 * So a 1-bed-plus-den arrives as BedroomsTotal=2 and, until this module, landed in
 * every "2 bedroom" statistic we publish. It is not a 2 bedroom. Measured on Toronto
 * condo apartments over 24 months: the "2 bed" lease cell was 52.6% plus-den units,
 * and the two halves lease $500/mo apart ($2,950 true 2bd vs $2,450 for 1+1). The
 * sale side is worse — the "3 bed" cell is 72.8% 2+1 units.
 *
 * WHAT `below` MEANS depends on the property. In a condo tower it is a den (a tower
 * unit has no basement). In a house it is a basement bedroom. Both are real, both
 * change the price, and both are quoted by the market as "N+1" — so this module does
 * NOT try to tell them apart and callers must not label the axis "den". Use the
 * neutral `N+1`, which is what `bedsLabel` already renders on the listing cards.
 *
 * Pure (no React, no "use client") so Server Components and the worker scripts can
 * both import it.
 */

/** Raw feed/Typesense bed fields, in their wire casing. */
export interface BedCountsRaw {
  BedroomsAboveGrade?: number | null;
  BedroomsBelowGrade?: number | null;
  BedroomsTotal?: number | null;
}

export interface BedSplit {
  /** Whole bedrooms above grade — the grid's bedroom axis. */
  above: number;
  /** Raw plus-room count. The AVM wants this; the grid caps it (see `den`). */
  below: number;
  /** `below` capped to a flag: 0 or 1. Bounds the grid's column count. */
  den: 0 | 1;
  /**
   * FALSE when the source never carried `BedroomsBelowGrade` at all — absent is not
   * the same as a confirmed zero. 1.2% of `sold_listings` docs omit the field (it is
   * `optional: true` in the Typesense schema), and an aggregate that treats those as
   * "no den" quietly recreates the bug it is here to fix. Callers that publish a
   * median should drop `denKnown: false` rows rather than bank them into the plain
   * column.
   */
  denKnown: boolean;
}

/** Grid column cap: `above` at 6 means "6+"; matches BEDS_BUCKET_CAP in the matrix. */
export const BED_ABOVE_CAP = 6;

const int = (v: number | null | undefined): number | null =>
  typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.trunc(v)) : null;

/**
 * Split a listing's bed fields. Returns null when there is no bed data at all — the
 * caller drops the row rather than inventing a zero.
 *
 * The `above` recovery path matters. TRREB sometimes ships `BedroomsAboveGrade` empty
 * while `BedroomsTotal` carries the 4+1 = 5 sum. `bedsLabel` currently falls back to
 * the total in that case and renders "5+1", which overstates the home by a bedroom.
 * Here we subtract the below-grade count back off when the arithmetic allows it, so
 * the same listing classifies as 4+1.
 */
export function bedSplit(p: BedCountsRaw): BedSplit | null {
  const rawAbove = int(p.BedroomsAboveGrade);
  const rawBelow = int(p.BedroomsBelowGrade);
  const rawTotal = int(p.BedroomsTotal);

  const denKnown = p.BedroomsBelowGrade !== undefined && p.BedroomsBelowGrade !== null;
  const below = rawBelow ?? 0;

  let above: number;
  if (rawAbove !== null && rawAbove > 0) {
    above = rawAbove;
  } else if (rawTotal !== null) {
    // `above` is missing or zero and the total carries the SUM, so subtract the
    // plus-rooms back off. This one line settles both readings of a zero: a real
    // studio+den (total 1, below 1) lands on 0, and TRREB's empty-above 4+1
    // (total 5, below 1) lands on 4 instead of the 5 that `bedsLabel` shows today.
    above = Math.max(0, rawTotal - below);
  } else {
    above = 0;
  }

  if (above === 0 && below === 0 && rawTotal === null && rawAbove === null) return null;

  return { above, below, den: below > 0 ? 1 : 0, denKnown };
}

/**
 * Grid column key — "2" or "2+1". `above` caps at `BED_ABOVE_CAP` (6 = "6+") and the
 * plus-room caps at 1, so a 2+2 shares the 2+1 column. The cell's own sample count
 * stays the honesty device for what is inside it.
 */
export function bedKey(s: Pick<BedSplit, "above" | "den">, cap = BED_ABOVE_CAP): string {
  const above = Math.min(cap, s.above);
  // At the cap the plus-room distinction is noise on a handful of samples, and a
  // "6++1" header reads as a typo — fold it into the one "6+" column.
  if (above >= cap) return `${above}`;
  return s.den > 0 ? `${above}+1` : `${above}`;
}

/** Sort rank for a column key. Orders 0, 0+1, 1, 1+1, 2, 2+1, … */
export function bedKeyOrder(key: string): number {
  const [aboveStr, denStr] = key.split("+");
  return (parseInt(aboveStr, 10) || 0) * 2 + (denStr ? 1 : 0);
}

/** Parse a column key back to its parts. Tolerates a malformed key by reading zeros. */
export function parseBedKey(key: string): { above: number; den: 0 | 1 } {
  const [aboveStr, denStr] = key.split("+");
  return { above: parseInt(aboveStr, 10) || 0, den: denStr ? 1 : 0 };
}

/**
 * Column header text. Studio is a real bucket (bachelor units lease constantly) and
 * a studio CAN carry a den — 755 such condo apartments have sold.
 */
export function bedKeyLabel(key: string, cap = BED_ABOVE_CAP): string {
  const { above, den } = parseBedKey(key);
  if (above >= cap) return `${cap}+ bd`;          // capped bucket carries no plus-room
  const base = above === 0 ? "Studio" : `${above}`;
  if (den === 0) return above === 0 ? base : `${base} bd`;
  return above === 0 ? `${base}+1` : `${base}+1 bd`;
}
