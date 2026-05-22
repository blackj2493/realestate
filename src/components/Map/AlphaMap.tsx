"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import DeckGL from "@deck.gl/react";
import { HexagonLayer } from "@deck.gl/aggregation-layers";
import { ScatterplotLayer, TextLayer, PolygonLayer } from "@deck.gl/layers";
import { Map, NavigationControl } from "react-map-gl/mapbox";
import { MapViewState, FlyToInterpolator, WebMercatorViewport, type Layer } from "@deck.gl/core";
import { Layers, MapPin } from "lucide-react";
import Supercluster from "supercluster";
import "mapbox-gl/dist/mapbox-gl.css";
import { cn } from "@/lib/utils";
import type { ListingDocument } from "@/lib/typesense/client";
import type { MapColorConfig, MapMode } from "@/lib/personas/personaConfig";
import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";
import {
  CLUSTER_OPTIONS,
  MAP_MAX_ZOOM,
  colorIndexFor,
  formatPriceShort,
  isClusterFeature,
  isValidLocation,
  toDeckPosition,
} from "./mapLogic";

interface AlphaMapProps {
  properties: ListingDocument[];
  colorConfig: MapColorConfig;
  defaultMapMode?: MapMode;
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
  pitch: 45,
  bearing: 0,
};

export default function AlphaMap({
  properties,
  colorConfig,
  defaultMapMode = "listings",
  onSelectProperty,
  className = "",
  currentSearchQuery = "",
}: AlphaMapProps) {
  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

  const [viewState, setViewState] = useState<MapViewState>(INITIAL_VIEW_STATE);
  const [viewMode, setViewMode] = useState<MapMode>(defaultMapMode);
  // Once the map has framed real results, keep it mounted even if a later
  // viewport-scoped query returns 0 — blanking it mid-browse would trap the user.
  const [mapReady, setMapReady] = useState(false);
  const [hoverInfo, setHoverInfo] = useState<{ x: number; y: number; object: ListingDocument | null } | null>(null);

  const hoveredId = useCommandCenterStore((s) => s.hoveredId);
  const setHoveredId = useCommandCenterStore((s) => s.setHoveredId);
  const commuteEnabled = useCommandCenterStore((s) => s.commute.enabled);
  const commutePolygon = useCommandCenterStore((s) => s.commute.polygon);
  const commuteDestination = useCommandCenterStore((s) => s.commute.destination);
  const totalCount = useCommandCenterStore((s) => s.totalCount);
  const setMapBounds = useCommandCenterStore((s) => s.setMapBounds);

  // Active isochrone ring ([lng, lat] order, deck.gl-ready) — null when off.
  const commuteRing = useMemo<[number, number][] | null>(
    () => (commuteEnabled && commutePolygon && commutePolygon.length >= 3 ? commutePolygon : null),
    [commuteEnabled, commutePolygon]
  );

  const isInteracting = useRef(false);
  const lastSearchQuery = useRef(currentSearchQuery);
  const mapInitialized = useRef(false);

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
    setTimeout(() => {
      programmaticRef.current = false;
    }, durationMs + 150);
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

  // Switching persona resets the map to that persona's default view; the user
  // can still toggle freely within a persona (prop is stable until it changes).
  useEffect(() => {
    setViewMode(defaultMapMode);
  }, [defaultMapMode]);

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

  // Auto-fit when the result set changes (and the user isn't interacting).
  // When a commute zone is active, the polygon-fit effect below governs framing.
  useEffect(() => {
    if (commuteRing) return;
    if (isInteracting.current || validProperties.length === 0) return;
    const changed = lastSearchQuery.current !== currentSearchQuery;
    if (mapInitialized.current && !changed) return;

    let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
    for (const p of validProperties) {
      const lat = p.location[0];
      const lng = p.location[1];
      minLng = Math.min(minLng, lng);
      maxLng = Math.max(maxLng, lng);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
    }
    const centerLng = (minLng + maxLng) / 2;
    const centerLat = (minLat + maxLat) / 2;
    const maxRange = Math.max(maxLng - minLng, maxLat - minLat);
    const zoom = maxRange > 0 ? Math.max(8, Math.min(15, 12 - Math.log10(maxRange * 100))) : 10;

    markProgrammatic(800);
    setViewState({
      longitude: centerLng,
      latitude: centerLat,
      zoom,
      pitch: 45,
      bearing: 0,
      transitionDuration: 800,
      transitionInterpolator: new FlyToInterpolator(),
    });
    mapInitialized.current = true;
    setMapReady(true);
    lastSearchQuery.current = currentSearchQuery;
  }, [validProperties, currentSearchQuery, commuteRing, markProgrammatic]);

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

  const getScatterColor = useCallback(
    (d: ListingDocument): [number, number, number] => {
      const idx = colorIndexFor(colorConfig.metric(d), colorConfig.domain, colorConfig.range.length);
      return colorConfig.range[idx];
    },
    [colorConfig]
  );

  // ── Clustering (Listings mode) ─────────────────────────────────────────
  // ≤100 listings (compliance cap) so clustering the whole world bbox at the
  // current zoom is cheap and avoids needing the precise viewport extent.
  const clusterIndex = useMemo(() => {
    const index = new Supercluster<PinProps>({ ...CLUSTER_OPTIONS });
    index.load(
      mapData.map((p) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: p.coordinates },
        properties: { listing: p as ListingDocument },
      }))
    );
    return index;
  }, [mapData]);

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
        getFillColor: [16, 185, 129, 38],
        getLineColor: [16, 185, 129, 220],
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
          getFillColor: [16, 185, 129, 255],
          stroked: true,
          getLineColor: [255, 255, 255, 255],
          lineWidthMinPixels: 2,
          pickable: false,
        })
      );
    }
    return result;
  }, [commuteRing, commuteDestination]);

  const layers = useMemo(() => {
    if (mapData.length === 0) return [...commuteLayers];

    if (viewMode === "heatmap") {
      return [
        ...commuteLayers,
        new HexagonLayer<MapDataPoint>({
          id: "hexagon-layer",
          data: mapData,
          getPosition: (d) => d.coordinates,
          getColorWeight: (d) => colorConfig.metric(d),
          getElevationWeight: (d) => colorConfig.metric(d),
          colorAggregation: "MEAN",
          elevationAggregation: "MEAN",
          colorRange: colorConfig.range,
          elevationScale: 1,
          elevationRange: [0, 2500],
          extruded: true,
          radius: 1000,
          coverage: 1,
          upperPercentile: 100,
          pickable: true,
          autoHighlight: true,
          highlightColor: [255, 255, 255, 90],
          material: { ambient: 0.45, diffuse: 0.6, shininess: 32, specularColor: [60, 64, 70] },
          updateTriggers: { getColorWeight: [colorConfig], getElevationWeight: [colorConfig] },
        }),
      ];
    }

    // Listings mode: cluster bubbles + individual price pills
    const clusterBubbles = new ScatterplotLayer<ClusterPoint>({
      id: "cluster-bubbles",
      data: groups,
      getPosition: (f) => f.geometry.coordinates as [number, number],
      getRadius: (f) => 14 + Math.min(26, ((f.properties as { point_count: number }).point_count ?? 0) * 1.4),
      radiusUnits: "pixels",
      getFillColor: [16, 185, 129, 210],
      stroked: true,
      getLineColor: [255, 255, 255, 170],
      lineWidthMinPixels: 1.5,
      pickable: true,
      onClick: (info) => {
        const f = info.object as ClusterPoint | undefined;
        if (!f) return;
        const cid = (f.properties as { cluster_id: number }).cluster_id;
        const [lng, lat] = f.geometry.coordinates as [number, number];
        expandCluster(cid, lng, lat);
      },
    });

    const clusterCounts = new TextLayer<ClusterPoint>({
      id: "cluster-counts",
      data: groups,
      getPosition: (f) => f.geometry.coordinates as [number, number],
      getText: (f) => String((f.properties as { point_count: number }).point_count ?? ""),
      getColor: [255, 255, 255, 255],
      getSize: 13,
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
      getText: (f) => formatPriceShort((f.properties as PinProps).listing.ListPrice),
      getColor: [255, 255, 255, 255],
      getSize: 13,
      sizeUnits: "pixels",
      fontWeight: "bold",
      getTextAnchor: "middle",
      getAlignmentBaseline: "center",
      characterSet: "auto",
      background: true,
      getBackgroundColor: (f) => {
        const c = getScatterColor((f.properties as PinProps).listing);
        return [c[0], c[1], c[2], 235];
      },
      backgroundPadding: [8, 4, 8, 4],
      getBorderColor: (f) =>
        hoveredId === (f.properties as PinProps).listing.id ? [255, 255, 255, 255] : [15, 23, 42, 180],
      getBorderWidth: (f) => (hoveredId === (f.properties as PinProps).listing.id ? 2 : 1),
      pickable: true,
      onHover: (info) => {
        const leaf = info.object as ClusterPoint | undefined;
        if (leaf) {
          const listing = (leaf.properties as PinProps).listing;
          setHoverInfo({ x: info.x, y: info.y, object: listing });
          setHoveredId(listing.id);
        } else {
          setHoverInfo(null);
          setHoveredId(null);
        }
      },
      onClick: (info) => {
        const leaf = info.object as ClusterPoint | undefined;
        if (leaf) onSelectProperty?.((leaf.properties as PinProps).listing);
      },
      updateTriggers: {
        getBackgroundColor: [colorConfig],
        getBorderColor: [hoveredId],
        getBorderWidth: [hoveredId],
      },
    });

    return [...commuteLayers, clusterBubbles, clusterCounts, listingPins];
  }, [mapData, viewMode, groups, singles, colorConfig, getScatterColor, hoveredId, onSelectProperty, expandCluster, setHoveredId, commuteLayers]);

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
    if (interacting) userMovedRef.current = true;
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
      <div className={`flex items-center justify-center bg-slate-950 ${className}`}>
        <div className="p-6 text-center">
          <MapPin className="mx-auto mb-3 h-12 w-12 text-slate-700" />
          <p className="font-medium text-slate-400">Map not configured</p>
          <p className="mt-1 text-xs text-slate-600">Add NEXT_PUBLIC_MAPBOX_TOKEN to .env</p>
        </div>
      </div>
    );
  }

  // Show the empty state only before the map has ever framed results. Once it's
  // up (commute active or a prior search rendered), keep the map mounted even at
  // 0 in-view results so viewport browsing into sparse areas isn't a dead end.
  if (validProperties.length === 0 && !commuteRing && !mapReady) {
    return (
      <div className={`flex items-center justify-center bg-slate-950 ${className}`}>
        <div className="p-6 text-center">
          <Layers className="mx-auto mb-3 h-12 w-12 text-slate-700" />
          <p className="font-medium text-slate-400">No properties to visualize</p>
          <p className="mt-1 text-xs text-slate-500">Adjust filters to see density</p>
        </div>
      </div>
    );
  }

  const rgb = (c: [number, number, number]) => `rgb(${c[0]},${c[1]},${c[2]})`;

  return (
    <div className={`relative overflow-hidden ${className}`} style={{ minHeight: "400px", height: "100%" }}>
      <DeckGL
        viewState={viewState}
        onViewStateChange={handleViewStateChange}
        onResize={({ width, height }) => {
          dimsRef.current = { width, height };
        }}
        onDragEnd={handleDragEnd}
        controller={true}
        layers={layers}
        getCursor={({ isHovering }) => (isHovering ? "pointer" : "grab")}
      >
        <Map mapboxAccessToken={mapboxToken} mapStyle="mapbox://styles/mapbox/dark-v11" reuseMaps attributionControl={false}>
          <NavigationControl position="top-right" />
        </Map>
      </DeckGL>

      {hoverInfo?.object && (
        <div
          className="pointer-events-none absolute z-20 rounded-lg border border-slate-700 bg-slate-900/95 px-3 py-2 shadow-xl backdrop-blur-sm"
          style={{ left: hoverInfo.x + 10, top: hoverInfo.y + 10 }}
        >
          <p className="text-xs font-medium text-slate-300">
            {hoverInfo.object.UnparsedAddress || hoverInfo.object.City || "Unknown location"}
          </p>
          <p className="mt-1 font-mono text-sm text-emerald-400">
            ${hoverInfo.object.ListPrice?.toLocaleString() || "N/A"}
          </p>
        </div>
      )}

      {/* Legend */}
      <div className="absolute bottom-4 left-4 z-10 rounded-lg border border-slate-700 bg-slate-900/90 px-4 py-3 shadow-xl backdrop-blur-sm">
        <div className="flex items-center gap-2 text-xs">
          <span className="text-slate-500">{colorConfig.legendLow}</span>
          <div
            className="h-1.5 w-20 rounded-full"
            style={{ background: `linear-gradient(to right, ${rgb(colorConfig.range[0])}, ${rgb(colorConfig.range[colorConfig.range.length - 1])})` }}
          />
          <span className="text-slate-300">{colorConfig.legendHigh}</span>
        </div>
      </div>

      {/* View-mode toggle + count */}
      <div className="absolute left-4 top-4 z-10 flex flex-col gap-2">
        <div className="flex overflow-hidden rounded-lg border border-slate-700 bg-slate-900/90 shadow-xl backdrop-blur-sm">
          <button
            type="button"
            onClick={() => setViewMode("listings")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors",
              viewMode === "listings" ? "bg-emerald-500/20 text-emerald-300" : "text-slate-400 hover:text-slate-200"
            )}
          >
            <MapPin className="h-3.5 w-3.5" />
            Listings
          </button>
          <button
            type="button"
            onClick={() => setViewMode("heatmap")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors",
              viewMode === "heatmap" ? "bg-emerald-500/20 text-emerald-300" : "text-slate-400 hover:text-slate-200"
            )}
          >
            <Layers className="h-3.5 w-3.5" />
            Heatmap
          </button>
        </div>
        <div className="self-start rounded-lg border border-slate-700 bg-slate-900/90 px-3 py-1.5 shadow-xl backdrop-blur-sm">
          <p className="font-mono text-xs text-slate-300">
            <span className="font-semibold text-emerald-400">{validProperties.length}</span>
            {totalCount > validProperties.length ? ` of ${totalCount.toLocaleString()}` : ""}{" "}
            in {commuteRing ? "commute zone" : "view"}
            {totalCount > validProperties.length && (
              <span className="ml-1.5 text-slate-500">· zoom in to see all</span>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
