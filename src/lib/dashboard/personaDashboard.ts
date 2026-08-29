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
 * Headline comparison metrics. Two backing sources:
 *  - the RegionScore group (fetchRegionScore — server-side full-population aggregates)
 *  - the specialty SHARE group (fetchRegionSpecialty — full-population Typesense counts
 *    expressed as a share of active inventory; see RegionSpecialtyStats in queries.ts)
 */
export type HeadlineMetricId =
  // ── RegionScore-backed ──
  | 'medianPrice'
  | 'medianPpsf'
  | 'medianCapRate'
  | 'monthsSupply'
  | 'soldToList'
  | 'pctStale'
  | 'activeCount'
  // ── Specialty inventory shares (fetchRegionSpecialty) ──
  | 'cashflowShare'
  | 'priceCutShare'
  | 'densityShare';

/** The subset of HeadlineMetricId backed by fetchRegionSpecialty, not RegionScore. */
export const SPECIALTY_METRIC_IDS = ['cashflowShare', 'priceCutShare', 'densityShare'] as const;

export interface PersonaDashboardSpec {
  /** Ordered boards that lead for this persona (intersected with enabled boards). */
  featuredBoards: BoardId[];
  /** Headline comparison tiles, in display order (RegionScore-backed for now). */
  headlineMetrics: HeadlineMetricId[];
}

export const PERSONA_DASHBOARD: Record<PersonaType, PersonaDashboardSpec> = {
  smart: {
    // 'fresh' led here until it was retired for duplicating the New column. Left at two
    // leads rather than promoting a board this persona never asked for.
    featuredBoards: ['cap_rate', 'suite'],
    headlineMetrics: ['medianPrice', 'medianCapRate', 'monthsSupply'],
  },
  cashflow: {
    featuredBoards: ['cap_rate', 'carry', 'suite'],
    headlineMetrics: ['medianCapRate', 'cashflowShare', 'soldToList'],
  },
  flippers: {
    featuredBoards: ['price_drop', 'carry'],
    headlineMetrics: ['pctStale', 'priceCutShare', 'soldToList'],
  },
  builders: {
    featuredBoards: ['high_dom', 'suite', 'cap_rate'],
    headlineMetrics: ['medianPrice', 'densityShare', 'monthsSupply'],
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
