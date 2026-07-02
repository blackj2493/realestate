"use client";
/**
 * useZoningLayers — deck.gl layer for the zoning overlay (Surface B).
 *
 * Fetches municipal zoning polygons for the current viewport from /api/zoning when the Zoning
 * lens is on, and renders them as a translucent fill coloured by zone category, prepended under
 * the listing pins (pins stay clickable). Hover surfaces the zone code + category. The card
 * (ZoningCard) is the per-listing surface; this is the spatial "what's zoned around here" view.
 * Attribution is shown by AlphaMap's legend (municipal open data, OGL — see attribution.ts).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { GeoJsonLayer } from "@deck.gl/layers";
import type { Layer, PickingInfo } from "@deck.gl/core";
import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";
import type { OverlayBounds } from "./useSchoolCatchmentLayers";

export interface ZoningHover {
  x: number;
  y: number;
  code: string;
  category: string;
}

interface ZoneProps {
  code?: string | null;
  source?: string | null;
}
interface ZoningFC {
  type: "FeatureCollection";
  features: { type: "Feature"; geometry: unknown; properties: ZoneProps }[];
}

// Category by the leading letter of the zone code (reliable across Toronto By-law 569-2013
// and the Simcoe County townships — A/F/M appear in rural by-laws, never in Toronto's set).
const CATEGORY: Record<string, { name: string; color: [number, number, number] }> = {
  R: { name: "Residential", color: [52, 211, 153] }, // emerald
  C: { name: "Commercial Residential", color: [59, 130, 246] }, // blue
  E: { name: "Employment", color: [167, 139, 250] }, // violet
  I: { name: "Institutional", color: [45, 212, 191] }, // teal
  O: { name: "Open Space", color: [134, 239, 172] }, // light green
  U: { name: "Utility & Transportation", color: [148, 163, 184] }, // slate
  A: { name: "Agricultural", color: [217, 164, 65] }, // gold — dominant Simcoe rural zone
  F: { name: "Future Development", color: [251, 146, 60] }, // orange
  M: { name: "Industrial", color: [129, 140, 248] }, // indigo
};
// Two-letter rural prefixes that the single-letter map would miscategorise (RU→Residential,
// EP→Employment): catch them first. RU (Rural) and EP (Environmental Protection) dominate the
// rural county by-laws (Frontenac, Simcoe), so distinguishing them keeps the overlay legible.
const PREFIX2: Record<string, { name: string; color: [number, number, number] }> = {
  RU: { name: "Rural", color: [158, 163, 74] }, // olive
  EP: { name: "Environmental Protection", color: [134, 239, 172] }, // light green
};
function categoryOf(code?: string | null) {
  if (!code) return { name: "Other", color: [148, 163, 184] as [number, number, number] };
  const two = PREFIX2[code.slice(0, 2).toUpperCase()];
  if (two) return two;
  return CATEGORY[code[0]] || { name: "Other", color: [148, 163, 184] as [number, number, number] };
}

export function useZoningLayers(opts: {
  zoom: number;
  bounds: OverlayBounds | null;
  onHover: (h: ZoningHover | null) => void;
}): Layer[] {
  const { zoom, bounds, onHover } = opts;
  const showZoning = useCommandCenterStore((s) => s.showZoning);
  const [fc, setFc] = useState<ZoningFC | null>(null);
  const reqRef = useRef(0);

  useEffect(() => {
    if (!showZoning || !bounds) {
      setFc(null);
      return;
    }
    const params = new URLSearchParams({
      bbox: `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`,
      zoom: String(Math.round(zoom)),
    });
    const my = ++reqRef.current;
    const t = setTimeout(() => {
      fetch(`/api/zoning?${params.toString()}`)
        .then((r) => r.json())
        .then((d) => { if (my === reqRef.current) setFc(d as ZoningFC); })
        .catch(() => { if (my === reqRef.current) setFc(null); });
    }, 250);
    return () => clearTimeout(t);
  }, [showZoning, bounds, zoom]);

  return useMemo(() => {
    if (!fc?.features?.length) return [];
    return [
      new GeoJsonLayer({
        id: "zoning-areas",
        data: fc as unknown as GeoJSON.FeatureCollection,
        stroked: true,
        filled: true,
        getFillColor: (f: unknown) => {
          const c = categoryOf((f as { properties: ZoneProps }).properties.code).color;
          return [c[0], c[1], c[2], 32];
        },
        getLineColor: (f: unknown) => {
          const c = categoryOf((f as { properties: ZoneProps }).properties.code).color;
          return [c[0], c[1], c[2], 200];
        },
        getLineWidth: 1,
        lineWidthUnits: "pixels",
        pickable: true,
        autoHighlight: true,
        highlightColor: [255, 255, 255, 40],
        onHover: (info: PickingInfo) => {
          const p = (info.object as { properties: ZoneProps } | undefined)?.properties;
          if (!p?.code) { onHover(null); return; }
          onHover({ x: info.x, y: info.y, code: p.code, category: categoryOf(p.code).name });
        },
      }),
    ];
  }, [fc, onHover]);
}
