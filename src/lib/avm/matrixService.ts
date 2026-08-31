/**
 * AVM Matrix Service
 *
 * Fetches the per-feature standardized coefficients (beta, mean, std) for a given
 * market + normalized property type. Like auditService, handles the verbatim
 * vs. clean `city_region` mismatch via candidate-key lookup (see
 * normalizeType.cityRegionLookupCandidates).
 *
 * COHORT LADDER. A cohort is keyed on a community, a postal FSA, or a whole city
 * (migration 130). fetchCohortCoefficients returns EVERY rung it is given that has a
 * trained model, finest first, each labelled with its rung — the caller (resolveModel)
 * decides which one to use, because a coarse rung has to clear a quality bar before it
 * may stand in for an untrained community. fetchCoefficients is the community-only form
 * every trained-cohort consumer keys on.
 *
 * The rung is part of the match, not an afterthought: 67 city names collide with an
 * existing city_region spelling, so "Ajax" the community and "Ajax" the city are separate
 * cohorts whose rows must never merge into one feature set.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { cohortRungLookupKeys, type CohortRung, type CohortRungLookupKey } from './normalizeType';

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

/** One rung's coefficients. */
export interface CohortCoefficients {
  rung: CohortRung;
  rows: CoefficientRow[];
}

/**
 * Community rung only — the TRAINED-cohort lookup. A subject whose community answers here
 * routes as trained; every other consumer (sibling borrow, value-add engine) means exactly
 * this rung. For the full ladder use fetchCohortCoefficients.
 */
export async function fetchCoefficients(
  supabase: SupabaseClient,
  cityRegion: string,
  propertySubType: string
): Promise<CoefficientRow[]> {
  const found = await fetchCohortCoefficients(
    supabase,
    cohortRungLookupKeys(cityRegion, null, null),
    propertySubType
  );
  return found[0]?.rows ?? [];
}

/**
 * Every rung in `rungs` that has a trained model for this sub-type, in the order given
 * (finest first). One round trip for all rungs; the rung is re-applied in memory so a
 * coarse cohort sharing a community's name can never contribute rows to it.
 */
export async function fetchCohortCoefficients(
  supabase: SupabaseClient,
  rungs: CohortRungLookupKey[],
  propertySubType: string
): Promise<CohortCoefficients[]> {
  if (rungs.length === 0) return [];
  const typeKey = propertySubType.toLowerCase().trim();

  const { data, error } = await supabase
    .from(MATRIX_TABLE)
    .select('cohort_rung, city_region, feature_name, beta, feat_mean, feat_std')
    .in('cohort_rung', rungs.map((r) => r.rung))
    .in('city_region', [...new Set(rungs.flatMap((r) => r.keys))])
    .ilike('property_sub_type', typeKey);

  if (error || !data || data.length === 0) {
    console.warn(`[AVM] Coefficient lookup failed for ${describeRungs(rungs)}/${propertySubType}`);
    return [];
  }

  const out: CohortCoefficients[] = [];
  for (const { rung, keys } of rungs) {
    const order = new Map(keys.map((k, i) => [k, i]));
    const inRung = data.filter((r) => r.cohort_rung === rung && order.has(r.city_region));
    if (inRung.length === 0) continue;

    // Within a rung, keep only the highest-priority spelling (e.g. both "Bronte" and
    // "1001 - BR Bronte" exist as separate cohorts) so the feature set stays consistent.
    const bestPriority = Math.min(...inRung.map((r) => order.get(r.city_region) ?? 999));
    const chosen = inRung.filter((r) => (order.get(r.city_region) ?? 999) === bestPriority);
    out.push({
      rung,
      rows: chosen.map((row) => ({
        featureName: row.feature_name,
        beta: row.beta,
        mean: row.feat_mean,
        std: row.feat_std,
      })),
    });
  }
  return out;
}

/** "community:Bronte>fsa:L6L>city:Oakville" — for the lookup-miss log line. */
export function describeRungs(rungs: CohortRungLookupKey[]): string {
  return rungs.map((r) => `${r.rung}:${r.keys[0]}`).join('>');
}
