/**
 * Geocode API Route
 *
 * GET /api/geocode?q=...
 * Forward-geocodes a place/address via Mapbox for the commute-destination
 * autocomplete. Biased to Ontario/Canada around the GTA. Returns a short list
 * of { label, lat, lng } results.
 */

import { NextRequest, NextResponse } from "next/server";

export interface GeocodeResult {
  label: string;
  lat: number;
  lng: number;
}

export async function GET(req: NextRequest) {
  try {
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token || token === "your-mapbox-token") {
      return NextResponse.json(
        { error: "Mapbox token not configured" },
        { status: 500 }
      );
    }

    const q = req.nextUrl.searchParams.get("q")?.trim();
    if (!q || q.length < 2) {
      return NextResponse.json({ results: [] });
    }

    const url =
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json` +
      `?country=ca&proximity=-79.3832,43.6532&limit=5&language=en` +
      `&access_token=${token}`;

    const upstream = await fetch(url);
    if (!upstream.ok) {
      const detail = await upstream.text();
      console.error("[Geocode] Mapbox error:", upstream.status, detail);
      return NextResponse.json(
        { error: "Geocoding service error" },
        { status: 502 }
      );
    }

    const data = await upstream.json();
    const results: GeocodeResult[] = (data?.features ?? [])
      .filter((f: { center?: number[] }) => Array.isArray(f.center) && f.center.length === 2)
      .map((f: { place_name: string; text: string; center: [number, number] }) => ({
        label: f.place_name || f.text,
        lng: f.center[0],
        lat: f.center[1],
      }));

    return NextResponse.json({ results });
  } catch (err) {
    console.error("[Geocode API]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
