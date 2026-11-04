/**
 * One-time backfill: re-fetch every conditional deal (Sold / Leased Conditional, with or
 * without an escape clause) from the IDX feed and run it through the Query A page path.
 *
 * Why: until feedStatusFilter.ts, Query A asked only for StandardStatus 'Active'. Since
 * ~June 2026 the feed sends conditional deals as 'Active Under Contract', so ~4.2k homes
 * kept their old "New" / "Price Change" status in the vault and the search index and
 * showed as plainly for sale. The nightly sync now fetches them as they CHANGE; this
 * catches up the ones that changed before the fix.
 *
 * Idempotent (same upsert path as the nightly sync). ~43 pages of 100, ~1 s apart.
 * Watchlist alerts: a saved home that went conditional gets its "SOLD CONDITIONAL"
 * alert on the next alerts run, late by the time it sat stale.
 *
 * Usage:
 *   npx tsx scripts/admin/backfillConditionalStatus.ts --dry-run   # count only
 *   npx tsx scripts/admin/backfillConditionalStatus.ts
 */
import 'dotenv/config';
import { runConditionalBackfill } from '../worker/ingester';

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  console.log(`Conditional-status backfill${dryRun ? ' (dry run)' : ''}`);
  const r = await runConditionalBackfill(dryRun);
  console.log(`Done: ${r.records} listings in ${r.pages} pages, ${r.errors.length} errors.`);
  for (const e of r.errors.slice(0, 20)) console.error(`  ${e}`);
  if (r.errors.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
