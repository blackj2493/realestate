import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/supabase/server';
import { getServiceRoleClient } from '@/lib/supabase/client';
import { buildCohortTree, type CohortRow, type CityRegionPair } from '@/lib/avm/cohorts';

export async function GET() {
  if (!(await getCurrentUser())) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  }
  try {
    const supabase = getServiceRoleClient();
    const { data: cohorts } = await supabase
      .from('avm_audit_report')
      .select('city_region, property_sub_type, model_accuracy_score, total_sales_analyzed');
    const pairs = await fetchCityRegionPairs(supabase);
    const tree = buildCohortTree((cohorts ?? []) as CohortRow[], pairs);
    return NextResponse.json({ tree });
  } catch (err) {
    console.error('[avm/cohorts]', err);
    return NextResponse.json({ error: 'Failed to load neighbourhoods' }, { status: 500 });
  }
}

async function fetchCityRegionPairs(
  supabase: ReturnType<typeof getServiceRoleClient>
): Promise<CityRegionPair[]> {
  // Uses the get_distinct_cohort_cities() RPC (migration 028) — a DISTINCT query
  // on listings scoped to non-null city + city_region rows only, relying on the
  // lower(city)/lower(city_region) partial indexes from backfill020.ts.
  // This avoids scanning all ~112k listings rows and exhausting the Supabase IO
  // burst budget (CLAUDE.md §12 / known Disk IO issue).
  const { data, error } = await supabase.rpc('get_distinct_cohort_cities');
  if (error) {
    console.error('[avm/cohorts] get_distinct_cohort_cities RPC error:', error);
    return [];
  }
  return (data ?? []) as CityRegionPair[];
}
