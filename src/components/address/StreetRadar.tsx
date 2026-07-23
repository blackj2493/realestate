/**
 * StreetRadar — schematic 2 km radar around the subject address. NOT a map tile:
 * a pure-CSS projection (equirectangular, fine at neighbourhood scale) of real
 * listing positions, so it costs nothing to render and can't leak map-vendor keys.
 *
 * Pins: cyan = live listing, amber = live with a price cut (both IDX/public).
 * Emerald = a recent sale — positions only. For anon these arrive pre-rounded to
 * ~110 m with no identity attached (see getSoldNearSummary); the dots tease WHERE
 * the market moved, never WHAT it moved for.
 */

export interface RadarPin {
  lat: number;
  lng: number;
  cut: boolean;
}

const KM_PER_DEG_LAT = 110.574;

function project(
  centerLat: number,
  centerLng: number,
  lat: number,
  lng: number,
  radiusKm: number
): { x: number; y: number } | null {
  const kmPerDegLng = 111.32 * Math.cos((centerLat * Math.PI) / 180);
  const dxKm = (lng - centerLng) * kmPerDegLng;
  const dyKm = (lat - centerLat) * KM_PER_DEG_LAT;
  const dist = Math.hypot(dxKm, dyKm);
  if (dist > radiusKm * 1.02) return null;
  return {
    x: 50 + (dxKm / radiusKm) * 48,
    y: 50 - (dyKm / radiusKm) * 48,
  };
}

export default function StreetRadar({
  centerLat,
  centerLng,
  radiusKm,
  activePins,
  soldPoints,
}: {
  centerLat: number;
  centerLng: number;
  radiusKm: number;
  activePins: RadarPin[];
  soldPoints: Array<[number, number]>;
}) {
  if (activePins.length === 0 && soldPoints.length === 0) return null;

  const actives = activePins
    .map((p) => ({ pos: project(centerLat, centerLng, p.lat, p.lng, radiusKm), cut: p.cut }))
    .filter((p): p is { pos: { x: number; y: number }; cut: boolean } => p.pos !== null);
  const solds = soldPoints
    .map(([lat, lng]) => project(centerLat, centerLng, lat, lng, radiusKm))
    .filter((p): p is { x: number; y: number } => p !== null);

  return (
    <section className="rounded-lg border border-border bg-card/40 p-5">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-[11px] font-bold uppercase tracking-wider text-foreground">Street radar</h2>
        <span className="font-mono text-[10px] text-muted-foreground">live · {radiusKm} km</span>
      </div>

      <div
        className="relative aspect-square w-full overflow-hidden rounded-md border border-border bg-muted/25"
        role="img"
        aria-label={`${actives.length} live listings and ${solds.length} recent sales plotted around this address`}
      >
        {/* radius rings */}
        <div className="absolute left-1/2 top-1/2 h-1/2 w-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-cyan-500/25" aria-hidden="true">
          <span className="absolute -top-2 left-1/2 -translate-x-1/2 bg-transparent px-1 font-mono text-[8px] text-cyan-700/70 dark:text-cyan-400/60">
            {radiusKm / 2} km
          </span>
        </div>
        <div className="absolute left-1/2 top-1/2 h-[96%] w-[96%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-cyan-500/20" aria-hidden="true" />

        {/* pins (decorative detail; the aria-label above carries the counts) */}
        {solds.map((p, i) => (
          <span
            key={`s${i}`}
            className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-background bg-emerald-500/90"
            style={{ left: `${p.x}%`, top: `${p.y}%` }}
            aria-hidden="true"
          />
        ))}
        {actives.map((p, i) => (
          <span
            key={`a${i}`}
            className={`absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-background ${
              p.cut ? "bg-amber-500" : "bg-cyan-500"
            }`}
            style={{ left: `${p.pos.x}%`, top: `${p.pos.y}%` }}
            aria-hidden="true"
          />
        ))}

        {/* subject home — centre, with a ping */}
        <span className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2" aria-hidden="true">
          <span className="absolute inset-0 -m-1.5 animate-ping rounded-full border-2 border-cyan-500/50 motion-reduce:hidden" />
          <span className="block h-3.5 w-3.5 rounded-full border-[3px] border-cyan-600 bg-background dark:border-cyan-400" />
        </span>
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
