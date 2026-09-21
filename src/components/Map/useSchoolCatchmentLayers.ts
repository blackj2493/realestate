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
 * PROGRAM is the second axis beside panel. One French Immersion school serves several
 * regular catchments, so its zone runs several times larger than that school's regular
 * zone — St Cyril's is 57.6 km2 against a 3.2 km2 median TCDSB zone. Program zones
 * therefore draw with a thicker, fainter-filled outline so they never read as a home
 * catchment at a glance.
 *
 * The circle is a REGULAR-program fallback ONLY. A program zone is not centred on its
 * school and is nothing like a disc, so a circle there would be worse than silence:
 * it would understate the zone while looking authoritative. For a program a board does
 * not publish, the hook draws nothing and reports the gap through `onProgramGap`.
 *
 * Returned layers are prepended to AlphaMap's layer array so they sit UNDER the
 * listing pins (pins stay clickable; catchment fills are translucent).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { GeoJsonLayer, PolygonLayer } from "@deck.gl/layers";
import type { Layer, PickingInfo } from "@deck.gl/core";
import { useCommandCenterStore, type SchoolProgram } from "@/lib/stores/commandCenterStore";
import { synthesizeCirclePolygon, latLngPolygonToLngLat } from "@/lib/bubbles/serialize";

export interface CatchmentHover {
  x: number;
  y: number;
  name: string;
  detail: string;
  approximate: boolean;
}

/** Reported when the selected school has no zone for the selected program. The map
 *  states the gap instead of substituting a circle that would misrepresent it. */
export interface CatchmentProgramGap {
  schoolName: string;
  program: SchoolProgram;
}

const PROGRAM_LABEL: Record<SchoolProgram, string> = {
  regular: "Home catchment",
  french_immersion: "French Immersion zone",
  extended_french: "Extended French zone",
};

interface CatchmentProps {
  school_name?: string | null;
  panel?: string | null;
  program?: string | null;
  grades?: string | null;
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

const isProgramZone = (p: CatchmentProps) => (p.program ?? "regular") !== "regular";
/** "French Immersion zone · grades 1-4" — the grade band matters where a board splits
 *  immersion across two schools, so one address sits in two zones at different ages. */
function zoneLabel(p: CatchmentProps): string {
  const base = PROGRAM_LABEL[(p.program ?? "regular") as SchoolProgram] ?? PROGRAM_LABEL.regular;
  return p.grades ? `${base} · grades ${p.grades}` : base;
}

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
  onProgramGap?: (g: CatchmentProgramGap | null) => void;
}): Layer[] {
  const { zoom, bounds, onHover, onProgramGap } = opts;
  const showZones = useCommandCenterStore((s) => s.school.showZones);
  const level = useCommandCenterStore((s) => s.school.level);
  const system = useCommandCenterStore((s) => s.school.system);
  const program = useCommandCenterStore((s) => s.school.program);
  const targetSchool = useCommandCenterStore((s) => s.school.targetSchool);
  // Keep the gap callback out of the fetch effect's deps: a parent that passes an inline
  // arrow would otherwise re-run the request on every render. Synced in an effect (not
  // during render) and declared first, so it is current before the fetch effect reads it.
  const gapRef = useRef(onProgramGap);
  useEffect(() => {
    gapRef.current = onProgramGap;
  }, [onProgramGap]);

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
      program,
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
  }, [showZones, level, system, program, bounds, zoom]);

  // Selected target school: show its REAL catchment if we have it (by school_id),
  // otherwise fall back to an approximate 2.5 km proximity circle around its point.
  useEffect(() => {
    if (!targetSchool) {
      setTargetFc(null);
      setCircle(null);
      gapRef.current?.(null);
      return;
    }
    let alive = true;
    setTargetFc(null);
    setCircle(null);
    gapRef.current?.(null);
    // program=any: a school that runs French Immersion holds a regular zone AND a far
    // larger FI zone under one school_id. We fetch both and keep the selected one, so
    // the label can never call an FI zone the home catchment.
    fetch(`/api/schools/catchments?schoolId=${encodeURIComponent(targetSchool.id)}&program=any`)
      .then((r) => r.json())
      .then((d: CatchmentFC) => {
        if (!alive) return;
        const wanted = (d?.features ?? []).filter(
          (f) => (f.properties.program ?? "regular") === program
        );
        if (wanted.length) {
          setTargetFc({ type: "FeatureCollection", features: wanted }); // real boundary — no circle
          return;
        }
        if (program !== "regular") {
          // No honest stand-in exists: a program zone is neither centred on its school
          // nor disc-shaped, so a circle would understate it while looking official.
          gapRef.current?.({ schoolName: targetSchool.name, program });
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
  }, [targetSchool, program]);

  return useMemo(() => {
    const out: Layer[] = [];

    if (fc && fc.features?.length) {
      out.push(
        new GeoJsonLayer({
          id: "school-catchments",
          data: fc as unknown as GeoJSON.FeatureCollection,
          stroked: true,
          filled: true,
          // A program zone covers several regular zones, so it gets a fainter fill and a
          // heavier outline — legible when it sits over the regular zones it draws from.
          getFillColor: (f: unknown) => {
            const p = (f as CatchmentFeature).properties;
            const c = colorFor(p.system);
            return [c[0], c[1], c[2], isProgramZone(p) ? 14 : 26];
          },
          getLineColor: (f: unknown) => {
            const c = colorFor((f as CatchmentFeature).properties.system);
            return [c[0], c[1], c[2], 220];
          },
          getLineWidth: (f: unknown) => (isProgramZone((f as CatchmentFeature).properties) ? 3 : 1.5),
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
            const bits = [zoneLabel(p), "official", p.board, p.year].filter(Boolean).join(" · ");
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
          getFillColor: (f: unknown) => [34, 211, 238, isProgramZone((f as CatchmentFeature).properties) ? 28 : 45],
          getLineColor: [34, 211, 238, 255],
          getLineWidth: (f: unknown) => (isProgramZone((f as CatchmentFeature).properties) ? 3.5 : 2.5),
          lineWidthUnits: "pixels",
          pickable: true,
          onHover: (info: PickingInfo) => {
            const p = (info.object as CatchmentFeature | undefined)?.properties;
            if (!p) {
              onHover(null);
              return;
            }
            const score = typeof p.score === "number" ? ` · ${p.score.toFixed(1)}/10` : "";
            // zoneLabel, not a hardcoded "Home catchment" — that caption on a French
            // Immersion zone is the misread this whole change exists to stop.
            const bits = [zoneLabel(p), p.board, p.year].filter(Boolean).join(" · ");
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
