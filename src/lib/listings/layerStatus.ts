import type { ListingDocument } from "@/lib/typesense/client";
export type LayerTone = "sale" | "sold" | "leased" | "rent";
export interface LayerStatus { label: string; tone: LayerTone; }

/** The status chip for any merged doc — comp kind first, else active TransactionType. */
export function layerStatus(doc: ListingDocument): LayerStatus {
  if (doc.compKind === "sold") return { label: "SOLD", tone: "sold" };
  if (doc.compKind === "leased") return { label: "LEASED", tone: "leased" };
  if (doc.TransactionType && /lease/i.test(doc.TransactionType)) return { label: "FOR RENT", tone: "rent" };
  return { label: "FOR SALE", tone: "sale" };
}

export const LAYER_TONE_CLASS: Record<LayerTone, string> = {
  sale: "bg-emerald-500/15 text-emerald-300",
  sold: "bg-rose-500/15 text-rose-300",
  leased: "bg-violet-500/15 text-violet-300",
  rent: "bg-teal-500/15 text-teal-300",
};
