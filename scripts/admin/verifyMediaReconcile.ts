/**
 * Is the nightly blank-gallery healer actually working?
 *
 * This exists because "the media reconcile is broken" produced NO visible signal for five
 * weeks. The sweep is best-effort by design — it swallows query errors so a failure can
 * never fail the nightly sync — and its page query was timing out every night while the
 * run stayed green and the log said "Scanned 0 … recovered 0". 10,751 active listings sat
 * with a blank gallery. See migration 108 for the post-mortem.
 *
 * Four checks, each targeting a different way the sweep can die silently:
 *
 *   1. INDEX PRESENT  — idx_listings_empty_media (108) exists and is VALID. A
 *                       CREATE INDEX CONCURRENTLY that fails midway leaves an INVALID
 *                       index behind that the planner ignores, which looks like no index
 *                       at all.
 *   2. PLAN           — the sweep's real predicate still plans as an index scan. This is
 *                       the one that actually regressed: a partial index only applies when
 *                       the query's WHERE implies the index predicate, so editing the
 *                       .or() filter in sweepMissingMedia silently reverts the plan.
 *   3. TIMING         — the sweep's real query, issued through PostgREST as the sync does,
 *                       inside the 8s statement_timeout it actually runs under. A direct
 *                       psql EXPLAIN does NOT reproduce the failure (the equivalent
 *                       cardinality() form plans fine), so this must go over the wire.
 *   4. OUTCOME        — what the last run recorded in sync_state, fed through the same
 *                       checkMediaReconcile rule the nightly canary uses.
 *
 * Read-only. Exits non-zero if any check fails, so it can gate a workflow.
 *
 * Usage: npx tsx --env-file=.env.local scripts/admin/verifyMediaReconcile.ts
 * Env:   DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
import 'dotenv/config';
import { Client } from 'pg';
import { getServiceRoleClient } from '../../src/lib/supabase/client';
import { checkMediaReconcile } from '../../src/lib/data/healthChecks';

const WINDOW_DAYS = 21;
// PostgREST executes as service_role, which inherits authenticator's 8s statement_timeout.
// Anything close to that is a latent failure even if it happens to pass today.
const TIMEOUT_BUDGET_MS = 8000;
const WARN_AT_MS = 2000;

let failures = 0;
const fail = (m: string) => { console.log(`  ❌ ${m}`); failures++; };
const pass = (m: string) => console.log(`  ✅ ${m}`);

(async () => {
  console.log('\n════ Media reconciliation health ════\n');
  const cutoffIso = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
  const pg = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await pg.connect();
  await pg.query("SET statement_timeout TO '120s'");

  // ── 1. the index exists and is valid ──────────────────────────────────────
  console.log('1. Partial index (migration 108)');
  const { rows: idx } = await pg.query(`
    SELECT c.relname, i.indisvalid, i.indisready, pg_get_expr(i.indpred, i.indrelid) AS predicate
    FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
    WHERE c.relname = 'idx_listings_empty_media'`);
  if (idx.length === 0) {
    fail('idx_listings_empty_media is MISSING — apply migration 108');
  } else if (!idx[0].indisvalid || !idx[0].indisready) {
    fail(`idx_listings_empty_media exists but is INVALID (a failed CONCURRENTLY build) — DROP and re-apply 108`);
  } else {
    pass(`idx_listings_empty_media valid · predicate: ${idx[0].predicate}`);
  }

  // ── 2. the sweep's predicate still plans as an index scan ──────────────────
  console.log('\n2. Query plan for the sweep predicate');
  const { rows: plan } = await pg.query(
    `EXPLAIN (FORMAT JSON) SELECT listing_key, full_payload FROM listings
       WHERE (media_urls IS NULL OR media_urls = '{}')
         AND created_at >= $1 AND listing_key > ''
       ORDER BY listing_key ASC LIMIT 100`, [cutoffIso]);
  const planText = JSON.stringify(plan[0]['QUERY PLAN']);
  if (planText.includes('idx_listings_empty_media')) {
    pass('planner uses idx_listings_empty_media');
  } else if (/Seq Scan/.test(planText)) {
    fail(
      'planner chose a SEQ SCAN — this is the exact regression migration 108 fixed. ' +
        'The .or() filter in sweepMissingMedia and the index predicate have drifted apart.'
    );
  } else {
    fail(`planner is not using the partial index; plan = ${planText.slice(0, 300)}`);
  }

  // ── 3. the real query, over the wire, under the real timeout ───────────────
  console.log('\n3. Live PostgREST timing (the 8s ceiling the sync runs under)');
  const supabase = getServiceRoleClient();
  for (const s of [
    { label: 'recent sweep ', since: cutoffIso, until: null as string | null },
    { label: 'backlog sweep', since: null as string | null, until: cutoffIso },
  ]) {
    let q = supabase
      .from('listings')
      .select('listing_key, full_payload')
      .or('media_urls.is.null,media_urls.eq.{}')
      .gt('listing_key', '')
      .order('listing_key', { ascending: true })
      .limit(100);
    if (s.since) q = q.gte('created_at', s.since);
    if (s.until) q = q.lt('created_at', s.until);
    const t0 = Date.now();
    const { data, error } = await q;
    const ms = Date.now() - t0;
    if (error) fail(`${s.label}: ${error.code} ${error.message} (after ${ms}ms)`);
    else if (ms > WARN_AT_MS)
      fail(`${s.label}: ${ms}ms — too close to the ${TIMEOUT_BUDGET_MS}ms statement_timeout`);
    else pass(`${s.label}: ${ms}ms, ${data?.length ?? 0} rows`);
  }

  // ── 4. what the last nightly run actually recorded ─────────────────────────
  console.log('\n4. Last recorded sweep outcome');
  const { count } = await supabase
    .from('listings')
    .select('listing_key', { count: 'exact', head: true })
    .or('media_urls.is.null,media_urls.eq.{}');
  const { data: sweeps } = await supabase
    .from('sync_state')
    .select('id, records_synced, status, updated_at')
    .in('id', ['media_reconcile_recent', 'media_reconcile_backlog']);

  console.log(`   listings with a blank gallery: ${count ?? 0}`);
  for (const s of sweeps ?? []) {
    const r = s as any;
    console.log(`   ${r.id}: status=${r.status} scanned=${r.records_synced} at=${r.updated_at}`);
  }
  const problems = checkMediaReconcile({
    emptyMedia: count ?? 0,
    sweeps: (sweeps ?? []).map((r: any) => ({
      id: r.id, scanned: r.records_synced, status: r.status, updatedAt: r.updated_at,
    })),
    nowMs: Date.now(),
  });
  if (problems.length === 0) pass('canary rule reports healthy');
  for (const p of problems) {
    // A warn here is expected until the first nightly run on this code writes its row.
    if (p.severity === 'error') fail(`${p.check}: ${p.detail}`);
    else console.log(`  ⚠️  ${p.check}: ${p.detail}`);
  }

  await pg.end();
  console.log(failures === 0 ? '\n✅ All checks passed.\n' : `\n❌ ${failures} check(s) failed.\n`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('❌', e?.message || e); process.exit(1); });
