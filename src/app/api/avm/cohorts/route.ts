import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/supabase/server';
import { getServiceRoleClient } from '@/lib/supabase/client';
import { buildCohortTree, type CohortRow, type CityRegionPair } from '@/lib/avm/cohorts';

// Module-level TTL cache — the cohort tree is global (same for all users) and
// only changes when the AVM matrix is re-ingested, so one rebuild per hour is
// more than sufficient.  Auth is still checked on every request BEFORE the cache
// is consulted, so unauthed callers always get 401.
let treeCache: { data: unknown; at: number } | null = null;
const TREE_TTL_MS = 60 * 60 * 1000; // 1h

export async function GET() {
  if (!(await getCurrentUser())) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  }
  try {
    if (treeCache && Date.now() - treeCache.at < TREE_TTL_MS) {
      return NextResponse.json({ tree: treeCache.data });
    }
    const supabase = getServiceRoleClient();

    const { data: cohorts, error: cohortsErr } = await supabase
      .from('avm_audit_report')
      .select('city_region, property_sub_type, model_accuracy_score, total_sales_analyzed');
    if (cohortsErr) throw cohortsErr;

    // Uses the get_distinct_cohort_cities() RPC (migration 028) — a DISTINCT query
    // on listings scoped to non-null city + city_region rows only, served from the
    // idx_listings_city_cityregion composite index (migration 028) so it avoids a
    // 112k-row seq scan and exhausting the Supabase IO burst budget.
    const { data: pairData, error: pairErr } = await supabase.rpc('get_distinct_cohort_cities');
    if (pairErr) throw pairErr;

    const tree = buildCohortTree(
      (cohorts ?? []) as CohortRow[],
      (pairData ?? []) as CityRegionPair[],
    );
    treeCache = { data: tree, at: Date.now() };
    return NextResponse.json({ tree });
  } catch (err) {
    console.error('[avm/cohorts]', err);
    return NextResponse.json({ error: 'Failed to load neighbourhoods' }, { status: 500 });
  }
}
