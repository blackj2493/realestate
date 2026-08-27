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
 *   Closed                → closed. A real sale or lease close.
 *   anything else         → dead. Cancelled / Withdrawn / Delete / Expired.
 *
 * `alive` means exactly one thing: THE FEED SAYS THIS IS STILL AVAILABLE INVENTORY.
 * It is the set the caller PARDONS — it clears the vault's orphan flag on every key
 * in it — so nothing that is off-market may appear there, for any reason:
 *
 *  - A Cancelled or Withdrawn record IS returned by the feed, but no code path writes
 *    that status into `listings`. The vault row stays frozen reading Active and
 *    reindex-from-vault resurrects it exactly like a NOT_IN_FEED row. Those keys are
 *    `dead`, and a key must never appear in both lists — it would be condemned and
 *    pardoned in the same run.
 *  - `closed` is deliberately NOT pardoned either. On the index-driven path the sold
 *    repair rewrites its vault payload to a terminal status, so the reindex skips it
 *    regardless of the flag; on the vault-wide sweep no repair runs, so the caller
 *    condemns it instead. Pardoning here would have made a stale-Active close
 *    re-indexable every single week.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface GhostPartition {
  /** Full payloads of verified closes → sold/lease repair path. */
  closed: any[];
  /** Keys to clear from the For-Sale index AND flag orphaned in the vault. */
  dead: string[];
  /** ONLY keys the feed still reports Active → clear any stale orphan flag. */
  alive: string[];
  /** `alive.length`, named for the run log's "keep: N" column. */
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
    } else {
      dead.push(key);
    }
  }

  return { closed, dead, alive, keptActive, statusTally };
}
