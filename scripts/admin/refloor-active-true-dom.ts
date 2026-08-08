/**
 * Re-floor active listings' True DOM to the highest of their naive current-listing age and
 * their STITCHED campaign span.
 *
 * WHY THIS EXISTS
 * ───────────────
 * `true_dom` (flat `listings` column + Typesense `TrueDom`) is written per-sync, and the
 * naive-age floor that keeps it honest — `GREATEST(true_dom, days-since-OriginalEntryTimestamp)`
 * — lives ONLY in `processBatch` (scripts/worker/sync.ts). The scheduled sync runs that on the
 * `ModificationTimestamp gt cursor` DELTA only (Query A, ingester.ts). So a listing that is
 * (a) stable in the feed (ModificationTimestamp older than the delta window) AND (b) has no
 * `property_campaign_history` ledger row (base stitched true_dom defaults to 0, never
 * address-warmed) falls out of every delta and is NEVER re-floored → its true_dom freezes at 0
 * as it ages. Measured 2026-08-02: 29,516 active rows at true_dom=0, of which 22,351 are
 * genuinely >60 days old.
 *
 * The region RPCs (region_dom_distribution / region_active_aggregates) mask this with a
 * query-time GREATEST floor, so the market medians/%-stale are correct. But Typesense and the
 * flat column have NO query-time floor, so per-listing cards / watchlist / IsStale bubbles
 * under-report DOM and drop STALE badges for those ~22k aging listings.
 *
 * This job PERSISTS the same floor the RPC computes: it UPDATEs the flat column AND pushes the
 * corrected TrueDom/IsStale to the `properties` Typesense collection (the active search index),
 * decoupling DOM-freshness from the modification delta and from campaign-ledger coverage. Both
 * writes are needed: without the flat-column UPDATE, the next reindex-from-vault would revert
 * Typesense to the frozen value.
 *
 * SAFETY
 *  • `true_dom`/`is_stale` are DERIVED and monotonic here (GREATEST only ever raises true_dom
 *    to a listing's real age — it never lowers a value or fabricates beyond the naive age).
 *  • Active-set predicate mirrors the region RPCs EXACTLY (list_price floor, terminal-status
 *    exclusion), so no sold/terminal row is touched, and it reads only FLAT columns
 *    (standard_status, original_entry_timestamp) — zero full_payload detoast (CLAUDE.md §12).
 *  • Typesense uses action:'update' (partial — only TrueDom/IsStale), so no other field is
 *    disturbed; keys not present in `properties` fail per-item and are counted, never fatal.
 *
 * The floor / threshold below MUST match sync.ts (STALE_THRESHOLD_DAYS = 60) and the RPCs.
 *
 * SECOND FLOOR — the stitched span (added 2026-08-08)
 * ───────────────────────────────────────────────────
 * The naive floor above is blind to a RELISTED property: its stitched span always predates
 * the current campaign's entry timestamp, so GREATEST(stored, own-age) is a no-op and the
 * stored value stays frozen at whatever day the sync last wrote it. Reported on
 * E13615346 (67 North Edgely, Toronto) — nine sale campaigns since 2024-08-23, flat column
 * written 2026-07-30 = 706, live ledger 714 and climbing one per day. The listing page
 * re-stitches live (getListingDetail → refreshCampaignHistoryForListing) while Compare and
 * the cards read the frozen Typesense TrueDom, so one property showed two numbers.
 *
 * That divergence also corrupts Compare's BEST badge on the True DOM row (winner:"high"):
 * it ranks values frozen on DIFFERENT days, so it partly ranks sync recency, not market time.
 *
 * See LEDGER_AGE for why we reconstruct the span START instead of copying the ledger's own
 * true_dom, and for the under-state-by-at-most-one-day error direction.
 *
 * Usage:
 *   npx tsx scripts/admin/refloor-active-true-dom.ts                # dry-run (counts only)
 *   npx tsx scripts/admin/refloor-active-true-dom.ts --apply        # backfill: re-floor every drifted row
 *   npx tsx scripts/admin/refloor-active-true-dom.ts --apply --min-drift=3   # nightly: bound churn
 *   npx tsx scripts/admin/refloor-active-true-dom.ts --apply --limit=5000
 *   npx tsx scripts/admin/refloor-active-true-dom.ts --apply --skip-typesense   # flat column only
 * Env: DATABASE_URL (Session-pooler); TYPESENSE_ADMIN_API_KEY (for the Typesense push).
 *
 * --min-drift=N (default 1): only re-floor rows whose real age exceeds the stored true_dom by
 * ≥ N days. Every stable active listing drifts +1/day, so a no-tolerance nightly run would
 * re-touch the whole active book each night; the scheduled step passes a few days of slack to
 * bound churn (cards stay within N days), while a one-time backfill uses the default to clear
 * the full accrued gap. A row crossing the 60d stale line is ALWAYS included regardless of N,
 * so the STALE flip is never delayed.
 */
