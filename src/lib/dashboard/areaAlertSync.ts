/**
 * Keep a user's new-listing ALERT rows in step with the areas their dashboard shows.
 *
 * THE BUG THIS CLOSES. The dashboard stores its areas in `dashboard_prefs.config.regions`
 * (one jsonb blob). The nightly worker delivers against `market_bubbles` rows with
 * area_type 'city'. Those are two different tables, and until now only ONE writer kept
 * them in step — `DashboardClient.addRegion` / `removeRegion`. Every other writer of
 * `regions` skipped it:
 *
 *   • DashboardConfigPanel ("Customize Workspace") edited config.regions directly.
 *     Gone now — MarketPicker replaced it and delegates every area edit to
 *     addRegion / removeRegion.
 *   • /api/email/follow-market wrote a region server-side from the Data Drop chip.
 *   • AcceptTermsForm seeded a region into localStorage at signup.
 *   • A stale device pushed its whole config blob over a newer one (configSync).
 *
 * So an area removed through any of those kept emailing forever — with NO UI anywhere to
 * see or mute it, because CityAlertBell only renders inside `config.regions.map(...)` and
 * BubbleSections filters city rows out. And an area ADDED through any of those emailed
 * nothing. Measured on prod 2026-09-01: 4 orphan rows still alerting on one account, and
 * 126 dashboard areas across 96 accounts with no alert row at all.
 *
 * The fix is to stop patching writers one at a time and reconcile SERVER-SIDE, in the one
 * place every writer must pass through to persist. Callers hand us the config they just
 * stored; we make the alert rows match it.
 *
 * WHAT IT DOES NOT DO — deliberately:
 *   • It never re-enables a MUTED row. `alerts_enabled = false` is a user decision (the
 *     bell), and the region staying on the dashboard is not consent to undo it.
 *   • It never touches draw / commute / school bubbles. Those are hand-saved areas with
 *     their own lifecycle; they do not live in config.regions at all.
 *   • It never deletes when `regions` arrives EMPTY while the account still has city rows.
 *     That shape is the signature of a degraded/stale blob, not of a user clearing their
 *     workspace — and the legitimate "removed my last area" case already deleted the row
 *     client-side before this ever runs. Creations still apply (there are none).
 *
 * Best-effort by contract: a reconcile failure must never fail the caller's write. The
 * config save is the user's actual action; this is bookkeeping behind it.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { defaultAlertScopeForRegion } from "./area";
import { normalizeConfig, type MarketActivityLens } from "./config";

interface CityBubbleRow {
  id: string;
  area_type: string;
  source: { kind?: string; city?: string } | null;
  alerts_enabled: boolean | null;
  alert_scope: string | null;
  filters: unknown;
}

export interface AreaAlertReconcile {
  /** Regions that gained an alert row. */
  created: string[];
  /** Regions whose orphaned alert row was removed. */
  deleted: string[];
  /** Regions whose frozen filter snapshot was re-synced to the live lens. */
  resnapped: string[];
  /** True when an empty `regions` array suppressed the delete pass (see header). */
  heldEmpty: boolean;
  /** Set when the reconcile could not run; the caller's write still stands. */
  error: string | null;
}

const EMPTY: AreaAlertReconcile = {
  created: [],
  deleted: [],
  resnapped: [],
  heldEmpty: false,
  error: null,
};

/**
 * Field-by-field lens comparison.
 *
 * NOT JSON.stringify: the stored copy is a Postgres jsonb, which re-orders object keys
 * (by key length, then bytewise) on the way in. A stringify compare would therefore report
 * "changed" on every single call and rewrite every filtered row on every config save.
 */
function sameLens(a: MarketActivityLens, b: MarketActivityLens): boolean {
  return (
    a.transactionType === b.transactionType &&
    a.minBeds === b.minBeds &&
    a.bedsExact === b.bedsExact &&
    a.minBaths === b.minBaths &&
    a.bathsExact === b.bathsExact &&
    a.minGarage === b.minGarage &&
    a.garageExact === b.garageExact &&
    a.basement === b.basement &&
    a.minFrontage === b.minFrontage &&
    a.propertyTypes.length === b.propertyTypes.length &&
    a.propertyTypes.every((t, i) => t === b.propertyTypes[i])
  );
}

