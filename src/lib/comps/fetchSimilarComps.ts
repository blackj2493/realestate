/**
 * fetchSimilarComps — pull the top RANKED sold comps for one listing, for the ledger
 * row's hover popover. Reuses the listing page's /api/properties/[id]/similar engine
 * (similarity-scored, deduped, with % of ask + "sold Nd ago"), so the inline peek is the
 * authoritative comp set — not the cruder viewport sold layer. VOW-gated server-side:
 * anon callers get the count but no rows (soldLocked).
 */
import type { ListingDocument } from "@/lib/typesense/client";

/** Minimal sold-comp shape the popover renders (subset of the route's SimilarSoldCard). */
export interface SoldComp {
  id: string;
  address: string;
  closePrice: number;
  soldDate: string | null;
  pctOfAsk: number | null;
  propertySubType: string | null;
  beds: number | null;
}

export interface SimilarComps {
  sold: SoldComp[];
  /** Total nearby comps found (unrestricted) — shown even when rows are gated. */
  soldCount: number;
  /** True → caller isn't a VOW consumer, so rows are withheld (count still shown). */
  soldLocked: boolean;
}

export async function fetchSimilarComps(
  l: ListingDocument,
  signal?: AbortSignal
): Promise<SimilarComps | null> {
  const p = new URLSearchParams();
  const set = (k: string, v: unknown) => {
    if (v != null && v !== "") p.set(k, String(v));
  };
  // CityRegion + CoveredSpaces ride the Typesense doc but aren't on the typed interface
  // (both are optional in the /similar route — region refines ranking, garage is a soft
  // signal), so read them off a narrow cast.
  const extra = l as unknown as { CityRegion?: string; CoveredSpaces?: number };
  // The subject's public match attributes (the route is status-agnostic and reads them
  // from query params rather than re-fetching the doc).
  set("cityRegion", extra.CityRegion);
  set("city", l.City);
  set("subType", l.PropertySubType?.trim());
  set("beds", l.BedroomsTotal);
  set("bedsAbove", l.BedroomsAboveGrade);
  set("bedsBelow", l.BedroomsBelowGrade);
  set("baths", l.BathroomsTotalInteger);
  set("garage", extra.CoveredSpaces);
  set("listPrice", l.ListPrice);
  set("area", l.BuildingAreaTotal);

  try {
    const res = await fetch(`/api/properties/${encodeURIComponent(l.id)}/similar?${p.toString()}`, { signal });
    if (!res.ok) return null;
    const data = (await res.json()) as { sold?: SoldComp[]; soldCount?: number; soldLocked?: boolean };
    return {
      sold: Array.isArray(data.sold) ? data.sold : [],
      soldCount: data.soldCount ?? 0,
      soldLocked: !!data.soldLocked,
    };
  } catch {
    return null; // aborted / network — caller shows nothing
  }
}
