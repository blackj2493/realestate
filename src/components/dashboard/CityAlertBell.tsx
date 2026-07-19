/**
 * CityAlertBell — per-city nightly new-listing alert toggle for the dashboard's plain
 * city sections (config.regions), mirroring the per-bubble bell so EVERY section row
 * carries the same alert affordance.
 *
 * City regions live only in localStorage dashboard config, which the nightly worker
 * can't see — so the bell materializes the subscription as a market_bubbles row with
 * area_type 'city' (migration 083; alert-carrier only, filtered out of BubbleSections).
 * States:
 *   - no row yet      → muted bell. Click CREATES the row (alerts default ON server-side).
 *   - row + enabled   → cyan bell. Click mutes (PATCH alerts_enabled=false).
 *   - row + disabled  → muted bell. Click re-enables.
 * Cities start OFF (no row) by design: regions are added for dashboard stats, and
 * auto-enrolling a whole city (Toronto ≈ hundreds of listings/day) into email from a
 * localStorage config would surprise-spam — one explicit tap opts in, matching the
 * consent model of the drawn/school bubbles (which ARE an explicit save, so default ON).
 */

"use client";

import React, { useEffect, useState } from "react";
import { Bell, BellOff } from "lucide-react";
import { useBubblesStore } from "@/lib/bubbles/useBubbles";
import { cn } from "@/lib/utils";

export default function CityAlertBell({ city }: { city: string }) {
  const init = useBubblesStore((s) => s.init);
  const items = useBubblesStore((s) => s.items);
  const signedIn = useBubblesStore((s) => s.signedIn);
  const create = useBubblesStore((s) => s.create);
  const setAlertsEnabled = useBubblesStore((s) => s.setAlertsEnabled);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void init();
  }, [init]);

  if (!signedIn) return null;

  const row = Object.values(items).find(
    (b) => b.area_type === "city" && b.source.kind === "city" && b.source.city === city
  );
  const enabled = !!row && row.alerts_enabled !== false;

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (!row) {
        await create({
          name: city,
          area_type: "city",
          polygon: [],
          source: { kind: "city", city },
          filters: null,
        });
      } else {
        await setAlertsEnabled(row.id, !enabled);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-pressed={enabled}
      title={
        enabled
          ? `New-listing alerts ON for ${city} — click to mute`
          : `Get nightly new-listing alerts for ${city}`
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
  );
}
