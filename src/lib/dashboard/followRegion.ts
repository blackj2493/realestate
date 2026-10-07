/**
 * Add one area to an account and make it actually email — the shared step for every
 * server-side "follow this market" entry point.
 *
 * WHY IT IS SHARED. `config.regions` and the `market_bubbles` city rows are two tables with
 * nothing in the schema tying them together, and this codebase has now been bitten four
 * separate times by a writer that updated one and not the other (see areaAlertSync's
 * header, and PR #511 for the signup path that survived the first round of fixes). The
 * answer that stuck was "one place every writer passes through". Two routes now need this
 * exact operation — the Weekly Data Drop chip (HMAC, service-role) and the in-app follow
 * prompt (session, RLS) — so it lives here once rather than being typed out twice and
 * drifting on the fifth change.
 *
 * MERGE, NEVER REPLACE. The blob also holds boards, persona and the market-activity lens.
 * Writing `{ regions }` alone silently resets the rest of someone's dashboard.
 *
 * Best-effort by contract: every failure is reported in the result and none of them throw.
 * Both callers are doing this behind the user's actual action and must not fail over it.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { reconcileCityAlerts } from "./areaAlertSync";
import { recordActivation } from "@/lib/analytics/activation";

/** Cap saved regions, mirroring the 10-bubble cap in migration 025. */
export const MAX_REGIONS = 10;

/** The same bound `cleanRegions` applies, so anything accepted here survives the reconcile. */
const MAX_REGION_LEN = 80;

export interface FollowRegionResult {
  /** False only when the region was unusable or the write failed. */
  ok: boolean;
  /** True when the region was newly added; false when the account already had it. */
  added: boolean;
  /** The account's regions after the call. */
  regions: string[];
  /** Regions that gained a nightly-email row. */
  alerted: string[];
  /** Non-fatal. Reported so a caller can log it; never thrown. */
  error: string | null;
}

/** Trim and bound a region name, or null when it is unusable. */
export function cleanRegionName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim();
  if (!name || name.length > MAX_REGION_LEN) return null;
  return name;
}

export interface ReplaceRegionResult {
  ok: boolean;
  /** True when `from` was on the account and is now `to`. */
  replaced: boolean;
  regions: string[];
  error: string | null;
}

/**
 * Swap one area for another in place — "follow Scarborough instead of all of Toronto".
 *
 * Same contract as followRegion (merge the blob, reconcile the alert rows, never throw), plus
 * one thing reconcile cannot know: the new alert row inherits the OLD row's switches. A reader
 * who muted Toronto, or chose "every new listing", made that call; narrowing the area must not
 * quietly undo it. Reconcile alone would create the part's row with today's defaults.
 *
 * The part takes the city's position in the list, so the dashboard keeps its order.
 */
