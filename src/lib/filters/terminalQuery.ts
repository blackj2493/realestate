/**
 * One source of truth for the terminal's core Typesense clauses — shared by the
 * live search (properties/page.tsx) and the slider distribution histograms
 * (useRangeHistogram). Keeping both on this builder guarantees a histogram is
 * computed over exactly the population the user is filtering, minus the single
 * dimension they're dragging (excludeUniversalKey).
 */
import { buildUniversalFilterString, makePriceDef } from "./filterRegistry";
import {
  buildTransactionClause,
  buildClassClause,
  priceFloorClause,
  isInvestorLayerActive,
  priceConfig,
  type TransactionMode,
  type PropertyClass,
} from "./fundamentals";
import type { UniversalFilterState } from "./types";
import { buildInvestorClause, type TerminalFilterState } from "@/lib/personas/personaConfig";

export interface TerminalCoreArgs {
  transactionMode: TransactionMode;
  propertyClass: PropertyClass;
  universalFilters: UniversalFilterState;
  filters: TerminalFilterState;
  /** Drop one universal filter key — the histogram excludes its own field. */
  excludeUniversalKey?: string;
  /** Drop the whole investor clause — investor-chip histograms show a metric's
   *  full distribution over the basic-filtered set, not narrowed by the other
   *  investor controls (and so never self-collapse on the dragged one). */
  excludePersona?: boolean;
}

/**
 * Core clauses (falsy already dropped — caller joins with " && "): transaction-
 * aware price floor, transaction type, property class, the transaction-aware
 * price clause, the persona investor filter (residential-sale only), and the
 * universal composable filters. Price is built from priceConfig(mode), NOT via
 * buildUniversalFilterString, so its sale/rent bounds stay correct everywhere.
 * The page appends the school / colour-band / draw map lenses on top.
 */
export function buildTerminalCoreClauses(args: TerminalCoreArgs): string[] {
  const {
    transactionMode,
    propertyClass,
    universalFilters,
    filters,
    excludeUniversalKey,
    excludePersona,
  } = args;
  const investorLayer = isInvestorLayerActive(transactionMode, propertyClass);

  const priceDef = makePriceDef(priceConfig(transactionMode));
  const priceClause =
    excludeUniversalKey === "price"
      ? null
      : priceDef.buildClause(universalFilters.price ?? priceDef.defaultValue);

  const universalFilter = buildUniversalFilterString(universalFilters, {
    exclude: ["price", ...(excludeUniversalKey ? [excludeUniversalKey] : [])],
  });

  return [
    priceFloorClause(transactionMode),
    buildTransactionClause(transactionMode),
    buildClassClause(propertyClass),
    priceClause,
    investorLayer && !excludePersona ? buildInvestorClause(filters) : "",
    universalFilter,
  ].filter((c): c is string => Boolean(c));
}
