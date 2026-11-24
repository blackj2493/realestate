/**
 * The market-board figures for the extra study cities (London, Kitchener, ...), for
 * /data/housing-market, /data/days-on-market and /data/good-time-to-buy. The 15 board
 * cities read region_metrics instead.
 *
 * DATA. data/city-markets.json, built weekly by scripts/data/buildCityMarkets.ts. Static.
 */
import raw from "@/data/city-markets.json";
import { toMarketRow, type CityMarket, type CityMarketsFile } from "@/lib/data/cityMarketsModel";
import type { MarketRow } from "@/lib/data/marketBoard";
import { OUTLOOK_CITIES } from "@/lib/data/outlookCities";
export * from "@/lib/data/cityMarketsModel";

export function getCityMarkets(): CityMarketsFile {
  return raw as unknown as CityMarketsFile;
}

export function cityMarketBySlug(slug: string): CityMarket | null {
  return getCityMarkets().cities.find((c) => c.slug === slug.toLowerCase()) ?? null;
}

/** The board row shape of every extra city, for pages that rank or compare all covered cities. */
export function extraMarketRows(): MarketRow[] {
  return getCityMarkets().cities.map(toMarketRow);
}

/** Every covered city as a board row: the board markets, then the extra cities. */
export function coveredMarketRows(boardRows: MarketRow[]): MarketRow[] {
  return [...boardRows, ...extraMarketRows()];
}

/** Every covered city: the board markets, then the extra cities. */
export function coveredMarketCities(): { city: string; slug: string }[] {
  return [...OUTLOOK_CITIES, ...getCityMarkets().cities.map((c) => ({ city: c.city, slug: c.slug }))];
}
