"use client";

/**
 * Compact neighbourhood heat tile for the dashboard — a 3D deck.gl hexbin of one
 * region's active listings, colored/extruded by a toggleable metric. It's a teaser
 * into the full Map Terminal (click "Open map"), not a census: TRREB caps any UI
 * query at 100 listings (§6.3(b)), so this samples up to 100 active listings.
 *
 * Reuses the same WebGL stack, color ramp and geo helpers as AlphaMap so the look
 * is consistent. Must be dynamically imported with { ssr: false } (deck.gl + mapbox
 * touch the DOM at module load).
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import DeckGL from "@deck.gl/react";
import { HexagonLayer } from "@deck.gl/aggregation-layers";
import { Map } from "react-map-gl/mapbox";
import type { MapViewState } from "@deck.gl/core";
import { Layers, MapPin, ArrowUpRight } from "lucide-react";
import "mapbox-gl/dist/mapbox-gl.css";
import { searchListings, type ListingDocument } from "@/lib/typesense/client";
import { locationFilter } from "@/lib/dashboard/queries";
import { ALPHA_GLOW_RANGE } from "@/lib/personas/personaConfig";
import { isValidLocation, toDeckPosition } from "@/components/Map/mapLogic";

type MetricId = "cap" | "dom" | "drop";

const METRICS: {
  id: MetricId;
  label: string;
  get: (d: ListingDocument) => number | undefined;
}[] = [
  { id: "cap", label: "Cap Rate", get: (d) => d.ExtrapolatedCapRate },
  { id: "dom", label: "True DOM", get: (d) => d.TrueDom },
  { id: "drop", label: "Price Drop", get: (d) => d.TotalPriceDrop },
];

type HeatPoint = { coordinates: [number, number]; weight: number };

/** Frame the camera on the region's listings (center + a spread-derived zoom). */
function viewForListings(listings: ListingDocument[]): MapViewState {
  const base = { pitch: 42, bearing: 0 } as const;
  if (listings.length === 0) {
    return { longitude: -79.3832, latitude: 43.6532, zoom: 9.5, ...base };
  }
  let minLat = Infinity,
    maxLat = -Infinity,
    minLng = Infinity,
    maxLng = -Infinity;
  for (const l of listings) {
    const [lat, lng] = l.location;
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
  }
  const range = Math.max(maxLat - minLat, maxLng - minLng);
  const zoom = range > 0 ? Math.max(8, Math.min(13, 12 - Math.log10(range * 100))) : 11;
  return {
    longitude: (minLng + maxLng) / 2,
    latitude: (minLat + maxLat) / 2,
    zoom,
    ...base,
  };
}

