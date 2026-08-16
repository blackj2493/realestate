/**
 * Prune orphaned rows from property_estimates.
 *
 * WHY THIS EXISTS
 * ───────────────
 * property_estimates holds ONE precomputed AVM per ACTIVE listing (migration 023). The
 * nightly delta + twice-weekly recompute (refresh-property-estimates.ts) only WRITE rows for
 * active-eligible listings — a listing that has since SOLD / been terminated / dropped below
 * the price floor is correctly SKIPPED (isActive → false), but its estimate row is never
 * DELETED. So orphaned estimates for no-longer-active listings accumulate forever with a
 * frozen computed_at, bloat the table (Disk IO budget, CLAUDE.md §12), and get miscounted by
 * the estimate-freshness canary as "stale active estimates" (they aren't active). Measured
 * 2026-08-02: 24,541 of ~26k "stale" rows were SOLD listings.
 *
 * SAFETY — this never removes anything a live surface reads:
 *  • The only app readers (Compare getCompareData.ts, the Command-Center /api/estimates/
 *    sale-price batch) look up estimates for ACTIVE listings only (sold rows are purged from
 *    the active `properties` Typesense index) and both degrade gracefully on a missing row.
 *  • Every estimate is DERIVED — the refresh script regenerates any row from listings +
 *    raw_vow_sold. A mistaken delete self-heals on the next delta/recompute. Nothing is lost.
 *
 * A candidate must be BOTH (a) stale (computed_at older than --age-hours, default 120h — a
 * fresh row was just written by the refresh, so it is definitionally active) AND (b) NOT
 * active-eligible by the SAME predicate the refresh uses. So genuinely-active listings — even
 * un-estimable ones the refresh skips writing — are NEVER pruned; only definitely-inactive
 * orphans are. Bounding to stale rows also keeps the JSONB status detoast to ~26k rows, not
 * the whole table.
 *
 * The active-eligibility SQL below MUST match refresh-property-estimates.ts:104-192
 * (PRICE_FLOOR 50000, TERMINAL_STATUSES, status = Status ?? MlsStatus ?? StandardStatus).
 *
 * Usage:
 *   npx tsx scripts/admin/prune-property-estimates.ts                 # dry-run (counts only)
 *   npx tsx scripts/admin/prune-property-estimates.ts --apply         # delete
 *   npx tsx scripts/admin/prune-property-estimates.ts --apply --age-hours=120 --limit=5000
 * Env: DATABASE_URL (Session-pooler, like capture-price-events.ts).
 */
import 'dotenv/config';
import { Client } from 'pg';

// Keep in lock-step with refresh-property-estimates.ts:104-192.
const PRICE_FLOOR = 50000;
const TERMINAL_STATUSES = ['sold', 'closed', 'closed sale', 'leased', 'terminated', 'expired', 'suspended'];

function argVal(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : null;
}

// `NOT EXISTS (an active-eligible listings row)` — mirrors isActive(): in listings,
// list_price ≥ floor, resolved status (Status ?? MlsStatus ?? StandardStatus, lowered/trimmed)
// not terminal. coalesce = JS `??` (falls through on NULL only, so a present "" is kept, as ??).
const NOT_ACTIVE_ELIGIBLE = `
  NOT EXISTS (
    SELECT 1 FROM listings l
    WHERE l.listing_key = pe.listing_key
      AND l.list_price >= ${PRICE_FLOOR}
      AND lower(trim(coalesce(
            l.full_payload->>'Status',
            l.full_payload->>'MlsStatus',
            l.full_payload->>'StandardStatus', ''))) <> ALL($1::text[])
  )`;

async function main() {
  const apply = process.argv.includes('--apply');
  const ageHours = Math.max(1, Number(argVal('--age-hours')) || 120);
  const limit = Math.max(0, Number(argVal('--limit')) || 0);

  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL is not set (Session-pooler connection string required)');
    process.exit(1);
  }

  console.log('========================================');
  console.log('  Prune property_estimates (orphaned rows)');
  console.log(`  age > ${ageHours}h · ${apply ? 'APPLY (deleting)' : 'DRY-RUN'}${limit ? ` · limit ${limit}` : ''}`);
  console.log('========================================\n');

  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    const stale = `pe.computed_at < now() - make_interval(hours => ${ageHours})`;

    // Categorize what WOULD be pruned so we can eyeball it before writing.
    const breakdown = await c.query(
      `
      SELECT
        count(*) AS candidates,
        count(*) FILTER (WHERE l.listing_key IS NULL) AS orphan_not_in_listings,
        count(*) FILTER (WHERE l.listing_key IS NOT NULL AND (l.list_price IS NULL OR l.list_price < ${PRICE_FLOOR})) AS below_floor,
        count(*) FILTER (WHERE l.listing_key IS NOT NULL AND l.list_price >= ${PRICE_FLOOR}) AS terminal_status
      FROM property_estimates pe
      LEFT JOIN listings l ON l.listing_key = pe.listing_key
      WHERE ${stale} AND ${NOT_ACTIVE_ELIGIBLE}
      `,
      [TERMINAL_STATUSES]
    );
    const b = breakdown.rows[0];
    console.log('Prune candidates (stale AND not active-eligible):');
    console.table([b]);

    const total = await c.query(`SELECT count(*) AS n FROM property_estimates`);
    console.log(`property_estimates total: ${total.rows[0].n} → after prune: ${Number(total.rows[0].n) - Number(b.candidates)}\n`);

    if (!apply) {
      console.log(`DRY-RUN — re-run with --apply to delete the ${b.candidates} orphaned row(s).`);
      return;
    }

    // Delete. --limit bounds a first pass via a keyed subselect (DELETE has no LIMIT).
    const del = limit
      ? await c.query(
          `DELETE FROM property_estimates pe
           WHERE pe.listing_key IN (
             SELECT pe2.listing_key FROM property_estimates pe2
             WHERE pe2.computed_at < now() - make_interval(hours => ${ageHours})
               AND NOT EXISTS (
                 SELECT 1 FROM listings l WHERE l.listing_key = pe2.listing_key
                   AND l.list_price >= ${PRICE_FLOOR}
                   AND lower(trim(coalesce(l.full_payload->>'Status', l.full_payload->>'MlsStatus', l.full_payload->>'StandardStatus', ''))) <> ALL($1::text[])
               )
             LIMIT ${limit}
           )`,
          [TERMINAL_STATUSES]
        )
      : await c.query(
          `DELETE FROM property_estimates pe WHERE ${stale} AND ${NOT_ACTIVE_ELIGIBLE}`,
          [TERMINAL_STATUSES]
        );
    console.log(`✅ Deleted ${del.rowCount} orphaned estimate row(s).`);
  } finally {
    await c.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ prune-property-estimates failed:', err?.message ?? err);
    process.exit(1);
  });
