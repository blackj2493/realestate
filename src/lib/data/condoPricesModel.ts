/**
 * Condo prices: unit types and the shapes of data/condo-prices.json. Shared by
 * scripts/data/buildCondoPrices.ts (which writes the file) and src/lib/data/condoPrices.ts
 * (which reads it), so the script never loads the JSON it is about to write.
 */
/** Unit types by bedrooms: above grade, and total (a den is counted in the total only). */
export const UNIT_TYPES = ["studio", "one", "oneDen", "two", "twoDen", "three"] as const;
export type UnitType = (typeof UNIT_TYPES)[number];

export const UNIT_LABEL: Record<UnitType, string> = {
  studio: "Studio",
  one: "1 bedroom",
  oneDen: "1 bedroom + den",
  two: "2 bedrooms",
  twoDen: "2 bedrooms + den",
  three: "3 bedrooms or more",
};

/** Unit type from above-grade and total bedrooms (TRREB counts a den in BedroomsTotal). */
export function unitTypeOf(aboveGrade: number, total: number | null): UnitType | null {
  const t = total ?? aboveGrade;
  if (aboveGrade <= 0) return t <= 1 ? "studio" : null;
  if (aboveGrade === 1) return t <= 1 ? "one" : "oneDen";
  if (aboveGrade === 2) return t <= 2 ? "two" : "twoDen";
  return "three";
}

export interface CondoStats {
  sales: number;
  medianPrice: number | null;
  /** Midpoint of the size ranges, sq ft. */
  medianSqft: number | null;
  /** Approximate: price over the size-range midpoint. */
  pricePsf: number | null;
  /** Monthly condo fee. */
  medianFee: number | null;
  /** Approximate: monthly fee over the size-range midpoint. */
  feePsf: number | null;
  /** Sales with a usable fee. */
  feeSample: number;
  /** Median sold price as a percent of the final asking price. */
  saleToAsk: number | null;
  /** Percent of sales above the asking price. */
  overAskShare: number | null;
  medianDom: number | null;
}

export interface CondoArea {
  city: string;
  slug: string;
  all: CondoStats;
  byUnit: Record<UnitType, CondoStats | null>;
  communities: ({ name: string } & CondoStats)[];
}

export interface CondoPricesFile {
  generatedAt: string;
  from: string;
  /** Exclusive. */
  to: string;
  cities: CondoArea[];
}
