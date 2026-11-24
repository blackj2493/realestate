/**
 * Sold prices: the shapes of data/sold-prices.json. Shared by scripts/data/buildSoldPrices.ts
 * (writes the file) and src/lib/data/soldPrices.ts (reads it), so the script never loads the
 * JSON it is about to write.
 */
import type { TypeGroup } from "@/lib/data/priceChangeModel";

export interface SoldStats {
  sales: number;
  medianPrice: number | null;
  /** Median sold price as a percent of the final asking price. */
  saleToAsk: number | null;
  /** Percent of sales above asking. */
  overAskShare: number | null;
  medianDom: number | null;
}

export interface SoldCommunity {
  name: string;
  sales: number;
  medianPrice: number;
  /** Median by home type; null when fewer than the minimum sales. */
  byType: Record<TypeGroup, number | null>;
}

export interface SoldCity {
  city: string;
  slug: string;
  all: SoldStats;
  byType: Record<TypeGroup, SoldStats | null>;
  /** Detached houses by bedrooms above ground: "2", "3", "4", "5+". */
  detachedByBeds: { beds: string; sales: number; medianPrice: number }[];
  communities: SoldCommunity[];
}

export interface SoldPricesFile {
  generatedAt: string;
  from: string;
  /** Exclusive. */
  to: string;
  cities: SoldCity[];
}
