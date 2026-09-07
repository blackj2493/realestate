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
import { unstable_cache } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getServiceRoleClient } from '@/lib/supabase/client';
import { buildCohortTree, type CohortRow, type CityRegionPair, type CohortTree } from '@/lib/avm/cohorts';

let treeCache: { data: CohortTree; at: number } | null = null;
const TREE_TTL_MS = 60 * 60 * 1000; // 1h
const PAGE = 1000; // PostgREST caps a single response at 1000 rows.

/**
 * Data Cache key version — BUMP whenever CohortTree's SHAPE changes.
 *
 * unstable_cache entries outlive a deploy, so a release that adds a field to the tree would
 * otherwise keep serving hour-old entries that lack it, with nothing failing and nothing
 * logged. Changing a VALUE needs no bump; adding or removing a field does.
 */
export const COHORT_TREE_CACHE_VERSION = 'v1';

/**
 * WHY THERE ARE TWO CACHES.
 *
 * `treeCache` is in-process, so it dies with the lambda instance that holds it. That is the
 * whole cache this loader used to have, and on a low-traffic public page it almost never
 * survived to a second visitor: measured on prod 2026-09-06, three consecutive cold hits of
 * /whats-my-home-hiding took 16.8s, 16.7s and 19.2s, and two of them then rendered an EMPTY
 * neighbourhood picker because loadCohortTreeSafe degrades rather than 500s.
 *
 * Most of that time was migration 140's problem (get_distinct_cohort_cities seq-scanned 311k
 * listings and blew the 8s PostgREST statement_timeout, twice, thanks to withRetry). But the
 * per-instance cache is the reason EVERY cold visitor paid it instead of one. unstable_cache
 * is shared across instances and persists, so the rebuild is now paid once per revalidate
 * window by whoever happens to be first.
 *
 * Order matters: process-local first (free), Data Cache second, database last.
 */
function buildTreeCached(): Promise<CohortTree> {
  return unstable_cache(buildTreeFromDb, ['avm-cohort-tree', COHORT_TREE_CACHE_VERSION], {
    revalidate: TREE_TTL_MS / 1000,
  })();
}

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
async function buildTreeFromDb(): Promise<CohortTree> {
  const supabase = getServiceRoleClient();
  const [cohorts, pairs] = await Promise.all([
    withRetry(() => fetchAllAudit(supabase), 'audit'),
    withRetry(() => fetchAllPairs(supabase), 'pairs'),
  ]);
  return buildCohortTree(cohorts, pairs);
}

export async function loadCohortTree(): Promise<CohortTree> {
  if (treeCache && Date.now() - treeCache.at < TREE_TTL_MS) return treeCache.data;

  const tree = await buildTreeCached();
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