export async function replaceRegion(
  supabase: SupabaseClient,
  userId: string,
  from: string,
  rawTo: unknown,
  opts: { source: string; email?: string | null }
): Promise<ReplaceRegionResult> {
  const to = cleanRegionName(rawTo);
  const nothing: ReplaceRegionResult = { ok: false, replaced: false, regions: [], error: null };
  if (!to) return { ...nothing, error: "region_invalid" };

  try {
    const { data: prefs, error: readErr } = await supabase
      .from("dashboard_prefs")
      .select("config")
      .eq("user_id", userId)
      .maybeSingle();
    if (readErr) return { ...nothing, error: readErr.message };

    const config = (prefs?.config ?? {}) as Record<string, unknown>;
    const existing = Array.isArray(config.regions)
      ? (config.regions as unknown[]).filter((r): r is string => typeof r === "string")
      : [];
    const at = existing.findIndex((r) => r.toLowerCase() === from.toLowerCase());
    // Already switched (a second tap, or another tab): report the state, change nothing.
    if (at === -1) {
      return { ok: true, replaced: false, regions: existing, error: null };
    }

    // The old row's switches, read BEFORE reconcile deletes it.
    const { data: oldRows } = await supabase
      .from("market_bubbles")
      .select("alerts_enabled, alert_scope, filters, source")
      .eq("user_id", userId)
      .eq("area_type", "city");
    const old = (oldRows ?? []).find(
      (r) => ((r.source as { city?: string } | null)?.city ?? "").toLowerCase() === from.toLowerCase()
    );

    const regions = existing
      .map((r, i) => (i === at ? to : r))
      .filter((r, i, all) => all.findIndex((x) => x.toLowerCase() === r.toLowerCase()) === i);
    const nextConfig = { ...config, regions };
    const { error: writeErr } = await supabase
      .from("dashboard_prefs")
      .upsert(
        { user_id: userId, config: nextConfig, updated_at: new Date().toISOString() },
        { onConflict: "user_id" }
      );
    if (writeErr) return { ...nothing, error: writeErr.message };

    const alerts = await reconcileCityAlerts(supabase, userId, nextConfig);
    if (old) {
      await supabase
        .from("market_bubbles")
        .update({
          alerts_enabled: old.alerts_enabled,
          alert_scope: old.alert_scope,
          filters: old.filters,
        })
        .eq("user_id", userId)
        .eq("area_type", "city")
        .eq("source->>city", to);
    }

    await recordActivation({
      kind: "save_area",
      userId,
      email: opts.email ?? null,
      context: { city: to, source: opts.source, replaced: from },
    });
    return { ok: true, replaced: true, regions, error: alerts.error };
  } catch (e) {
    return { ...nothing, error: e instanceof Error ? e.message : "replace failed" };
  }
}

export async function followRegion(
  supabase: SupabaseClient,
  userId: string,
  rawRegion: unknown,
  opts: {
    /** Where the follow came from, for the activation funnel ("data_drop", "prompt"…). */
    source: string;
    /** Only the email-keyed caller has this; the session caller passes nothing. */
    email?: string | null;
  }
): Promise<FollowRegionResult> {
  const region = cleanRegionName(rawRegion);
  const nothing: FollowRegionResult = {
    ok: false,
    added: false,
    regions: [],
    alerted: [],
    error: null,
  };
  if (!region) return { ...nothing, error: "region_invalid" };

  try {
    const { data: prefs, error: readErr } = await supabase
      .from("dashboard_prefs")
      .select("config")
      .eq("user_id", userId)
      .maybeSingle();
    if (readErr) return { ...nothing, error: readErr.message };

    const config = (prefs?.config ?? {}) as Record<string, unknown>;
    const existing = Array.isArray(config.regions)
      ? (config.regions as unknown[]).filter((r): r is string => typeof r === "string")
      : [];

    // Case-insensitive, because the same city reaches this from a chip label, an inferred
    // listing city and a hand-edited blob. A duplicate row would email twice.
    if (existing.some((r) => r.toLowerCase() === region.toLowerCase())) {
      // Already there — but the alert row may still be missing, which is the whole failure
      // mode this module exists for. Reconcile rather than return early.
      const alerts = await reconcileCityAlerts(supabase, userId, config);
      return {
        ok: true,
        added: false,
        regions: existing,
        alerted: alerts.created,
        error: alerts.error,
      };
    }

    const regions = [...existing, region].slice(-MAX_REGIONS);
    const nextConfig = { ...config, regions };
    const { error: writeErr } = await supabase.from("dashboard_prefs").upsert(
      {
        user_id: userId,
        config: nextConfig,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );
    if (writeErr) return { ...nothing, error: writeErr.message };

    // Saving the market has to also make it ALERT. This is the step every one of the
    // earlier writers skipped, and skipping it means the area we just saved emails nothing.
    const alerts = await reconcileCityAlerts(supabase, userId, nextConfig);

    // Same kind the in-app picker emits, so retention funnels see one population and
    // `source` says which surface is responsible for it.
    await recordActivation({
      kind: "save_area",
      userId,
      email: opts.email ?? null,
      context: { city: region, source: opts.source },
    });

    return { ok: true, added: true, regions, alerted: alerts.created, error: alerts.error };
  } catch (e) {
    return { ...nothing, error: e instanceof Error ? e.message : "follow failed" };
  }
}
