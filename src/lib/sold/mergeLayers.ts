import type { ListingDocument } from "@/lib/typesense/client";

/** "Recency" for interleaving: leased/sold date, else listing entry timestamp. */
function recency(d: ListingDocument): number {
  const iso = d.LeasedDate ?? d.SoldDate;
  if (iso) { const t = new Date(iso).getTime(); if (Number.isFinite(t)) return t; }
  return d.EntryTimestamp ?? 0;
}

/** Merge per-source doc lists into one: de-dupe by id (first source wins), sort recency desc. */
export function mergeLayers(sources: ListingDocument[][]): ListingDocument[] {
  const byId = new Map<string, ListingDocument>();
  for (const list of sources) for (const doc of list) if (!byId.has(doc.id)) byId.set(doc.id, doc);
  return [...byId.values()].sort((a, b) => recency(b) - recency(a));
}