import 'dotenv/config';
import { Client as PgClient } from 'pg';
import Typesense from 'typesense';

const STALE_THRESHOLD_DAYS = 60; // lock-step with sync.ts / TemporalDistressEngine
const TERMINAL_STATUSES = ['sold', 'closed', 'closed sale', 'leased', 'terminated', 'expired', 'suspended'];
// Typesense Cloud host — hardcoded, in lockstep with client.ts + sync.ts (no host env var).
const TYPESENSE_HOST = '9uyapwh6e5qmvl34p-1.a1.typesense.net';
const TYPESENSE_PORT = 443;
const PROPERTIES_COLLECTION = 'properties';
const TS_CHUNK = 500;

// Naive current-listing age in days from the FLAT column (no detoast). GREATEST(0, …) guards
// a future OriginalEntryTimestamp.
const NAIVE_AGE = `GREATEST(0, floor(EXTRACT(EPOCH FROM (now() - l.original_entry_timestamp)) / 86400))::int`;

/**
 * Second floor: the STITCHED campaign span, re-measured to now.
 *
 * The naive floor above only rescues a listing whose true_dom sits below ITS OWN age. It is
 * structurally blind to a relisted property, because the stitched span always predates the
 * current campaign's entry timestamp — so GREATEST(706, 9) is a no-op and the stored value
 * stays frozen at whatever day it was last written (E13615346, 67 North Edgely: nine sale
 * campaigns since 2024-08-23, flat column written 2026-07-30 = 706, ledger 714 and climbing).
 * Measured 2026-08-08: 115,611 of 196,673 active rows with a ledger disagree, 20,641 of them
 * by ≥30 days, worst 720.
 *
 * We reconstruct the span START rather than copying `property_campaign_history.true_dom`.
 * That stored number is itself a snapshot taken at `fetched_at`, so copying it would just
 * inherit a second staleness; the start date is FIXED, so `now - start` is always current.
 *
 * start := fetched_at - true_dom days. Since true_dom = floor((fetched_at - start)/day), the
 * reconstruction lands on or AFTER the real start, so this floor under-states by at most one
 * day and can never over-state — the same conservative direction the naive floor takes.
 *
 * Only ever consulted for rows that pass ACTIVE_ELIGIBLE, so a span that has already ended
 * (terminated / sold) is never grown: those statuses are excluded before we get here.
 */
const LEDGER_AGE = `COALESCE(
  GREATEST(0, floor(EXTRACT(EPOCH FROM (now() - (h.fetched_at - make_interval(days => h.true_dom)))) / 86400))::int,
  0)`;

// Active-eligibility (flat columns only — no detoast). Mirrors the region RPCs' active set.
const ACTIVE_ELIGIBLE = `
  l.list_price >= 50000
  AND l.original_entry_timestamp IS NOT NULL
  AND l.standard_status IS NOT NULL
  AND l.standard_status <> ALL($1::text[])`;

/**
 * Every active row with the value it SHOULD carry: the highest of what it already has, its
 * own age, and its stitched span. One LEFT JOIN (property_campaign_history is keyed by
 * property_hash, so it cannot fan out) instead of a correlated subquery per row.
 */
