"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import DeckGL from "@deck.gl/react";
import { HexagonLayer } from "@deck.gl/aggregation-layers";
import { ScatterplotLayer, TextLayer, PolygonLayer, ColumnLayer, PathLayer } from "@deck.gl/layers";
import { Map, Layer as MapboxLayer } from "react-map-gl/mapbox";
import { MapViewState, FlyToInterpolator, WebMercatorViewport, type Layer } from "@deck.gl/core";
import { Layers, MapPin, Minus, Plus, X, Landmark } from "lucide-react";
import Supercluster from "supercluster";
import "mapbox-gl/dist/mapbox-gl.css";
import type { ListingDocument } from "@/lib/typesense/client";
import { isDelistedDealType } from "@/lib/sold/dealType";
import { ALPHA_GLOW_RANGE, type MapColorConfig } from "@/lib/personas/personaConfig";
import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";
import { compsAnchorForListing } from "@/lib/comps/compsAnchor";
import {
  CLUSTER_OPTIONS,
  MAP_MAX_ZOOM,
  clusterRadiusForZoom,
  formatPriceShort,
  hasMetricValue,
  isClusterFeature,
  isValidLocation,
  scatterColorFor,
  toDeckPosition,
} from "./mapLogic";
import ListingMapPopup from "./ListingMapPopup";
import { useSchoolCatchmentLayers, type CatchmentHover } from "./useSchoolCatchmentLayers";
import { useZoningLayers, type ZoningHover } from "./useZoningLayers";
import { ZONING_SOURCES } from "@/lib/zoning/attribution";

interface AlphaMapProps {
  properties: ListingDocument[];
  colorConfig: MapColorConfig;
  /** Heatmap aggregation: "mean" of the metric, or "count" of listings (Density). */
  heatAggregation?: "mean" | "count";
  onSelectProperty?: (d: ListingDocument) => void;
  className?: string;
  currentSearchQuery?: string;
}

type MapDataPoint = ListingDocument & { coordinates: [number, number] };
type PinProps = { listing: ListingDocument };

const INITIAL_VIEW_STATE: MapViewState = {
  longitude: -79.3832,
  latitude: 43.6532,
  zoom: 10,
  pitch: 0,
  bearing: 0,
};

// Camera tilt per render mode: Listings reads best flat (2D scan); Heatmap
// tilts to reveal the hex columns; 3D Explore tilts further into the cityscape.
const pitchForMode = (mode: string) => (mode === "listings" ? 0 : mode === "3d" ? 55 : 45);

// Normalize a metric value to [0,1] within its domain (for column heights).
const normMetric = (value: number, [lo, hi]: [number, number]) =>
  hi > lo ? Math.min(1, Math.max(0, (value - lo) / (hi - lo))) : 0;

// Half-width (days) of the temporal scrubber's visible True-DOM window.
const DOM_WINDOW_HALF = 22;

// Heatmap drill-down: a hex holding at most this many listings opens them
// directly in the popup; denser cells first zoom the camera in (the hexes are a
// fixed world size, so revealing a packed cell needs a closer, re-queried view).
const HEX_REVEAL_CAP = 12;

