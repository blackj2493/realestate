/**
 * Ghost partition — routes each ghost candidate by the status the VOW feed reports
 * for it RIGHT NOW. Extracted from ghostReconcile.main() so it can be tested: the
 * script calls main() at import time, and this is the one piece of the reconcile
 * where a mistake is both easy to make and expensive (it decides what gets deleted
 * from the live index and what gets written off in the vault).
 *
 * Four outcomes, from one lookup:
 *
 *   NOT_IN_FEED           → dead. The feed does not serve this key at all. It cannot
 *                           be available inventory.
 *   Active*               → alive, kept. Snapshot-timing false positive, or a
 *                           conditional (Sold Conditional / Leased Conditional),
 *                           which stays visible by product policy.
 *   Closed                → closed + alive. A real sale or lease close; the caller
 *                           runs it through the Query-B repair path, which rewrites
 *                           the vault payload to a terminal status.
 *   anything else         → dead. Cancelled / Withdrawn / Delete / Expired.
 *
 * `alive` is NOT simply "the feed returned it". A Cancelled or Withdrawn record IS
 * returned, but no code path writes that status into `listings`, so the vault row
 * stays frozen reading Active and reindex-from-vault will resurrect it exactly like
 * a NOT_IN_FEED row. Those keys therefore belong in `dead`, and must never leak into
 * `alive` — the caller clears the orphan flag on everything in `alive`, so a key in
 * both lists would be condemned and then pardoned in the same run.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface GhostPartition {
  /** Full payloads of verified closes → sold/lease repair path. */
  closed: any[];
  /** Keys to clear from the For-Sale index AND flag orphaned in the vault. */
  dead: string[];
  /** Keys the feed proves are still real inventory → clear any stale orphan flag. */
  alive: string[];
  /** Count of `alive` keys held back from `closed` because they are still Active. */
  keptActive: number;
  /** `StandardStatus/MlsStatus` → count, for the run log. */
  statusTally: Record<string, number>;
}

export function partitionGhosts(
  ghosts: string[],
  payloads: Map<string, any>
): GhostPartition {
  const closed: any[] = [];
  const dead: string[] = [];
  const alive: string[] = [];
  let keptActive = 0;
  const statusTally: Record<string, number> = {};

  for (const key of ghosts) {
    const raw = payloads.get(key);
    const label = raw ? `${raw.StandardStatus}/${raw.MlsStatus}` : 'NOT_IN_FEED';
    statusTally[label] = (statusTally[label] ?? 0) + 1;

    if (!raw) {
      dead.push(key);
    } else if (String(raw.StandardStatus).startsWith('Active')) {
      keptActive++;
      alive.push(key);
    } else if (raw.StandardStatus === 'Closed') {
      closed.push(raw);
      alive.push(key);
    } else {
      dead.push(key);
    }
  }

  return { closed, dead, alive, keptActive, statusTally };
}
