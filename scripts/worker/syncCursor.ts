/**
 * sync_state cursor decision — the recovery-critical bit of the nightly sync.
 *
 * CLAUDE.md §12 caveat: the pre-fix ingester.ts catch block advanced
 * `sync_state.last_sync_timestamp` to NOW even when the sync had failed
 * (`status='failed'`, `records_synced=0`). A missing or invalid token therefore
 * didn't just stop the sync — it permanently rolled the cursor forward, leaving
 * an unrecoverable gap that required a manual SQL reset.
 *
 * This module decides, deterministically, what the next cursor should be:
 *   • completed → advance to now (the standard "we caught up" semantics)
 *   • failed    → KEEP the previous cursor so the next attempt re-runs the
 *                 same window. Upserts (`onConflict: 'listing_key'`) make
 *                 re-processing safe even when a partial batch was already
 *                 written before the failure.
 *
 * If the previous cursor is unknown (e.g. readSyncState() itself threw), we
 * have no safe choice but to write `nowIso` — the loss is already irrecoverable
 * at that point, and a moving cursor is no worse than a stuck one.
 */

export type SyncOutcome = 'completed' | 'failed';

export function nextSyncCursor(
  outcome: SyncOutcome,
  previousCursor: string | null,
  nowIso: string
): string {
  if (outcome === 'failed') return previousCursor ?? nowIso;
  return nowIso;
}
