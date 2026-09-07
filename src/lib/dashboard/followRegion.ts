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
