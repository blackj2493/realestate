/**
 * Concurrent-writer detection for the admin repair jobs.
 *
 * WHY THIS EXISTS
 * ───────────────
 * The daily sync and the rent-metric recompute write the SAME rows in Postgres and
 * Typesense, with no coordination between them. On 2026-08-21 they overlapped: the
 * sync started at 03:41:26Z on commit f1bb426, the 1.6x-multiplier fix merged at
 * 03:45:46Z, and the run went on writing pre-fix values until roughly 05:10Z — over
 * the top of a repair running at the same time. 382 Via Campanile was created at
 * 04:56Z with an inflated rent and kept it, because a later sync only re-transforms a
 * ModificationTimestamp delta and never revisits a feed-stable listing.
 *
 * Nothing errored. Both jobs reported success. That is the whole problem: a silent
 * partial overwrite is indistinguishable from a clean run.
 *
 * TWO SIGNALS, because either alone can lie:
 *   REPORTED — sync_state.status, which the ingester sets. A crashed run leaves
 *              'running' behind forever, so it only counts while it is FRESH.
 *   OBSERVED — listings.updated_at moving right now. Needs no cooperation from the
 *              writer, so it catches a sync whose own bookkeeping is wrong.
 *
 * The decision is pure and lives here; the queries live at the call site.
 */

/** A stuck 'running' row must not block the repair forever. */
export const SYNC_STATUS_FRESH_HOURS = 4;
/** Rows written inside this window mean somebody else is mid-write. */
export const LIVE_WRITE_WINDOW_MIN = 5;
/**
 * Below this, assume incidental traffic rather than a sync. A real delta sync writes
 * thousands of rows in five minutes; a handful is a single listing being edited, a
 * webhook, or a manual fix.
 */
export const LIVE_WRITE_THRESHOLD = 25;

export interface WriterSignals {
  /** sync_state rows currently reporting status='running' AND still fresh. */
  running: Array<{ id: string; minutesAgo: number }>;
  /** listings rows whose updated_at falls inside LIVE_WRITE_WINDOW_MIN. */
  liveWrites: number;
}

/**
 * Human-readable reasons to refuse. Empty array means it is safe to start.
 *
 * Returns reasons rather than a boolean so the caller can print WHY — "refusing to
 * start" with no cause is the kind of message people learn to bypass with --force
 * without reading.
 */
export function concurrentWriterReasons(signals: WriterSignals): string[] {
  const reasons: string[] = [];
  for (const r of signals.running) {
    reasons.push(`sync_state '${r.id}' reports status=running (${r.minutesAgo}m ago)`);
  }
  if (signals.liveWrites >= LIVE_WRITE_THRESHOLD) {
    reasons.push(
      `${signals.liveWrites.toLocaleString()} listings written in the last ${LIVE_WRITE_WINDOW_MIN}m`
    );
  }
  return reasons;
}
