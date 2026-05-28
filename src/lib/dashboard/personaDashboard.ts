/**
 * personaDashboard — reconciles the Command Center's PersonaType vocabulary with
 * the dashboard's board registry + comparison tiles.
 *
 * Kept SEPARATE from:
 *  - personaConfig.ts (terminal-shaped: filter controls, ledger columns, map color)
 *  - boards.ts (persona-agnostic Typesense query defs)
 *
 * Each persona declares (a) which boards lead in the per-region drill-down and
 * (b) which headline comparison tiles surface in the comparison band. Both are
 * applied NON-DESTRUCTIVELY at render time — the user's stored board enable/disable
 * set (DashboardConfig.boards) is untouched.
 */

import type { PersonaType } from '@/lib/personas/personaConfig';
import type { BoardId } from './boards';

/**
 * Headline comparison metrics. The first group is backed by `RegionScore`
 * (fetchRegionScore) and shippable now. The starred group is Typesense-only and
 * deferred to Phase 5 (needs a fetchRegionStats extension).
 */
export type HeadlineMetricId =
  | 'medianPrice'
  | 'medianPpsf'
  | 'medianCapRate'
  | 'monthsSupply'
  | 'soldToList'
  | 'pctStale'
  | 'activeCount'
  // ── Phase 5 specialty (not in RegionScore yet) ──
  | 'carryBurn'
  | 'priceDrop'
  | 'densityCount';

export interface PersonaDashboardSpec {
  /** Ordered boards that lead for this persona (intersected with enabled boards). */
  featuredBoards: BoardId[];
  /** Headline comparison tiles, in display order (RegionScore-backed for now). */
  headlineMetrics: HeadlineMetricId[];
}

export const PERSONA_DASHBOARD: Record<PersonaType, PersonaDashboardSpec> = {
  smart: {
    featuredBoards: ['fresh', 'cap_rate', 'suite'],
    headlineMetrics: ['medianPrice', 'medianCapRate', 'monthsSupply'],
  },
  cashflow: {
    featuredBoards: ['cap_rate', 'carry', 'suite'],
    headlineMetrics: ['medianCapRate', 'soldToList', 'monthsSupply'],
  },
  flippers: {
    featuredBoards: ['price_drop', 'fresh', 'carry'],
    headlineMetrics: ['pctStale', 'soldToList', 'medianPpsf'],
  },
  builders: {
    featuredBoards: ['density', 'suite', 'cap_rate'],
    headlineMetrics: ['medianPrice', 'medianPpsf', 'monthsSupply'],
  },
};

/**
 * Order the user's enabled boards so the active persona's featured boards lead,
 * preserving the user's relative order for the remainder. Mirrors the
 * orderBoardsByObjectives() pattern in boards.ts but keyed on persona.
 */
export function orderBoardsForPersona(
  persona: PersonaType,
  enabledBoards: BoardId[]
): BoardId[] {
  const featured = PERSONA_DASHBOARD[persona].featuredBoards;
  const enabled = new Set(enabledBoards);
  const lead = featured.filter((id) => enabled.has(id));
  const rest = enabledBoards.filter((id) => !lead.includes(id));
  return [...lead, ...rest];
}
