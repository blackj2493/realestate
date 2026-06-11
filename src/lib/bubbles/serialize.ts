/**
 * Market-bubble serialization helpers — pure functions, no React / Zustand deps
 * so they're trivially unit-testable.
 *
 * A bubble persists three pieces:
 *   - polygon: the canonical area as [[lat,lng],...]. The Typesense `location:(...)`
 *     filter (and downstream sold-comp polygon queries) drive off this directly.
 *   - source: the INPUTS that produced the polygon (school point + radius, isochrone
 *     destination + minutes, raw drawn points). Kept so we can re-derive on schema
 *     changes (e.g. recompute a 2.5 km circle if we ever change the radius).
 *   - filters: the rest of the commandCenterStore search-filter slice (persona,
 *     beds, price band, school min score, etc.) — everything EXCEPT the polygon
 *     and the ephemeral UI/selection state.
 *
 * Note on coordinate orders (CLAUDE.md / app convention):
 *   - drawPolygon in the store is [lng, lat] (deck.gl native)
 *   - commute.polygon in the store is [lng, lat] (deck.gl native)
 *   - The bubble.polygon column is [lat, lng] (matches Typesense location filter)
 */

import type {
  CommuteState,
  SchoolState,
} from "@/lib/stores/commandCenterStore";
import type {
  PersonaType,
  TerminalFilterState,
} from "@/lib/personas/personaConfig";

export type BubbleAreaType = "draw" | "commute" | "school";

/** Subset of commandCenterStore that we persist as the bubble's "filters" blob. */
export interface BubbleFiltersSnapshot {
  activePersona: PersonaType;
  filters: TerminalFilterState;
  location: string;
  /** commute WITHOUT polygon (polygon lives in the top-level bubble.polygon). */
  commute: Omit<CommuteState, "polygon">;
  /** school WITHOUT enabled flag (re-enabled on rehydrate). */
  school: SchoolState;
}

export interface BubbleSourceDraw {
  /** Raw clicked points in [lng, lat] order. */
  drawPoints: [number, number][];
}

export interface BubbleSourceCommute {
  destination: { label: string; lat: number; lng: number };
  mode: CommuteState["mode"];
  minutes: number;
}

export interface BubbleSourceSchool {
  schoolKey: string;
  schoolName: string;
  schoolPoint: [number, number]; // [lat, lng]
  radiusKm: number; // 2.5 today — kept explicit for future tuning
}

export type BubbleSource =
  | ({ kind: "draw" } & BubbleSourceDraw)
  | ({ kind: "commute" } & BubbleSourceCommute)
  | ({ kind: "school" } & BubbleSourceSchool);

/** Wire-format payload sent to POST /api/bubbles. */
export interface BubblePayload {
  name: string;
  area_type: BubbleAreaType;
  polygon: [number, number][]; // [lat, lng]
  source: BubbleSource;
  filters: BubbleFiltersSnapshot;
}

/** As returned by GET /api/bubbles. */
export interface Bubble extends BubblePayload {
  id: string;
  created_at: string;
  updated_at: string;
  /** Nightly new-listing digest toggle (default ON; migration 034). Optional so
   *  pre-034 API payloads stay assignable. */
  alerts_enabled?: boolean;
  notify_since?: string | null;
}

// ──────────────────────────────────────────────────────────────────────────
// SAVE: build a payload from current store state
// ──────────────────────────────────────────────────────────────────────────

/** Convert deck.gl-order [lng, lat] vertices to bubble-order [lat, lng]. */
export function lngLatPolygonToLatLng(
  points: [number, number][]
): [number, number][] {
  return points.map(([lng, lat]) => [lat, lng]);
}

/** Convert bubble-order [lat, lng] back to deck.gl-order [lng, lat]. */
export function latLngPolygonToLngLat(
  points: [number, number][]
): [number, number][] {
  return points.map(([lat, lng]) => [lng, lat]);
}

/**
 * 32-vertex circle polygon centered on [lat, lng] at the given radius.
 * Local equirectangular approximation — good to a fraction of a percent at
 * the small radii used here (≤5 km in Southern Ontario). Returned in [lat, lng].
 */
export function synthesizeCirclePolygon(
  centerLatLng: [number, number],
  radiusKm: number,
  segments = 32
): [number, number][] {
  const [lat, lng] = centerLatLng;
  const earthRadiusKm = 6371;
  const latPerKm = 1 / 111;
  const lngPerKm = 1 / (111 * Math.cos((lat * Math.PI) / 180));
  const out: [number, number][] = [];
  for (let i = 0; i < segments; i++) {
    const theta = (i / segments) * 2 * Math.PI;
    const dx = radiusKm * Math.cos(theta);
    const dy = radiusKm * Math.sin(theta);
    out.push([lat + dy * latPerKm, lng + dx * lngPerKm]);
  }
  // Close the ring for downstream consumers that expect it.
  out.push(out[0]);
  // earthRadiusKm referenced for clarity but unused in the local-flat approx.
  void earthRadiusKm;
  return out;
}

