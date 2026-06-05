//
// Server-only loader for the neighbourhood picker tree. Shared by the gated
// /api/avm/cohorts route and the PUBLIC /whats-my-home-hiding page. The tree is
// geographic/type TAXONOMY only (city → community → property types) built from
// trained cohorts — it carries NO sold prices, counts, or VOW Listing Information
// (buildCohortTree drops model_accuracy_score / total_sales_analyzed), so it is
// safe to expose publicly. Module-level 1h TTL cache (tree is global).
import { getServiceRoleClient } from '@/lib/supabase/client';
import { buildCohortTree, type CohortRow, type CityRegionPair, type CohortTree } from '@/lib/avm/cohorts';

let treeCache: { data: CohortTree; at: number } | null = null;
const TREE_TTL_MS = 60 * 60 * 1000; // 1h

export async function loadCohortTree(): Promise<CohortTree> {
  if (treeCache && Date.now() - treeCache.at < TREE_TTL_MS) return treeCache.data;

  const supabase = getServiceRoleClient();

  const { data: cohorts, error: cohortsErr } = await supabase
    .from('avm_audit_report')
    .select('city_region, property_sub_type, model_accuracy_score, total_sales_analyzed');
  if (cohortsErr) throw cohortsErr;

  const { data: pairData, error: pairErr } = await supabase.rpc('get_distinct_cohort_cities');
  if (pairErr) throw pairErr;

  const tree = buildCohortTree(
    (cohorts ?? []) as CohortRow[],
    (pairData ?? []) as CityRegionPair[],
  );
  treeCache = { data: tree, at: Date.now() };
  return tree;
}
