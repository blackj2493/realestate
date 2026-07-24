"use client";

/**
 * StreetRadar — a small real-map view of the pocket around the subject address.
 *
 * v3 (owner: the abstract dot-void "is not helping the user" → show the map):
 * the canvas is now a Mapbox STATIC IMAGE (same stock style family the terminal
 * uses, theme-aware dark-v11/light-v11) with our interactive dots overlaid as DOM
 * elements. Static-image-plus-DOM keeps everything v2 earned — tap-a-dot info
 * strip, takeaway caption, VOW gate semantics — while giving the dots the one
 * thing the schematic lacked: streets the user can recognize. No GL runtime, no
 * pan/zoom (exploration is what "Full map →" is for), one cacheable image request.
 *
 * PROJECTION: dots are placed with WEB MERCATOR math (512-tile scheme, matching
 * Mapbox static/GL zoom) so they align with the tile image; the fractional zoom is
 * computed so the radius circle just fits the square frame. Distance/bearing for
 * the takeaway caption use the simpler equirectangular math (fine at 2 km scale).
 *
 * VOW gate unchanged: sold dots are identity-free positions (anon gets ~110 m-
 * rounded points — on a real map that shows the block, never the house). Tapping
 * one reveals nothing; consumers are pointed at the feed, anon at the free account.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import type { RadarPinData } from "@/lib/address/nearbyForSale";

const KM_PER_DEG_LAT = 110.574;
/** Logical (CSS) pixel size of the square static image; rendered responsively —
 *  dot positions are percentages, so alignment survives any rendered size. */
const IMG_SIZE = 640;
const EARTH_CIRCUMFERENCE_M = 40_075_016.686;

/* ── Web Mercator (tile alignment) ────────────────────────────────────────── */

function mercX(lng: number): number {
  return (lng + 180) / 360;
}
function mercY(lat: number): number {
  const s = Math.sin((lat * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
}

/** Fractional zoom at which the 2·radius diameter (plus padding) spans IMG_SIZE px. */
function fitZoom(centerLat: number, radiusKm: number): number {
  const targetMpp = (2 * radiusKm * 1000 * 1.12) / IMG_SIZE;
  const z = Math.log2(
    (EARTH_CIRCUMFERENCE_M * Math.cos((centerLat * Math.PI) / 180)) / (512 * targetMpp)
  );
  return Math.round(Math.min(16, Math.max(10, z)) * 100) / 100;
}

/** Percentage position of (lat,lng) inside the static frame; null when outside. */
function placePct(
  centerLat: number,
  centerLng: number,
  zoom: number,
  lat: number,
  lng: number
): { left: number; top: number } | null {
  const world = 512 * Math.pow(2, zoom);
  const left = 50 + (((mercX(lng) - mercX(centerLng)) * world) / IMG_SIZE) * 100;
  const top = 50 + (((mercY(lat) - mercY(centerLat)) * world) / IMG_SIZE) * 100;
  if (left < 2 || left > 98 || top < 2 || top > 98) return null;
  return { left, top };
}

/* ── Equirectangular (metric facts: distance + bearing for the caption) ───── */

function metrics(centerLat: number, centerLng: number, lat: number, lng: number) {
  const kmPerDegLng = 111.32 * Math.cos((centerLat * Math.PI) / 180);
  const dxKm = (lng - centerLng) * kmPerDegLng;
  const dyKm = (lat - centerLat) * KM_PER_DEG_LAT;
  return {
    distKm: Math.hypot(dxKm, dyKm),
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
  // Theme-aware tile style. SSR + first paint assume dark (the product default);
  // Daylight users get the light style right after mount.
  const [styleId, setStyleId] = useState("dark-v11");
  useEffect(() => {
    setStyleId(document.documentElement.classList.contains("dark") ? "dark-v11" : "light-v11");
  }, []);

  if (activePins.length === 0 && soldPoints.length === 0) return null;

  const zoom = fitZoom(centerLat, radiusKm);
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  const mapSrc =
    token && token !== "your-mapbox-token"
      ? `https://api.mapbox.com/styles/v1/mapbox/${styleId}/static/` +
        `${centerLng.toFixed(6)},${centerLat.toFixed(6)},${zoom}/${IMG_SIZE}x${IMG_SIZE}@2x` +
        `?access_token=${token}`
      : null;

  const actives = activePins.flatMap((pin) => {
    const pos = placePct(centerLat, centerLng, zoom, pin.lat, pin.lng);
    return pos ? [{ pin, pos, m: metrics(centerLat, centerLng, pin.lat, pin.lng) }] : [];
  });
  const solds = soldPoints.flatMap(([lat, lng]) => {
    const pos = placePct(centerLat, centerLng, zoom, lat, lng);
    return pos ? [pos] : [];
  });

  // ── Takeaway: dominant direction + inner-ring count (real bearings) ───────
  const within1km = actives.filter((a) => a.m.distKm <= radiusKm / 2).length;
  const counts = new Map<string, number>();
  for (const a of actives) counts.set(sectorOf(a.m.bearing), (counts.get(sectorOf(a.m.bearing)) ?? 0) + 1);
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
        aria-label={`Map of ${actives.length} live listings and ${solds.length} recent sales around this address. Select a dot for details.`}
      >
        {mapSrc && (
          // eslint-disable-next-line @next/next/no-img-element -- Mapbox static tile, never optimized
          <img
            src={mapSrc}
            alt=""
            draggable={false}
            className="pointer-events-none absolute inset-0 h-full w-full select-none object-cover"
          />
        )}

        {/* sold dots — identity-free positions; tap = contextual nudge, never data */}
        {solds.map((p, i) => (
          <button
            key={`s${i}`}
            type="button"
            onClick={() => setSelected({ kind: "sold" })}
            aria-label="A home sold near here in the last 30 days"
            className="absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{ left: `${p.left}%`, top: `${p.top}%` }}
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
              style={{ left: `${pos.left}%`, top: `${pos.top}%`, zIndex: isSel ? 5 : undefined }}
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
