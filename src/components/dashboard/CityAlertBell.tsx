/**
 * CityAlertBell — per-city nightly new-listing alert toggle for the dashboard's plain
 * city sections (config.regions), mirroring the per-bubble bell so EVERY section row
 * carries the same alert affordance.
 *
 * City regions live only in localStorage dashboard config, which the nightly worker
 * can't see — so the alert is materialized as a market_bubbles row with area_type 'city'
 * (migration 083; alert-carrier only, filtered out of BubbleSections).
 *
 * Since the tiered default-ON change (§176), ADDING an area auto-creates this row (see
 * DashboardClient.addRegion), so the bell usually renders already-ON. It remains: the
 * manual opt-in for regions saved BEFORE that change (which have no row yet), the mute
 * control, and the All / My-filters scope pair. States:
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
}: {
  city: string;
  /** The dashboard's CURRENT Market Activity lens — when provided, an enabled
   *  city gains the All/My-filters scope pair; "My filters" captures this lens
   *  (fresh on every click) as the city's alert filter. */
  lens?: MarketActivityLens;
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
        const scope = defaultAlertScopeForRegion(city);
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

  return (
    <span className="flex items-center gap-1.5">
      {/* Scope pair — same control as saved bubbles. "My filters" captures the
          dashboard's CURRENT lens each time it's clicked (so re-clicking after
          changing filters re-captures), and the email labels what it matched. */}
      {enabled && row && lens && (
        <span
          className="terminal-font flex items-stretch border border-border text-[10px] uppercase tracking-wider"
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
              "px-2 py-1 transition-colors",
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
            title={`Email only listings matching your dashboard filters (captured as of now — click again after changing filters to re-capture)`}
            onClick={() => void updateAlertFilters(row.id, { lens })}
            className={cn(
              "px-2 py-1 transition-colors",
              scope === "filtered"
                ? "bg-cyan-600/15 font-bold text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            My filters only
          </button>
        </span>
      )}
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
          "flex h-7 w-7 items-center justify-center border transition-colors",
          enabled
            ? "border-cyan-600/50 bg-cyan-600/10 text-cyan-700 hover:bg-cyan-600/20 dark:border-cyan-500/40 dark:bg-cyan-500/10 dark:text-cyan-300 dark:hover:bg-cyan-500/20"
            : "border-border text-muted-foreground hover:bg-muted/60 hover:text-foreground"
        )}
      >
        {enabled ? <Bell className="h-3.5 w-3.5" /> : <BellOff className="h-3.5 w-3.5" />}
      </button>
    </span>
  );
}
