/**
 * Persist the market a brand-new account picks at signup, and subscribe it to the
 * nightly new-listing email in the same request.
 *
 * THE HOLE THIS CLOSES. The signup picker (AcceptTermsForm) wrote its market with
 * `saveConfig()` — localStorage, and nothing else. But new-listing email is delivered
 * against `market_bubbles` rows with `area_type = 'city'`, and those rows only ever get
 * created by `reconcileCityAlerts()`, which only ever runs inside `PUT
 * /api/dashboard-config`. Signup never passed through that route: it wrote the browser
 * copy and redirected straight to /properties, while /dashboard is the ONLY screen that
 * mirrors the config to the server (see configSync.pushConfig, called from
 * DashboardClient alone).
 *
 * So a user who signed up, tapped a market, and never happened to open the dashboard had
 * no `dashboard_prefs` row and no alert row. They were invisible to every email job for
 * the life of the account, having already answered the only question we needed. The
 * header of areaAlertSync.ts names AcceptTermsForm as one of the writers that skipped the
 * reconcile; server-side reconciliation fixed the other four, and this is the fifth.
 *
 * WHY HERE AND NOT A CLIENT PUSH. `pushConfig` is debounced 800 ms and the form calls
 * `router.replace()` the moment it returns, so the write races a navigation it usually
 * loses. Doing it server-side, in the same request that records Terms acceptance, means
 * the region is captured even if the user closes the tab on the redirect — and it works
 * when localStorage does not (private mode, quota, a blocked third-party context).
 *
 * NON-DESTRUCTIVE BY CONTRACT. It only ever seeds a workspace that names NO areas. An
 * account that already has regions keeps them: /welcome redirects past the form once
 * Terms are on file, so a second call means another device got there first, and its
 * choice is the newer one. Best-effort throughout — a failure here must never fail the
 * Terms acceptance the user actually performed.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeConfig } from "./config";
import { reconcileCityAlerts } from "./areaAlertSync";

/** The same bound `cleanRegions` applies, so anything accepted here survives the reconcile. */
const MAX_REGION_LEN = 80;

export interface SeedSignupRegionResult {
  /** The region the account ends up with, or null when nothing was stored. */
  region: string | null;
  /** True only when this call wrote the account's first saved region. */
  seeded: boolean;
  /** Regions that gained a nightly-email row. */
  alerted: string[];
  /** Non-fatal. The caller reports it and still returns success. */
  error: string | null;
}

const NOTHING: SeedSignupRegionResult = {
  region: null,
  seeded: false,
  alerted: [],
  error: null,
};

/**
 * Trim and bound a client-supplied region name, or null when it is unusable.
 *
 * Exported so the route can tell "the client sent nothing" (a pre-deploy bundle, which we
 * let through) apart from "the client sent something invalid" (a 400).
 */
export function cleanSignupRegion(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim();
  if (!name || name.length > MAX_REGION_LEN) return null;
  return name;
}

export async function seedSignupRegion(
  supabase: SupabaseClient,
  userId: string,
  rawRegion: unknown
): Promise<SeedSignupRegionResult> {
  const region = cleanSignupRegion(rawRegion);
  if (!region) return NOTHING;

  try {
    const { data: current, error: readErr } = await supabase
      .from("dashboard_prefs")
      .select("config")
      .eq("user_id", userId)
      .maybeSingle();
    if (readErr) return { ...NOTHING, error: readErr.message };

    const config = normalizeConfig(current?.config);

    // Already has areas — another device seeded first. Don't overwrite its choice, but DO
    // reconcile: the row can exist while its alert rows do not (that is the original bug),
    // and this is a cheap chance to repair it.
    if (config.regions.length > 0) {
      const alerts = await reconcileCityAlerts(supabase, userId, config);
      return {
        region: config.regions[0],
        seeded: false,
        alerted: alerts.created,
        error: alerts.error,
      };
    }

    const next = { ...config, regions: [region] };
    const { error: writeErr } = await supabase
      .from("dashboard_prefs")
      .upsert({ user_id: userId, config: next, updated_at: new Date().toISOString() });
    if (writeErr) return { ...NOTHING, error: writeErr.message };

    // The subscription itself. Without this the row above is just dashboard state and no
    // email is ever sent — which was the whole failure.
    const alerts = await reconcileCityAlerts(supabase, userId, next);
    return { region, seeded: true, alerted: alerts.created, error: alerts.error };
  } catch (e) {
    return { ...NOTHING, error: e instanceof Error ? e.message : "seed failed" };
  }
}
