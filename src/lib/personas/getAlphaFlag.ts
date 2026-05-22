/**
 * getAlphaFlag — collapse a listing's signals into ONE primary "Alpha Flag"
 * for the ledger, matching the mockup (ZONING:CMU / DISTRESSED / SUITE POTENTIAL).
 * Priority: DISTRESSED > ZONING > SUITE > DENSITY > STALE > NEW.
 */

import type { ListingDocument } from "@/lib/typesense/client";

export type AlphaFlagVariant =
  | "distressed"
  | "zoning"
  | "suite"
  | "income"
  | "density"
  | "stale"
  | "new"
  | "none";

export interface AlphaFlag {
  label: string;
  variant: AlphaFlagVariant;
}

export function getAlphaFlag(d: ListingDocument): AlphaFlag {
  if (d.isDistressed) return { label: "DISTRESSED", variant: "distressed" };
  if (d.zoning_designation) return { label: `ZONING: ${d.zoning_designation}`, variant: "zoning" };
  if (d.SuiteStatus === "EXISTING_SUITE" || d.multi_unit_status === "EXISTING_MULTI_UNIT")
    return { label: "INCOME SUITE", variant: "income" };
  if (
    d.SuiteStatus === "POTENTIAL_CANDIDATE" ||
    d.multi_unit_status === "PRIME_CANDIDATE" ||
    d.hasSecondarySuitePotential
  )
    return { label: "SUITE POTENTIAL", variant: "suite" };
  if (d.is_density_ready) return { label: "DENSITY READY", variant: "density" };
  if (d.IsStale) return { label: "STALE", variant: "stale" };
  if ((d.TrueDom ?? d.calculatedDOM ?? 999) <= 7) return { label: "NEW", variant: "new" };
  return { label: "—", variant: "none" };
}

export const ALPHA_FLAG_CLASS: Record<AlphaFlagVariant, string> = {
  distressed: "text-rose-300 bg-rose-500/15 border-rose-500/30",
  zoning: "text-cyan-300 bg-cyan-500/15 border-cyan-500/30",
  suite: "text-blue-300 bg-blue-500/15 border-blue-500/30",
  income: "text-emerald-300 bg-emerald-500/15 border-emerald-500/30",
  density: "text-cyan-300 bg-cyan-500/15 border-cyan-500/30",
  stale: "text-amber-300 bg-amber-500/15 border-amber-500/30",
  new: "text-emerald-300 bg-emerald-500/15 border-emerald-500/30",
  none: "text-slate-500 bg-transparent border-transparent",
};
