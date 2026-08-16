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
import type { BubbleFiltersSnapshot, CityLensFilters } from "@/lib/bubbles/serialize";
import { buildLensClauses } from "@/lib/dashboard/queries";
import { normalizeConfig, type MarketActivityLens } from "@/lib/dashboard/config";
import { PROPERTY_TYPE_OPTIONS } from "@/lib/dashboard/propertyTypes";

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

/** Human label for a dashboard lens ("Detached · 3+ bd · finished bsmt"). */
function lensLabel(lens: MarketActivityLens): string | null {
  const parts: string[] = [];
  if (lens.propertyTypes.length) {
    const byKey = new Map(PROPERTY_TYPE_OPTIONS.map((o) => [o.key, o.label]));
    parts.push(lens.propertyTypes.map((k) => byKey.get(k) ?? k).join("/"));
  }
  if (lens.minBeds > 0) parts.push(`${lens.minBeds}${lens.bedsExact ? "" : "+"} bd`);
  if (lens.minBaths > 0) parts.push(`${lens.minBaths}${lens.bathsExact ? "" : "+"} ba`);
  if (lens.minGarage > 0) parts.push(`${lens.minGarage}${lens.garageExact ? "" : "+"} garage`);
  if (lens.basement !== "any") parts.push(`${lens.basement} bsmt`);
  if (lens.minFrontage > 0) parts.push(`≥${lens.minFrontage}′ frontage`);
  if (lens.transactionType === "lease") parts.push("For Rent");
  return parts.length ? parts.join(" · ") : null;
}

/**
 * City-bubble variant: the stored filters are the DASHBOARD lens ({ lens }),
 * translated by the dashboard's own clause builder (buildLensClauses) — the
 * email matches exactly what the dashboard shows under that lens. windowDays is
 * deliberately ignored (the worker's watermark governs "new").
 */
function lensAlertFilter(rawLens: unknown): BubbleAlertFilter {
  try {
    const lens = normalizeConfig({ marketActivity: rawLens }).marketActivity;
    const floor = lens.transactionType === "lease" ? "ListPrice:>=500" : "ListPrice:>=100000";
    const lensClauses = buildLensClauses(lens);
    return {
      clause: lensClauses ? `${floor} && ${lensClauses}` : floor,
      label: lensLabel(lens),
    };
  } catch (err) {
    console.error("[bubbleFilterClause] lens translation failed:", err);
    return NONE;
  }
}

export function bubbleAlertFilter(rawSnapshot: unknown): BubbleAlertFilter {
  if (
    rawSnapshot &&
    typeof rawSnapshot === "object" &&
    "lens" in rawSnapshot &&
    (rawSnapshot as CityLensFilters).lens
  ) {
    return lensAlertFilter((rawSnapshot as CityLensFilters).lens);
  }
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
