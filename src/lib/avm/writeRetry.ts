/**
 * Which write failures are worth retrying, and how long to wait — pure, so the policy can
 * be tested without a database.
 *
 * WHY THIS EXISTS. The estimates recompute retried its READS and not its WRITES. On
 * 2026-09-16 shard 2 logged `upsert chunk @800 failed: stream timeout`, warned, and carried
 * on, so 200 rows kept whatever the table already held. That is worst for the rows being
 * written as NULL: clearing an unpriceable listing's stale AVM value is a WRITE, and a lost
 * clear looks exactly like a dwelling-model value surviving on a live land/commercial page.
 * The data-health canary reported three of them two days later, and since #319/#527 those
 * values also feed Deal Score and the nightly digest's ranking.
 */

/**
 * A fault in the pipe, not in the data.
 *
 * Retry only what a second attempt could plausibly fix. A constraint violation, a missing
 * column or a bad enum fails identically every time, and retrying it burns the backoff
 * budget while the run gets later — so those return false and surface immediately.
 *
 * `stream` is in the list because that is the literal wording the failure arrived as
 * ("stream timeout"); `57014` is Postgres's own statement_timeout SQLSTATE, matching the
 * read path's predicate.
 */
const TRANSIENT =
  /timeout|stream|57014|canceling statement|fetch failed|ECONN|EPIPE|ETIMEDOUT|socket|network|\b50[234]\b/i;

export function isTransientWriteError(message: string | null | undefined): boolean {
  return !!message && TRANSIENT.test(message);
}

/** Retries per chunk before a write is given up on and counted as failed. */
export const MAX_WRITE_RETRIES = 4;

/**
 * Exponential backoff, capped — the read path's ladder exactly (3s, 6s, 12s, 24s, 30s…).
 * A stream timeout usually means the far end is busy, so the wait has to grow; the cap
 * keeps a five-shard matrix from stretching a run past its timeout on retries alone.
 */
export function writeBackoffMs(attempt: number): number {
  return Math.min(30_000, 3_000 * 2 ** (Math.max(1, attempt) - 1));
}
