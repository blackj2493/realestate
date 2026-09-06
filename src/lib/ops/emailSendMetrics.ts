/**
 * Nightly email send counters — the durable record that "how much mail went out last
 * night?" has an answer at all.
 *
 * WHY: `email_send_failures` (098) records a send that FAILED. Nothing recorded a send that
 * was never attempted, so the two states that matter most were indistinguishable from the
 * outside: a quiet night with genuinely nothing to say, and a selector that silently
 * stopped matching anyone. The workers print their counts to stdout and notifyRun.ts quotes
 * the tail into the operator email, but stdout is not queryable and nobody asserts on it.
 *
 * WHY metric_snapshots and not a new table: it is already the project's nightly numeric
 * time series (migration 090), already pruned to ~400 days by the canary, and its PK
 * (captured_on, region, metric) is exactly one row per night per counter. Writing under a
 * reserved `_ops` region is safe alongside the market data: checkDrift() only iterates the
 * regions present in the CURRENT market snapshot and only over DRIFT_RULES metrics, so
 * these rows are invisible to it. The canary's own upsert writes market rows only, so it
 * never clobbers these.
 *
 * Every write here is BEST-EFFORT. Losing a monitoring counter must never fail a send run
 * or, worse, abort it before the baselines advance.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/** Reserved region for operational counters. Never a real market name. */
export const OPS_REGION = "_ops";

/**
 * Metric ids. Stable strings — the canary and any later ops digest read them by name, so
 * renaming one silently breaks the history rather than erroring.
 */
export const EMAIL_METRICS = {
  /** Users the nightly digest had something to say to (before any consent gate). */
  digestDue: "email.digest_due",
  /** Digests the provider ACCEPTED. Not "did not throw": the SDK returns API errors in
   *  `{ error }`, and counting those as sent is what hid the 2026-09 incident. */
  digestSent: "email.digest_sent",
  /** Emails the provider REJECTED (rate limit, quota, validation). Non-zero means real
   *  people did not get tonight's news; their watermarks were left for the next run. */
  digestFailed: "email.digest_failed",
  /** Users with news who were skipped on consent (opt-out / stream off / paused). */
  digestSuppressed: "email.digest_suppressed",
  /** Onboarding-drip candidates examined. */
  dripConsidered: "email.drip_considered",
  /** Onboarding-drip messages actually sent. */
  dripSent: "email.drip_sent",
} as const;

/** UTC calendar day — matches how the canary keys its own snapshot rows. */
export function opsDay(now: number = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

/**
 * Merge one metric map into today's row set, keeping the LARGER value per metric.
 *
 * Max, not overwrite, because the night is expected to run TWICE: nightly-emails.yml fires
 * on the sync completing AND on an independent 06:47 UTC backstop cron. The second run is
 * correct and harmless — every sender is watermark-based, so it finds nothing new and sends
 * nobody twice — but it reports 0. A plain upsert would let that zero erase the real count
 * and make every healthy night look like a stall. The concurrency group serialises the two
 * runs, so read-then-max needs no locking.
 */
export function mergeMax(
  existing: Map<string, number>,
  metrics: Record<string, number>
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [metric, value] of Object.entries(metrics)) {
    const prior = existing.get(metric);
    out[metric] = prior == null ? value : Math.max(prior, value);
  }
  return out;
}

/**
 * Record tonight's counters under the `_ops` region for today (UTC).
 *
 * Best-effort throughout: a monitoring counter must never fail a send run, and must never
 * abort one before its baselines advance.
 */
export async function recordEmailSendMetrics(
  sb: Pick<SupabaseClient, "from">,
  metrics: Record<string, number>,
  now: number = Date.now()
): Promise<void> {
  if (!Object.keys(metrics).length) return;
  const captured_on = opsDay(now);
  try {
    const { data } = await sb
      .from("metric_snapshots")
      .select("metric, value")
      .eq("captured_on", captured_on)
      .eq("region", OPS_REGION);
    const existing = new Map<string, number>(
      (data ?? []).map((r) => {
        const row = r as { metric: string; value: string | number | null };
        return [row.metric, row.value == null ? 0 : Number(row.value)];
      })
    );
    const merged = mergeMax(existing, metrics);
    const payload = Object.entries(merged).map(([metric, value]) => ({
      captured_on,
      region: OPS_REGION,
      metric,
      value,
    }));
    const { error } = await sb
      .from("metric_snapshots")
      .upsert(payload, { onConflict: "captured_on,region,metric" });
    if (error) console.warn(`[ops] could not record email send metrics: ${error.message}`);
  } catch (e) {
    // supabase-js rejects on a dropped fetch instead of returning { error }.
    console.warn("[ops] email send metrics write threw:", e instanceof Error ? e.message : e);
  }
}
