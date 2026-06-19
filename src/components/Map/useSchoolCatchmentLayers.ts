"use client";
/**
 * useSchoolCatchmentLayers — deck.gl layers for the school-zone overlay.
 *
 * Two distinct, deliberately-different layers:
 *   1. REAL attendance boundaries (solid, emerald=public / violet=catholic) fetched
 *      for the current viewport from /api/schools/catchments when the "Show zones"
 *      toggle is on. Labelled "Official · <board> · <year>".
 *   2. An APPROXIMATE 2.5 km proximity circle (dashed-feel amber) around an explicitly
 *      selected target school — a proximity radius, NOT a catchment. Renders the
 *      circle that today is invisible (serialize.ts only used it server-side).
 *
 * Returned layers are prepended to AlphaMap's layer array so they sit UNDER the
 * listing pins (pins stay clickable; catchment fills are translucent).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { GeoJsonLayer, PolygonLayer } from "@deck.gl/layers";
import type { Layer, PickingInfo } from "@deck.gl/core";
import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";
import { synthesizeCirclePolygon, latLngPolygonToLngLat } from "@/lib/bubbles/serialize";

export interface CatchmentHover {
  x: number;
  y: number;
  name: string;
  detail: string;
  approximate: boolean;
}

interface CatchmentProps {
  school_name?: string | null;
  panel?: string | null;
  system?: string | null;
  board?: string | null;
  year?: string | null;
  score?: number | null;
}
interface CatchmentFeature {
  type: "Feature";
  geometry: unknown;
  properties: CatchmentProps;
}
interface CatchmentFC {
  type: "FeatureCollection";
  features: CatchmentFeature[];
}

const SYSTEM_COLOR: Record<string, [number, number, number]> = {
  public: [16, 185, 129], // emerald
  catholic: [168, 85, 247], // violet
};
const colorFor = (system?: string | null) => SYSTEM_COLOR[system ?? "public"] ?? SYSTEM_COLOR.public;

export interface OverlayBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export function useSchoolCatchmentLayers(opts: {
  zoom: number;
  bounds: OverlayBounds | null;
  onHover: (h: CatchmentHover | null) => void;
}): Layer[] {
  const { zoom, bounds, onHover } = opts;
  const showZones = useCommandCenterStore((s) => s.school.showZones);
  const level = useCommandCenterStore((s) => s.school.level);
  const system = useCommandCenterStore((s) => s.school.system);
  const targetSchool = useCommandCenterStore((s) => s.school.targetSchool);

  const [fc, setFc] = useState<CatchmentFC | null>(null);
  const [targetFc, setTargetFc] = useState<CatchmentFC | null>(null);
  const [circle, setCircle] = useState<{ ring: [number, number][]; name: string } | null>(null);
  const reqRef = useRef(0);

  // Fetch real catchments for the current viewport (debounced) when zones are on.
  useEffect(() => {
    if (!showZones || !bounds) {
      setFc(null);
      return;
    }
    const params = new URLSearchParams({
      bbox: `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`,
      panel: level,
      zoom: String(Math.round(zoom)),
    });
    if (system !== "either") params.set("system", system);
    const my = ++reqRef.current;
    const t = setTimeout(() => {
      fetch(`/api/schools/catchments?${params.toString()}`)
        .then((r) => r.json())
        .then((d) => {
          if (my === reqRef.current) setFc(d as CatchmentFC);
        })
        .catch(() => {
          if (my === reqRef.current) setFc(null);
        });
    }, 250);
    return () => clearTimeout(t);
  }, [showZones, level, system, bounds, zoom]);

  // Selected target school: show its REAL catchment if we have it (by school_id),
  // otherwise fall back to an approximate 2.5 km proximity circle around its point.
  useEffect(() => {
    if (!targetSchool) {
      setTargetFc(null);
      setCircle(null);
      return;
    }
    let alive = true;
    setTargetFc(null);
    setCircle(null);
    fetch(`/api/schools/catchments?schoolId=${encodeURIComponent(targetSchool.id)}`)
      .then((r) => r.json())
      .then((d: CatchmentFC) => {
        if (!alive) return;
        if (d?.features?.length) {
          setTargetFc(d); // real boundary — no circle
          return;
        }
        // Fallback: proximity circle around the school point.
        fetch(`/api/schools/${encodeURIComponent(targetSchool.id)}`, { cache: "force-cache" })
          .then((r) => r.json())
          .then((pd) => {
            const sc = pd?.school as { name: string; lat: number; lng: number } | undefined;
            if (!alive || !sc || typeof sc.lat !== "number") return;
            const ringLatLng = synthesizeCirclePolygon([sc.lat, sc.lng], 2.5);
            setCircle({ ring: latLngPolygonToLngLat(ringLatLng), name: sc.name });
          })
          .catch(() => {});
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [targetSchool]);

  return useMemo(() => {
    const out: Layer[] = [];

    if (fc && fc.features?.length) {
      out.push(
        new GeoJsonLayer({
          id: "school-catchments",
          data: fc as unknown as GeoJSON.FeatureCollection,
          stroked: true,
          filled: true,
          getFillColor: (f: unknown) => {
            const c = colorFor((f as CatchmentFeature).properties.system);
            return [c[0], c[1], c[2], 26];
          },
          getLineColor: (f: unknown) => {
            const c = colorFor((f as CatchmentFeature).properties.system);
            return [c[0], c[1], c[2], 220];
          },
          getLineWidth: 1.5,
          lineWidthUnits: "pixels",
          pickable: true,
          autoHighlight: true,
          highlightColor: [255, 255, 255, 40],
          onHover: (info: PickingInfo) => {
            const p = (info.object as CatchmentFeature | undefined)?.properties;
            if (!p) {
              onHover(null);
              return;
            }
            const score = typeof p.score === "number" ? ` · ${p.score.toFixed(1)}/10` : "";
            const bits = ["Official", p.board, p.year].filter(Boolean).join(" · ");
            onHover({
              x: info.x,
              y: info.y,
              name: p.school_name ?? "School zone",
              detail: `${bits}${score}`,
              approximate: false,
            });
          },
        })
      );
    }

    // Selected school's real catchment — highlighted cyan so it stands out from the
    // emerald/violet overlay (and replaces the fallback circle when we have it).
    if (targetFc && targetFc.features?.length) {
      out.push(
        new GeoJsonLayer({
          id: "school-target-boundary",
          data: targetFc as unknown as GeoJSON.FeatureCollection,
          stroked: true,
          filled: true,
          getFillColor: [34, 211, 238, 45],
          getLineColor: [34, 211, 238, 255],
          getLineWidth: 2.5,
          lineWidthUnits: "pixels",
          pickable: true,
          onHover: (info: PickingInfo) => {
            const p = (info.object as CatchmentFeature | undefined)?.properties;
            if (!p) {
              onHover(null);
              return;
            }
            const score = typeof p.score === "number" ? ` · ${p.score.toFixed(1)}/10` : "";
            const bits = ["Home catchment", p.board, p.year].filter(Boolean).join(" · ");
            onHover({ x: info.x, y: info.y, name: p.school_name ?? "School zone", detail: `${bits}${score}`, approximate: false });
          },
        })
      );
    }

    if (circle) {
      out.push(
        new PolygonLayer<{ ring: [number, number][] }>({
          id: "school-proximity-circle",
          data: [{ ring: circle.ring }],
          getPolygon: (d) => d.ring,
          filled: true,
          stroked: true,
          getFillColor: [245, 158, 11, 18], // amber, faint
          getLineColor: [245, 158, 11, 200],
          getLineWidth: 1.5,
          lineWidthUnits: "pixels",
          pickable: true,
          onHover: (info: PickingInfo) => {
            if (!info.object) {
              onHover(null);
              return;
            }
            onHover({
              x: info.x,
              y: info.y,
              name: circle.name,
              detail: "Approximate 2.5 km radius — not an official catchment. Verify with the board.",
              approximate: true,
            });
          },
        })
      );
    }

    return out;
  }, [fc, targetFc, circle, onHover]);
}