interface StoreSliceForSave {
  activePersona: PersonaType;
  filters: TerminalFilterState;
  location: string;
  commute: CommuteState;
  school: SchoolState;
  drawPolygon: [number, number][] | null;
  drawPoints: [number, number][];
}

/**
 * Build a save payload from the current store. Throws if the requested
 * area_type is incompatible with the current store state (e.g. asking for a
 * 'draw' bubble when no polygon has been drawn).
 */
export function buildBubblePayload(
  store: StoreSliceForSave,
  opts: {
    name: string;
    area_type: BubbleAreaType;
    /** Required when area_type === 'school'. */
    school?: { key: string; name: string; point: [number, number]; radiusKm?: number };
  }
): BubblePayload {
  const filtersSnapshot: BubbleFiltersSnapshot = {
    activePersona: store.activePersona,
    filters: store.filters,
    location: store.location,
    commute: {
      enabled: store.commute.enabled,
      destination: store.commute.destination,
      mode: store.commute.mode,
      minutes: store.commute.minutes,
    },
    school: store.school,
  };

  if (opts.area_type === "draw") {
    if (!store.drawPolygon || store.drawPolygon.length < 3) {
      throw new Error("buildBubblePayload(draw): no polygon drawn");
    }
    const polygon = lngLatPolygonToLatLng(store.drawPolygon);
    return {
      name: opts.name,
      area_type: "draw",
      polygon,
      source: { kind: "draw", drawPoints: store.drawPolygon },
      filters: filtersSnapshot,
    };
  }

  if (opts.area_type === "commute") {
    if (!store.commute.polygon || !store.commute.destination) {
      throw new Error("buildBubblePayload(commute): commute polygon or destination missing");
    }
    return {
      name: opts.name,
      area_type: "commute",
      polygon: lngLatPolygonToLatLng(store.commute.polygon),
      source: {
        kind: "commute",
        destination: store.commute.destination,
        mode: store.commute.mode,
        minutes: store.commute.minutes,
      },
      filters: filtersSnapshot,
    };
  }

  // school
  if (!opts.school) {
    throw new Error("buildBubblePayload(school): opts.school is required");
  }
  const radiusKm = opts.school.radiusKm ?? 2.5;
  return {
    name: opts.name,
    area_type: "school",
    polygon: synthesizeCirclePolygon(opts.school.point, radiusKm),
    source: {
      kind: "school",
      schoolKey: opts.school.key,
      schoolName: opts.school.name,
      schoolPoint: opts.school.point,
      radiusKm,
    },
    filters: filtersSnapshot,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// LOAD: apply a saved bubble back onto the store
// ──────────────────────────────────────────────────────────────────────────

/** Setters required to rehydrate the store from a saved bubble. */
export interface StoreSettersForLoad {
  setActivePersona: (p: PersonaType) => void;
  setFilters: (f: TerminalFilterState) => void;
  setLocation: (loc: string) => void;
  setCommute: (patch: Partial<CommuteState>) => void;
  setCommutePolygon: (polygon: [number, number][] | null) => void;
  setSchool: (patch: Partial<SchoolState>) => void;
  clearDraw: () => void;
  /** Drop a finished polygon straight into drawPolygon, bypassing the click loop. */
  setDrawPolygon: (polygon: [number, number][] | null) => void;
}

/**
 * Apply a saved bubble back onto the commandCenterStore. The polygon is routed
 * to the right slot based on area_type so the Typesense filter composition in
 * properties/page.tsx picks it up unchanged.
 */
export function applyBubbleToStore(
  bubble: Bubble,
  setters: StoreSettersForLoad
): void {
  const f = bubble.filters;
  setters.setActivePersona(f.activePersona);
  setters.setFilters(f.filters);
  setters.setLocation(f.location ?? "");

  // Clear all three area sources first, then populate the one this bubble owns.
  setters.clearDraw();
  setters.setCommutePolygon(null);
  setters.setSchool({ targetSchool: null });

  if (bubble.area_type === "draw") {
    setters.setDrawPolygon(latLngPolygonToLngLat(bubble.polygon));
    return;
  }

  if (bubble.area_type === "commute" && bubble.source.kind === "commute") {
    setters.setCommute({
      enabled: true,
      destination: bubble.source.destination,
      mode: bubble.source.mode,
      minutes: bubble.source.minutes,
    });
    setters.setCommutePolygon(latLngPolygonToLngLat(bubble.polygon));
    return;
  }

  if (bubble.area_type === "school" && bubble.source.kind === "school") {
    setters.setSchool({
      enabled: true,
      targetSchool: { id: bubble.source.schoolKey, name: bubble.source.schoolName },
    });
    // School bubbles synthesize a circle; the polygon itself isn't stored in the
    // store (school filter uses NearbySchools membership, not a polygon). The
    // polygon ships server-side only for /api/bubbles/[id]/stats sold-comp queries.
    return;
  }
}
