/**
 * Stale-checkout detection for the bulk index writers.
 *
 * WHY THIS EXISTS
 * ───────────────
 * On 2026-08-23 someone ran `scripts/worker/reindex-from-vault.ts` from a checkout
 * parked on `feat/email-comms`, 387 commits behind `origin/main`. The script upserts
 * whole documents built by that checkout's `transformListing()`, so every active
 * listing was rewritten by an ETL from May. 177,611 of 178,849 documents — 99.3% of
 * the collection — took the old code's output.
 *
 * Six regressions landed at once, and not one of them errored:
 *   • `isDistressed` reverted to the retired age rule (46.18% of actives, up from 1.2%)
 *   • `IsStale` reverted to the naive DOM>90 placeholder, so it contradicted `TrueDom`
 *     on 35,418 documents
 *   • the retired 1.6x suite-rent multiplier came back on ~54% of the book
 *   • `rent_match_tier`, `suite_rent_est`, `suite_rent_tier` were deleted outright
 *   • `LeaseTrueDom`, `LeaseTotalPriceDrop` were deleted outright
 *   • the rent ladder lost the plus-room split and the county rung
 *
 * The last four are the reason a stale checkout is worse than a stale rule: the upsert
 * REPLACES the document, so a field the old code never emits does not go stale — it
 * disappears. No reader errors on an absent optional field. It renders as "no data".
 *
 * TWO SIGNALS, because either alone can lie:
 *   BEHIND — commits on `origin/main` that HEAD lacks, counted ONLY over the paths that
 *            decide what a document contains. A checkout behind by a content snapshot
 *            writes the same documents as the tip; one behind by a transformer change
 *            does not. Counting every commit would fire every morning after the daily
 *            content commit, and a guard that fires on noise teaches people to pass
 *            --force without reading it.
 *   DIRTY  — uncommitted edits under those same paths. The code that will run is then
 *            no reviewed commit at all. The 2026-08-23 checkout carried 20 modified
 *            worker scripts on top of its 387-commit lag.
 *
 * The decision is pure and lives here; the git commands live at the call site.
 */

/** Paths whose content decides what a written document looks like. */
export const DOCUMENT_SHAPING_PATHS = [
  'scripts/worker',
  'scripts/admin',
  'src/lib',
] as const;

export interface CheckoutSignals {
  /**
   * Commits reachable from `origin/main` but not from HEAD, restricted to
   * DOCUMENT_SHAPING_PATHS. `git rev-list --count HEAD..origin/main -- <paths>`.
   */
  behind: number;
  /** Tracked files modified under those paths. `git status --porcelain -- <paths>`. */
  dirty: number;
  /** Branch at HEAD, or null when detached. Reported, never judged. */
  branch: string | null;
  /**
   * True when `origin/main` could not be read at all — no remote, no network, a fresh
   * clone with no fetch. Unknown is not the same as clean, so it refuses too.
   */
  remoteUnknown: boolean;
}

/**
 * Human-readable reasons to refuse. An empty array means the checkout may write.
 *
 * Returns reasons rather than a boolean so the caller can print WHY. "Refusing to
 * start" with no cause is the kind of message people learn to bypass.
 */
export function staleCheckoutReasons(signals: CheckoutSignals): string[] {
  const reasons: string[] = [];

  if (signals.remoteUnknown) {
    reasons.push(
      'could not read origin/main — run `git fetch origin main` so the lag can be measured'
    );
    // A comparison against a ref that could not be read proves nothing, so stop here
    // rather than report a `behind` of 0 that was never measured.
    return reasons;
  }

  if (signals.behind > 0) {
    const where = signals.branch ? `'${signals.branch}'` : 'this detached HEAD';
    reasons.push(
      `${where} is ${signals.behind.toLocaleString()} commit(s) behind origin/main in ` +
        `${DOCUMENT_SHAPING_PATHS.join(', ')} — the documents it writes would not match the ones main writes`
    );
  }

  if (signals.dirty > 0) {
    reasons.push(
      `${signals.dirty.toLocaleString()} uncommitted change(s) under ` +
        `${DOCUMENT_SHAPING_PATHS.join(', ')} — the code that would run is not any reviewed commit`
    );
  }

  return reasons;
}
