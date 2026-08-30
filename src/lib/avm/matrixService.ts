/**
 * AVM Matrix Service
 *
 * Fetches the per-feature standardized coefficients (beta, mean, std) for a given
 * market + normalized property type.
 *
 * COHORT LADDER. A cohort is keyed on a community, a postal FSA, or a whole city
 * (migration 130). This walks them finest-first and returns the first rung that has a
 * trained model, together with WHICH rung answered — the caller needs that, because a
 * coarser cohort must not be labelled HIGH confidence.
 *
 * The rung is part of the match, not an afterthought: 67 city names collide with an
 * existing city_region spelling, so "Ajax" the community and "Ajax" the city are separate
 * cohorts whose rows must never merge into one feature set.
 *
 * Before 2026-08-30 this required a community key and returned nothing without one, so all
 * of Waterloo Region and Brantford fell through to a BORROWED sibling model from another
 * community. The ladder replaces another market's coefficients with the subject's own.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { cohortRungLookupKeys, type CohortRung } from './normalizeType';

// Champion/challenger: the live path reads the CHAMPION table. Offline backtests/trainers set
// AVM_MATRIX_TABLE to score/write the CHALLENGER in staging. Allowlisted to the two known
// tables so a stray env var in production can never repoint the live estimate at arbitrary data.
const MATRIX_TABLE =
  process.env.AVM_MATRIX_TABLE === 'avm_multiplier_matrix_staging'
    ? 'avm_multiplier_matrix_staging'
    : 'avm_multiplier_matrix';

export interface CoefficientRow {
  featureName: string;
  beta: number;
  mean: number;
  std: number;
}

export interface CoefficientLookup {
  rows: CoefficientRow[];
  /** Which rung supplied the rows; null when no rung had a model. */
  rung: CohortRung | null;
}

export async function fetchCoefficients(
  supabase: SupabaseClient,
  cityRegion: string,
  propertySubType: string,
  /** Coarser keys to fall back to. Omit to search the community rung only. */
  ladder?: { postalCode?: string | null; city?: string | null }
): Promise<CoefficientLookup> {
  const rungs = cohortRungLookupKeys(cityRegion, ladder?.postalCode, ladder?.city);
  if (rungs.length === 0) return { rows: [], rung: null };
  const typeKey = propertySubType.toLowerCase().trim();

  // One round trip for every rung; the rung is re-applied below so a coarse cohort sharing
  // a community's name can never contribute rows to it.
  const { data, error } = await supabase
    .from(MATRIX_TABLE)
    .select('cohort_rung, city_region, feature_name, beta, feat_mean, feat_std')
    .in('cohort_rung', rungs.map((r) => r.rung))
    .in('city_region', [...new Set(rungs.flatMap((r) => r.keys))])
    .ilike('property_sub_type', typeKey);

  if (error || !data || data.length === 0) {
    console.warn(`[AVM] Coefficient lookup failed for ${cityRegion}/${propertySubType}`);
    return { rows: [], rung: null };
  }

  for (const { rung, keys } of rungs) {
    const order = new Map(keys.map((k, i) => [k, i]));
    const inRung = data.filter((r) => r.cohort_rung === rung && order.has(r.city_region));
    if (inRung.length === 0) continue;

    // Within a rung, keep only the highest-priority spelling (e.g. both "Bronte" and
    // "1001 - BR Bronte" exist as separate cohorts) so the feature set stays consistent.
    const bestPriority = Math.min(...inRung.map((r) => order.get(r.city_region) ?? 999));
    const chosen = inRung.filter((r) => (order.get(r.city_region) ?? 999) === bestPriority);
    return {
      rung,
      rows: chosen.map((row) => ({
        featureName: row.feature_name,
        beta: row.beta,
        mean: row.feat_mean,
        std: row.feat_std,
      })),
    };
  }

  return { rows: [], rung: null };
}
