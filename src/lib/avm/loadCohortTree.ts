//
// Server-only loader for the neighbourhood picker tree. Shared by the gated
// /api/avm/cohorts route and the PUBLIC /whats-my-home-hiding page. The tree is
// geographic/type TAXONOMY only (city → community → property types) built from
// trained cohorts — it carries NO sold prices, counts, or VOW Listing Information
// (buildCohortTree drops model_accuracy_score / total_sales_analyzed), so it is
// safe to expose publicly. Module-level 1h TTL cache (tree is global).
//
// Both source reads exceed (or approach) PostgREST's hard 1000-row response cap —
// the distinct (city, city_region) pairs are ~1960, the audit table ~969 — so a
// single unpaginated read silently truncates the tree (dropping whole cities like
// Vaughan whose communities land past row #1000). Both reads are therefore paged
// with a stable ORDER BY so range pagination is deterministic.
import type { SupabaseClient } from '@supabase/supabase-js';
import { getServiceRoleClient } from '@/lib/supabase/client';
import { buildCohortTree, type CohortRow, type CityRegionPair, type CohortTree } from '@/lib/avm/cohorts';

let treeCache: { data: CohortTree; at: number } | null = null;
const TREE_TTL_MS = 60 * 60 * 1000; // 1h
const PAGE = 1000; // PostgREST caps a single response at 1000 rows.

// The cold rebuild issues ~2,900 rows over several round-trips, which under IO load
// can trip Postgres' statement_timeout (57014) or a transient network error. Those
// are almost always one-off, so retry the whole (idempotent) read once before giving
// up — far cheaper than serving a stale/empty tree.
const TRANSIENT = /statement timeout|57014|timeout|ECONNRESET|fetch failed|socket hang up/i;
async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const code = (err as { code?: string } | null)?.code;
    if (code !== '57014' && !TRANSIENT.test(msg)) throw err;
    console.warn(`[loadCohortTree] ${label} transient failure — retrying once:`, msg);
    await new Promise((r) => setTimeout(r, 400));
    return await fn();
  }
}

/** Audit cohorts, paged. Stable order (city_region, property_sub_type) for correct range pagination. */
async function fetchAllAudit(supabase: SupabaseClient): Promise<CohortRow[]> {
  const out: CohortRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('avm_audit_report')
      .select('city_region, property_sub_type, model_accuracy_score, total_sales_analyzed')
      // Community rung only — see auditService for why. This reads the WHOLE table, so
      // without the filter the cohort tree doubles from 1,685 cohorts to 3,516.
      .eq('cohort_rung', 'community')
      .order('city_region')
      .order('property_sub_type')
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const batch = (data ?? []) as CohortRow[];
    out.push(...batch);
    if (batch.length < PAGE) break;
  }
  return out;
}

/** Distinct (city, city_region) pairs from the get_distinct_cohort_cities RPC, paged. */
async function fetchAllPairs(supabase: SupabaseClient): Promise<CityRegionPair[]> {
  const out: CityRegionPair[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .rpc('get_distinct_cohort_cities')
      .order('city')
      .order('city_region')
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const batch = (data ?? []) as CityRegionPair[];
    out.push(...batch);
    if (batch.length < PAGE) break;
  }
  return out;
}

/**
 * Throws on any Supabase/Postgres error (e.g. 57014 statement timeout) —
 * callers must catch, or use loadCohortTreeSafe() for public surfaces.
 */
export async function loadCohortTree(): Promise<CohortTree> {
  if (treeCache && Date.now() - treeCache.at < TREE_TTL_MS) return treeCache.data;

  const supabase = getServiceRoleClient();
  const [cohorts, pairs] = await Promise.all([
    withRetry(() => fetchAllAudit(supabase), 'audit'),
    withRetry(() => fetchAllPairs(supabase), 'pairs'),
  ]);

  const tree = buildCohortTree(cohorts, pairs);
  treeCache = { data: tree, at: Date.now() };
  return tree;
}

/**
 * Non-throwing variant for the PUBLIC /whats-my-home-hiding page. A Supabase
 * failure (typically Postgres 57014 statement timeout under IO load) must
 * degrade to a stale or empty picker tree, never a route 500 — the page is a
 * public marketing/SEO surface. The gated /api/avm/cohorts route keeps using
 * loadCohortTree() so API consumers still see real errors.
 */
export async function loadCohortTreeSafe(): Promise<CohortTree> {
  try {
    return await loadCohortTree();
  } catch (err) {
    console.error('[loadCohortTree] failed — serving stale/empty tree fallback:', err);
    if (treeCache) return treeCache.data; // stale beats empty
    return buildCohortTree([], []);
  }
}
