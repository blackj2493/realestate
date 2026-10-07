/**
 * Reads and writes for the narrow ask (area_narrow_asks, migration 154). Service role only.
 *
 * Every function is best-effort and never throws: the ask rides on the nightly digest and
 * on page loads, and neither may fail over it. A missing table (migration not yet applied)
 * reads as "feature off" — `loadAsks` returns null and the worker sends the digest as before.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NarrowAskState } from "./narrowAsk";

export interface NarrowAskRow extends NarrowAskState {
  user_id: string;
  city: string;
  suggested_part: string | null;
}

/** userId → city → row, or null when the table cannot be read (feature off). */
export async function loadAsks(
  sb: SupabaseClient,
  userIds: string[]
): Promise<Map<string, Map<string, NarrowAskRow>> | null> {
  const out = new Map<string, Map<string, NarrowAskRow>>();
  if (!userIds.length) return out;
  const { data, error } = await sb
    .from("area_narrow_asks")
    .select("user_id, city, shown_count, resolved, suggested_part")
    .in("user_id", userIds);
  if (error) return null;
  for (const r of (data ?? []) as NarrowAskRow[]) {
    if (!out.has(r.user_id)) out.set(r.user_id, new Map());
    out.get(r.user_id)!.set(r.city, r);
  }
  return out;
}

/**
 * Feed City value → number of listings this reader opened, from vow_access_log. The latest
 * 300 opens per reader is plenty to name a part, and keeps every query under PostgREST's
 * 1,000-row cap.
 */
export async function loadOpensByFeedCity(
  sb: SupabaseClient,
  userId: string
): Promise<Record<string, number>> {
  try {
    const { data: logs } = await sb
      .from("vow_access_log")
      .select("resource")
      .eq("user_id", userId)
      .like("resource", "listing:%")
      .order("accessed_at", { ascending: false })
      .limit(300);
    const keys = [...new Set((logs ?? []).map((l) => String(l.resource).slice("listing:".length)))];
    if (!keys.length) return {};
    const counts: Record<string, number> = {};
    const perKey = new Map<string, number>();
    for (const l of logs ?? []) {
      const k = String(l.resource).slice("listing:".length);
      perKey.set(k, (perKey.get(k) ?? 0) + 1);
    }
    for (let i = 0; i < keys.length; i += 150) {
      const chunk = keys.slice(i, i + 150);
      const { data: rows } = await sb.from("listings").select("listing_key, city").in("listing_key", chunk);
      for (const r of rows ?? []) {
        const city = String(r.city ?? "").trim();
        if (city) counts[city] = (counts[city] ?? 0) + (perKey.get(String(r.listing_key)) ?? 0);
      }
    }
    return counts;
  } catch {
    return {};
  }
}

/** One more email carried the ask. Called only after the provider accepted the send. */
export async function markShown(
  sb: SupabaseClient,
  userId: string,
  city: string,
  previous: number,
  suggestedPart: string | null
): Promise<void> {
  try {
    await sb.from("area_narrow_asks").upsert(
      {
        user_id: userId,
        city,
        shown_count: previous + 1,
        last_shown_at: new Date().toISOString(),
        suggested_part: suggestedPart,
      },
      { onConflict: "user_id,city" }
    );
  } catch {
    /* the next digest simply counts from the old number */
  }
}

/** The reader answered — a part, or "keep the whole city". Ends the ask for good. */
export async function resolveAsk(
  sb: SupabaseClient,
  userId: string,
  city: string,
  answer: { resolved: "switched" | "kept"; part?: string | null; via: "email" | "app" }
): Promise<void> {
  try {
    await sb.from("area_narrow_asks").upsert(
      {
        user_id: userId,
        city,
        resolved: answer.resolved,
        resolved_part: answer.part ?? null,
        resolved_via: answer.via,
        resolved_at: new Date().toISOString(),
      },
      { onConflict: "user_id,city" }
    );
  } catch {
    /* the area change itself already happened; at worst the ask shows once more */
  }
}

/** An undo re-opens the ask, so the reader can pick again from the email or the app. */
export async function reopenAsk(sb: SupabaseClient, userId: string, city: string): Promise<void> {
  try {
    await sb
      .from("area_narrow_asks")
      .update({ resolved: null, resolved_part: null, resolved_via: null, resolved_at: null })
      .eq("user_id", userId)
      .eq("city", city);
  } catch {
    /* best effort */
  }
}
