/**
 * Map cameras for every market the Weekly Data Drop can offer.
 *
 * WHY A CAMERA AND NOT `?city=`. Seeding the terminal with a city TEXT FILTER pins the whole
 * map to that place: pan one street past the boundary and the map empties with no
 * explanation. A first-run reader arriving from an email is EXPLORING, not searching, so the
 * right seed is the CAMERA — the query stays unfiltered and results follow the viewport.
 * `QUICK_PICK_MARKETS` already says exactly this in its own header, and
 * `src/app/properties/page.tsx` already implements the camera deep link (`?lat=&lng=&z=`),
 * noting that it "deliberately carries NO ?city=". This module just makes the email obey it.
 *
 * WHY THIS FILE EXISTS AT ALL. `regionCamera()` answers for only 10 of the 15
 * `BOARD_MARKETS`: Oshawa, Whitby, Ajax, Pickering and Milton are in neither
 * `QUICK_PICK_MARKETS` nor `data/city-centroids.json`. Adding them to QUICK_PICK_MARKETS
 * would change two in-app product surfaces (AcceptTermsForm and MarketPicker both
 * render that list as chips), which is not this feature's call to make. So they live here,
 * layered UNDER the shared resolver: `regionCamera` still wins wherever it answers, and this
 * only fills the holes.
 *
 * The five coordinates are the MEDIAN of each market's live for-sale listings, not the
 * municipal centroid — the same method QUICK_PICK_MARKETS records for its own late
 * additions, and for the same reason (Burlington's centroid framed half a map of water).
 * Measured 2026-08-28 over 331-500 listings each.
 */
import { regionCamera, type RegionCamera } from "@/lib/dashboard/area";

/** Markets with no entry in QUICK_PICK_MARKETS or city-centroids.json. */
const FALLBACK_CAMERAS: Record<string, RegionCamera> = {
  oshawa: { lat: 43.9142, lng: -78.8637, zoom: 12 },
  whitby: { lat: 43.8999, lng: -78.9458, zoom: 12 },
  ajax: { lat: 43.86, lng: -79.0278, zoom: 12 },
  pickering: { lat: 43.8384, lng: -79.1066, zoom: 12 },
  milton: { lat: 43.5159, lng: -79.8689, zoom: 12 },
};

/** Camera for a Data Drop market. Shared resolver first, local fill-ins second. */
export function dropCamera(market: string): RegionCamera | null {
  return regionCamera(market) ?? FALLBACK_CAMERAS[market.trim().toLowerCase()] ?? null;
}

/**
 * The terminal URL for a market: camera seed, no city filter.
 *
 * Falls back to `?city=` ONLY when no camera exists — a visible filter the user can clear
 * beats an arbitrary camera pointed at the wrong place. With the table above that path is
 * currently unreachable for BOARD_MARKETS, and it should stay that way: a new board market
 * needs a camera here before it is offered as a chip.
 */
export function marketMapUrl(site: string, market: string): string {
  const cam = dropCamera(market);
  const base = site.replace(/\/$/, "");
  if (!cam) return `${base}/properties?city=${encodeURIComponent(market)}`;
  return `${base}/properties?lat=${cam.lat}&lng=${cam.lng}&z=${cam.zoom}`;
}