export default function DashboardHeatTile({ region }: { region: string }) {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  const [metric, setMetric] = useState<MetricId>("cap");
  const [listings, setListings] = useState<ListingDocument[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    searchListings({ query: "*", rawFilterBy: locationFilter(region), perPage: 100 })
      .then((res) => {
        if (alive) setListings(res.listings.filter((l) => isValidLocation(l.location)));
      })
      .catch(() => alive && setListings([]))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [region]);

  // Camera is keyed to the listing set (not the metric) so toggling metrics never
  // jolts the view.
  const viewState = useMemo(() => viewForListings(listings), [listings]);

  const accessor = useMemo(
    () => METRICS.find((m) => m.id === metric)!.get,
    [metric]
  );

  const points = useMemo<HeatPoint[]>(
    () =>
      listings.flatMap((l) => {
        const v = accessor(l);
        return v != null && Number.isFinite(v) && v > 0
          ? [{ coordinates: toDeckPosition(l.location), weight: v }]
          : [];
      }),
    [listings, accessor]
  );

  const layers = useMemo(
    () => [
      new HexagonLayer<HeatPoint>({
        id: "dashboard-heat",
        data: points,
        getPosition: (d) => d.coordinates,
        getColorWeight: (d) => d.weight,
        getElevationWeight: (d) => d.weight,
        colorAggregation: "MEAN",
        elevationAggregation: "MEAN",
        colorRange: ALPHA_GLOW_RANGE,
        // elevationRange normalizes columns to the metric's own min/max, so wildly
        // different magnitudes (cap% vs $ drop) all read as comparable heights.
        elevationRange: [0, 1400],
        elevationScale: 1,
        extruded: true,
        radius: 700,
        coverage: 0.9,
        opacity: 0.92,
        material: { ambient: 0.85, diffuse: 0.5, shininess: 8, specularColor: [40, 70, 90] },
        updateTriggers: { getColorWeight: [metric], getElevationWeight: [metric] },
      }),
    ],
    [points, metric]
  );

  const mapUrl = `/properties?city=${encodeURIComponent(region)}`;

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2">
        <h2 className="terminal-font text-sm font-bold uppercase tracking-widest text-slate-100">
          Neighbourhood Heat <span className="text-slate-500">· {region}</span>
        </h2>
        <div className="flex items-center gap-2">
          <div className="flex border border-slate-700">
            {METRICS.map((m) => {
              const active = m.id === metric;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMetric(m.id)}
                  aria-pressed={active}
                  className={`terminal-font border-r border-slate-700 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors last:border-r-0 ${
                    active
                      ? "bg-cyan-500/20 text-cyan-300"
                      : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
                  }`}
                >
                  {m.label}
                </button>
              );
            })}
          </div>
          <Link
            href={mapUrl}
            className="terminal-font flex items-center gap-1 text-[11px] uppercase tracking-wider text-cyan-400 hover:underline"
          >
            Open map <ArrowUpRight className="h-3 w-3" />
          </Link>
        </div>
      </div>

      <div className="relative h-64 overflow-hidden border border-slate-800 bg-slate-950">
        {!token || token === "your-mapbox-token" ? (
          <div className="flex h-full items-center justify-center text-center">
            <div>
              <MapPin className="mx-auto mb-2 h-8 w-8 text-slate-700" />
              <p className="terminal-font text-xs text-slate-400">Map not configured</p>
              <p className="terminal-font mt-1 text-[10px] text-slate-600">
                Add NEXT_PUBLIC_MAPBOX_TOKEN to .env
              </p>
            </div>
          </div>
        ) : loading ? (
          <div className="flex h-full items-center justify-center">
            <p className="terminal-font text-xs text-slate-500">Loading heat…</p>
          </div>
        ) : points.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center">
            <div>
              <Layers className="mx-auto mb-2 h-8 w-8 text-slate-700" />
              <p className="terminal-font text-xs text-slate-400">
                No {METRICS.find((m) => m.id === metric)!.label.toLowerCase()} data to map here
              </p>
            </div>
          </div>
        ) : (
          <>
            <DeckGL viewState={viewState} controller={false} layers={layers}>
              <Map
                mapboxAccessToken={token}
                mapStyle="mapbox://styles/mapbox/dark-v11"
                reuseMaps
                attributionControl={false}
              />
            </DeckGL>
            {/* Legend + honest sample-size caption */}
            <div className="pointer-events-none absolute bottom-2 left-2 flex items-center gap-2 border border-slate-700 bg-slate-950/80 px-2 py-1 backdrop-blur">
              <span className="terminal-font text-[9px] uppercase tracking-wider text-slate-500">
                {METRICS.find((m) => m.id === metric)!.label}
              </span>
              <span className="flex items-center gap-1 text-[9px] text-slate-500">
                Low
                <span
                  className="h-2 w-16 rounded-sm"
                  style={{
                    background:
                      "linear-gradient(90deg, rgb(8,51,68), rgb(13,165,196), rgb(99,110,247))",
                  }}
                />
                High
              </span>
            </div>
            <div className="pointer-events-none absolute bottom-2 right-2 border border-slate-700 bg-slate-950/80 px-2 py-1 backdrop-blur">
              <span className="terminal-font text-[9px] uppercase tracking-wider text-slate-500">
                {points.length} of up to 100 active
              </span>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
