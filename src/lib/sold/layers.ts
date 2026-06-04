import type { TransactionMode } from "@/lib/filters/fundamentals";

export type LayerKey = "forSale" | "sold" | "leased" | "forRent";
export const LAYER_KEYS: LayerKey[] = ["forSale", "sold", "leased", "forRent"];

/** Toggle a layer; never returns an empty set (the last lit layer stays on).
 *  forSale/forRent are mutually exclusive (different price contexts); lighting one
 *  clears the other. Sold/Leased comp overlays are independent. */
export function toggleLayer(layers: Set<LayerKey>, key: LayerKey): Set<LayerKey> {
  const next = new Set(layers);
  if (next.has(key)) {
    if (next.size === 1) return next; // refuse to empty
    next.delete(key);
  } else {
    next.add(key);
    if (key === "forSale") next.delete("forRent");
    if (key === "forRent") next.delete("forSale");
  }
  return next;
}

/** Price-slider / class axis follow the active transaction: sale wins, else rent. */
export function transactionModeForLayers(layers: Set<LayerKey>): TransactionMode {
  if (layers.has("forSale")) return "sale";
  if (layers.has("forRent")) return "rent";
  return "sale";
}

export interface LayerQueryPlan {
  active: { enabled: true; sale: boolean; rent: boolean } | null;
  comps: Array<"sold" | "leased">;
}

/** Which sources to fetch: one active Typesense query (sale/rent) + comp routes. */
export function queryPlan(layers: Set<LayerKey>): LayerQueryPlan {
  const sale = layers.has("forSale");
  const rent = layers.has("forRent");
  const comps: Array<"sold" | "leased"> = [];
  if (layers.has("sold")) comps.push("sold");
  if (layers.has("leased")) comps.push("leased");
  return { active: sale || rent ? { enabled: true, sale, rent } : null, comps };
}