const CANDIDATES_CTE = `
  SELECT l.listing_key,
         l.true_dom AS cur,
         GREATEST(l.true_dom, ${NAIVE_AGE}, ${LEDGER_AGE}) AS target,
         ${NAIVE_AGE}  AS naive_age,
         ${LEDGER_AGE} AS ledger_age
  FROM listings l
  LEFT JOIN property_campaign_history h
         ON h.property_hash = l.property_hash
        AND h.true_dom > 0
        AND h.fetched_at IS NOT NULL
  WHERE ${ACTIVE_ELIGIBLE}`;

// A candidate has drifted ≥ minDrift days below the value it should carry, OR just crossed the
// stale line (that transition is caught regardless of minDrift so the STALE flip is never delayed).
function driftFilter(minDrift: number): string {
  return `target - cur >= ${minDrift}
    OR (cur <= ${STALE_THRESHOLD_DAYS} AND target > ${STALE_THRESHOLD_DAYS})`;
}

function argVal(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : null;
}

async function pushToTypesense(rows: { listing_key: string; true_dom: number; is_stale: boolean }[]): Promise<{ updated: number; failed: number }> {
  const key = process.env.TYPESENSE_ADMIN_API_KEY;
  if (!key) {
    console.warn('   ⚠️  TYPESENSE_ADMIN_API_KEY not set — skipping the Typesense push (flat column updated only).');
    return { updated: 0, failed: rows.length };
  }
  const ts = new Typesense.Client({
    nodes: [{ host: TYPESENSE_HOST, port: TYPESENSE_PORT, protocol: 'https' }],
    apiKey: key,
    connectionTimeoutSeconds: 30,
  });
  let updated = 0;
  let failed = 0;
  for (let i = 0; i < rows.length; i += TS_CHUNK) {
    const chunk = rows.slice(i, i + TS_CHUNK);
    const docs = chunk.map((r) => ({ id: r.listing_key, TrueDom: r.true_dom, IsStale: r.is_stale }));
    try {
      // action:'update' = partial update of only the provided fields. A doc absent from the
      // active `properties` index (e.g. a ghost/purged key) fails just its own line.
      const res = await ts.collections(PROPERTIES_COLLECTION).documents().import(docs, { action: 'update' });
      const results = Array.isArray(res) ? res : [];
      for (const r of results) (r as { success?: boolean }).success ? updated++ : failed++;
    } catch (err) {
      // The Typesense client THROWS ImportError when ANY line in the batch fails, exposing
      // per-doc outcomes on err.importResults. Attribute real successes/failures from it
      // (a not-in-`properties` key failing is expected — those aren't cards); only when the
      // whole call died with no per-doc results do we count the chunk as failed.
      const importResults = (err as { importResults?: { success: boolean }[] }).importResults;
      if (Array.isArray(importResults)) {
        for (const r of importResults) r.success ? updated++ : failed++;
      } else {
        failed += chunk.length;
        console.warn(`   ⚠️  Typesense chunk ${i}-${i + chunk.length} failed:`, (err as Error)?.message ?? err);
      }
    }
    console.log(`   … Typesense ${Math.min(i + TS_CHUNK, rows.length)}/${rows.length} (updated ${updated}, failed ${failed})`);
  }
  return { updated, failed };
}

