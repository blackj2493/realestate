/**
 * Types for data/city-markets.json: the market-board figures for the extra study cities
 * (EXTRA_STUDY_CITIES), which the nightly region_metrics precompute does not cover. Built
 * weekly by scripts/data/buildCityMarkets.ts with the same definitions as the region RPCs
 * (region_price_trend 109; region_sold_dynamics, region_dom_distribution, region_price_cuts
 * and region_rental_yield 153), but with the city filter of the study pages and no
 * CountyOrParish match: county "Waterloo" holds Kitchener and Cambridge, and county
 * "Peterborough" its townships.
 *
 * Kept apart from cityMarkets.ts so the build script never imports the file it writes.
 */
import type { MarketRow, RentalRow } from "@/lib/data/marketBoard";

export interface CityMarket {
  city: string;
  slug: string;
  /** Full months only: median sale price, sales and the average sale-to-final-asking (%). */
  monthly: { month: string; medianPrice: number; sales: number; soldToList: number | null }[];
  sales90: number;
  soldToListPct: number | null;
  pctOverAsking: number | null;
  soldCount12m: number;
  /** Days to sell, homes sold in the last 12 months (region_sold_dynamics). */
  soldMedianDom: number | null;
  soldP25Dom: number | null;
  soldP75Dom: number | null;
  /** Homes for sale now: relists joined, and the listing's own clock (region_dom_distribution). */
  trueDom: number | null;
  medianNaiveDom: number | null;
  domBuckets: MarketRow["domBuckets"];
  underAskShare: number | null;
  askGapMedian: number | null;
  activeCount: number;
  cutCount: number;
  medianCutPct: number | null;
  medianCutAmt: number | null;
  monthsOfSupply: number | null;
  temperature: MarketRow["temperature"];
  /** Rent against the 12-month median sale price, by bedroom count (region_rental_yield),
   *  with the sample sizes. */
  rentalRows: (RentalRow & { rentSample: number; priceSample: number })[];
}

export interface CityMarketsFile {
  generatedAt: string;
  cities: CityMarket[];
}

/** A bedroom row of rent needs this many rents. The board's rows carry no sample size; its
 *  15 markets have hundreds per row. The extra cities go down to single digits (Kingston). */
export const MIN_RENT_SAMPLE = 10;

/** The board row shape buildOutlook reads; fields this file does not measure are null. */
export function toMarketRow(c: CityMarket): MarketRow {
  const last = c.monthly[c.monthly.length - 1];
  return {
    region: c.city,
    medianPrice: last?.medianPrice ?? null,
    avgPrice: null,
    yoyPct: null,
    medianPpsf: null,
    activeCount: c.activeCount,
    monthsOfSupply: c.monthsOfSupply,
    soldToListPct: c.soldToListPct,
    trueDom: c.trueDom,
    medianNaiveDom: c.medianNaiveDom,
    soldMedianDom: c.soldMedianDom,
    soldP25Dom: c.soldP25Dom,
    soldP75Dom: c.soldP75Dom,
    sellThroughPct: null,
    stalePct: null,
    temperature: c.temperature,
    priceSeries: c.monthly.map((m) => ({ month: m.month, v: m.medianPrice })),
    cutShare: c.activeCount > 0 ? c.cutCount / c.activeCount : null,
    cutCount: c.cutCount,
    cutActive: c.activeCount,
    medianCutPct: c.medianCutPct,
    medianCutAmt: c.medianCutAmt,
    domBuckets: c.domBuckets,
    rentalRows: c.rentalRows
      .filter((r) => r.rentSample >= MIN_RENT_SAMPLE)
      .map(({ beds, typicalRent, medianPrice, grossYieldPct }) => ({ beds, typicalRent, medianPrice, grossYieldPct })),
    underAskShare: c.underAskShare,
    askGapMedian: c.askGapMedian,
    soldCount12m: c.soldCount12m,
    pctOverAsking: c.pctOverAsking,
    sales90: c.sales90,
    monthly: c.monthly,
    seasonality: [],
  };
}
