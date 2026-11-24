/**
 * School catchment prices: score bands and the shapes of data/school-prices.json. Shared by
 * scripts/data/buildSchoolPrices.ts (writes the file) and src/lib/data/schoolPrices.ts (reads
 * it), so the script never loads the JSON it is about to write.
 */

/** PureProperty School Score bands (0–10, from EQAO). "7to8" is the comparison band. */
export const SCORE_BANDS = ["lt6", "6to7", "7to8", "8to9", "9plus"] as const;
export type ScoreBand = (typeof SCORE_BANDS)[number];
export const BASE_BAND: ScoreBand = "7to8";

export const BAND_LABEL: Record<ScoreBand, string> = {
  lt6: "Below 6",
  "6to7": "6 to 7",
  "7to8": "7 to 8",
  "8to9": "8 to 9",
  "9plus": "9 and up",
};

export function bandOf(score: number): ScoreBand {
  if (score < 6) return "lt6";
  if (score < 7) return "6to7";
  if (score < 8) return "7to8";
  if (score < 9) return "8to9";
  return "9plus";
}

export interface Gap {
  /** Percent, e.g. 6.2 = +6.2%. */
  pct: number;
  lo: number;
  hi: number;
  significant: boolean;
}

export interface CatchmentRow {
  school: string;
  score: number;
  sales: number;
  medianPrice: number;
  /** Median sale against similar houses in the same city (type, bedrooms, size, half-year), percent. */
  vsSimilar: number;
}

export interface SchoolCity {
  city: string;
  slug: string;
  board: string;
  /** Houses matched to a scored catchment. */
  sales: number;
  medianPrice: number | null;
  /** Price gap per school-score point, similar houses in the same community. */
  perPoint: Gap | null;
  /** Price gap of each band against the 7–8 band; the base band is null. */
  bands: Record<ScoreBand, (Gap & { sales: number }) | null>;
  catchments: CatchmentRow[];
}

export interface SchoolPricesFile {
  generatedAt: string;
  from: string;
  /** Exclusive. */
  to: string;
  cities: SchoolCity[];
}