/** The `{ lens }` filter shape city rows carry (BubbleFilters union, city variant). */
function storedLens(filters: unknown): MarketActivityLens | null {
  if (!filters || typeof filters !== "object" || !("lens" in filters)) return null;
  const raw = (filters as { lens?: unknown }).lens;
  if (!raw || typeof raw !== "object") return null;
  return normalizeConfig({ marketActivity: raw }).marketActivity;
}

/** Trimmed, de-duplicated region strings, in dashboard order. */
function cleanRegions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const r of raw) {
    if (typeof r !== "string") continue;
    const name = r.trim();
    if (name && name.length <= 80 && !out.includes(name)) out.push(name);
  }
  return out;
}

/**
 * Make the account's city alert rows match `config`.
 *
 * @param supabase Any client that can reach `market_bubbles` as this user — the
 *   RLS-scoped request client from a signed-in route, or the service-role client from an
 *   HMAC-authenticated one. Both enforce ownership; we scope by user_id either way.
 */
export async function reconcileCityAlerts(
  supabase: SupabaseClient,
  userId: string,
  config: unknown
): Promise<AreaAlertReconcile> {
  const result: AreaAlertReconcile = { ...EMPTY, created: [], deleted: [], resnapped: [] };
  try {
    const cfg = normalizeConfig(config);
    // normalizeConfig passes `regions` through as-is when it is an array, so a hand-edited
    // or legacy blob can still carry blanks, duplicates and non-strings. Clean here.
    const regions = cleanRegions(cfg.regions);
    const lens = cfg.marketActivity;

    const { data, error } = await supabase
      .from("market_bubbles")
      .select("id, area_type, source, alerts_enabled, alert_scope, filters")
      .eq("user_id", userId);
    if (error) return { ...result, error: error.message };

    const cityRows = ((data ?? []) as unknown as CityBubbleRow[]).filter(
      (r) => r.area_type === "city"
    );
    const cityOf = (r: CityBubbleRow) => (r.source?.city ?? "").trim();

    // ── Create: a dashboard area with no alert row ────────────────────────────
    // Tiered default-ON, the same rule DashboardClient.addRegion applies (§176): a WHOLE
    // city starts 'filtered' by the current lens so it is never a city-wide firehose; a
    // community or neighbourhood starts 'all'.
    const have = new Set(cityRows.map(cityOf));
    const missing = regions.filter((r) => !have.has(r));
    if (missing.length) {
      const rows = missing.map((name) => {
        const scope = defaultAlertScopeForRegion(name, lens);
        return {
          user_id: userId,
          name,
          area_type: "city",
          polygon: [],
          source: { kind: "city", city: name },
          filters: scope === "filtered" ? { lens } : null,
          alert_scope: scope,
        };
      });
      const ins = await supabase.from("market_bubbles").insert(rows);
      if (ins.error) return { ...result, error: ins.error.message };
      result.created = missing;
    }

    // ── Delete: an alert row for an area the dashboard no longer shows ────────
    const wanted = new Set(regions);
    const orphans = cityRows.filter((r) => !wanted.has(cityOf(r)));
    if (orphans.length) {
      if (regions.length === 0) {
        // Degraded blob — hold the delete pass rather than silently unsubscribe someone.
        result.heldEmpty = true;
      } else {
        const del = await supabase
          .from("market_bubbles")
          .delete()
          .in(
            "id",
            orphans.map((r) => r.id)
          );
        if (del.error) return { ...result, error: del.error.message };
        result.deleted = orphans.map(cityOf);
      }
    }

    // ── Re-snap: a 'filtered' row still holding an older lens ─────────────────
    // "My filters only" has to mean the filters the dashboard shows NOW. It used to mean
    // the lens as of whichever click captured it, months ago, with nothing in the UI
    // saying so — one live account was alerting on `4+ bd · 4+ ba · 4+ garage · ≥30′
    // frontage` while its dashboard read `4+ bd · detached`, which cut its only correct
    // area from 4 matches a week to 1.
    const survivors = cityRows.filter((r) => wanted.has(cityOf(r)));
    for (const row of survivors) {
      if (row.alert_scope !== "filtered") continue;
      const stored = storedLens(row.filters);
      if (!stored || sameLens(stored, lens)) continue;
      const upd = await supabase
        .from("market_bubbles")
        .update({ filters: { lens } })
        .eq("id", row.id);
      if (upd.error) return { ...result, error: upd.error.message };
      result.resnapped.push(cityOf(row));
    }

    return result;
  } catch (e) {
    return { ...result, error: e instanceof Error ? e.message : String(e) };
  }
}
