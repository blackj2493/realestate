/**
 * The market-board figures for the extra study cities (London, Kitchener, ...), for
 * /data/housing-market/{city}. The 15 board cities read region_metrics instead.
 *
 * DATA. data/city-markets.json, built weekly by scripts/data/buildCityMarkets.ts. Static.
 */
import raw from "@/data/city-markets.json";
import type { CityMarket, CityMarketsFile } from "@/lib/data/cityMarketsModel";
export * from "@/lib/data/cityMarketsModel";

export function getCityMarkets(): CityMarketsFile {
  return raw as unknown as CityMarketsFile;
}

export function cityMarketBySlug(slug: string): CityMarket | null {
  return getCityMarkets().cities.find((c) => c.slug === slug.toLowerCase()) ?? null;
}