export default function AlphaMap({
  properties,
  colorConfig,
  heatAggregation = "mean",
  onSelectProperty,
  className = "",
  currentSearchQuery = "",
}: AlphaMapProps) {
  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

  const [viewState, setViewState] = useState<MapViewState>(INITIAL_VIEW_STATE);
  // Once the map has framed real results, keep it mounted even if a later
  // viewport-scoped query returns 0 — blanking it mid-browse would trap the user.
  const [mapReady, setMapReady] = useState(false);
  // Pinned, interactive popup: the card(s) at a clicked pin/stacked cluster.
  const [popup, setPopup] = useState<{ x: number; y: number; listings: ListingDocument[] } | null>(null);
  // Floating label for a hovered school catchment / proximity circle.
  const [catchmentHover, setCatchmentHover] = useState<CatchmentHover | null>(null);
  // Floating tooltip for a hovered heatmap hex (listing count + aggregate metric).
  const [hexHover, setHexHover] = useState<{ x: number; y: number; count: number; metric?: string } | null>(null);
  // Floating tooltip for a hovered zoning-overlay polygon (municipal open data).
  const [zoningHover, setZoningHover] = useState<ZoningHover | null>(null);

  // Render mode is lifted to the store so the Mode dock / rail can drive it.
  const mapMode = useCommandCenterStore((s) => s.mapMode);
  const showZoning = useCommandCenterStore((s) => s.showZoning); // toggled from the layers rail
  const hoveredId = useCommandCenterStore((s) => s.hoveredId);
  const setHoveredId = useCommandCenterStore((s) => s.setHoveredId);
  const selectedIds = useCommandCenterStore((s) => s.selectedIds);
  const isSelectMode = useCommandCenterStore((s) => s.isSelectMode);
  const setSelectMode = useCommandCenterStore((s) => s.setSelectMode);
  const toggleSelected = useCommandCenterStore((s) => s.toggleSelected);
  const commuteEnabled = useCommandCenterStore((s) => s.commute.enabled);
  const commutePolygon = useCommandCenterStore((s) => s.commute.polygon);
  const commuteDestination = useCommandCenterStore((s) => s.commute.destination);
  const setMapBounds = useCommandCenterStore((s) => s.setMapBounds);
  const isDrawing = useCommandCenterStore((s) => s.isDrawing);
  const drawPoints = useCommandCenterStore((s) => s.drawPoints);
  const drawPolygon = useCommandCenterStore((s) => s.drawPolygon);
  const addDrawPoint = useCommandCenterStore((s) => s.addDrawPoint);
  const finishDrawing = useCommandCenterStore((s) => s.finishDrawing);
  const timelineActive = useCommandCenterStore((s) => s.timelineActive);
  const domCenter = useCommandCenterStore((s) => s.domCenter);
  // Search V2: imperative fly-to target + a dropped search pin.
  const flyTo = useCommandCenterStore((s) => s.flyTo);
  const setFlyTo = useCommandCenterStore((s) => s.setFlyTo);
  const searchPin = useCommandCenterStore((s) => s.searchPin);
  const enterComps = useCommandCenterStore((s) => s.enterComps);
  const exitComps = useCommandCenterStore((s) => s.exitComps);
  const soldCount = useCommandCenterStore((s) => s.soldCount);

  // Active isochrone ring ([lng, lat] order, deck.gl-ready) — null when off.
  const commuteRing = useMemo<[number, number][] | null>(
    () => (commuteEnabled && commutePolygon && commutePolygon.length >= 3 ? commutePolygon : null),
    [commuteEnabled, commutePolygon]
  );

  const isInteracting = useRef(false);
  const lastSearchQuery = useRef(currentSearchQuery);
  const mapInitialized = useRef(false);
  // Signature of the result set we last framed — lets the auto-fit wait for a new
  // query's data to actually arrive before reframing (results lag the query string).
  const lastFitData = useRef("");

  // Viewport-query plumbing: report the visible extent so the search scopes to
  // what's on screen (HouseSigma-style progressive reveal under the 100-cap).
  const programmaticRef = useRef(false);
  const userMovedRef = useRef(false);
  const viewStateRef = useRef<MapViewState>(INITIAL_VIEW_STATE);
  const dimsRef = useRef<{ width: number; height: number } | null>(null);
  const reportTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Flag an upcoming view transition as programmatic so the settle handler never
  // mistakes an auto-fit/cluster-expand animation for a user pan (which would loop).
  const markProgrammatic = useCallback((durationMs: number) => {
    programmaticRef.current = true;
    // Outlast the transition AND the 350ms settle debounce (+ jitter), so a bounds
    // report scheduled during an auto-fit doesn't fire after programmaticRef expires
    // (which would re-query the auto-framed viewport → search→fit→search loop).
    setTimeout(() => {
      programmaticRef.current = false;
    }, durationMs + 500);
  }, []);

  // Compute the padded viewport extent and push it to the store.
  const computeAndReportBounds = useCallback(() => {
    const dims = dimsRef.current;
    const vs = viewStateRef.current;
    if (!dims || dims.width === 0 || dims.height === 0) return;
    try {
      const vp = new WebMercatorViewport({
        width: dims.width,
        height: dims.height,
        longitude: vs.longitude,
        latitude: vs.latitude,
        zoom: vs.zoom,
        pitch: vs.pitch ?? 0,
        bearing: vs.bearing ?? 0,
      });
      // getBounds() unprojects the screen corners, so a pitched (45°) trapezoid is
      // already enclosed; a small pad guards against rounding and pin footprints.
      const [west, south, east, north] = vp.getBounds();
      const padLng = (east - west) * 0.05;
      const padLat = (north - south) * 0.05;
      setMapBounds({
        north: north + padLat,
        south: south - padLat,
        east: east + padLng,
        west: west - padLng,
      });
    } catch {
      // Transient invalid viewport mid-transition — ignore.
    }
  }, [setMapBounds]);

  useEffect(() => () => {
    if (reportTimer.current) clearTimeout(reportTimer.current);
  }, []);

  // "Search this map area": commit the CURRENT viewport as the search box. Deferred a
  // tick so it lands AFTER the page's location-change reset (which nulls mapBounds) —
  // otherwise the reset would wipe the box we just set. The nonce ignores the initial 0.
  const searchAreaNonce = useCommandCenterStore((s) => s.searchAreaNonce);
  useEffect(() => {
    if (searchAreaNonce === 0) return;
    const t = setTimeout(() => computeAndReportBounds(), 0);
    return () => clearTimeout(t);
  }, [searchAreaNonce, computeAndReportBounds]);

  // Mode change re-tilts the camera (flat for Listings, pitched for Heatmap/3D)
  // with an animated transition so switching modes feels physical, not a cut.
  useEffect(() => {
    setViewState((vs) => ({
      ...vs,
      pitch: pitchForMode(mapMode),
      transitionDuration: 500,
      transitionInterpolator: new FlyToInterpolator(),
    }));
  }, [mapMode]);

  // location is stored as [lat, lng] (Typesense geopoint convention)
  const validProperties = useMemo(() => {
    if (!properties || properties.length === 0) return [];
    return properties.filter((p) => isValidLocation(p.location));
  }, [properties]);

  // deck.gl getPosition wants [lng, lat]; stored order is [lat, lng] → flip
  const mapData = useMemo<MapDataPoint[]>(
    () => validProperties.map((p) => ({ ...p, coordinates: toDeckPosition(p.location) })),
    [validProperties]
  );

  // Temporal scrubber: when active, render only listings whose True DOM falls in
  // the swept window. Client-side filter (no re-query) so playback stays smooth;
  // auto-fit/empty-state stay keyed on the full set so the map never jumps.
  const renderData = useMemo<MapDataPoint[]>(() => {
    if (!timelineActive) return mapData;
    const lo = domCenter - DOM_WINDOW_HALF;
    const hi = domCenter + DOM_WINDOW_HALF;
    return mapData.filter((d) => {
      const dom = d.TrueDom ?? d.calculatedDOM ?? 0;
      return dom >= lo && dom <= hi;
    });
  }, [mapData, timelineActive, domCenter]);

  // Auto-fit when the result set changes (and the user isn't interacting).
  // When a commute zone is active, the polygon-fit effect below governs framing.
  useEffect(() => {
    if (commuteRing) return;
    if (isInteracting.current || validProperties.length === 0) return;

    // A new query (area/persona) changes currentSearchQuery a render BEFORE its
    // results land, so we must not frame the PREVIOUS query's listings. Track a
    // cheap signature of the result set and wait until the data itself changes.
    const first = validProperties[0]?.id ?? "";
    const last = validProperties[validProperties.length - 1]?.id ?? "";
    const dataSig = `${validProperties.length}:${first}:${last}`;
    const queryChanged = lastSearchQuery.current !== currentSearchQuery;
    if (queryChanged) {
      if (dataSig === lastFitData.current) return; // still the old query's data — wait
      lastSearchQuery.current = currentSearchQuery;
    } else if (mapInitialized.current) {
      return; // same query, viewport drill-down — keep the camera where the user left it
    }

    // Frame the DENSE cluster (where the majority are), not the full extent. The
    // ≤100 results are sorted by the persona metric (cap rate, DOM…) so they can
    // be geographically scattered — a raw min/max bbox then zooms out to a province
    // view. Center on the MEDIAN point and frame the 10–90th-percentile span so a
    // handful of far-flung outliers never drag the camera out.
    const lats = validProperties.map((p) => p.location[0]).sort((a, b) => a - b);
    const lngs = validProperties.map((p) => p.location[1]).sort((a, b) => a - b);
    const pct = (arr: number[], p: number) =>
      arr[Math.min(arr.length - 1, Math.max(0, Math.round(p * (arr.length - 1))))];
    const centerLat = pct(lats, 0.5);
    const centerLng = pct(lngs, 0.5);
    const maxRange = Math.max(pct(lats, 0.9) - pct(lats, 0.1), pct(lngs, 0.9) - pct(lngs, 0.1));
    const zoom = maxRange > 0 ? Math.max(8, Math.min(15, 12 - Math.log10(maxRange * 100))) : 13;

    markProgrammatic(800);
    setViewState({
      longitude: centerLng,
      latitude: centerLat,
      zoom,
      pitch: pitchForMode(mapMode),
      bearing: 0,
      transitionDuration: 800,
      transitionInterpolator: new FlyToInterpolator(),
    });
    mapInitialized.current = true;
    setMapReady(true);
    lastFitData.current = dataSig;
  }, [validProperties, currentSearchQuery, commuteRing, markProgrammatic, mapMode]);

  // Fit to the commute zone whenever the isochrone changes (frames the whole
  // reachable area, even when zero listings match).
  useEffect(() => {
    if (!commuteRing || isInteracting.current) return;
    let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
    for (const [lng, lat] of commuteRing) {
      minLng = Math.min(minLng, lng);
      maxLng = Math.max(maxLng, lng);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
    }
    const maxRange = Math.max(maxLng - minLng, maxLat - minLat);
    const zoom = maxRange > 0 ? Math.max(8, Math.min(15, 12 - Math.log10(maxRange * 100))) : 11;
    markProgrammatic(800);
    setViewState((vs) => ({
      ...vs,
      longitude: (minLng + maxLng) / 2,
      latitude: (minLat + maxLat) / 2,
      zoom,
      transitionDuration: 800,
      transitionInterpolator: new FlyToInterpolator(),
    }));
  }, [commuteRing, markProgrammatic]);

  // Zoom buttons — drives the shared viewState directly. The Mapbox
  // NavigationControl we previously rendered inside <Map> sat UNDER deck.gl's
  // transparent event surface: visible, but no click/tap ever reached it. The
  // replacement is an HTML overlay (below) that sits ABOVE the deck canvas.
  const zoomBy = useCallback(
    (delta: number) => {
      setViewState((vs) => ({
        ...vs,
        zoom: Math.max(3, Math.min(MAP_MAX_ZOOM, vs.zoom + delta)),
        transitionDuration: 250,
        transitionInterpolator: new FlyToInterpolator(),
      }));
      // User-intent zoom — re-query the new viewport once the transition settles
      // (mirrors expandCluster; deliberately NOT markProgrammatic, which suppresses it).
      setTimeout(() => computeAndReportBounds(), 400);
    },
    [computeAndReportBounds]
  );

  // Search V2: imperative fly-to from the search bar. Re-runs on every nonce bump
  // (re-selecting the same place re-flies). Flagged programmatic so the settle
  // handler never mistakes the animated fly for a user pan (which would re-query).
  const flyNonce = flyTo?.nonce ?? 0;
  useEffect(() => {
    if (!flyTo) return;
    isInteracting.current = false;
    markProgrammatic(1000);
    setViewState((vs) => ({
      ...vs,
      longitude: flyTo.lng,
      latitude: flyTo.lat,
      zoom: flyTo.zoom ?? 14,
      transitionDuration: 1000,
      transitionInterpolator: new FlyToInterpolator(),
    }));
    setMapReady(true);
    mapInitialized.current = true;
    // Only re-fly when the nonce changes; flyTo carries the latest coords.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyNonce, markProgrammatic]);

  // A pin dropped at a searched/geocoded address (no listing) — cyan dot.
  const searchPinLayer = useMemo<Layer[]>(() => {
    if (!searchPin) return [];
    return [
      new ScatterplotLayer<{ lat: number; lng: number }>({
        id: "search-pin",
        data: [searchPin],
        getPosition: (d) => [d.lng, d.lat],
        getRadius: 9,
        radiusUnits: "pixels",
        getFillColor: [34, 211, 238, 255],
        stroked: true,
        getLineColor: [255, 255, 255, 255],
        lineWidthMinPixels: 2,
        pickable: false,
      }),
    ];
  }, [searchPin]);

  // For sparse metrics (cap rate / gross yield), exclude listings without an estimate
  // from the HexagonLayer so "no data" doesn't drag the MEAN toward zero.
  // Non-sparse metrics keep all points (0 is a legitimate value for price, DOM, etc.).
  const heatData = useMemo<MapDataPoint[]>(() => {
    if (!colorConfig.sparse || heatAggregation === "count") return renderData;
    return renderData.filter((d) => hasMetricValue(colorConfig.metric(d), colorConfig.sparse));
  }, [renderData, colorConfig, heatAggregation]);

  const getScatterColor = useCallback(
    (d: ListingDocument): [number, number, number] => {
      return scatterColorFor(colorConfig.metric(d), colorConfig.domain, colorConfig.range, colorConfig.sparse);
    },
    [colorConfig]
  );

  // ── Clustering (Listings mode) ─────────────────────────────────────────
  // ≤100 listings (compliance cap) so clustering the whole world bbox at the
  // current zoom is cheap and avoids needing the precise viewport extent.
  const clusterIndex = useMemo(() => {
    const index = new Supercluster<PinProps>({ ...CLUSTER_OPTIONS, radius: clusterRadiusForZoom(Math.round(viewState.zoom)) });
    index.load(
      renderData.map((p) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: p.coordinates },
        properties: { listing: p as ListingDocument },
      }))
    );
    return index;
  }, [renderData, viewState.zoom]);

  const clusters = useMemo(
    () => clusterIndex.getClusters([-180, -85, 180, 85], Math.round(viewState.zoom)),
    [clusterIndex, viewState.zoom]
  );

  type ClusterPoint = (typeof clusters)[number];

  const singles = useMemo(() => clusters.filter((f) => !isClusterFeature(f)), [clusters]);
  const groups = useMemo(() => clusters.filter((f) => isClusterFeature(f)), [clusters]);

  const expandCluster = useCallback(
    (clusterId: number, lng: number, lat: number) => {
      const zoom = Math.min(MAP_MAX_ZOOM, clusterIndex.getClusterExpansionZoom(clusterId));
      setViewState((vs) => ({
        ...vs,
        longitude: lng,
        latitude: lat,
        zoom,
        transitionDuration: 600,
        transitionInterpolator: new FlyToInterpolator(),
      }));
      // User drilled into a cluster — re-query the tighter viewport once the fly settles.
      setTimeout(() => computeAndReportBounds(), 750);
    },
    [clusterIndex, computeAndReportBounds]
  );

  // Commute isochrone overlay (drawn under the listing pins so pins stay clickable).
  const commuteLayers = useMemo(() => {
    if (!commuteRing) return [];
    const result: Layer[] = [
      new PolygonLayer<{ ring: [number, number][] }>({
        id: "commute-isochrone",
        data: [{ ring: commuteRing }],
        getPolygon: (d) => d.ring,
        filled: true,
        stroked: true,
        getFillColor: [34, 211, 238, 38],
        getLineColor: [34, 211, 238, 220],
        lineWidthUnits: "pixels",
        getLineWidth: 2,
        pickable: false,
      }),
    ];
    if (commuteDestination) {
      result.push(
        new ScatterplotLayer<{ label: string; lat: number; lng: number }>({
          id: "commute-destination",
          data: [commuteDestination],
          getPosition: (d) => [d.lng, d.lat],
          getRadius: 8,
          radiusUnits: "pixels",
          getFillColor: [34, 211, 238, 255],
          stroked: true,
          getLineColor: [255, 255, 255, 255],
          lineWidthMinPixels: 2,
          pickable: false,
        })
      );
    }
    return result;
  }, [commuteRing, commuteDestination]);

  // Draw-to-search overlay: in-progress vertices + edges while drawing, or the
  // committed area polygon once finished. Drawn over everything so it's editable.
  const drawLayers = useMemo<Layer[]>(() => {
    if (drawPolygon) {
      return [
        new PolygonLayer<{ ring: [number, number][] }>({
          id: "draw-area",
          data: [{ ring: drawPolygon }],
          getPolygon: (d) => d.ring,
          filled: true,
          stroked: true,
          getFillColor: [34, 211, 238, 32],
          getLineColor: [34, 211, 238, 230],
          lineWidthUnits: "pixels",
          getLineWidth: 2,
          pickable: false,
        }),
      ];
    }
    if (!isDrawing || drawPoints.length === 0) return [];
    const out: Layer[] = [];
    if (drawPoints.length >= 2) {
      out.push(
        new PathLayer<{ path: [number, number][] }>({
          id: "draw-edges",
          data: [{ path: drawPoints }],
          getPath: (d) => d.path,
          getColor: [34, 211, 238, 220],
          getWidth: 2,
          widthUnits: "pixels",
          pickable: false,
        })
      );
    }
    out.push(
      new ScatterplotLayer<{ pos: [number, number]; i: number }>({
        id: "draw-vertices",
        data: drawPoints.map((pos, i) => ({ pos, i })),
        getPosition: (d) => d.pos,
        getRadius: (d) => (d.i === 0 ? 7 : 5),
        radiusUnits: "pixels",
        getFillColor: (d) => (d.i === 0 ? [255, 255, 255, 255] : [34, 211, 238, 255]),
        stroked: true,
        getLineColor: [15, 23, 42, 220],
        lineWidthMinPixels: 1.5,
        pickable: true,
      })
    );
    return out;
  }, [drawPolygon, isDrawing, drawPoints]);

  const layers = useMemo(() => {
    if (renderData.length === 0) return [...commuteLayers];

    if (mapMode === "heatmap") {
      return [
        ...commuteLayers,
        new HexagonLayer<MapDataPoint>({
          id: "hexagon-layer",
          data: heatData,
          getPosition: (d) => d.coordinates,
          // Density colors/elevates by listing COUNT (weight 1, SUM); every other
          // metric uses the MEAN of the metric value across the hex.
          getColorWeight: heatAggregation === "count" ? () => 1 : (d) => colorConfig.metric(d),
          getElevationWeight: heatAggregation === "count" ? () => 1 : (d) => colorConfig.metric(d),
          colorAggregation: heatAggregation === "count" ? "SUM" : "MEAN",
          elevationAggregation: heatAggregation === "count" ? "SUM" : "MEAN",
          colorRange: ALPHA_GLOW_RANGE,
          elevationScale: 1.15,
          elevationRange: [0, 2500],
          extruded: true,
          radius: 800,
          coverage: 0.9,
          upperPercentile: 100,
          opacity: 0.92,
          pickable: true,
          autoHighlight: true,
          highlightColor: [255, 255, 255, 120],
          // CPU aggregation so the picked bin carries its member listings
          // (pointIndices/points) for hover stats + click drill-down. Trivially
          // cheap at the ≤100-listing compliance cap.
          gpuAggregation: false,
          // High ambient + low shininess = bright, luminous columns (faked glow).
          material: { ambient: 0.85, diffuse: 0.5, shininess: 8, specularColor: [40, 70, 90] },
          // Hover → floating tooltip with the cell's listing count and (mean mode)
          // its average metric, labeled + unit-formatted from the active color config.
          onHover: (info) => {
            const bin = info.object as { count?: number; colorValue?: number } | undefined;
            if (!bin || bin.count == null) {
              setHexHover((h) => (h ? null : h));
              return false;
            }
            const metric =
              heatAggregation === "mean" && colorConfig.label && colorConfig.format
                ? `Avg ${colorConfig.label} · ${colorConfig.format(bin.colorValue ?? 0)}`
                : undefined;
            setHexHover({ x: info.x, y: info.y, count: bin.count, metric });
            return true;
          },
          // Click → drill down. A cell with few listings (or one already zoomed in
          // as far as the fixed-size hexes resolve) reveals them in the popup;
          // a denser cell flies the camera into the hot spot and re-queries the
          // tighter viewport so the next click can reach the listings.
          onClick: (info) => {
            // In draw mode, let the click fall through to the root handler (it adds
            // a polygon vertex), so don't treat it as a drill-down.
            if (isDrawing) return false;
            const bin = info.object as
              | { position?: [number, number]; count?: number; points?: MapDataPoint[] }
              | undefined;
            if (!bin || !bin.count) return false;
            const listings = (bin.points ?? []) as ListingDocument[];
            const atMaxZoom = (info.viewport?.zoom ?? 0) >= MAP_MAX_ZOOM - 0.5;
            if (listings.length && (bin.count <= HEX_REVEAL_CAP || atMaxZoom)) {
              setPopup({ x: info.x, y: info.y, listings });
            } else if (bin.position) {
              const [lng, lat] = bin.position;
              setViewState((vs) => ({
                ...vs,
                longitude: lng,
                latitude: lat,
                zoom: Math.min(MAP_MAX_ZOOM, (vs.zoom ?? 0) + 2),
                transitionDuration: 600,
                transitionInterpolator: new FlyToInterpolator(),
              }));
              // Re-query the tighter viewport once the fly settles (mirrors cluster expand).
              setTimeout(() => computeAndReportBounds(), 750);
            }
            return true;
          },
          updateTriggers: {
            getColorWeight: [colorConfig, heatAggregation],
            getElevationWeight: [colorConfig, heatAggregation],
          },
        }),
      ];
    }

    // 3D Explore: each listing is a luminous value-column rising over the city
    // (height = the active metric, color = the metric ramp). The Mapbox building
    // extrusions render underneath via the base map.
    if (mapMode === "3d") {
      const valueColumns = new ColumnLayer<MapDataPoint>({
        id: "value-columns",
        data: renderData,
        getPosition: (d) => d.coordinates,
        diskResolution: 12,
        radius: 55,
        radiusUnits: "meters",
        extruded: true,
        elevationScale: 1,
        getElevation: (d) => 120 + normMetric(colorConfig.metric(d), colorConfig.domain) * 1700,
        getFillColor: (d) => {
          if (selectedIds.has(d.id)) return [34, 211, 238, 255];
          const c = getScatterColor(d);
          return [c[0], c[1], c[2], 235];
        },
        pickable: true,
        autoHighlight: true,
        highlightColor: [255, 255, 255, 120],
        material: { ambient: 0.8, diffuse: 0.6, shininess: 32, specularColor: [60, 90, 110] },
        onHover: (info) => {
          const d = info.object as MapDataPoint | undefined;
          setHoveredId(d ? d.id : null);
        },
        onClick: (info) => {
          if (isDrawing) return;
          const d = info.object as MapDataPoint | undefined;
          if (!d) return;
          if (isSelectMode) toggleSelected(d.id);
          else onSelectProperty?.(d);
        },
        updateTriggers: {
          getElevation: [colorConfig],
          getFillColor: [colorConfig, selectedIds],
        },
      });
      return [...commuteLayers, valueColumns];
    }

    // Listings mode: cluster bubbles + individual price pills
    const clusterBubbles = new ScatterplotLayer<ClusterPoint>({
      id: "cluster-bubbles",
      data: groups,
      getPosition: (f) => f.geometry.coordinates as [number, number],
      getRadius: (f) => 16 + Math.min(28, ((f.properties as { point_count: number }).point_count ?? 0) * 1.4),
      radiusUnits: "pixels",
      // Billboard so the bubble stays a true circle under the 45° map pitch
      // (a ground-plane circle foreshortens into an oval that clips the count).
      billboard: true,
      getFillColor: [34, 211, 238, 210],
      stroked: true,
      getLineColor: [255, 255, 255, 170],
      lineWidthMinPixels: 1.5,
      pickable: true,
      onClick: (info) => {
        if (isDrawing) return;
        const f = info.object as ClusterPoint | undefined;
        if (!f) return;
        const cid = (f.properties as { cluster_id: number }).cluster_id;
        const [lng, lat] = f.geometry.coordinates as [number, number];
        // Zoom to split the cluster; if it can't separate (coincident listings
        // past maxZoom — e.g. condo units at one address), list them in a popup.
        if (clusterIndex.getClusterExpansionZoom(cid) > MAP_MAX_ZOOM) {
          const leaves = clusterIndex
            .getLeaves(cid, Infinity)
            .map((leaf) => (leaf.properties as PinProps).listing);
          setPopup({ x: info.x, y: info.y, listings: leaves });
        } else {
          expandCluster(cid, lng, lat);
        }
      },
    });

    const clusterCounts = new TextLayer<ClusterPoint>({
      id: "cluster-counts",
      data: groups,
      getPosition: (f) => f.geometry.coordinates as [number, number],
      getText: (f) => String((f.properties as { point_count: number }).point_count ?? ""),
      getColor: [255, 255, 255, 255],
      getSize: 15,
      sizeUnits: "pixels",
      fontWeight: "bold",
      getTextAnchor: "middle",
      getAlignmentBaseline: "center",
      characterSet: "auto",
    });

    const listingPins = new TextLayer<ClusterPoint>({
      id: "listing-pins",
      data: singles,
      getPosition: (f) => f.geometry.coordinates as [number, number],
      getText: (f) => {
        const listing = (f.properties as PinProps).listing;
        const price = formatPriceShort(listing.ListPrice);
        return selectedIds.has(listing.id) ? `✓ ${price}` : price;
      },
      getColor: [255, 255, 255, 255],
      getSize: 14,
      sizeUnits: "pixels",
      fontWeight: "bold",
      getTextAnchor: "middle",
      getAlignmentBaseline: "center",
      characterSet: "auto",
      background: true,
      getBackgroundColor: (f) => {
        const listing = (f.properties as PinProps).listing;
        // Selected pins read as a solid emerald chip regardless of the metric color.
        if (selectedIds.has(listing.id)) return [34, 211, 238, 255];
        if (listing.compKind === "sold") return [244, 63, 94, 230];     // rose
        if (listing.compKind === "leased") return [167, 139, 250, 230]; // violet
        if (isDelistedDealType(listing.compKind)) return [245, 158, 11, 230]; // amber — de-listed
        const c = getScatterColor(listing);
        return [c[0], c[1], c[2], 235];
      },
      backgroundPadding: [8, 4, 8, 4],
      getBorderColor: (f) => {
        const listing = (f.properties as PinProps).listing;
        if (selectedIds.has(listing.id)) return [255, 255, 255, 255];
        return hoveredId === listing.id ? [255, 255, 255, 255] : [15, 23, 42, 180];
      },
      getBorderWidth: (f) => {
        const listing = (f.properties as PinProps).listing;
        if (selectedIds.has(listing.id)) return 2.5;
        return hoveredId === listing.id ? 2 : 1;
      },
      pickable: true,
      onHover: (info) => {
        const leaf = info.object as ClusterPoint | undefined;
        // Hover only drives the pin↔list highlight now (no tooltip — the card
        // lives in the click popup).
        setHoveredId(leaf ? (leaf.properties as PinProps).listing.id : null);
      },
      onClick: (info) => {
        if (isDrawing) return;
        const leaf = info.object as ClusterPoint | undefined;
        if (!leaf) return;
        const listing = (leaf.properties as PinProps).listing;
        // In select mode a tap toggles membership; otherwise it opens the card popup.
        if (isSelectMode) toggleSelected(listing.id);
        else setPopup({ x: info.x, y: info.y, listings: [listing] });
      },
      updateTriggers: {
        getText: [selectedIds],
        getBackgroundColor: [colorConfig, selectedIds],
        getBorderColor: [hoveredId, selectedIds],
        getBorderWidth: [hoveredId, selectedIds],
      },
    });

    return [...commuteLayers, clusterBubbles, clusterCounts, listingPins];
  }, [renderData, heatData, mapMode, heatAggregation, groups, singles, colorConfig, getScatterColor, hoveredId, onSelectProperty, expandCluster, clusterIndex, setHoveredId, commuteLayers, selectedIds, isSelectMode, toggleSelected, isDrawing, computeAndReportBounds]);

  // Current viewport extent for the school-zone overlay — computed locally (not via
  // the store's settle-gated mapBounds) so zones paint the moment they're toggled on.
  const overlayBounds = useMemo(() => {
    const dims = dimsRef.current;
    if (!dims || dims.width === 0 || dims.height === 0) return null;
    try {
      const vp = new WebMercatorViewport({
        width: dims.width,
        height: dims.height,
        longitude: viewState.longitude,
        latitude: viewState.latitude,
        zoom: viewState.zoom,
        pitch: viewState.pitch ?? 0,
        bearing: viewState.bearing ?? 0,
      });
      const [west, south, east, north] = vp.getBounds();
      return { west, south, east, north };
    } catch {
      return null;
    }
  }, [viewState]);

  // School attendance-boundary overlay (real catchments + approximate proximity
  // circle). Prepended below the listing pins so pins stay clickable.
  const catchmentLayers = useSchoolCatchmentLayers({
    zoom: viewState.zoom,
    bounds: overlayBounds,
    onHover: setCatchmentHover,
  });

  // Zoning overlay (municipal open data; viewport-scoped). Prepended below the pins.
  const zoningLayers = useZoningLayers({
    zoom: viewState.zoom,
    bounds: overlayBounds,
    onHover: setZoningHover,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleViewStateChange = useCallback((params: any) => {
    if (!params.viewState) return;
    // Cap zoom so coincident points never pass supercluster's maxZoom (where
    // they'd stop clustering and stack as overlapping pills).
    const next = { ...params.viewState, zoom: Math.min(MAP_MAX_ZOOM, params.viewState.zoom ?? 0) };
    setViewState(next);
    viewStateRef.current = next;
    const interacting = !!(
      params.interactionState &&
      (params.interactionState.isDragging ||
        params.interactionState.isPanning ||
        params.interactionState.isZooming)
    );
    isInteracting.current = interacting;
    // Only a GENUINE user gesture flags a re-query. A programmatic transition (auto-fit
    // / fly) can report isZooming as its zoom animates — guarding on !programmaticRef
    // keeps those from ever setting userMovedRef, so the post-fit settle never re-queries.
    if (interacting && !programmaticRef.current) userMovedRef.current = true;
    // Debounced settle: re-query the new viewport, but only for genuine user
    // movement (programmatic auto-fit flies are flagged and skipped → no loop).
    if (reportTimer.current) clearTimeout(reportTimer.current);
    reportTimer.current = setTimeout(() => {
      if (userMovedRef.current && !programmaticRef.current) {
        userMovedRef.current = false;
        computeAndReportBounds();
      }
    }, 350);
  }, [computeAndReportBounds]);

  const handleDragEnd = useCallback(() => {
    setTimeout(() => {
      isInteracting.current = false;
    }, 100);
  }, []);

  if (!mapboxToken || mapboxToken === "your-mapbox-token") {
    return (
      <div className={`flex items-center justify-center bg-background ${className}`}>
        <div className="p-6 text-center">
          <MapPin className="mx-auto mb-3 h-12 w-12 text-muted-foreground" />
          <p className="font-medium text-muted-foreground">Map not configured</p>
          <p className="mt-1 text-xs text-muted-foreground">Add NEXT_PUBLIC_MAPBOX_TOKEN to .env</p>
        </div>
      </div>
    );
  }

  // Show the empty state only before the map has ever framed results. Once it's
  // up (commute active or a prior search rendered), keep the map mounted even at
  // 0 in-view results so viewport browsing into sparse areas isn't a dead end.
  if (validProperties.length === 0 && !commuteRing && !mapReady) {
    return (
      <div className={`flex items-center justify-center bg-background ${className}`}>
        <div className="p-6 text-center">
          <Layers className="mx-auto mb-3 h-12 w-12 text-muted-foreground" />
          <p className="font-medium text-muted-foreground">No properties to visualize</p>
          <p className="mt-1 text-xs text-muted-foreground">Adjust filters to see density</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`relative overflow-hidden ${className}`}
      style={{ minHeight: "400px", height: "100%" }}
      role="application"
      aria-label="Interactive listings map — pan, zoom, and click pins to explore properties"
    >
      <DeckGL
        viewState={viewState}
        onViewStateChange={handleViewStateChange}
        onResize={({ width, height }) => {
          dimsRef.current = { width, height };
        }}
        onDragStart={() => { setPopup(null); setCatchmentHover(null); setHexHover(null); setZoningHover(null); }}
        onDragEnd={handleDragEnd}
        controller={true}
        layers={[...catchmentLayers, ...zoningLayers, ...layers, ...drawLayers, ...searchPinLayer]}
        onClick={(info) => {
          if (isDrawing) {
            if (!info.coordinate) return;
            // Clicking the first vertex closes the polygon; any other click adds one.
            if (info.layer?.id === "draw-vertices" && (info.object as { i: number })?.i === 0 && drawPoints.length >= 3) {
              finishDrawing();
              return;
            }
            addDrawPoint([info.coordinate[0], info.coordinate[1]]);
            return;
          }
          // A click on empty map (no pin/cluster picked) dismisses the popup;
          // pin/cluster layer handlers open it and set info.object.
          if (!info.object) setPopup(null);
        }}
        getCursor={({ isHovering }) => (isDrawing ? "crosshair" : isHovering ? "pointer" : "grab")}
      >
        <Map mapboxAccessToken={mapboxToken} mapStyle="mapbox://styles/mapbox/dark-v11" reuseMaps attributionControl={false}>
          {/* 3D building extrusions — only in Explore mode, so the value-columns
              read against a real cityscape (dark massing + faint cyan rim). */}
          {mapMode === "3d" && (
            <MapboxLayer
              id="3d-buildings"
              type="fill-extrusion"
              source="composite"
              source-layer="building"
              minzoom={12}
              filter={["==", "extrude", "true"]}
              paint={{
                "fill-extrusion-color": "#1e293b",
                "fill-extrusion-height": ["get", "height"],
                "fill-extrusion-base": ["get", "min_height"],
                "fill-extrusion-opacity": 0.85,
              }}
            />
          )}
        </Map>
      </DeckGL>

      {/* Zoom buttons — HTML overlay above deck's event surface (see zoomBy). */}
      <div className="absolute right-2.5 top-2.5 z-20 flex flex-col overflow-hidden rounded-md border border-border bg-card/90 shadow-lg backdrop-blur-sm">
        <button
          type="button"
          aria-label="Zoom in"
          onClick={() => zoomBy(1)}
          className="flex h-9 w-9 items-center justify-center text-foreground transition-colors hover:bg-muted active:bg-muted"
        >
          <Plus className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label="Zoom out"
          onClick={() => zoomBy(-1)}
          className="flex h-9 w-9 items-center justify-center border-t border-border text-foreground transition-colors hover:bg-muted active:bg-muted"
        >
          <Minus className="h-4 w-4" />
        </button>
      </div>

      {popup && (
        <ListingMapPopup
          listings={popup.listings}
          x={popup.x}
          y={popup.y}
          dims={dimsRef.current}
          onClose={() => setPopup(null)}
          onSelect={(l) => {
            setPopup(null);
            onSelectProperty?.(l);
          }}
          onComps={(l) => {
            const anchor = compsAnchorForListing(l);
            if (!anchor) return;
            setFlyTo({ lat: anchor.lat, lng: anchor.lng, zoom: 14 });
            enterComps(anchor);
            setPopup(null);
          }}
        />
      )}

      {/* Hovered school-zone label — emerald for official boundaries, amber for the
          approximate proximity circle. Positioned at the cursor over the canvas. */}
      {catchmentHover && (
        <div
          className="pointer-events-none absolute z-20 max-w-[260px] -translate-x-1/2 -translate-y-full border bg-card/95 px-2.5 py-1.5 backdrop-blur-md"
          style={{
            left: catchmentHover.x,
            top: catchmentHover.y - 10,
            borderColor: catchmentHover.approximate ? "rgba(245,158,11,0.5)" : "rgba(16,185,129,0.5)",
          }}
        >
          <div className="text-xs font-medium text-foreground">{catchmentHover.name}</div>
          <div className={`text-[10px] leading-tight ${catchmentHover.approximate ? "text-amber-700 dark:text-amber-300/90" : "text-emerald-700 dark:text-emerald-300/90"}`}>
            {catchmentHover.detail}
          </div>
        </div>
      )}

      {/* Hovered heatmap hex — listing count + (mean mode) the cell's average
          metric. Anchored at the cursor; cyan to read as part of the heat layer.
          Gated on heatmap mode so a tooltip left showing when the mode changes
          (the hex layer, and thus its onHover, only exists here) disappears. */}
      {mapMode === "heatmap" && hexHover && (
        <div
          className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full border border-cyan-500/50 bg-card/95 px-2.5 py-1.5 backdrop-blur-md"
          style={{ left: hexHover.x, top: hexHover.y - 10 }}
        >
          <div className="text-xs font-medium text-foreground">
            {hexHover.count.toLocaleString()} listing{hexHover.count === 1 ? "" : "s"}
          </div>
          {hexHover.metric && (
            <div className="text-[10px] leading-tight text-cyan-700 dark:text-cyan-300/90">{hexHover.metric}</div>
          )}
        </div>
      )}

      {/* Hovered zoning polygon — municipal open data. Amber, to read as distinct from
          MLS-derived data. */}
      {showZoning && zoningHover && (
        <div
          className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full border border-amber-500/50 bg-card/95 px-2.5 py-1.5 backdrop-blur-md"
          style={{ left: zoningHover.x, top: zoningHover.y - 10 }}
        >
          <div className="font-mono text-xs font-semibold text-amber-700 dark:text-amber-200">{zoningHover.code}</div>
          <div className="text-[10px] leading-tight text-foreground">{zoningHover.category}</div>
        </div>
      )}

      {/* Zoning legend + required licence attribution (municipal open data). The Zoning
          overlay is toggled from the layers rail; the legend sits clear of that rail. */}
      {showZoning && (
        <div className="pointer-events-none absolute bottom-3 left-3 z-10 max-w-[280px] border border-amber-500/30 bg-card/90 px-2.5 py-2 backdrop-blur-md md:left-[76px]">
          <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300">
            <Landmark className="h-3 w-3" /> Zoning · municipal open data
          </div>
          <div className="flex flex-wrap gap-x-2.5 gap-y-0.5 text-[9px] text-foreground">
            {[
              ["Residential", "52,211,153"],
              ["Commercial", "59,130,246"],
              ["Employment", "167,139,250"],
              ["Institutional", "45,212,191"],
              ["Open space", "134,239,172"],
            ].map(([label, rgb]) => (
              <span key={label} className="inline-flex items-center gap-1">
                <span className="inline-block h-2 w-2" style={{ background: `rgb(${rgb})` }} />
                {label}
              </span>
            ))}
          </div>
          <div className="mt-1 text-[9px] leading-tight text-muted-foreground">
            {viewState.zoom < 13 ? "Zoom in to street level to see zones. " : ""}
            {ZONING_SOURCES.toronto.municipality} · {ZONING_SOURCES.toronto.bylaw}. {ZONING_SOURCES.toronto.attribution} Approximate — not a legal survey.
          </div>
        </div>
      )}

      {/* Select-mode hint — centered toast so it clears the left rail/drawer. The toast
          text stays pass-through (pointer-events-none) but carries an always-reachable Done
          button, so a user can exit "tap to add" straight from the map without hunting for
          the toggle in the Compare drawer (which is often closed — the stuck-in-select-mode bug). */}
      {isSelectMode && (
        /* hidden md:flex — on phones the in-flow ActiveLensBar (above the map)
           carries the "Selecting — Done" chip; this absolute toast collided with
           the legend HUD there (both pinned top-of-map), burying the exit. */
        <div className="pointer-events-none absolute left-1/2 top-4 z-10 hidden -translate-x-1/2 items-center gap-2.5 border border-cyan-500/40 bg-cyan-500/15 px-3.5 py-1.5 backdrop-blur-md md:flex">
          <p className="font-mono text-xs text-cyan-200">Tap properties to add to your selection</p>
          <button
            type="button"
            onClick={() => setSelectMode(false)}
            aria-label="Done adding — exit selection mode"
            className="pointer-events-auto inline-flex items-center gap-1 border-l border-cyan-500/30 pl-2.5 font-mono text-xs font-medium text-cyan-100 transition-colors hover:text-white"
          >
            <X className="h-3.5 w-3.5" />
            Done
          </button>
        </div>
      )}

      {/* Search / comps anchor chip — identifies the dropped pin and (for comps-on-demand)
          reports how many recent solds are in view, so a sparse area reads as data, not a
          stray circle. The ✕ removes the pin. */}
      {searchPin && (
        <div className="pointer-events-auto absolute left-1/2 top-4 z-20 flex max-w-[92%] -translate-x-1/2 items-center gap-2 border border-cyan-500/40 bg-card/95 px-3 py-1.5 font-mono text-xs text-cyan-800 dark:text-cyan-100 backdrop-blur-md">
          <MapPin className="h-3.5 w-3.5 shrink-0 text-cyan-700 dark:text-cyan-300" />
          {searchPin.comps ? (
            <span className="truncate">
              Comparable sales near <span className="text-foreground">{searchPin.label ?? "this address"}</span>
              {" · "}
              <span className={soldCount > 0 ? "text-cyan-700 dark:text-cyan-300" : "text-amber-700 dark:text-amber-300"}>
                {soldCount > 0 ? `${soldCount.toLocaleString()} similar sold` : "no similar solds found"}
              </span>
            </span>
          ) : (
            <span className="truncate text-foreground">{searchPin.label ?? "Dropped pin"}</span>
          )}
          <button
            type="button"
            onClick={() => exitComps()}
            className="ml-1 flex shrink-0 items-center gap-1 border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-foreground transition-colors hover:border-rose-500/50 hover:text-rose-600 dark:hover:text-rose-200"
            aria-label={searchPin.comps ? "Exit comparable sales view" : "Clear pin"}
          >
            <X className="h-3 w-3" />
            {searchPin.comps ? "Exit" : null}
          </button>
        </div>
      )}
    </div>
  );
}
