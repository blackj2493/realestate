"use client";

/**
 * StreetRadar — schematic 2 km radar around the subject address. NOT a map tile:
 * a pure-CSS projection (equirectangular, fine at neighbourhood scale) of real
 * listing positions — no map vendor, nothing to leak.
 *
 * v2 (owner feedback "interesting but not sure what to make of it"): the radar now
 * SAYS something —
 *  - a default takeaway strip ("Most live inventory sits NW · 9 of 27 within 1 km"),
 *    computed from real bearings;
 *  - every cyan/amber pin is TAPPABLE (IDX actives are public): address, asking
 *    price, distance + a link to the listing;
 *  - a North marker + ring labels for orientation.
 *
 * VOW gate unchanged: sold dots are identity-free positions (anon gets ~110 m-rounded
 * points, see getSoldNearSummary). Tapping one never reveals anything — consumers are
 * pointed at the feed below (which has the real rows); anon gets the sign-in tease.
 */
import { useState } from "react";
import Link from "next/link";
import type { RadarPinData } from "@/lib/address/nearbyForSale";

const KM_PER_DEG_LAT = 110.574;

interface Projected {
  x: number;
  y: number;
  distKm: number;
  /** Bearing from the home, degrees clockwise from north. */
  bearing: number;
}

function project(
  centerLat: number,
  centerLng: number,
  lat: number,
  lng: number,
  radiusKm: number
): Projected | null {
  const kmPerDegLng = 111.32 * Math.cos((centerLat * Math.PI) / 180);
  const dxKm = (lng - centerLng) * kmPerDegLng;
  const dyKm = (lat - centerLat) * KM_PER_DEG_LAT;
  const distKm = Math.hypot(dxKm, dyKm);
  if (distKm > radiusKm * 1.02) return null;
  return {
    x: 50 + (dxKm / radiusKm) * 48,
    y: 50 - (dyKm / radiusKm) * 48,
    distKm,
    bearing: (Math.atan2(dxKm, dyKm) * 180) / Math.PI + (dxKm < 0 ? 360 : 0),
  };
}

const SECTORS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;
const SECTOR_WORD: Record<string, string> = {
  N: "north",
  NE: "northeast",
  E: "east",
  SE: "southeast",
  S: "south",
  SW: "southwest",
  W: "west",
  NW: "northwest",
};

function sectorOf(bearing: number): (typeof SECTORS)[number] {
  return SECTORS[Math.round(bearing / 45) % 8];
}

function fmtPrice(n: number): string {
  return `$${Math.round(n).toLocaleString("en-CA")}`;
}

function fmtDist(m: number | null): string {
  if (m === null) return "";
  return m < 1000 ? `${Math.max(50, Math.round(m / 50) * 50)} m` : `${(m / 1000).toFixed(1)} km`;
}

type Selection = { kind: "active"; pin: RadarPinData } | { kind: "sold" } | null;

