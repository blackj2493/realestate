/**
 * Geocode API Route
 *
 * GET /api/geocode?q=...[&poi=1]
 * Forward-geocodes a place/address for the commute-destination autocomplete, the reno
 * address field and the terminal's free-text address fly-to. Biased to Canada around the
 * GTA. Returns a short list of { label, lat, lng }.
 *
 * WHY SEARCH BOX AND NOT THE GEOCODING API. This route ran Mapbox Geocoding v5
 * (`mapbox.places`), which does not return the named places people type into a commute
 * box. "union station" answered with Station Street, Station Road, Station Gate Road and
 * Station Lane; "Oakville GO" answered with Goodson Crescent and Goldfinch Court. Adding
 * `types=poi` to v5 returns ZERO features, and v6 dropped POI from its schema outright,
 * so neither version could ever have worked. Search Box `forward` indexes POIs and
 * answers the same queries with Union Station, Union Station GO and Oakville GO — one
 * call, coordinates included, on the SAME token this route already used.
 *
 * POI IS OPT-IN (`poi=1`). It also turns on the LOCAL station pass (see transitSearch) that
 * runs ahead of Mapbox. Only the commute box wants a station or a mall: RenoAddressField
 * needs the address of a HOUSE, and geocodeClient feeds the address-profile ladder, where a
 * POI at the top of the list would send the map somewhere the user did not ask for. Callers
 * that omit the flag get the address/place types this route has always returned.
 */

import { NextRequest, NextResponse } from "next/server";
import { makeRateLimiter, clientIpFrom } from "@/lib/rateLimit";
import { mapSearchBoxFeatures } from "./mapSearchBox";
import { searchTransit } from "@/lib/amenities/transitSearch";

export type { GeocodeResult } from "./mapSearchBox";

// 30 lookups/min/IP — generous for autocomplete typing, hostile to quota-burn loops.
const limiter = makeRateLimiter({ windowMs: 60_000, max: 30 });

/** Everything Search Box can return EXCEPT poi/category — the historical behaviour. */
const ADDRESS_TYPES = "address,street,postcode,neighborhood,locality,place,district,region";

export async function GET(req: NextRequest) {
  try {
    const rl = limiter.check(clientIpFrom(req));
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
      );
    }

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
    const wantPoi = req.nextUrl.searchParams.get("poi") === "1";

    const url =
      `https://api.mapbox.com/search/searchbox/v1/forward?q=${encodeURIComponent(q)}` +
      `&country=CA&proximity=-79.3832,43.6532&limit=10&language=en` +
      // Ask for 10 and trim to 5 after de-duplication: Mapbox counts the three separate
      // Union Station records against the limit, so limit=5 upstream can leave 2 usable.
      (wantPoi ? "" : `&types=${ADDRESS_TYPES}`) +
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
    const remote = mapSearchBoxFeatures(data?.features);
    if (!wantPoi) return NextResponse.json({ results: remote });

    // Local stations lead. Search Box finds Union Station and Oakville GO, but the exact
    // phrase "Ajax GO Station" returns two short-term-rental listings that name the station
    // and never the station itself — upstream recall, not a parameter we control. Every GO
    // station sits in data/gta-amenities.json under its real name, so this answers those
    // queries exactly; Mapbox still supplies everything that is not a station.
    const local = searchTransit(q).map((t) => ({
      label: t.address ? `${t.name} · ${t.address}` : t.name,
      lat: t.lat,
      lng: t.lng,
    }));
    const taken = new Set(local.map((r) => `${r.lat.toFixed(4)},${r.lng.toFixed(4)}`));
    const merged = [...local, ...remote.filter((r) => !taken.has(`${r.lat.toFixed(4)},${r.lng.toFixed(4)}`))];
    return NextResponse.json({ results: merged.slice(0, 6) });
  } catch (err) {
    console.error("[Geocode API]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
