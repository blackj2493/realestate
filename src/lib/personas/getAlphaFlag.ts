/**
 * getAlphaFlag — collapse a listing's signals into ONE primary "Alpha Flag"
 * for the ledger, matching the mockup (ZONING:CMU / POWER OF SALE / SUITE POTENTIAL).
 * Priority: FORCED SALE > NEEDS WORK > ZONING > SUITE > PARKING > STALE > NEW.
 *
 * The distress slot used to render one word, "DISTRESSED", for three unrelated situations —
 * a seller under legal pressure, a property needing work, and a listing that had merely been
 * sitting. It now names the EVIDENCE ("POWER OF SALE", "GUT RENOVATION"), which is both more
 * useful and auditable: the label is the phrase that matched.
 */

import type { ListingDocument } from "@/lib/typesense/client";
import { detectDistress } from "@/lib/listings/distressSignals";

export type AlphaFlagVariant =
  | "forcedSale"
  | "needsWork"
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
  //
  // Derived from the remarks at RENDER, not read from the indexed `isDistressed` boolean
  // (which stays for filtering + the data-health canary). Both come from the same
  // detectDistress(), so they agree — but deriving here means the badge can never render a
  // verdict from a rule the index was frozen on, which is exactly how the old flag rotted:
  // the nightly sync only re-transforms the modification delta.
  if (isAuthed) {
    const signals = detectDistress(d.PublicRemarks);
    // The matched phrase IS the label. `matched` is ordered forced-sale first, so the most
    // serious finding names the badge when a listing carries both.
    if (signals.forcedSale) return { label: signals.matched[0].toUpperCase(), variant: "forcedSale" };
    if (signals.needsWork) return { label: signals.matched[0].toUpperCase(), variant: "needsWork" };
  }
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

// Alpha Flag = a moat signal, so in LIGHT it's a SOLID saturated chip (white text)
// that pops off the pale ledger; DARK keeps the original translucent chip (bright
// text on a dark-appropriate tint). Colours only.
export const ALPHA_FLAG_CLASS: Record<AlphaFlagVariant, string> = {
  // Forced sale keeps the alarm colour — a seller with no choice is the one genuinely urgent
  // signal here. Needs-work is an orange condition note, not an alarm, and is deliberately
  // distinct from `stale`'s amber so the two aren't read as the same thing.
  forcedSale: "bg-rose-600 text-white border-transparent dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/30",
  needsWork: "bg-orange-600 text-white border-transparent dark:bg-orange-500/15 dark:text-orange-300 dark:border-orange-500/30",
  zoning: "bg-cyan-700 text-white border-transparent dark:bg-cyan-500/15 dark:text-cyan-300 dark:border-cyan-500/30",
  suite: "bg-blue-600 text-white border-transparent dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/30",
  income: "bg-emerald-600 text-white border-transparent dark:bg-cyan-500/20 dark:text-cyan-200 dark:border-cyan-400/50",
  lot: "bg-cyan-700 text-white border-transparent dark:bg-cyan-500/30 dark:text-cyan-100 dark:border-cyan-400/60",
  stale: "bg-amber-500 text-white border-transparent dark:bg-amber-500/30 dark:text-amber-100 dark:border-amber-400/60",
  new: "bg-emerald-600 text-white border-transparent dark:bg-cyan-500/20 dark:text-cyan-200 dark:border-cyan-400/50",
  none: "text-muted-foreground bg-transparent border-transparent",
};
