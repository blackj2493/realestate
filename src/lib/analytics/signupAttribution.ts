/**
 * Server side of lib/analytics/touch: turn the touches /welcome posted into one
 * `signup_attribution` row (migration 152).
 *
 * Best-effort by contract. The caller has already recorded the Terms acceptance — the
 * account exists — so nothing here may throw into it. A missing table (code deployed
 * before the migration) or a blocked-storage browser (no touches) costs the attribution
 * for that one account and nothing else.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { cleanTouches, type Touch } from "./touch";

type Prefix = "first" | "last";

function columns(prefix: Prefix, t: Touch | null): Record<string, string | null> {
  return {
    [`${prefix}_utm_source`]: t?.utm_source ?? null,
    [`${prefix}_utm_medium`]: t?.utm_medium ?? null,
    [`${prefix}_utm_campaign`]: t?.utm_campaign ?? null,
    [`${prefix}_utm_content`]: t?.utm_content ?? null,
    [`${prefix}_utm_term`]: t?.utm_term ?? null,
    [`${prefix}_referrer_host`]: t?.referrer_host ?? null,
    [`${prefix}_landing_path`]: t?.landing_path ?? null,
    [`${prefix}_at`]: t?.at ?? null,
  };
}

/** The row for one account, or null when the body carried nothing usable. */
export function attributionRow(userId: string, raw: unknown): Record<string, string | null> | null {
  const touches = cleanTouches(raw);
  if (!touches.first && !touches.last) return null;
  return { user_id: userId, ...columns("first", touches.first), ...columns("last", touches.last) };
}

export async function saveSignupAttribution(
  supabase: SupabaseClient,
  userId: string,
  raw: unknown
): Promise<{ saved: boolean; error: string | null }> {
  const row = attributionRow(userId, raw);
  if (!row) return { saved: false, error: null };
  try {
    // ignoreDuplicates: a retried acceptance must not overwrite the first answer.
    const { error } = await supabase
      .from("signup_attribution")
      .upsert(row, { onConflict: "user_id", ignoreDuplicates: true });
    return error ? { saved: false, error: error.message } : { saved: true, error: null };
  } catch (e) {
    return { saved: false, error: e instanceof Error ? e.message : String(e) };
  }
}
