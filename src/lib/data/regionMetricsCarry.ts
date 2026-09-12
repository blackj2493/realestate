/**
 * Carry-forward rule for the nightly region_metrics precompute — the pure half of
 * scripts/admin/refresh-region-metrics.ts, testable without a database.
 *
 * THE FAILURE IT ANSWERS. computeAnalyticsInitial runs its 11 slice RPCs under
 * Promise.allSettled, so a cancelled RPC becomes `null` rather than an error, and the
 * precompute upserts the WHOLE payload — null slices included — over the last good row.
 * One cancelled query therefore blanks a live number on /data for a full day. Ottawa lost
 * stats, dom, cuts and rental that way on 2026-09-09, -10 and -12; Toronto lost dom, rental
 * and outcomes on 09-10. Nothing was wrong with any of the underlying data.
 *
 * WHY IT EXPIRES. "Always keep the previous value" would be worse than the bug it fixes:
 * the data-health canary reads exactly these fields to decide whether the metrics are
 * healthy, so an unbounded carry-forward would make a PERMANENTLY broken slice invisible
 * and serve a frozen number forever. The bound is what keeps both properties: inside the
 * window a transient cancellation costs nothing, and past it the null is written, the
 * canary fires, and someone looks at it.
 */

export type Payload = Record<string, unknown>;

/** 48h = two consecutive nightly runs. One missed night is noise; two is a fault. */
export const CARRY_MAX_HOURS_DEFAULT = 48;

export interface CarryInput {
  /** Tonight's payload. Mutated in place: carried slices are written back into it. */
  fresh: Payload;
  /** The payload this run replaces, or null when there is none / it could not be read. */
  prior: Payload | null;
  /** `computed_at` of the prior row. */
  priorComputedAt: string | null;
  /** Slice keys that came back null tonight. */
  nullSlices: readonly string[];
  nowMs: number;
  maxHours?: number;
}

/**
 * Fill tonight's null slices from the previous snapshot, where that snapshot is recent
 * enough to trust. Returns the slices actually carried — the caller logs them and keeps the
 * run non-zero, because a carried slice is still a failed slice.
 */
export function carryForwardSlices(input: CarryInput): string[] {
  const { fresh, prior, priorComputedAt, nullSlices, nowMs } = input;
  const maxHours = input.maxHours ?? CARRY_MAX_HOURS_DEFAULT;

  if (!prior || !priorComputedAt) return [];

  const priorMs = new Date(priorComputedAt).getTime();
  if (Number.isNaN(priorMs)) return [];

  // A prior stamp in the FUTURE is a clock fault, not freshness — refuse it rather than
  // treat it as infinitely young.
  const ageH = (nowMs - priorMs) / 3_600_000;
  if (ageH < 0 || ageH > maxHours) return [];

  const carried: string[] = [];
  for (const s of nullSlices) {
    if (fresh[s] == null && prior[s] != null) {
      fresh[s] = prior[s];
      carried.push(s);
    }
  }
  return carried;
}
