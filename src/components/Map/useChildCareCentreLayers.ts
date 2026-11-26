"use client";
/**
 * useChildCareCentreLayers — deck.gl pins for licensed child care centres: City of Toronto
 * centres (spaces by age, $10-a-day) and Ontario ministry centres elsewhere (name and
 * full/half day only, at an approximate postal-code point).
 *
 * Drawn when the Child care tool is on AND "Show centres on the map" is ticked, and only
 * from MIN_CENTRE_ZOOM in (thousands of dots across the province are noise, not information).
 * Data comes once from /api/childcare/centres (long-cached GeoJSON) — the source JSON is
 * never bundled. Prepended under the listing pins so a home pin always wins the click;
 * hover surfaces name + age groups + $10-a-day through AlphaMap's pointer-events-none
 * tooltip. Colour: violet for a Toronto $10-a-day centre, slate otherwise (the Ontario list
 * has no $10-a-day flag, so its pins are slate too).
 */
import { useEffect, useMemo, useState } from "react";
import { ScatterplotLayer } from "@deck.gl/layers";
import type { Layer, PickingInfo } from "@deck.gl/core";
import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";
import type { ChildCareCentreProps, ChildCareCentresGeoJson, TorontoCentreProps } from "@/lib/childcare/centresGeoJson";

/** Below this zoom the pins are hidden (about a neighbourhood across the screen). */
export const MIN_CENTRE_ZOOM = 12;

export interface ChildCareHover {
  x: number;
  y: number;
  name: string;
  /** Toronto: "Infant 10 · Toddler 15 · Preschool 24" (groups with 0 spaces are left out).
   *  Ontario: "Licensed centre · Full day" / "Licensed centre · Half day". */
  ages: string;
  cwelcc: boolean;
  /** true = City of Toronto data with spaces; false = Ontario list, approximate location. */
  detail: boolean;
}

type CentrePoint = ChildCareCentreProps & { position: [number, number] };

// One fetch per page load, shared across remounts (mobile List/Map toggles).
let CENTRES_PROMISE: Promise<CentrePoint[]> | null = null;
function loadCentres(): Promise<CentrePoint[]> {
  if (!CENTRES_PROMISE) {
    CENTRES_PROMISE = fetch("/api/childcare/centres")
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json() as Promise<ChildCareCentresGeoJson>;
      })
      .then((fc) => fc.features.map((f) => ({ ...f.properties, position: f.geometry.coordinates })))
      .catch((e) => {
        CENTRES_PROMISE = null; // allow a retry on the next toggle
        throw e;
      });
  }
  return CENTRES_PROMISE;
}

export function ageGroupsLabel(c: Pick<TorontoCentreProps, "infant" | "toddler" | "preschool">): string {
  const parts: string[] = [];
  if (c.infant > 0) parts.push(`Infant ${c.infant}`);
  if (c.toddler > 0) parts.push(`Toddler ${c.toddler}`);
  if (c.preschool > 0) parts.push(`Preschool ${c.preschool}`);
  return parts.length ? parts.join(" · ") : "No spaces under age 4";
}

/** The tooltip fields for one pin (Toronto detail or an Ontario list centre). */
export function centreHover(c: ChildCareCentreProps): Pick<ChildCareHover, "name" | "ages" | "cwelcc" | "detail"> {
  if (c.detail) return { name: c.name, ages: ageGroupsLabel(c), cwelcc: c.cwelcc, detail: true };
  return { name: c.name, ages: `Licensed centre · ${c.fullDay ? "Full day" : "Half day"}`, cwelcc: false, detail: false };
}

export function useChildCareCentreLayers(opts: {
  zoom: number;
  onHover: (h: ChildCareHover | null) => void;
}): Layer[] {
  const { zoom, onHover } = opts;
  const enabled = useCommandCenterStore((s) => s.childCare.enabled && s.childCare.showCentres);
  const [centres, setCentres] = useState<CentrePoint[] | null>(null);

  useEffect(() => {
    if (!enabled || centres) return;
    let live = true;
    loadCentres()
      .then((c) => { if (live) setCentres(c); })
      .catch(() => { /* pins are optional; the filter still works */ });
    return () => { live = false; };
  }, [enabled, centres]);

  const visible = enabled && zoom >= MIN_CENTRE_ZOOM;

  // Clear a hover left behind when the pins disappear (zoom out / toggle off).
  useEffect(() => {
    if (!visible) onHover(null);
  }, [visible, onHover]);

  return useMemo(() => {
    if (!visible || !centres?.length) return [];
    // Hover on desktop; a tap on a phone (no hover there) shows the same tooltip.
    const show = (info: PickingInfo<CentrePoint>) => {
      const c = info.object;
      if (!c) { onHover(null); return; }
      onHover({ x: info.x, y: info.y, ...centreHover(c) });
    };
    return [
      new ScatterplotLayer<CentrePoint>({
        id: "childcare-centres",
        data: centres,
        getPosition: (d) => d.position,
        getRadius: 5,
        radiusUnits: "pixels",
        getFillColor: (d) => (d.detail && d.cwelcc ? [139, 92, 246, 220] : [100, 116, 139, 220]),
        stroked: true,
        getLineColor: [255, 255, 255, 230],
        lineWidthUnits: "pixels",
        getLineWidth: 1.5,
        pickable: true,
        autoHighlight: true,
        highlightColor: [255, 255, 255, 90],
        onHover: show,
        onClick: show,
      }),
    ];
  }, [visible, centres, onHover]);
}
