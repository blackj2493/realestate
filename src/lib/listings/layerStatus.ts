import type { ListingDocument } from "@/lib/typesense/client";
export type LayerTone = "sale" | "sold" | "leased" | "delisted" | "rent";
export interface LayerStatus { label: string; tone: LayerTone; }

/** The status chip for any merged doc — comp kind first, else active TransactionType. */
export function layerStatus(doc: ListingDocument): LayerStatus {
  if (doc.compKind === "sold") return { label: "SOLD", tone: "sold" };
  if (doc.compKind === "leased") return { label: "LEASED", tone: "leased" };
  if (doc.compKind === "terminated") return { label: "TERMINATED", tone: "delisted" };
  if (doc.compKind === "expired") return { label: "EXPIRED", tone: "delisted" };
  if (doc.compKind === "suspended") return { label: "SUSPENDED", tone: "delisted" };
  if (doc.TransactionType && /lease/i.test(doc.TransactionType)) return { label: "FOR RENT", tone: "rent" };
  return { label: "FOR SALE", tone: "sale" };
}

export const LAYER_TONE_CLASS: Record<LayerTone, string> = {
  sale: "bg-emerald-600/15 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  sold: "bg-rose-600/15 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
  leased: "bg-violet-600/15 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
  delisted: "bg-amber-600/15 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  rent: "bg-teal-600/15 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300",
};