export default function StreetRadar({
  centerLat,
  centerLng,
  radiusKm,
  activePins,
  soldPoints,
  isConsumer,
  mapHref,
}: {
  centerLat: number;
  centerLng: number;
  radiusKm: number;
  activePins: RadarPinData[];
  soldPoints: Array<[number, number]>;
  isConsumer: boolean;
  /** Deep link into the map terminal centered on this home (?lat=&lng=&pin=). */
  mapHref?: string;
}) {
  const [selected, setSelected] = useState<Selection>(null);

  if (activePins.length === 0 && soldPoints.length === 0) return null;

  const actives = activePins
    .map((pin) => ({ pin, pos: project(centerLat, centerLng, pin.lat, pin.lng, radiusKm) }))
    .filter((p): p is { pin: RadarPinData; pos: Projected } => p.pos !== null);
  const solds = soldPoints
    .map(([lat, lng]) => project(centerLat, centerLng, lat, lng, radiusKm))
    .filter((p): p is Projected => p !== null);

  // ── Takeaway: dominant direction + inner-ring count (real bearings) ───────
  const within1km = actives.filter((a) => a.pos.distKm <= radiusKm / 2).length;
  const counts = new Map<string, number>();
  for (const a of actives) counts.set(sectorOf(a.pos.bearing), (counts.get(sectorOf(a.pos.bearing)) ?? 0) + 1);
  let takeaway = `${actives.length} live listing${actives.length === 1 ? "" : "s"} plotted · ${within1km} within ${radiusKm / 2} km`;
  if (actives.length >= 5) {
    const [topSector, topCount] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (topCount / actives.length >= 0.35) {
      takeaway = `Most live inventory sits ${SECTOR_WORD[topSector]} of this home · ${within1km} of ${actives.length} within ${radiusKm / 2} km`;
    }
  }

  return (
    <section className="rounded-lg border border-border bg-card/40 p-5">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-[11px] font-bold uppercase tracking-wider text-foreground">Street radar</h2>
        <span className="flex items-baseline gap-3">
          <span className="font-mono text-[10px] text-muted-foreground">tap a dot · {radiusKm} km</span>
          {mapHref && (
            <Link href={mapHref} className="font-mono text-[10px] font-bold text-cyan-700 hover:underline dark:text-cyan-400">
              Full map →
            </Link>
          )}
        </span>
      </div>

      <div
        className="relative aspect-square w-full overflow-hidden rounded-md border border-border bg-muted/25"
        role="group"
        aria-label={`${actives.length} live listings and ${solds.length} recent sales plotted around this address. Select a dot for details.`}
      >
        {/* orientation: North marker. Decorative layers are pointer-events-none so
            they never eat pin taps (same hazard class as the terminal map overlays). */}
        <span className="pointer-events-none absolute left-1/2 top-1 -translate-x-1/2 font-mono text-[9px] font-bold text-muted-foreground" aria-hidden="true">
          N
        </span>

        {/* radius rings */}
        <div className="pointer-events-none absolute left-1/2 top-1/2 h-1/2 w-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-cyan-500/25" aria-hidden="true">
          <span className="absolute -top-2 left-1/2 -translate-x-1/2 px-1 font-mono text-[8px] text-cyan-700/70 dark:text-cyan-400/60">
            {radiusKm / 2} km
          </span>
        </div>
        <div className="pointer-events-none absolute left-1/2 top-1/2 h-[96%] w-[96%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-cyan-500/20" aria-hidden="true" />

        {/* sold dots — identity-free positions; tap = contextual nudge, never data */}
        {solds.map((p, i) => (
          <button
            key={`s${i}`}
            type="button"
            onClick={() => setSelected({ kind: "sold" })}
            aria-label="A home sold near here in the last 30 days"
            className="absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{ left: `${p.x}%`, top: `${p.y}%` }}
          >
            <span className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-background bg-emerald-500/90" />
          </button>
        ))}

        {/* active pins — public IDX, tappable */}
        {actives.map(({ pin, pos }) => {
          const isSel = selected?.kind === "active" && selected.pin.id === pin.id;
          return (
            <button
              key={pin.id}
              type="button"
              onClick={() => setSelected(isSel ? null : { kind: "active", pin })}
              aria-label={`${pin.address} — asking ${fmtPrice(pin.price)}${pin.cut ? ", price cut" : ""}`}
              aria-pressed={isSel}
              className="absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{ left: `${pos.x}%`, top: `${pos.y}%`, zIndex: isSel ? 5 : undefined }}
            >
              <span
                className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-background transition-all ${
                  pin.cut ? "bg-amber-500" : "bg-cyan-500"
                } ${isSel ? "h-3.5 w-3.5 ring-2 ring-cyan-400/60" : "h-2 w-2"}`}
              />
            </button>
          );
        })}

        {/* subject home — centre, with a ping (pointer-events-none: the nearest
            listing can sit metres away and must stay tappable underneath) */}
        <span className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2" aria-hidden="true">
          <span className="absolute inset-0 -m-1.5 animate-ping rounded-full border-2 border-cyan-500/50 motion-reduce:hidden" />
          <span className="block h-3.5 w-3.5 rounded-full border-[3px] border-cyan-600 bg-background dark:border-cyan-400" />
        </span>
      </div>

      {/* info strip: selection details, else the takeaway */}
      <div className="mt-2.5 min-h-[3.25rem] rounded-md border border-border bg-card/60 px-3 py-2">
        {selected?.kind === "active" ? (
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-foreground">{selected.pin.address}</p>
              <p className="font-mono text-[10px] text-muted-foreground">
                asking <span className="font-bold text-emerald-700 dark:text-emerald-400">{fmtPrice(selected.pin.price)}</span>
                {selected.pin.cut ? ` · cut −${fmtPrice(selected.pin.dropAmount)}` : ""}
                {selected.pin.distanceM !== null ? ` · ${fmtDist(selected.pin.distanceM)} away` : ""}
              </p>
            </div>
            <Link
              href={`/properties/${selected.pin.id}`}
              className="shrink-0 font-mono text-[11px] font-bold text-cyan-700 hover:underline dark:text-cyan-400"
            >
              View →
            </Link>
          </div>
        ) : selected?.kind === "sold" ? (
          <div className="flex items-center justify-between gap-3">
            <p className="min-w-0 text-xs text-muted-foreground">
              A home sold here in the last 30 days.{" "}
              {isConsumer ? "Details are in the feed on this page." : "Prices are members-only — free account."}
            </p>
            {isConsumer ? (
              <a href="#feed" className="shrink-0 font-mono text-[11px] font-bold text-emerald-700 hover:underline dark:text-emerald-400">
                See it →
              </a>
            ) : (
              <Link href="/register" className="shrink-0 font-mono text-[11px] font-bold text-emerald-700 hover:underline dark:text-emerald-400">
                Sign up →
              </Link>
            )}
          </div>
        ) : (
          <p className="text-xs leading-snug text-muted-foreground">{takeaway}</p>
        )}
      </div>

      <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <i className="h-2 w-2 rounded-full bg-cyan-500" /> for sale
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="h-2 w-2 rounded-full bg-amber-500" /> price cut
        </span>
        {solds.length > 0 && (
          <span className="inline-flex items-center gap-1.5">
            <i className="h-2 w-2 rounded-full bg-emerald-500" /> sold · 30d
          </span>
        )}
      </div>
    </section>
  );
}
