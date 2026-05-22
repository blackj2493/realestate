/**
 * Isochrone API Route
 *
 * POST /api/isochrone
 * Proxies the Mapbox Isochrone API and returns a simplified reachable-area
 * polygon for the commute-time filter. Only the user's destination + travel
 * params are sent upstream — no listing data leaves the system.
 *
 * To switch to a traffic-aware / transit provider (TravelTime) later, replace
 * the upstream fetch below; the response contract ({ polygon }) stays the same.
 */

import { NextRequest, NextResponse } from "next/server";

type Mode = "driving" | "walking" | "cycling";
const MODES: Mode[] = ["driving", "walking", "cycling"];

// Cap the ring so the Typesense `location:(...)` filter string stays small.
const MAX_VERTICES = 50;

/** Evenly decimate a ring down to at most `max` points (keeps it closed). */
function decimateRing(ring: [number, number][], max: number): [number, number][] {
  if (ring.length <= max) return ring;
  const closed = ring.length > 1 &&
    ring[0][0] === ring[ring.length - 1][0] &&
    ring[0][1] === ring[ring.length - 1][1];
  const pts = closed ? ring.slice(0, -1) : ring;
  const step = pts.length / (max - 1);
  const out: [number, number][] = [];
  for (let i = 0; i < max - 1; i++) {
    out.push(pts[Math.floor(i * step)]);
  }
  out.push([out[0][0], out[0][1]]); // re-close
  return out;
}

/** Pick the largest outer ring across Polygon / MultiPolygon geometries. */
function extractOuterRing(geometry: {
  type: string;
  coordinates: number[][][] | number[][][][];
}): [number, number][] | null {
  if (geometry.type === "Polygon") {
    const ring = (geometry.coordinates as number[][][])[0];
    return ring ? (ring as [number, number][]) : null;
  }
  if (geometry.type === "MultiPolygon") {
    const polys = geometry.coordinates as number[][][][];
    let best: number[][] | null = null;
    for (const poly of polys) {
      const ring = poly[0];
      if (ring && (!best || ring.length > best.length)) best = ring;
    }
    return best ? (best as [number, number][]) : null;
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token || token === "your-mapbox-token") {
      return NextResponse.json(
        { error: "Mapbox token not configured" },
        { status: 500 }
      );
    }

    const body = await req.json();
    const lat = Number(body?.lat);
    const lng = Number(body?.lng);
    const minutes = Math.round(Number(body?.minutes));
    const mode: Mode = MODES.includes(body?.mode) ? body.mode : "driving";

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return NextResponse.json(
        { error: "Invalid coordinates" },
        { status: 400 }
      );
    }
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 60) {
      return NextResponse.json(
        { error: "minutes must be between 1 and 60" },
        { status: 400 }
      );
    }

    // generalize (metres) simplifies the contour server-side; walking needs a
    // finer tolerance than driving since the area is much smaller.
    const generalize = mode === "walking" ? 30 : mode === "cycling" ? 50 : 80;
    const url =
      `https://api.mapbox.com/isochrone/v1/mapbox/${mode}/${lng},${lat}` +
      `?contours_minutes=${minutes}&polygons=true&denoise=1&generalize=${generalize}` +
      `&access_token=${token}`;

    const upstream = await fetch(url);
    if (!upstream.ok) {
      const detail = await upstream.text();
      console.error("[Isochrone] Mapbox error:", upstream.status, detail);
      return NextResponse.json(
        { error: "Isochrone service error" },
        { status: 502 }
      );
    }

    const data = await upstream.json();
    const feature = data?.features?.[0];
    const ring = feature?.geometry ? extractOuterRing(feature.geometry) : null;

    if (!ring || ring.length < 4) {
      return NextResponse.json(
        { error: "No reachable area for this destination" },
        { status: 422 }
      );
    }

    const polygon = decimateRing(ring, MAX_VERTICES);
    return NextResponse.json({ polygon, minutes, mode });
  } catch (err) {
    console.error("[Isochrone API]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
