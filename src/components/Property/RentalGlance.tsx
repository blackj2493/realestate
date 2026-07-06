/**
 * RentalGlance — a "rental at a glance" strip shown near the top of FOR-LEASE listings.
 * Surfaces the facts a prospective tenant scans for first — what part of the property is
 * for lease, pets, furnished, laundry, availability, parking, how rent is paid, and what
 * they'll need to apply — which otherwise sit buried in the deep Property Data Sheet (pets
 * in particular is stuck in the condo-only group, so a leased freehold house never shows
 * its pet policy without this).
 *
 * Presentational only: values come from the pure, deterministic `buildRentalGlance`. Each
 * tile / chip renders only when the feed actually carries the fact — nothing is guessed.
 *
 * Compliance (CLAUDE.md §6.3(f)): values are rendered verbatim from the payload.
 */

import React from "react";
import {
  PawPrint,
  Home,
  DoorOpen,
  Sofa,
  WashingMachine,
  CalendarClock,
  Car,
  Wallet,
  ClipboardCheck,
} from "lucide-react";
import type { RentalGlance as RentalGlanceData } from "@/lib/property/rentalSnapshot";

function Tile({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-border bg-card/50 p-3">
      <div className="mt-0.5 shrink-0 text-sky-700 dark:text-sky-400">{icon}</div>
      <div className="min-w-0">
        <span className="block text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
        <span className="block truncate text-base font-semibold text-foreground" title={value}>{value}</span>
      </div>
    </div>
  );
}

export default function RentalGlance({ glance }: { glance: RentalGlanceData }) {
  const tiles: { key: string; icon: React.ReactNode; label: string; value: string }[] = [];
  const icon = "h-5 w-5";
  if (glance.portion) tiles.push({ key: "portion", icon: <Home className={icon} />, label: "For Lease", value: glance.portion });
  if (glance.privateEntrance) tiles.push({ key: "entrance", icon: <DoorOpen className={icon} />, label: "Entrance", value: "Private" });
  if (glance.pets) tiles.push({ key: "pets", icon: <PawPrint className={icon} />, label: "Pets", value: glance.pets });
  if (glance.furnished) tiles.push({ key: "furnished", icon: <Sofa className={icon} />, label: "Furnished", value: glance.furnished });
  if (glance.laundry) tiles.push({ key: "laundry", icon: <WashingMachine className={icon} />, label: "Laundry", value: glance.laundry });
  if (glance.available) tiles.push({ key: "available", icon: <CalendarClock className={icon} />, label: "Available", value: glance.available });
  if (glance.parking) tiles.push({ key: "parking", icon: <Car className={icon} />, label: "Parking", value: `${glance.parking} space${glance.parking === 1 ? "" : "s"}` });
  if (glance.payment) tiles.push({ key: "payment", icon: <Wallet className={icon} />, label: "Payment", value: glance.payment });

  const hasApply = glance.applyRequirements.length > 0;
  if (tiles.length === 0 && !hasApply) return null;

  return (
    <div className="mb-6">
      <h3 className="mb-2.5 text-sm font-semibold uppercase tracking-wider text-foreground">Rental at a Glance</h3>
      {tiles.length > 0 && (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {tiles.map((t) => (
            <Tile key={t.key} icon={t.icon} label={t.label} value={t.value} />
          ))}
        </div>
      )}

      {/* What a tenant needs to apply — the listing's stated screening requirements. */}
      {hasApply && (
        <div className="mt-2.5 rounded-lg border border-border bg-card/50 p-3">
          <span className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
            <ClipboardCheck className="h-4 w-4 text-sky-700 dark:text-sky-400" />
            To Apply, Be Ready With
          </span>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {glance.applyRequirements.map((r) => (
              <span key={r} className="rounded bg-muted px-2 py-0.5 text-sm font-medium text-foreground">
                {r}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