async function main() {
  const apply = process.argv.includes('--apply');
  const skipTypesense = process.argv.includes('--skip-typesense');
  const limit = Math.max(0, Number(argVal('--limit')) || 0);
  const minDrift = Math.max(1, Number(argVal('--min-drift')) || 1);

  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL is not set (Session-pooler connection string required)');
    process.exit(1);
  }

  console.log('========================================');
  console.log('  Re-floor active True DOM (naive age + stitched span)');
  console.log(`  ${apply ? 'APPLY' : 'DRY-RUN'} · min-drift ${minDrift}d${limit ? ` · limit ${limit}` : ''}${skipTypesense ? ' · flat-column only' : ''}`);
  console.log('========================================\n');

  const c = new PgClient({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    // Dry-run breakdown: how many rows would move, by how much, and — the part that matters
    // for this change — how many are reachable ONLY via the stitched span (the relisted
    // properties the naive floor is blind to).
    const breakdown = await c.query(
      `
      WITH cand AS (${CANDIDATES_CTE})
      SELECT
        count(*) AS candidates,
        count(*) FILTER (WHERE cur = 0) AS from_zero,
        count(*) FILTER (WHERE target > ${STALE_THRESHOLD_DAYS} AND cur <= ${STALE_THRESHOLD_DAYS}) AS becomes_stale,
        count(*) FILTER (WHERE ledger_age > naive_age) AS ledger_beats_naive,
        count(*) FILTER (WHERE ledger_age > GREATEST(cur, naive_age)) AS only_reachable_via_ledger,
        round(avg(target - cur)) AS avg_days_gained,
        max(target - cur) AS max_days_gained,
        max(target) AS max_target
      FROM cand
      WHERE ${driftFilter(minDrift)}
      `,
      [TERMINAL_STATUSES]
    );
    const b = breakdown.rows[0];
    console.log('Re-floor candidates (active, below naive age OR below stitched span):');
    console.table([b]);

    // Coverage note: active-by-detoast rows we skip because the flat standard_status is NULL.
    const skipped = await c.query(
      `
      SELECT count(*) AS active_rows_skipped_null_status
      FROM listings l
      WHERE l.list_price >= 50000
        AND l.original_entry_timestamp IS NOT NULL
        AND l.standard_status IS NULL
        AND lower(coalesce(l.full_payload->>'Status', l.full_payload->>'MlsStatus', l.full_payload->>'StandardStatus', '')) <> ALL($1::text[])
        AND ${NAIVE_AGE} > l.true_dom
      `,
      [TERMINAL_STATUSES]
    );
    const skN = Number(skipped.rows[0].active_rows_skipped_null_status);
    if (skN > 0) console.log(`ℹ️  ${skN} active row(s) skipped (flat standard_status NULL — re-floored on their next feed touch).`);

    if (!apply) {
      console.log(`\nDRY-RUN — re-run with --apply to re-floor the ${b.candidates} row(s) + push TrueDom/IsStale to Typesense.`);
      return;
    }

    if (Number(b.candidates) === 0) {
      console.log('\nNothing to re-floor. Done.');
      return;
    }

    // Apply: raise true_dom to `target` (the max of current / own age / stitched span) and
    // recompute is_stale at the 60d threshold. The target is computed ONCE in the CTE and
    // joined by key, so the SET and the stale flag can't drift apart the way two inlined
    // GREATEST() copies could.
    const upd = await c.query(
      `
      WITH cand AS (${CANDIDATES_CTE}),
           sel AS (
             SELECT listing_key, target FROM cand
             WHERE ${driftFilter(minDrift)}
             ${limit ? `LIMIT ${limit}` : ''}
           )
      UPDATE listings l
         SET true_dom = sel.target,
             is_stale = sel.target > ${STALE_THRESHOLD_DAYS}
        FROM sel
       WHERE sel.listing_key = l.listing_key
      RETURNING l.listing_key, l.true_dom, l.is_stale
      `,
      [TERMINAL_STATUSES]
    );
    console.log(`\n✅ Flat column: re-floored ${upd.rowCount} listing(s).`);

    if (skipTypesense) {
      console.log('   (--skip-typesense) Not pushing to Typesense; next reindex-from-vault will carry the corrected values.');
      return;
    }

    const rows = upd.rows.map((r) => ({ listing_key: r.listing_key as string, true_dom: Number(r.true_dom), is_stale: !!r.is_stale }));
    console.log(`\n📤 Pushing TrueDom/IsStale to Typesense '${PROPERTIES_COLLECTION}' for ${rows.length} key(s)…`);
    const { updated, failed } = await pushToTypesense(rows);
    console.log(`\n✅ Typesense: ${updated} updated, ${failed} not-in-index/failed (keys purged from the active index are expected here).`);
  } finally {
    await c.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ refloor-active-true-dom failed:', err?.message ?? err);
    process.exit(1);
  });
