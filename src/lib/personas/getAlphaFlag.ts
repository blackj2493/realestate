/**
 * getAlphaFlag — collapse a listing's signals into ONE primary "Alpha Flag"
 * for the ledger, matching the mockup (ZONING:CMU / DISTRESSED / SUITE POTENTIAL).
 * Priority: DISTRESSED > ZONING > SUITE > PARKING > STALE > NEW.
 */

import type { ListingDocument } from "@/lib/typesense/client";

export type AlphaFlagVariant =
  | "distressed"
  | "zoning"
  | "suite"
  | "income"
  | "lot"
  | "stale"
  | "new"
  | "none";

export interface AlphaFlag {
  label: string;
  variant: AlphaFlagVariant;
}

export function getAlphaFlag(d: ListingDocument, isAuthed: boolean = true): AlphaFlag {
  // VOW-derived signals (distress, and relist-corrected stale/new via True DOM)
  // are gated for anonymous users (CLAUDE.md §4 / VOW §6.2(f)) while
  // VOW_ENFORCE_TERMS is off. The IDX-public flags (zoning / suite / surplus-parking)
  // stay visible to everyone, so an anon row falls through to those.
  if (isAuthed && d.isDistressed) return { label: "DISTRESSED", variant: "distressed" };
  if (d.zoning_designation) return { label: `ZONING: ${d.zoning_designation}`, variant: "zoning" };
  if (d.SuiteStatus === "EXISTING_SUITE" || d.multi_unit_status === "EXISTING_MULTI_UNIT")
    return { label: "INCOME SUITE", variant: "income" };
  if (
    d.SuiteStatus === "POTENTIAL_CANDIDATE" ||
    d.multi_unit_status === "PRIME_CANDIDATE" ||
    d.hasSecondarySuitePotential
  )
    return { label: "SUITE POTENTIAL", variant: "suite" };
  // `is_density_ready` is a parking-surplus heuristic (detached + ≥2 surplus
  // parking spots, parkingCalculator.ts), NOT a zoning/buildability fact — so it
  // surfaces honestly as a lot observation, never a "density-ready" zoning claim.
  if (d.is_density_ready) return { label: "SURPLUS PARKING", variant: "lot" };
  if (isAuthed && d.IsStale) return { label: "STALE", variant: "stale" };
  if (isAuthed && (d.TrueDom ?? d.calculatedDOM ?? 999) <= 7) return { label: "NEW", variant: "new" };
  return { label: "—", variant: "none" };
}

export const ALPHA_FLAG_CLASS: Record<AlphaFlagVariant, string> = {
  distressed: "text-rose-300 bg-rose-500/15 border-rose-500/30",
  zoning: "text-cyan-300 bg-cyan-500/15 border-cyan-500/30",
  suite: "text-blue-300 bg-blue-500/15 border-blue-500/30",
  income: "text-cyan-200 bg-cyan-500/20 border-cyan-400/50",
  // Brighter text + stronger fill/border so these read clearly on the dark bg.
  lot: "text-cyan-100 bg-cyan-500/30 border-cyan-400/60",
  stale: "text-amber-100 bg-amber-500/30 border-amber-400/60",
  new: "text-cyan-200 bg-cyan-500/20 border-cyan-400/50",
  none: "text-slate-500 bg-transparent border-transparent",
};
