/**
 * Best time to sell: the shapes of data/best-time-to-sell.json, and the pure month-effect math.
 * Shared by scripts/data/buildBestTimeToSell.ts (writes the file) and
 * src/lib/data/bestTimeToSell.ts (reads it), so the script never loads the JSON it writes.
 */
import { asPct, type WithinCellFit } from "@/lib/data/withinCellModel";

/** A gap in percent with its 95% range. */
export interface Gap {
  pct: number;
  lo: number;
  hi: number;
  significant: boolean;
}

export interface MonthStats {
  /** 1–12, the month the deal was signed. */
  month: number;
  /** Sales over the 2 years (each calendar month counted twice). */
  sales: number;
  /** Median sold price as a percent of the final asking price. */
  saleToAsk: number | null;
  /** Percent of sales above asking. */
  overAskShare: number | null;
  medianDom: number | null;
  /** Price against similar homes in the average month, with the trend removed. Null when the model did not fit. */
  price: Gap | null;
}

export interface WeekdayStats {
  /** 0 = Sunday … 6 = Saturday, the day the home was listed. */
  day: number;
  sales: number;
  overAskShare: number | null;
  medianDom: number | null;
}

export interface SellCity {
  city: string;
  slug: string;
  sales: number;
  months: MonthStats[];
  /** Days of the week the sold homes were listed; empty when too few. */
  weekdays: WeekdayStats[];
}

export interface BestTimeFile {
  generatedAt: string;
  /** First month in the window (inclusive). */
  from: string;
  /** Exclusive. */
  to: string;
  cities: SellCity[];
}

const pctile = (sorted: number[], q: number) => {
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  return sorted[lo] + (sorted[Math.min(lo + 1, sorted.length - 1)] - sorted[lo]) * (i - lo);
};

/**
 * Month terms are dummies for February…December against January (`names[0..10]` of the fit).
 * Each month's effect is re-centred on the mean of the 12 months, so it reads "against the
 * average month", with a 95% range from the same bootstrap draws. Null when a month term was
 * dropped or the draws are missing.
 */
export function monthEffects(fit: WithinCellFit, monthTerms: string[]): (Gap | null)[] | null {
  if (!fit.beta || !fit.draws || monthTerms.length !== 11) return null;
  const idx = monthTerms.map((_, i) => i);
  if (idx.some((i) => !Number.isFinite(fit.beta![i]))) return null;
  const centre = (b: number[]) => {
    const e = [0, ...idx.map((i) => b[i])];
    const mean = e.reduce((a, v) => a + v, 0) / 12;
    return e.map((v) => v - mean);
  };
  const point = centre(fit.beta);
  const draws = fit.draws.map(centre);
  return point.map((b, m) => {
    const s = draws.map((d) => d[m]).sort((a, z) => a - z);
    const lo = pctile(s, 0.025);
    const hi = pctile(s, 0.975);
    return { pct: asPct(b), lo: asPct(lo), hi: asPct(hi), significant: lo > 0 || hi < 0 };
  });
}
