/**
 * CityAlertBell — per-city nightly new-listing alert toggle for the dashboard's plain
 * city sections (config.regions), mirroring the per-bubble bell so EVERY section row
 * carries the same alert affordance.
 *
 * City regions live only in localStorage dashboard config, which the nightly worker
 * can't see — so the alert is materialized as a market_bubbles row with area_type 'city'
 * (migration 083; alert-carrier only, filtered out of BubbleSections).
 *
 * Since the tiered default-ON change (§176), ADDING an area auto-creates this row, so the
 * bell usually renders already-ON. The row is now kept in step SERVER-SIDE, by
 * areaAlertSync.reconcileCityAlerts on every config save — DashboardClient.addRegion is
 * the fast path, not the only one, because the writers that skipped it (the Customize
 * panel, the Data Drop chip, a stale cross-device push) are exactly how areas ended up
 * emailing after they were removed. The bell remains: the manual opt-in for regions saved
 * before §176, the MUTE control, and the All / My-filters scope pair.
 *
 * A muted row is never un-muted by the reconcile — `alerts_enabled = false` is this
 * button's decision, and keeping the area on the dashboard is not consent to undo it.
 * States:
 *   - no row yet      → muted bell. Click CREATES the row with the TIERED default scope
 *                       (whole city → 'filtered'/lens, community → 'all') — never a
 *                       surprise city-wide firehose.
 *   - row + enabled   → cyan bell. Click mutes (PATCH alerts_enabled=false).
 *   - row + disabled  → muted bell. Click re-enables.
 */

"use client";

import React, { useEffect, useState } from "react";
import { Bell, BellOff, Mail } from "lucide-react";
import { useBubblesStore } from "@/lib/bubbles/useBubbles";
import type { MarketActivityLens } from "@/lib/dashboard/config";
import { defaultAlertScopeForRegion } from "@/lib/dashboard/area";
import { cn } from "@/lib/utils";
import { formatRegionLabel } from "@/lib/regions/formatRegionLabel";

export default function CityAlertBell({
  city,
  lens,
  variant = "row",
}: {
  city: string;
  /** The dashboard's CURRENT Market Activity lens — when provided, an enabled
   *  city gains the All/My-filters scope pair; "My filters" captures this lens
   *  (fresh on every click) as the city's alert filter. */
  lens?: MarketActivityLens;
  /**
   * "row" — the header pair: scope control (`lg` and up) plus the bell.
   * "detail" — the scope control alone, full width, for the narrow body. Mirrors
   * BubbleAlertToggle: at ~186px the segmented control is the widest thing in the
   * action cluster, and on the header's flex line it crushed the title.
   */
  variant?: "row" | "detail";
}) {
  const init = useBubblesStore((s) => s.init);
  const items = useBubblesStore((s) => s.items);
  const signedIn = useBubblesStore((s) => s.signedIn);
  const create = useBubblesStore((s) => s.create);
  const setAlertsEnabled = useBubblesStore((s) => s.setAlertsEnabled);
  const setAlertScope = useBubblesStore((s) => s.setAlertScope);
  const updateAlertFilters = useBubblesStore((s) => s.updateAlertFilters);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void init();
  }, [init]);

  if (!signedIn) return null;

  const row = Object.values(items).find(
    (b) => b.area_type === "city" && b.source.kind === "city" && b.source.city === city
  );
  const enabled = !!row && row.alerts_enabled !== false;
  const scope: "all" | "filtered" = row?.alert_scope === "filtered" ? "filtered" : "all";
  // Display only — the raw `city` stays the alert row's key/source everywhere below.
  const cityLabel = formatRegionLabel(city);

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (!row) {
        // Apply the tiered default (§176) so a manual opt-in matches the add-area
        // behaviour: whole city → 'filtered' (this lens), community → 'all'.
        const scope = defaultAlertScopeForRegion(city, lens);
        await create({
          name: city,
          area_type: "city",
          polygon: [],
          source: { kind: "city", city },
          filters: scope === "filtered" && lens ? { lens } : null,
          alert_scope: scope,
        });
      } else {
        await setAlertsEnabled(row.id, !enabled);
      }
    } finally {
      setBusy(false);
    }
  };

  const detail = variant === "detail";

  return (
    <span className={cn("flex items-center gap-1.5", detail && "w-full")}>
      {/* Scope pair — same control as saved bubbles. "My filters" means the dashboard's
          filters as they are NOW: the click captures the lens, and every later config
          save re-syncs it server-side (areaAlertSync.reconcileCityAlerts). It used to
          capture once and then freeze, with nothing on screen saying so — one live
          account was alerting on `4+ bd · 4+ ba · 4+ garage · ≥30′ frontage` while its
          dashboard read `4+ bd · detached`. The email labels what it matched.

          Below `lg` it moves off the header row into RegionDrilldown's `mobileDetail`,
          where it gets a full line and 44px segments instead of crushing the title. */}
      {enabled && row && lens && (
        <span
          className={cn(
            "terminal-font items-stretch border border-border text-[10px] uppercase tracking-wider",
            detail ? "flex w-full" : "hidden lg:flex"
          )}
          role="group"
          aria-label={`Alert scope for ${cityLabel}`}
        >
          <span className="flex items-center border-r border-border px-1.5 text-muted-foreground" aria-hidden="true">
            <Mail className="h-3 w-3" />
          </span>
          <button
            type="button"
            aria-pressed={scope === "all"}
            title={`Email every new listing in ${cityLabel}`}
            onClick={() => scope !== "all" && setAlertScope(row.id, "all")}
            className={cn(
              "transition-colors",
              detail ? "min-h-[44px] flex-1 px-3" : "px-2 py-1",
              scope === "all"
                ? "bg-cyan-600/15 font-bold text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            All listings
          </button>
          <button
            type="button"
            aria-pressed={scope === "filtered"}
            title={`Email only listings matching your dashboard filters — it follows them as you change them`}
            onClick={() => void updateAlertFilters(row.id, { lens })}
            className={cn(
              "transition-colors",
              detail ? "min-h-[44px] flex-1 px-3" : "px-2 py-1",
              scope === "filtered"
                ? "bg-cyan-600/15 font-bold text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            My filters only
          </button>
        </span>
      )}
      {/* The bell stays on the header row at every width — muting a city is the one alert
          action worth a tap on a phone. `detail` renders the scope pair only. */}
      {!detail && (
        <button
          type="button"
          onClick={toggle}
          disabled={busy}
          aria-pressed={enabled}
          title={
            enabled
              ? `New-listing alerts ON for ${cityLabel} — click to mute`
              : `Get nightly new-listing alerts for ${cityLabel}`
          }
          className={cn(
            "flex h-11 w-11 items-center justify-center border transition-colors sm:h-7 sm:w-7",
            enabled
              ? "border-cyan-600/50 bg-cyan-600/10 text-cyan-700 hover:bg-cyan-600/20 dark:border-cyan-500/40 dark:bg-cyan-500/10 dark:text-cyan-300 dark:hover:bg-cyan-500/20"
              : "border-border text-muted-foreground hover:bg-muted/60 hover:text-foreground"
          )}
        >
          {enabled ? <Bell className="h-3.5 w-3.5" /> : <BellOff className="h-3.5 w-3.5" />}
        </button>
      )}
    </span>
  );
}
