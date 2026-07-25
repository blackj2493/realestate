/**
 * alert_scope 'filtered' translation — turns a bubble's saved filter snapshot
 * into (a) the Typesense clause the nightly worker ANDs into its new-listing
 * query and (b) the short human label the digest email shows ("filtered to: …").
 *
 * NO SECOND FILTER IMPLEMENTATION: the clause comes from the SAME
 * buildTerminalCoreClauses the terminal search runs, so a 'filtered' bubble
 * alerts on exactly the population the user was looking at when they saved it
 * (minus area, which the bubble polygon supplies). Pure + unit-tested (§4).
 *
 * Pre-095 bubbles never captured universalFilters → returns nulls and the
 * worker treats the bubble as 'all' (the UI requires a re-save to enable
 * 'filtered' on those).
 */
import { buildTerminalCoreClauses } from "@/lib/filters/terminalQuery";
import { FILTERS_BY_KEY, makePriceDef } from "@/lib/filters/filterRegistry";
import {
  priceConfig,
  type TransactionMode,
  type PropertyClass,
} from "@/lib/filters/fundamentals";
import type { FilterValue, UniversalFilterState } from "@/lib/filters/types";
import {
  buildInvestorClause,
  defaultTerminalFilters,
  type TerminalFilterState,
} from "@/lib/personas/personaConfig";
import type { BubbleFiltersSnapshot } from "@/lib/bubbles/serialize";

export interface BubbleAlertFilter {
  /** Full filter_by fragment (floor + transaction + class + price + persona +
   *  universal), or null when the snapshot predates 095 / is unusable. */
  clause: string | null;
  /** "3+ Beds · Detached · ≤$900k" — for the email's "filtered to:" line.
   *  null when nothing beyond the defaults is active (clause may still be
   *  non-null — it then matches ~everything the 'all' scope would). */
  label: string | null;
}

const NONE: BubbleAlertFilter = { clause: null, label: null };

function isTransactionMode(v: unknown): v is TransactionMode {
  return v === "sale" || v === "rent";
}
function isPropertyClass(v: unknown): v is PropertyClass {
  return v === "residential" || v === "commercial";
}

/** Defensive read of the jsonb snapshot (DB rows are untyped at this boundary). */
export function parseSnapshot(raw: unknown): BubbleFiltersSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  return raw as BubbleFiltersSnapshot;
}

export function bubbleAlertFilter(rawSnapshot: unknown): BubbleAlertFilter {
  const snap = parseSnapshot(rawSnapshot);
  // universalFilters is the 095 marker: without it the snapshot predates the
  // feature and we must not guess at the user's intent.
  if (!snap?.universalFilters || typeof snap.universalFilters !== "object") return NONE;

  const transactionMode: TransactionMode = isTransactionMode(snap.transactionMode)
    ? snap.transactionMode
    : "sale";
  const propertyClass: PropertyClass = isPropertyClass(snap.propertyClass)
    ? snap.propertyClass
    : "residential";
  const universalFilters = snap.universalFilters as UniversalFilterState;
  // Merge over defaults so a snapshot from an older TerminalFilterState shape
  // (missing keys) still builds a valid persona clause.
  const filters: TerminalFilterState = { ...defaultTerminalFilters, ...(snap.filters ?? {}) };

  try {
    const clauses = buildTerminalCoreClauses({
      transactionMode,
      propertyClass,
      universalFilters,
      filters,
    });
    if (clauses.length === 0) return NONE;

    // ── Label: chip labels of the ACTIVE universal filters + price + persona ──
    const parts: string[] = [];
    const priceDef = makePriceDef(priceConfig(transactionMode));
    const priceVal = universalFilters.price;
    if (priceVal !== undefined && priceDef.isActive(priceVal as FilterValue)) {
      parts.push(priceDef.chipLabel(priceVal as FilterValue));
    }
    for (const [key, value] of Object.entries(universalFilters)) {
      if (key === "price") continue;
      const def = FILTERS_BY_KEY[key];
      if (!def) continue; // renamed/removed filter — clause builder ignored it too
      try {
        if (def.isActive(value)) parts.push(def.chipLabel(value));
      } catch {
        /* malformed stored value — skip its label; buildClause was equally defensive */
      }
    }
    if (buildInvestorClause(filters)) parts.push("investor filters");
    if (transactionMode === "rent") parts.push("For Rent");

    return { clause: clauses.join(" && "), label: parts.length ? parts.join(" · ") : null };
  } catch (err) {
    // A translation bug must degrade to 'all' behaviour, never kill the bubble phase.
    console.error("[bubbleFilterClause] translation failed:", err);
    return NONE;
  }
}
